/**
 * SHA-256 for the provable-shuffle tests (PLAN §16.3, chunk 9.4), from `node:crypto`: an oracle
 * independent of the app's `crypto.subtle` path (`app/shuffleCode.ts`). `nodeSha256` answers on the
 * next microtask, so the controller tests' `flush()` lets it land.
 */
import { createHash } from 'node:crypto';
import type { Sha256 } from '../../src/app/shuffleCode.ts';

/** SHA-256 of `text` (UTF-8) as 64 lowercase hex characters, at once. */
export const sha256Hex = (text: string): string =>
  createHash('sha256').update(text, 'utf8').digest('hex');

/** The same as an app `Sha256`. */
export const nodeSha256: Sha256 = (text) => Promise.resolve(sha256Hex(text));
