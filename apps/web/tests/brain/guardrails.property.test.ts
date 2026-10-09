/**
 * Guardrail properties (PLAN §8.8; C2 "advice is always legal", C6 "never fold when checking is
 * free; the guardrails always apply") at random decision points of hands played by the real
 * engine, with random proposals, illegal ones included (wrong types, a missing amount, NaN,
 * ±Infinity, fractions, amounts outside the bounds). 2,000 runs each:
 * - the result is legal: `isLegalAction` says so and the engine accepts it;
 * - applying the guardrails to their own result gives the same action (idempotent), whatever the
 *   features, even contradictory ones (p ≥ 0.95 with eRange < 0.03: rule 2 calls, rule 3 folds
 *   again, every time);
 * - with consistent features (`p = eRange^(1/nOpp)`, the real street, facing and need) the §8.8
 *   limits, written here again from the PLAN text, hold on every result, and a second pass fires
 *   nothing; a legal proposal that breaks no limit comes back as the same object;
 * - `isLegalAction` agrees with the engine on every proposal.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { features, perOpponentStrength } from '../../src/brain/features.ts';
import {
  guardrails,
  guardSpot,
  isLegalAction,
  type GuardSpot,
} from '../../src/brain/guardrails.ts';
import type { Facing } from '../../src/brain/types.ts';
import { rngFromSeed, type Seed128 } from '../../src/core/rng.ts';
import { observe } from '../../src/engine/observe.ts';
import { step } from '../../src/engine/step.ts';
import type {
  HandState,
  LegalActions,
  Observation,
  PlayerAction,
  Street,
} from '../../src/engine/types.ts';
import { FC_SEED } from '../engine/helpers.ts';
import { handArb, randomInput, seedArb } from '../engine/play.ts';
import { extrasFor, testProfile } from './fixtures.ts';

const RUNS = 2000;

/**
 * A random decision point: a dealt hand played at random up to its `pick`-th decision, counted
 * from the end half of the time (so river decisions come up often).
 */
const decisionArb: fc.Arbitrary<HandState> = fc
  .record({
    hand: handArb,
    pick: fc.nat({ max: 40 }),
    fromEnd: fc.boolean(),
    aggression: fc.integer({ min: 0, max: 100 }),
  })
  .map(({ hand, pick, fromEnd, aggression }) => {
    const rng = rngFromSeed(hand.policySeed);
    const points: HandState[] = [];
    let s = hand.h;
    for (let i = 0; i < 400 && s.phase !== 'complete'; i++) {
      if (s.phase === 'betting') points.push(s);
      s = step(s, randomInput(s, rng, aggression));
    }
    const n = points.length;
    return points[fromEnd ? n - 1 - (pick % Math.max(1, n)) : pick % Math.max(1, n)] ?? null;
  })
  .filter((h): h is HandState => h !== null);

type Amount = { rel: number } | { abs: number } | { edge: 'min' | 'max' | 'below' | 'above' };
interface Raw {
  kind: 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'junk' | 'noAmount';
  amount: Amount;
}

const amountArb: fc.Arbitrary<Amount> = fc.oneof(
  fc.double({ min: -0.5, max: 1.5, noNaN: true }).map((rel): Amount => ({ rel })),
  fc.double().map((abs): Amount => ({ abs })), // NaN, ±Infinity, −0, huge and tiny included
  fc.integer({ min: -100, max: 2_000_000 }).map((abs): Amount => ({ abs })),
  fc.constantFrom('min', 'max', 'below', 'above').map((edge): Amount => ({ edge })),
);

const rawArb: fc.Arbitrary<Raw> = fc.record({
  kind: fc.constantFrom<Raw['kind']>(
    'fold',
    'check',
    'call',
    'bet',
    'raise',
    'bet',
    'raise',
    'junk',
    'noAmount',
  ),
  amount: amountArb,
});

/** Mostly folds and calls: the actions rules 1–4 guard. */
const passiveRawArb: fc.Arbitrary<Raw> = fc.record({
  kind: fc.constantFrom<Raw['kind']>('fold', 'call', 'fold', 'call', 'check', 'bet', 'raise'),
  amount: amountArb,
});

/** The proposed action of a raw draw at this decision (amounts relative to the legal bounds). */
function proposalOf(raw: Raw, legal: LegalActions, pot: number): PlayerAction {
  switch (raw.kind) {
    case 'fold':
    case 'check':
    case 'call':
      return { type: raw.kind };
    case 'junk':
      return { type: 'allin' } as unknown as PlayerAction;
    case 'noAmount':
      return { type: 'raise' } as unknown as PlayerAction;
    default: {
      const b = legal.raise ?? legal.bet ?? { min: 1, max: pot + 1 };
      const a = raw.amount;
      const to =
        'rel' in a
          ? b.min + a.rel * (b.max - b.min)
          : 'abs' in a
            ? a.abs
            : { min: b.min, max: b.max, below: b.min - 1, above: b.max + 1 }[a.edge];
      return { type: raw.kind, to };
    }
  }
}

const unit = fc.double({ min: 0, max: 1, noNaN: true });

/** Any features at all, consistent or not: legality and idempotence must not depend on them. */
const anyFeaturesArb: fc.Arbitrary<GuardSpot['f']> = fc.record({
  street: fc.constantFrom<Street>('preflop', 'flop', 'turn', 'river'),
  facing: fc.constantFrom<Facing>(
    'none',
    'limpers',
    'open',
    '3bet',
    '4bet+',
    'bet',
    'raise',
    'allin',
  ),
  need: unit,
  eRange: unit,
  p: unit,
});

function observed(h: HandState): { obs: Observation; seat: number } {
  const seat = h.toAct as number;
  return { obs: observe(h, seat, extrasFor(h.seats.length)), seat };
}

function engineAccepts(h: HandState, seat: number, action: PlayerAction): boolean {
  try {
    step(h, { kind: 'act', seat, action });
    return true;
  } catch {
    return false;
  }
}

/** The §8.8 limits an action breaks, restated from the PLAN text. */
function brokenLimits(a: PlayerAction, s: GuardSpot): string[] {
  const { f, legal } = s;
  const broken: string[] = [];
  if (a.type === 'fold' && legal.canCheck) broken.push('1: fold when checking is free');
  if (a.type === 'fold' && f.p >= 0.95) broken.push('2: fold with p ≥ 0.95');
  if (a.type === 'call' && f.street === 'river' && f.eRange < 0.03) {
    broken.push('3: river call with eRange < 0.03');
  }
  if (f.facing === 'allin' && a.type === 'fold' && f.eRange >= f.need + 0.15) {
    broken.push('4: fold an all-in with eRange ≥ need + 0.15');
  }
  if (f.facing === 'allin' && a.type === 'call' && f.eRange < f.need - 0.25) {
    broken.push('4: call an all-in with eRange < need − 0.25');
  }
  return broken;
}

const CHEAP = testProfile('random', 1);

/**
 * The decision's real street, facing and need with a drawn `eRange` and the `p` it implies:
 * anywhere in [0, 1], at the §8.8 boundaries, or at `need` plus a margin.
 */
function consistentFeatures(
  obs: Observation,
  seed: Seed128,
  draw: { mode: number; u: number; at: number; delta: number },
): GuardSpot['f'] {
  const f = features(obs, CHEAP, seed, 0.5);
  const fixed = [0, 0.02, 0.0299, 0.03, 0.5, 0.9, 0.95, 0.97, 1];
  const eRange =
    draw.mode === 0
      ? draw.u
      : draw.mode === 1
        ? (fixed[draw.at % fixed.length] as number)
        : Math.min(1, Math.max(0, f.need + draw.delta));
  return {
    street: f.street,
    facing: f.facing,
    need: f.need,
    eRange,
    p: perOpponentStrength(eRange, f.nOpp),
  };
}

const drawArb = fc.record({
  mode: fc.integer({ min: 0, max: 2 }),
  u: unit,
  at: fc.nat(),
  delta: fc.constantFrom(-0.4, -0.25, -0.2, -0.1, 0, 0.1, 0.15, 0.2, 0.4),
});

describe('guardrail properties (§8.8, C2, C6)', () => {
  it(
    'never return an illegal action: isLegalAction and the engine agree',
    { timeout: 60_000 },
    () => {
      fc.assert(
        fc.property(decisionArb, rawArb, anyFeaturesArb, (h, raw, f) => {
          const { obs, seat } = observed(h);
          const spot = guardSpot(obs, f);
          const { action } = guardrails(spot, proposalOf(raw, obs.legal, obs.pot));
          expect(isLegalAction(obs.legal, action)).toBe(true);
          expect(engineAccepts(h, seat, action)).toBe(true);
        }),
        { seed: FC_SEED, numRuns: RUNS },
      );
    },
  );

  it('are idempotent: applying them twice equals applying them once', { timeout: 60_000 }, () => {
    fc.assert(
      fc.property(decisionArb, rawArb, anyFeaturesArb, (h, raw, f) => {
        const { obs } = observed(h);
        const spot = guardSpot(obs, f);
        const once = guardrails(spot, proposalOf(raw, obs.legal, obs.pot));
        expect(guardrails(spot, once.action).action).toEqual(once.action);
      }),
      { seed: FC_SEED, numRuns: RUNS },
    );
  });

  it(
    'with consistent features the §8.8 limits hold on every result, and a second pass fires nothing',
    { timeout: 60_000 },
    () => {
      let fired = 0;
      let stood = 0;
      const limits = new Set<string>();
      fc.assert(
        fc.property(decisionArb, passiveRawArb, drawArb, seedArb, (h, raw, draw, seed) => {
          const { obs } = observed(h);
          const spot = guardSpot(obs, consistentFeatures(obs, seed, draw));
          const proposed = proposalOf(raw, obs.legal, obs.pot);
          const result = guardrails(spot, proposed);
          expect(brokenLimits(result.action, spot)).toEqual([]);
          const again = guardrails(spot, result.action);
          expect(again.action).toBe(result.action);
          expect(again.fired).toEqual([]);
          const broken = brokenLimits(proposed, spot);
          for (const b of broken) limits.add(b);
          if (isLegalAction(obs.legal, proposed)) {
            if (broken.length === 0) {
              expect(result.action).toBe(proposed);
              expect(result.fired).toEqual([]);
              stood++;
            } else {
              expect(result.action).not.toEqual(proposed);
              fired++;
            }
          }
        }),
        { seed: FC_SEED, numRuns: RUNS },
      );
      // Both branches ran often, and every limit was tested by a proposal that broke it (rule 1's
      // only by an illegal one: folding when checking is free is not a legal action).
      expect(fired).toBeGreaterThan(50);
      expect(stood).toBeGreaterThan(300);
      expect([...limits].sort()).toEqual([
        '1: fold when checking is free',
        '2: fold with p ≥ 0.95',
        '3: river call with eRange < 0.03',
        '4: call an all-in with eRange < need − 0.25',
        '4: fold an all-in with eRange ≥ need + 0.15',
      ]);
    },
  );

  it('isLegalAction mirrors the engine on every proposal', { timeout: 60_000 }, () => {
    let legal = 0;
    fc.assert(
      fc.property(decisionArb, rawArb, (h, raw) => {
        const { obs, seat } = observed(h);
        const a = proposalOf(raw, obs.legal, obs.pot);
        const ok = isLegalAction(obs.legal, a);
        expect(ok).toBe(engineAccepts(h, seat, a));
        if (ok) legal++;
      }),
      { seed: FC_SEED, numRuns: RUNS },
    );
    expect(legal).toBeGreaterThan(400);
  });
});
