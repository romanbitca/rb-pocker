/**
 * The provable shuffle's commitment (PLAN §16.3, chunk 9.4, `app/shuffleCode.ts`): the text it
 * hashes, SHA-256 through `crypto.subtle` (checked against `node:crypto` and the FIPS 180-2 test
 * vectors), no hash on a page without `crypto.subtle` (§12.14), and a hand's code that fills in
 * when its digest answers.
 */
import { describe, expect, it } from 'vitest';
import type { ReviewHand } from '../../src/app/review.ts';
import {
  commitText,
  pageSha256,
  shuffleRowOf,
  startShuffleCode,
  subtleSha256,
  type Sha256,
} from '../../src/app/shuffleCode.ts';
import { sha256Hex } from '../helpers/sha256.ts';

const SEED = '0123456789abcdef0123456789abcdef';

describe('commitText (§16.3)', () => {
  it('is seed + ":" + tableId + ":" + handSeq', () => {
    expect(commitText(SEED, '9f3a0c21', 42)).toBe(`${SEED}:9f3a0c21:42`);
  });
});

describe('SHA-256 through crypto.subtle', () => {
  const sha256 = subtleSha256(globalThis.crypto.subtle);

  it('gives the FIPS 180-2 test vectors as 64 lowercase hex characters', async () => {
    expect(await sha256('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(await sha256('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('agrees with node:crypto on commitment texts (UTF-8)', async () => {
    for (let n = 1; n <= 50; n++) {
      const text = commitText(SEED, n.toString(16).padStart(8, '0'), n * 7919);
      const hex = await sha256(text);
      expect(hex).toMatch(/^[0-9a-f]{64}$/);
      expect(hex).toBe(sha256Hex(text));
    }
    expect(await sha256('é:♠')).toBe(sha256Hex('é:♠'));
  });
});

describe('pageSha256 (§12.14)', () => {
  it('uses this page’s crypto.subtle where it exists', async () => {
    const sha256 = pageSha256({ crypto: globalThis.crypto }) as Sha256;
    expect(sha256).not.toBeNull();
    expect(await sha256('abc')).toBe(sha256Hex('abc'));
    expect(pageSha256()).not.toBeNull(); // Node has it, like an https page
  });

  it('is null on a plain-http page (no crypto.subtle), with no crypto, or with a getter that throws', () => {
    const getRandomValues = (): void => undefined;
    expect(pageSha256({ isSecureContext: false, crypto: { getRandomValues } })).toBeNull();
    expect(pageSha256({ crypto: { subtle: undefined, getRandomValues } })).toBeNull();
    expect(pageSha256({})).toBeNull();
    const hostile = {
      crypto: {
        get subtle(): unknown {
          throw new Error('blocked');
        },
      },
    };
    expect(pageSha256(hostile)).toBeNull();
  });
});

describe('startShuffleCode', () => {
  it('fixes the seed at once and fills in the commit when the digest answers', async () => {
    let answer: (hex: string) => void = () => {};
    const asked: string[] = [];
    const slow: Sha256 = (text) => {
      asked.push(text);
      return new Promise((resolve) => (answer = resolve));
    };
    const code = startShuffleCode(slow, SEED, 'abcd0123', 7);
    expect(code).toEqual({ handSeq: 7, seed: SEED, commit: null });
    expect(asked).toEqual([`${SEED}:abcd0123:7`]);
    answer('f'.repeat(64));
    await Promise.resolve();
    expect(code.commit).toBe('f'.repeat(64));
  });

  it('a digest that fails leaves the commit null (no unhandled rejection)', async () => {
    const failing: Sha256 = () => Promise.reject(new Error('no digest'));
    const code = startShuffleCode(failing, SEED, 'abcd0123', 1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(code.commit).toBeNull();
  });
});

describe('shuffleRowOf (Review, before the check)', () => {
  const hand = (commit: string | null): ReviewHand =>
    ({ handSeq: 3, record: { seed: SEED, commit } }) as unknown as ReviewHand;
  const sha256 = subtleSha256(globalThis.crypto.subtle);

  it('the code and the seed of a hand that has one', () => {
    expect(shuffleRowOf(hand('ab'.repeat(32)), sha256)).toEqual({
      kind: 'code',
      commit: 'ab'.repeat(32),
      seed: SEED,
    });
  });

  it('"none" for a hand without one; "insecure" on a page that cannot hash, whatever the hand', () => {
    expect(shuffleRowOf(hand(null), sha256)).toEqual({ kind: 'none' });
    expect(shuffleRowOf(hand('ab'.repeat(32)), null)).toEqual({ kind: 'insecure' });
    expect(shuffleRowOf(hand(null), null)).toEqual({ kind: 'insecure' });
  });
});
