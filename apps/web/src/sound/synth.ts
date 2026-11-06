/**
 * The game's sounds, synthesised with the Web Audio API (PLAN §12.8, §12.13): no audio files, so
 * no licences (§2.5). This is a lazy chunk: `app/cues.ts` loads it only while sound is on, never
 * with the first screen (§15.3).
 *
 * - One AudioContext, made and resumed by `unlock()`, which runs inside a tap (§12.13: Play,
 *   Setup's Start game, the sound switch, or a later tap at the table when that did not work).
 *   Where `navigator.audioSession` exists (iOS Safari) its type is set to 'ambient' first: the
 *   silent switch then mutes the game, and music playing in another app goes on.
 * - Master gain 0.5. Six cues (§12.8, `RECIPE`): deal, chip, check, fold, your turn, win. There is
 *   no mistake sound: never shame the player.
 * - A cue is scheduled on the audio clock (`currentTime` + its delay), so no timer runs (§0.3).
 * - Noise comes from a small fixed generator (xorshift32): `Math.random` is banned in `src/`.
 *
 * Nothing here throws: a browser without Web Audio gets `null` from `createSynth`, and a context
 * that cannot be made or resumed stays silent.
 */

/** The six sounds (§12.8). */
export type Cue = 'deal' | 'chip' | 'check' | 'fold' | 'turn' | 'win';

/** Every cue, in the §12.8 order. */
export const CUES: readonly Cue[] = ['deal', 'chip', 'check', 'fold', 'turn', 'win'];

/** The parts of `window` the synth reads (tests pass a stand-in). */
export interface AudioHost {
  readonly AudioContext?: unknown;
  /** Safari before 14.1. */
  readonly webkitAudioContext?: unknown;
  readonly navigator?: unknown;
}

export interface Synth {
  /**
   * Inside a tap (§12.13): makes the AudioContext the first time, and resumes it when it is not
   * running (suspended, or iOS's 'interrupted' after a call).
   */
  unlock(): void;
  /** Sound turned off: the context is suspended (no audio thread runs for nothing). */
  pause(): void;
  /**
   * Plays `cue` `delayMs` from now. Nothing while there is no context, or it is neither running
   * nor asked to resume in the last `RESUME_GRACE_MS`: a `resume()` outside a tap can wait until
   * the next tap, and the cues of that wait must not burst out then.
   */
  play(cue: Cue, delayMs?: number): void;
  /** The context runs: a cue played now is heard. */
  readonly running: boolean;
  /** Closes the context for good (tests, and the app when it is torn down). */
  close(): void;
}

/**
 * PLAN §12.8, in seconds and hertz, and how loud each cue is under the master gain. The check is
 * a triangle wave: phone speakers barely play a 180 Hz sine, and the triangle's overtones (540,
 * 900 Hz) make it heard at the same pitch. The win's three notes start 90 ms apart.
 */
export const RECIPE = {
  master: 0.5,
  deal: { seconds: 0.03, bandPassHz: 3000, peak: 0.8 },
  chip: { hz: [2200, 3100], seconds: 0.06, peak: 0.22 },
  check: { hz: 180, seconds: 0.04, peak: 0.7 },
  fold: { seconds: 0.12, fromHz: 4000, toHz: 800, peak: 0.5 },
  turn: { hz: [660, 880], seconds: 0.06, peak: 0.3 },
  win: { hz: [523, 659, 784], stepSeconds: 0.09, seconds: 0.16, peak: 0.26 },
} as const;

/** A cue starts this far ahead, so its first sample is never in the past. */
const LEAD_SECONDS = 0.005;
/** Exponential ramps cannot reach 0: this is silence. */
const SILENT = 0.0001;
const ATTACK_SECONDS = 0.003;
/** Seconds of white noise, enough for the longest noise cue (fold, 120 ms). */
const NOISE_SECONDS = 0.15;
/**
 * A context that is resuming takes cues for this long (Safari's `resume()` settles a moment after
 * the tap). After that only a running context does: a `resume()` the browser holds until the next
 * tap would otherwise collect every cue meanwhile and play them all at once.
 */
export const RESUME_GRACE_MS = 1000;

/** `obj[key]` without throwing (a getter may throw). */
function read(obj: unknown, key: string): unknown {
  if (obj === null || (typeof obj !== 'object' && typeof obj !== 'function')) return undefined;
  try {
    return (obj as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

type ContextClass = new () => AudioContext;

function contextClass(host: AudioHost): ContextClass | null {
  const ctor = read(host, 'AudioContext') ?? read(host, 'webkitAudioContext');
  return typeof ctor === 'function' ? (ctor as ContextClass) : null;
}

/**
 * iOS (§12.13): the 'ambient' audio session mixes with other apps' audio and obeys the silent
 * switch. Feature-detected; which iOS versions honour it is UNVERIFIED (risk register).
 */
function setAmbient(host: AudioHost): void {
  const session = read(read(host, 'navigator'), 'audioSession');
  if (session === null || typeof session !== 'object') return;
  try {
    (session as { type: string }).type = 'ambient';
  } catch {
    // Read-only here: the platform's default session.
  }
}

/** One channel of white noise from xorshift32 (deterministic; `Math.random` is banned). */
export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const length = Math.max(1, Math.round(ctx.sampleRate * NOISE_SECONDS));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let x = 0x2545f491;
  for (let i = 0; i < length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    data[i] = (x >>> 0) / 0x80000000 - 1;
  }
  return buffer;
}

/** A gain that rises to `peak` at once and dies away by `t + seconds`. */
function envelope(ctx: BaseAudioContext, t: number, peak: number, seconds: number): GainNode {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(SILENT, t);
  gain.gain.exponentialRampToValueAtTime(peak, t + ATTACK_SECONDS);
  gain.gain.exponentialRampToValueAtTime(SILENT, t + seconds);
  return gain;
}

function tone(
  ctx: BaseAudioContext,
  out: AudioNode,
  hz: number,
  t: number,
  seconds: number,
  peak: number,
  type: OscillatorType = 'sine',
): void {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(hz, t);
  const gain = envelope(ctx, t, peak, seconds);
  osc.connect(gain);
  gain.connect(out);
  osc.start(t);
  osc.stop(t + seconds);
}

/** Noise through `filter`, shaped by the envelope. */
function burst(
  ctx: BaseAudioContext,
  out: AudioNode,
  noise: AudioBuffer,
  filter: BiquadFilterNode,
  t: number,
  seconds: number,
  peak: number,
): void {
  const source = ctx.createBufferSource();
  source.buffer = noise;
  const gain = envelope(ctx, t, peak, seconds);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(out);
  source.start(t, 0, seconds);
}

/** Builds one cue's sound graph, starting at `t` on the context's clock. */
export function schedule(
  ctx: BaseAudioContext,
  out: AudioNode,
  noise: AudioBuffer,
  cue: Cue,
  t: number,
): void {
  switch (cue) {
    case 'deal': {
      const { seconds, bandPassHz, peak } = RECIPE.deal;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(bandPassHz, t);
      burst(ctx, out, noise, filter, t, seconds, peak);
      return;
    }
    case 'chip': {
      const { hz, seconds, peak } = RECIPE.chip;
      for (const f of hz) tone(ctx, out, f, t, seconds, peak);
      return;
    }
    case 'check': {
      const { hz, seconds, peak } = RECIPE.check;
      tone(ctx, out, hz, t, seconds, peak, 'triangle');
      return;
    }
    case 'fold': {
      const { seconds, fromHz, toHz, peak } = RECIPE.fold;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(fromHz, t);
      filter.frequency.exponentialRampToValueAtTime(toHz, t + seconds);
      burst(ctx, out, noise, filter, t, seconds, peak);
      return;
    }
    case 'turn': {
      const { hz, seconds, peak } = RECIPE.turn;
      hz.forEach((f, i) => tone(ctx, out, f, t + i * seconds, seconds, peak));
      return;
    }
    case 'win': {
      const { hz, stepSeconds, seconds, peak } = RECIPE.win;
      hz.forEach((f, i) => tone(ctx, out, f, t + i * stepSeconds, seconds, peak));
      return;
    }
  }
}

/**
 * The synth for `host` (the window), or null when this browser has no Web Audio. `now` is a clock
 * in ms (tests pass their own).
 */
export function createSynth(host: AudioHost, now: () => number = Date.now): Synth | null {
  const Context = contextClass(host);
  if (Context === null) return null;
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let noise: AudioBuffer | null = null;
  /** When the `resume()` on its way was asked for, or null: cues wait for it (`RESUME_GRACE_MS`). */
  let resumeAskedAt: number | null = null;
  let closed = false;

  const resume = (c: AudioContext): void => {
    if (c.state === 'running' || c.state === 'closed') return;
    const asked = now();
    resumeAskedAt = asked;
    const settle = (): void => {
      if (resumeAskedAt === asked) resumeAskedAt = null;
    };
    try {
      Promise.resolve(c.resume()).then(settle, settle);
    } catch {
      settle();
    }
  };

  /** A cue played now is heard now, or once the resume asked for a moment ago lands. */
  const audible = (c: AudioContext): boolean =>
    c.state === 'running' || (resumeAskedAt !== null && now() - resumeAskedAt <= RESUME_GRACE_MS);

  return {
    get running() {
      return ctx !== null && ctx.state === 'running';
    },
    unlock() {
      if (closed) return;
      if (ctx === null) {
        setAmbient(host);
        let made: AudioContext | null = null;
        try {
          made = new Context();
          const gain = made.createGain();
          gain.gain.value = RECIPE.master;
          gain.connect(made.destination);
          ctx = made;
          master = gain;
        } catch {
          // Refused (too many contexts, a policy): stay silent, and free what was made.
          if (made !== null) closeQuietly(made);
          return;
        }
      }
      resume(ctx);
    },
    pause() {
      resumeAskedAt = null;
      if (ctx === null || ctx.state === 'closed') return;
      try {
        Promise.resolve(ctx.suspend()).catch(() => {});
      } catch {
        // Nothing to suspend.
      }
    },
    play(cue, delayMs = 0) {
      if (ctx === null || master === null || !audible(ctx)) return;
      try {
        noise ??= noiseBuffer(ctx);
        const t = ctx.currentTime + LEAD_SECONDS + Math.max(0, delayMs) / 1000;
        schedule(ctx, master, noise, cue, t);
      } catch {
        // A browser that refuses a node: this cue is silent, the game goes on.
      }
    },
    close() {
      closed = true;
      resumeAskedAt = null;
      const c = ctx;
      ctx = null;
      master = null;
      if (c !== null) closeQuietly(c);
    },
  };
}

/** Closes `c`; one already closed (or refusing) is fine. */
function closeQuietly(c: AudioContext): void {
  try {
    Promise.resolve(c.close()).catch(() => {});
  } catch {
    // Already closed.
  }
}
