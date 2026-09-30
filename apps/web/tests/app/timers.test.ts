/**
 * PLAN §0.3 "Time": engine logic is time-free; only `app/controller.ts` uses timers. This scans the
 * non-UI sources (core, eval, engine, brain, app, persist, … and main.tsx) for timer calls outside
 * the controller. The UI's own animation timing is its business (CSS first), so `src/ui` is not
 * scanned here. Nor is `src/workers`: a worker runs on its own thread and has no game flow; it only
 * pauses between chunks of work with `setTimeout(0)` (§7.3). The worker clients on the main thread
 * (`app/workerClient.ts`) get the controller's timers.
 */
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>('../../src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/**
 * A direct timer call: bare, or on a global object. A call on an injected timers object
 * (`this.timers.setTimeout(…)`, the controller's `Timers`) uses the controller's timers.
 */
const TIMER_CALL =
  /(?:^|[^.\w$]|\b(?:globalThis|window|self)\.)(?:setTimeout|setInterval|requestAnimationFrame|requestIdleCallback)\s*\(/m;

/** The code without comments (a rough strip: good enough for our sources). */
const code = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('only the controller uses timers (§0.3)', () => {
  it('no timer call outside app/controller.ts (UI excluded)', () => {
    const scanned = Object.entries(sources).filter(
      ([path]) => !path.includes('/src/ui/') && !path.includes('/src/workers/'),
    );
    expect(scanned.length).toBeGreaterThan(20);
    const offenders = scanned
      .filter(([path]) => !path.endsWith('/src/app/controller.ts'))
      .filter(([, text]) => TIMER_CALL.test(code(text)))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it('the scan tells direct calls from calls on injected timers', () => {
    expect(TIMER_CALL.test('setTimeout(run, 0);')).toBe(true);
    expect(TIMER_CALL.test('const h = globalThis.setTimeout(run, 5);')).toBe(true);
    expect(TIMER_CALL.test('  window.requestAnimationFrame(draw);')).toBe(true);
    expect(TIMER_CALL.test('await new Promise((r) => setTimeout(r));')).toBe(true);
    expect(TIMER_CALL.test('this.timers.setTimeout(() => this.onTimeout(job), ms);')).toBe(false);
    expect(TIMER_CALL.test('clearTimeout: (handle: unknown) => void;')).toBe(false);
  });

  it('the controller does use them (the scan finds real calls)', () => {
    const controller = Object.entries(sources).find(([path]) =>
      path.endsWith('/src/app/controller.ts'),
    );
    expect(controller).toBeDefined();
    expect(TIMER_CALL.test(code(controller?.[1] ?? ''))).toBe(true);
  });
});
