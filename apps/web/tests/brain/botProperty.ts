/**
 * The §9.6 bot property at random decision points (Stage 5 acceptance 4, Stage 7 acceptance 4),
 * for any list of bot profiles: each profile decides at each point with the run's seed, and
 * - §9.6.3 non-cheating: every card the bot cannot see is dealt again (other seats' unrevealed
 *   hole cards, the burn cards, the stub; `permuteHidden`) and the hand observed again: the
 *   observation is the same, and `decide()` returns an identical Decision;
 * - the decision is legal (the brain's own check and the engine's), `kind` matches the action,
 *   never a fold when checking is free, and the guardrails are a fixed point of the pick (§8.8).
 *
 * `extrasWithStatsArb` adds random seat statistics (chunk 7.1), the hero's often past the Expert
 * exploits' thresholds with n ≥ 30, so the Expert range model and exploits are exercised.
 */
import fc from 'fast-check';
import { expect } from 'vitest';
import { decide, deliberate, kindOf } from '../../src/brain/decide.ts';
import { exploitPlan } from '../../src/brain/exploits.ts';
import { guardrails, guardSpot, isLegalAction } from '../../src/brain/guardrails.ts';
import type { BrainProfile } from '../../src/brain/types.ts';
import { observe } from '../../src/engine/observe.ts';
import {
  BOT_LEVELS,
  PERSONALITY_IDS,
  type BotLevel,
  type HandState,
  type ObserveExtras,
  type PersonalityId,
  type SeatStats,
} from '../../src/engine/types.ts';
import { FC_SEED } from '../engine/helpers.ts';
import { permuteHidden } from '../engine/permute.ts';
import { handArb, seedArb } from '../engine/play.ts';
import { decisionPointAt, engineAccepts, extrasArb } from './points.ts';

/** `[done, opportunities]` with done ≤ opportunities ≤ max. */
const counter = (max: number): fc.Arbitrary<[number, number]> =>
  fc.nat({ max }).chain((n) => fc.nat({ max: n }).map((x): [number, number] => [x, n]));

/** A seat's statistics: nothing seen yet, or up to a few hundred hands of anything. */
export const seatStatsArb: fc.Arbitrary<SeatStats | null> = fc.option(
  fc.record({
    hands: fc.nat({ max: 300 }),
    vpip: counter(300),
    pfr: counter(300),
    threeBet: counter(80),
    foldTo3bet: counter(40),
    cbet: counter(80),
    foldToCbet: counter(80),
    wtsd: counter(120),
    aggActions: fc.nat({ max: 200 }),
    passiveActions: fc.nat({ max: 200 }),
  }),
  { freq: 4 },
);

/** Like `extrasArb` (random levels, labels at Easy and Medium), with random seat statistics. */
export const extrasWithStatsArb: fc.Arbitrary<(n: number) => ObserveExtras> = fc
  .record({
    levels: fc.array(fc.constantFrom(...BOT_LEVELS), { minLength: 9, maxLength: 9 }),
    labels: fc.array(fc.constantFrom(...PERSONALITY_IDS), { minLength: 9, maxLength: 9 }),
    stats: fc.array(seatStatsArb, { minLength: 9, maxLength: 9 }),
  })
  .map(({ levels, labels, stats }) => (n: number): ObserveExtras => ({
    seatStats: stats.slice(0, n),
    seatLevels: levels.slice(0, n) as BotLevel[],
    visiblePersonality: levels
      .slice(0, n)
      .map((l, i) => (l === 'easy' || l === 'medium' ? (labels[i] as PersonalityId) : null)),
  }));

export interface BotPropertyCounts {
  runs: number;
  /** Points where the profiles did not all take the same action. */
  mixed: number;
  kinds: Set<string>;
  /** Decisions where a balanced river bluff chance was drawn (Hard and Expert). */
  riverAir: number;
  /** Decisions where an Expert exploit applied. */
  exploited: number;
}

/** Runs the property `runs` times over `profiles`; returns what it saw. */
export function checkBots(
  profiles: readonly BrainProfile[],
  runs: number,
  extras: fc.Arbitrary<(n: number) => ObserveExtras> = extrasArb,
): BotPropertyCounts {
  const counts: BotPropertyCounts = {
    runs: 0,
    mixed: 0,
    kinds: new Set(),
    riverAir: 0,
    exploited: 0,
  };
  fc.assert(
    fc.property(
      handArb,
      extras,
      fc.nat(),
      seedArb,
      seedArb,
      ({ h, policySeed }, extrasFor, pick, permSeed, botSeed) => {
        const point = decisionPointAt(h, policySeed, pick);
        fc.pre(point !== null);
        const s = point as HandState;
        const seat = s.toAct as number;
        const x = extrasFor(s.seats.length);
        const obs = observe(s, seat, x);
        const other = observe(permuteHidden(s, seat, permSeed), seat, x);
        expect(other).toEqual(obs);
        counts.runs++;
        const actions = new Set<string>();
        for (const profile of profiles) {
          const { decision: d, f, bot } = deliberate(obs, profile, botSeed);
          expect(isLegalAction(obs.legal, d.action)).toBe(true);
          expect(engineAccepts(s, seat, d)).toBe(true);
          expect(d.kind).toBe(kindOf(obs.legal, d.action));
          if (obs.legal.canCheck) expect(d.action.type).not.toBe('fold');
          expect(guardrails(guardSpot(obs, f), d.action).fired).toEqual([]);
          expect(d.eRandom).toBe(d.eRange); // a bot never computes the HUD number
          // §9.6.3: the re-dealt hand gives the same decision.
          expect(decide(other, profile, botSeed)).toEqual(d);
          if (bot?.river !== null && bot?.river !== undefined) counts.riverAir++;
          const plan = exploitPlan(obs, f, profile);
          if (plan.cbet || plan.valueMedium || plan.halveBluffs || plan.defend) counts.exploited++;
          counts.kinds.add(d.kind);
          actions.add(JSON.stringify(d.action));
        }
        if (actions.size > 1) counts.mixed++;
      },
    ),
    { seed: FC_SEED, numRuns: runs },
  );
  return counts;
}
