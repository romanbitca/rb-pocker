/**
 * A stand-in for the Web Audio API (no browser audio in Node or jsdom): an AudioContext whose
 * nodes record what the synth asks of them, so a test can read back the sound graph of a cue.
 * `resumeMode` says how `resume()` answers: at once ('resolve': the context runs a microtask
 * later, as in a browser), never ('pending': a browser that waits for a tap) or with a refusal.
 */
type ParamEvent = { kind: 'set' | 'exp' | 'lin'; value: number; time: number };

export class FakeParam {
  value: number;
  readonly events: ParamEvent[] = [];
  constructor(value: number) {
    this.value = value;
  }
  setValueAtTime(value: number, time: number): this {
    this.events.push({ kind: 'set', value, time });
    return this;
  }
  exponentialRampToValueAtTime(value: number, time: number): this {
    this.events.push({ kind: 'exp', value, time });
    return this;
  }
  linearRampToValueAtTime(value: number, time: number): this {
    this.events.push({ kind: 'lin', value, time });
    return this;
  }
}

export class FakeNode {
  readonly out: FakeNode[] = [];
  readonly kind: string;
  constructor(kind: string, ctx: FakeAudioContext) {
    this.kind = kind;
    ctx.nodes.push(this);
  }
  connect<T extends FakeNode>(node: T): T {
    this.out.push(node);
    return node;
  }
  disconnect(): void {}
}

export class FakeGain extends FakeNode {
  readonly gain = new FakeParam(1);
}

export class FakeOscillator extends FakeNode {
  type = 'sine';
  readonly frequency = new FakeParam(440);
  started: number | null = null;
  stopped: number | null = null;
  start(time = 0): void {
    this.started = time;
  }
  stop(time = 0): void {
    this.stopped = time;
  }
}

export class FakeFilter extends FakeNode {
  type = 'lowpass';
  readonly frequency = new FakeParam(350);
  readonly Q = new FakeParam(1);
}

export class FakeBuffer {
  private readonly data: Float32Array;
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  constructor(numberOfChannels: number, length: number, sampleRate: number) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.data = new Float32Array(length);
  }
  getChannelData(): Float32Array {
    return this.data;
  }
}

export class FakeBufferSource extends FakeNode {
  buffer: FakeBuffer | null = null;
  started: { when: number; offset: number; duration: number } | null = null;
  start(when = 0, offset = 0, duration = Infinity): void {
    this.started = { when, offset, duration };
  }
  stop(): void {}
}

export class FakeAudioContext {
  /** Every context made since `reset()`. */
  static made: FakeAudioContext[] = [];
  /** How the next contexts' `resume()` answers. */
  static resumeMode: 'resolve' | 'pending' | 'reject' = 'resolve';
  /** The constructor throws (a browser that refuses another context). */
  static failing = false;

  static reset(): void {
    FakeAudioContext.made = [];
    FakeAudioContext.resumeMode = 'resolve';
    FakeAudioContext.failing = false;
  }

  state: 'suspended' | 'running' | 'closed' | 'interrupted' = 'suspended';
  currentTime = 0;
  readonly sampleRate = 48_000;
  readonly nodes: FakeNode[] = [];
  readonly destination: FakeNode;
  resumes = 0;
  suspends = 0;
  closes = 0;
  buffers = 0;

  constructor() {
    if (FakeAudioContext.failing) throw new Error('NotSupportedError');
    FakeAudioContext.made.push(this);
    this.destination = new FakeNode('destination', this);
  }

  createGain(): FakeGain {
    return new FakeGain('gain', this);
  }
  createOscillator(): FakeOscillator {
    return new FakeOscillator('oscillator', this);
  }
  createBiquadFilter(): FakeFilter {
    return new FakeFilter('filter', this);
  }
  createBufferSource(): FakeBufferSource {
    return new FakeBufferSource('bufferSource', this);
  }
  createBuffer(channels: number, length: number, sampleRate: number): FakeBuffer {
    this.buffers++;
    return new FakeBuffer(channels, length, sampleRate);
  }
  resume(): Promise<void> {
    this.resumes++;
    switch (FakeAudioContext.resumeMode) {
      case 'resolve':
        return Promise.resolve().then(() => {
          if (this.state !== 'closed') this.state = 'running';
        });
      case 'pending':
        return new Promise<void>(() => {});
      case 'reject':
        return Promise.reject(new Error('NotAllowedError'));
    }
  }
  suspend(): Promise<void> {
    this.suspends++;
    if (this.state !== 'closed') this.state = 'suspended';
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.closes++;
    this.state = 'closed';
    return Promise.resolve();
  }

  /** The nodes of one kind, in the order they were made. */
  of<T extends FakeNode>(kind: string): T[] {
    return this.nodes.filter((n) => n.kind === kind) as T[];
  }
}

/** Lets promise callbacks run. */
export async function flushPromises(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}
