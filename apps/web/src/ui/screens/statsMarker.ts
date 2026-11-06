/**
 * Present in the lazy Stats chunk and in no other file: only `Stats.tsx` imports it, and the screen
 * draws it as `data-stats`. `tests/ui/review.bundle.test.ts` searches the built files for it to
 * check that the screen stays out of the initial bundle (PLAN §15.3) and is still precached.
 */
export const STATS_MARKER = 'rb-stats-screen-v1';
