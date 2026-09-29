/**
 * PLAN §0.3 "Time": engine logic is time-free; only `app/controller.ts` uses timers. This scans the
 * non-UI sources (core, eval, engine, brain, app, persist, … and main.tsx) for timer calls outside
 * the controller. The UI's own animation timing is its business (CSS first), so `src/ui` is not
 * scanned here.
 */
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>('../../src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const TIMER_CALL = /\b(setTimeout|setInterval|requestAnimationFrame|requestIdleCallback)\s*\(/;

/** The code without comments (a rough strip: good enough for our sources). */
const code = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('only the controller uses timers (§0.3)', () => {
  it('no timer call outside app/controller.ts (UI excluded)', () => {
    const scanned = Object.entries(sources).filter(([path]) => !path.includes('/src/ui/'));
    expect(scanned.length).toBeGreaterThan(20);
    const offenders = scanned
      .filter(([path]) => !path.endsWith('/src/app/controller.ts'))
      .filter(([, text]) => TIMER_CALL.test(code(text)))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it('the controller does use them (the scan finds real calls)', () => {
    const controller = Object.entries(sources).find(([path]) =>
      path.endsWith('/src/app/controller.ts'),
    );
    expect(controller).toBeDefined();
    expect(TIMER_CALL.test(code(controller?.[1] ?? ''))).toBe(true);
  });
});
