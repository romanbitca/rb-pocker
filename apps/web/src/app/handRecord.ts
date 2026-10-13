/**
 * What the commit stores about a finished hand (PLAN §14.3, A.7 `HandRecord`) and how it counts in
 * the profile (`applyHand` and the hero model, §14.4, §9.5). Pure: the controller calls it at hand
 * end, and at boot for a complete hand the session still holds (§14.3 load table).
 *
 * Readings (§14 notes, chunk 8.1): `at` is when the hand is committed; `coachLevel` is the level
 * in force for the hand's latest decision (the settings' when the hero made none); `bestCategory`
 * is the hero's category when the hero was still in the hand as the river card came (it may fold
 * after it); `allIn` is the hero's share of the main pot against the face-up hands, as expected
 * (`equity.allIn`, the board at the reveal) and as it happened, with that pot in chips; `commit`
 * is null until the provable shuffle (Stage 9).
 */
import { describe } from '../eval/describe.ts';
import { updateSeatStats } from '../brain/opponentStats.ts';
import type {
  CoachLevel,
  EngineInput,
  HandState,
  LogEvent,
  TableState,
} from '../engine/types.ts';
import type { HandCategory } from '../eval/evaluate.ts';
import type { HandMeta, HandRecord, Profile } from '../persist/schema.ts';
import { applyHand } from '../persist/stats.ts';
import type { KnownEquity } from './store.ts';

const HERO = 0;

export interface HandEnd {
  /** The complete hand. */
  hand: HandState;
  /** Its table as at hand start. */
  table: TableState;
  /** Every input from `table` to `hand` (the replay log, §4.7). */
  inputs: readonly EngineInput[];
  meta: HandMeta;
  coachLevel: CoachLevel;
  /** The run-out equities at the reveal (the store's `equity.allIn`), or null. */
  allIn: KnownEquity | null;
  /** ISO UTC. */
  at: string;
}

/** The hero's category if the hero was in the hand when the river came (or at the showdown). */
export function bestCategoryOf(h: HandState): HandCategory | null {
  const hole = h.seats[HERO]?.hole ?? null;
  if (hole === null || h.board.length < 5) return null;
  const fold = h.log.find((e) => e.e === 'act' && e.seat === HERO && e.action.type === 'fold');
  if (fold !== undefined && fold.e === 'act' && fold.street !== 'river') return null;
  return describe(hole, h.board).category;
}

/** §14.4 All-in luck: the hero's expected and actual share of the main pot, and that pot. */
export function allInOf(h: HandState, known: KnownEquity | null): HandRecord['allIn'] {
  const at = known?.seats.indexOf(HERO) ?? -1;
  const pot = h.result?.pots[0]?.amount ?? 0;
  if (known === null || !known.final || known.handSeq !== h.handSeq || at < 0 || pot <= 0) {
    return null;
  }
  let won = 0;
  for (const e of h.log) {
    if (e.e === 'award' && e.pot === 0) won += e.amounts[e.seats.indexOf(HERO)] ?? 0;
  }
  return { expected: known.perPlayer[at] ?? 0, actual: won / pot, pot };
}

/** The A.7 record of a complete hand; null when it is not complete or the hero was not dealt in. */
export function handRecordOf(end: HandEnd): HandRecord | null {
  const { hand: h, table, meta } = end;
  const heroHole = h.seats[HERO]?.hole ?? null;
  if (h.result === null || heroHole === null) return null;
  const net = [...h.result.net];
  return {
    handSeq: h.handSeq,
    at: end.at,
    seed: h.seed,
    commit: null,
    engineVersion: h.engineVersion,
    table,
    inputs: [...end.inputs],
    heroHole: [heroHole[0], heroHole[1]],
    board: [...h.board],
    net,
    heroNetMilliBB: Math.round(((net[HERO] ?? 0) * 1000) / h.bb),
    decisions: [...meta.decisions],
    assisted: meta.undoCount > 0,
    undoCount: meta.undoCount,
    botLevel: table.config.botLevel,
    coachLevel: end.coachLevel,
    bestCategory: bestCategoryOf(h),
    allIn: allInOf(h, end.allIn),
  };
}

/**
 * The profile with the hand counted (§14.3 step 4): `applyHand` on the stats and the hero's own
 * counters on the hero model (§9.5). `log` null: the hand adds nothing to the hero model (a hand
 * the app finished headless, §3.1: the forced fold is not the hero's play).
 */
export function countHand(
  profile: Profile,
  record: HandRecord,
  log: readonly LogEvent[] | null,
): Profile {
  return {
    ...profile,
    stats: applyHand(profile.stats, record),
    heroModel: log === null ? profile.heroModel : updateSeatStats(profile.heroModel, log, HERO),
  };
}
