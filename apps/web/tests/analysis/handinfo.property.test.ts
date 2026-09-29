/**
 * `src/analysis/handinfo.ts` against the brute-force oracles of `outs.oracle.ts` on thousands of
 * random flops and turns (fast-check, fixed seed; `TEST_SEED` reproduces or randomises a run).
 * Each property also counts what it saw, so a sample that never reaches a rule fails instead of
 * passing vacuously.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { analyzeHand, countBeaters, findOuts } from '../../src/analysis/handinfo.ts';
import type { DrawKind, RiskRule } from '../../src/analysis/types.ts';
import { formatCard } from '../../src/core/cards.ts';
import { oracleBeaters, oracleDraws, oracleOuts, oracleRisky } from './outs.oracle.ts';
import { FC_SEED, heroHand } from './states.ts';

const RUNS = 2_500; // per street and property

const STREETS = [
  ['flop', 3],
  ['turn', 4],
] as const;

describe('outs and risky outs match the brute-force oracle (§6.3, §6.4)', () => {
  for (const [street, boardLength] of STREETS) {
    it(`${RUNS} random ${street}s`, { timeout: 120_000 }, () => {
      const seen = { outs: 0, hands: 0 } as Record<string, number>;
      fc.assert(
        fc.property(heroHand(boardLength), ({ hole, board }) => {
          const got = findOuts(hole, board).map(
            (o) => `${formatCard(o.card)} ${o.makes} [${o.risky.join(',')}]`,
          );
          const want = [...oracleOuts(hole, board)].map(
            ([x, o]) =>
              `${formatCard(x)} ${o.makes} [${oracleRisky(hole, board, x, o.makes).join(',')}]`,
          );
          expect(got.slice().sort()).toEqual(want.sort());
          seen.hands = (seen.hands ?? 0) + 1;
          for (const o of findOuts(hole, board)) {
            seen.outs = (seen.outs ?? 0) + 1;
            seen[o.makes] = (seen[o.makes] ?? 0) + 1;
            for (const r of o.risky) seen[r] = (seen[r] ?? 0) + 1;
          }
        }),
        { seed: FC_SEED, numRuns: RUNS },
      );
      // The sample reaches every risky rule and every kind of improvement.
      const rules: RiskRule[] = ['R1', 'R2', 'R3', 'R4', 'R5'];
      for (const key of [...rules, 'pair', 'twoPair', 'trips', 'straight', 'flush', 'fullHouse']) {
        expect(seen[key] ?? 0, key).toBeGreaterThan(0);
      }
    });
  }
});

describe('draws match the §6.2 definitions', () => {
  for (const [street, boardLength] of STREETS) {
    it(`${RUNS} random ${street}s`, { timeout: 120_000 }, () => {
      const seen: Partial<Record<DrawKind, number>> = {};
      fc.assert(
        fc.property(heroHand(boardLength), ({ hole, board }) => {
          const got = analyzeHand(hole, board);
          expect(got.draws).toEqual(oracleDraws(hole, board, oracleOuts(hole, board)));
          for (const d of got.draws) seen[d.kind] = (seen[d.kind] ?? 0) + 1;
          // A draw's outs are among the hand's outs (the total is their union, not the sum).
          for (const d of got.draws) expect(d.outs).toBeLessThanOrEqual(got.outs.length);
          // Straight draws: at most 2 completing ranks before the river, so at most 8 outs.
          for (const d of got.draws) {
            if (['oesd', 'doubleGutshot', 'gutshot'].includes(d.kind)) {
              expect(d.outs).toBeGreaterThanOrEqual(3);
              expect(d.outs).toBeLessThanOrEqual(d.kind === 'gutshot' ? 4 : 8);
            }
            if (d.kind === 'flush' || d.kind === 'nutFlush') expect(d.outs).toBe(9);
          }
        }),
        { seed: FC_SEED + 1, numRuns: RUNS },
      );
      const expected: DrawKind[] = ['flush', 'nutFlush', 'oesd', 'doubleGutshot', 'gutshot'];
      expected.push('overcards');
      if (boardLength === 3) expected.push('backdoorFlush', 'backdoorStraight');
      for (const kind of expected) expect(seen[kind] ?? 0, kind).toBeGreaterThan(0);
    });
  }
});

describe('beaters match the naive evaluator (§6.5)', () => {
  const streets = [...STREETS, ['river', 5] as const];
  for (const [street, boardLength] of streets) {
    it(`40 random ${street}s`, { timeout: 120_000 }, () => {
      let nuts = 0;
      fc.assert(
        fc.property(heroHand(boardLength), ({ hole, board }) => {
          const b = countBeaters(hole, board);
          expect(b?.count).toBe(oracleBeaters(hole, board));
          const unseen = 52 - 2 - boardLength;
          expect(b?.total).toBe((unseen * (unseen - 1)) / 2);
          expect(analyzeHand(hole, board).nuts).toBe(b?.count === 0);
          if (b?.count === 0) nuts++;
        }),
        { seed: FC_SEED + 2, numRuns: 40 },
      );
      expect(nuts).toBeGreaterThan(0); // the small decks make the nuts often enough
    });
  }
});
