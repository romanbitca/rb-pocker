/**
 * The coach-advice audit of 6 Nov 2026 (964 decisions; branch `fix/coach-words-and-draws`): the
 * maths were sound, but the words and the hand classes taught wrong poker. Each spot here is one
 * of the audit's, rebuilt through the real engine (the classic spots by name, the generated ones
 * by id with their stacks, actions and seat labels), and each test failed before the fix:
 *
 * - #4 fake draws on paired boards (§6.3 weak outs, open question Q; §8.2 `drawOuts`);
 * - #8 draws described as made hands (§8.2 `drawOnly`);
 * - #9 one draw name on all outs (F.1 SEMI_BLUFF `.groups`, RULE_2_4 `{outs}`);
 * - #6 FOLD_VS_RAISE's "wins only about X%" with X at or above the price (F.1 `.realise`, `.range`);
 * - #7 a limp's price in the numbers line of an unraised pot (F.1 numbers line, `shown.price`);
 * - #10 river words about free cards and draws (F.1 `.river` variants).
 */
import { describe, expect, it } from 'vitest';
import { findOuts } from '../../src/analysis/handinfo.ts';
import { coachHint } from '../../src/brain/decide.ts';
import { explainInput, type Explanation } from '../../src/brain/explain.ts';
import { coachSeed, features } from '../../src/brain/features.ts';
import { COACH } from '../../src/brain/profiles.ts';
import type { Decision } from '../../src/brain/types.ts';
import type { EngineInput, Observation, PersonalityId } from '../../src/engine/types.ts';
import { hintText, lineText } from '../../src/i18n/coach.ts';
import { checkHint } from '../../scripts/copy-rules.ts';
import { bet, call, check, fold, raise } from '../engine/play.ts';
import { observeSpot, playSpot } from './fixtures.ts';

const st = (n: number, bbs = 100): number[] => new Array<number>(n).fill(bbs * 100);
const folds = (...seats: number[]): EngineInput[] => seats.map(fold);

interface AuditSpot {
  stacks: number[];
  button: number;
  hero: number;
  holes: Record<number, string>;
  board?: string;
  inputs: EngineInput[];
  /** The generated spots' visible labels (§9.3) and levels: they shape the ranges (§8.6). */
  labels?: (PersonalityId | null)[];
  levels?: ('easy' | 'medium' | 'hard')[];
}

interface Hinted {
  obs: Observation;
  decision: Decision;
  e: Explanation;
  text: string;
  reasons: string;
  problems: string[];
}

/** The coach's hint of a spot, its words, and the copy rules' verdict on them (§8.10). */
function hinted(spot: AuditSpot): Hinted {
  const h = playSpot({
    stacks: spot.stacks,
    button: spot.button,
    holes: spot.holes,
    board: spot.board ?? '',
    inputs: spot.inputs,
  });
  const obs = observeSpot(h, spot.hero, {
    ...(spot.labels === undefined ? {} : { labels: spot.labels }),
    ...(spot.levels === undefined ? {} : { levels: spot.levels }),
  });
  expect(obs.legal.seat).toBe(spot.hero);
  const { decision, explanation: e } = coachHint(obs, null);
  const f = features(obs, COACH, coachSeed(obs), decision.eRandom);
  return {
    obs,
    decision,
    e,
    text: hintText(e).join('\n'),
    reasons: e.reasons.map((l) => lineText(l)).join(' '),
    problems: checkHint(e, explainInput(obs, f, decision)),
  };
}

const featuresOf = (x: Hinted) => features(x.obs, COACH, coachSeed(x.obs), x.decision.eRandom);

// ── The spots (classic spots: the audit's `classic.ts`; generated ones: their ids) ─────────────

/** F13: heads-up, the big blind 3-bet, the button called and is checked to with 9♣8♦. */
const F13: AuditSpot = {
  stacks: st(2),
  button: 0,
  hero: 0,
  holes: { 0: '9c 8d', 1: '2c 2h' },
  board: 'Kh Ks 3c',
  inputs: [raise(0, 300), raise(1, 900), call(0), check(1)],
};
/** F22: the same 9♣8♦ in the big blind facing a continuation bet. */
const F22: AuditSpot = {
  stacks: st(2),
  button: 0,
  hero: 1,
  holes: { 1: '9c 8d', 0: '2c 2h' },
  board: 'Kh Ks 3c',
  inputs: [raise(0, 300), call(1), check(1), bet(0, 200)],
};
/** F24: the button raised preflop, holds K♥Q♥ (a flush draw), checked to on the turn. */
const F24: AuditSpot = {
  stacks: st(2),
  button: 0,
  hero: 0,
  holes: { 0: 'Kh Qh', 1: '2c 2d' },
  board: '9h 5h 2s 3c',
  inputs: [raise(0, 300), call(1), check(1), check(0), check(1)],
};
/** F16: the river nut straight, checked to. */
const F16: AuditSpot = {
  stacks: st(2),
  button: 0,
  hero: 0,
  holes: { 0: 'Th 9h', 1: 'Ac Kc' },
  board: 'Kd Qc Jh 4s 2d',
  inputs: [raise(0, 300), call(1), check(1), check(0), check(1), check(0), check(1)],
};
/** g1-t12-h1-d1: a limped heads-up pot, A♠T♠ on 2♣9♠4♠ (the nut flush draw), checked to. */
const NUT_FLUSH_DRAW: AuditSpot = {
  stacks: [15100, 24600],
  button: 0,
  hero: 0,
  holes: { 0: 'As Ts' },
  board: '2c 9s 4s',
  inputs: [call(0), check(1), check(1)],
  labels: [null, 'tag'],
  levels: ['medium', 'medium'],
};
/** g1-t58-h0-d1: four-handed, the small blind completes and is checked to with K♥Q♥. */
const GUTSHOT_OOP: AuditSpot = {
  stacks: [2000, 1900, 900, 800],
  button: 3,
  hero: 0,
  holes: { 0: 'Kh Qh' },
  board: '9h Jd 2s',
  inputs: [fold(2), fold(3), call(0), check(1)],
  levels: ['hard', 'hard', 'hard', 'hard'],
};
/** g1-t20-h1-d3: K♠J♦ on 6♦9♦6♣10♦, a flush draw and a gutshot on a paired board. */
const PAIRED_FLUSH_DRAW: AuditSpot = {
  stacks: [5800, 4800],
  button: 0,
  hero: 0,
  holes: { 0: 'Ks Jd' },
  board: '6d 9d 6c Td',
  inputs: [raise(0, 250), raise(1, 1000), call(0), check(1), bet(0, 1000), call(1), check(1)],
  labels: [null, 'station'],
  levels: ['easy', 'easy'],
};
/** g1-t13-h1-d1: 6♥8♦ on 3♣5♦2♦ (a gutshot and two overcards) facing a half-pot bet. */
const GUTSHOT_CALL: AuditSpot = {
  stacks: [4900, 4400],
  button: 0,
  hero: 0,
  holes: { 0: '6h 8d' },
  board: '3c 5d 2d',
  inputs: [raise(0, 250), call(1), bet(1, 250)],
  labels: [null, 'tag'],
  levels: ['medium', 'medium'],
};
/** g2-t44-h1-d4: a river raise with the straight on a wet board. */
const RIVER_RAISE: AuditSpot = {
  stacks: [5700, 3100],
  button: 1,
  hero: 0,
  holes: { 0: '6d 7c' },
  board: 'Ts 8s 5d 4d Jc',
  inputs: [call(1), check(0), check(0), check(1), check(0), check(1), check(0), bet(1, 200)],
  labels: [null, 'tag'],
  levels: ['medium', 'medium'],
};

// ── #4 Fake draws on paired boards ─────────────────────────────────────────────────────────────

describe('#4: on a paired board, outs that only use the board pair make no draw', () => {
  it('F13: 9♣8♦ on K♥K♠3♣ has 8 weak outs and no draw; it checks, never "Draw: 8 outs"', () => {
    const x = hinted(F13);
    const f = featuresOf(x);
    expect(findOuts(x.obs.hole, x.obs.board).map((o) => o.weak)).toEqual(
      new Array<boolean>(8).fill(true),
    );
    expect(f.outs).toBe(8);
    expect(f.drawOuts).toBe(0);
    expect(f.bucket).toBe('air');
    expect(x.decision.action).toEqual({ type: 'check' });
    expect(x.decision.trace.map((r) => r.code)).not.toContain('SEMI_BLUFF');
    expect(x.text).not.toMatch(/outs/);
    expect(x.problems).toEqual([]);
  }, 20_000);

  it('F22: the same hand facing a continuation bet is no draw either', () => {
    const x = hinted(F22);
    expect(featuresOf(x).bucket).toBe('air');
    expect(x.decision.action).toEqual({ type: 'fold' });
    expect(x.problems).toEqual([]);
  }, 20_000);

  it('a real draw on a paired board still counts (12 draw outs of 19)', () => {
    const f = featuresOf(hinted(PAIRED_FLUSH_DRAW));
    expect(f.outs).toBe(19);
    expect(f.drawOuts).toBe(12);
    expect(f.bucket).toBe('draw');
  }, 20_000);
});

// ── #8 Draws described as made hands ───────────────────────────────────────────────────────────

describe('#8: a draw with no made hand of its own is a Draw, and its words name the draw', () => {
  it('F24: K♥Q♥ on the turn, in position as the raiser, semi-bluffs its flush draw (§8.5)', () => {
    const x = hinted(F24);
    expect(featuresOf(x)).toMatchObject({ bucket: 'draw', drawOnly: true });
    expect(x.decision.action.type).toBe('bet');
    expect(x.decision.trace[0]?.code).toBe('SEMI_BLUFF');
    expect(x.reasons).toContain(
      'Flush draw. Your outs: 9 for a flush · 6 for a pair (weak). You hit about 33% on the river.',
    );
    expect(x.text).not.toMatch(/Medium hand|King-high/);
    expect(x.problems).toEqual([]);
  }, 20_000);

  it('g1-t12-h1-d1: A♠T♠, the nut flush draw, is never "Your Ace-high is probably best"', () => {
    const x = hinted(NUT_FLUSH_DRAW);
    expect(featuresOf(x).bucket).toBe('draw');
    expect(x.decision.trace[0]?.code).toBe('SEMI_BLUFF');
    expect(x.reasons).toContain(
      'Nut flush draw. Your outs: 9 for a flush · 6 for a pair (weak). You hit about 32% next card and 54% by the river.',
    );
    expect(x.text).not.toMatch(/Ace-high/);
    expect(x.problems).toEqual([]);
  }, 20_000);

  it('g1-t58-h0-d1: out of position and not the raiser, §8.5 checks the draw, named', () => {
    const x = hinted(GUTSHOT_OOP);
    expect(featuresOf(x).bucket).toBe('draw');
    expect(x.decision.action).toEqual({ type: 'check' });
    expect(x.reasons).toContain(
      'Your gutshot straight draw has not hit yet. Check and see the next card for free.',
    );
    expect(x.text).not.toMatch(/Medium hand|King-high/);
    expect(x.problems).toEqual([]);
  }, 20_000);
});

// ── #9 One draw name on all outs ───────────────────────────────────────────────────────────────

describe('#9: each group of outs says what it makes; the main draw is the strongest real one', () => {
  it('g1-t20-h1-d3: never "Flush draw: 19 outs"', () => {
    const x = hinted(PAIRED_FLUSH_DRAW);
    expect(x.decision.trace[0]?.code).toBe('SEMI_BLUFF');
    expect(x.reasons).toContain(
      'Flush draw. Your outs: 9 for a flush · 3 for a straight · 2 for three of a kind (weak) · 5 for two pair (weak). You hit about 41% on the river.',
    );
    expect(x.text).not.toMatch(/draw: \d+ outs/);
    expect(x.problems).toEqual([]);
  }, 20_000);

  it('g1-t13-h1-d1: the trick says how many outs its exact chance counts (4 + 6, not 4)', () => {
    const x = hinted(GUTSHOT_CALL);
    expect(x.e.trick.map((l) => lineText(l))[0]).toBe(
      'Quick trick: outs × 2 ≈ % for the next card. Outs × 4 ≈ % by the river. With your 10 outs, exact: 38%.',
    );
    expect(x.problems).toEqual([]);
  }, 20_000);
});

// ── #6 FOLD_VS_RAISE contradicts the price ─────────────────────────────────────────────────────

describe('#6: a fold facing a raise says "wins only about X%" only below the price', () => {
  const winsOnly = (x: Hinted): number | null => {
    const m = /wins only about (\d+)% against it/.exec(x.reasons);
    return m === null ? null : Number(m[1]);
  };

  it('pairs.ts: 22 on the button facing the cutoff’s open, 100 bb: a set-mining call since 1.3.85', () => {
    const x = hinted({
      stacks: st(6),
      button: 0,
      hero: 0,
      holes: { 0: '2h 2d' },
      inputs: [...folds(3, 4), raise(5, 250)],
    });
    expect(x.decision.action).toEqual({ type: 'call' });
    expect(x.decision.trace[0]?.code).toBe('SET_MINING');
    expect(winsOnly(x)).toBeNull();
    expect(x.problems).toEqual([]);
  }, 20_000);

  it('J3s in the small blind facing the button’s open: the call cap folds it (the audit’s 22 before 1.3.85)', () => {
    const x = hinted({
      stacks: st(6),
      button: 0,
      hero: 1,
      holes: { 1: 'Jh 3h' },
      inputs: [...folds(3, 4, 5), raise(0, 250)],
    });
    expect(x.decision.action).toEqual({ type: 'fold' });
    expect(x.decision.trace[0]?.code).toBe('FOLD_VS_RAISE');
    expect(winsOnly(x)).toBeNull();
    // EV(call) > 0 by the price (about 42% against the raiser, need 33%): the fold is §8.3's
    // call range, and the words say so.
    expect(x.reasons).toContain(
      'Jack-Three suited is in the top 51% of starting hands. Against this raise, that is too weak to call.',
    );
    expect(x.problems).toEqual([]);
  }, 20_000);

  it('P15: 72o in the big blind against the button: 31% beats 27%, later bets decide', () => {
    const x = hinted({
      stacks: st(6),
      button: 0,
      hero: 2,
      holes: { 2: '7h 2d' },
      inputs: [...folds(3, 4, 5), raise(0, 250), fold(1)],
    });
    expect(x.decision.action).toEqual({ type: 'fold' });
    expect(winsOnly(x)).toBeNull();
    expect(x.reasons).toMatch(
      /You need 27% to call\. Seven-Two offsuit wins about 3\d% against their likely hands if you see every card\. Later bets can make you fold before that\./,
    );
    expect(x.problems).toEqual([]);
  }, 20_000);
});

// ── #7 The numbers line in unraised pots ───────────────────────────────────────────────────────

describe('#7: before the flop with nobody raised, the numbers show no price', () => {
  it('P29: the small blind behind 3 limpers: no "Need 10%", for K3o’s fold or A4o’s raise', () => {
    // The audit's A4o folded; since 1.3.85 (the measured folds) it raises to isolate the limpers.
    for (const [hole, action] of [
      ['Kh 3d', { type: 'fold' }],
      ['Ah 4d', { type: 'raise', to: 600 }],
    ] as const) {
      const x = hinted({
        stacks: st(6),
        button: 0,
        hero: 1,
        holes: { 1: hole },
        inputs: [call(3), call(4), call(5), fold(0)],
      });
      expect(x.decision.action, hole).toEqual(action);
      expect(lineText(x.e.numbers)).toMatch(/^Win \d+% · Pot 450$/);
      expect(x.e.shown).toMatchObject({ price: false, bar: null });
      expect(x.text).not.toMatch(/Need|Why not fold/);
      expect(x.problems).toEqual([]);
    }
  }, 20_000);

  it('P7: K9o on the button, folded to, opens: no limp price next to the raise', () => {
    const x = hinted({
      stacks: st(9),
      button: 0,
      hero: 0,
      holes: { 0: 'Kh 9d' },
      inputs: folds(3, 4, 5, 6, 7, 8),
    });
    expect(x.decision.action.type).toBe('raise');
    expect(lineText(x.e.numbers)).toMatch(/^Win \d+% · Pot 150$/);
    expect(x.e.shown.price).toBe(false);
    expect(x.problems).toEqual([]);
  }, 20_000);
});

// ── #10 River words ────────────────────────────────────────────────────────────────────────────

describe('#10: on the river the words never speak of free cards or draws', () => {
  it('F16: a river value bet: "Why not check?" says worse hands would call', () => {
    const x = hinted(F16);
    expect(x.decision.action.type).toBe('bet');
    expect(x.e.whyNot.map((l) => lineText(l))).toContain(
      'Why not check? Worse hands would call a bet.',
    );
    expect(x.text).not.toMatch(/free card/);
    expect(x.problems).toEqual([]);
  }, 20_000);

  it('g2-t44-h1-d4: a river raise with a strong hand is for value, not "so draws pay"', () => {
    const x = hinted(RIVER_RAISE);
    expect(x.decision.action.type).toBe('raise');
    expect(x.reasons).toContain('Your hand is strong. Raise now: worse hands can still call.');
    expect(x.text).not.toMatch(/draws/);
    expect(x.problems).toEqual([]);
  }, 20_000);
});
