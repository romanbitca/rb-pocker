/**
 * A bot's own level through the controller (PLAN §9.3, §10, §12.2, chunk 7.2): picked on its card
 * (`seatLevel`) or in Setup (`newTable` with `seatLevels`), kept with the settings (saved 250 ms
 * later), and followed by the table from the next hand only. The hand in play keeps the table it
 * was dealt from, a seated bot keeps its name, personality and stack, and every hand records the
 * levels in force, per seat.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TIMING } from '../../src/app/controller.ts';
import { levelsOf, seatView } from '../../src/app/store.ts';
import { InvariantError } from '../../src/core/assert.ts';
import { step } from '../../src/engine/step.ts';
import { PERSONALITY_LISTS } from '../../src/engine/table.ts';
import type {
  BotLevel,
  HandState,
  LegalActions,
  PlayerAction,
  TableState,
} from '../../src/engine/types.ts';
import type { SessionState } from '../../src/persist/schema.ts';
import { createSafeStorage, STORAGE_KEYS } from '../../src/persist/storage.ts';
import { FakeStorage } from '../persist/fakeStorage.ts';
import { drive, makeHarness, spyBrain, tick, type Harness } from './harness.ts';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const passive = (legal: LegalActions): PlayerAction =>
  legal.canCheck ? { type: 'check' } : { type: 'call' };

const table = (h: Harness): TableState => h.state().game.table as TableState;
const hand = (h: Harness): HandState => h.state().game.hand as HandState;
const own = (h: Harness): (BotLevel | null)[] => table(h).config.seatLevels;

/** A launch over the same stored data: a new store and controller. */
function launch(backend: FakeStorage): Harness {
  return makeHarness({ storage: createSafeStorage(() => backend) });
}

const storedSettings = (backend: FakeStorage): Record<string, unknown> =>
  (JSON.parse(backend.data.get(STORAGE_KEYS.profile) as string) as { settings: never }).settings;
const storedSession = (backend: FakeStorage): SessionState =>
  JSON.parse(backend.data.get(STORAGE_KEYS.session) as string) as SessionState;

/** Every brain request of a hand, with the level its profile id names (`<personality>/<level>`). */
function requestsOf(brain: ReturnType<typeof spyBrain>, handSeq: number) {
  return brain.requests
    .filter((req) => req.obs.handSeq === handSeq)
    .map((req) => ({
      seat: req.obs.seat,
      level: req.profile.id.split('/')[1] as BotLevel,
      levels: req.obs.seatLevels,
      visible: req.obs.visiblePersonality,
    }));
}

describe('the pick: kept with the settings, the table in play untouched (§9.3, §10)', () => {
  it('is in the settings at once and in storage 250 ms later; the hand keeps its table', async () => {
    const backend = new FakeStorage();
    const h = launch(backend);
    h.dispatch({ type: 'play' });
    const before = table(h);
    h.dispatch({ type: 'seatLevel', seat: 2, level: 'expert' });
    expect(h.state().settings.seatLevels).toEqual([null, null, 'expert', null, null, null]);
    expect(h.state().settings.botLevel).toBe('easy');
    expect(table(h)).toBe(before);
    expect(own(h)).toEqual([null, null, null, null, null, null]);
    expect(storedSettings(backend).seatLevels).toEqual([null, null, null, null, null, null]);
    await vi.advanceTimersByTimeAsync(TIMING.settingsDebounceMs);
    expect(storedSettings(backend).seatLevels).toEqual([null, null, 'expert', null, null, null]);
    expect(h.controller.logs().errors).toEqual([]);
  });

  it('adds up: several seats, and a seat can be changed again', () => {
    const h = makeHarness();
    h.dispatch({ type: 'play' });
    h.dispatch({ type: 'seatLevel', seat: 1, level: 'hard' });
    h.dispatch({ type: 'seatLevel', seat: 4, level: 'medium' });
    h.dispatch({ type: 'seatLevel', seat: 1, level: 'expert' });
    expect(h.state().settings.seatLevels).toEqual([null, 'expert', null, null, 'medium', null]);
  });

  it('a pick that changes nothing leaves the settings object as it is', () => {
    const h = makeHarness();
    h.dispatch({ type: 'play' });
    h.dispatch({ type: 'seatLevel', seat: 3, level: 'hard' });
    const settings = h.state().settings;
    h.dispatch({ type: 'seatLevel', seat: 3, level: 'hard' });
    h.dispatch({ type: 'seatLevel', seat: 5, level: null });
    expect(h.state().settings).toBe(settings);
  });

  it.each<[string, unknown, unknown]>([
    ['the hero (seat 0)', 0, 'hard'],
    ['a seat below 0', -1, 'hard'],
    ['a seat past the last', 6, 'hard'],
    ['a fraction', 1.5, 'hard'],
    ['not a number', Number.NaN, 'hard'],
    ['a level that is not one', 2, 'legend'],
    ['a level as a number', 2, 3],
    ['no level (undefined)', 2, undefined],
  ])('ignores %s', (_what, seat, level) => {
    const h = makeHarness();
    h.dispatch({ type: 'play' });
    const settings = h.state().settings;
    h.dispatch({ type: 'seatLevel', seat, level } as never);
    expect(h.state().settings).toBe(settings);
    expect(h.controller.logs().errors).toEqual([]);
    expect(h.controller.logs().events.some((e) => e.what === 'seat level ignored')).toBe(true);
  });

  it('does nothing before there is a table', () => {
    const h = makeHarness();
    const settings = h.state().settings;
    h.dispatch({ type: 'seatLevel', seat: 1, level: 'hard' });
    expect(h.state().settings).toBe(settings);
  });
});

describe('from the next hand only (Stage 7 acceptance 6)', () => {
  it('not in the middle of a hand: its table, labels and profiles stay; the next hand has it', async () => {
    const brain = spyBrain();
    const h = makeHarness({ brain: brain.client });
    h.dispatch({ type: 'play' });
    const first = hand(h).handSeq;
    const seated = table(h).slots;
    h.dispatch({ type: 'seatLevel', seat: 3, level: 'expert' });

    await drive(h, { hands: 1, hero: passive });
    const firstRequests = requestsOf(brain, first);
    expect(firstRequests.length).toBeGreaterThan(0);
    for (const r of firstRequests) {
      expect(r.levels, 'the observation').toEqual(Array(6).fill('easy'));
      expect(r.level, `the profile of seat ${r.seat}`).toBe('easy');
      expect(r.visible[3], 'seat 3 still shows its personality').not.toBeNull();
    }
    expect(seatView(hand(h), table(h), 3).personality).not.toBeNull();

    await drive(h, { hands: 1, hero: passive });
    const second = hand(h).handSeq;
    expect(second).toBeGreaterThan(first);
    expect(own(h)).toEqual([null, null, null, 'expert', null, null]);
    expect(table(h).config.botLevel).toBe('easy');
    const secondRequests = requestsOf(brain, second);
    expect(secondRequests.length).toBeGreaterThan(0);
    for (const r of secondRequests) {
      expect(r.levels).toEqual(['easy', 'easy', 'easy', 'expert', 'easy', 'easy']);
      expect(r.level, `the profile of seat ${r.seat}`).toBe(r.seat === 3 ? 'expert' : 'easy');
      expect(r.visible[3], 'seat 3 hides its personality').toBeNull();
      expect(r.visible[1], 'the others keep theirs').not.toBeNull();
    }
    // The pods follow the same rule, seat by seat.
    for (const seat of [1, 2, 3, 4, 5]) {
      expect(seatView(hand(h), table(h), seat).personality !== null).toBe(seat !== 3);
    }
    // The bot kept its name, personality and stack-in-play: only its level changed.
    for (const [seat, slot] of table(h).slots.entries()) {
      const was = seated[seat];
      if (was?.playerId !== slot.playerId) continue; // busted and replaced: a new bot
      expect(slot.name).toBe(was.name);
      expect(slot.personality).toBe(was.personality);
    }
  });

  it('between two hands, in the hand-end pause: counts for the hand that follows', async () => {
    const h = makeHarness({ settings: { autoNext: false } });
    h.dispatch({ type: 'play' });
    await drive(h, { hands: 1, hero: passive });
    expect(h.state().game.mode).toBe('handEnd');
    h.dispatch({ type: 'seatLevel', seat: 2, level: 'hard' });
    // The hand that just ended, and the table prepared for the next one, are not changed yet.
    expect(own(h)).toEqual([null, null, null, null, null, null]);
    expect(h.state().game.next?.config.seatLevels).toEqual([null, null, null, null, null, null]);
    h.dispatch({ type: 'nextHand' });
    expect(own(h)).toEqual([null, null, 'hard', null, null, null]);
    expect(hand(h).phase).toBe('betting');
    expect(h.state().game.next).toBeNull();
  });

  it('"Same as table" (null) puts the seat back on the table’s level, now and when it changes', async () => {
    const h = makeHarness({
      settings: { players: 4, botLevel: 'easy', seatLevels: [null, 'hard', null, null] },
    });
    h.dispatch({ type: 'play' });
    expect(own(h)).toEqual([null, 'hard', null, null]);
    h.dispatch({ type: 'seatLevel', seat: 1, level: null });
    h.dispatch({ type: 'settings', patch: { botLevel: 'medium' } });
    await drive(h, { hands: 2, hero: passive });
    expect(table(h).config.botLevel).toBe('medium');
    expect(own(h)).toEqual([null, null, null, null]);
    expect(levelsOf(table(h)).slice(1)).toEqual(['medium', 'medium', 'medium']);
  });

  it('a new table level keeps the picks, and a pick keeps the table level', async () => {
    const h = makeHarness({ settings: { players: 4 } });
    h.dispatch({ type: 'play' });
    h.dispatch({ type: 'seatLevel', seat: 2, level: 'expert' });
    h.dispatch({ type: 'settings', patch: { botLevel: 'hard' } });
    h.dispatch({ type: 'seatLevel', seat: 3, level: 'medium' });
    await drive(h, { hands: 2, hero: passive });
    expect(table(h).config.botLevel).toBe('hard');
    expect(own(h)).toEqual([null, null, 'expert', 'medium']);
    expect(levelsOf(table(h)).slice(1)).toEqual(['hard', 'expert', 'medium']);
  });

  it('changing a pick back before the next hand changes nothing', async () => {
    const h = makeHarness();
    h.dispatch({ type: 'play' });
    h.dispatch({ type: 'seatLevel', seat: 2, level: 'hard' });
    h.dispatch({ type: 'seatLevel', seat: 2, level: null });
    await drive(h, { hands: 2, hero: passive });
    expect(own(h)).toEqual([null, null, null, null, null, null]);
    expect(h.controller.logs().errors).toEqual([]);
  });

  it('is applied once, and every later hand keeps it', async () => {
    const h = makeHarness({ settings: { players: 3 } });
    h.dispatch({ type: 'play' });
    h.dispatch({ type: 'seatLevel', seat: 1, level: 'hard' });
    await drive(h, { hands: 4, hero: passive });
    expect(own(h)).toEqual([null, 'hard', null]);
    expect(h.state().game.diag).toEqual({ engineErrors: 0, botFallbacks: 0, voidedHands: 0 });
  });
});

describe('a bot that sits down in a seat takes the list of the seat’s level (§9.3)', () => {
  /** The hero shoves every hand: heads-up with short stacks the bot is soon out of chips. */
  const shove = (legal: LegalActions): PlayerAction => {
    if (legal.raise !== null) return { type: 'raise', to: legal.raise.max };
    if (legal.bet !== null) return { type: 'bet', to: legal.bet.max };
    return passive(legal);
  };

  it('a pick made earlier decides the newcomer’s personality and the cursor advances once', async () => {
    const h = makeHarness({
      settings: { players: 2, startingStack: 200, sb: 10, bb: 20, botLevel: 'easy' },
    });
    h.dispatch({ type: 'play' });
    const first = table(h).slots[1]?.playerId;
    h.dispatch({ type: 'seatLevel', seat: 1, level: 'expert' });
    let replaced: TableState | null = null;
    for (let n = 0; n < 80 && replaced === null; n++) {
      await drive(h, { hands: 1, hero: shove });
      const next = h.state().game.next;
      if (next !== null && next.slots[1]?.playerId !== first) replaced = next;
    }
    const next = replaced as TableState | null;
    expect(next).not.toBeNull();
    // Entry 1 of the lists: "station" at Easy, "lag" at Expert. The seat’s level decides.
    expect(PERSONALITY_LISTS.easy[1]).toBe('station');
    expect(PERSONALITY_LISTS.expert[1]).toBe('lag');
    expect(next?.slots[1]?.personality).toBe('lag');
    expect(next?.personalityCursor).toBe(2);
    expect(next?.slots[1]?.stack).toBe(200);
    expect(next?.config.seatLevels).toEqual([null, 'expert']);
  }, 60_000);
});

describe('settings made for another table (§9.3, A.7)', () => {
  it('overrides for another number of seats are not applied to the table, which keeps its own', async () => {
    const h = makeHarness({
      settings: { players: 4, seatLevels: [null, 'hard', null, 'expert'] },
    });
    h.dispatch({ type: 'play' });
    h.dispatch({ type: 'settings', patch: { players: 6 } });
    expect(h.state().settings.seatLevels).toHaveLength(6);
    await drive(h, { hands: 2, hero: passive });
    expect(own(h)).toEqual([null, 'hard', null, 'expert']);
  });

  it('a pick then brings the settings back to this table’s seats, keeping its other levels', async () => {
    const h = makeHarness({
      settings: { players: 4, seatLevels: [null, 'hard', null, 'expert'] },
    });
    h.dispatch({ type: 'play' });
    h.dispatch({ type: 'settings', patch: { players: 6 } });
    h.dispatch({ type: 'seatLevel', seat: 2, level: 'medium' });
    expect(h.state().settings.players).toBe(4);
    expect(h.state().settings.seatLevels).toEqual([null, 'hard', 'medium', 'expert']);
    await drive(h, { hands: 2, hero: passive });
    expect(own(h)).toEqual([null, 'hard', 'medium', 'expert']);
  });
});

describe('every hand records the levels in force, per seat (§10, §14.4)', () => {
  it('the hand’s table, its saved session, the brain’s observations and profiles all agree', async () => {
    const backend = new FakeStorage();
    const brain = spyBrain();
    const h = makeHarness({ brain: brain.client, storage: createSafeStorage(() => backend) });
    // (With storage the controller reads the settings from the profile at boot.)
    h.dispatch({ type: 'settings', patch: { autoNext: false, players: 4 } });
    h.dispatch({ type: 'play' });
    // (hand, when the pick is made, seat, level): in the hand, in the hand-end pause, none, …
    const picks: [number, 'during' | 'between', number, BotLevel | null][] = [
      [1, 'during', 1, 'hard'],
      [1, 'between', 2, 'expert'],
      [2, 'between', 1, null],
      [3, 'during', 3, 'medium'],
    ];
    const seen: { handSeq: number; levels: BotLevel[]; session: (BotLevel | null)[] }[] = [];
    for (let n = 1; n <= 4; n++) {
      // The hand has just been dealt: what the session says about its table.
      const session = storedSession(backend);
      expect(session.hand?.handSeq).toBe(hand(h).handSeq);
      for (const [hn, when, seat, level] of picks) {
        if (hn === n && when === 'during') h.dispatch({ type: 'seatLevel', seat, level });
      }
      await drive(h, { hands: 1, hero: passive });
      seen.push({
        handSeq: hand(h).handSeq,
        levels: levelsOf(table(h)),
        session: session.table.config.seatLevels,
      });
      for (const [hn, when, seat, level] of picks) {
        if (hn === n && when === 'between') h.dispatch({ type: 'seatLevel', seat, level });
      }
      if (n < 4) h.dispatch({ type: 'nextHand' });
    }

    // What the player picked and when says which levels each hand was in force at.
    expect(seen.map((s) => s.levels.slice(1))).toEqual([
      ['easy', 'easy', 'easy'],
      ['hard', 'expert', 'easy'],
      ['easy', 'expert', 'easy'],
      ['easy', 'expert', 'medium'],
    ]);
    // The session held the same table while the hand was played …
    expect(seen.map((s) => s.session)).toEqual([
      [null, null, null, null],
      [null, 'hard', 'expert', null],
      [null, null, 'expert', null],
      [null, null, 'expert', 'medium'],
    ]);
    // … and the bots were asked at those levels, seat by seat.
    for (const { handSeq, levels } of seen) {
      const requests = requestsOf(brain, handSeq);
      expect(requests.length, `hand ${handSeq}`).toBeGreaterThan(0);
      for (const r of requests) {
        expect(r.levels).toEqual(levels);
        expect(r.level).toBe(levels[r.seat]);
        expect(r.visible.map((p) => p !== null)).toEqual(
          levels.map((level, seat) => seat > 0 && (level === 'easy' || level === 'medium')),
        );
      }
    }
  });

  it('the log of a hand start names the levels of its bots', async () => {
    const h = makeHarness({ settings: { players: 3, seatLevels: [null, 'expert', null] } });
    h.dispatch({ type: 'play' });
    h.dispatch({ type: 'seatLevel', seat: 2, level: 'hard' });
    await drive(h, { hands: 2, hero: passive });
    const starts = h.controller
      .logs()
      .events.filter((e) => e.what === 'hand start')
      .map((e) => (e.detail as { levels: BotLevel[] }).levels);
    expect(starts.slice(0, 2)).toEqual([
      ['expert', 'easy'],
      ['expert', 'hard'],
    ]);
  });

  it('a hand voided in the middle keeps its record at the levels it was dealt at; the new hand follows the pick', async () => {
    let calls = 0;
    const failing: typeof step = (s, input) => {
      if (++calls === 4) throw new InvariantError(['I1 chip conservation: test']);
      return step(s, input);
    };
    const h = makeHarness({ step: failing });
    h.dispatch({ type: 'play' });
    const voidedTable = table(h);
    h.dispatch({ type: 'seatLevel', seat: 2, level: 'hard' });
    for (let i = 0; i < 400 && h.state().game.diag.voidedHands === 0; i++) {
      const s = h.state();
      if (s.game.mode === 'heroTurn' && s.game.legal !== null) {
        h.dispatch({ type: 'act', action: passive(s.game.legal) });
      } else {
        await tick();
      }
    }
    expect(h.state().game.diag.voidedHands).toBe(1);
    const record = h.controller.logs().voided[0];
    expect(record?.table).toBe(voidedTable);
    expect(record?.table.config.seatLevels).toEqual([null, null, null, null, null, null]);
    // The hand dealt again starts a new hand, which is the next one for a pick.
    expect(own(h)).toEqual([null, null, 'hard', null, null, null]);
  });
});

describe('the pick survives a restart (§14.2, §14.5)', () => {
  it('a hand resumed plays on at the levels it was dealt at; the next one has the pick', async () => {
    const backend = new FakeStorage();
    const a = launch(backend);
    a.dispatch({ type: 'play' });
    a.dispatch({ type: 'seatLevel', seat: 2, level: 'expert' });
    a.dispatch({ type: 'visibility', hidden: true }); // the settings are written at once
    expect(storedSettings(backend).seatLevels).toEqual([null, null, 'expert', null, null, null]);
    // The saved session still holds the table the hand in play was dealt from.
    expect(storedSession(backend).table.config.seatLevels).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
    a.controller.dispose();

    const b = launch(backend);
    expect(b.state().settings.seatLevels).toEqual([null, null, 'expert', null, null, null]);
    expect(own(b)).toEqual([null, null, null, null, null, null]); // the resumed hand
    const resumed = hand(b).handSeq;
    b.dispatch({ type: 'play' });
    await drive(b, { hands: 1, hero: passive });
    expect(hand(b).handSeq).toBe(resumed);
    expect(own(b)).toEqual([null, null, null, null, null, null]);
    await drive(b, { hands: 1, hero: passive });
    expect(hand(b).handSeq).toBeGreaterThan(resumed);
    expect(own(b)).toEqual([null, null, 'expert', null, null, null]);
  });

  it('a table between hands is dealt again at the saved pick', async () => {
    const backend = new FakeStorage();
    const a = launch(backend);
    a.dispatch({ type: 'settings', patch: { autoNext: false } });
    a.dispatch({ type: 'play' });
    await drive(a, { hands: 1, hero: passive });
    expect(a.state().game.mode).toBe('handEnd');
    a.dispatch({ type: 'seatLevel', seat: 4, level: 'hard' });
    a.dispatch({ type: 'visibility', hidden: true });
    a.controller.dispose();

    const b = launch(backend);
    expect(b.state().game.next?.config.seatLevels).toEqual([null, null, null, null, null, null]);
    b.dispatch({ type: 'play' });
    expect(own(b)).toEqual([null, null, null, null, 'hard', null]);
    expect(hand(b).phase).toBe('betting');
  });
});

describe('Setup’s "More options" (§12.2 item 5)', () => {
  it('Start game uses the chosen levels at once and they become the last-used ones', async () => {
    const backend = new FakeStorage();
    const h = launch(backend);
    h.dispatch({
      type: 'newTable',
      setup: {
        players: 4,
        botLevel: 'medium',
        seatLevels: [null, 'expert', null, 'easy'],
        speed: 'fast',
        fourColour: false,
      },
    });
    await tick();
    expect(table(h).config).toMatchObject({
      seatCount: 4,
      botLevel: 'medium',
      seatLevels: [null, 'expert', null, 'easy'],
    });
    // The seated bots come from their seat’s level list: bot i takes entry i (§9.3).
    expect(table(h).slots.map((s) => s.personality)).toEqual([
      null,
      PERSONALITY_LISTS.expert[0],
      PERSONALITY_LISTS.medium[1],
      PERSONALITY_LISTS.easy[2],
    ]);
    expect(h.state().settings).toMatchObject({
      speed: 'fast',
      fourColour: false,
      seatLevels: [null, 'expert', null, 'easy'],
    });
    expect(storedSettings(backend)).toMatchObject({
      speed: 'fast',
      fourColour: false,
      seatLevels: [null, 'expert', null, 'easy'],
      players: 4,
    });
  });

  it('a new table with a different number of players fits the old picks to its seats', async () => {
    const h = makeHarness({
      settings: { players: 5, seatLevels: [null, 'hard', null, 'easy', null] },
    });
    h.dispatch({ type: 'newTable', setup: { players: 3 } });
    await tick();
    expect(own(h)).toEqual([null, 'hard', null]);
    expect(h.state().settings.seatLevels).toEqual([null, 'hard', null]);
  });

  it('refuses a level that is not a level; the hero never has one', () => {
    const h = makeHarness();
    const before = h.state().settings;
    h.dispatch({
      type: 'settings',
      patch: { seatLevels: [null, 'legend', null, null, null, null] as never },
    });
    expect(h.state().settings).toBe(before);
    expect(h.controller.logs().errors.map((e) => e.what)).toEqual(['settings refused']);
    // A level for the hero (seat 0) is dropped, as `sanitize` keeps the list valid.
    h.dispatch({
      type: 'settings',
      patch: { seatLevels: ['hard', 'easy', null, null, null, null] },
    });
    expect(h.state().settings.seatLevels).toEqual([null, 'easy', null, null, null, null]);
  });
});
