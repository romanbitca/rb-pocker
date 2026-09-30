/**
 * The maths behind `equity.worker` (the `EquityMath` interface of `equityService.ts`).
 * Placeholder until the Stage 4 maths (`analysis/handinfo.ts`, `chances.ts`, `equity.ts`) is on
 * main: every job answers with an `error` reply.
 */
import type { EquityMath } from './equityService.ts';

const missing = (what: string): never => {
  throw new Error(`${what}: the equity maths is not built yet`);
};

export const equityMath: EquityMath = {
  equitySteps: () => missing('equity'),
  runoutSteps: () => missing('equityKnown'),
  handInfo: () => missing('handInfo'),
};
