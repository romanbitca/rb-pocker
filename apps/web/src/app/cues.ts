/**
 * Sounds and vibration at the table (PLAN §12.8, §12.13). What happens in a hand is read from the
 * store's changes and becomes cues for the synth (`sound/synth.ts`, a lazy chunk loaded only while
 * sound is on) and for `navigator.vibrate` (Android; a no-op where it is missing, as on iOS; inside
 * Telegram its haptic feedback instead, §19.7). This file is part of the lazy `app/device.ts` chunk.
 *
 * The cues (`nextCues`, pure):
 * - deal: a hand comes on screen just dealt (the hero's two cards, `DEAL_STAGGER_MS` apart at
 *   Normal speed and scaled like the deal animation, §12.8), and every new board card;
 * - chip, check, fold: every player's action (a call, bet or raise is a chip);
 * - turn: a new hero decision, except the one an Undo brings back; after the deal's sounds when
 *   both come at once. 10 ms of vibration;
 * - win: the hand ends and the hero won chips (net > 0). 20 ms of vibration.
 * Blinds, refunds, reveals and awards make no sound, and there is no mistake sound (§12.8). Cues
 * play only while the Table is on screen and the page is visible: what happens elsewhere (a hand
 * finished without animation for a new table, §3.1) is passed over, never played late.
 *
 * The AudioContext is made inside a tap (§12.13). The tap that puts the Table on screen (Play,
 * Setup's Start game) changes the store inside its own event handler, so the change below runs
 * inside that tap; so does the tap that turns sound on (Settings, the mute button). A later tap at
 * the table brings the sound back when that did not work: the synth was still loading, the Table
 * came after the new-table dialog's wait or after a Play that waited for the tab lock (§14.7), or
 * iOS stopped the context (a call, the background).
 */
import type { HandState, LogEvent, PlayerAction } from '../engine/types.ts';
import type { AudioHost, Cue, Synth } from '../sound/synth.ts';
import type { AppState, AppStore, Speed } from './store.ts';

/** A cue and when it starts, in ms from now. */
export interface TimedCue {
  readonly cue: Cue;
  readonly delayMs: number;
}

/** What the cues have already sounded, or passed over. */
export interface CueMemory {
  /** The hand whose log has been read up to `logLength`. */
  readonly handSeq: number | null;
  readonly logLength: number;
  /** The hand whose deal was sounded (or passed over: it was already under way when shown). */
  readonly dealt: number | null;
  /**
   * The hero decision whose "your turn" was sounded or passed over: its hand and the length of
   * the hand's log when it began (a decision point, like `coachKeyOf`).
   */
  readonly turnHand: number | null;
  readonly turnLog: number;
  /** The hand whose end was sounded or passed over. */
  readonly ended: number | null;
}

export const NO_CUES: CueMemory = {
  handSeq: null,
  logLength: 0,
  dealt: null,
  turnHand: null,
  turnLog: 0,
  ended: null,
};

/** The hero's seat (§0.3). */
const HERO = 0;
/** One card every 60 ms at Normal speed (§12.8, the controller's `TIMING.dealStaggerMs`). */
export const DEAL_STAGGER_MS = 60;
/** The animation factor per speed (§12.8, the controller's `SPEED_FACTOR`). */
export const CUE_SPEED: Readonly<Record<Speed, number>> = { normal: 1, fast: 0.5, instant: 0 };
/** "Your turn" and "win" start this long after the other cues of the same moment. */
export const CUE_GAP_MS = 150;
/** Vibration per cue (§12.8): 10 ms on your turn, 20 ms on a win. */
export const HAPTIC_MS: Readonly<Partial<Record<Cue, number>>> = { turn: 10, win: 20 };

const ACTION_CUE: Readonly<Record<PlayerAction['type'], Cue>> = {
  fold: 'fold',
  check: 'check',
  call: 'chip',
  bet: 'chip',
  raise: 'chip',
};

/** `count` deal sounds from `from`, `stagger` apart (one sound when nothing is staggered). */
function deals(count: number, stagger: number, from: number): TimedCue[] {
  if (count <= 0) return [];
  const n = stagger > 0 ? count : 1;
  return Array.from({ length: n }, (_, i) => ({
    cue: 'deal' as const,
    delayMs: from + i * stagger,
  }));
}

/** When a cue that follows the others may start. */
const after = (cues: readonly TimedCue[]): number =>
  cues.length === 0 ? 0 : Math.max(...cues.map((c) => c.delayMs)) + CUE_GAP_MS;

/**
 * The cues of new log events: actions and board cards. One change of the store normally brings
 * one event; several (rare) are spaced, never sounded on top of each other.
 */
function eventCues(events: readonly LogEvent[], stagger: number): TimedCue[] {
  const cues: TimedCue[] = [];
  for (const e of events) {
    if (e.e === 'act') cues.push({ cue: ACTION_CUE[e.action.type], delayMs: after(cues) });
    else if (e.e === 'street') cues.push(...deals(e.cards.length, stagger, after(cues)));
  }
  return cues;
}

/** Only the blinds so far: the cards were just dealt. */
const justDealt = (hand: HandState): boolean => hand.log.every((e) => e.e === 'post');

/**
 * The cues of the state `s`, given what was sounded before (`memory`), and the memory after it.
 * Pure: the installer calls it on every store change.
 */
export function nextCues(memory: CueMemory, s: AppState): { memory: CueMemory; cues: TimedCue[] } {
  const hand = s.game.hand;
  if (hand === null) return { memory, cues: [] };
  const live = s.ui.screen === 'table' && !s.ui.hidden;
  const stagger = DEAL_STAGGER_MS * CUE_SPEED[s.settings.speed];
  let m = memory;
  let cues: TimedCue[] = [];

  // What happened since the last look. Another hand's earlier events are not news.
  if (hand.handSeq !== m.handSeq) {
    m = { ...m, handSeq: hand.handSeq, logLength: hand.log.length };
  } else if (hand.log.length !== m.logLength) {
    // A shorter log is an Undo: nothing to sound.
    if (live && hand.log.length > m.logLength) {
      cues = eventCues(hand.log.slice(m.logLength), stagger);
    }
    m = { ...m, logLength: hand.log.length };
  }

  // The deal, once per hand, when the hand is first on screen.
  if (live && m.dealt !== hand.handSeq) {
    if (justDealt(hand)) cues = [...deals(2, stagger, 0), ...cues];
    m = { ...m, dealt: hand.handSeq };
  }

  // A new hero decision.
  if (
    live &&
    s.game.mode === 'heroTurn' &&
    (m.turnHand !== hand.handSeq || m.turnLog !== hand.log.length)
  ) {
    if (hand.log[hand.log.length - 1]?.e !== 'reshuffle') {
      cues = [...cues, { cue: 'turn', delayMs: after(cues) }];
    }
    m = { ...m, turnHand: hand.handSeq, turnLog: hand.log.length };
  }

  // The hand end: once, a win when the hero gained chips.
  if (hand.phase === 'complete' && m.ended !== hand.handSeq) {
    if (live && (hand.result?.net[HERO] ?? 0) > 0) {
      cues = [...cues, { cue: 'win', delayMs: after(cues) }];
    }
    m = { ...m, ended: hand.handSeq };
  }

  return { memory: m, cues };
}

/** `obj[key]` without throwing (a getter may throw). */
function read(obj: unknown, key: string): unknown {
  if (obj === null || (typeof obj !== 'object' && typeof obj !== 'function')) return undefined;
  try {
    return (obj as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

/**
 * Android's vibration (§12.8): `ms` long, starting `delayMs` from now (the pattern `[0, delay,
 * ms]`, so no timer runs, §0.3). False where `navigator.vibrate` is missing (iOS) or refuses
 * (Chrome before the first tap). Never throws.
 */
export function vibrate(nav: unknown, ms: number, delayMs = 0): boolean {
  const fn = read(nav, 'vibrate');
  if (typeof fn !== 'function') return false;
  const pattern = delayMs > 0 ? [0, Math.round(delayMs), ms] : ms;
  try {
    return (fn as (pattern: number | number[]) => unknown).call(nav, pattern) === true;
  } catch {
    return false;
  }
}

/** The lazy synth chunk, as `import()` gives it. */
export interface SynthModule {
  createSynth(host: AudioHost): Synth | null;
}

/** Another way to buzz the player's hand for a cue, `delayMs` from now (Telegram's, §19.7). */
export interface HapticsPort {
  pulse(cue: Cue, delayMs: number): void;
}

export interface CueOptions {
  /** Loads the synth (tests pass a fake); default: the lazy chunk `sound/synth.ts`. */
  loadSynth?: () => Promise<SynthModule>;
  /** The port that replaces `navigator.vibrate` right now, if any (asked at each cue). */
  haptics?: () => HapticsPort | null;
}

/** The taps that may start audio (user activation): a later tap at the table retries. */
const TAPS = ['click', 'keydown', 'touchend'] as const;

/** Plays the cues of the app's store changes (see the module note). Returns an uninstall. */
export function installCues(win: Window, store: AppStore, options: CueOptions = {}): () => void {
  const load = options.loadSynth ?? ((): Promise<SynthModule> => import('../sound/synth.ts'));
  let memory = NO_CUES;
  let synth: Synth | null = null;
  let loading = false;
  let disposed = false;

  /** Loads the synth once sound is on (never before, §15.3); again after a failed load. */
  const wantSynth = (): void => {
    if (synth !== null || loading || disposed) return;
    loading = true;
    load().then(
      (mod) => {
        if (!disposed) synth = mod.createSynth(win);
      },
      () => {
        loading = false;
      },
    );
  };

  const consume = (s: AppState): void => {
    const next = nextCues(memory, s);
    memory = next.memory;
    for (const { cue, delayMs } of next.cues) {
      if (s.settings.sound) synth?.play(cue, delayMs);
      const ms = HAPTIC_MS[cue];
      if (ms !== undefined && s.settings.haptics) {
        const port = options.haptics?.() ?? null;
        if (port !== null) port.pulse(cue, delayMs);
        else vibrate(win.navigator, ms, delayMs);
      }
    }
  };

  const unsubscribe = store.subscribe((s, prev) => {
    if (s.settings.sound) {
      wantSynth();
      // Inside the tap that turned sound on, or that put the Table on screen (§12.13).
      if (!prev.settings.sound || (s.ui.screen === 'table' && prev.ui.screen !== 'table')) {
        synth?.unlock();
      }
    } else if (prev.settings.sound) {
      synth?.pause();
    }
    // The hand and the screen: other changes (the win chance's progress) make no cue.
    if (s.game !== prev.game || s.ui !== prev.ui) consume(s);
  });

  const onTap = (): void => {
    const s = store.getState();
    if (synth !== null && !synth.running && s.settings.sound && s.ui.screen === 'table') {
      synth.unlock();
    }
  };
  for (const type of TAPS) win.addEventListener(type, onTap, { capture: true, passive: true });

  const first = store.getState();
  if (first.settings.sound) wantSynth();
  consume(first);

  return () => {
    disposed = true;
    unsubscribe();
    for (const type of TAPS) win.removeEventListener(type, onTap, { capture: true });
    synth?.close();
    synth = null;
  };
}
