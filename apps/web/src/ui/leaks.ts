/**
 * The player's leaks (PLAN §14.4, §8.9): which ones Stats lists and which lesson each links to, and
 * the one Home's line names. Pure and small: Home's line is in the screens chunk, which every launch
 * preloads, so this file holds only what that line needs (`ui/stats.ts` has the rest of Stats).
 */
import type { LeakId } from '../brain/types.ts';
import type { Stats } from '../persist/schema.ts';

/** §14.4: "Play 5 hands to see your first stats". */
export const STATS_MIN_HANDS = 5;
/** §14.4 Leaks: the top 3 by Σ loss, with count ≥ 3. */
export const TOP_LEAKS = 3;
export const LEAK_MIN_COUNT = 3;

/** The lessons a leak links to (Appendix F.8): Your options, Position, Pot odds, Outs. */
export type LeakLesson = 3 | 5 | 6 | 7;

/**
 * §8.9 "Lesson links": the lesson that teaches what each leak gets wrong. Before the flop, how
 * many hands to play is Position; the moves (limping, not betting a strong hand, bluffing) are
 * Your options; chasing a draw is Outs; every call or fold against the price, and a bet's size
 * (which sets the price), is Pot odds. Stats and Home open it by number (`{ type: 'lesson' }`), so
 * Learn's lessons stay in Learn's chunk; the titles of these four are in `en.leakLessons`.
 */
export const LEAK_LESSON: Readonly<Record<LeakId, LeakLesson>> = {
  'open-loose': 5,
  'open-tight': 5,
  limp: 3,
  'call-pre-wide': 6,
  'fold-pre-much': 6,
  pushfold: 6,
  'missed-value': 3,
  'bluff-much': 3,
  overfold: 6,
  chase: 7,
  'river-call': 6,
  'call-light': 6,
  sizing: 6,
};

/** A leak as `Stats` counts it (§14.4). */
export interface LeakCount {
  readonly id: LeakId;
  readonly count: number;
  readonly lossMilliBB: number;
}

/** Hands counted, clean and practice. */
export const handsOf = (stats: Stats): number =>
  stats.results.clean.hands + stats.results.practice.hands;

/** §14.4 Leaks: the biggest losses first, among those seen often enough to be a pattern. */
export function topLeaks(stats: Stats): LeakCount[] {
  return (Object.entries(stats.leaks) as [LeakId, { count: number; lossMilliBB: number }][])
    .filter(([, leak]) => leak.count >= LEAK_MIN_COUNT)
    .sort(
      ([a, x], [b, y]) =>
        y.lossMilliBB - x.lossMilliBB || y.count - x.count || (a < b ? -1 : a > b ? 1 : 0),
    )
    .slice(0, TOP_LEAKS)
    .map(([id, leak]) => ({ id, count: leak.count, lossMilliBB: leak.lossMilliBB }));
}

/**
 * The lesson of Home's "Work on" line (§12.1): the biggest leak's, as Stats lists it; null until
 * Stats would show one (fewer than `STATS_MIN_HANDS` hands, or no leak seen often enough).
 */
export function workOnLesson(stats: Stats): LeakLesson | null {
  const top = handsOf(stats) >= STATS_MIN_HANDS ? topLeaks(stats)[0] : undefined;
  return top === undefined ? null : LEAK_LESSON[top.id];
}
