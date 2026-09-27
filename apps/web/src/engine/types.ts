/**
 * Engine types (PLAN Appendix A.3 and A.4). Field names are normative: add a field only by
 * updating Appendix A first.
 *
 * Every state here is plain JSON (PLAN §2.4, §4.6): no typed arrays, `Map`, `Set`, `Date`, class
 * instances or `undefined` (use `null`), so `JSON.parse(JSON.stringify(s))` deep-equals `s`.
 * Chips are integers (§0.3). Bet amounts are always "to" amounts: the seat's total for the street,
 * never "raise by" (Known pitfall 1). Seats are 0..n−1 clockwise; the hero is seat 0.
 */
import type { Card } from '../core/cards.ts';
import type { Seed128 } from '../core/rng.ts';
import type { HandCategory } from '../eval/evaluate.ts';

// Defined in core/assert.ts (core imports nothing, and persist needs them too); re-exported here
// as Appendix A.1 and A.3 say.
export { EngineError, InvariantError } from '../core/assert.ts';
export type { EngineErrorCode } from '../core/assert.ts';

/**
 * The engine's semver, stored in every `TableState`, `HandState` and replay record (§4.6, §4.7).
 * It equals the `version` of apps/web/package.json; a test keeps the two equal (the engine may
 * import only `core` and `eval`, so it cannot read package.json itself).
 */
export const ENGINE_VERSION = '0.1.0';

export type Street = 'preflop' | 'flop' | 'turn' | 'river';
export type Phase = 'betting' | 'roundComplete' | 'showdown' | 'complete';
export type BotLevel = 'easy' | 'medium' | 'hard' | 'expert';
export type CoachLevel = 'beginner' | 'intermediate' | 'advanced' | 'exam';
export type PersonalityId = 'rock' | 'tag' | 'lag' | 'station' | 'maniac';

/** Streets in dealing order. */
export const STREETS: readonly Street[] = ['preflop', 'flop', 'turn', 'river'];
export const PHASES: readonly Phase[] = ['betting', 'roundComplete', 'showdown', 'complete'];
export const BOT_LEVELS: readonly BotLevel[] = ['easy', 'medium', 'hard', 'expert'];
export const COACH_LEVELS: readonly CoachLevel[] = ['beginner', 'intermediate', 'advanced', 'exam'];
export const PERSONALITY_IDS: readonly PersonalityId[] = [
  'rock',
  'tag',
  'lag',
  'station',
  'maniac',
];

export type PlayerAction =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  | { type: 'bet'; to: number } // "to" = the seat's street total after the action
  | { type: 'raise'; to: number };

export type EngineInput =
  | { kind: 'act'; seat: number; action: PlayerAction }
  | { kind: 'advance' }
  | { kind: 'reshuffle'; decisionId: number; undoIndex: number };

export interface TableConfig {
  seatCount: number; // 2..9
  sb: number; // bb / 2
  bb: number; // even, 2..100,000
  startingStack: number; // 200..1,000,000 and 10..500 bb (§3.2)
  botLevel: BotLevel;
  seatLevels: (BotLevel | null)[]; // per-seat override, index = seat; null = table level; [0] always null
}

export interface PlayerSlot {
  playerId: string; // "hero" or "bot-7" (unique for the table's life: 'bot-' + nameCursor, §9.3)
  name: string;
  kind: 'hero' | 'bot';
  personality: PersonalityId | null; // null for the hero
  stack: number; // chips between hands
}

export interface TableState {
  schema: 1;
  engineVersion: string;
  tableId: string; // first 8 hex characters of deriveSeed(tableSeed, 'id')
  tableSeed: Seed128;
  config: TableConfig;
  slots: PlayerSlot[]; // index = seat; the hero is seat 0
  button: number; // last hand's button; -1 before the first hand (startHand moves it, §3.3)
  prevBB: number | null; // last hand's big blind, for the 3→2 rule; null before the first hand
  nextHandSeq: number; // handSeq of the next hand (≥ 1; global, see §14.3 "handSeq rule")
  handsDealt: number; // hands finished at this table (nextTable adds 1); the top bar shows "Hand {handsDealt + 1}"
  personalityCursor: number; // monotonic: the next bot takes entry personalityCursor mod 8 (§9.3)
  nameCursor: number; // monotonic: the next bot's name is at nameCursor mod 24 of the name order (§9.3)
  reloads: number; // hero reloads and top-ups at this table (topUp)
}

export interface SeatState {
  dealtIn: boolean; // stack > 0 when the hand started (§3.1)
  stack: number; // chips behind; after settlement the final stack
  hole: [Card, Card] | null; // [first card dealt, second card dealt]; null when not dealt in
  folded: boolean; // always false for a seat that is not dealt in
  allIn: boolean; // ⇔ dealtIn ∧ ¬folded ∧ stack == 0 (I7), also after settlement
  streetBet: number; // chips in this street (after uncalled refunds); settlement leaves it as it is
  totalBet: number; // chips in this hand (after uncalled refunds); settlement leaves it as it is
  lastActedAtBet: number | null; // currentBet right after the seat's last voluntary action this street
}

/**
 * The hand's public history. Blind posts are always the first two events (small blind, then big
 * blind). `refund` moves uncalled chips back from that seat's `streetBet` and `totalBet` to its
 * stack (§3.8). There is at most one `reveal` event per hand (§4.3).
 */
export type LogEvent =
  // amount = min(blind, stack); allIn = the post emptied the stack
  | { e: 'post'; seat: number; blind: 'sb' | 'bb'; amount: number; allIn: boolean }
  // amountIn = chips this action put in (0 for fold and check); allIn = the stack is empty after
  // it; full = a bet or raise with inc ≥ minRaiseInc (§3.6); false for every other action
  | {
      e: 'act';
      seat: number;
      street: Street;
      action: PlayerAction;
      amountIn: number;
      allIn: boolean;
      full: boolean;
    }
  | { e: 'refund'; seat: number; amount: number }
  // cards = the cards this street adds to the board (3 on the flop, then 1)
  | { e: 'street'; street: Street; cards: Card[] }
  | { e: 'reveal'; seats: number[]; reason: 'runout' | 'showdown' }
  | { e: 'reshuffle'; decisionId: number; undoIndex: number }
  // pot = index into result.pots (0 = main pot); seats = that pot's winners in odd-chip order
  // (§3.8); amounts = what each of them gets, parallel to seats
  | { e: 'award'; pot: number; seats: number[]; amounts: number[] };

export interface Pot {
  amount: number;
  eligible: number[]; // live seats that can win it
}

export interface HandResult {
  endedBy: 'fold' | 'showdown';
  pots: Pot[]; // main pot first, then side pots from the lowest level up (§3.8)
  potWinners: number[][]; // parallel to pots
  payouts: number[]; // per seat, gross
  net: number[]; // per seat, payout − totalBet
  shown: { seat: number; score: number; category: HandCategory; best5: Card[] }[];
}

export interface HandState {
  schema: 1;
  engineVersion: string;
  handSeq: number;
  seed: Seed128; // the hand seed; the deck is deriveSeed(seed, 'deck') (§2.4)
  sb: number;
  bb: number;
  seats: SeatState[];
  button: number;
  sbSeat: number;
  bbSeat: number;
  street: Street;
  phase: Phase;
  board: Card[];
  deck: Card[]; // permutation of 0..51 in dealing order (§3.4)
  deckPos: number; // index of the next card to use: 2k preflop, 2k+4 flop, 2k+6 turn, 2k+8 river
  currentBet: number;
  minRaiseInc: number;
  lastAggressor: number | null;
  preflopAggressor: number | null;
  toAct: number | null;
  runout: boolean;
  revealed: number[]; // seats whose hole cards are public
  undoneDecisions: number[];
  startTotal: number; // Σ startStacks
  startStacks: number[]; // per seat at hand start, before the blinds (0 = not dealt in)
  log: LogEvent[];
  result: HandResult | null;
}

export interface LegalActions {
  seat: number;
  toCall: number;
  callAmount: number;
  callIsAllIn: boolean;
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  bet: { min: number; max: number } | null; // "to" amounts
  raise: { min: number; max: number } | null; // "to" amounts
}

export interface ReplayRecord {
  engineVersion: string;
  seed: Seed128;
  commit: string | null;
  table: TableState; // as at hand start
  inputs: EngineInput[];
}

// ---------------------------------------------------------------------------------------------
// Appendix A.4: the observation, built only by observe.ts (§4.8). It is everything the brain
// ever sees about a hand.

export interface PublicAction {
  seat: number;
  street: Street;
  type: 'postSB' | 'postBB' | 'fold' | 'check' | 'call' | 'bet' | 'raise';
  to: number | null;
  amountIn: number;
  allIn: boolean;
  full: boolean;
  potBefore: number;
}

export interface SeatStats {
  // x = times done, n = opportunities
  hands: number;
  vpip: [number, number];
  pfr: [number, number];
  threeBet: [number, number];
  foldTo3bet: [number, number];
  cbet: [number, number];
  foldToCbet: [number, number];
  wtsd: [number, number];
  aggActions: number; // AF = aggActions / passiveActions
  passiveActions: number;
}

export interface ObserveExtras {
  seatStats: (SeatStats | null)[];
  visiblePersonality: (PersonalityId | null)[]; // non-null only for seats at Easy/Medium
  seatLevels: BotLevel[]; // effective level per seat (public: shown at setup)
}

export interface Observation {
  seat: number;
  hole: [Card, Card];
  board: Card[];
  street: Street;
  handSeq: number;
  sb: number;
  bb: number;
  button: number;
  sbSeat: number;
  bbSeat: number;
  pot: number; // Σ totalBet
  legal: LegalActions;
  stacks: number[];
  streetBets: number[];
  totalBets: number[];
  dealtIn: boolean[];
  folded: boolean[];
  allIn: boolean[];
  history: PublicAction[];
  revealedHoles: ([Card, Card] | null)[]; // only seats in h.revealed
  seatStats: (SeatStats | null)[];
  visiblePersonality: (PersonalityId | null)[];
  seatLevels: BotLevel[];
}

/**
 * Canonical JSON of an observation: object keys sorted, arrays in order, no whitespace. Two
 * observations get the same key exactly when they are deep-equal, whatever order their keys were
 * written in. It seeds the coach's Monte Carlo (§2.4), so the same situation always gives the same
 * advice. Throws on anything that is not plain JSON (`undefined`, NaN, functions, …).
 */
export function observationKey(o: Observation): string {
  return canonicalJson(o, 'observation');
}

function canonicalJson(value: unknown, path: string): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'string':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError(`observationKey: ${path} is ${value}`);
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        const items: string[] = [];
        // An index loop, not map(): a hole in a sparse array is `undefined` and must throw.
        for (let i = 0; i < value.length; i++) items.push(canonicalJson(value[i], `${path}[${i}]`));
        return `[${items.join(',')}]`;
      }
      const proto: unknown = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) {
        throw new TypeError(`observationKey: ${path} is not a plain object`);
      }
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record).sort();
      const parts = keys.map(
        (k) => `${JSON.stringify(k)}:${canonicalJson(record[k], `${path}.${k}`)}`,
      );
      return `{${parts.join(',')}}`;
    }
    default:
      throw new TypeError(`observationKey: ${path} is ${typeof value}, not JSON`);
  }
}
