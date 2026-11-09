import type { Clock, TimerHandle } from '../../src/mp/clock.js';

interface FakeTimer {
  id: number;
  at: number;
  fn: () => void;
}

/** A `Clock` that moves only when a test says so, and fires its timers in order of time. */
export class FakeClock implements Clock {
  private time: number;
  private nextId = 1;
  private readonly timers = new Map<number, FakeTimer>();

  constructor(start = 1_800_000_000_000) {
    this.time = start;
  }

  now(): number {
    return this.time;
  }

  setTimeout(fn: () => void, ms: number): TimerHandle {
    const id = this.nextId++;
    this.timers.set(id, { id, at: this.time + ms, fn });
    return id;
  }

  clearTimeout(handle: TimerHandle): void {
    this.timers.delete(handle as number);
  }

  /** How many timers wait. */
  get pending(): number {
    return this.timers.size;
  }

  /** Moves the clock on by `ms`, firing every timer that comes due, and those they arm. */
  advance(ms: number): void {
    const end = this.time + ms;
    for (;;) {
      const due = this.earliest();
      if (due === undefined || due.at > end) break;
      this.timers.delete(due.id);
      this.time = Math.max(this.time, due.at);
      due.fn();
    }
    this.time = end;
  }

  /** Fires only the timers already due now (0 ms ones and their children). */
  flush(): void {
    this.advance(0);
  }

  /** Moves the clock to the next timer and fires it. Returns the ms that passed; 0 when none. */
  next(): number {
    const due = this.earliest();
    if (due === undefined) return 0;
    const passed = Math.max(0, due.at - this.time);
    this.time += passed;
    this.timers.delete(due.id);
    due.fn();
    return passed;
  }

  /** Earliest first; among equals, the one armed first. */
  private earliest(): FakeTimer | undefined {
    let best: FakeTimer | undefined;
    for (const timer of this.timers.values()) {
      if (best === undefined || timer.at < best.at) best = timer;
    }
    return best;
  }
}
