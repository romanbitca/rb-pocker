/**
 * Present in the lazy Review chunk and in no other file: only `Review.tsx` imports it, and the
 * screen draws it as `data-review`. `tests/ui/review.bundle.test.ts` searches the built files for it
 * to check that the screen stays out of the initial bundle (PLAN §15.3) and is still precached.
 */
export const REVIEW_MARKER = 'rb-review-screen-v1';
