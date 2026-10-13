/**
 * The pure parts of Undo and the mistake feedback (`app/undo.ts`, PLAN §11, §10.2, A.7; chunk 6.2):
 * decision points, the level rules, `undoBlock` (§11.3 r2), `restoreForUndo` (r3), the records,
 * the price, the HUD number for a grade, the card's naming of moves. And the §11.5 statistical
 * test: over 10,000 seeded undos after the turn was shown, the new turn card is uniform over the
 * stub. The controller half is `controller.undo.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { EngineError } from '../../src/core/assert.ts';
import { deriveSeed } from '../../src/core/rng.ts';
import { initialEquity, type EquitySlice } from '../../src/app/store.ts';
import {
  decisionRecord,
  feedbackView,
  heroDecisionsTaken,
  hudEquityAt,
  isAssisted,
  isHeroTurn,
  moveView,
  pausesAt,
  priceNeed,
  restoreForUndo,
  snapshotAt,
  standingRecord,
  undoBlock,
  UNDO_POLICY,
  withRecord,
  type DecisionFacts,
  type UndoContext,
} from '../../src/app/undo.ts';
import { feedbackLine } from '../../src/brain/explain.ts';
import type { Grade } from '../../src/brain/types.ts';
import { lineText } from '../../src/i18n/coach.ts';
import { step } from '../../src/engine/step.ts';
import type {
  CoachLevel,
  EngineInput,
  HandState,
  LegalActions,
  PlayerAction,
} from '../../src/engine/types.ts';
import { emptyHandMeta, type HandMeta, type UndoSnapshot } from '../../src/persist/schema.ts';
import { deal, tableWith } from '../engine/helpers.ts';
import { ADVANCE, legalOf } from '../engine/play.ts';
import { chiSquarePValue, chiSquareStat, P_MIN } from '../helpers/stats.ts';

const HERO = 0;

const passive = (legal: LegalActions): PlayerAction =>
  legal.canCheck ? { type: 'check' } : { type: 'call' };

/** A hand being played, with its inputs (the controller's replay log). */
interface Played {
  state: HandState;
  inputs: EngineInput[];
}

function apply(p: Played, input: EngineInput): Played {
  return { state: step(p.state, input), inputs: [...p.inputs, input] };
}

/** Everyone checks or calls (the hero too) until `until` holds or the betting round ends. */
function passiveUntil(p: Played, until: (h: HandState) => boolean): Played {
  let q = p;
  while (q.state.phase === 'betting' && !until(q.state)) {
    const legal = legalOf(q.state);
    q = apply(q, { kind: 'act', seat: legal.seat, action: passive(legal) });
  }
  return q;
}

/** Heads-up, the hero on the button: on the flop the bot acts first, then the hero. */
function headsUp(handSeed?: string): Played {
  const table = tableWith([10000, 10000], { button: 0 });
  return { state: handSeed === undefined ? deal(table) : deal(table, handSeed), inputs: [] };
}

/** The hero's flop decision point: preflop checked through, the flop dealt, the bot checked. */
function flopDecision(handSeed?: string): Played {
  let p = passiveUntil(headsUp(handSeed), () => false); // preflop
  p = apply(p, ADVANCE); // the flop
  p = passiveUntil(p, isHeroTurn);
  expect(isHeroTurn(p.state)).toBe(true);
  return p;
}

const record = (
  decisionId: number,
  grade: Grade | null = 'best',
): DecisionFacts & { grade: Grade | null } => ({
  decisionId,
  street: 'flop',
  taken: { type: 'check' },
  eRandom: 0.5,
  need: null,
  hintSeen: true,
  grade,
});

function metaWith(...decisions: { decisionId: number; grade: Grade | null }[]): HandMeta {
  let meta = emptyHandMeta();
  for (const d of decisions) {
    meta = withRecord(
      meta,
      decisionRecord(
        record(d.decisionId),
        d.grade === null
          ? null
          : {
              decisionId: d.decisionId,
              grade: d.grade,
              rec: { type: 'check' },
              taken: { type: 'check' },
              lossChips: 0,
              lossPot: 0,
              lossMilliBB: 0,
              leak: null,
              trace: [],
              feedback: null,
            },
      ),
    );
  }
  return meta;
}

describe('decision points (§11.3 r1)', () => {
  it('decisionId counts the hero act events already in the log', () => {
    let p = headsUp();
    expect(isHeroTurn(p.state)).toBe(true); // heads-up: the button (the hero) acts first preflop
    expect(heroDecisionsTaken(p.state)).toBe(0);
    p = apply(p, { kind: 'act', seat: HERO, action: { type: 'call' } });
    expect(heroDecisionsTaken(p.state)).toBe(1);
    expect(isHeroTurn(p.state)).toBe(false);
    p = passiveUntil(p, () => false);
    p = apply(p, ADVANCE);
    p = passiveUntil(p, isHeroTurn);
    expect(heroDecisionsTaken(p.state)).toBe(1); // the bot's check does not count
    const snap = snapshotAt(p.state, emptyHandMeta(), p.inputs.length);
    expect(snap).toMatchObject({ decisionId: 1, inputCount: p.inputs.length });
    expect(snap.state).toBe(p.state);
  });
});

describe('coach levels (§10.2 "Pause + Undo offer", "Toolbar Undo")', () => {
  it('the pause thresholds and where Undo is offered', () => {
    const table: Record<CoachLevel, Grade[]> = {
      beginner: ['inaccuracy', 'mistake', 'blunder'],
      intermediate: ['mistake', 'blunder'],
      advanced: ['mistake', 'blunder'],
      exam: [],
    };
    const all: Grade[] = ['best', 'good', 'inaccuracy', 'mistake', 'blunder'];
    for (const [level, pausing] of Object.entries(table) as [CoachLevel, Grade[]][]) {
      expect(all.filter((g) => pausesAt(level, g))).toEqual(pausing);
      expect(pausesAt(level, null)).toBe(false); // a failed grade never pauses
    }
    expect(UNDO_POLICY.beginner.undo).toBe('toolbar');
    expect(UNDO_POLICY.intermediate.undo).toBe('toolbar');
    expect(UNDO_POLICY.advanced.undo).toBe('feedback');
    expect(UNDO_POLICY.exam.undo).toBe('none');
  });
});

describe('undoBlock (§11.3 r2, r5, r8)', () => {
  /** The hero checked on the flop and the bot is to act on the turn (the turn was shown). */
  function afterTurnShown(): { ctx: UndoContext; snap: UndoSnapshot; p: Played } {
    const at = flopDecision();
    const snap = snapshotAt(at.state, emptyHandMeta(), at.inputs.length);
    let p = apply(at, { kind: 'act', seat: HERO, action: { type: 'check' } });
    p = apply(p, ADVANCE); // the turn
    expect(p.state.toAct).not.toBe(HERO);
    return {
      ctx: {
        hand: p.state,
        snapshot: snap,
        meta: metaWith({ decisionId: snap.decisionId, grade: 'best' }),
        level: 'beginner',
        feedbackOpen: false,
      },
      snap,
      p,
    };
  }

  it('is possible after the act, also once the turn is shown (the stub is reshuffled)', () => {
    expect(undoBlock(afterTurnShown().ctx)).toBeNull();
  });

  it('says why not: no decision, not acted, newer decision, used, grade pending, level', () => {
    const { ctx, snap, p } = afterTurnShown();
    expect(undoBlock({ ...ctx, hand: null })).toBe('noDecision');
    expect(undoBlock({ ...ctx, snapshot: null })).toBe('noDecision');
    expect(undoBlock({ ...ctx, hand: snap.state })).toBe('notActed');
    expect(undoBlock({ ...ctx, meta: emptyHandMeta() })).toBe('gradePending');
    // A failed grade (null) is a grade that arrived (r5).
    expect(
      undoBlock({ ...ctx, meta: metaWith({ decisionId: snap.decisionId, grade: null }) }),
    ).toBeNull();
    expect(undoBlock({ ...ctx, level: 'exam' })).toBe('level');
    expect(undoBlock({ ...ctx, level: 'advanced' })).toBe('level');
    expect(undoBlock({ ...ctx, level: 'advanced', feedbackOpen: true })).toBeNull();
    expect(undoBlock({ ...ctx, level: 'intermediate' })).toBeNull();
    // The bot checks: the hero is at a newer decision point.
    const newer = passiveUntil(p, isHeroTurn);
    expect(undoBlock({ ...ctx, hand: newer.state })).toBe('newerDecision');
    // Once undone, never again for this decision.
    const restored = restoreForUndo(snap, { inputs: p.inputs, meta: ctx.meta });
    const again = apply(
      { state: restored.state, inputs: restored.inputs },
      {
        kind: 'act',
        seat: HERO,
        action: { type: 'check' },
      },
    );
    const meta = withRecord(restored.meta, decisionRecord(record(snap.decisionId), null));
    expect(undoBlock({ ...ctx, hand: again.state, meta })).toBe('used');
  });

  it('is blocked once anything is revealed, and after the hand is complete', () => {
    const { ctx, p } = afterTurnShown();
    let q = passiveUntil(p, () => false); // turn checked through
    q = apply(q, ADVANCE); // the river
    expect(undoBlock({ ...ctx, hand: q.state })).toBe('newerDecision'); // the bot checks, then the hero
    q = passiveUntil(q, () => false);
    expect(q.state.phase).toBe('roundComplete');
    q = apply(q, ADVANCE); // showdown: both hands revealed
    expect(q.state.revealed.length).toBeGreaterThan(0);
    expect(undoBlock({ ...ctx, hand: q.state })).toBe('revealed');
    q = apply(q, ADVANCE);
    expect(q.state.phase).toBe('complete');
    expect(undoBlock({ ...ctx, hand: q.state })).toBe('handOver');
  });

  it('is blocked after a run-out reveal (an all-in called)', () => {
    let p = headsUp();
    const snap = snapshotAt(p.state, emptyHandMeta(), 0);
    const legal = legalOf(p.state);
    p = apply(p, { kind: 'act', seat: HERO, action: { type: 'raise', to: legal.raise?.max ?? 0 } });
    p = apply(p, { kind: 'act', seat: 1, action: { type: 'call' } });
    const ctx: UndoContext = {
      hand: p.state,
      snapshot: snap,
      meta: metaWith({ decisionId: 0, grade: 'best' }),
      level: 'beginner',
      feedbackOpen: false,
    };
    expect(p.state.phase).toBe('roundComplete');
    expect(undoBlock(ctx)).toBeNull(); // before the reveal: still possible
    p = apply(p, ADVANCE); // the run-out turns the hands face up
    expect(p.state.runout).toBe(true);
    expect(undoBlock({ ...ctx, hand: p.state })).toBe('revealed');
  });
});

describe('restoreForUndo (§11.3 r3, §11.5)', () => {
  it('the snapshot back with the stub reshuffled; inputs cut; the record kept as undone', () => {
    const at = flopDecision();
    const snap = snapshotAt(at.state, emptyHandMeta(), at.inputs.length);
    let p = apply(at, { kind: 'act', seat: HERO, action: { type: 'check' } });
    p = apply(p, ADVANCE); // the turn is shown
    const meta = metaWith({ decisionId: snap.decisionId, grade: 'mistake' });
    const r = restoreForUndo(snap, { inputs: p.inputs, meta });

    // Deep-equal to the snapshot except deck[deckPos..], the log (one reshuffle) and undoneDecisions.
    const rest = (h: HandState) => ({
      ...h,
      deck: h.deck.slice(0, h.deckPos),
      log: [],
      undoneDecisions: [],
    });
    expect(rest(r.state)).toEqual(rest(snap.state));
    const stub = (h: HandState) => h.deck.slice(h.deckPos);
    expect([...stub(r.state)].sort((a, b) => a - b)).toEqual(
      [...stub(snap.state)].sort((a, b) => a - b),
    );
    expect(stub(r.state)).not.toEqual(stub(snap.state));
    expect(r.state.log).toEqual([
      ...snap.state.log,
      { e: 'reshuffle', decisionId: snap.decisionId, undoIndex: 0 },
    ]);
    expect(r.state.undoneDecisions).toEqual([snap.decisionId]);
    // r4: the bots' hole cards and the board never change.
    expect(r.state.seats.map((s) => s.hole)).toEqual(p.state.seats.map((s) => s.hole));
    expect(r.state.board).toEqual(p.state.board.slice(0, 3));

    // The undone act and everything after it leave the replay log; the reshuffle joins it.
    expect(r.inputs).toEqual([...p.inputs.slice(0, snap.inputCount), r.reshuffle]);
    expect(r.reshuffle).toEqual({ kind: 'reshuffle', decisionId: snap.decisionId, undoIndex: 0 });

    // §11.4: the undone decision still counts; the hand is practice.
    expect(r.meta.undoCount).toBe(1);
    expect(isAssisted(r.meta)).toBe(true);
    expect(isAssisted(meta)).toBe(false);
    expect(r.meta.decisions).toEqual([{ ...meta.decisions[0], undone: true }]);
    expect(standingRecord(r.meta, snap.decisionId)).toBeNull();
  });

  it('the reshuffle is the §2.4 undo stream: deriveSeed(handSeed, "undo", decisionId, 0)', () => {
    const at = flopDecision();
    const snap = snapshotAt(at.state, emptyHandMeta(), at.inputs.length);
    const r = restoreForUndo(snap, { inputs: at.inputs, meta: emptyHandMeta() });
    expect(r.state).toEqual(step(at.state, r.reshuffle));
    // Deterministic: the same snapshot gives the same stub.
    expect(restoreForUndo(snap, { inputs: at.inputs, meta: emptyHandMeta() }).state).toEqual(
      r.state,
    );
  });

  it('a second undo of the same decision: the engine throws UNDO_USED, nothing changes', () => {
    const at = flopDecision();
    const snap = snapshotAt(at.state, emptyHandMeta(), at.inputs.length);
    const first = restoreForUndo(snap, { inputs: at.inputs, meta: emptyHandMeta() });
    const again = snapshotAt(first.state, first.meta, first.inputs.length);
    expect(again.decisionId).toBe(snap.decisionId);
    let thrown: unknown = null;
    try {
      restoreForUndo(again, { inputs: first.inputs, meta: first.meta });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(EngineError);
    expect((thrown as EngineError).code).toBe('UNDO_USED');
  });

  it(
    'over 10,000 seeded undos after the turn was shown, the new turn card is uniform over the stub (chi-square, p > 0.001)',
    { timeout: 120_000 },
    () => {
      const N = 10_000;
      let counts: number[] | null = null;
      let changed = 0;
      for (let i = 0; i < N; i++) {
        const at = flopDecision(deriveSeed('0123456789abcdef0123456789abcdef', 'chi', i));
        const snap = snapshotAt(at.state, emptyHandMeta(), at.inputs.length);
        const stub = at.state.deck.slice(at.state.deckPos);
        counts ??= new Array<number>(stub.length).fill(0);
        // The hero checks, the round ends, the turn is shown.
        let p = apply(at, { kind: 'act', seat: HERO, action: { type: 'check' } });
        p = apply(p, ADVANCE);
        const shown = p.state.board[3];
        // Undo, check again: the new turn.
        const r = restoreForUndo(snap, { inputs: p.inputs, meta: emptyHandMeta() });
        let q: Played = { state: r.state, inputs: r.inputs };
        q = apply(q, { kind: 'act', seat: HERO, action: { type: 'check' } });
        q = apply(q, ADVANCE);
        const turn = q.state.board[3] as number;
        if (turn !== shown) changed++;
        const at2 = stub.indexOf(turn);
        if (at2 < 0) throw new Error('the new turn card is not from the stub');
        counts[at2] = (counts[at2] as number) + 1;
      }
      const bins = counts as number[];
      const p = chiSquarePValue(chiSquareStat(bins, N / bins.length), bins.length - 1);
      expect(p).toBeGreaterThan(P_MIN);
      // The shown turn card comes back only as often as any other card (about 1 in 44).
      expect(changed / N).toBeGreaterThan(0.95);
    },
  );
});

describe('records, price and the HUD number (A.7, §0.3, §8.2)', () => {
  it('a record keeps the grade, or null when grading failed twice', () => {
    const facts: DecisionFacts = {
      decisionId: 2,
      street: 'turn',
      taken: { type: 'fold' },
      eRandom: null,
      need: 0.25,
      hintSeen: false,
    };
    expect(decisionRecord(facts, null)).toEqual({
      decisionId: 2,
      street: 'turn',
      taken: { type: 'fold' },
      rec: { type: 'fold' },
      grade: null,
      lossMilliBB: 0,
      eRandom: null,
      need: 0.25,
      hintSeen: false,
      undone: false,
      leak: null,
      quiz: null,
    });
    const graded = decisionRecord(facts, {
      decisionId: 2,
      grade: 'blunder',
      rec: { type: 'call' },
      taken: { type: 'fold' },
      lossChips: 400,
      lossPot: 0.8,
      lossMilliBB: 19999.6,
      leak: 'overfold',
      trace: [],
      feedback: null,
    });
    expect(graded).toMatchObject({
      grade: 'blunder',
      rec: { type: 'call' },
      lossMilliBB: 20000,
      leak: 'overfold',
    });
  });

  it('the price uses the capped pot the hero can win (§0.3); null with nothing to call', () => {
    let p = headsUp(); // the hero (button, SB) faces the big blind: 50 to call
    expect(priceNeed(p.state)).toBeCloseTo(50 / (150 + 50), 10);
    p = apply(p, { kind: 'act', seat: HERO, action: { type: 'call' } });
    p = passiveUntil(p, () => false);
    p = apply(p, ADVANCE);
    p = passiveUntil(p, isHeroTurn); // the bot checked: nothing to call
    expect(priceNeed(p.state)).toBeNull();
    // A short hero: 400 chips against a 2,000 shove. The pot it can win is capped.
    const short = deal(tableWith([400, 10000], { button: 1 })); // the hero is the big blind
    let s: Played = { state: short, inputs: [] };
    s = apply(s, { kind: 'act', seat: 1, action: { type: 'raise', to: 2000 } });
    expect(isHeroTurn(s.state)).toBe(true);
    // To call: 300 (the hero has 100 in). It can win 400 from the bot + its own 100.
    expect(priceNeed(s.state)).toBeCloseTo(300 / (100 + 400 + 300), 10);
  });

  it('the HUD number only for exactly this situation; final for the grade, else the latest', () => {
    const at = flopDecision();
    const h = at.state;
    const hero = h.seats[HERO]?.hole as [number, number];
    const base: EquitySlice = {
      ...initialEquity(),
      status: 'done',
      situation: { handSeq: h.handSeq, hero, board: h.board, nOpp: 1 },
      result: {
        n: 10000,
        win: 0.6,
        split: 0.02,
        equity: 0.61,
        exact: false,
        final: true,
        truncated: false,
      },
    };
    expect(hudEquityAt(base, h)).toEqual({ final: 0.61, latest: 0.61 });
    const progress = {
      ...base,
      result: { ...(base.result as NonNullable<EquitySlice['result']>), final: false },
    };
    expect(hudEquityAt(progress, h)).toEqual({ final: null, latest: 0.61 });
    const none = { final: null, latest: null };
    expect(hudEquityAt(initialEquity(), h)).toEqual(none);
    expect(hudEquityAt({ ...base, situation: { ...base.situation!, handSeq: 99 } }, h)).toEqual(
      none,
    );
    expect(hudEquityAt({ ...base, situation: { ...base.situation!, board: [] } }, h)).toEqual(none);
    expect(hudEquityAt({ ...base, situation: { ...base.situation!, nOpp: 2 } }, h)).toEqual(none);
    expect(hudEquityAt({ ...base, mode: 'known' }, h)).toEqual(none);
  });
});

describe('the feedback card content (§12.6, F.4, F.5)', () => {
  it('names moves as the action bar does: call, call all-in, bet, raise to, all-in', () => {
    const legal: LegalActions = {
      seat: 0,
      toCall: 40,
      callAmount: 40,
      callIsAllIn: false,
      canFold: true,
      canCheck: false,
      canCall: true,
      bet: null,
      raise: { min: 80, max: 2000 },
    };
    expect(moveView({ type: 'fold' }, legal, 20)).toEqual({ kind: 'fold', amount: null, bb: 20 });
    expect(moveView({ type: 'call' }, legal, 20)).toEqual({ kind: 'call', amount: 40, bb: 20 });
    expect(moveView({ type: 'call' }, { ...legal, callIsAllIn: true }, 20).kind).toBe('callAllIn');
    expect(moveView({ type: 'raise', to: 120 }, legal, 20)).toEqual({
      kind: 'raise',
      amount: 120,
      bb: 20,
    });
    expect(moveView({ type: 'raise', to: 2000 }, legal, 20).kind).toBe('allIn');
    const open = {
      ...legal,
      toCall: 0,
      callAmount: 0,
      canCheck: true,
      canCall: false,
      raise: null,
    };
    expect(moveView({ type: 'bet', to: 60 }, { ...open, bet: { min: 20, max: 900 } }, 20)).toEqual({
      kind: 'bet',
      amount: 60,
      bb: 20,
    });
    expect(moveView({ type: 'check' }, open, 20).kind).toBe('check');
  });

  it("the grader's F.5 row, else the fallback row from the coach's move", () => {
    const p = headsUp(); // the hero faces the big blind
    const base = {
      decisionId: 0,
      grade: 'mistake' as const,
      rec: { type: 'call' } as PlayerAction,
      taken: { type: 'fold' } as PlayerAction,
      lossChips: 50,
      lossPot: 0.3,
      lossMilliBB: 500,
      leak: null,
      trace: [],
    };
    const fallback = feedbackView({ ...base, feedback: null }, p.state, true);
    expect(fallback.coachMove).toEqual({ kind: 'call', amount: 50, bb: 100 });
    expect(fallback.reason).toBeNull(); // the card says the fallback row (ui/feedback.ts)
    expect(fallback.canUndo).toBe(true);
    const line = feedbackLine({ row: 'foldedPrice', E: 0.45, need: 0.25, rangeAdjust: false });
    const priced = feedbackView({ ...base, feedback: line }, p.state, false);
    expect(priced).toMatchObject({ grade: 'mistake', canUndo: false });
    expect(priced.reason).toBe(line);
    expect(lineText(line)).toBe('You folded with a 45% win chance. You needed only 25% to call.');
  });
});
