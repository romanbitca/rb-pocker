import { describe, expect, it } from 'vitest';
import { formatCard, newDeck } from '../../src/core/cards.ts';
import {
  deriveSeed,
  fnv1a32,
  isSeed128,
  randInt,
  randomSeed,
  rngFromSeed,
  seedFromWords,
  seedWords,
  sfc32,
  shuffleRange,
  splitmix32,
  ZERO_SEED,
  type Rng,
} from '../../src/core/rng.ts';
import { testSeed } from '../helpers/seed.ts';
import { P_MIN } from '../helpers/stats.ts';
import { randIntUniformityP, shuffleUniformity } from './rngStats.ts';

const hex = (n: number): string => n.toString(16).padStart(8, '0');
const take = (next: () => number, k: number): string[] =>
  Array.from({ length: k }, () => hex(next()));

const SAME = '0123456789abcdef0123456789abcdef';

/** An Rng that replays fixed outputs, to test the rejection rule exactly. */
function scripted(values: number[]): Rng & { used: () => number } {
  let i = 0;
  return {
    next: () => {
      const v = values[i++];
      if (v === undefined) throw new Error('scripted Rng ran out of values');
      return v;
    },
    used: () => i,
  };
}

describe('Appendix C.4 golden values (exact)', () => {
  it('fnv1a32', () => {
    expect(hex(fnv1a32('abc'))).toBe('1a47e90b');
    expect(hex(fnv1a32(''))).toBe('811c9dc5');
  });

  it('splitmix32(1), first 3 outputs', () => {
    expect(take(splitmix32(1), 3)).toEqual(['5e2d1772', '14e498f0', 'd20ea1fd']);
  });

  it('sfc32(1,2,3,4), first 3 raw outputs (no discard)', () => {
    expect(take(sfc32(1, 2, 3, 4), 3)).toEqual(['00000008', '00000023', '0360006a']);
  });

  it('rngFromSeed, first 3 outputs (after the 16 discarded)', () => {
    const rng = rngFromSeed(SAME);
    expect(take(() => rng.next(), 3)).toEqual(['1699e12c', 'c0fc4273', '8d0e744a']);
  });

  it('deriveSeed', () => {
    expect(deriveSeed(SAME, 'deck')).toBe('d49e95ccee49479bd11f9acb75374998');
    expect(deriveSeed(SAME, 'undo', 0, 0)).toBe('1870cd6895c6410193df02721c991b96');
    expect(deriveSeed(SAME, 'bot', 3, 12)).toBe('22524e3de439b97b9cd107383cf7264c');
  });

  it('deck from rngFromSeed(deriveSeed(same, "deck"))', () => {
    const deck = newDeck();
    shuffleRange(deck, 0, 51, rngFromSeed(deriveSeed(SAME, 'deck')));
    expect(deck.slice(0, 12).map(formatCard).join(' ')).toBe('6h Kc 6d Qh 8h 4h Td 2h 2d 3s Ah 3h');
    expect(deck.slice(48, 52).map(formatCard).join(' ')).toBe('4s 7h As 7c');
  });
});

describe('seeds', () => {
  it('reads and writes the four big-endian words', () => {
    expect(seedWords(SAME)).toEqual([0x01234567, 0x89abcdef, 0x01234567, 0x89abcdef]);
    expect(seedFromWords(0x01234567, 0x89abcdef, 0x01234567, 0x89abcdef)).toBe(SAME);
    expect(seedFromWords(0, 0, 0, 0)).toBe(ZERO_SEED);
    expect(seedFromWords(-1, 1, 0xffffffff, 16)).toBe('ffffffff00000001ffffffff00000010');
  });

  it('rejects malformed seeds', () => {
    for (const bad of ['', SAME.toUpperCase(), SAME.slice(1), `${SAME}0`, `g${SAME.slice(1)}`]) {
      expect(isSeed128(bad)).toBe(false);
      expect(() => rngFromSeed(bad), bad).toThrow(RangeError);
      expect(() => deriveSeed(bad, 'deck'), bad).toThrow(RangeError);
    }
    expect(isSeed128(123)).toBe(false);
  });

  it('derives distinct, well-formed child seeds', () => {
    const children = [
      deriveSeed(SAME, 'deck'),
      deriveSeed(SAME, 'undo', 0, 0),
      deriveSeed(SAME, 'undo', 0, 1),
      deriveSeed(SAME, 'undo', 1, 0),
      deriveSeed(SAME, 'undo', 10),
      deriveSeed(SAME, 'undo', 1, 0, 0),
      deriveSeed(ZERO_SEED, 'deck'),
    ];
    for (const s of children) expect(isSeed128(s)).toBe(true);
    expect(new Set(children).size).toBe(children.length);
    expect(deriveSeed(SAME, 'undo', 3, 1)).toBe(deriveSeed(SAME, 'undo', 3, 1));
    // Seeds with no parent use ZERO_SEED; labels are free text (PLAN §2.4).
    expect(isSeed128(deriveSeed(ZERO_SEED, 'eq|AhKh|Qh7h2c|3'))).toBe(true);
  });

  it('only accepts integer labels', () => {
    for (const bad of [1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      expect(() => deriveSeed(SAME, 'undo', bad), String(bad)).toThrow(RangeError);
    }
    expect(isSeed128(deriveSeed(SAME, 'x', -1))).toBe(true);
  });

  it('draws fresh random seeds from crypto', () => {
    const a = randomSeed();
    const b = randomSeed();
    expect(isSeed128(a)).toBe(true);
    expect(isSeed128(b)).toBe(true);
    expect(a).not.toBe(b);
  });

  it('gives the same stream for the same seed, a different one for another seed', () => {
    const a = rngFromSeed(SAME);
    const b = rngFromSeed(SAME);
    const c = rngFromSeed(deriveSeed(SAME, 'other'));
    const sa = take(() => a.next(), 50);
    expect(take(() => b.next(), 50)).toEqual(sa);
    expect(take(() => c.next(), 50)).not.toEqual(sa);
    for (const v of sa) expect(v).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('randInt (rejection sampling, PLAN §5.6)', () => {
  it('rejects exactly the values at or above 2^32 − (2^32 mod n)', () => {
    // n = 3: lim = 2^32 − 1, so only 0xffffffff is rejected.
    let rng = scripted([0xffffffff, 7]);
    expect(randInt(rng, 3)).toBe(1);
    expect(rng.used()).toBe(2);
    rng = scripted([0xfffffffe]);
    expect(randInt(rng, 3)).toBe(0xfffffffe % 3);
    // n = 2^31 + 1: lim = n, so every value ≥ n is rejected (the worst case, ~50%).
    const n = 2 ** 31 + 1;
    rng = scripted([n, 0xffffffff, n - 1]);
    expect(randInt(rng, n)).toBe(n - 1);
    expect(rng.used()).toBe(3);
    // Powers of two never reject.
    rng = scripted([0xffffffff]);
    expect(randInt(rng, 2 ** 32)).toBe(0xffffffff);
    rng = scripted([0xffffffff]);
    expect(randInt(rng, 16)).toBe(15);
  });

  it('returns 0 for n = 1 and stays in range', () => {
    const rng = rngFromSeed(SAME);
    for (let i = 0; i < 1000; i++) expect(randInt(rng, 1)).toBe(0);
    for (const n of [2, 3, 7, 52, 1000, 2 ** 31 + 1, 3 * 2 ** 30, 2 ** 32]) {
      for (let i = 0; i < 200; i++) {
        const v = randInt(rng, n);
        expect(Number.isInteger(v) && v >= 0 && v < n).toBe(true);
      }
    }
  });

  it('rejects a bad n', () => {
    const rng = rngFromSeed(SAME);
    for (const bad of [0, -1, 1.5, 2 ** 32 + 1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => randInt(rng, bad), String(bad)).toThrow(RangeError);
    }
  });

  it('randInt(3) is uniform over 300,000 draws (fixed seed; 3,000,000 in slow)', () => {
    const seed = testSeed(deriveSeed(ZERO_SEED, 'test|randInt3'));
    expect(randIntUniformityP(seed, 3, 300_000)).toBeGreaterThan(P_MIN);
  });

  it('randInt(52) is uniform over 520,000 draws', () => {
    const seed = testSeed(deriveSeed(ZERO_SEED, 'test|randInt52'));
    expect(randIntUniformityP(seed, 52, 520_000)).toBeGreaterThan(P_MIN);
  });

  it('has no modulo bias when a quarter of the raw values are rejected', () => {
    // n = 3·2^30: plain `x % n` would make 0..2^30−1 twice as likely (the first 4 of 12 buckets).
    const seed = testSeed(deriveSeed(ZERO_SEED, 'test|randIntBig'));
    expect(randIntUniformityP(seed, 3 * 2 ** 30, 240_000, 12)).toBeGreaterThan(P_MIN);
  });
});

describe('shuffleRange (Fisher–Yates, PLAN §5.6)', () => {
  it('permutes only arr[lo..hi]', () => {
    const rng = rngFromSeed(SAME);
    for (const [lo, hi] of [
      [0, 51],
      [9, 51],
      [20, 30],
      [51, 51],
      [0, 0],
    ] as const) {
      const deck = newDeck();
      shuffleRange(deck, lo, hi, rng);
      expect([...deck].sort((a, b) => a - b)).toEqual(newDeck());
      expect(deck.slice(0, lo)).toEqual(newDeck().slice(0, lo));
      expect(deck.slice(hi + 1)).toEqual(newDeck().slice(hi + 1));
      expect(
        deck
          .slice(lo, hi + 1)
          .slice()
          .sort((a, b) => a - b),
      ).toEqual(newDeck().slice(lo, hi + 1));
    }
  });

  it('uses exactly one randInt per position above lo (golden order)', () => {
    // Same algorithm by hand: i = hi..lo+1, j = lo + randInt(i − lo + 1).
    const seed = deriveSeed(SAME, 'undo', 4, 0);
    const expected = newDeck();
    const rngA = rngFromSeed(seed);
    for (let i = 51; i > 9; i--) {
      const j = 9 + randInt(rngA, i - 9 + 1);
      [expected[i], expected[j]] = [expected[j] as number, expected[i] as number];
    }
    const deck = newDeck();
    shuffleRange(deck, 9, 51, rngFromSeed(seed));
    expect(deck).toEqual(expected);
  });

  it('rejects a bad range', () => {
    const rng = rngFromSeed(SAME);
    expect(() => shuffleRange(newDeck(), -1, 51, rng)).toThrow(RangeError);
    expect(() => shuffleRange(newDeck(), 0, 52, rng)).toThrow(RangeError);
    expect(() => shuffleRange(newDeck(), 30, 29, rng)).toThrow(RangeError);
    expect(() => shuffleRange(newDeck(), 0.5, 51, rng)).toThrow(RangeError);
  });

  it('puts every card in every position equally often: 50,000 shuffles (1,000,000 in slow)', () => {
    const r = shuffleUniformity(testSeed(deriveSeed(ZERO_SEED, 'test|shuffle')), 50_000);
    expect(r.tableP).toBeGreaterThan(P_MIN);
    // 52 per-card tests: Bonferroni keeps the chance of a false alarm at P_MIN overall.
    expect(r.minCardP, `card ${formatCard(r.minCard)}`).toBeGreaterThan(P_MIN / 52);
  });
});
