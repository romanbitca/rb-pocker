import { expect, test, type TelegramPlayer } from './fixtures.ts';
import { nextFlowPoint, pcState, tapNextHand } from './game.ts';
import {
  createTable,
  expectToast,
  fillCreateForm,
  leaveTableFromMenu,
  mpHeading,
  mpState,
  ownCards,
  pcView,
  playHand,
  relaunch,
  seatCards,
  shareInvite,
  startGame,
  waitForHand,
  waitForHandEnd,
  waitForRoom,
  waitForTable,
  waitForTurn,
  type NewTable,
} from './mpPlay.ts';
import { newTelegramUser, TEST_APP_SHORT_NAME, TEST_BOT_USERNAME } from './telegram.ts';

/**
 * PLAN §18 Stage 10, acceptance 13 (and 10: the same-origin WebSocket under the real CSP): the
 * flows of Play with friends, with real browsers against the real server. The server's clock is
 * real, so the turns are short only where a test waits them out.
 */

test.use({ multiplayer: true });

// eslint-disable-next-line no-empty-pattern -- Playwright reads the fixtures from this pattern
test.beforeEach(({}, testInfo) => {
  test.skip(!testInfo.project.name.endsWith('phone-390x844'), 'one phone size per browser');
});

/** A long turn: nobody times out unless a test waits on purpose. */
const LONG_TURNS: NewTable = { seats: 3, stakes: 'quick', turnSeconds: 60 };

/** The app's own console and its uncaught errors must stay empty. */
function expectNoErrors(players: readonly TelegramPlayer[]): void {
  for (const player of players) expect(player.errors, player.user.first_name).toEqual([]);
}

/** A card's name without what the result adds to it ("…, part of the winning hand"). */
const cardNames = async (cards: Promise<(string | null)[]>): Promise<string[]> =>
  (await cards).map((name) => (name ?? '').split(',')[0] as string);

/** Everyone sees two cards of their own, face up, and backs on every other seat of the hand. */
async function expectOwnCardsAndBacks(
  players: readonly TelegramPlayer[],
  otherSeats: number,
): Promise<void> {
  const own: (string | null)[] = [];
  for (const player of players) {
    await expect(player.page.locator('[data-hero-cards] [role="img"]')).toHaveCount(2, {
      timeout: 15_000,
    });
    const cards = await ownCards(player.page);
    expect(cards).not.toContain('Hidden card');
    own.push(...cards);
    for (let seat = 1; seat <= otherSeats; seat++) {
      await expect
        .poll(() => seatCards(player.page, seat), { timeout: 15_000 })
        .toEqual(['Hidden card', 'Hidden card']);
    }
  }
  expect(new Set(own).size, "nobody holds anybody else's cards").toBe(own.length);
}

async function leaveWaitingRoom(player: TelegramPlayer): Promise<void> {
  await player.page.getByRole('button', { name: 'Leave table' }).click();
  await player.page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Leave table', exact: true })
    .click();
  await expect(player.page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
}

/**
 * After a reload: the app has started again, and the driver has decided (it runs right after the
 * shell says `web_app_ready`), and it stayed where a player without a table is.
 */
async function expectStayedHome(player: TelegramPlayer): Promise<void> {
  await expect
    .poll(async () => (await player.events()).some((e) => e.type === 'web_app_ready'))
    .toBe(true);
  await expect(player.page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  expect(['home', 'welcome']).toContain((await pcState(player.page)).ui.screen);
  await player.page.waitForTimeout(300); // what a socket opened by then would have told us
}

/** The player the first turn of the hand belongs to. */
async function waitForFirstOnTurn(players: readonly TelegramPlayer[]): Promise<TelegramPlayer> {
  let found: TelegramPlayer | undefined;
  await expect
    .poll(
      async () => {
        const states = await Promise.all(players.map((p) => mpState(p.page)));
        found = players[states.findIndex((s) => s.turn)];
        return found?.user.first_name ?? null;
      },
      { timeout: 30_000, intervals: [50, 100] },
    )
    .not.toBeNull();
  return found as TelegramPlayer;
}

test('three friends sit down from an invite and play a showdown, a fold and the next hand', async ({
  telegram,
}) => {
  test.setTimeout(180_000);
  const ann = await telegram.open(newTelegramUser('Ann'));
  const code = await createTable(ann, LONG_TURNS);

  // Alone at the table: the host cannot start yet.
  await expect(ann.page.getByRole('button', { name: 'Start game' })).toBeDisabled();
  await expect(ann.page.getByText('You need at least 2 players.')).toBeVisible();
  await expect(ann.page.getByText('Send this link to your friends.')).toBeVisible();

  // The link goes to Telegram's share list; a friend's tap opens the Mini App with its code.
  const invite = await shareInvite(ann);
  expect(invite.code).toBe(code);
  expect(invite.link).toBe(
    `https://t.me/${TEST_BOT_USERNAME}/${TEST_APP_SHORT_NAME}?startapp=${code}`,
  );

  const bob = await telegram.open(newTelegramUser('Bob'), { startParam: invite.code });
  await expect(mpHeading(bob.page)).toHaveText(`Table ${code}`);
  await expect(bob.page.getByText('Waiting for Ann to start the game.')).toBeVisible();
  await expect(bob.page.getByRole('button', { name: 'Start game' })).toHaveCount(0);
  await expectToast(ann.page, 'Bob joined the table.');
  await expect(ann.page.getByRole('button', { name: 'Start game' })).toBeEnabled();

  const carol = await telegram.open(newTelegramUser('Carol'), { startParam: invite.code });
  await expect(mpHeading(carol.page)).toHaveText(`Table ${code}`);
  await expectToast(bob.page, 'Carol joined the table.');

  const all = [ann, bob, carol];
  await startGame(ann, all);
  await expectOwnCardsAndBacks(all, 2);
  // Whose turn it is, and the seconds, in the coach's place; no coach.
  for (const player of all) {
    await expect(player.page.locator('[data-turn]')).toHaveAttribute('data-turn', /^(you|other)$/);
    await expect(player.page.locator('[data-turn]')).toContainText(/\d+ s$/);
    await expect(player.page.locator('[data-coach-advice]')).toHaveCount(0);
  }

  // A hand to the showdown: every live hand is turned up, for everybody.
  const showdown = await playHand(all, () => 'checkOrCall');
  await Promise.all(all.map((player) => waitForHandEnd(player.page, showdown)));
  const shown = await Promise.all(all.map((player) => cardNames(ownCards(player.page))));
  // The seats are clockwise from each viewer, so Ann's seat 1 is Bob, and Bob's seat 2 is Ann.
  await Promise.all([
    expect.poll(() => cardNames(seatCards(ann.page, 1))).toEqual(shown[1]),
    expect.poll(() => cardNames(seatCards(ann.page, 2))).toEqual(shown[2]),
    expect.poll(() => cardNames(seatCards(bob.page, 1))).toEqual(shown[2]),
    expect.poll(() => cardNames(seatCards(bob.page, 2))).toEqual(shown[0]),
    expect.poll(() => cardNames(seatCards(carol.page, 1))).toEqual(shown[0]),
    expect.poll(() => cardNames(seatCards(carol.page, 2))).toEqual(shown[1]),
  ]);
  await expect(ann.page.locator('[data-turn="nextHand"]')).toContainText(/^Next hand in \d+ s$/);
  await expect(ann.page.locator('[data-hand-end]')).toHaveCount(0); // nobody taps for the next hand
  // These tables have no Review, no summary, and nothing goes to the Stats (§19.6, §19.10).
  await expect(ann.page.getByRole('button', { name: 'Review this hand' })).toHaveCount(0);
  await expect(ann.page.locator('[data-hand-summary]')).toHaveCount(0);

  // The next hand comes by itself; everybody folds to the big blind.
  const second = await waitForHand(ann.page, showdown);
  expect(second).toBe(showdown + 1);
  await expectOwnCardsAndBacks(all, 2);
  const folds = await playHand(all, () => 'fold');
  await Promise.all(all.map((player) => waitForHandEnd(player.page, folds)));
  // Won by folds: the winner's cards and the folded cards stay secret.
  for (const player of all) {
    await expect.poll(() => seatCards(player.page, 1).then((c) => c.join())).not.toContain(' of ');
    await expect.poll(() => seatCards(player.page, 2).then((c) => c.join())).not.toContain(' of ');
  }

  // And on again: a raise through the sizing tray, one fold, one call, and a showdown of two.
  await waitForHand(bob.page, folds);
  await expectOwnCardsAndBacks(all, 2);
  const decisions: string[] = [];
  const raised = await playHand(all, (player) => {
    decisions.push(player.user.first_name);
    if (decisions.length === 1) return 'raise';
    return decisions.length === 2 ? 'fold' : 'checkOrCall';
  });
  await Promise.all(all.map((player) => waitForHandEnd(player.page, raised)));
  const folder = all.find((player) => player.user.first_name === decisions[1]) as TelegramPlayer;
  const stayed = all.filter((player) => player !== folder);
  const result = await pcView(ann.page);
  expect(result?.hand?.result?.endedBy).toBe('showdown');
  expect(result?.hand?.revealed).toHaveLength(2);
  // Those two see each other's cards; nobody sees the folded ones.
  for (const player of stayed) {
    const other = stayed.find((p) => p !== player) as TelegramPlayer;
    const pod = player.page.locator('[data-seat]').filter({ hasText: other.user.first_name });
    await expect(pod.locator('[role="img"]').first()).not.toHaveAttribute(
      'aria-label',
      'Hidden card',
    );
    const hidden = player.page.locator('[data-seat]').filter({ hasText: folder.user.first_name });
    await expect(hidden.locator('[role="img"][aria-label*=" of "]')).toHaveCount(0);
  }
  expectNoErrors(all);
  const { stats } = await pcState(ann.page);
  expect((stats?.results.clean.hands ?? 0) + (stats?.results.practice.hands ?? 0)).toBe(0);

  // The same-origin socket under the real CSP (Stage 10 acceptance 10), once per player. A page
  // that the policy had stopped from opening it would have logged that, and never reached a table.
  const response = await ann.page.request.get('/');
  expect(response.headers()['content-security-policy']).toContain("connect-src 'self'");
  expect(response.headers()['content-security-policy']).not.toContain('wss:');
  for (const player of all) {
    expect(player.sockets).toEqual([new URL('/api/mp/ws', ann.socketOrigin).href]);
  }
});

test('a friend who joins during a hand gets cards from the next hand', async ({ telegram }) => {
  test.setTimeout(120_000);
  const ann = await telegram.open(newTelegramUser('Ann'));
  const code = await createTable(ann, LONG_TURNS);
  const bob = await telegram.open(newTelegramUser('Bob'), { startParam: code });
  await expect(ann.page.getByRole('button', { name: 'Start game' })).toBeEnabled();
  const both = [ann, bob];
  await startGame(ann, both);
  await expectOwnCardsAndBacks(both, 1);

  // Telegram's names are in any script: the signature, the frames and the Table all carry it.
  const name = 'Лена 🎲';
  const carol = await telegram.open(newTelegramUser(name), { startParam: code });
  await waitForTable(carol.page);
  await expect(carol.page.locator('[data-turn="notDealtIn"]')).toHaveText(
    'You get cards in the next hand.',
  );
  await expect(carol.page.locator('[data-hero-cards] [role="img"]')).toHaveCount(0);
  await expectToast(ann.page, `${name} joined the table.`);
  await expect(ann.page.locator('[data-seat]').filter({ hasText: name })).toContainText('Next');

  const hand = await playHand(both, () => 'fold');
  const next = await waitForHand(carol.page, hand);
  await expect(carol.page.locator('[data-hero-cards] [role="img"]')).toHaveCount(2);
  const all = [ann, bob, carol];
  await expectOwnCardsAndBacks(all, 2);
  expect(next).toBe(hand + 1);
  expectNoErrors(all);
});

test('a 15-second table: the clock plays a turn, two in a row sit you out, "I\'m back"', async ({
  telegram,
}) => {
  test.setTimeout(180_000);
  const ann = await telegram.open(newTelegramUser('Ann'));
  const code = await createTable(ann, { seats: 2, stakes: 'quick', turnSeconds: 15 });
  const bob = await telegram.open(newTelegramUser('Bob'), { startParam: code });
  await expect(ann.page.getByRole('button', { name: 'Start game' })).toBeEnabled();
  const both = [ann, bob];
  await startGame(ann, both);

  // Heads-up the button is first to act; it does nothing, and the clock folds it.
  const slow = await waitForFirstOnTurn(both);
  const other = both.find((player) => player !== slow) as TelegramPlayer;
  await expect(slow.page.locator('[data-turn="you"]')).toContainText('Your turn');
  await expect(other.page.locator('[data-turn="other"]')).toContainText(
    `${slow.user.first_name} is thinking`,
  );
  await expectToast(slow.page, 'Your time ran out. You folded.');
  const first = (await mpState(slow.page)).handSeq as number;
  await waitForHand(slow.page, first);

  // The second hand: the other player calls, and the slow one's free check runs out too.
  await waitForTurn(other.page);
  await playHand(both, (player) => (player === other ? 'checkOrCall' : 'none'));
  const sittingOut = slow.page.getByRole('main').getByText('You are sitting out.');
  await expect(sittingOut).toBeVisible({ timeout: 30_000 });

  // Heads-up there is nobody left to deal with, so both wait. The way back must be there too.
  await waitForRoom(slow.page);
  await expect(sittingOut).toBeVisible();
  await slow.page.getByRole('button', { name: "I'm back" }).click();
  await waitForTable(slow.page);
  await waitForTable(other.page);
  await expect(sittingOut).toHaveCount(0);
  await expect(slow.page.locator('[data-hero-cards] [role="img"]')).toHaveCount(2);
  // The second time the free check ran out too, and all this time one socket did the talking.
  await expectToast(slow.page, 'Your time ran out. You checked.');
  for (const player of both) expect(player.sockets).toHaveLength(1);
  expectNoErrors(both);
});

test('a player who runs out of chips gets a free reload and plays on', async ({ telegram }) => {
  test.setTimeout(180_000);
  const ann = await telegram.open(newTelegramUser('Ann'));
  const code = await createTable(ann, { seats: 2, stakes: 'quick', turnSeconds: 60 });
  const bob = await telegram.open(newTelegramUser('Bob'), { startParam: code });
  await expect(ann.page.getByRole('button', { name: 'Start game' })).toBeEnabled();
  const both = [ann, bob];
  await startGame(ann, both);

  let busted: TelegramPlayer | null = null;
  for (let hands = 0; hands < 6 && busted === null; hands++) {
    let shoved = false;
    const hand = await playHand(both, () => {
      if (shoved) return 'checkOrCall';
      shoved = true;
      return 'allIn';
    });
    await Promise.all(both.map((player) => waitForHandEnd(player.page, hand)));
    for (const player of both) {
      const view = await pcView(player.page);
      if (view?.seats[view.you]?.status === 'busted') busted = player;
    }
    if (busted === null) await waitForHand(ann.page, hand);
  }
  expect(busted, 'someone lost all their chips').not.toBeNull();
  const loser = busted as unknown as TelegramPlayer;
  const winner = both.find((player) => player !== loser) as TelegramPlayer;

  const dialog = loser.page.getByRole('alertdialog');
  await expect(dialog).toContainText("You are out of chips. That's okay: chips are free here.");
  await expect(dialog.getByRole('button', { name: 'Leave table' })).toBeVisible();

  // The hand on show ends, and with nobody else to play the table waits, dialog on top.
  await waitForRoom(winner.page);
  await expect(winner.page.getByText('Waiting for more players.')).toBeVisible();
  await expect(dialog).toBeVisible();

  await dialog.getByRole('button', { name: 'Get 1,000 chips' }).click();
  await expect(dialog).toHaveCount(0);
  await Promise.all(both.map((player) => waitForTable(player.page)));
  await expect(loser.page.locator('[data-hero-cards] [role="img"]')).toHaveCount(2);
  const view = await pcView(loser.page);
  expect(view?.status).toBe('playing');
  expectNoErrors(both);
});

test('leaving: the waiting room, the middle of a hand, a table that goes on with new players', async ({
  telegram,
}) => {
  test.setTimeout(180_000);
  const ann = await telegram.open(newTelegramUser('Ann'));
  const code = await createTable(ann, LONG_TURNS);
  const bob = await telegram.open(newTelegramUser('Bob'), { startParam: code });
  const carol = await telegram.open(newTelegramUser('Carol'), { startParam: code });
  await expect(ann.page.getByRole('button', { name: 'Start game' })).toBeEnabled();

  // The waiting room's own button.
  await leaveWaitingRoom(carol);
  await expectToast(ann.page, 'Carol left the table.');
  await expect(ann.page.getByText('Empty seat').first()).toBeVisible();

  const both = [ann, bob];
  await startGame(ann, both);

  // The host leaves in the middle of a hand: Bob is told who left, and wins it.
  await leaveTableFromMenu(ann.page);
  await expectToast(bob.page, 'Ann left the table.');

  // Alone at a table that has started: Bob waits for more players, and the host's seat is his.
  await waitForRoom(bob.page);
  await expect(bob.page.getByText('Waiting for more players.')).toBeVisible();
  const view = await pcView(bob.page);
  expect(view?.seats[view.you]?.host).toBe(true);

  // A friend taps the invite again, and the table goes on by itself.
  await relaunch(carol, { startParam: code });
  await waitForTable(carol.page);
  await waitForTable(bob.page);
  await expect(carol.page.locator('[data-hero-cards] [role="img"]')).toHaveCount(2);
  await leaveTableFromMenu(bob.page);
  await waitForRoom(carol.page);
  await leaveWaitingRoom(carol);

  // Gone means gone: nothing is remembered, so a later launch of the app makes no connection.
  const before = ann.sockets.length;
  await ann.page.reload();
  await expect(ann.page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  expect(ann.sockets.length).toBe(before);
  expectNoErrors([ann, bob, carol]);
});

test('an invite is used once: a reload after leaving stays Home, a new tap joins again', async ({
  telegram,
}) => {
  test.setTimeout(120_000);
  const ann = await telegram.open(newTelegramUser('Ann'));
  const code = await createTable(ann, LONG_TURNS);

  const bob = await telegram.open(newTelegramUser('Bob'), { startParam: code });
  await expect(bob.page.getByText('Waiting for Ann to start the game.')).toBeVisible();
  await leaveWaitingRoom(bob);
  await expectToast(ann.page, 'Bob left the table.');

  // The reload keeps the launch and its code in the URL: the code has done its job.
  const seen = bob.sockets.length;
  await bob.page.reload();
  await expectStayedHome(bob);
  expect(bob.sockets.length).toBe(seen);
  await expect(ann.page.getByText('Empty seat')).toHaveCount(2);

  // A new tap on the same link is a new launch, and it joins.
  await relaunch(bob, { startParam: code });
  await expect(mpHeading(bob.page)).toHaveText(`Table ${code}`);
  await expectToast(ann.page, 'Bob joined the table.');
  expect(bob.sockets.length).toBe(seen + 1);

  // While seated, a reload is no new join: the remembered table brings him back.
  await bob.page.reload();
  await expect(mpHeading(bob.page)).toHaveText(`Table ${code}`);
  await expect(ann.page.getByText('Empty seat')).toHaveCount(1);

  // Back from "Joining the table…" (here nobody answers) gives the code up too.
  const carol = await telegram.open(newTelegramUser('Carol'), {
    startParam: code,
    prepare: (context) => context.routeWebSocket(/\/api\/mp\/ws$/, () => {}),
  });
  await expect(mpHeading(carol.page)).toHaveText('Joining the table…');
  await carol.page.getByRole('button', { name: 'Back' }).first().click();
  await expect(carol.page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  const before = carol.sockets.length;
  await carol.page.reload();
  await expectStayedHome(carol);
  expect(carol.sockets.length).toBe(before);
  expectNoErrors([ann, bob, carol]);
});

test('the host leaves before the start: the next seat is the host, and the link still works', async ({
  telegram,
  browserName,
}) => {
  test.setTimeout(90_000);
  const ann = await telegram.open(newTelegramUser('Ann'));
  const code = await createTable(ann, LONG_TURNS);

  // "Copy link" and its answer. Chromium needs the permission; WebKit's automation has no clipboard.
  if (browserName === 'chromium') {
    await ann.context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await ann.page.getByRole('button', { name: 'Copy link' }).click();
    await expect(ann.page.getByText('Link copied.')).toBeVisible();
    expect(await ann.page.evaluate(() => navigator.clipboard.readText())).toBe(
      `https://t.me/${TEST_BOT_USERNAME}/${TEST_APP_SHORT_NAME}?startapp=${code}`,
    );
  }

  const bob = await telegram.open(newTelegramUser('Bob'), { startParam: code });
  await expect(bob.page.getByText('Waiting for Ann to start the game.')).toBeVisible();
  await leaveWaitingRoom(ann);
  await expect(bob.page.getByRole('button', { name: 'Start game' })).toBeDisabled();
  await expectToast(bob.page, 'Bob is now the host.');

  const carol = await telegram.open(newTelegramUser('Carol'), { startParam: code });
  await expect(carol.page.getByText('Waiting for Bob to start the game.')).toBeVisible();
  await expect(bob.page.getByRole('button', { name: 'Start game' })).toBeEnabled();
  await startGame(bob, [bob, carol]);

  // Whoever left is free: Ann makes a new table, in the same app, with no reload.
  const next = await createTable(ann, { ...LONG_TURNS, seats: 2 });
  expect(next).not.toBe(code);
  expectNoErrors([ann, bob, carol]);
});

test('an invite that cannot be used: a full table, and a table that is gone', async ({
  telegram,
}) => {
  test.setTimeout(90_000);
  const ann = await telegram.open(newTelegramUser('Ann'));
  const code = await createTable(ann, { seats: 2, stakes: 'quick', turnSeconds: 60 });
  const bob = await telegram.open(newTelegramUser('Bob'), { startParam: code });
  await expectToast(ann.page, 'Bob joined the table.');

  const carol = await telegram.open(newTelegramUser('Carol'), { startParam: code });
  const dialog = carol.page.getByRole('alertdialog');
  await expect(dialog).toContainText('This table is full.');
  await dialog.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(carol.page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();

  await relaunch(carol, { startParam: 'ZZZZ9999' });
  await expect(dialog).toContainText('This table is gone.');
  await dialog.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(carol.page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  expectNoErrors([ann, bob, carol]);
});

test("Back at a table asks first, the phone's and Telegram's, and Telegram knows a table is on", async ({
  telegram,
}) => {
  test.setTimeout(90_000);
  const ann = await telegram.open(newTelegramUser('Ann'));
  const code = await createTable(ann, LONG_TURNS);
  const bob = await telegram.open(newTelegramUser('Bob'), { startParam: code });
  await expect(ann.page.getByRole('button', { name: 'Start game' })).toBeEnabled();
  await startGame(ann, [ann, bob]);
  const { page } = ann;
  const dialog = page.getByRole('alertdialog');

  await page.goBack();
  await expect(dialog).toContainText('Leave this table?');
  await dialog.getByRole('button', { name: 'Stay', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await waitForTable(page);

  // Telegram's own Back button, shown because the app asked for it.
  await expect
    .poll(async () => (await ann.events()).findLast((e) => e.type === 'web_app_setup_back_button'))
    .toEqual({ type: 'web_app_setup_back_button', data: { is_visible: true } });
  await page.evaluate(() => {
    (
      window as unknown as { Telegram: { WebView: { receiveEvent(type: string): void } } }
    ).Telegram.WebView.receiveEvent('back_button_pressed');
  });
  await expect(dialog).toContainText('Leave this table?');
  await dialog.getByRole('button', { name: 'Stay', exact: true }).click();

  // While a table is on, Telegram asks before it closes the Mini App (§19.7); then it stops asking.
  // At the Table a swipe down must not drag the sheet (the sizing slider); a turn taps the phone.
  const last = async (type: string): Promise<unknown> =>
    (await ann.events()).findLast((e) => e.type === type)?.data;
  await expect
    .poll(() => last('web_app_setup_closing_behavior'))
    .toEqual({ need_confirmation: true });
  await expect
    .poll(() => last('web_app_setup_swipe_behavior'))
    .toEqual({ allow_vertical_swipe: false });
  await playHand([ann, bob], () => 'checkOrCall');
  await expect.poll(() => last('web_app_trigger_haptic_feedback')).toBeDefined();
  await leaveTableFromMenu(page);
  await expect
    .poll(() => last('web_app_setup_closing_behavior'))
    .toEqual({ need_confirmation: false });
  await expect
    .poll(() => last('web_app_setup_swipe_behavior'))
    .toEqual({ allow_vertical_swipe: true });
  expectNoErrors([ann, bob]);
});

test('Back from "New table" closes the socket; Play with friends opens a new one', async ({
  telegram,
}) => {
  test.setTimeout(60_000);
  const ann = await telegram.open(newTelegramUser('Ann'));
  const { page } = ann;
  const friends = page.getByRole('button', { name: 'Play with friends', exact: true });
  expect(ann.sockets).toEqual([]); // nothing until it is asked for

  const opened = page.waitForEvent('websocket');
  await friends.click();
  await expect(mpHeading(page)).toHaveText('New table');
  const socket = await opened;
  expect(socket.isClosed()).toBe(false);

  await page.getByRole('button', { name: 'Back' }).first().click();
  await expect(friends).toBeVisible();
  await expect.poll(() => socket.isClosed()).toBe(true);

  await friends.click();
  await expect(mpHeading(page)).toHaveText('New table');
  await expect.poll(() => ann.sockets.length).toBe(2);
  expectNoErrors([ann]);
});

test('the bot\'s "New table" button opens the Create screen, connected', async ({ telegram }) => {
  test.setTimeout(60_000);
  const ann = await telegram.open(newTelegramUser('Ann'), { startParam: 'new' });
  await expect(mpHeading(ann.page)).toHaveText('New table');
  await expect.poll(() => ann.sockets.length).toBe(1);
  expectNoErrors([ann]);
});

test('a launch that Telegram signed too long ago: the player is told, and plays on alone', async ({
  telegram,
}) => {
  test.setTimeout(60_000);
  const ann = await telegram.open(newTelegramUser('Ann'), {
    authDate: Math.floor(Date.now() / 1000) - 25 * 3600,
  });
  await ann.page.getByRole('button', { name: 'Play with friends', exact: true }).click();
  const dialog = ann.page.getByRole('alertdialog');
  await expect(dialog).toContainText(
    'We could not check your Telegram login. Please close the game and open it again.',
  );
  await dialog.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(ann.page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  expect(ann.errors.filter((line) => !/WebSocket/i.test(line))).toEqual([]);
});

test('a local hand in progress stands still during a table with friends, and comes back', async ({
  telegram,
}) => {
  test.setTimeout(120_000);
  const ann = await telegram.open(newTelegramUser('Ann'));
  const { page } = ann;
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(() => window.__pc?.state().ui.screen === 'table');
  while ((await nextFlowPoint(page)) !== 'hero') await tapNextHand(page);
  const localHand = () => page.evaluate(() => JSON.stringify(window.__pc?.state().game.hand));
  const before = await localHand();

  await page.goBack();
  const friends = page.getByRole('button', { name: 'Play with friends', exact: true });
  await friends.click();
  const code = await fillCreateForm(page, { seats: 2, stakes: 'quick', turnSeconds: 60 });
  const bob = await telegram.open(newTelegramUser('Bob'), { startParam: code });
  await expect(page.getByRole('button', { name: 'Start game' })).toBeEnabled();
  await startGame(ann, [ann, bob]);
  expect(await localHand()).not.toBe(before); // the Table shows the friends' hand
  await leaveTableFromMenu(page);

  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(() => {
    const s = window.__pc?.state();
    return s?.ui.screen === 'table' && s.game.mode === 'heroTurn';
  });
  expect(await localHand()).toBe(before);
  expect((await pcView(page))?.code ?? null).toBeNull();
  expectNoErrors([ann, bob]);
});

test.describe('a first launch, with the tips of the local table on', () => {
  test.use({ firstTableTips: true });

  test('the first-table tips stay away from a table with friends', async ({ telegram }) => {
    test.setTimeout(120_000);
    const ann = await telegram.open(newTelegramUser('Ann'));
    const code = await createTable(ann, LONG_TURNS);
    const bob = await telegram.open(newTelegramUser('Bob'), { startParam: code });
    await expect(ann.page.getByRole('button', { name: 'Start game' })).toBeEnabled();
    const both = [ann, bob];
    await startGame(ann, both);
    const hand = await playHand(both, () => 'checkOrCall');
    for (const player of both) {
      await waitForHandEnd(player.page, hand);
      expect((await pcState(player.page)).ui.tip).toBeNull();
      await expect(player.page.locator('[data-tip]')).toHaveCount(0);
    }
    expectNoErrors(both);
  });
});
