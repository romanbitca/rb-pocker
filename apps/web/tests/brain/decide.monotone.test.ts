/**
 * C7 (PLAN §8.1, §8.11; fast-check, 2,000 runs each): with all else fixed, more equity never turns
 * a call into a fold or a raise into a fold, and a cheaper price never turns a call into a fold.
 * The property is on the rule stage of `decide()` with synthetic features: the policy (§8.3–8.5)
 * and then the guardrails (§8.8), as the coach's pick is made (and every bot's `A*`, §9.4 step 2).
 *
 * - After the flop: real cards, chosen equity, pot, price, stacks and position (`synth`); the
 *   features and the guardrails both see the equity (`withEquity`); every size set (§9.2).
 * - Before the flop: decision points of hands played by the engine; "more equity" is a larger
 *   perceived-equity draw (`PreflopStyle.equityNoise`, how a bot's E′ reaches the preflop rules,
 *   §9.4), the guardrails reading the true numbers; "a cheaper price" is a smaller call (`toCall`
 *   and `need`, the pot fixed), with each bot level's thresholds and the coach's.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { features } from '../../src/brain/features.ts';
import { guardrails, guardSpot, type GuardSpot } from '../../src/brain/guardrails.ts';
import { postflopPolicy, withEquity } from '../../src/brain/postflopPolicy.ts';
import { preflopPolicy, preflopStyle } from '../../src/brain/preflopPolicy.ts';
import { COACH, profileFor } from '../../src/brain/profiles.ts';
import type { BrainProfile, Features, PostflopSpot, SizeSet } from '../../src/brain/types.ts';
import { formatCards } from '../../src/core/cards.ts';
import { observe } from '../../src/engine/observe.ts';
import {
  PERSONALITY_IDS,
  type HandState,
  type Observation,
  type PlayerAction,
} from '../../src/engine/types.ts';
import { FC_SEED } from '../engine/helpers.ts';
import { handArb } from '../engine/play.ts';
import { extrasFor, testProfile } from './fixtures.ts';
import { decisionPointAt } from './points.ts';
import { synth, type SynthSpec } from './postflopFixtures.ts';

const RUNS = 2000;
const SB = 50;
const SIZE_SETS: readonly SizeSet[] = ['texture', 'half', 'two', 'texture+exploit'];

/** The rule stage of a decision: the policy's action, then the guardrails on these numbers. */
const guarded = (spot: GuardSpot, action: PlayerAction): PlayerAction =>
  guardrails(spot, action).action;

const continues = (a: PlayerAction): boolean => a.type !== 'fold';
const callOrRaise = (a: PlayerAction): boolean => a.type === 'call' || a.type === 'raise';

// ── After the flop ─────────────────────────────────────────────────────────────────────────────

const DECK = Array.from({ length: 52 }, (_, i) => i);

const situationArb = fc.record({
  cards: fc.shuffledSubarray(DECK, { minLength: 7, maxLength: 7 }),
  boardLen: fc.constantFrom(3, 4, 5),
  nOpp: fc.integer({ min: 1, max: 4 }),
  potSB: fc.integer({ min: 3, max: 400 }),
  callShare: fc.double({ min: 0.01, max: 1, noNaN: true }),
  cheaper: fc.double({ min: 0, max: 1, noNaN: true }),
  facing: fc.constantFrom('bet', 'raise', 'allin'),
  spr: fc.double({ min: 0.2, max: 25, noNaN: true }),
  position: fc.constantFrom('IP', 'OOP'),
  aggressor: fc.boolean(),
  heroBetStreets: fc.integer({ min: 0, max: 2 }),
  stackSB: fc.integer({ min: 1, max: 4000 }),
  behindSB: fc.integer({ min: 0, max: 4000 }),
  e1: fc.double({ min: 0, max: 1, noNaN: true }),
  e2: fc.double({ min: 0, max: 1, noNaN: true }),
  sizing: fc.constantFrom(...SIZE_SETS),
});
type Situation = typeof situationArb extends fc.Arbitrary<infer T> ? T : never;

function specOf(x: Situation, toCallOverride?: number): SynthSpec {
  const pot = x.potSB * SB;
  const heroStack = x.stackSB * SB;
  const wanted = Math.max(SB, Math.round((x.callShare * pot) / SB) * SB);
  const toCall = Math.min(toCallOverride ?? Math.min(wanted, pot), heroStack);
  return {
    hole: formatCards(x.cards.slice(0, 2)),
    board: formatCards(x.cards.slice(2, 2 + x.boardLen)),
    E: x.e1,
    nOpp: x.nOpp,
    pot,
    toCall,
    spr: x.spr,
    position: x.position,
    aggressor: x.aggressor,
    facing: x.facing,
    heroStack,
    stackBehind: Math.min(x.behindSB * SB, Math.max(0, heroStack - toCall)),
    heroBetStreets: x.heroBetStreets,
  };
}

/** The coach's (or a bot's A*) postflop pick with equity `e`, guardrails included. */
function postflopPick(f: Features, spot: PostflopSpot, e: number, sizing: SizeSet): PlayerAction {
  const seen = withEquity(f, e);
  const action = postflopPolicy(seen, spot, sizing).action;
  return guarded(
    { f: seen, legal: spot.legal, sb: spot.sb, streetBet: spot.heroStreetBet },
    action,
  );
}

describe('C7 after the flop (synthetic features, guardrails applied)', () => {
  it('more equity never turns a call or a raise into a fold', { timeout: 120_000 }, () => {
    let continued = 0;
    fc.assert(
      fc.property(situationArb, (x) => {
        const { f, spot } = synth(specOf(x));
        const lo = postflopPick(f, spot, Math.min(x.e1, x.e2), x.sizing);
        const hi = postflopPick(f, spot, Math.max(x.e1, x.e2), x.sizing);
        if (callOrRaise(lo)) {
          continued++;
          expect(continues(hi)).toBe(true);
        }
      }),
      { seed: FC_SEED, numRuns: RUNS },
    );
    expect(continued).toBeGreaterThan(RUNS / 20);
  });

  it('a cheaper price never turns a call into a fold', { timeout: 120_000 }, () => {
    let calls = 0;
    fc.assert(
      fc.property(situationArb, (x) => {
        const dear = specOf(x);
        const cheapCall = Math.max(SB, Math.round(((dear.toCall as number) * x.cheaper) / SB) * SB);
        const cheap = specOf(x, Math.min(cheapCall, dear.toCall as number));
        const a = synth(dear);
        const b = synth(cheap);
        expect(b.f.need).toBeLessThanOrEqual(a.f.need);
        const dearPick = postflopPick(a.f, a.spot, x.e1, x.sizing);
        const cheapPick = postflopPick(b.f, b.spot, x.e1, x.sizing);
        if (dearPick.type === 'call') {
          calls++;
          expect(continues(cheapPick)).toBe(true);
        }
      }),
      { seed: FC_SEED, numRuns: RUNS },
    );
    expect(calls).toBeGreaterThan(RUNS / 20);
  });
});

// ── Before the flop ────────────────────────────────────────────────────────────────────────────

/** The coach and each bot level's thresholds (looseness, position awareness; no jitter). */
const PROFILES: readonly BrainProfile[] = [
  COACH,
  ...PERSONALITY_IDS.flatMap((id) => [profileFor(id, 'easy'), profileFor(id, 'medium')]),
];
/** Cheap features: the preflop rules read the ranges, not the eRange Monte Carlo. */
const FEATURES = testProfile('reweight+stats', 32);

const preflopArb = fc.record({
  hand: handArb,
  pick: fc.nat(),
  profile: fc.nat({ max: PROFILES.length - 1 }),
  n1: fc.double({ min: -0.4, max: 0.4, noNaN: true }),
  n2: fc.double({ min: -0.4, max: 0.4, noNaN: true }),
  cheaper: fc.double({ min: 0, max: 1, noNaN: true }),
});

/** A preflop decision point facing something to call, with its features. */
function preflopSpot(
  h: HandState,
  policySeed: Parameters<typeof decisionPointAt>[1],
  pick: number,
): { obs: Observation; f: Features } | null {
  const s = decisionPointAt(h, policySeed, pick % 3);
  if (s === null || s.board.length > 0) return null;
  const obs = observe(s, s.toAct as number, extrasFor(s.seats.length));
  if (obs.legal.toCall <= 0) return null;
  return { obs, f: features(obs, FEATURES, policySeed) };
}

function preflopPick(
  obs: Observation,
  f: Features,
  profile: BrainProfile,
  noise: number,
): PlayerAction {
  const style = preflopStyle(profile, { noise, jitter: 0 });
  const action = preflopPolicy(obs, f, { style, rangeModel: profile.rangeModel }).action;
  return guarded(guardSpot(obs, f), action);
}

describe('C7 before the flop (decision points of real hands, guardrails applied)', () => {
  it(
    'more perceived equity never turns a call or a raise into a fold',
    { timeout: 300_000 },
    () => {
      let continued = 0;
      fc.assert(
        fc.property(preflopArb, ({ hand, pick, profile, n1, n2 }) => {
          const spot = preflopSpot(hand.h, hand.policySeed, pick);
          fc.pre(spot !== null);
          const { obs, f } = spot as { obs: Observation; f: Features };
          const p = PROFILES[profile] as BrainProfile;
          const lo = preflopPick(obs, f, p, Math.min(n1, n2));
          const hi = preflopPick(obs, f, p, Math.max(n1, n2));
          if (callOrRaise(lo)) {
            continued++;
            expect(continues(hi)).toBe(true);
          }
        }),
        { seed: FC_SEED, numRuns: RUNS },
      );
      expect(continued).toBeGreaterThan(RUNS / 20);
    },
  );

  it('a cheaper price never turns a call into a fold', { timeout: 300_000 }, () => {
    let calls = 0;
    fc.assert(
      fc.property(preflopArb, ({ hand, pick, profile, n1, cheaper }) => {
        const spot = preflopSpot(hand.h, hand.policySeed, pick);
        fc.pre(spot !== null);
        const { obs, f } = spot as { obs: Observation; f: Features };
        const toCall = Math.floor(f.toCall * cheaper);
        const cheap: Features = {
          ...f,
          toCall,
          need: toCall > 0 ? toCall / (f.winPot + toCall) : 0,
        };
        const p = PROFILES[profile] as BrainProfile;
        const dearPick = preflopPick(obs, f, p, n1);
        const cheapPick = preflopPick(obs, cheap, p, n1);
        if (dearPick.type === 'call') {
          calls++;
          expect(continues(cheapPick)).toBe(true);
        }
      }),
      { seed: FC_SEED, numRuns: RUNS },
    );
    expect(calls).toBeGreaterThan(RUNS / 20);
  });
});
