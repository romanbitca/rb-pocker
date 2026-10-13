/**
 * Undo and the mistake feedback, the pure parts (PLAN §11, §10.2, Appendix A.7; chunk 6.2). The
 * TableController owns the timers, the epoch and the store; everything here is a function of its
 * arguments, so the §11.5 tests can drive it directly.
 *
 * - A **decision point** is a state where the hero is to act. Its `decisionId` is the number of
 *   hero `act` events already in the hand's log (§11.3 r1). The controller keeps one snapshot, of
 *   the latest decision point (`UndoSnapshot`, A.7: the state, the meta, the input count).
 * - **Undo** (§11.3 r2) is possible while the hero has acted at that point and not yet reached a
 *   newer one, the hand is not complete, nothing is revealed (no run-out reveal, no showdown), that
 *   decision was not undone before (one undo per decision point: no re-rolling a turn card), its
 *   grade has arrived (or failed twice: `grade: null`, r5), and the coach level offers Undo there
 *   (§10.2: the toolbar at Beginner and Intermediate, only the feedback card at Advanced, never at
 *   Exam, r8). `undoBlock` says which of these fails.
 * - `restoreForUndo` is r3's steps 3–5: the snapshot's state with the undealt stub reshuffled
 *   (`deriveSeed(seed, 'undo', decisionId, 0)`, §2.4; always, not only after a reveal: §11.2), the
 *   inputs cut back to the snapshot plus that `reshuffle` input, and the undone decision's record
 *   kept with `undone: true` (§11.4: it still counts).
 */
import type { Line } from '../brain/explain.ts';
import type { Grade, GradeResult } from '../brain/types.ts';
import { legalActions } from '../engine/legal.ts';
import { step } from '../engine/step.ts';
import type {
  CoachLevel,
  EngineInput,
  HandState,
  LegalActions,
  PlayerAction,
  Street,
} from '../engine/types.ts';
import type { DecisionRecord, HandMeta, UndoSnapshot } from '../persist/schema.ts';
import type { EquitySlice } from './store.ts';

/** The hero's seat (§0.3). */
const HERO = 0;

// ---------------------------------------------------------------------------------------------
// Decision points

/** §11.3 r1: the hero's `act` events in this hand's log: the decisionId of the next decision. */
export function heroDecisionsTaken(h: HandState): number {
  let n = 0;
  for (const e of h.log) if (e.e === 'act' && e.seat === HERO) n++;
  return n;
}

/** The hero is to act: a decision point. */
export function isHeroTurn(h: HandState): boolean {
  return h.phase === 'betting' && h.toAct === HERO;
}

/** The snapshot of the decision point `h` (A.7 `UndoSnapshot`), before the hero acts. */
export function snapshotAt(h: HandState, meta: HandMeta, inputCount: number): UndoSnapshot {
  return { decisionId: heroDecisionsTaken(h), state: h, meta, inputCount };
}

// ---------------------------------------------------------------------------------------------
// Coach levels (§10.2)

/** What a coach level does after a hero decision (§10.2 "Pause + Undo offer", "Toolbar Undo"). */
export interface UndoPolicy {
  /**
   * Where Undo is offered: 'toolbar' (the toolbar Undo, and the feedback card), 'feedback' (only
   * inside the feedback card: Advanced), 'none' (Exam: no undo at all, §11.3 r8).
   */
  undo: 'toolbar' | 'feedback' | 'none';
  /** The mildest grade that pauses the game with the feedback card; null: never (Exam). */
  pauseFrom: Grade | null;
}

export const UNDO_POLICY: Readonly<Record<CoachLevel, UndoPolicy>> = {
  beginner: { undo: 'toolbar', pauseFrom: 'inaccuracy' },
  intermediate: { undo: 'toolbar', pauseFrom: 'mistake' },
  advanced: { undo: 'feedback', pauseFrom: 'mistake' },
  exam: { undo: 'none', pauseFrom: null },
};

/** The grades from best to worst (§8.9). */
export const GRADE_ORDER: readonly Grade[] = ['best', 'good', 'inaccuracy', 'mistake', 'blunder'];

/** §11.1: this grade pauses the game with the feedback card at this level. */
export function pausesAt(level: CoachLevel, grade: Grade | null): boolean {
  const from = UNDO_POLICY[level].pauseFrom;
  if (grade === null || from === null) return false;
  return GRADE_ORDER.indexOf(grade) >= GRADE_ORDER.indexOf(from);
}

// ---------------------------------------------------------------------------------------------
// Decision records (A.7, §11.4)

/** The record of decision `decisionId` that still stands (not undone), or null. */
export function standingRecord(meta: HandMeta, decisionId: number): DecisionRecord | null {
  for (let i = meta.decisions.length - 1; i >= 0; i--) {
    const r = meta.decisions[i] as DecisionRecord;
    if (r.decisionId === decisionId && !r.undone) return r;
  }
  return null;
}

/** What the controller knows about a hero decision when it is made (the grade comes later). */
export interface DecisionFacts {
  decisionId: number;
  street: Street;
  taken: PlayerAction;
  /** The HUD win chance at the decision (final, else the latest estimate), or null. */
  eRandom: number | null;
  /** The price (§0.3 `need`), or null with nothing to call. */
  need: number | null;
  /** The hint was on show (Beginner) or opened (§10.2 "Counts as on your own"). */
  hintSeen: boolean;
}

/** A.7: the record of a decision, graded or not (`result` null: grading failed twice, r5). */
export function decisionRecord(f: DecisionFacts, result: GradeResult | null): DecisionRecord {
  return {
    decisionId: f.decisionId,
    street: f.street,
    taken: f.taken,
    rec: result?.rec ?? f.taken,
    grade: result?.grade ?? null,
    lossMilliBB: result === null ? 0 : Math.round(result.lossMilliBB),
    eRandom: f.eRandom,
    need: f.need,
    hintSeen: f.hintSeen,
    undone: false,
    leak: result?.leak ?? null,
    quiz: null,
  };
}

/** `meta` with `record` added (records keep their order of arrival). */
export function withRecord(meta: HandMeta, record: DecisionRecord): HandMeta {
  return { ...meta, decisions: [...meta.decisions, record] };
}

/** §11.4: a hand with an undo is practice (`assisted`): its results go to the Practice bucket. */
export function isAssisted(meta: HandMeta): boolean {
  return meta.undoCount > 0;
}

/**
 * The price of the hero's call at `h` (§0.3, as `brain/features.ts`): `toCall / (winPot +
 * toCall)` with the capped `winPot`; null with nothing to call.
 */
export function priceNeed(h: HandState): number | null {
  const legal = h.toAct === HERO ? legalActions(h) : null;
  const toCall = legal?.callAmount ?? 0;
  if (toCall <= 0) return null;
  const hero = h.seats[HERO];
  if (hero === undefined) return null;
  const capped = hero.totalBet + toCall;
  let winPot = hero.totalBet;
  h.seats.forEach((s, i) => {
    if (i !== HERO && s.dealtIn) winPot += Math.min(s.totalBet, capped);
  });
  return toCall / (winPot + toCall);
}

/** Live opponents of the hero: dealt in and not folded (the HUD's `nOpp`, §7.1). */
function liveOpponents(h: HandState): number {
  return h.seats.filter((s, i) => i !== HERO && s.dealtIn && !s.folded).length;
}

/**
 * The HUD win chance for the decision at `h`, from the store's equity slice (§7.4): `final` when
 * the final estimate for exactly this situation is there (what a grade job carries, §8.2), and
 * `latest` = that, or else the latest estimate (what the record keeps). Null when the slice is
 * about something else (another hand, street or opponent count, known-hands mode).
 */
export function hudEquityAt(
  equity: EquitySlice,
  h: HandState,
): { final: number | null; latest: number | null } {
  const none = { final: null, latest: null };
  const sit = equity.situation;
  const result = equity.result;
  if (equity.mode !== 'random' || sit === null || result === null) return none;
  if (sit.handSeq !== h.handSeq || sit.board.length !== h.board.length) return none;
  if (sit.nOpp !== liveOpponents(h)) return none;
  return { final: result.final ? result.equity : null, latest: result.equity };
}

// ---------------------------------------------------------------------------------------------
// Undo (§11.3 r2, r3)

/** Why Undo is not possible now, or null when it is (§11.3 r2, r5, r8). */
export type UndoBlock =
  /** No decision point in this hand yet (or no hand). */
  | 'noDecision'
  /** The hero has not acted at the latest decision point yet. */
  | 'notActed'
  /** The hero has reached a newer decision point. */
  | 'newerDecision'
  | 'handOver'
  /** A run-out reveal or a showdown: cards are public (pitfall 24). */
  | 'revealed'
  /** This decision was undone once already (one undo per decision point). */
  | 'used'
  /** Its grade has not arrived yet (r5: the undone record always has a grade). */
  | 'gradePending'
  /** The coach level does not offer Undo here (§10.2). */
  | 'level';

export interface UndoContext {
  hand: HandState | null;
  snapshot: UndoSnapshot | null;
  meta: HandMeta;
  /** The coach level the decision was made at. */
  level: CoachLevel;
  /** The feedback card is open (Advanced offers Undo only there). */
  feedbackOpen: boolean;
}

/** §11.3 r2: what keeps Undo from being possible now; null = Undo is possible. */
export function undoBlock(c: UndoContext): UndoBlock | null {
  const h = c.hand;
  const snap = c.snapshot;
  if (h === null || snap === null || snap.state.handSeq !== h.handSeq) return 'noDecision';
  if (h.phase === 'complete') return 'handOver';
  if (h.revealed.length > 0) return 'revealed';
  const taken = heroDecisionsTaken(h);
  if (taken <= snap.decisionId) return 'notActed';
  if (taken > snap.decisionId + 1 || isHeroTurn(h)) return 'newerDecision';
  if (h.undoneDecisions.includes(snap.decisionId)) return 'used';
  if (standingRecord(c.meta, snap.decisionId) === null) return 'gradePending';
  const where = UNDO_POLICY[c.level].undo;
  if (where === 'none' || (where === 'feedback' && !c.feedbackOpen)) return 'level';
  return null;
}

/** What `restoreForUndo` gives back. */
export interface Restored {
  /** The snapshot's state with the stub reshuffled: the hero is to act again. */
  state: HandState;
  /** The inputs up to the snapshot, then `reshuffle` (§4.7: the undone ones are gone). */
  inputs: EngineInput[];
  /** The undone decision's record marked `undone: true`, `undoCount + 1`. */
  meta: HandMeta;
  reshuffle: Extract<EngineInput, { kind: 'reshuffle' }>;
}

/**
 * §11.3 r3 steps 3–5 (the controller does steps 1–2, the epoch and the jobs, and step 6).
 *
 * The meta is the current one with the undone decision's record marked `undone: true` and
 * `undoCount + 1`: the snapshot's meta plus that record, as r3 says, and also a late grade of an
 * earlier decision that arrived after the snapshot was taken. `step` refuses a second reshuffle of
 * the same decision (`EngineError` `UNDO_USED`); nothing changes then.
 */
export function restoreForUndo(
  snapshot: UndoSnapshot,
  current: { inputs: readonly EngineInput[]; meta: HandMeta },
  stepFn: typeof step = step,
): Restored {
  const reshuffle = { kind: 'reshuffle', decisionId: snapshot.decisionId, undoIndex: 0 } as const;
  const state = stepFn(snapshot.state, reshuffle);
  const inputs = [...current.inputs.slice(0, snapshot.inputCount), reshuffle];
  const undone = standingRecord(current.meta, snapshot.decisionId);
  const meta: HandMeta = {
    ...current.meta,
    decisions: current.meta.decisions.map((r) => (r === undone ? { ...r, undone: true } : r)),
    undoCount: current.meta.undoCount + 1,
  };
  return { state, inputs, meta, reshuffle };
}

// ---------------------------------------------------------------------------------------------
// The feedback card (§12.6, Appendix F.4, F.5)

/** A move as the action bar names it (§12.7, F.10): "Call 40", "Raise to 120", "All-in 2,340". */
export interface MoveView {
  kind: 'fold' | 'check' | 'call' | 'callAllIn' | 'bet' | 'raise' | 'allIn';
  /** Chips: the call, or the bet or raise-to amount; null for fold and check. */
  amount: number | null;
  /** The big blind, for amounts shown in big blinds. */
  bb: number;
}

/** How the action bar would name `action` with these legal actions. */
export function moveView(action: PlayerAction, legal: LegalActions | null, bb: number): MoveView {
  switch (action.type) {
    case 'fold':
    case 'check':
      return { kind: action.type, amount: null, bb };
    case 'call':
      return {
        kind: legal?.callIsAllIn === true ? 'callAllIn' : 'call',
        amount: legal?.callAmount ?? null,
        bb,
      };
    case 'bet':
    case 'raise': {
      const bounds = action.type === 'bet' ? legal?.bet : legal?.raise;
      const allIn = bounds !== null && bounds !== undefined && action.to === bounds.max;
      return { kind: allIn ? 'allIn' : action.type, amount: action.to, bb };
    }
  }
}

/** The feedback card's content (§12.6): set when the card opens, fixed while it is open. */
export interface FeedbackView {
  decisionId: number;
  grade: Grade;
  /** "Coach's move: Call 40." */
  coachMove: MoveView;
  /**
   * The reason (F.5) as the grade's 5.6 line; null: the card says the fallback row with the
   * coach's move (`ui/feedback.ts`).
   */
  reason: Line | null;
  /** [Undo: try again] works (else it shows disabled: this decision was undone once already). */
  canUndo: boolean;
}

/** The card for `result`, a grade of the decision at `decision` (its state before the act). */
export function feedbackView(
  result: GradeResult,
  decision: HandState,
  canUndo: boolean,
): FeedbackView {
  const legal = legalActions(decision);
  return {
    decisionId: result.decisionId,
    grade: result.grade,
    coachMove: moveView(result.rec, legal, decision.bb),
    reason: result.feedback,
    canUndo,
  };
}
