/**
 * The leaks (PLAN §14.4, §8.9) and Home's "Work on" line (§12.1, 1.3.101): the same rule picks
 * Stats' top 3 and the leak Home names, and the line waits until Stats would show a leak.
 */
import { describe, expect, it } from 'vitest';
import { en } from '../../src/i18n/en.ts';
import { emptyStats, type Stats } from '../../src/persist/schema.ts';
import {
  handsOf,
  LEAK_LESSON,
  LEAK_MIN_COUNT,
  STATS_MIN_HANDS,
  TOP_LEAKS,
  topLeaks,
  workOnLesson,
} from '../../src/ui/leaks.ts';
import { statsView } from '../../src/ui/stats.ts';

/** `clean` + `practice` hands, with these leaks. */
function stats(clean: number, leaks: Stats['leaks'], practice = 0): Stats {
  const s = emptyStats();
  return {
    ...s,
    leaks,
    results: {
      ...s.results,
      clean: { ...s.results.clean, hands: clean },
      practice: { ...s.results.practice, hands: practice },
    },
  };
}

const NOW = new Date('2026-11-09T12:00:00.000Z');

describe('topLeaks', () => {
  const leaks = {
    limp: { count: 9, lossMilliBB: 100 },
    overfold: { count: 4, lossMilliBB: 900 },
    chase: { count: 3, lossMilliBB: 900 },
    sizing: { count: LEAK_MIN_COUNT, lossMilliBB: 800 },
    'open-loose': { count: LEAK_MIN_COUNT - 1, lossMilliBB: 99_999 },
  };

  it('counts only what is seen often enough, the biggest loss first, three at most', () => {
    const top = topLeaks(stats(10, leaks));
    expect(top.map((l) => l.id)).toEqual(['overfold', 'chase', 'sizing']);
    expect(top).toHaveLength(TOP_LEAKS);
    expect(top[0]).toEqual({ id: 'overfold', count: 4, lossMilliBB: 900 });
  });

  it('is what Stats lists', () => {
    const view = statsView(stats(10, leaks), 20, NOW);
    expect(view.progress.leaks.map((l) => l.id)).toEqual(
      topLeaks(stats(10, leaks)).map((l) => l.id),
    );
    expect(view.progress.leaks[0]).toEqual({ id: 'overfold', count: 4, chips: 18 });
  });

  it('counts practice hands with the clean ones', () => {
    expect(handsOf(stats(3, {}, 4))).toBe(7);
  });
});

describe('Home`s "Work on" line', () => {
  const leak = { overfold: { count: 5, lossMilliBB: 9000 } };

  it('names the lesson of the biggest leak', () => {
    const lesson = workOnLesson(stats(12, leak));
    expect(lesson).toBe(LEAK_LESSON.overfold);
    expect(en.workOn(en.leakLessons[lesson as 6])).toBe('Work on: Pot odds');
    expect(workOnLesson(stats(12, { chase: { count: 3, lossMilliBB: 1 }, ...leak }))).toBe(6);
    expect(workOnLesson(stats(12, { chase: { count: 3, lossMilliBB: 99_000 }, ...leak }))).toBe(7);
  });

  it('waits for the same minimum of hands as Stats', () => {
    expect(workOnLesson(stats(STATS_MIN_HANDS - 1, leak))).toBeNull();
    expect(workOnLesson(stats(STATS_MIN_HANDS, leak))).toBe(6);
    expect(workOnLesson(stats(2, leak, STATS_MIN_HANDS - 2))).toBe(6);
  });

  it('needs a leak seen often enough, and is nothing with none', () => {
    expect(workOnLesson(stats(50, {}))).toBeNull();
    expect(workOnLesson(stats(50, { limp: { count: 2, lossMilliBB: 50_000 } }))).toBeNull();
  });
});
