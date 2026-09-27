/**
 * Errors shared by the pure modules (PLAN §4.5, Appendix A.3; `engine/types.ts` re-exports them).
 * - `EngineError`: an illegal input (a UI or bot bug). The controller logs it and ignores it.
 * - `InvariantError`: a broken invariant. ⚠️ Never ignored: the controller voids the hand.
 */

export type EngineErrorCode =
  'NOT_YOUR_TURN' | 'ILLEGAL_ACTION' | 'BAD_AMOUNT' | 'BAD_PHASE' | 'UNDO_USED';

export class EngineError extends Error {
  readonly code: EngineErrorCode;

  constructor(code: EngineErrorCode, message?: string) {
    super(message === undefined ? code : `${code}: ${message}`);
    this.name = 'EngineError';
    this.code = code;
  }
}

export class InvariantError extends Error {
  /** Every broken invariant, e.g. ["I1 chip conservation: 9990 != 10000"]. */
  readonly broken: string[];

  constructor(broken: string[]) {
    super(`Broken invariant: ${broken.join('; ')}`);
    this.name = 'InvariantError';
    this.broken = broken;
  }
}

/** Throws `InvariantError([message])` unless `condition` holds. */
export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new InvariantError([message]);
}
