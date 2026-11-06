/**
 * Sounds and vibration at the table (PLAN §12.8, §12.13; chunk 9.1).
 * - `nextCues` (pure): which cue each change of a hand makes, and when; only while the Table is on
 *   screen and the page visible; each once; nothing for blinds, reveals or a mistake; nothing
 *   after an Undo; the speed scales the deal's stagger.
 * - `installCues` with the real controller (fake timers, SimpleBot bots) and a stand-in synth and
 *   `navigator.vibrate`: the AudioContext is unlocked inside the Play dispatch (the tap); the cues
 *   of a real hand; sound and vibration follow their settings; the synth loads only while sound is
 *   on; `vibrate` missing (iOS) is a no-op; a later tap at the table brings the sound back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CUE_GAP_MS,
  CUE_SPEED,
  DEAL_STAGGER_MS,
  HAPTIC_MS,
  installCues,
  nextCues,
  NO_CUES,
  vibrate,
  type CueMemory,
  type SynthModule,
  type TimedCue,
} from '../../src/app/cues.ts';
import { SPEED_FACTOR, TIMING } from '../../src/app/controller.ts';
import {
  defaultGameSettings,
  initialGame,
  initialUi,
  type AppState,
  type ControllerMode,
  type Speed,
} from '../../src/app/store.ts';
import { deriveSeed, type Seed128 } from '../../src/core/rng.ts';
import { startHand } from '../../src/engine/start.ts';
import { createTable, initialSlots } from '../../src/engine/table.ts';
import type { HandState, LogEvent, TableConfig } from '../../src/engine/types.ts';
import type { Cue, Synth } from '../../src/sound/synth.ts';
import { flush, makeHarness, tick, type Harness } from './harness.ts';

const SEED: Seed128 = 'c0ffee00c0ffee00c0ffee00c0ffee00';
const CONFIG: TableConfig = {
  seatCount: 3,
  sb: 10,
  bb: 20,
  startingStack: 2000,
  botLevel: 'easy',
  seatLevels: [null, null, null],
};

/** A hand just dealt (only the two blinds in its log). */
function dealt(handSeq = 1): HandState {
  const table = createTable(CONFIG, initialSlots(CONFIG, SEED, 'You'), SEED);
  return startHand({ ...table, nextHandSeq: handSeq }, deriveSeed(SEED, 'hand', handSeq));
}

const act = (seat: number, type: 'fold' | 'check' | 'call' | 'bet' | 'raise'): LogEvent => ({
  e: 'act',
  seat,
  street: 'preflop',
  action: type === 'bet' || type === 'raise' ? { type, to: 60 } : { type },
  amountIn: 0,
  allIn: false,
  full: true,
});

const with_ = (h: HandState, ...events: LogEvent[]): HandState => ({
  ...h,
  log: [...h.log, ...events],
});

/** `h` over, the hero's net `net`. */
const over = (h: HandState, net: number): HandState => ({
  ...h,
  phase: 'complete',
  toAct: null,
  result: {
    endedBy: 'fold',
    pots: [],
    potWinners: [],
    payouts: [0, 0, 0],
    net: [net, -net, 0],
    shown: [],
  },
});

interface At {
  mode?: ControllerMode;
  screen?: AppState['ui']['screen'];
  hidden?: boolean;
  speed?: Speed;
}

/** The parts of the app state `nextCues` reads. */
function at(hand: HandState | null, o: At = {}): AppState {
  return {
    game: { ...initialGame(), hand, mode: o.mode ?? 'botTurn' },
    ui: { ...initialUi(false), screen: o.screen ?? 'table', hidden: o.hidden ?? false },
    settings: { ...defaultGameSettings(), speed: o.speed ?? 'normal' },
  } as AppState;
}

/** Feeds states in order; returns the cues of each. */
function run(states: AppState[], start: CueMemory = NO_CUES): TimedCue[][] {
  let memory = start;
  return states.map((s) => {
    const next = nextCues(memory, s);
    memory = next.memory;
    return next.cues;
  });
}

const deal = (delayMs: number): TimedCue => ({ cue: 'deal', delayMs });
const cue = (c: Cue, delayMs = 0): TimedCue => ({ cue: c, delayMs });

describe('nextCues (§12.8)', () => {
  it('uses the deal stagger and speed factors of the controller', () => {
    expect(DEAL_STAGGER_MS).toBe(TIMING.dealStaggerMs);
    expect(CUE_SPEED).toEqual(SPEED_FACTOR);
    expect(HAPTIC_MS).toEqual({ turn: 10, win: 20 });
  });

  it('no hand: nothing', () => {
    expect(nextCues(NO_CUES, at(null))).toEqual({ memory: NO_CUES, cues: [] });
  });

  it('a hand just dealt on screen: the two cards, 60 ms apart at Normal; once', () => {
    const h = dealt();
    expect(run([at(h), at(h), at(h)])).toEqual([[deal(0), deal(60)], [], []]);
  });

  it('the stagger scales with the speed: Fast 30 ms, Instant one sound', () => {
    expect(run([at(dealt(), { speed: 'fast' })])).toEqual([[deal(0), deal(30)]]);
    expect(run([at(dealt(), { speed: 'instant' })])).toEqual([[deal(0)]]);
  });

  it('Play: the hand is dealt before the Table is on screen; the deal sounds when it is', () => {
    const h = dealt();
    expect(run([at(h, { screen: 'home' }), at(h)])).toEqual([[], [deal(0), deal(60)]]);
  });

  it('a hand already under way when shown (a saved game): no deal, no old actions', () => {
    const h = with_(dealt(), act(1, 'call'), act(2, 'check'));
    expect(run([at(h, { screen: 'home' }), at(h)])).toEqual([[], []]);
  });

  it('every action: fold, check, and call, bet or raise as a chip', () => {
    const h = dealt();
    const steps = [
      h,
      with_(h, act(1, 'fold')),
      with_(h, act(1, 'fold'), act(2, 'call')),
      with_(h, act(1, 'fold'), act(2, 'call'), act(0, 'check')),
      with_(h, act(1, 'fold'), act(2, 'call'), act(0, 'check'), act(2, 'bet')),
      with_(h, act(1, 'fold'), act(2, 'call'), act(0, 'check'), act(2, 'bet'), act(0, 'raise')),
    ];
    expect(run(steps.map((s) => at(s))).slice(1)).toEqual([
      [cue('fold')],
      [cue('chip')],
      [cue('check')],
      [cue('chip')],
      [cue('chip')],
    ]);
  });

  it('board cards: a deal sound each (one at Instant); reveals, refunds and awards are silent', () => {
    const h = with_(dealt(), act(2, 'call'), act(0, 'check'));
    const flop = with_(h, { e: 'street', street: 'flop', cards: [0, 1, 2] });
    const turn = with_(flop, { e: 'street', street: 'turn', cards: [3] });
    const quiet = with_(
      turn,
      { e: 'reveal', seats: [0, 2], reason: 'showdown' },
      { e: 'refund', seat: 2, amount: 20 },
      { e: 'award', pot: 0, seats: [2], amounts: [80] },
    );
    expect(run([at(h), at(flop), at(turn), at(quiet)]).slice(1)).toEqual([
      [deal(0), deal(60), deal(120)],
      [deal(0)],
      [],
    ]);
    expect(run([at(h, { speed: 'instant' }), at(flop, { speed: 'instant' })])[1]).toEqual([
      deal(0),
    ]);
  });

  it('off the Table or while hidden: passed over, never played late', () => {
    const h = dealt();
    const a = with_(h, act(1, 'fold'));
    const b = with_(a, act(2, 'call'));
    const c = with_(b, act(0, 'check'));
    expect(
      run([at(h), at(a, { screen: 'settings' }), at(b, { hidden: true }), at(b), at(c)]),
    ).toEqual([[deal(0), deal(60)], [], [], [], [cue('check')]]);
  });

  it('your turn: once per decision, after the deal when both come together', () => {
    const h = dealt();
    const [first, again] = run([at(h, { mode: 'heroTurn' }), at(h, { mode: 'heroTurn' })]);
    expect(first).toEqual([deal(0), deal(60), cue('turn', 60 + CUE_GAP_MS)]);
    expect(again).toEqual([]);
    // The next decision of the same hand is another one.
    const later = with_(h, act(0, 'call'), act(1, 'raise'));
    expect(run([at(h), at(later, { mode: 'heroTurn' })])[1]).toEqual([
      cue('chip'),
      cue('chip', CUE_GAP_MS),
      cue('turn', 2 * CUE_GAP_MS),
    ]);
  });

  it('your turn shown later (Home → Play on a saved decision): it sounds when shown, once', () => {
    const h = with_(dealt(), act(1, 'call'));
    expect(
      run([
        at(h, { mode: 'heroTurn', screen: 'home' }),
        at(h, { mode: 'heroTurn' }),
        at(h, { mode: 'heroTurn', screen: 'settings' }),
        at(h, { mode: 'heroTurn' }),
      ]),
    ).toEqual([[], [cue('turn')], [], []]);
  });

  it('after an Undo: no sound for the shorter log, and no "your turn" for the decision it brings back', () => {
    const h = dealt();
    const acted = with_(h, act(0, 'call'), act(1, 'fold'));
    const undone = with_(h, { e: 'reshuffle', decisionId: 1, undoIndex: 0 });
    expect(
      run([at(h, { mode: 'heroTurn' }), at(acted), at(undone, { mode: 'heroTurn' })]).slice(1),
    ).toEqual([[cue('chip'), cue('fold', CUE_GAP_MS)], []]);
  });

  it('the hand end: a win when the hero gained chips, once; nothing for a loss or a split even', () => {
    const h = with_(dealt(), act(1, 'fold'), act(2, 'fold'));
    const won = over(h, 30);
    expect(run([at(h), at(won), at(won)]).slice(1)).toEqual([[cue('win')], []]);
    expect(run([at(h), at(over(h, -20))])[1]).toEqual([]);
    expect(run([at(h), at(over(h, 0))])[1]).toEqual([]);
  });

  it('a win comes after the action that ended the hand', () => {
    const h = with_(dealt(), act(1, 'fold'));
    const won = over(with_(h, act(2, 'fold')), 30);
    expect(run([at(h), at(won)])[1]).toEqual([cue('fold'), cue('win', CUE_GAP_MS)]);
  });

  it('a hand that ends off the Table (finished for a new table, §3.1) never sounds a win', () => {
    const h = with_(dealt(), act(1, 'call'));
    const won = over(h, 50);
    expect(run([at(h), at(won, { screen: 'setup' }), at(won)]).slice(1)).toEqual([[], []]);
  });

  it('a new hand on screen after another: its own deal', () => {
    const first = dealt(1);
    const won = over(with_(first, act(1, 'fold'), act(2, 'fold')), 30);
    const second = dealt(2);
    expect(run([at(first), at(won), at(second)])).toEqual([
      [deal(0), deal(60)],
      [cue('fold'), cue('fold', CUE_GAP_MS), cue('win', 2 * CUE_GAP_MS)],
      [deal(0), deal(60)],
    ]);
  });
});

describe('vibrate (§12.8: Android only)', () => {
  it('calls navigator.vibrate as a method, with a pattern for a later start', () => {
    const calls: unknown[] = [];
    const nav = {
      vibrate(this: unknown, pattern: unknown) {
        if (this !== nav) throw new TypeError('Illegal invocation');
        calls.push(pattern);
        return true;
      },
    };
    expect(vibrate(nav, 10)).toBe(true);
    expect(vibrate(nav, 20, 150)).toBe(true);
    expect(calls).toEqual([10, [0, 150, 20]]);
  });

  it('missing (iOS), refusing or throwing: false, never a throw', () => {
    expect(vibrate({}, 10)).toBe(false);
    expect(vibrate(undefined, 10)).toBe(false);
    expect(vibrate({ vibrate: () => false }, 10)).toBe(false);
    expect(
      vibrate(
        {
          vibrate: () => {
            throw new Error('blocked');
          },
        },
        10,
      ),
    ).toBe(false);
    const throwing = Object.defineProperty({}, 'vibrate', {
      get() {
        throw new Error('getter');
      },
    });
    expect(vibrate(throwing, 10)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// With the real controller

interface FakeSynth extends Synth {
  played: TimedCue[];
  unlocks: number;
  pauses: number;
  closed: boolean;
  running: boolean;
}

function fakeSynth(): FakeSynth {
  const synth: FakeSynth = {
    played: [],
    unlocks: 0,
    pauses: 0,
    closed: false,
    running: false,
    unlock() {
      synth.unlocks++;
      synth.running = true;
    },
    pause() {
      synth.pauses++;
      synth.running = false;
    },
    play(c, delayMs = 0) {
      synth.played.push({ cue: c, delayMs });
    },
    close() {
      synth.closed = true;
    },
  };
  return synth;
}

interface Page {
  win: Window;
  vibrations: unknown[];
  synth: FakeSynth;
  loads: number;
  uninstall: () => void;
}

/** A window stand-in (taps, `navigator.vibrate` unless `noVibrate`) and the cues on `h`'s store. */
async function install(h: Harness, options: { noVibrate?: boolean } = {}): Promise<Page> {
  const vibrations: unknown[] = [];
  const navigator = options.noVibrate
    ? {}
    : {
        vibrate: (pattern: unknown) => {
          vibrations.push(pattern);
          return true;
        },
      };
  const win = Object.assign(new EventTarget(), { navigator }) as unknown as Window;
  const synth = fakeSynth();
  const page: Page = { win, vibrations, synth, loads: 0, uninstall: () => {} };
  const loadSynth = (): Promise<SynthModule> => {
    page.loads++;
    return Promise.resolve({ createSynth: () => synth });
  };
  page.uninstall = installCues(win, h.store, { loadSynth });
  await flush();
  return page;
}

/** Runs the game until `done` (bots act on the fake clock; the hero checks or calls). */
async function until(h: Harness, done: () => boolean, hero = true): Promise<void> {
  for (let i = 0; i < 400 && !done(); i++) {
    const s = h.state();
    if (hero && s.game.mode === 'heroTurn' && s.game.legal !== null) {
      h.dispatch({
        type: 'act',
        action: s.game.legal.canCheck ? { type: 'check' } : { type: 'call' },
      });
      continue;
    }
    await tick();
  }
  expect(done()).toBe(true);
}

describe('installCues with the controller (§12.8, §12.13)', () => {
  let h: Harness;
  let page: Page | null = null;
  beforeEach(() => {
    vi.useFakeTimers();
    h = makeHarness({ settings: { players: 3, speed: 'normal', autoNext: true } });
    h.dispatch({ type: 'go', screen: 'home' });
  });
  afterEach(() => {
    page?.uninstall();
    page = null;
    h.controller.dispose();
    vi.useRealTimers();
  });

  it('Play unlocks the audio inside its own dispatch (the tap), then the deal sounds', async () => {
    page = await install(h);
    expect(page.loads).toBe(1); // loaded at once: sound is on
    expect(page.synth.unlocks).toBe(0);
    h.dispatch({ type: 'play' });
    // Synchronously, before the dispatch returned: still inside the tap's event handler.
    expect(page.synth.unlocks).toBe(1);
    expect(page.synth.played.slice(0, 2)).toEqual([deal(0), deal(60)]);
  });

  it('a real hand: actions, your turn with 10 ms of vibration, and a win with 20 ms', async () => {
    page = await install(h);
    h.dispatch({ type: 'play' });
    await until(h, () => page?.synth.played.some((c) => c.cue === 'turn') ?? false, false);
    expect(page.vibrations).toContainEqual(expect.anything());
    const turnAt = page.synth.played.find((c) => c.cue === 'turn')?.delayMs ?? 0;
    expect(page.vibrations[0]).toEqual(turnAt > 0 ? [0, turnAt, 10] : 10);
    // Play hands until the hero wins one: chips, checks and folds sounded meanwhile.
    await until(h, () => page?.synth.played.some((c) => c.cue === 'win') ?? false);
    const kinds = new Set(page.synth.played.map((c) => c.cue));
    expect(kinds).toContain('deal');
    expect(kinds).toContain('chip');
    const win = page.synth.played.find((c) => c.cue === 'win') as TimedCue;
    expect(page.vibrations).toContainEqual(win.delayMs > 0 ? [0, win.delayMs, 20] : 20);
  }, 20_000);

  it('sound off: no synth (not even loaded), the vibration stays; vibration off: none', async () => {
    h.dispatch({ type: 'settings', patch: { sound: false } });
    page = await install(h);
    expect(page.loads).toBe(0);
    h.dispatch({ type: 'play' });
    await until(h, () => (page?.vibrations.length ?? 0) > 0, false);
    expect(page.loads).toBe(0);
    expect(page.synth.played).toEqual([]);

    h.dispatch({ type: 'settings', patch: { haptics: false } });
    const before = page.vibrations.length;
    await until(h, () => (h.state().game.hand?.handSeq ?? 0) >= 3);
    expect(page.vibrations.length).toBe(before);
  }, 20_000);

  it('turning sound on loads the synth; in that same tap a loaded synth is unlocked; off pauses it', async () => {
    h.dispatch({ type: 'settings', patch: { sound: false } });
    page = await install(h);
    h.dispatch({ type: 'play' });
    h.dispatch({ type: 'settings', patch: { sound: true } });
    expect(page.loads).toBe(1);
    await flush();
    expect(page.synth.unlocks).toBe(0); // it was not there yet in that tap
    // The next tap at the table brings it in.
    page.win.dispatchEvent(new Event('click'));
    expect(page.synth.unlocks).toBe(1);
    h.dispatch({ type: 'settings', patch: { sound: false } });
    expect(page.synth.pauses).toBe(1);
    h.dispatch({ type: 'settings', patch: { sound: true } });
    expect(page.synth.unlocks).toBe(2); // loaded now: unlocked inside the switch's own tap
  });

  it('a tap retries only at the table, with sound on, when the audio is not running', async () => {
    page = await install(h);
    page.win.dispatchEvent(new Event('click')); // Home: not yet
    expect(page.synth.unlocks).toBe(0);
    h.dispatch({ type: 'play' });
    expect(page.synth.unlocks).toBe(1);
    page.win.dispatchEvent(new Event('keydown')); // running: nothing to do
    expect(page.synth.unlocks).toBe(1);
    page.synth.running = false; // iOS stopped it (a call)
    page.win.dispatchEvent(new Event('touchend'));
    expect(page.synth.unlocks).toBe(2);
  });

  it('without navigator.vibrate (iOS) nothing breaks; the sounds go on', async () => {
    page = await install(h, { noVibrate: true });
    h.dispatch({ type: 'play' });
    await until(h, () => page?.synth.played.some((c) => c.cue === 'turn') ?? false, false);
    expect(page.vibrations).toEqual([]);
  });

  it('nothing while hidden or off the Table; the synth closes on uninstall', async () => {
    page = await install(h);
    h.dispatch({ type: 'play' });
    const played = page.synth.played.length;
    h.dispatch({ type: 'visibility', hidden: true });
    await tick();
    await tick();
    expect(page.synth.played.length).toBe(played);
    page.uninstall();
    expect(page.synth.closed).toBe(true);
    h.dispatch({ type: 'visibility', hidden: false });
    await until(h, () => (h.state().game.hand?.handSeq ?? 0) >= 2);
    expect(page.synth.played.length).toBe(played);
    page = null;
  }, 20_000);
});
