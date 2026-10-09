/**
 * The coach's properties at random decision points of hands played by the real engine (PLAN §8.1,
 * §8.11, §9.6; fast-check, 2,000 runs; Stage 5 acceptance 3 and 4). Each run takes one decision
 * point (any street, 2–9 seats, stacks from one chip to 500 bb, random labels and levels) and asks
 * `hint(obs, eRandom)`, with the HUD number given or (one run in five) left to the brain:
 * - C2: the advice is legal: `isLegalAction` and the engine's `step` accept it.
 * - C3 and §9.6.3 (non-cheating): every card the hero cannot see is dealt again (other seats'
 *   unrevealed hole cards, the burn cards, the stub; `permuteHidden`) and the hand observed again:
 *   the observation is the same, and so is the Decision, numbers and reasons included.
 * - C6: never a fold when checking is free; the guardrails hold (applying them again changes
 *   nothing).
 * - The reasons agree with the numbers (chunk 5.6's finding): a call explained as profitable has
 *   `E > need`, a call of an all-in `E ≥ need`, a fold of an all-in `E < need`.
 * - A close alternative is another kind of action, offered only in a close spot, within 3% of the
 *   pot of the recommendation (the coach's own sizes only: never an absurd deep all-in).
 * - §8.10 (risk R18, pitfall 34): the strength meter never argues against the move. Never Strong
 *   or Monster next to a fold; never Weak next to a bet or raise unless its main reason names a
 *   bluff (SEMI_BLUFF, CBET_DRY, PUSH_FOLD). The meter is the band of the fair-share `p` (§8.2),
 *   whose own band almost never needs that limit (at most 1% of the hints).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BLUFF_REASONS,
  deliberate,
  hint,
  kindOf,
  meterStrength,
  strengthOf,
} from '../../src/brain/decide.ts';
import { candidateKey } from '../../src/brain/ev.ts';
import { coachSeed } from '../../src/brain/features.ts';
import { guardrails, guardSpot, isLegalAction } from '../../src/brain/guardrails.ts';
import { COACH } from '../../src/brain/profiles.ts';
import { CLOSE_SPOT_POT } from '../../src/brain/tunables.ts';
import { observe } from '../../src/engine/observe.ts';
import type { HandState } from '../../src/engine/types.ts';
import { FC_SEED } from '../engine/helpers.ts';
import { permuteHidden } from '../engine/permute.ts';
import { handArb, seedArb } from '../engine/play.ts';
import { decisionPointAt, engineAccepts, extrasArb } from './points.ts';

const RUNS = 2000;

describe('the coach at random decision points (C2, C3, C6, §9.6)', () => {
  it(
    'legal, deterministic, blind to hidden cards, guarded, its reasons agree with its numbers and its meter with its move',
    { timeout: 600_000 },
    () => {
      const seen = { runs: 0, postflop: 0, nullHud: 0, close: 0, adjust: 0, guarded: 0 };
      const meter = { multiway: 0, folds: 0, value: 0, limited: 0 };
      const kinds = new Set<string>();
      const labels = new Set<string>();
      fc.assert(
        fc.property(
          handArb,
          extrasArb,
          fc.nat(),
          seedArb,
          fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { freq: 5 }),
          ({ h, policySeed }, extrasFor, pick, permSeed, eRandom) => {
            const point = decisionPointAt(h, policySeed, pick);
            fc.pre(point !== null);
            const s = point as HandState;
            const seat = s.toAct as number;
            const extras = extrasFor(s.seats.length);
            const obs = observe(s, seat, extras);
            const { decision: d, f } = deliberate(obs, COACH, coachSeed(obs), eRandom);
            seen.runs++;
            if (obs.board.length > 0) seen.postflop++;
            if (eRandom === null) seen.nullHud++;
            kinds.add(d.kind);

            // C2: legal for the brain's own check and for the engine.
            expect(isLegalAction(obs.legal, d.action)).toBe(true);
            expect(engineAccepts(s, seat, d)).toBe(true);
            expect(d.kind).toBe(kindOf(obs.legal, d.action));

            // C3 + §9.6.3: re-deal what the hero cannot see; same observation, same advice.
            const other = observe(permuteHidden(s, seat, permSeed), seat, extras);
            expect(other).toEqual(obs);
            expect(hint(other, eRandom)).toEqual(d);

            // C6: no fold when checking is free; the guardrails are a fixed point.
            if (obs.legal.canCheck) expect(d.action.type).not.toBe('fold');
            expect(guardrails(guardSpot(obs, f), d.action).fired).toEqual([]);
            if (d.trace.some((r) => r.code === 'GUARDRAIL')) seen.guarded++;

            // The main reason agrees with the numbers it shows (when no guardrail overruled it).
            const main = d.trace[0];
            if (main !== undefined && !d.trace.some((r) => r.code === 'GUARDRAIL')) {
              const E = main.data.E as number;
              const need = main.data.need as number;
              if (main.code === 'CALL_PROFITABLE') expect(E).toBeGreaterThan(need);
              if (main.code === 'CALL_ALLIN') expect(E).toBeGreaterThanOrEqual(need);
              if (main.code === 'FOLD_ALLIN') expect(E).toBeLessThan(need);
            }
            if (d.trace.some((r) => r.code === 'RANGE_ADJUST')) seen.adjust++;

            // §8.10: the strength meter never argues against the move (R18, pitfall 34).
            const mainCode = d.trace[0]?.code;
            expect(d.strength).toBe(meterStrength(f.p, d.action, mainCode));
            labels.add(d.strength);
            if (f.nOpp > 1) meter.multiway++;
            if (d.strength !== strengthOf(f.p)) meter.limited++;
            if (d.action.type === 'fold') {
              meter.folds++;
              expect(['strong', 'monster']).not.toContain(d.strength);
            }
            const aggressive = d.action.type === 'bet' || d.action.type === 'raise';
            if (aggressive && (mainCode === undefined || !BLUFF_REASONS.has(mainCode))) {
              meter.value++;
              expect(d.strength).not.toBe('weak');
            }

            // A close alternative: another kind, in a close spot, within 3% of the pot.
            if (d.alt !== null) {
              seen.close++;
              expect(d.confidence).toBe('close');
              expect(d.alt.type).not.toBe(d.action.type);
              const altEV = d.ev[candidateKey(obs.legal, d.alt)] as number;
              const recEV = d.ev[candidateKey(obs.legal, d.action)] as number;
              expect(Math.abs(altEV - recEV)).toBeLessThanOrEqual(CLOSE_SPOT_POT * obs.pot + 1e-9);
            }
          },
        ),
        { seed: FC_SEED, numRuns: RUNS },
      );
      expect(seen.runs).toBe(RUNS);
      expect(seen.postflop).toBeGreaterThan(RUNS / 4);
      expect(seen.nullHud).toBeGreaterThan(RUNS / 10);
      expect(seen.close).toBeGreaterThan(0);
      expect(seen.adjust).toBeGreaterThan(RUNS / 20);
      expect([...kinds].sort()).toEqual(['allin', 'bet', 'call', 'check', 'fold', 'raise']);
      expect([...labels].sort()).toEqual(['decent', 'marginal', 'monster', 'strong', 'weak']);
      expect(meter.multiway).toBeGreaterThan(RUNS / 2);
      expect(meter.folds).toBeGreaterThan(RUNS / 5);
      expect(meter.value).toBeGreaterThan(RUNS / 20);
      expect(meter.limited).toBeLessThanOrEqual(RUNS / 100);
    },
  );
});
