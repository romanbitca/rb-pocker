/**
 * Properties of the range model over random hands played by the real engine (PLAN §8.6, §9.6):
 * - every range is a valid distribution (finite, ≥ 0, largest weight 1, every possible combo > 0);
 * - card removal: no weight on a combo that uses a card the observer can see;
 * - non-cheating: re-dealing every card the observer cannot see (`permuteHidden`, then
 *   `observe()` again) leaves the ranges, `eRange` and every feature identical;
 * - determinism: the same observation (even a JSON copy) and seed give the same result.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { features } from '../../src/brain/features.ts';
import {
  COMBO_HI,
  COMBO_LO,
  COMBOS,
  opponentRanges,
  rangeEquity,
  visibleCards,
  type OpponentRange,
  type RangeModel,
} from '../../src/brain/ranges.ts';
import { rngFromSeed, type Seed128 } from '../../src/core/rng.ts';
import { observe } from '../../src/engine/observe.ts';
import { step } from '../../src/engine/step.ts';
import {
  BOT_LEVELS,
  PERSONALITY_IDS,
  type HandState,
  type Observation,
  type ObserveExtras,
  type SeatStats,
} from '../../src/engine/types.ts';
import { FC_SEED } from '../engine/helpers.ts';
import { permuteHidden } from '../engine/permute.ts';
import { handArb, randomInput, seedArb } from '../engine/play.ts';
import { testProfile } from './fixtures.ts';

const MODELS: readonly RangeModel[] = ['random', 'static', 'reweight', 'reweight+stats'];

const pairArb = fc
  .nat({ max: 200 })
  .chain((n) => fc.nat({ max: n }).map((x): [number, number] => [x, n]));
const statsArb: fc.Arbitrary<SeatStats | null> = fc.option(
  fc.record({
    hands: fc.nat({ max: 500 }),
    vpip: pairArb,
    pfr: pairArb,
    threeBet: pairArb,
    foldTo3bet: pairArb,
    cbet: pairArb,
    foldToCbet: pairArb,
    wtsd: pairArb,
    aggActions: fc.nat({ max: 300 }),
    passiveActions: fc.nat({ max: 300 }),
  }),
  { nil: null },
);
const extrasArb = fc.record({
  stats: fc.array(statsArb, { minLength: 9, maxLength: 9 }),
  labels: fc.array(fc.option(fc.constantFrom(...PERSONALITY_IDS), { nil: null }), {
    minLength: 9,
    maxLength: 9,
  }),
  levels: fc.array(fc.constantFrom(...BOT_LEVELS), { minLength: 9, maxLength: 9 }),
});

type ExtrasDraw = typeof extrasArb extends fc.Arbitrary<infer T> ? T : never;

function extrasOf(n: number, e: ExtrasDraw): ObserveExtras {
  return {
    seatStats: e.stats.slice(0, n),
    visiblePersonality: e.labels.slice(0, n),
    seatLevels: e.levels.slice(0, n),
  };
}

/** Every decision point of a random hand: the state and the seat to act. */
function decisionPoints(h: HandState, policySeed: Seed128): HandState[] {
  const rng = rngFromSeed(policySeed);
  const points: HandState[] = [];
  let s = h;
  for (let i = 0; i < 400 && s.phase !== 'complete'; i++) {
    if (s.phase === 'betting') points.push(s);
    s = step(s, randomInput(s, rng));
  }
  return points;
}

function expectValid(obs: Observation, ranges: OpponentRange[]): void {
  const seen = visibleCards(obs);
  for (const r of ranges) {
    expect(r.weights).toHaveLength(COMBOS);
    let max = 0;
    let bad = 0; // plain checks: an expect() per combo would make the run several times slower
    for (let i = 0; i < COMBOS; i++) {
      const w = r.weights[i] as number;
      const visible = seen[COMBO_LO[i] as number] === 1 || seen[COMBO_HI[i] as number] === 1;
      if (!(Number.isFinite(w) && w >= 0)) bad++;
      else if (visible && w !== 0)
        bad++; // card removal
      else if (!visible && r.prior !== 'known' && !(w > 0)) bad++; // no hand is impossible
      max = Math.max(max, w);
    }
    expect(bad).toBe(0);
    expect(max).toBe(1);
    expect(r.topPct).toBeGreaterThan(0);
    expect(r.topPct).toBeLessThanOrEqual(100);
  }
}

/** Field-by-field equality with a plain loop over the weights (Vitest's deep equal is slow here). */
function sameRanges(a: OpponentRange[], b: OpponentRange[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, j) => {
    const y = b[j] as OpponentRange;
    if (x.seat !== y.seat || x.prior !== y.prior || x.topPct !== y.topPct) return false;
    if (x.looseness !== y.looseness || x.af !== y.af) return false;
    for (let i = 0; i < COMBOS; i++) if (!Object.is(x.weights[i], y.weights[i])) return false;
    return true;
  });
}

describe('range model properties (§8.6, §9.6)', () => {
  it(
    'valid distributions, card removal, non-cheating and determinism at random decision points',
    { timeout: 120_000 },
    () => {
      let checked = 0;
      let narrowed = 0;
      fc.assert(
        fc.property(
          handArb,
          seedArb,
          extrasArb,
          seedArb,
          ({ h, policySeed }, permSeed, e, mcSeed) => {
            const extras = extrasOf(h.seats.length, e);
            decisionPoints(h, policySeed).forEach((s, i) => {
              const seat = s.toAct as number;
              const model = MODELS[(checked + i) % MODELS.length] as RangeModel;
              const obs = observe(s, seat, extras);
              const ranges = opponentRanges(obs, model);
              expectValid(obs, ranges);
              if (ranges.some((r) => r.prior !== 'random' && r.topPct < 100)) narrowed++;

              // Non-cheating: another deal of every card the seat cannot see.
              const other = observe(permuteHidden(s, seat, permSeed), seat, extras);
              const otherRanges = opponentRanges(other, model);
              expect(sameRanges(otherRanges, ranges)).toBe(true);
              // Determinism: a JSON copy of the observation gives the same ranges.
              const copy = JSON.parse(JSON.stringify(obs)) as Observation;
              expect(sameRanges(opponentRanges(copy, model), ranges)).toBe(true);

              const req = {
                hole: obs.hole,
                board: obs.board,
                ranges: ranges.map((r) => r.weights),
                trials: 64,
                seed: mcSeed,
              };
              const e1 = rangeEquity(req);
              expect(e1).toBeGreaterThanOrEqual(0);
              expect(e1).toBeLessThanOrEqual(1);
              const otherWeights = otherRanges.map((r) => r.weights);
              expect(rangeEquity({ ...req, ranges: otherWeights })).toBe(e1);
              checked++;
            });
          },
        ),
        { seed: FC_SEED, numRuns: 150 },
      );
      expect(checked).toBeGreaterThan(500);
      expect(narrowed).toBeGreaterThan(0);
    },
  );

  it(
    'features: identical after a re-deal of the hidden cards, and for the same seed',
    { timeout: 120_000 },
    () => {
      let checked = 0;
      fc.assert(
        fc.property(
          handArb,
          seedArb,
          extrasArb,
          seedArb,
          ({ h, policySeed }, permSeed, e, seed) => {
            const extras = extrasOf(h.seats.length, e);
            const points = decisionPoints(h, policySeed);
            // A few decision points per hand keep the run short; the model cycles with them.
            for (const s of points.filter((_, i) => i % 3 === 0)) {
              const seat = s.toAct as number;
              const profile = testProfile(MODELS[checked % MODELS.length] as RangeModel, 48);
              const obs = observe(s, seat, extras);
              const f = features(obs, profile, seed, 0.5);
              const other = observe(permuteHidden(s, seat, permSeed), seat, extras);
              for (const g of [
                features(other, profile, seed, 0.5),
                features(obs, profile, seed, 0.5),
              ]) {
                expect(sameRanges(g.ranges, f.ranges)).toBe(true);
                expect({ ...g, ranges: null }).toEqual({ ...f, ranges: null });
              }
              expect(f.need).toBeGreaterThanOrEqual(0);
              expect(f.need).toBeLessThan(1);
              expect(f.p).toBeGreaterThanOrEqual(0);
              expect(f.p).toBeLessThanOrEqual(1);
              checked++;
            }
          },
        ),
        { seed: FC_SEED, numRuns: 120 },
      );
      expect(checked).toBeGreaterThan(150);
    },
  );
});
