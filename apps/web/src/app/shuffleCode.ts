/**
 * The provable shuffle's commitment (PLAN §16.3, chunk 9.4): before a hand is dealt, the controller
 * fixes its seed and computes `commit = SHA-256(seed + ':' + tableId + ':' + handSeq)` with
 * `crypto.subtle.digest`, as 64 lowercase hex characters. The hand record keeps it (A.7
 * `HandRecord.commit`); Review shows it as "Shuffle code" and "Check the shuffle" recomputes it
 * (`app/shuffleCheck.ts`).
 *
 * `crypto.subtle` exists only in a secure context (https, or http://localhost, §12.14): on a
 * plain-http LAN page `pageSha256()` is null, nothing is hashed and records keep `commit: null`.
 *
 * ⚠️ The commitment is a function of the hand seed, which IS the deck (§2.4): like the seed it stays
 * in the controller, the session and the record, and never goes to a worker (§9.6 3b).
 */
import type { Seed128 } from '../core/rng.ts';
import type { ReviewHand } from './review.ts';
import { detectFeatures, type FeatureEnv } from './secure.ts';

/** SHA-256 of a text (UTF-8), as 64 lowercase hex characters. */
export type Sha256 = (text: string) => Promise<string>;

/** What the commitment hashes (§16.3): `seed + ':' + tableId + ':' + handSeq`. */
export const commitText = (seed: Seed128, tableId: string, handSeq: number): string =>
  `${seed}:${tableId}:${handSeq}`;

/** `Sha256` over a `SubtleCrypto` (`crypto.subtle.digest('SHA-256', …)`). */
export function subtleSha256(subtle: SubtleCrypto): Sha256 {
  return async (text) => {
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
    let hex = '';
    for (const byte of new Uint8Array(digest)) hex += byte.toString(16).padStart(2, '0');
    return hex;
  };
}

/**
 * This page's SHA-256 (`crypto.subtle`), or null where it is missing (not a secure context,
 * §12.14). Reads `env` at each call, so a test can stand in for an insecure page.
 */
export function pageSha256(env: FeatureEnv | undefined = globalThis): Sha256 | null {
  if (!detectFeatures(env).cryptoSubtle) return null;
  try {
    return subtleSha256((env as { crypto: Crypto }).crypto.subtle);
  } catch {
    return null;
  }
}

/**
 * One hand's commitment: its seed, fixed before the deal, and its `commit` once the digest has
 * answered (null until then, and for good if it failed).
 */
export interface ShuffleCode {
  readonly handSeq: number;
  readonly seed: Seed128;
  commit: string | null;
}

/** The hand's code with its digest started now; `commit` fills in when the digest answers. */
export function startShuffleCode(
  sha256: Sha256,
  seed: Seed128,
  tableId: string,
  handSeq: number,
): ShuffleCode {
  const code: ShuffleCode = { handSeq, seed, commit: null };
  void sha256(commitText(seed, tableId, handSeq)).then(
    (hex) => {
      code.commit = hex;
    },
    () => {}, // no code: the record keeps `commit: null`, and Review says the hand has none
  );
  return code;
}

/** Review's shuffle row before the check ("Check the shuffle" itself is `app/shuffleCheck.ts`). */
export type ShuffleRow =
  /** No `crypto.subtle` on this page (§12.14): "Needs a secure connection (https)". */
  | { readonly kind: 'insecure' }
  /** The hand has no shuffle code (dealt on a plain-http page, or before chunk 9.4). */
  | { readonly kind: 'none' }
  /**
   * The code and the seed. `beforeDeal`: the code was ready before the cards were dealt, so Review
   * may say so (a code made just after the deal, or computed again after a reload, gets a neutral
   * line instead).
   */
  | {
      readonly kind: 'code';
      readonly commit: string;
      readonly seed: Seed128;
      readonly beforeDeal: boolean;
    };

export function shuffleRowOf(hand: ReviewHand, sha256: Sha256 | null = pageSha256()): ShuffleRow {
  if (sha256 === null) return { kind: 'insecure' };
  const { commit, seed } = hand.record;
  return commit === null
    ? { kind: 'none' }
    : { kind: 'code', commit, seed, beforeDeal: hand.commitBeforeDeal };
}
