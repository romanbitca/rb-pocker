/**
 * The level selectors' data flow through the controller (PLAN §10, §9.3, §12.2, chunk 5.10): a bot
 * level chosen in Setup or Settings is saved with the settings, a table starts at it, and a change
 * during play starts with the next hand (seated bots keep their personality and get the new
 * parameters, per-seat overrides stay). The coach level is read live from the settings. The
 * brain's `profile.id` (`<personality>/<level>`) is what 5.7's profiles plug into.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TIMING } from '../../src/app/controller.ts';
import { selectSessionLine } from '../../src/app/store.ts';
import { PERSONALITY_LISTS } from '../../src/engine/table.ts';
import type {
  BotLevel,
  HandState,
  LegalActions,
  PlayerAction,
  TableState,
} from '../../src/engine/types.ts';
import { createSafeStorage, STORAGE_KEYS } from '../../src/persist/storage.ts';
import { FakeStorage } from '../persist/fakeStorage.ts';
import { drive, elapse, makeHarness, spyBrain, tick, type Harness } from './harness.ts';

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
const personalities = (t: TableState): (string | null)[] => t.slots.map((s) => s.personality);

/** A launch over the same stored data: a new store and controller. */
function launch(backend: FakeStorage): Harness {
  return makeHarness({ storage: createSafeStorage(() => backend) });
}

const storedSettings = (backend: FakeStorage): Record<string, unknown> =>
  (JSON.parse(backend.data.get(STORAGE_KEYS.profile) as string) as { settings: never }).settings;

describe('a table starts at the level of the settings (§12.2)', () => {
  it.each<BotLevel>(['easy', 'medium'])('%s: the table and its bots', (botLevel) => {
    const h = makeHarness({ settings: { botLevel } });
    h.dispatch({ type: 'play' });
    expect(table(h).config.botLevel).toBe(botLevel);
    // The §9.3 list of the level: bot i, in seat i + 1, takes entry i.
    expect(personalities(table(h)).slice(1)).toEqual(PERSONALITY_LISTS[botLevel].slice(0, 5));
  });

  it('Setup’s Start game: the chosen levels are used at once and become the last-used ones', async () => {
    const backend = new FakeStorage();
    const h = launch(backend);
    h.dispatch({
      type: 'newTable',
      setup: { players: 4, botLevel: 'medium', coachLevel: 'intermediate' },
    });
    await tick();
    expect(table(h).config).toMatchObject({ seatCount: 4, botLevel: 'medium' });
    expect(personalities(table(h)).slice(1)).toEqual(PERSONALITY_LISTS.medium.slice(0, 3));
    expect(h.state().settings).toMatchObject({ botLevel: 'medium', coachLevel: 'intermediate' });
    expect(storedSettings(backend)).toMatchObject({
      botLevel: 'medium',
      coachLevel: 'intermediate',
      players: 4,
    });
  });
});

describe('the levels are saved with the settings and come back (§14.2)', () => {
  it('are written 250 ms after the change and read by the next launch', async () => {
    const backend = new FakeStorage();
    const a = launch(backend);
    a.dispatch({ type: 'play' });
    a.dispatch({ type: 'settings', patch: { botLevel: 'medium', coachLevel: 'intermediate' } });
    expect(storedSettings(backend)).toMatchObject({ botLevel: 'easy', coachLevel: 'beginner' });
    await vi.advanceTimersByTimeAsync(TIMING.settingsDebounceMs);
    expect(storedSettings(backend)).toMatchObject({
      botLevel: 'medium',
      coachLevel: 'intermediate',
    });
    a.controller.dispose();

    const b = launch(backend);
    expect(b.state().settings).toMatchObject({ botLevel: 'medium', coachLevel: 'intermediate' });
    // Home's line under Play names them (§12.1, F.10).
    expect(selectSessionLine(b.state())).toMatchObject({
      botLevel: 'medium',
      coachLevel: 'intermediate',
    });
  });

  it('are written at once when the page is hidden', () => {
    const backend = new FakeStorage();
    const h = launch(backend);
    h.dispatch({ type: 'play' });
    h.dispatch({ type: 'settings', patch: { botLevel: 'medium' } });
    h.dispatch({ type: 'visibility', hidden: true });
    expect(storedSettings(backend).botLevel).toBe('medium');
  });

  it('Home’s Play after a restart deals a table at the saved bot level', () => {
    const backend = new FakeStorage();
    const a = launch(backend);
    a.dispatch({ type: 'settings', patch: { botLevel: 'medium' } });
    a.dispatch({ type: 'pagehide' });
    a.controller.dispose();

    const b = launch(backend);
    expect(b.state().game.table).toBeNull();
    b.dispatch({ type: 'play' });
    expect(table(b).config.botLevel).toBe('medium');
    expect(personalities(table(b)).slice(1)).toEqual(PERSONALITY_LISTS.medium.slice(0, 5));
  });

  it('refuse a level that is not a level', () => {
    const h = makeHarness();
    const before = h.state().settings;
    h.dispatch({ type: 'settings', patch: { botLevel: 'legend' as never } });
    h.dispatch({ type: 'settings', patch: { coachLevel: 'guru' as never } });
    expect(h.state().settings).toBe(before);
  });
});

describe('a new bot level starts with the next hand (§10)', () => {
  /** Every profile id the brain was asked with, per hand. */
  function profilesByHand(brain: ReturnType<typeof spyBrain>): Map<number, Set<string>> {
    const byHand = new Map<number, Set<string>>();
    for (const req of brain.requests) {
      const set = byHand.get(req.obs.handSeq) ?? new Set<string>();
      set.add(req.profile.id);
      byHand.set(req.obs.handSeq, set);
    }
    return byHand;
  }

  it('not in the middle of a hand: its table, its labels and its bots’ profiles stay', async () => {
    const brain = spyBrain();
    const h = makeHarness({ brain: brain.client, settings: { botLevel: 'easy' } });
    h.dispatch({ type: 'play' });
    const first = hand(h).handSeq;
    const before = table(h);
    h.dispatch({ type: 'settings', patch: { botLevel: 'medium' } });
    // The setting changed at once; the hand in play did not notice.
    expect(h.state().settings.botLevel).toBe('medium');
    expect(table(h)).toBe(before);
    expect(table(h).config.botLevel).toBe('easy');

    await drive(h, { hands: 1, hero: passive });
    const ids = profilesByHand(brain).get(first) ?? new Set<string>();
    expect(ids.size).toBeGreaterThan(0);
    for (const id of ids) expect(id.endsWith('/easy')).toBe(true);
  });

  it('then the next hand is dealt at the new level; seated bots keep their personality', async () => {
    const brain = spyBrain();
    const h = makeHarness({ brain: brain.client });
    h.dispatch({ type: 'play' });
    const first = hand(h).handSeq;
    const slots = table(h).slots;
    h.dispatch({ type: 'settings', patch: { botLevel: 'medium' } });
    await drive(h, { hands: 1, hero: passive });
    // Next hand: a table at Medium, same bots in the same seats (nobody bust or the replacements are new).
    await drive(h, { hands: 1, hero: passive });
    expect(hand(h).handSeq).toBeGreaterThan(first);
    expect(table(h).config.botLevel).toBe('medium');
    for (const [seat, slot] of table(h).slots.entries()) {
      const was = slots[seat];
      if (was?.playerId === slot.playerId) {
        expect(slot.personality).toBe(was.personality);
        expect(slot.name).toBe(was.name);
      }
    }
    const ids = profilesByHand(brain).get(hand(h).handSeq) ?? new Set<string>();
    for (const id of ids) expect(id.endsWith('/medium')).toBe(true);
  });

  it('a change between two hands (the hand-end pause) counts for the hand that follows', async () => {
    const h = makeHarness({ settings: { autoNext: false } });
    h.dispatch({ type: 'play' });
    await drive(h, { hands: 1, hero: passive });
    expect(h.state().game.mode).toBe('handEnd');
    h.dispatch({ type: 'settings', patch: { botLevel: 'medium' } });
    h.dispatch({ type: 'nextHand' });
    expect(table(h).config.botLevel).toBe('medium');
    expect(hand(h).phase).toBe('betting');
  });

  it('keeps the table’s own per-seat levels and changes only the table level', async () => {
    const h = makeHarness({
      settings: { players: 4, botLevel: 'easy', seatLevels: [null, 'hard', null, 'expert'] },
    });
    h.dispatch({ type: 'play' });
    h.dispatch({ type: 'settings', patch: { botLevel: 'medium' } });
    await drive(h, { hands: 2, hero: passive });
    expect(table(h).config.botLevel).toBe('medium');
    expect(table(h).config.seatLevels).toEqual([null, 'hard', null, 'expert']);
  });

  it('changing it back before the next hand changes nothing', async () => {
    const h = makeHarness();
    h.dispatch({ type: 'play' });
    h.dispatch({ type: 'settings', patch: { botLevel: 'medium' } });
    h.dispatch({ type: 'settings', patch: { botLevel: 'easy' } });
    await drive(h, { hands: 2, hero: passive });
    expect(table(h).config.botLevel).toBe('easy');
    expect(h.controller.logs().errors).toEqual([]);
  });

  it('a bot that sits down for the next hand is picked from the new level’s list', async () => {
    // Heads-up with 10 big blinds each, the hero shoving every hand: the bot folds its way to
    // zero and is replaced by the next entry of its seat's list (§9.3). The level was changed in
    // the first hand, so the newcomer comes from the Hard list, not the Easy one.
    const shove = (legal: LegalActions): PlayerAction => {
      if (legal.raise !== null) return { type: 'raise', to: legal.raise.max };
      if (legal.bet !== null) return { type: 'bet', to: legal.bet.max };
      return passive(legal);
    };
    const h = makeHarness({
      settings: { players: 2, startingStack: 200, sb: 10, bb: 20, botLevel: 'easy' },
    });
    h.dispatch({ type: 'play' });
    const before = table(h).slots[1]?.playerId;
    h.dispatch({ type: 'settings', patch: { botLevel: 'hard' } });
    let replaced: TableState | null = null;
    for (let n = 0; n < 60 && replaced === null; n++) {
      await drive(h, { hands: 1, hero: shove });
      const next = h.state().game.next;
      if (next !== null && next.slots[1]?.playerId !== before) replaced = next;
    }
    const next = replaced as TableState | null;
    expect(next).not.toBeNull();
    expect(next?.config.botLevel).toBe('hard');
    // The first bot to sit down takes entry 1 of the list: the two levels differ there.
    expect(PERSONALITY_LISTS.easy[1]).toBe('station');
    expect(PERSONALITY_LISTS.hard[1]).toBe('lag');
    expect(next?.personalityCursor).toBe(2);
    expect(next?.slots[1]?.personality).toBe('lag');
    expect(next?.slots[1]?.stack).toBe(200);
  }, 60_000);
});

describe('the coach level (§10: from the next decision)', () => {
  it('is read from the settings; changing it never touches the table or the hand', async () => {
    const h = makeHarness();
    h.dispatch({ type: 'play' });
    const before = { table: table(h), hand: hand(h) };
    h.dispatch({ type: 'settings', patch: { coachLevel: 'intermediate' } });
    expect(h.state().settings.coachLevel).toBe('intermediate');
    expect(table(h)).toBe(before.table);
    expect(hand(h)).toBe(before.hand);
    await elapse(0);
    // The hand plays on exactly as it would have (no restart, no void).
    const [done] = await drive(h, { hands: 1, hero: passive });
    expect(done?.handSeq).toBe(before.hand.handSeq);
    expect(h.state().game.diag).toEqual({ engineErrors: 0, botFallbacks: 0, voidedHands: 0 });
  });
});
