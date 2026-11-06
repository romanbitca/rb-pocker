/**
 * Present in the lazy Learn chunk and in no other file: only `Learn.tsx` imports it, and every
 * Learn page draws it as `data-learn`. `tests/ui/review.bundle.test.ts` searches the built files for
 * it to check that Learn stays out of the initial bundle (PLAN §15.3) and is still precached.
 */
export const LEARN_MARKER = 'rb-learn-screen-v1';
