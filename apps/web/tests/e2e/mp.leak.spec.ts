import type { PublicHand, PublicSeat } from '../../src/engine/types.ts';
import type { ServerMsg, TableView } from '../../src/net/protocol.ts';
import { expect, test, type TelegramPlayer, type WsFrame } from './fixtures.ts';
import {
  createTable,
  pcView,
  playHand,
  startGame,
  waitForHand,
  waitForHandEnd,
  waitForTable,
} from './mpPlay.ts';
import { newTelegramUser, TEST_BOT_TOKEN } from './telegram.ts';

/**
 * PLAN §18 Stage 10, acceptance 6, ⚠️ pitfall 13: every frame the server really sent to three real
 * browsers, over a fold, a showdown, an all-in run-out, a reload and a reconnect, against the leak
 * rules L1–L6 of §19.9. The checker walks the JSON structure and looks at keys and whole values; it
 * never searches strings for numbers, because card numbers are everywhere. It is its own code, not
 * the server's test helper's, for the same reason `telegram.ts` is.
 */

test.use({ multiplayer: true });

/** L3, and the fields only a `HandState` or a `TableState` has; L5, anything naming a person. */
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
  'deck',
  'deckPos',
  'seed',
  'tableSeed',
  'startTotal',
  'schema',
  'engineVersion',
  'tableId',
  'slots',
  'lastAggressor',
  'preflopAggressor',
  'undoneDecisions',
  'lastActedAtBet',
  'nextHandSeq',
  'handsDealt',
  'personalityCursor',
  'nameCursor',
  'reloads',
  'id',
  'userId',
  'telegramId',
  'username',
  'first_name',
  'last_name',
  'language_code',
  'photo_url',
  'photo',
  'initData',
]);

/** L6: a seed as the engine writes it. */
const SEED_SHAPE = /^[0-9a-f]{32}$/;

/** L1, as far as a frame can show it: a hand has exactly the fields `publicHand` writes. */
const HAND_FIELDS: Record<keyof PublicHand, true> = {
  handSeq: true,
  sb: true,
  bb: true,
  seats: true,
  button: true,
  sbSeat: true,
  bbSeat: true,
  street: true,
  phase: true,
  board: true,
  currentBet: true,
  minRaiseInc: true,
  toAct: true,
  runout: true,
  revealed: true,
  startStacks: true,
  log: true,
  result: true,
};
const HAND_SEAT_FIELDS: Record<keyof PublicSeat, true> = {
  dealtIn: true,
  stack: true,
  hole: true,
  folded: true,
  allIn: true,
  streetBet: true,
  totalBet: true,
};

const sameKeys = (object: object, fields: object): boolean =>
  Object.keys(object).sort().join() === Object.keys(fields).sort().join();

interface LeakRules {
  /** Every Telegram id at this table: no number and no string may hold one. */
  readonly ids: readonly number[];
  /** Usernames, last names, photo links, the token: no string may hold one. */
  readonly secrets: readonly string[];
  /** The only names a seat may show. */
  readonly names: ReadonlySet<string>;
}

function walk(node: unknown, path: string, rules: LeakRules, problems: string[]): void {
  if (typeof node === 'number') {
    if (rules.ids.includes(node)) problems.push(`L5: ${path} is a Telegram id`);
  } else if (typeof node === 'string') {
    if (SEED_SHAPE.test(node)) problems.push(`L6: ${path} looks like a seed`);
    for (const id of rules.ids) {
      if (node.includes(String(id))) problems.push(`L5: ${path} holds a Telegram id`);
    }
    for (const secret of rules.secrets) {
      if (node.includes(secret)) problems.push(`L5: ${path} holds a secret`);
    }
  } else if (Array.isArray(node)) {
    node.forEach((item, i) => {
      walk(item, `${path}[${i}]`, rules, problems);
    });
  } else if (typeof node === 'object' && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      if (FORBIDDEN_KEYS.has(key)) problems.push(`L3/L5: key "${key}" at ${path}`);
      walk(value, `${path}.${key}`, rules, problems);
    }
  }
}

function checkView(view: TableView, rules: LeakRules, problems: string[]): void {
  const { you, hand } = view;
  if (hand !== null) {
    if (!sameKeys(hand, HAND_FIELDS)) problems.push(`L1: the hand's fields are not publicHand's`);
    hand.seats.forEach((seat, i) => {
      if (!sameKeys(seat, HAND_SEAT_FIELDS)) problems.push(`L1: seat ${i} has other fields`);
      if (seat.hole !== null && i !== you && !hand.revealed.includes(i)) {
        problems.push(`L2: the hidden cards of seat ${i} went to seat ${you}`);
      }
    });
    for (const seat of hand.revealed) {
      if (hand.seats[seat]?.folded !== false) problems.push(`L2: seat ${seat} shown, not live`);
    }
  }
  if (view.legal !== null && (view.decision?.seat !== you || view.legal.seat !== you)) {
    problems.push(`L4: legal for seat ${view.legal.seat} went to seat ${you}`);
  }
  view.seats.forEach((seat, i) => {
    if (seat !== null && !rules.names.has(seat.name)) {
      problems.push(`L5: seat ${i} shows the name "${seat.name}"`);
    }
  });
}

/** Everything wrong with this frame, as it went on the wire; empty when it passes. */
function leakProblems(text: string, rules: LeakRules): string[] {
  const msg = JSON.parse(text) as ServerMsg;
  const problems: string[] = [];
  walk(msg, 'msg', rules, problems);
  if (msg.t === 'table') checkView(msg.view, rules, problems);
  return problems;
}

const toClient = (frames: readonly WsFrame[]): string[] =>
  frames.filter((f) => f.to === 'client').map((f) => f.text);

const tables = (frames: readonly WsFrame[]): TableView[] =>
  toClient(frames).flatMap((text) => {
    const msg = JSON.parse(text) as ServerMsg;
    return msg.t === 'table' ? [msg.view] : [];
  });

function rulesFor(players: readonly TelegramPlayer[]): LeakRules {
  return {
    ids: players.map((p) => p.user.id),
    secrets: [
      TEST_BOT_TOKEN,
      ...players.flatMap((p) => [
        p.user.username as string,
        p.user.last_name as string,
        p.user.photo_url as string,
      ]),
    ],
    names: new Set(players.map((p) => p.user.first_name)),
  };
}

// eslint-disable-next-line no-empty-pattern -- Playwright reads the fixtures from this pattern
test.beforeEach(({}, testInfo) => {
  test.skip(!testInfo.project.name.endsWith('phone-390x844'), 'one phone size per browser');
});

test('the checker is not blind', () => {
  const rules: LeakRules = { ids: [123456789], secrets: ['ann_tg'], names: new Set(['Ann']) };
  const seat = {
    dealtIn: true,
    stack: 1,
    hole: [0, 1],
    folded: false,
    allIn: false,
    streetBet: 0,
    totalBet: 0,
  };
  const hand = { ...HAND_FIELDS, seats: [seat, { ...seat, hole: null }], revealed: [] as number[] };
  const view = { you: 1, hand, legal: null, decision: null, seats: [{ name: 'Ann' }, null] };
  const frame = (patch: object) => JSON.stringify({ t: 'table', view: { ...view, ...patch } });

  expect(leakProblems(frame({}), rules)).toEqual([
    expect.stringMatching(/^L2: the hidden cards of seat 0/),
  ]);
  expect(leakProblems(frame({ deck: [1] }), rules)[0]).toMatch(/L3\/L5: key "deck"/);
  expect(leakProblems(frame({ seed: 'x' }), rules)[0]).toMatch(/L3\/L5: key "seed"/);
  expect(
    leakProblems(JSON.stringify({ t: 'error', other: 'fedcba98fedcba98fedcba98fedcba98' }), rules),
  ).toEqual([expect.stringMatching(/^L6/)]);
  expect(leakProblems(JSON.stringify({ t: 'x', a: 123456789 }), rules)[0]).toMatch(/^L5/);
  expect(leakProblems(JSON.stringify({ t: 'x', a: 'hi ann_tg' }), rules)[0]).toMatch(/^L5/);
  expect(
    leakProblems(frame({ legal: { seat: 0 } }), { ...rules, secrets: [] }).some((p) =>
      p.startsWith('L4'),
    ),
  ).toBe(true);
  expect(
    leakProblems(frame({ seats: [{ name: 'Evil' }, null] }), { ...rules, secrets: [] }).some((p) =>
      p.startsWith('L5'),
    ),
  ).toBe(true);
});

test('three browsers: L1–L6 on every real frame, over a showdown, folds, a run-out, a reload and a reconnect', async ({
  telegram,
}) => {
  test.setTimeout(240_000);
  const ann = await telegram.open(newTelegramUser('Ann'));
  const code = await createTable(ann, { seats: 3, stakes: 'quick', turnSeconds: 60 });
  const bob = await telegram.open(newTelegramUser('Bob'), { startParam: code });
  const carol = await telegram.open(newTelegramUser('Carol'), { startParam: code });
  await expect(ann.page.getByRole('button', { name: 'Start game' })).toBeEnabled();
  const all = [ann, bob, carol];
  await startGame(ann, all);

  // All in first, while all three have the same stack: the cards run out to a showdown, and
  // whoever lost has no chips and gets a free reload. Only a chopped pot leaves nobody busted.
  let reloads = 0;
  for (let hands = 0; hands < 6 && reloads === 0; hands++) {
    let shoved = false;
    const runout = await playHand(all, () => {
      if (shoved) return 'checkOrCall';
      shoved = true;
      return 'allIn';
    });
    await Promise.all(all.map((p) => waitForHandEnd(p.page, runout)));
    expect((await pcView(ann.page))?.hand?.runout).toBe(true);
    for (const player of all) {
      const view = await pcView(player.page);
      if (view?.seats[view.you]?.status !== 'busted') continue;
      reloads++;
      const dialog = player.page.getByRole('alertdialog');
      await dialog.getByRole('button', { name: 'Get 1,000 chips' }).click();
      await expect(dialog).toHaveCount(0);
    }
    await waitForHand(ann.page, runout);
  }
  expect(reloads).toBeGreaterThan(0);

  // A showdown.
  const showdown = await playHand(all, () => 'checkOrCall');
  await Promise.all(all.map((p) => waitForHandEnd(p.page, showdown)));
  const reachedShowdown = await pcView(ann.page);
  expect(reachedShowdown?.hand?.result?.endedBy).toBe('showdown');
  expect(reachedShowdown?.hand?.revealed).toHaveLength(3);

  // Folds: nobody's cards are shown, and the next hand comes.
  await waitForHand(ann.page, showdown);
  const folds = await playHand(all, () => 'fold');
  await Promise.all(all.map((p) => waitForHandEnd(p.page, folds)));
  expect((await pcView(bob.page))?.hand?.revealed).toEqual([]);
  await waitForHand(ann.page, folds);

  // A reconnect in the middle of a hand: Carol's app comes back with her own cards and no others'.
  await carol.page.reload();
  await waitForTable(carol.page);
  await carol.page.waitForFunction(() => window.__pc?.state().game.hand !== null);
  expect(carol.sockets.length).toBe(2);
  const running = await playHand(all, () => 'fold');
  await Promise.all(all.map((p) => waitForHandEnd(p.page, running)));
  await waitForHand(ann.page, running);

  // Now every frame that came in, for each browser.
  const rules = rulesFor(all);
  let frames = 0;
  for (const player of all) {
    const received = toClient(player.frames);
    expect(received.length).toBeGreaterThan(10);
    for (const text of received) {
      frames++;
      expect(leakProblems(text, rules), `${player.user.first_name}: ${text}`).toEqual([]);
    }

    // Own cards on every hand dealt to this seat, somebody else's only when they were turned up.
    const views = tables(player.frames);
    expect(views.some((v) => v.hand?.seats[v.you]?.hole != null)).toBe(true);

    // §19.9: `initData` goes in the `hello` frame only, and never in a URL.
    const sent = player.frames.filter((f) => f.to === 'server').map((f) => f.text);
    expect(sent.filter((text) => text.includes('auth_date')).length).toBe(player.sockets.length);
    for (const url of player.sockets) expect(new URL(url).search).toBe('');
    const firstSent = JSON.parse(sent[0] as string) as { t: string };
    expect(firstSent.t).toBe('hello');
  }
  expect(frames).toBeGreaterThan(30);

  // A seat the showdown turned up was seen by the others; a folded one never.
  const shown = tables(bob.frames).filter((v) => v.hand?.result?.endedBy === 'showdown');
  expect(shown.some((v) => v.hand?.seats[(v.you + 1) % 3]?.hole != null)).toBe(true);
  for (const player of all) expect(player.errors).toEqual([]);
});
