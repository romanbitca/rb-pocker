// PLAN §13.5: hands you miss come up more often. A hand's weight is 1 + 3 · (missed + 0.3) /
// (seen + 1) (the standalone drill's formula); the position asked last weighs 0.15 of its weight.
import { describe, expect, it } from 'vitest';
import { deriveSeed, rngFromSeed, ZERO_SEED } from '../../src/core/rng.ts';
import { emptyHands } from '../../src/drill/data.ts';
import { categoryAt, POSITIONS, type Position } from '../../src/drill/ladder.ts';
import {
  missWeight,
  positionWeights,
  weightedPosition,
  type HandStats,
} from '../../src/drill/questions.ts';
import type { HandCategory } from '../../src/eval/evaluate.ts';
import { testSeed } from '../helpers/seed.ts';

const hands = (each: HandStats, override: Partial<Record<HandCategory, HandStats>> = {}) => {
  const all = emptyHands();
  for (const p of POSITIONS) all[categoryAt(p)] = each;
  return { ...all, ...override };
};

describe('missed hands come up more often', () => {
  it('weighs a hand by how often it was missed', () => {
    expect(missWeight({ seen: 0, missed: 0 })).toBeCloseTo(1.9, 10);
    expect(missWeight({ seen: 9, missed: 9 })).toBeCloseTo(1 + (3 * 9.3) / 10, 10);
    expect(missWeight({ seen: 9, missed: 0 })).toBeCloseTo(1 + 0.9 / 10, 10);
    // More misses, more weight; more right answers, less.
    expect(missWeight({ seen: 10, missed: 5 })).toBeGreaterThan(
      missWeight({ seen: 10, missed: 2 }),
    );
    expect(missWeight({ seen: 20, missed: 2 })).toBeLessThan(missWeight({ seen: 10, missed: 2 }));
  });

  it('asks the last position less often (0.15 of its weight)', () => {
    const plain = positionWeights(hands({ seen: 4, missed: 1 }));
    const avoided = positionWeights(hands({ seen: 4, missed: 1 }), 7);
    POSITIONS.forEach((p, i) => {
      expect(avoided[i]).toBeCloseTo((plain[i] as number) * (p === 7 ? 0.15 : 1), 10);
    });
  });

  it('picks each position in proportion to its weight', { timeout: 20_000 }, () => {
    // The royal flush always missed, every other hand always right.
    const stats = hands({ seen: 10, missed: 0 }, { royalFlush: { seen: 10, missed: 10 } });
    const weights = positionWeights(stats);
    const total = weights.reduce((a, b) => a + b, 0);
    const rng = rngFromSeed(testSeed(deriveSeed(ZERO_SEED, 'test|drill-weights')));
    const n = 40_000;
    const counts = new Map<Position, number>();
    for (let i = 0; i < n; i++) {
      const p = weightedPosition(rng, stats);
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
    POSITIONS.forEach((p, i) => {
      // 40,000 draws: a standard error under 0.25 points; allow 1.
      expect(
        Math.abs((counts.get(p) ?? 0) / n - (weights[i] as number) / total),
        `#${p}`,
      ).toBeLessThan(0.01);
    });
    // The missed royal flush comes up about 3.5 times as often as any hand answered right.
    expect((counts.get(1) ?? 0) / (counts.get(5) ?? 1)).toBeGreaterThan(3);
  });
});
