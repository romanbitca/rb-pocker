/**
 * PLAN §18 Stage 8, acceptance 2: a fixture of 20 scripted hands and the numbers every Stats card
 * must show for them, computed by hand (the arithmetic is in the comments next to each number).
 *
 * The hands are played by the real engine with chosen cards (`rigDeck`), at a 3-seat table: you
 * (seat 0) and two bots, blinds 10/20, 2,000 chips each (stacks start again at 2,000 every hand).
 * The button moves 0 → 1 → 2: as button you act first before the flop and last after it; as small
 * blind you act first after the flop. Each hand's decisions (grades, hints, Undo, quiz, leaks) are
 * scripted with it, as the coach would record them (A.7 `DecisionRecord`).
 *
 * Three sessions: S1 = hands 1–8 on 10 Oct (ended), S2 = hands 9–15 on 18 Oct (ended), S3 =
 * hands 16–20 on 20 Oct (running). "Now" is 20 Oct 12:00 UTC, so in every time zone S2 and S3 are
 * in the last 7 local days and S1 in the 7 days before. One reload, after hand 7 (you lost
 * everything). Hands 9 and 18 used Undo (practice); hand 10 had a bot at another level (a mixed
 * table: in no level bucket). Hand 15's grade failed (it counts in no decision number).
 */
import type { KnownEquity } from '../../../src/app/store.ts';
import { handRecordOf } from '../../../src/app/handRecord.ts';
import type { Grade, LeakId } from '../../../src/brain/types.ts';
import { step } from '../../../src/engine/step.ts';
import type {
  BotLevel,
  CoachLevel,
  EngineInput,
  HandState,
  PlayerAction,
  Street,
} from '../../../src/engine/types.ts';
import type { DecisionRecord, HandRecord, Stats } from '../../../src/persist/schema.ts';
import { emptyStats } from '../../../src/persist/schema.ts';
import { applyHand, endSession } from '../../../src/persist/stats.ts';
import type { StatsView } from '../../../src/ui/stats.ts';
import { deal, rigDeck, tableWith } from '../../engine/helpers.ts';

export const NOW = new Date('2026-10-20T12:00:00.000Z');
/** The leaks' chips use the current big blind. */
export const BB = 20;

const STACKS = [2000, 2000, 2000];

interface Decision {
  street: Street;
  taken: PlayerAction;
  rec: PlayerAction;
  grade: Grade | null;
  hintSeen?: boolean;
  undone?: boolean;
  leak?: LeakId;
  loss?: number;
  quiz?: { correct: number; of: number };
}

interface Script {
  /** The button's seat. */
  button: number;
  holes: Record<number, string>;
  board?: string;
  /** "0 raise 60", "1 fold", "undo 1" (the reshuffle of decision 1); `advance` comes by itself. */
  acts: string[];
  decisions: Decision[];
  coach: CoachLevel;
  at: string;
  /** Per-seat levels (a mixed table); default the table's (Easy) for both bots. */
  seatLevels?: (BotLevel | null)[];
  /** The hero's run-out equity when all the chips went in (§7.6, `equity.allIn`). */
  allIn?: number;
}

const P = {
  fold: { type: 'fold' },
  check: { type: 'check' },
  call: { type: 'call' },
  bet: (to: number): PlayerAction => ({ type: 'bet', to }),
  raise: (to: number): PlayerAction => ({ type: 'raise', to }),
} as const;

const at = (day: string, minute: number): string =>
  `2026-10-${day}T${minute < 60 ? '12' : '13'}:${String(minute % 60).padStart(2, '0')}:00.000Z`;
const s3 = (minute: number): string => `2026-10-20T09:0${minute}:00.000Z`;

/** The 20 hands. Net results per hand are worked out in `EXPECTED`'s comments. */
export const SCRIPTS: readonly Script[] = [
  // ---- S1 (10 Oct) ----
  // H1, button: you fold, the small blind folds. Net 0.
  {
    button: 0,
    holes: {},
    acts: ['0 fold', '1 fold'],
    decisions: [{ street: 'preflop', taken: P.fold, rec: P.fold, grade: 'best', hintSeen: true }],
    coach: 'beginner',
    at: at('10', 0),
  },
  // H2, big blind: both fold (a walk). Your 10 over the small blind comes back; you take 20. Net +10.
  {
    button: 1,
    holes: {},
    acts: ['1 fold', '2 fold'],
    decisions: [],
    coach: 'beginner',
    at: at('10', 1),
  },
  // H3, small blind: you complete, all check to the showdown. A♥K♥ makes a flush. Pot 40. Net +20.
  {
    button: 2,
    holes: { 0: 'Ah Kh', 1: '7c 2d' },
    board: 'Qh Jh 5h 9s 4d',
    acts: [
      '2 fold',
      '0 call',
      '1 check',
      '0 check',
      '1 check',
      '0 check',
      '1 check',
      '0 check',
      '1 check',
    ],
    decisions: [
      {
        street: 'preflop',
        taken: P.call,
        rec: P.raise(60),
        grade: 'inaccuracy',
        hintSeen: true,
        leak: 'limp',
        loss: 300,
      },
      {
        street: 'flop',
        taken: P.check,
        rec: P.bet(30),
        grade: 'mistake',
        hintSeen: true,
        leak: 'missed-value',
        loss: 1500,
      },
      {
        street: 'turn',
        taken: P.check,
        rec: P.bet(30),
        grade: 'mistake',
        hintSeen: true,
        leak: 'missed-value',
        loss: 2000,
      },
      { street: 'river', taken: P.check, rec: P.bet(30), grade: 'good', hintSeen: true, loss: 100 },
    ],
    coach: 'beginner',
    at: at('10', 2),
  },
  // H4, button: you raise to 60, both fold. 40 comes back; the pot is 20 + 10 + 20 = 50. Net +30.
  {
    button: 0,
    holes: {},
    acts: ['0 raise 60', '1 fold', '2 fold'],
    decisions: [
      { street: 'preflop', taken: P.raise(60), rec: P.raise(60), grade: 'best', hintSeen: true },
    ],
    coach: 'beginner',
    at: at('10', 3),
  },
  // H5, big blind: the button raises to 60, the small blind folds, you call; on the flop you check
  // and fold to a bet of 80. Net −60.
  {
    button: 1,
    holes: { 0: '9c 8d', 1: 'As Ad' },
    board: 'Kc Qd 2h 3s 4c',
    acts: ['1 raise 60', '2 fold', '0 call', '0 check', '1 bet 80', '0 fold'],
    decisions: [
      { street: 'preflop', taken: P.call, rec: P.call, grade: 'best' },
      { street: 'flop', taken: P.check, rec: P.check, grade: 'best' },
      { street: 'flop', taken: P.fold, rec: P.call, grade: 'mistake', leak: 'overfold', loss: 900 },
    ],
    coach: 'intermediate',
    at: at('10', 4),
  },
  // H6, small blind: the button folds, you fold. Net −10.
  {
    button: 2,
    holes: {},
    acts: ['2 fold', '0 fold'],
    decisions: [{ street: 'preflop', taken: P.fold, rec: P.fold, grade: 'best' }],
    coach: 'intermediate',
    at: at('10', 5),
  },
  // H7, button: you raise to 60, the small blind folds, the big blind goes all in (2,000), you
  // call. Q♠Q♦ against A♣K♣, the ace comes: you lose 2,000. Pot 2,000 + 2,000 + 10 = 4,010.
  // All-in: expected 54% of 4,010 = 2,165.4 → 2,165 chips; actual 0.
  {
    button: 0,
    holes: { 0: 'Qs Qd', 2: 'Ac Kc' },
    board: 'Ah 7d 2s 9h 3c',
    acts: ['0 raise 60', '1 fold', '2 raise 2000', '0 call'],
    decisions: [
      { street: 'preflop', taken: P.raise(60), rec: P.raise(60), grade: 'best' },
      { street: 'preflop', taken: P.call, rec: P.call, grade: 'best', hintSeen: true },
    ],
    coach: 'intermediate',
    at: at('10', 6),
    allIn: 0.54,
  },
  // (Reload: you were out of chips.)
  // H8, big blind: the button folds, the small blind completes, you check; on the flop the small
  // blind checks, you bet 40, it folds. Pot 40, your 40 comes back. Net +20.
  {
    button: 1,
    holes: {},
    acts: ['1 fold', '2 call', '0 check', '2 check', '0 bet 40', '2 fold'],
    decisions: [
      { street: 'preflop', taken: P.check, rec: P.check, grade: 'best' },
      { street: 'flop', taken: P.bet(40), rec: P.bet(30), grade: 'good', loss: 50 },
    ],
    coach: 'intermediate',
    at: at('10', 7),
  },
  // ---- S2 (18 Oct) ----
  // H9, small blind, with Undo (practice): the button folds; your call is taken back, you raise to
  // 60 and the big blind folds. Pot 20 + 20 = 40. Net +20.
  {
    button: 2,
    holes: {},
    acts: ['2 fold', 'undo 0', '0 raise 60', '1 fold'],
    decisions: [
      {
        street: 'preflop',
        taken: P.call,
        rec: P.raise(60),
        grade: 'mistake',
        hintSeen: true,
        undone: true,
        leak: 'limp',
        loss: 600,
      },
      { street: 'preflop', taken: P.raise(60), rec: P.raise(60), grade: 'best', hintSeen: true },
    ],
    coach: 'beginner',
    at: at('18', 0),
  },
  // H10, button, a mixed table (the big blind plays Hard): you raise to 60, the small blind folds,
  // the big blind calls; flop you bet 80, called; turn checked; river it bets 100, you call. K♠K♦
  // makes three kings. Pot 60 + 60 + 10 + 80 + 80 + 100 + 100 = 490; you put in 240. Net +250.
  {
    button: 0,
    holes: { 0: 'Ks Kd', 2: 'Js Th' },
    board: 'Kh 8c 4d 2s Jc',
    acts: [
      '0 raise 60',
      '1 fold',
      '2 call',
      '2 check',
      '0 bet 80',
      '2 call',
      '2 check',
      '0 check',
      '2 bet 100',
      '0 call',
    ],
    decisions: [
      { street: 'preflop', taken: P.raise(60), rec: P.raise(60), grade: 'best' },
      { street: 'flop', taken: P.bet(80), rec: P.bet(80), grade: 'best' },
      {
        street: 'turn',
        taken: P.check,
        rec: P.bet(150),
        grade: 'inaccuracy',
        leak: 'missed-value',
        loss: 700,
      },
      { street: 'river', taken: P.call, rec: P.call, grade: 'best' },
    ],
    coach: 'intermediate',
    at: at('18', 1),
    seatLevels: [null, null, 'hard'],
  },
  // H11, big blind: the button raises to 60, the small blind calls, you raise to 200, both fold.
  // 140 comes back; pot 60 × 3 = 180, you put in 60. Net +120.
  {
    button: 1,
    holes: {},
    acts: ['1 raise 60', '2 call', '0 raise 200', '1 fold', '2 fold'],
    decisions: [
      {
        street: 'preflop',
        taken: P.raise(200),
        rec: P.call,
        grade: 'good',
        quiz: { correct: 2, of: 3 },
      },
    ],
    coach: 'advanced',
    at: at('18', 2),
  },
  // H12, small blind: you complete, the big blind checks; flop you bet 20, it raises to 80, you
  // call; turn you check, it bets 120, you call; river checked. 9♥8♥ misses (nine high) against
  // the aces. You put in 20 + 80 + 120 = 220. Net −220.
  {
    button: 2,
    holes: { 0: '9h 8h', 1: 'Ad 5c' },
    board: 'Ah 7c 2h Kd 3s',
    acts: [
      '2 fold',
      '0 call',
      '1 check',
      '0 bet 20',
      '1 raise 80',
      '0 call',
      '0 check',
      '1 bet 120',
      '0 call',
      '0 check',
      '1 check',
    ],
    decisions: [
      {
        street: 'preflop',
        taken: P.call,
        rec: P.raise(60),
        grade: 'inaccuracy',
        leak: 'limp',
        loss: 200,
      },
      {
        street: 'flop',
        taken: P.bet(20),
        rec: P.check,
        grade: 'mistake',
        leak: 'bluff-much',
        loss: 1200,
      },
      {
        street: 'flop',
        taken: P.call,
        rec: P.fold,
        grade: 'mistake',
        leak: 'chase',
        loss: 1500,
        quiz: { correct: 1, of: 3 },
      },
      { street: 'turn', taken: P.check, rec: P.check, grade: 'best' },
      { street: 'turn', taken: P.call, rec: P.fold, grade: 'blunder', leak: 'chase', loss: 5000 },
      { street: 'river', taken: P.check, rec: P.check, grade: 'best' },
    ],
    coach: 'advanced',
    at: at('18', 3),
  },
  // H13, button: you fold (the hint said raise), the small blind folds. Net 0.
  {
    button: 0,
    holes: {},
    acts: ['0 fold', '1 fold'],
    decisions: [
      {
        street: 'preflop',
        taken: P.fold,
        rec: P.raise(60),
        grade: 'mistake',
        hintSeen: true,
        leak: 'open-tight',
        loss: 800,
      },
    ],
    coach: 'advanced',
    at: at('18', 4),
  },
  // H14, big blind: the button raises to 60, the small blind folds, you go all in (2,000), the
  // button calls. 6♠6♣ against A♥A♦ makes three sixes. Pot 2,000 + 2,000 + 10 = 4,010. Net +2,010.
  // All-in: expected 18% of 4,010 = 721.8 → 722 chips; actual 4,010.
  {
    button: 1,
    holes: { 0: '6s 6c', 1: 'Ah Ad' },
    board: '6d Kc 2h 9s 4c',
    acts: ['1 raise 60', '2 fold', '0 raise 2000', '1 call'],
    decisions: [
      { street: 'preflop', taken: P.raise(2000), rec: P.fold, grade: 'mistake', loss: 2500 },
    ],
    coach: 'advanced',
    at: at('18', 5),
    allIn: 0.18,
  },
  // H15, small blind: the button folds, you fold; the grade never came (null). Net −10.
  {
    button: 2,
    holes: {},
    acts: ['2 fold', '0 fold'],
    decisions: [{ street: 'preflop', taken: P.fold, rec: P.fold, grade: null }],
    coach: 'advanced',
    at: at('18', 6),
  },
  // ---- S3 (20 Oct, running) ----
  // H16, button: you call 20, the small blind folds, the big blind checks; all check to the end.
  // T♣9♣ makes a club flush. Pot 20 + 20 + 10 = 50. Net +30.
  {
    button: 0,
    holes: { 0: 'Tc 9c', 2: '8d 8s' },
    board: 'Jc Qc 2c 5d 7h',
    acts: [
      '0 call',
      '1 fold',
      '2 check',
      '2 check',
      '0 check',
      '2 check',
      '0 check',
      '2 check',
      '0 check',
    ],
    decisions: [
      {
        street: 'preflop',
        taken: P.call,
        rec: P.raise(60),
        grade: 'inaccuracy',
        leak: 'limp',
        loss: 300,
      },
      {
        street: 'flop',
        taken: P.check,
        rec: P.bet(30),
        grade: 'mistake',
        leak: 'missed-value',
        loss: 1800,
      },
      { street: 'turn', taken: P.check, rec: P.check, grade: 'best' },
      {
        street: 'river',
        taken: P.check,
        rec: P.bet(40),
        grade: 'mistake',
        leak: 'missed-value',
        loss: 2200,
      },
    ],
    coach: 'exam',
    at: s3(0),
  },
  // H17, big blind: the button folds, the small blind raises to 60, you fold. Net −20.
  {
    button: 1,
    holes: {},
    acts: ['1 fold', '2 raise 60', '0 fold'],
    decisions: [{ street: 'preflop', taken: P.fold, rec: P.fold, grade: 'best' }],
    coach: 'exam',
    at: s3(1),
  },
  // H18, small blind, with Undo (practice): the button folds, you raise to 60, the big blind calls;
  // on the flop your check is taken back, you bet 60 and it folds. Pot 120, your 60 comes back.
  // Net +60.
  {
    button: 2,
    holes: {},
    acts: ['2 fold', '0 raise 60', '1 call', 'undo 1', '0 bet 60', '1 fold'],
    decisions: [
      { street: 'preflop', taken: P.raise(60), rec: P.raise(60), grade: 'best' },
      {
        street: 'flop',
        taken: P.check,
        rec: P.bet(60),
        grade: 'blunder',
        undone: true,
        leak: 'missed-value',
        loss: 4000,
      },
      { street: 'flop', taken: P.bet(60), rec: P.bet(80), grade: 'good', loss: 100 },
    ],
    coach: 'intermediate',
    at: s3(2),
  },
  // H19, button: you raise to 60, the small blind calls, the big blind folds; flop you bet 80,
  // called; turn and river checked. A♣J♦ pairs jacks with the better kicker. Pot 60 + 60 + 20 +
  // 80 + 80 = 300; you put in 140. Net +160.
  {
    button: 0,
    holes: { 0: 'Ac Jd', 1: 'Jh Ts' },
    board: 'Js 9d 4c 6h 2s',
    acts: [
      '0 raise 60',
      '1 call',
      '2 fold',
      '1 check',
      '0 bet 80',
      '1 call',
      '1 check',
      '0 check',
      '1 check',
      '0 check',
    ],
    decisions: [
      { street: 'preflop', taken: P.raise(60), rec: P.raise(60), grade: 'best', hintSeen: true },
      { street: 'flop', taken: P.bet(80), rec: P.bet(80), grade: 'best' },
      {
        street: 'turn',
        taken: P.check,
        rec: P.bet(150),
        grade: 'inaccuracy',
        leak: 'missed-value',
        loss: 600,
      },
      { street: 'river', taken: P.check, rec: P.check, grade: 'best' },
    ],
    coach: 'exam',
    at: s3(3),
  },
  // H20, big blind: the button raises to 60, the small blind folds, you call; checked to the
  // river, it bets 100, you call. 5♥5♦ loses to queens. You put in 160. Net −160.
  {
    button: 1,
    holes: { 0: '5h 5d', 1: 'Qd Qs' },
    board: '8h Tc 2d 3h Kc',
    acts: [
      '1 raise 60',
      '2 fold',
      '0 call',
      '0 check',
      '1 check',
      '0 check',
      '1 check',
      '0 check',
      '1 bet 100',
      '0 call',
    ],
    decisions: [
      { street: 'preflop', taken: P.call, rec: P.call, grade: 'best' },
      { street: 'flop', taken: P.check, rec: P.check, grade: 'best' },
      { street: 'turn', taken: P.check, rec: P.check, grade: 'best' },
      {
        street: 'river',
        taken: P.call,
        rec: P.fold,
        grade: 'mistake',
        leak: 'river-call',
        loss: 1700,
      },
    ],
    coach: 'exam',
    at: s3(4),
  },
];

/** Session ends after these hands (1-based), and a reload after hand 7. */
const SESSION_ENDS = new Set([8, 15]);
const RELOAD_AFTER = 7;

function input(text: string): EngineInput {
  const [who, kind, amount] = text.split(' ');
  if (who === 'undo') return { kind: 'reshuffle', decisionId: Number(kind), undoIndex: 0 };
  const seat = Number(who);
  if (kind === 'bet' || kind === 'raise') {
    return { kind: 'act', seat, action: { type: kind, to: Number(amount) } };
  }
  return { kind: 'act', seat, action: { type: kind as 'fold' | 'check' | 'call' } };
}

/** Steps `h` through the script, advancing whenever a round is over; to the end of the hand. */
function playOut(
  h0: HandState,
  acts: readonly string[],
): { hand: HandState; inputs: EngineInput[] } {
  let h = h0;
  const inputs: EngineInput[] = [];
  const go = (inp: EngineInput): void => {
    h = step(h, inp);
    inputs.push(inp);
  };
  for (const text of acts) {
    while (h.phase === 'roundComplete' || h.phase === 'showdown') go({ kind: 'advance' });
    const inp = input(text);
    if (inp.kind === 'act' && h.toAct !== inp.seat) {
      throw new Error(`"${text}": seat ${String(h.toAct)} is to act`);
    }
    go(inp);
  }
  while (h.phase !== 'complete') go({ kind: 'advance' });
  return { hand: h, inputs };
}

function decisionRecords(script: Script): DecisionRecord[] {
  let id = 0;
  return script.decisions.map((d) => {
    const record: DecisionRecord = {
      decisionId: id,
      street: d.street,
      taken: d.taken,
      rec: d.rec,
      grade: d.grade,
      lossMilliBB: d.loss ?? 0,
      eRandom: null,
      need: null,
      // Beginner shows the hint (§11.3 notes: hintSeen is true there).
      hintSeen: d.hintSeen === true || script.coach === 'beginner',
      undone: d.undone === true,
      leak: d.leak ?? null,
      quiz: d.quiz ?? null,
    };
    // The decision taken back is retried at the same decision point.
    if (d.undone !== true) id++;
    return record;
  });
}

/** One scripted hand, played and recorded as the controller records it (`handRecordOf`). */
export function recordOf(script: Script, handSeq: number): HandRecord {
  const table = tableWith(STACKS, {
    sb: 10,
    bb: BB,
    startingStack: 2000,
    button: script.button,
    nextHandSeq: handSeq,
    ...(script.seatLevels !== undefined && { seatLevels: script.seatLevels }),
  });
  const dealt = deal(table);
  const start =
    Object.keys(script.holes).length === 0 && script.board === undefined
      ? dealt
      : rigDeck(dealt, {
          holes: script.holes,
          ...(script.board !== undefined && { board: script.board }),
        });
  const { hand, inputs } = playOut(start, script.acts);
  const decisions = decisionRecords(script);
  const undoCount = decisions.filter((d) => d.undone).length;
  const allIn: KnownEquity | null =
    script.allIn === undefined
      ? null
      : {
          handSeq: hand.handSeq,
          seats: [...hand.revealed],
          board: [],
          perPlayer: hand.revealed.map((seat) =>
            seat === 0 ? (script.allIn as number) : 1 - (script.allIn as number),
          ),
          exact: true,
          final: true,
        };
  const record = handRecordOf({
    hand,
    table,
    inputs,
    meta: { decisions, undoCount, hintShown: {} },
    coachLevel: script.coach,
    allIn,
    at: script.at,
    commit: null,
    commitBeforeDeal: false,
  });
  if (record === null) throw new Error(`hand ${handSeq}: no record`);
  return record;
}

/** The 20 records, and the stats after them (sessions ended and the reload as the controller does). */
export function playFixture(): { records: HandRecord[]; stats: Stats } {
  const records: HandRecord[] = [];
  let stats = emptyStats();
  SCRIPTS.forEach((script, i) => {
    const n = i + 1;
    const record = recordOf(script, n);
    records.push(record);
    stats = applyHand(stats, record);
    if (n === RELOAD_AFTER) stats = { ...stats, reloads: stats.reloads + 1 };
    if (SESSION_ENDS.has(n)) stats = endSession(stats);
  });
  return { records, stats };
}

/**
 * Every card's numbers, by hand. Decision points: Best 100, Good 90, Slightly off 60, Mistake 25,
 * Big mistake 0 (§14.4). The 46 decisions, numbered D1–D46 in hand order:
 *   S1: D1 best · D2 inaccuracy · D3 mistake · D4 mistake · D5 good · D6 best · D7 best · D8 best ·
 *       D9 mistake · D10 best · D11 best · D12 best (hint opened) · D13 best · D14 good
 *       = 1,115 points / 14 decisions; mistakes 3, big mistakes 0.
 *   S2: D15 mistake (undone) · D16 best · D17 best · D18 best · D19 inaccuracy · D20 best · D21 good ·
 *       D22 inaccuracy · D23 mistake · D24 mistake · D25 best · D26 blunder · D27 best ·
 *       D28 mistake (hint opened) · D29 mistake · D30 no grade
 *       = 935 points / 15 graded; mistakes 5, big mistakes 1.
 *   S3: D31 inaccuracy · D32 mistake · D33 best · D34 mistake · D35 best · D36 best · D37 blunder
 *       (undone) · D38 good · D39 best (hint opened) · D40 best · D41 inaccuracy · D42 best ·
 *       D43 best · D44 best · D45 best · D46 mistake
 *       = 1,185 points / 16; mistakes 3, big mistakes 1.
 */
export const EXPECTED: StatsView = {
  hands: 20,
  ready: true,
  progress: {
    score: {
      // S3 runs: 1,185 / 16 = 74.06 → 74.
      session: 74,
      last: false,
      // Last 7 days = S2 + S3: (935 + 1,185) / (15 + 16) = 2,120 / 31 = 68.39 → 68. The 7 days
      // before = S1: 1,115 / 14 = 79.64 → 80. Change 68 − 80 = −12.
      week: 68,
      change: -12,
      // S1 80, S2 935 / 15 = 62.33 → 62, S3 74.
      series: [80, 62, 74],
    },
    mistakes: {
      // S3: (3 + 1) / 16 × 100 = 25.
      session: 25,
      // S2 + S3: (6 + 4) / 31 × 100 = 32.26 → 32.
      week: 32,
      // S1 3 / 14 × 100 = 21.43 → 21; S2 6 / 15 × 100 = 40; S3 25.
      series: [21, 40, 25],
    },
    // Without the hint (Beginner never counts): 34 graded decisions (all but D1–D6, D12, D15, D16,
    // D28, D39), of which Best or Good: D7, D8, D10, D11, D13, D14, D17, D18, D20, D21, D25, D27,
    // D33, D35, D36, D38, D40, D42, D43, D44, D45 = 21. 21 / 34 = 61.76 → 62%.
    own: 62,
    // Hint seen: those 11; the same kind of move as the coach: D1 (fold), D6, D12 (call), D16, D39
    // = 5. 5 / 11 = 45.45 → 45%.
    follow: 45,
    // In order, a Mistake or Big mistake resets it: … D14 good → 5 (S1); … D22 → 7 (D16 to D22);
    // D38 to D45 → 8; D46 mistake → 0.
    streak: { current: 0, best: 8 },
    // Seen 3 times or more: missed-value 7 times (D3 1,500 + D4 2,000 + D19 700 + D32 1,800 +
    // D34 2,200 + D37 4,000 + D41 600 = 12,800 milli-bb × 20 / 1,000 = 256 chips); limp 4 times
    // (D2 300 + D15 600 + D22 200 + D31 300 = 1,400 → 28 chips). Chase (2) and the rest: fewer.
    leaks: [
      { id: 'missed-value', count: 7, chips: 256 },
      { id: 'limp', count: 4, chips: 28 },
    ],
    // D15 and D37.
    fixedWithUndo: 2,
    // H11 2 of 3, H12 1 of 3: 3 of 6 = 50%.
    quiz: { right: 3, asked: 6, pct: 50 },
  },
  results: {
    // Clean hands: all but H9 and H18.
    hands: 18,
    // You took chips from a pot: H2, H3, H4, H8, H10, H11, H14, H16, H19.
    won: 9,
    // 0 + 10 + 20 + 30 − 60 − 10 − 2,000 + 20 + 250 + 120 − 220 + 0 + 2,010 − 10 + 30 − 20 + 160
    // − 160 = +170.
    netChips: 170,
    // 170 chips = 8.5 big blinds = 8,500 milli-bb over 18 hands: 472.2 → 47.2 per 100 hands.
    bb100: 47.2,
    // Called or raised before the flop: H3, H4, H5, H7, H10, H11, H12, H14, H16, H19, H20 = 11 /
    // 18 = 61.1 → 61%; raised: H4, H7, H10, H11, H14, H19 = 6 / 18 = 33.3 → 33%.
    vpip: 61,
    pfr: 33,
    // Showdowns (run-outs too): H3, H7, H10, H12, H14, H16, H19, H20 = 8; won H3, H10, H14, H16,
    // H19 = 5; 62.5 → 63%.
    showdowns: 8,
    showdownWins: 5,
    showdownPct: 63,
    // H14's 4,010.
    biggestPot: 4010,
    reloads: 1,
    // Expected 2,165 + 722 = 2,887; actual 0 + 4,010 = 4,010; lucky by 1,123.
    luck: { expected: 2887, actual: 4010, luck: 1123 },
    // Easy: the clean hands but H10 (mixed): 17 hands, +170 − 250 = −80 chips = −4,000 milli-bb:
    // −235.3 → −23.5 per 100 hands.
    byLevel: [{ level: 'easy', hands: 17, bb100: -23.5 }],
    practice: 2,
  },
  // Made by the river: H3 flush (first), H16 flush; H7 pair (first), H19, H20 pairs; H10 trips
  // (first), H14 trips; H12 high card.
  collection: [
    { category: 'royalFlush', count: 0, first: null },
    { category: 'straightFlush', count: 0, first: null },
    { category: 'quads', count: 0, first: null },
    { category: 'fullHouse', count: 0, first: null },
    { category: 'flush', count: 2, first: '2026-10-10T12:02:00.000Z' },
    { category: 'straight', count: 0, first: null },
    { category: 'trips', count: 2, first: '2026-10-18T12:01:00.000Z' },
    { category: 'twoPair', count: 0, first: null },
    { category: 'pair', count: 3, first: '2026-10-10T12:06:00.000Z' },
    { category: 'highCard', count: 1, first: '2026-10-18T12:03:00.000Z' },
  ],
};
