/**
 * The only way the multiplayer code reads the time or starts a timer (PLAN §19.5), so every table
 * and socket rule can run on a fake clock.
 */

/** What `setTimeout` gave back. Only `clearTimeout` reads it. */
export type TimerHandle = unknown;

export interface Clock {
  /** Milliseconds since the epoch. */
  now(): number;
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

/** The Nest token of the `Clock`; the tests override it. */
export const CLOCK = Symbol('CLOCK');

export const realClock: Clock = {
  now: () => Date.now(),
  // Unref'd: a table's timer never keeps the process alive.
  setTimeout: (fn, ms) => setTimeout(fn, ms).unref(),
  clearTimeout: (handle) => {
    clearTimeout(handle as NodeJS.Timeout);
  },
};
