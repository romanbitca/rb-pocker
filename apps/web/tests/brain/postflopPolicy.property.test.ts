/**
 * Properties of the postflop policy and the sizing (PLAN §8.1, §8.11; fast-check, ≥ 2,000 runs):
 * - C2 legal: at random postflop decision points of hands played by the real engine (the brain
 *   never runs it; the test does, to build observations), every decision of every size set, at the
 *   real and at a random perceived equity, is accepted by `step()`; bets and raises are integer
 *   "to" amounts inside the legal bounds, multiples of the small blind unless at a bound, and
 *   'allin' exactly at the legal maximum.
 * - C6: never a fold when checking is free.
 * - C3: the same inputs (even a structured clone) give the same decision.
 * - C7 on synthetic features (real cards, chosen numbers): more equity never turns a call or a
 *   raise into a fold, and a cheaper price never turns a call into a fold.
 * - The sizing alone: any rule action over random legal bounds comes out legal.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { features } from '../../src/brain/features.ts';
import { postflopPolicy, postflopSpot, withEquity } from '../../src/brain/postflopPolicy.ts';
import { sizeIntent } from '../../src/brain/sizing.ts';
import type {
  BetPurpose,
  Features,
  PolicyDecision,
  PolicyIntent,
  PostflopSpot,
  SizeSet,
} from '../../src/brain/types.ts';
import { formatCards } from '../../src/core/cards.ts';
import { rngFromSeed, type Seed128 } from '../../src/core/rng.ts';
import { observe } from '../../src/engine/observe.ts';
import { step } from '../../src/engine/step.ts';
import type { HandState, LegalActions, PlayerAction } from '../../src/engine/types.ts';
import { FC_SEED } from '../engine/helpers.ts';
import { handArb, randomInput, seedArb } from '../engine/play.ts';
import { extrasFor, testProfile } from './fixtures.ts';
import { synth, synthLegal, type SynthSpec } from './postflopFixtures.ts';

const RUNS = 2000;
const SIZE_SETS: readonly SizeSet[] = ['texture', 'half', 'two', 'texture+exploit'];
const PROFILE = testProfile('random', 48);

/** Every postflop decision point of a hand played with the random legal policy. */
function postflopPoints(h: HandState, policySeed: Seed128): HandState[] {
  const rng = rngFromSeed(policySeed);
  const points: HandState[] = [];
  let s = h;
  for (let i = 0; i < 400 && s.phase !== 'complete'; i++) {
    if (s.phase === 'betting' && s.board.length >= 3) points.push(s);
    s = step(s, randomInput(s, rng));
  }
  return points;
}

/** The §8.7 / C2 / C6 checks of one decision against the seat's legal actions and sb. */
function expectLegalShape(d: PolicyDecision, legal: LegalActions, sb: number): void {
  const a: PlayerAction = d.action;
  if (legal.canCheck) expect(a.type).not.toBe('fold'); // C6
  if (a.type === 'bet' || a.type === 'raise') {
    const bounds = a.type === 'bet' ? legal.bet : legal.raise;
    expect(bounds).not.toBeNull();
    const { min, max } = bounds as { min: number; max: number };
    expect(Number.isSafeInteger(a.to)).toBe(true);
    expect(a.to).toBeGreaterThanOrEqual(min);
    expect(a.to).toBeLessThanOrEqual(max);
    if (a.to !== min && a.to !== max) expect(a.to % sb).toBe(0);
    expect(d.kind).toBe(a.to === max ? 'allin' : a.type);
  } else {
    expect(d.kind).toBe(a.type);
    if (a.type === 'check') expect(legal.canCheck).toBe(true);
    if (a.type === 'call') expect(legal.canCall).toBe(true);
    if (a.type === 'fold') expect(legal.canFold).toBe(true);
  }
  expect(d.trace.length).toBeGreaterThan(0);
  for (const r of d.trace) {
    for (const v of Object.values(r.data)) {
      expect(typeof v === 'string' || Number.isFinite(v)).toBe(true);
    }
  }
}

describe('postflop decisions on hands played by the engine (C2, C3, C6)', () => {
  it(
    'every size set gives a legal, snapped, deterministic action; never a fold when checking is free',
    { timeout: 120_000 },
    () => {
      let checked = 0;
      const kinds = new Set<string>();
      fc.assert(
        fc.property(
          handArb,
          fc.nat(),
          fc.double({ min: 0, max: 1, noNaN: true }),
          seedArb,
          ({ h, policySeed }, pick, e, seed) => {
            const points = postflopPoints(h, policySeed);
            if (points.length === 0) return;
            const s = points[pick % points.length] as HandState;
            const seat = s.toAct as number;
            const obs = observe(s, seat, extrasFor(s.seats.length));
            const f0 = features(obs, PROFILE, seed, 0.5);
            const spot = postflopSpot(obs);
            const sizing = SIZE_SETS[pick % SIZE_SETS.length] as SizeSet;
            for (const f of [f0, withEquity(f0, e)]) {
              const d = postflopPolicy(f, spot, sizing);
              expectLegalShape(d, obs.legal, obs.sb);
              // The engine accepts it (C2).
              expect(() => step(s, { kind: 'act', seat, action: d.action })).not.toThrow();
              // C3: the same inputs, and a clone of them, give the same decision.
              expect(postflopPolicy(structuredClone(f), structuredClone(spot), sizing)).toEqual(d);
              kinds.add(d.kind);
              checked++;
            }
          },
        ),
        { seed: FC_SEED, numRuns: RUNS },
      );
      expect(checked).toBeGreaterThan(RUNS); // most hands reach the flop
      expect([...kinds].sort()).toEqual(['allin', 'bet', 'call', 'check', 'fold', 'raise']);
    },
  );
});

// ── Synthetic features (C7) ────────────────────────────────────────────────────────────────────

const DECK = Array.from({ length: 52 }, (_, i) => i);

const situationArb = fc.record({
  cards: fc.shuffledSubarray(DECK, { minLength: 7, maxLength: 7 }),
  boardLen: fc.constantFrom(3, 4, 5),
  nOpp: fc.integer({ min: 1, max: 4 }),
  potSB: fc.integer({ min: 3, max: 400 }),
  callShare: fc.double({ min: 0, max: 1, noNaN: true }),
  cheaper: fc.double({ min: 0, max: 1, noNaN: true }),
  facing: fc.constantFrom('none', 'bet', 'raise', 'allin'),
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

const SB = 50;

/**
 * A consistent synthetic decision: the pot in small blinds; facing a bet, a call of at most the
 * pot (the bet faced is in the pot, so `need` stays below 1/2) and at most the hero's stack.
 */
function specOf(x: Situation, toCallOverride?: number): SynthSpec {
  const pot = x.potSB * SB;
  const heroStack = x.stackSB * SB;
  const wanted = Math.max(SB, Math.round((x.callShare * pot) / SB) * SB);
  const toCall =
    x.facing === 'none' ? 0 : Math.min(toCallOverride ?? Math.min(wanted, pot), heroStack);
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
    facing: x.facing === 'none' ? 'none' : x.facing,
    heroStack,
    stackBehind: Math.min(x.behindSB * SB, Math.max(0, heroStack - toCall)),
    heroBetStreets: x.heroBetStreets,
  };
}

const passiveOrAggressive = (d: PolicyDecision): boolean => d.action.type !== 'fold';

describe('C7 monotonicity on synthetic features', () => {
  it('more equity never turns a call or a raise into a fold', { timeout: 60_000 }, () => {
    let continued = 0;
    fc.assert(
      fc.property(situationArb, (x) => {
        const { f, spot } = synth(specOf(x));
        const lo = postflopPolicy(withEquity(f, Math.min(x.e1, x.e2)), spot, x.sizing);
        const hi = postflopPolicy(withEquity(f, Math.max(x.e1, x.e2)), spot, x.sizing);
        if (lo.action.type === 'call' || lo.action.type === 'raise') {
          continued++;
          expect(passiveOrAggressive(hi)).toBe(true);
        }
        if (spot.legal.canCheck) {
          expect(lo.action.type).not.toBe('fold');
          expect(hi.action.type).not.toBe('fold');
        }
      }),
      { seed: FC_SEED, numRuns: RUNS },
    );
    expect(continued).toBeGreaterThan(RUNS / 10);
  });

  it('a cheaper price never turns a call into a fold', { timeout: 60_000 }, () => {
    let calls = 0;
    fc.assert(
      fc.property(situationArb, (x) => {
        if (x.facing === 'none') return;
        const dear = specOf(x);
        const cheapCall = Math.max(SB, Math.round(((dear.toCall as number) * x.cheaper) / SB) * SB);
        const cheap = specOf(x, Math.min(cheapCall, dear.toCall as number));
        const a = synth(dear);
        const b = synth(cheap);
        const dearDecision = postflopPolicy(a.f, a.spot, x.sizing);
        const cheapDecision = postflopPolicy(b.f, b.spot, x.sizing);
        expect(b.f.need).toBeLessThanOrEqual(a.f.need);
        if (dearDecision.action.type === 'call') {
          calls++;
          expect(passiveOrAggressive(cheapDecision)).toBe(true);
        }
      }),
      { seed: FC_SEED, numRuns: RUNS },
    );
    expect(calls).toBeGreaterThan(RUNS / 10);
  });
});

// ── The sizing alone ───────────────────────────────────────────────────────────────────────────

const PURPOSES: readonly BetPurpose[] = [
  'value',
  'protect',
  'thinValue',
  'semiBluff',
  'cbet',
  'bluff',
];

describe('sizeIntent over random legal bounds', () => {
  it('any rule action comes out legal and snapped (§8.7)', () => {
    fc.assert(
      fc.property(
        fc.record({
          bbIndex: fc.integer({ min: 0, max: 4 }),
          potBB: fc.double({ min: 1.5, max: 400, noNaN: true }),
          toCallBB: fc.double({ min: 0, max: 200, noNaN: true }),
          facing: fc.boolean(),
          stackBB: fc.double({ min: 0.01, max: 600, noNaN: true }),
          streetBB: fc.double({ min: 0, max: 50, noNaN: true }),
          spr: fc.double({ min: 0.1, max: 40, noNaN: true }),
          kind: fc.constantFrom('fold', 'check', 'call', 'bet', 'raise'),
          purpose: fc.constantFrom(...PURPOSES),
          allIn: fc.boolean(),
          sizing: fc.constantFrom(...SIZE_SETS),
          street: fc.constantFrom('flop', 'turn', 'river'),
          texture: fc.constantFrom('dry', 'wet', 'veryWet'),
          bucket: fc.constantFrom('monster', 'strong', 'medium', 'draw', 'air'),
          position: fc.constantFrom('IP', 'OOP'),
        }),
        (x) => {
          const bb = [2, 10, 20, 100, 1000][x.bbIndex] as number;
          const sb = bb / 2;
          const heroStack = Math.max(1, Math.round(x.stackBB * bb));
          const heroStreetBet = x.facing ? Math.round(x.streetBB * bb) : 0;
          const toCall = x.facing ? Math.max(1, Math.round(x.toCallBB * bb)) : 0;
          const currentBet = heroStreetBet + toCall;
          const legal = synthLegal(toCall, heroStack, heroStreetBet, currentBet, bb);
          const pot = Math.max(Math.round(x.potBB * bb), currentBet + heroStreetBet);
          const f: Pick<
            Features,
            'street' | 'pot' | 'toCall' | 'effStack' | 'spr' | 'position' | 'bucket' | 'texture'
          > = {
            street: x.street,
            pot,
            toCall: legal.callAmount,
            effStack: Math.round(x.spr * pot),
            spr: x.spr,
            position: x.position,
            bucket: x.bucket,
            texture: x.texture,
          };
          const spot: Pick<
            PostflopSpot,
            'board' | 'sb' | 'legal' | 'currentBet' | 'heroStreetBet'
          > = { board: [0, 5, 10, 15, 20].slice(0, 3), sb, legal, currentBet, heroStreetBet };
          const rule: PolicyIntent = { kind: x.kind, purpose: x.purpose, allIn: x.allIn };
          const sized = sizeIntent(rule, f, spot, x.sizing);
          expectLegalShape({ ...sized, trace: [{ code: 'GUARDRAIL', data: {} }] }, legal, sb);
          if (rule.kind === 'fold' && legal.canFold) expect(sized.action.type).toBe('fold');
        },
      ),
      { seed: FC_SEED, numRuns: RUNS },
    );
  });
});
