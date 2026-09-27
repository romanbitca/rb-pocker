import { describe, expect, it } from 'vitest';
import { HAND_CATEGORIES, score7 } from '../../src/eval/evaluate.ts';

// Appendix C.1: category counts over all C(52,7) = 133,784,560 seven-card hands.
const EXPECTED = {
  highCard: 23_294_460,
  pair: 58_627_800,
  twoPair: 31_433_400,
  trips: 6_461_620,
  straight: 6_180_020,
  flush: 4_047_644,
  fullHouse: 3_473_184,
  quads: 224_848,
  straightFlush: 37_260,
  royalFlush: 4_324,
};

// Stage 1 acceptance 4 (PLAN §5.5).
describe('exhaustive seven-card count (slow)', () => {
  it('matches the published category counts exactly', { timeout: 900_000 }, () => {
    // A local binding: Vitest turns each call of an imported function into a getter lookup on the
    // module namespace, which costs about 3× in a loop this tight.
    const score = score7;
    const counts = new Float64Array(10);
    const c = new Uint8Array(7);
    const started = performance.now();
    for (let a = 0; a < 46; a++) {
      c[0] = a;
      for (let b = a + 1; b < 47; b++) {
        c[1] = b;
        for (let d = b + 1; d < 48; d++) {
          c[2] = d;
          for (let e = d + 1; e < 49; e++) {
            c[3] = e;
            for (let f = e + 1; f < 50; f++) {
              c[4] = f;
              for (let g = f + 1; g < 51; g++) {
                c[5] = g;
                for (let h = g + 1; h < 52; h++) {
                  c[6] = h;
                  const s = score(c, 7);
                  // Display category: the royal flush is category 8 with n0 = 12 (§5.2).
                  const category = (s >> 20) + ((s & 0xff0000) === 0x8c0000 ? 1 : 0);
                  counts[category]! += 1;
                }
              }
            }
          }
        }
      }
    }
    const seconds = (performance.now() - started) / 1000;
    const total = counts.reduce((sum, n) => sum + n, 0);
    console.info(
      `exhaustive: ${total.toLocaleString('en-US')} hands in ${seconds.toFixed(1)} s ` +
        `(${(total / seconds / 1e6).toFixed(1)}M evals/s)`,
    );
    expect(total).toBe(133_784_560);
    const actual = Object.fromEntries(HAND_CATEGORIES.map((name, i) => [name, counts[i]]));
    expect(actual).toEqual(EXPECTED);
  });
});
