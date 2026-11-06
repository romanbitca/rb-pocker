/**
 * The synthesised sounds (PLAN §12.8, §12.13): the AudioContext is made and resumed by `unlock()`
 * (inside a tap), with the 'ambient' audio session first where it exists; each cue's sound graph
 * has the §12.8 numbers; nothing plays without a running (or just resuming) context; Web Audio
 * missing or refusing never throws. Runs on a stand-in AudioContext (`fakeAudio.ts`).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createSynth,
  CUES,
  noiseBuffer,
  RECIPE,
  RESUME_GRACE_MS,
  type Synth,
} from '../../src/sound/synth.ts';
import {
  FakeAudioContext,
  flushPromises,
  type FakeBufferSource,
  type FakeFilter,
  type FakeGain,
  type FakeOscillator,
} from './fakeAudio.ts';

beforeEach(() => FakeAudioContext.reset());
afterEach(() => FakeAudioContext.reset());

/** A clock the test moves. */
function clock(): { now: () => number; advance: (ms: number) => void } {
  let t = 1_000;
  return { now: () => t, advance: (ms) => (t += ms) };
}

/** A synth on the stand-in, unlocked and running. */
async function running(): Promise<{ synth: Synth; ctx: FakeAudioContext }> {
  const synth = createSynth({ AudioContext: FakeAudioContext }) as Synth;
  synth.unlock();
  await flushPromises();
  const ctx = FakeAudioContext.made[0] as FakeAudioContext;
  expect(ctx.state).toBe('running');
  return { synth, ctx };
}

/** The nodes one cue added. */
function cueNodes(ctx: FakeAudioContext, play: () => void) {
  const before = ctx.nodes.length;
  play();
  const added = ctx.nodes.slice(before);
  return {
    oscillators: added.filter((n) => n.kind === 'oscillator') as FakeOscillator[],
    filters: added.filter((n) => n.kind === 'filter') as FakeFilter[],
    sources: added.filter((n) => n.kind === 'bufferSource') as FakeBufferSource[],
    gains: added.filter((n) => n.kind === 'gain') as FakeGain[],
  };
}

const freq = (o: FakeOscillator) => o.frequency.events[0]?.value;

describe('createSynth and unlock (§12.13)', () => {
  it('is null without Web Audio, and takes the prefixed context of old Safari', () => {
    expect(createSynth({})).toBeNull();
    expect(createSynth({ AudioContext: 'not a class' })).toBeNull();
    const synth = createSynth({ webkitAudioContext: FakeAudioContext });
    expect(synth).not.toBeNull();
    synth?.unlock();
    expect(FakeAudioContext.made).toHaveLength(1);
  });

  it('makes no context until unlock(), then one, resumed; a master gain of 0.5 to the speakers', async () => {
    const synth = createSynth({ AudioContext: FakeAudioContext }) as Synth;
    synth.play('chip');
    expect(FakeAudioContext.made).toHaveLength(0);
    expect(synth.running).toBe(false);

    synth.unlock();
    const ctx = FakeAudioContext.made[0] as FakeAudioContext;
    expect(ctx.resumes).toBe(1);
    const [master] = ctx.of<FakeGain>('gain');
    expect(master?.gain.value).toBe(RECIPE.master);
    expect(RECIPE.master).toBe(0.5);
    expect(master?.out).toEqual([ctx.destination]);
    await flushPromises();
    expect(synth.running).toBe(true);

    // A second unlock keeps the one context, and a running one is not resumed again.
    synth.unlock();
    expect(FakeAudioContext.made).toHaveLength(1);
    expect(ctx.resumes).toBe(1);
  });

  it("sets navigator.audioSession to 'ambient' before the context is made, where it exists", () => {
    const audioSession = { type: 'auto' };
    let typeWhenMade = '';
    class Watching extends FakeAudioContext {
      constructor() {
        super();
        typeWhenMade = audioSession.type;
      }
    }
    (createSynth({ AudioContext: Watching, navigator: { audioSession } }) as Synth).unlock();
    expect(typeWhenMade).toBe('ambient');
    expect(audioSession.type).toBe('ambient');
  });

  it('a read-only audio session, or none, changes nothing and throws nothing', () => {
    const frozen = Object.freeze({ type: 'auto' });
    const a = createSynth({ AudioContext: FakeAudioContext, navigator: { audioSession: frozen } });
    expect(() => a?.unlock()).not.toThrow();
    const b = createSynth({ AudioContext: FakeAudioContext, navigator: {} });
    expect(() => b?.unlock()).not.toThrow();
    expect(FakeAudioContext.made).toHaveLength(2);
  });

  it('resumes a context that was stopped (iOS after a call: "interrupted")', async () => {
    const { synth, ctx } = await running();
    ctx.state = 'interrupted';
    expect(synth.running).toBe(false);
    synth.unlock();
    expect(ctx.resumes).toBe(2);
    await flushPromises();
    expect(synth.running).toBe(true);
  });

  it('a context that refuses its first node is closed again: silent, no throw', () => {
    class Refusing extends FakeAudioContext {
      override createGain(): never {
        throw new Error('refused');
      }
    }
    const synth = createSynth({ AudioContext: Refusing }) as Synth;
    expect(() => synth.unlock()).not.toThrow();
    expect(FakeAudioContext.made[0]?.closes).toBe(1);
    expect(synth.running).toBe(false);
    expect(() => synth.play('chip')).not.toThrow();
  });

  it('a browser that refuses the context: silent, no throw', () => {
    FakeAudioContext.failing = true;
    const synth = createSynth({ AudioContext: FakeAudioContext }) as Synth;
    expect(() => synth.unlock()).not.toThrow();
    expect(() => synth.play('win')).not.toThrow();
    expect(synth.running).toBe(false);
  });
});

describe('the six cues (§12.8)', () => {
  it('deal: 30 ms of noise through a 3 kHz band-pass', async () => {
    const { synth, ctx } = await running();
    const { sources, filters, oscillators } = cueNodes(ctx, () => synth.play('deal'));
    expect(oscillators).toHaveLength(0);
    expect(sources).toHaveLength(1);
    expect(filters.map((f) => [f.type, f.frequency.events[0]?.value])).toEqual([
      ['bandpass', 3000],
    ]);
    const source = sources[0] as FakeBufferSource;
    expect(source.out).toEqual([filters[0]]);
    expect(source.started?.duration).toBeCloseTo(0.03, 6);
  });

  it('chip: 2.2 and 3.1 kHz sines that die away in 60 ms', async () => {
    const { synth, ctx } = await running();
    const { oscillators, sources } = cueNodes(ctx, () => synth.play('chip'));
    expect(sources).toHaveLength(0);
    expect(oscillators.map((o) => [o.type, freq(o)])).toEqual([
      ['sine', 2200],
      ['sine', 3100],
    ]);
    for (const o of oscillators) expect((o.stopped ?? 0) - (o.started ?? 0)).toBeCloseTo(0.06, 6);
  });

  it('check: 40 ms at 180 Hz (a triangle, heard on phone speakers)', async () => {
    const { synth, ctx } = await running();
    const { oscillators } = cueNodes(ctx, () => synth.play('check'));
    expect(oscillators.map((o) => [o.type, freq(o)])).toEqual([['triangle', 180]]);
    const o = oscillators[0] as FakeOscillator;
    expect((o.stopped ?? 0) - (o.started ?? 0)).toBeCloseTo(0.04, 6);
  });

  it('fold: 120 ms of noise, the low-pass sweeping from 4 kHz down to 800 Hz', async () => {
    const { synth, ctx } = await running();
    const { sources, filters } = cueNodes(ctx, () => synth.play('fold'));
    const filter = filters[0] as FakeFilter;
    expect(filter.type).toBe('lowpass');
    const [from, to] = filter.frequency.events;
    expect(from).toMatchObject({ kind: 'set', value: 4000 });
    expect(to).toMatchObject({ kind: 'exp', value: 800 });
    expect((to?.time ?? 0) - (from?.time ?? 0)).toBeCloseTo(0.12, 6);
    expect(sources[0]?.started?.duration).toBeCloseTo(0.12, 6);
  });

  it('your turn: 660 Hz, then 880 Hz, 60 ms each', async () => {
    const { synth, ctx } = await running();
    const { oscillators } = cueNodes(ctx, () => synth.play('turn'));
    expect(oscillators.map(freq)).toEqual([660, 880]);
    const [a, b] = oscillators as [FakeOscillator, FakeOscillator];
    expect((b.started ?? 0) - (a.started ?? 0)).toBeCloseTo(0.06, 6);
    expect((a.stopped ?? 0) - (a.started ?? 0)).toBeCloseTo(0.06, 6);
  });

  it('win: the 523/659/784 Hz arpeggio, one note every 90 ms', async () => {
    const { synth, ctx } = await running();
    const { oscillators } = cueNodes(ctx, () => synth.play('win'));
    expect(oscillators.map(freq)).toEqual([523, 659, 784]);
    const starts = oscillators.map((o) => o.started ?? 0);
    expect((starts[1] ?? 0) - (starts[0] ?? 0)).toBeCloseTo(0.09, 6);
    expect((starts[2] ?? 0) - (starts[1] ?? 0)).toBeCloseTo(0.09, 6);
  });

  it('every cue ends in silence and goes to the master gain; there is no mistake sound', async () => {
    const { synth, ctx } = await running();
    const master = ctx.of<FakeGain>('gain')[0] as FakeGain;
    expect(CUES).toEqual(['deal', 'chip', 'check', 'fold', 'turn', 'win']);
    for (const cue of CUES) {
      const { gains } = cueNodes(ctx, () => synth.play(cue));
      expect(gains.length, cue).toBeGreaterThan(0);
      for (const g of gains) {
        expect(g.out, cue).toEqual([master]);
        const last = g.gain.events[g.gain.events.length - 1];
        expect(last?.kind, cue).toBe('exp');
        expect(last?.value, cue).toBeLessThan(0.001);
      }
    }
  });

  it('a delay starts the cue later on the audio clock (no timer)', async () => {
    const { synth, ctx } = await running();
    ctx.currentTime = 12.5;
    const now = cueNodes(ctx, () => synth.play('check')).oscillators[0]?.started ?? 0;
    const later = cueNodes(ctx, () => synth.play('check', 150)).oscillators[0]?.started ?? 0;
    expect(now).toBeGreaterThanOrEqual(12.5);
    expect(later - now).toBeCloseTo(0.15, 6);
  });

  it('the noise is made once per context and is real noise, without Math.random', async () => {
    const { synth, ctx } = await running();
    synth.play('deal');
    synth.play('fold');
    synth.play('deal');
    expect(ctx.buffers).toBe(1);
    const sources = ctx.of<FakeBufferSource>('bufferSource');
    expect(new Set(sources.map((s) => s.buffer)).size).toBe(1);

    const data = (
      noiseBuffer(ctx as unknown as BaseAudioContext) as unknown as {
        getChannelData(): Float32Array;
      }
    ).getChannelData();
    expect(data.length).toBe(Math.round(ctx.sampleRate * 0.15));
    let min = 1;
    let max = -1;
    let sum = 0;
    for (const v of data) {
      min = Math.min(min, v);
      max = Math.max(max, v);
      sum += v;
    }
    expect(min).toBeGreaterThanOrEqual(-1);
    expect(max).toBeLessThan(1);
    expect(max - min).toBeGreaterThan(1.9);
    expect(Math.abs(sum / data.length)).toBeLessThan(0.02);
  });
});

describe('when cues are heard (§12.13)', () => {
  it('a context resuming takes cues for a moment, then only a running one does', () => {
    FakeAudioContext.resumeMode = 'pending'; // a browser that waits for a tap
    const c = clock();
    const synth = createSynth({ AudioContext: FakeAudioContext }, c.now) as Synth;
    synth.unlock();
    const ctx = FakeAudioContext.made[0] as FakeAudioContext;
    expect(cueNodes(ctx, () => synth.play('chip')).oscillators).toHaveLength(2);
    c.advance(RESUME_GRACE_MS + 1);
    // Still not running: cues are dropped, not piled up for a burst after the next tap.
    expect(cueNodes(ctx, () => synth.play('chip')).oscillators).toHaveLength(0);
    // The next tap resumes it.
    FakeAudioContext.resumeMode = 'resolve';
    synth.unlock();
    expect(cueNodes(ctx, () => synth.play('chip')).oscillators).toHaveLength(2);
  });

  it('a refused resume drops the cues once it has answered', async () => {
    FakeAudioContext.resumeMode = 'reject';
    const synth = createSynth({ AudioContext: FakeAudioContext }) as Synth;
    synth.unlock();
    await flushPromises();
    const ctx = FakeAudioContext.made[0] as FakeAudioContext;
    expect(cueNodes(ctx, () => synth.play('win')).oscillators).toHaveLength(0);
  });

  it('pause() suspends the context: silent until the next unlock()', async () => {
    const { synth, ctx } = await running();
    synth.pause();
    expect(ctx.suspends).toBe(1);
    expect(synth.running).toBe(false);
    expect(cueNodes(ctx, () => synth.play('turn')).oscillators).toHaveLength(0);
    synth.unlock();
    await flushPromises();
    expect(cueNodes(ctx, () => synth.play('turn')).oscillators).toHaveLength(2);
  });

  it('close() closes the context for good', async () => {
    const { synth, ctx } = await running();
    synth.close();
    expect(ctx.closes).toBe(1);
    synth.unlock();
    synth.play('deal');
    expect(FakeAudioContext.made).toHaveLength(1);
    expect(ctx.of('bufferSource')).toHaveLength(0);
    expect(() => synth.pause()).not.toThrow();
  });

  it('a node the browser refuses silences that cue only', async () => {
    const { synth, ctx } = await running();
    const original = ctx.createOscillator.bind(ctx);
    ctx.createOscillator = () => {
      throw new Error('refused');
    };
    expect(() => synth.play('chip')).not.toThrow();
    ctx.createOscillator = original;
    expect(cueNodes(ctx, () => synth.play('chip')).oscillators).toHaveLength(2);
  });
});
