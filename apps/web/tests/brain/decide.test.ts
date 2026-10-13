/**
 * The decision pipeline (PLAN §8.1 C1, §8.2, §9.1, §9.2, §9.4, Appendix A.5): the profiles, the
 * §9.4 draws, the bot's candidates and scores, the pick, and the coach's hint extras. Spots are
 * played by the real engine and observed with `observe()` (the brain never runs the engine).
 */
import { describe, expect, it } from 'vitest';
import {
  bluff3betHand,
  botCandidates,
  closeAlternative,
  hintConfidence,
  sensibleAlternatives,
  decide,
  deliberate,
  hint,
  kindOf,
  mixDraws,
  perceive,
  ruleAction,
  softmaxIndex,
  strengthOf,
  type MixDraws,
} from '../../src/brain/decide.ts';
import { candidateKey } from '../../src/brain/ev.ts';
import { coachSeed, features } from '../../src/brain/features.ts';
import { guardrails, guardSpot, isLegalAction } from '../../src/brain/guardrails.ts';
import { aggressionBias, COACH, COACH_ID, profileFor } from '../../src/brain/profiles.ts';
import {
  LEVEL_PARAMS,
  MIX_BLUFF_BONUS,
  MIX_CALL_STICKINESS,
  MIX_RULE_BONUS,
  MIX_RULE_BONUS_PREFLOP,
  MIX_SLOWPLAY_BONUS,
  PERSONALITIES,
} from '../../src/brain/tunables.ts';
import type { BrainProfile, EvCandidate } from '../../src/brain/types.ts';
import { parseCards } from '../../src/core/cards.ts';
import { deriveSeed, type Seed128 } from '../../src/core/rng.ts';
import {
  BOT_LEVELS,
  PERSONALITY_IDS,
  type BotLevel,
  type Observation,
  type PersonalityId,
} from '../../src/engine/types.ts';
import { bet, call, check, fold, raise } from '../engine/play.ts';
import { observeSpot, playSpot } from './fixtures.ts';

const SEED: Seed128 = '0000000000000000000000000000d3c1';
const seed = (i: number): Seed128 => deriveSeed(SEED, 'test', i);
const BB = 100;

/** 6-max, 100 bb, button 0: seat 3 is first to act. */
const sixMax = (
  hero: number,
  hole: string,
  inputs: Parameters<typeof playSpot>[0]['inputs'] = [],
) =>
  observeSpot(
    playSpot({
      stacks: new Array<number>(6).fill(100 * BB),
      button: 0,
      holes: { [hero]: hole },
      inputs,
    }),
    hero,
  );

/** Heads-up postflop spot, hero = seat 0 (the button). */
const headsUp = (
  hole: string,
  board: string,
  inputs: Parameters<typeof playSpot>[0]['inputs'],
  hero = 0,
): Observation =>
  observeSpot(
    playSpot({ stacks: [10000, 10000], button: 0, holes: { [hero]: hole }, board, inputs }),
    hero,
  );

const DRAWS: MixDraws = { z: 0, u: 0, limp: 1, bluff: 1, slowplay: 1, pick: 0.5 };

describe('profiles (§9.1 × §9.2, Appendix A.5)', () => {
  it('a bot is its personality at its level', () => {
    const p = profileFor('station', 'easy');
    expect(p).toEqual({
      id: 'station/easy',
      looseness: 3.4,
      pfrRatio: 0.15,
      aggressionBias: Math.log(0.7 / 2.5) * 2.1, // in units of T (§9.4 step 3)
      bluffFreq: 0.05, // Easy: "random 5%" whatever the personality
      bluff3betFreq: 0,
      stickiness: 1.4,
      slowplayFreq: 0.3,
      equityNoiseSD: 0.12,
      mcTrials: 200,
      rangeModel: 'random',
      positionAwareness: 0,
      sizing: 'half',
      temperature: 0.25,
      defenseFactor: 0.55,
      preflopJitter: 0.4,
      balancedBluffs: false,
      exploit: false,
      deterministic: false,
      neverLimp: false,
    });
    const m = profileFor('maniac', 'medium');
    expect(m).toMatchObject({
      id: 'maniac/medium',
      looseness: 3.5,
      bluffFreq: 0.35, // Medium: the personality's base
      bluff3betFreq: 0.15,
      mcTrials: 500,
      equityNoiseSD: 0.07,
      rangeModel: 'static',
      positionAwareness: 0.5,
      sizing: 'two',
      temperature: 0.12,
      defenseFactor: 0.7,
      preflopJitter: 0.2,
    });
    expect(m.aggressionBias).toBeCloseTo(Math.log(5 / 2.5) * 2.1, 12);
  });

  it('every personality at every level: the §9.1 row and the §9.2 column', () => {
    for (const id of PERSONALITY_IDS) {
      for (const level of BOT_LEVELS) {
        const p = profileFor(id, level);
        const row = PERSONALITIES[id];
        const col = LEVEL_PARAMS[level];
        expect(p.id).toBe(`${id}/${level}`);
        expect(p).toMatchObject({
          looseness: row.looseness,
          pfrRatio: row.pfrRatio,
          stickiness: row.stickiness,
          slowplayFreq: row.slowplayFreq,
          bluff3betFreq: row.bluff3betFreq,
          bluffFreq: col.bluffFreq ?? row.bluffFreq,
          mcTrials: col.mcTrials,
          temperature: col.temperature,
          deterministic: false,
          neverLimp: false,
        });
        expect(p.aggressionBias).toBe(aggressionBias(row.af));
      }
    }
    expect(aggressionBias(2.5)).toBe(0);
  });

  it('COACH is the TAG row with the A.5 overrides', () => {
    expect(COACH).toEqual({
      id: COACH_ID,
      looseness: 1,
      pfrRatio: 0.82,
      aggressionBias: 0,
      bluffFreq: 0,
      bluff3betFreq: 0,
      stickiness: 1,
      slowplayFreq: 0,
      equityNoiseSD: 0,
      mcTrials: 4000,
      rangeModel: 'reweight+stats',
      positionAwareness: 1,
      sizing: 'texture',
      temperature: 0,
      defenseFactor: 1,
      preflopJitter: 0,
      balancedBluffs: false,
      exploit: false,
      deterministic: true,
      neverLimp: true,
    });
    expect(Object.isFrozen(COACH)).toBe(true);
  });
});

describe('the §9.4 draws', () => {
  it('are a pure function of the seed, in range, and z is N(0, 1)', () => {
    expect(mixDraws(seed(1))).toEqual(mixDraws(seed(1)));
    expect(mixDraws(seed(1))).not.toEqual(mixDraws(seed(2)));
    const zs: number[] = [];
    for (let i = 0; i < 4000; i++) {
      const d = mixDraws(seed(i));
      zs.push(d.z);
      expect(Number.isFinite(d.z)).toBe(true);
      expect(d.u).toBeGreaterThanOrEqual(-1);
      expect(d.u).toBeLessThan(1);
      for (const x of [d.limp, d.bluff, d.slowplay, d.pick]) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThan(1);
      }
    }
    const mean = zs.reduce((a, b) => a + b, 0) / zs.length;
    const sd = Math.sqrt(zs.reduce((a, b) => a + (b - mean) ** 2, 0) / zs.length);
    expect(Math.abs(mean)).toBeLessThan(0.05);
    expect(Math.abs(sd - 1)).toBeLessThan(0.05);
  });

  it("come from deriveSeed(seed, 'mix'): the Monte Carlo and the think time use other streams", () => {
    // The seed itself feeds eRange; changing only the 'mix' child changes only the draws.
    const d = mixDraws(seed(3));
    expect(mixDraws(deriveSeed(seed(3), 'mix'))).not.toEqual(d);
  });
});

describe('softmax pick (§9.4 step 5)', () => {
  it('argmax when T ≤ 0; otherwise P(i) ∝ exp(score / T)', () => {
    expect(softmaxIndex([0.1, 0.5, 0.2], 0, 0.99)).toBe(1);
    expect(softmaxIndex([0.1, 0.5, 0.2], -1, 0)).toBe(1);
    const scores = [0, 0.1, -0.2];
    const T = 0.12;
    const w = scores.map((s) => Math.exp(s / T));
    const total = w.reduce((a, b) => a + b, 0);
    const counts = [0, 0, 0];
    const N = 10000;
    for (let i = 0; i < N; i++) {
      const k = softmaxIndex(scores, T, (i + 0.5) / N);
      counts[k] = (counts[k] as number) + 1;
    }
    for (let k = 0; k < 3; k++) {
      expect((counts[k] as number) / N).toBeCloseTo((w[k] as number) / total, 3);
    }
  });
});

describe('small helpers', () => {
  it('strengthOf: Weak < 0.35 ≤ Marginal < 0.45 ≤ Decent < 0.65 ≤ Strong < 0.85 ≤ Monster', () => {
    expect(strengthOf(0.349)).toBe('weak');
    expect(strengthOf(0.35)).toBe('marginal');
    expect(strengthOf(0.45)).toBe('decent');
    expect(strengthOf(0.65)).toBe('strong');
    expect(strengthOf(0.85)).toBe('monster');
  });

  it('kindOf: a bet or raise to the legal maximum is all-in; a call stays a call', () => {
    const obs = sixMax(3, 'As Ah');
    const max = obs.legal.raise?.max as number;
    expect(kindOf(obs.legal, { type: 'raise', to: max })).toBe('allin');
    expect(kindOf(obs.legal, { type: 'raise', to: 250 })).toBe('raise');
    expect(kindOf(obs.legal, { type: 'call' })).toBe('call');
  });

  it('bluff 3-bet hands: suited A5–A2 and suited connectors 54–T9', () => {
    for (const h of ['As 5s', 'Ah 2h', '5d 4d', 'Tc 9c'])
      expect(bluff3betHand(parseCards(h))).toBe(true);
    for (const h of ['As 6s', 'Ah 5d', 'Jc Tc', '4d 3d', '9c 7c']) {
      expect(bluff3betHand(parseCards(h))).toBe(false);
    }
  });
});

describe('the coach (C1, §8.2)', () => {
  it('hint(obs, null) is decide(obs, COACH, coachSeed(obs))', () => {
    for (const obs of [
      sixMax(3, 'As Ah'),
      sixMax(0, '6c 6d', [fold(3), fold(4), raise(5, 250)]),
      headsUp('Ah Kh', 'Qh 7h 2c', [raise(0, 300), call(1), bet(1, 200)]),
    ]) {
      expect(hint(obs, null)).toEqual(decide(obs, COACH, coachSeed(obs)));
    }
  });

  it('the pick is the rule action after the guardrails, whatever the EVs say', () => {
    const obs = headsUp('Ah Kh', 'Qh 7h 2c', [raise(0, 300), call(1), bet(1, 200)]);
    const d = deliberate(obs, COACH, coachSeed(obs));
    expect(d.bot).toBeNull();
    const guarded = guardrails(guardSpot(obs, d.f), d.rule.action).action;
    expect(d.decision.action).toEqual(guarded);
    expect(d.decision.ev[candidateKey(obs.legal, d.decision.action)]).toBeDefined();
  });

  it('a given HUD number is used as eRandom; null computes the same deterministic one', () => {
    const obs = sixMax(3, 'Kd Qd');
    expect(hint(obs, 0.31).eRandom).toBe(0.31);
    expect(hint(obs, null).eRandom).toBe(hint(obs, null).eRandom);
  });

  it('RANGE_ADJUST carries both equities exactly when §8.10 asks for them', () => {
    const obs = headsUp(
      '5h 4h',
      'As Kd 9c 2s Jd',
      [
        raise(0, 300),
        call(1),
        check(1),
        bet(0, 200),
        call(1),
        check(1),
        bet(0, 500),
        call(1),
        check(1),
        bet(0, 2000),
      ],
      1,
    );
    const d = deliberate(obs, COACH, coachSeed(obs));
    const adjust = d.decision.trace.find((r) => r.code === 'RANGE_ADJUST');
    expect(d.f.rangeAdjust).toBe(adjust !== undefined);
    if (adjust !== undefined) {
      expect(adjust.data).toEqual({ eRandom: d.f.eRandom, eRange: d.f.eRange, need: d.f.need });
    }
  });

  it('one WHY_NOT per other sensible action: the coach`s own size, its EV and what it loses', () => {
    const obs = sixMax(0, '6c 6d', [fold(3), fold(4), raise(5, 250)]);
    const d = hint(obs, null);
    expect(d.action).toEqual({ type: 'call' });
    const whyNot = d.trace.filter((r) => r.code.startsWith('WHY_NOT_'));
    expect(whyNot.map((r) => r.code).sort()).toEqual(['WHY_NOT_FOLD', 'WHY_NOT_RAISE']);
    const recEV = d.ev.call as number;
    for (const r of whyNot) {
      const key = r.data.alt as keyof typeof d.ev;
      expect(r.data.ev).toBe(d.ev[key]);
      expect(r.data.loss).toBeCloseTo(recEV - (d.ev[key] as number), 9);
    }
    // The raise is the §8.3 3-bet of the spot (3 × the open in position), not the EV-best size.
    expect(whyNot.find((r) => r.code === 'WHY_NOT_RAISE')?.data.alt).toBe('raise:750');
  });

  it('never offers a limp, a complete or a short stack`s flat call as an alternative (C10, §8.4)', () => {
    const utg = hint(sixMax(3, '7c 2d'), null);
    expect(utg.trace.some((r) => r.code === 'WHY_NOT_CALL')).toBe(false);
    const sb = hint(sixMax(1, 'Ac Kd', [fold(3), fold(4), fold(5), fold(0)]), null);
    expect(sb.trace.some((r) => r.code === 'WHY_NOT_CALL')).toBe(false);
    expect(sb.alt?.type).not.toBe('call');
  });

  it('the rule of 2 and 4 on a draw: outs and the exact chances, the big-draw warning above 8 outs', () => {
    // Nut flush draw on the flop: the 9 flush cards and the cards that pair the hero (§6.3).
    const obs = headsUp('Ah 5h', 'Kh 9h 2c', [raise(0, 300), call(1), check(1)]);
    const { decision: d, f } = deliberate(obs, COACH, coachSeed(obs));
    expect(f.outs).toBe(15);
    const rule = d.trace.find((r) => r.code === 'RULE_2_4');
    expect(rule?.data.outs).toBe(15);
    expect(rule?.data.nextCard).toBeCloseTo(15 / 47, 12);
    expect(rule?.data.byRiver).toBeCloseTo(1 - (32 * 31) / (47 * 46), 12);
    expect(d.trace.some((r) => r.code === 'RULE_2_4_BIG')).toBe(true);
    // No draw, no trick.
    const made = hint(headsUp('Kc Kd', 'Ks 7h 2c', [raise(0, 300), call(1), check(1)]), null);
    expect(made.trace.some((r) => r.code === 'RULE_2_4')).toBe(false);
  });

  it('confidence and the close alternative: the recommendation against its best alternative', () => {
    const c = (key: string, type: 'fold' | 'call' | 'raise', ev: number): EvCandidate =>
      ({ key, action: type === 'raise' ? { type, to: 500 } : { type }, ev }) as EvCandidate;
    // Pot 100: Close within 3 chips (either way), Clear when the recommendation leads by > 10.
    const alts = [c('fold', 'fold', 0), c('raise:500', 'raise', 11)];
    expect(hintConfidence(10, alts, 100)).toBe('close');
    expect(closeAlternative(alts, 10, 100)?.key).toBe('raise:500');
    expect(hintConfidence(14.5, alts, 100)).toBe('normal');
    expect(closeAlternative(alts, 14.5, 100)).toBeNull();
    expect(hintConfidence(22, alts, 100)).toBe('clear');
    // The model rates the alternative far higher: never "clear", never "also fine".
    expect(hintConfidence(-5, alts, 100)).toBe('normal');
    expect(closeAlternative(alts, -5, 100)).toBeNull();
    expect(hintConfidence(4, [], 100)).toBe('clear');
  });

  it('a deep all-in is never the close alternative unless the coach`s own size goes all-in', () => {
    // 100 bb deep, unopened and facing an open: the raise alternative is the §8.3 size.
    for (const obs of [
      sixMax(3, 'As Ah'),
      sixMax(0, 'Ks Td', [fold(3), fold(4), fold(5)]),
      sixMax(0, '6c 6d', [fold(3), fold(4), raise(5, 250)]),
      sixMax(2, 'Ac Kd', [raise(3, 250), fold(4), fold(5), fold(0), call(1)]),
    ]) {
      const d = deliberate(obs, COACH, coachSeed(obs));
      const alts = sensibleAlternatives(obs, d.f, null, d.decision.action, {
        ev: () => 0,
        candidates: () => [],
      });
      for (const a of alts) expect(kindOf(obs.legal, a.action)).not.toBe('allin');
      if (d.decision.alt !== null) expect(kindOf(obs.legal, d.decision.alt)).not.toBe('allin');
    }
  });
});

describe('the bots (§9.4)', () => {
  const tag: BrainProfile = profileFor('tag', 'medium');

  it('a decision is a pure function of the observation and the seed (C3)', () => {
    const obs = sixMax(0, 'Ks Td', [fold(3), fold(4), fold(5)]);
    for (let i = 0; i < 20; i++) {
      const d = decide(obs, tag, seed(i));
      expect(decide(structuredClone(obs), tag, seed(i))).toEqual(d);
      expect(isLegalAction(obs.legal, d.action)).toBe(true);
    }
  });

  it('mixes: another seed can pick another action; Decision.eRandom is eRange (no HUD)', () => {
    const obs = sixMax(0, 'Ks Td', [fold(3), fold(4), fold(5)]);
    const easy = profileFor('station', 'easy');
    const kinds = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const d = decide(obs, easy, seed(i));
      kinds.add(d.kind);
      expect(d.eRandom).toBe(d.eRange);
    }
    expect(kinds.size).toBeGreaterThan(1);
  });

  it('perceives E′ = clamp(eRange + σ·z, 0, 1): the postflop bucket follows it', () => {
    const obs = headsUp('Ah Qd', 'Qc 7s 2h', [raise(0, 300), call(1), bet(1, 300)]);
    const f = features(obs, tag, seed(0));
    const up = perceive(f, tag, { ...DRAWS, z: 3 });
    expect(up.noise).toBeCloseTo(0.21, 12);
    expect(up.E).toBeCloseTo(Math.min(1, f.eRange + 0.21), 12);
    expect(up.f.eRange).toBe(up.E);
    expect(perceive(f, COACH, { ...DRAWS, z: 3 })).toEqual({ E: f.eRange, f, noise: 0 });
  });

  it('limps an open raise with probability 1 − pfrRatio (never the coach, never a shove)', () => {
    const obs = sixMax(3, 'As Ah');
    const f = features(obs, tag, seed(0));
    const seen = perceive(f, tag, DRAWS);
    const open = ruleAction(obs, f, seen, tag, seed(0), { ...DRAWS, limp: 1 - tag.pfrRatio });
    expect(open.kind).toBe('raise');
    const limp = ruleAction(obs, f, seen, tag, seed(0), {
      ...DRAWS,
      limp: 1 - tag.pfrRatio - 1e-9,
    });
    expect(limp.action).toEqual({ type: 'call' });
    expect(ruleAction(obs, f, seen, COACH, seed(0), { ...DRAWS, limp: 0 }).kind).toBe('raise');
    // 10 bb on the button: the push/fold shove is never limped.
    const short = observeSpot(
      playSpot({
        stacks: new Array<number>(6).fill(10 * BB),
        button: 0,
        holes: { 0: 'Ac 5d' },
        inputs: [fold(3), fold(4), fold(5)],
      }),
      0,
    );
    const fs = features(short, tag, seed(0));
    const shove = ruleAction(short, fs, perceive(fs, tag, DRAWS), tag, seed(0), {
      ...DRAWS,
      limp: 0,
    });
    expect(shove.kind).toBe('allin');
  });

  it("candidates: fold, check or call, the level's sizes, the §8.3 raise before the flop, and A*", () => {
    const obs = headsUp('Ah Qd', 'Qc 7s 2h', [raise(0, 300), call(1), check(1)]);
    const keysFor = (p: BrainProfile): string[] => {
      const f = features(obs, p, seed(0));
      const seen = perceive(f, p, DRAWS);
      const rule = ruleAction(obs, f, seen, p, seed(0), DRAWS);
      return botCandidates(obs, f, seen.f, p, rule).map((c) => c.key);
    };
    // Pot 600: 'half' bets 300; 'two' bets 300 and 600 (A* is one of them).
    expect(keysFor(profileFor('tag', 'easy'))).toEqual(['check', 'bet:300']);
    expect(keysFor(profileFor('tag', 'medium'))).toEqual(['check', 'bet:300', 'bet:600']);
    // Before the flop: the open of the spot (2.5 bb).
    const pre = sixMax(3, '7c 2d');
    const f = features(pre, tag, seed(0));
    const seen = perceive(f, tag, DRAWS);
    const rule = ruleAction(pre, f, seen, tag, seed(0), DRAWS);
    expect(botCandidates(pre, f, seen.f, tag, rule).map((c) => c.key)).toEqual([
      'fold',
      'call',
      'raise:250',
    ]);
  });

  it('scores: EV/pot + T × (aggression + A* bonus); a bluff adds 2.5 T to bets, a slow-play to the check', () => {
    // Air in position, checked to: the rule bets (a continuation bet) or checks.
    const air = headsUp('5h 4c', 'Kc 9s 2d', [raise(0, 300), call(1), check(1)]);
    const maniac = profileFor('maniac', 'medium');
    const plain = deliberate(air, maniac, seed(0));
    expect(plain.seen.f.bucket).toBe('air');
    const bot = plain.bot as NonNullable<typeof plain.bot>;
    const ruleKey = candidateKey(air.legal, plain.rule.action);
    bot.candidates.forEach((c, i) => {
      let bias = 0;
      if (c.action.type === 'bet' || c.action.type === 'raise') bias += maniac.aggressionBias;
      if (c.key === ruleKey) bias += MIX_RULE_BONUS;
      const bluff = mixDraws(seed(0)).bluff < maniac.bluffFreq && c.action.type === 'bet';
      if (bluff) bias += MIX_BLUFF_BONUS;
      expect(bot.scores[i]).toBeCloseTo(c.ev / air.pot + maniac.temperature * bias, 12);
    });
    // A Monster on a Dry board: a slow-playing station gets +2.5 T on the check.
    const set = headsUp('7s 7d', 'Kc 7h 2d', [raise(0, 300), call(1), check(1)]);
    const station = profileFor('station', 'easy');
    for (let i = 0; i < 40; i++) {
      const d = deliberate(set, station, seed(i));
      if (d.seen.f.bucket !== 'monster') continue;
      const b = d.bot as NonNullable<typeof d.bot>;
      const checkAt = b.candidates.findIndex((c) => c.key === 'check');
      const checkKey = candidateKey(set.legal, d.rule.action) === 'check' ? MIX_RULE_BONUS : 0;
      const slow = mixDraws(seed(i)).slowplay < station.slowplayFreq ? MIX_SLOWPLAY_BONUS : 0;
      const ev = (b.candidates[checkAt] as EvCandidate).ev / set.pot;
      expect(b.scores[checkAt]).toBeCloseTo(ev + station.temperature * (checkKey + slow), 12);
    }
  });

  it('before the flop A* scores the larger rule bonus, and a call T × 3 × (stickiness − 1)', () => {
    // A station facing an open from the cutoff: fold, call, the 3-bet, A* among them.
    const obs = sixMax(4, 'Kd 9s', [raise(3, 250)]);
    const station = profileFor('station', 'medium');
    const d = deliberate(obs, station, seed(2));
    const b = d.bot as NonNullable<typeof d.bot>;
    const ruleKey = candidateKey(obs.legal, d.rule.action);
    b.candidates.forEach((c, i) => {
      let bias = 0;
      if (c.action.type === 'raise') bias += station.aggressionBias;
      if (c.action.type === 'call') bias += MIX_CALL_STICKINESS * (station.stickiness - 1);
      if (c.key === ruleKey) bias += MIX_RULE_BONUS_PREFLOP;
      expect(b.scores[i]).toBeCloseTo(c.ev / obs.pot + station.temperature * bias, 12);
    });
    expect(MIX_RULE_BONUS_PREFLOP).toBeGreaterThan(MIX_RULE_BONUS);
  });

  it('limp mode limps an open raise the mix picked too (§9.4 step 2), never facing a raise', () => {
    // A Maniac first in on the button with a hand it opens: in limp mode no pick is a raise.
    const obs = sixMax(0, 'Kd 9s', [fold(3), fold(4), fold(5)]);
    const maniac = profileFor('maniac', 'medium');
    let limped = 0;
    let raised = 0;
    for (let i = 0; i < 300; i++) {
      const d = deliberate(obs, maniac, seed(i));
      const b = d.bot as NonNullable<typeof d.bot>;
      const limpMode = mixDraws(seed(i)).limp < 1 - maniac.pfrRatio;
      const kind = b.pick.action.type;
      if (limpMode) {
        expect(kind === 'raise' || kind === 'bet').toBe(false);
        if (kind === 'call') limped++;
      } else if (kind === 'raise') {
        raised++;
      }
    }
    expect(limped).toBeGreaterThan(0);
    expect(raised).toBeGreaterThan(0);
    // Facing an open there is no limp mode: a 3-bet stays a 3-bet.
    const facing = sixMax(0, 'Ad Ac', [raise(3, 250), fold(4), fold(5)]);
    const kinds = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const b = deliberate(facing, maniac, seed(i)).bot as NonNullable<
        ReturnType<typeof deliberate>['bot']
      >;
      kinds.add(b.pick.action.type);
    }
    expect(kinds.has('raise')).toBe(true);
  });

  it('defends against a bet: no fold when 1 − handPct ≤ MDF × defenseFactor (§9.4 step 4)', () => {
    // Top pair facing a half-pot bet: handPct is high, MDF 2/3: fold is out of the candidates.
    const obs = headsUp('Ah Qd', 'Qc 7s 2h', [raise(0, 300), call(1), bet(1, 300)]);
    for (const p of [profileFor('rock', 'easy'), profileFor('rock', 'medium')]) {
      const d = deliberate(obs, p, seed(1));
      expect(d.bot?.defended).toBe(true);
      expect(d.bot?.candidates.some((c) => c.key === 'fold')).toBe(false);
    }
    // Five-high on the river facing a pot bet: it may fold.
    const air = headsUp(
      '5h 4h',
      'As Kd 9c 2s Jd',
      [
        raise(0, 300),
        call(1),
        check(1),
        bet(0, 200),
        call(1),
        check(1),
        bet(0, 500),
        call(1),
        check(1),
        bet(0, 2000),
      ],
      1,
    );
    expect(deliberate(air, profileFor('rock', 'medium'), seed(1)).bot?.defended).toBe(false);
  });

  it('the guardrails override the pick (§9.4 step 6): aces never fold to an all-in', () => {
    const obs = sixMax(2, 'Ah Ad', [raise(3, 100 * BB), fold(4), fold(5), fold(0), fold(1)]);
    // A near-uniform softmax picks anything; the guardrails still make it a call.
    const wild: BrainProfile = { ...profileFor('maniac', 'easy'), temperature: 1000 };
    let fired = 0;
    for (let i = 0; i < 100; i++) {
      const d = deliberate(obs, wild, seed(i));
      expect(d.decision.action).toEqual({ type: 'call' });
      if (d.fired.length > 0) fired++;
    }
    expect(fired).toBeGreaterThan(0);
  });

  it('every level and personality decides legally in every spot', () => {
    const spots = [
      sixMax(3, 'As Ah'),
      sixMax(3, '7c 2d'),
      sixMax(0, '6c 6d', [fold(3), fold(4), raise(5, 250)]),
      headsUp('Ah Qd', 'Qc 7s 2h', [raise(0, 300), call(1), bet(1, 300)]),
      headsUp('5h 4c', 'Kc 9s 2d', [raise(0, 300), call(1), check(1)]),
    ];
    for (const obs of spots) {
      for (const id of PERSONALITY_IDS as readonly PersonalityId[]) {
        for (const level of ['easy', 'medium'] as BotLevel[]) {
          const d = decide(obs, profileFor(id, level), seed(7));
          expect(isLegalAction(obs.legal, d.action)).toBe(true);
          expect(d.kind).toBe(kindOf(obs.legal, d.action));
        }
      }
    }
  });
});
