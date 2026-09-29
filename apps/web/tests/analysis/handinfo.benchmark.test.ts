/**
 * Timing of the hand analysis (§6: the `handInfo` job is "typically < 20 ms" on a phone; §15.3:
 * the first postflop number ≤ 150 ms at 6× CPU throttle). Prints the numbers; it fails only far
 * above them, because CI runners are slower and noisier than a desk machine.
 */
import { describe, expect, it } from 'vitest';
import { analyzeHand } from '../../src/analysis/handinfo.ts';
import { HandSource } from '../eval/hands.ts';

const HANDS = 2_000;
/** A desk machine does a flop in well under 1 ms; 6× throttle must still stay under 20 ms. */
const MEAN_LIMIT_MS = 20 / 6;

function time(boardLength: number): { mean: number; p95: number; max: number } {
  const src = new HandSource('20260930000000000000000000004101');
  const hands = Array.from({ length: HANDS }, () => src.uniform(2 + boardLength));
  for (const cs of hands.slice(0, 200)) analyzeHand(cs.slice(0, 2), cs.slice(2)); // warm-up
  const ms: number[] = [];
  for (const cs of hands) {
    const t0 = performance.now();
    analyzeHand(cs.slice(0, 2), cs.slice(2));
    ms.push(performance.now() - t0);
  }
  ms.sort((a, b) => a - b);
  const mean = ms.reduce((a, b) => a + b, 0) / ms.length;
  return {
    mean,
    p95: ms[Math.floor(ms.length * 0.95)] as number,
    max: ms[ms.length - 1] as number,
  };
}

describe('analyzeHand timing', () => {
  for (const [street, boardLength] of [
    ['flop', 3],
    ['turn', 4],
    ['river', 5],
  ] as const) {
    it(`${HANDS} random ${street}s`, { timeout: 60_000 }, () => {
      const t = time(boardLength);
      console.info(
        `analyzeHand ${street}: mean ${t.mean.toFixed(3)} ms, p95 ${t.p95.toFixed(3)} ms, max ${t.max.toFixed(3)} ms`,
      );
      expect(t.mean).toBeLessThan(MEAN_LIMIT_MS);
    });
  }
});
