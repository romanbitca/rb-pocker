/**
 * Persisted types (PLAN Appendix A.7), their hand-written type guards (§14.6: no schema library)
 * and the schema defaults for every `Profile` field (Stage 3 stores only `settings`; Stage 8 adds
 * stats on top of the same key).
 *
 * Everything here is plain JSON (§2.4, Known pitfall 21): no `undefined`, typed arrays, `Map`,
 * `Date` or class instances, so `JSON.parse(JSON.stringify(x))` deep-equals `x`. Times are UTC ISO
 * strings. A guard accepts extra fields it does not know (H.2 rule 2: a migration keeps unknown
 * fields), and checks the ranges the PLAN defines (§3.2 stakes, seat counts, whole-number chips).
 *
 * Module boundary (§2.1): persist imports `core`, `engine/invariants` and types only. So the
 * member lists of the unions are written again here as `Record<Union, true>` objects: the type
 * checker rejects a missing or an extra member, so they cannot drift from the unions.
 *
 * The problem strings ("profile.settings.players: expected …") are for Diagnostics and tests,
 * never shown to the player (the toasts and banners live in `i18n/en.ts`).
 */
import { InvariantError } from '../core/assert.ts';
import { isCard, type Card } from '../core/cards.ts';
import { isSeed128, type Seed128 } from '../core/rng.ts';
import { checkInvariants } from '../engine/invariants.ts';
import type {
  BotLevel,
  CoachLevel,
  EngineInput,
  HandState,
  PersonalityId,
  PlayerAction,
  PlayerSlot,
  SeatStats,
  Street,
  TableConfig,
  TableState,
} from '../engine/types.ts';
import type { HandCategory } from '../eval/evaluate.ts';
import type { Grade, LeakId } from '../brain/types.ts';

// ---------------------------------------------------------------------------------------------
// Appendix A.7 (field names are normative; add a field only by updating A.7 first).

export interface Settings {
  schema: 1;
  botLevel: BotLevel;
  coachLevel: CoachLevel;
  /** Last-used Setup values (§12.2): players = seats (you + bots), 2..9. */
  players: number;
  startingStack: number;
  sb: number;
  bb: number;
  /** Per-seat bot level override, one per seat; [0] (the hero) is always null (§9.3). */
  seatLevels: (BotLevel | null)[];
  speed: 'normal' | 'fast' | 'instant';
  autoNext: boolean;
  amounts: 'chips' | 'bb';
  showEquity: boolean;
  fourColour: boolean;
  textSize: 'normal' | 'large';
  reduceMotion: 'system' | 'on' | 'off';
  keepAwake: boolean;
  sound: boolean;
  haptics: boolean;
  /** Wide-screen rankings column (§13.1); default 'open'. */
  handsPanel: 'open' | 'collapsed';
}

export interface DecisionRecord {
  decisionId: number;
  street: Street;
  taken: PlayerAction;
  rec: PlayerAction;
  /** null = grading failed twice (§11.3 r5); excluded from every decision metric. */
  grade: Grade | null;
  lossMilliBB: number;
  /**
   * The HUD win chance at the decision (§7), a fraction; null when the hero acted before its first
   * estimate, or the equity worker had failed (chunk 6.2).
   */
  eRandom: number | null;
  need: number | null;
  hintSeen: boolean;
  undone: boolean;
  leak: LeakId | null;
  quiz: { correct: number; of: number } | null;
}

export interface HandRecord {
  handSeq: number;
  /** ISO UTC. */
  at: string;
  seed: Seed128;
  commit: string | null;
  engineVersion: string;
  /** As at hand start. */
  table: TableState;
  /** The full replay log. */
  inputs: EngineInput[];
  heroHole: [Card, Card];
  board: Card[];
  net: number[];
  heroNetMilliBB: number;
  decisions: DecisionRecord[];
  assisted: boolean;
  undoCount: number;
  botLevel: BotLevel;
  coachLevel: CoachLevel;
  /** The hero's final category if they saw the river or the showdown. */
  bestCategory: HandCategory | null;
  allIn: { expected: number; actual: number; pot: number } | null;
}

/**
 * `pc.v1.hands` (§14.2, chunk 8.1): the last `HANDS_KEEP` (100) hand records, oldest first, one
 * per `handSeq`. Written at hand end before the profile (§14.3 step 1).
 */
export interface HandRing {
  schema: 1;
  hands: HandRecord[];
}

export interface ResultBucket {
  hands: number;
  handsWon: number;
  netChips: number;
  netMilliBB: number;
  vpipHands: number;
  pfrHands: number;
  sawFlop: number;
  wentToShowdown: number;
  wonAtShowdown: number;
  biggestPotWon: number;
  allInExpectedChips: number;
  allInActualChips: number;
}

export interface DecisionBucket {
  decisions: number;
  byGrade: Record<Grade, number>;
  lossMilliBB: number;
  own: number;
  ownBestOrGood: number;
  hintSeen: number;
  hintFollowed: number;
  undone: number;
  quizAsked: number;
  quizCorrect: number;
}

export interface SessionSummary {
  start: string;
  end: string;
  hands: number;
  netChips: number;
  decisionScore: number | null;
  mistakes: number;
  blunders: number;
  decisions: number;
  botLevel: BotLevel;
  coachLevel: CoachLevel;
  players: number;
  bb: number;
}

export interface Stats {
  schema: 1;
  firstPlayedAt: string | null;
  lastPlayedAt: string | null;
  sessions: number;
  reloads: number;
  results: {
    clean: ResultBucket;
    practice: ResultBucket;
    byBotLevel: Record<BotLevel, ResultBucket>;
  };
  decisions: {
    all: DecisionBucket;
    byCoachLevel: Record<CoachLevel, DecisionBucket>;
    byStreet: Record<Street, DecisionBucket>;
  };
  leaks: Partial<Record<LeakId, { count: number; lossMilliBB: number }>>;
  collection: Record<HandCategory, { count: number; first: string | null }>;
  streak: { current: number; best: number };
  /** Ring, 60. */
  recentSessions: SessionSummary[];
  /** Updated inside applyHand (atomic with the commit); moved to recentSessions when the session ends. */
  currentSession: SessionSummary | null;
  /** Ring, 500 (~25 KB); feeds the §10.4 level suggestions. */
  recentHands: RecentHand[];
}

export interface RecentHand {
  botLevel: BotLevel;
  coachLevel: CoachLevel;
  assisted: boolean;
  netMilliBB: number;
  /** Σ decision-score points (§14.4) of the hand's graded decisions. */
  scorePoints: number;
  /** Graded decisions in the hand. */
  graded: number;
}

export interface Profile {
  schema: 1;
  rev: number;
  lastCommittedHandSeq: number;
  createdAt: string;
  updatedAt: string;
  settings: Settings;
  stats: Stats;
  heroModel: SeatStats;
  persistGranted: boolean | null;
  flags: {
    tips: Record<string, boolean>;
    iosInstall: boolean;
    safariImport: boolean;
    offlineReady: boolean;
    suggestionSnoozedUntil: Record<'botsUp' | 'botsDown' | 'coachDown', string | null>;
  };
}

export interface HandMeta {
  decisions: DecisionRecord[];
  undoCount: number;
  hintShown: Record<number, boolean>;
}

export interface SessionState {
  schema: 1;
  savedAt: string;
  sessionStart: string;
  /** The table as at the start of `hand` (the hand replays from it; its stacks are the hand-start stacks, §14.5). */
  table: TableState;
  hand: HandState | null;
  handInputs: EngineInput[];
  meta: HandMeta;
  /** inputCount = handInputs.length at the snapshot. */
  undoSnapshot: { decisionId: number; state: HandState; meta: HandMeta; inputCount: number } | null;
  /** Index = seat; [0] mirrors profile.heroModel; reset to null when a bot is replaced (§9.5). */
  seatStats: (SeatStats | null)[];
  resumeAfterUpdate: boolean;
}

export type UndoSnapshot = NonNullable<SessionState['undoSnapshot']>;
export type ProfileFlags = Profile['flags'];

// ---------------------------------------------------------------------------------------------
// A tiny validation kit.

/**
 * A validator: null when `x` is a valid `T`, else the first problem found, with its path
 * ("profile.settings.players: expected a whole number from 2 to 9"). `T` exists for the type
 * checker only: `object<T>()` takes exactly one check per field of `T`, typed for that field, so a
 * guard cannot silently drift away from its interface.
 */
interface Check<T> {
  (x: unknown, path: string): string | null;
  /** Never set: it only carries `T`. */
  readonly __type?: T;
}

type Shape<T> = { readonly [K in keyof T]-?: Check<T[K]> };

const expected = (path: string, what: string): string => `${path}: expected ${what}`;

function isPlainObject(x: unknown): x is Record<string, unknown> {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return false;
  const proto: unknown = Object.getPrototypeOf(x);
  return proto === Object.prototype || proto === null;
}

const own = (x: Record<string, unknown>, key: string): unknown =>
  Object.hasOwn(x, key) ? x[key] : undefined;

const bool: Check<boolean> = (x, path) =>
  typeof x === 'boolean' ? null : expected(path, 'true or false');

const text: Check<string> = (x, path) =>
  typeof x === 'string' && x !== '' ? null : expected(path, 'a non-empty string');

function int(min = 0, max = Number.MAX_SAFE_INTEGER): Check<number> {
  return (x, path) =>
    Number.isSafeInteger(x) && (x as number) >= min && (x as number) <= max
      ? null
      : expected(path, `a whole number from ${min} to ${max}`);
}

/** A whole number ≥ 0 (counts, chips). */
const count = int();
/** Any safe whole number (signed sums such as net chips). */
const integer = int(Number.MIN_SAFE_INTEGER);

function num(min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY): Check<number> {
  return (x, path) =>
    typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max
      ? null
      : expected(path, `a number from ${min} to ${max}`);
}

function literal<const V extends string | number | boolean>(value: V): Check<V> {
  return (x, path) => (x === value ? null : expected(path, JSON.stringify(value)));
}

const member =
  <T extends string>(members: Readonly<Record<T, true>>) =>
  (x: unknown): x is T =>
    typeof x === 'string' && Object.hasOwn(members, x);

function oneOf<T extends string>(members: Readonly<Record<T, true>>): Check<T> {
  const is = member(members);
  const list = Object.keys(members).join(', ');
  return (x, path) => (is(x) ? null : expected(path, `one of ${list}`));
}

function nullable<T>(check: Check<T>): Check<T | null> {
  return (x, path) => (x === null ? null : check(x, path));
}

function array<T>(item: Check<T>, min = 0, max = Number.MAX_SAFE_INTEGER): Check<T[]> {
  return (x, path) => {
    if (!Array.isArray(x) || x.length < min || x.length > max) {
      return expected(
        path,
        max === Number.MAX_SAFE_INTEGER ? 'a list' : `a list of ${min} to ${max}`,
      );
    }
    // An index loop: a hole in a sparse array reads as undefined and fails its check.
    for (let i = 0; i < x.length; i++) {
      const problem = item(x[i], `${path}[${i}]`);
      if (problem !== null) return problem;
    }
    return null;
  };
}

function object<T>(shape: Shape<T>): Check<T> {
  const fields = Object.entries(shape) as [string, Check<unknown>][];
  return (x, path) => {
    if (!isPlainObject(x)) return expected(path, 'an object');
    for (const [key, check] of fields) {
      const problem = check(own(x, key), `${path}.${key}`);
      if (problem !== null) return problem;
    }
    return null;
  };
}

/** An object with every key of `keys`, each a valid V. */
function record<K extends string, V>(
  keys: Readonly<Record<K, true>>,
  value: Check<V>,
): Check<Record<K, V>> {
  const list = Object.keys(keys);
  return (x, path) => {
    if (!isPlainObject(x)) return expected(path, 'an object');
    for (const key of list) {
      const problem = value(own(x, key), `${path}.${key}`);
      if (problem !== null) return problem;
    }
    return null;
  };
}

/** An object whose keys are all in `keys` (any subset), each a valid V. */
function partialRecord<K extends string, V>(
  keys: Readonly<Record<K, true>>,
  value: Check<V>,
): Check<Partial<Record<K, V>>> {
  return (x, path) => {
    if (!isPlainObject(x)) return expected(path, 'an object');
    for (const key of Object.keys(x)) {
      if (!Object.hasOwn(keys, key)) return `${path}: unknown key "${key}"`;
      const problem = value(x[key], `${path}.${key}`);
      if (problem !== null) return problem;
    }
    return null;
  };
}

/** An object with any keys (`keyOk` filters them), each a valid V. */
function dict<V>(
  value: Check<V>,
  keyOk: (key: string) => boolean = () => true,
): Check<Record<string, V>> {
  return (x, path) => {
    if (!isPlainObject(x)) return expected(path, 'an object');
    for (const key of Object.keys(x)) {
      if (!keyOk(key)) return `${path}: unexpected key "${key}"`;
      const problem = value(x[key], `${path}.${key}`);
      if (problem !== null) return problem;
    }
    return null;
  };
}

/** Runs `extra` (cross-field rules) once `check` has passed. */
function refine<T>(check: Check<T>, extra: (value: T, path: string) => string | null): Check<T> {
  return (x, path) => check(x, path) ?? extra(x as T, path);
}

// ---------------------------------------------------------------------------------------------
// Unions (see the file comment on why they are listed again) and leaf checks.

const BOT_LEVEL: Readonly<Record<BotLevel, true>> = {
  easy: true,
  medium: true,
  hard: true,
  expert: true,
};
const COACH_LEVEL: Readonly<Record<CoachLevel, true>> = {
  beginner: true,
  intermediate: true,
  advanced: true,
  exam: true,
};
const STREET: Readonly<Record<Street, true>> = {
  preflop: true,
  flop: true,
  turn: true,
  river: true,
};
const PERSONALITY: Readonly<Record<PersonalityId, true>> = {
  rock: true,
  tag: true,
  lag: true,
  station: true,
  maniac: true,
};
const HAND_CATEGORY: Readonly<Record<HandCategory, true>> = {
  highCard: true,
  pair: true,
  twoPair: true,
  trips: true,
  straight: true,
  flush: true,
  fullHouse: true,
  quads: true,
  straightFlush: true,
  royalFlush: true,
};
const GRADE: Readonly<Record<Grade, true>> = {
  best: true,
  good: true,
  inaccuracy: true,
  mistake: true,
  blunder: true,
};
const LEAK: Readonly<Record<LeakId, true>> = {
  'open-loose': true,
  'open-tight': true,
  limp: true,
  'call-pre-wide': true,
  'fold-pre-much': true,
  pushfold: true,
  'missed-value': true,
  'bluff-much': true,
  overfold: true,
  chase: true,
  'river-call': true,
  'call-light': true,
  sizing: true,
};
const SNOOZE: Readonly<Record<keyof ProfileFlags['suggestionSnoozedUntil'], true>> = {
  botsUp: true,
  botsDown: true,
  coachDown: true,
};

export const isBotLevel = member(BOT_LEVEL);
export const isCoachLevel = member(COACH_LEVEL);
export const isStreet = member(STREET);
export const isPersonalityId = member(PERSONALITY);
export const isHandCategory = member(HAND_CATEGORY);
export const isGrade = member(GRADE);
export const isLeakId = member(LEAK);

const botLevel = oneOf(BOT_LEVEL);
const coachLevel = oneOf(COACH_LEVEL);
const street = oneOf(STREET);

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/** A UTC ISO time as `Date.prototype.toISOString` writes it ("2026-09-28T10:00:00.000Z"). */
export function isIsoDate(x: unknown): x is string {
  return typeof x === 'string' && ISO_UTC.test(x) && !Number.isNaN(Date.parse(x));
}

const isoDate: Check<string> = (x, path) =>
  isIsoDate(x) ? null : expected(path, 'a UTC ISO time such as 2026-09-28T10:00:00.000Z');

const seed: Check<Seed128> = (x, path) =>
  isSeed128(x) ? null : expected(path, '32 lowercase hex characters');

const card: Check<Card> = (x, path) => (isCard(x) ? null : expected(path, 'a card from 0 to 51'));

const holeCards: Check<[Card, Card]> = (x, path) => {
  if (!Array.isArray(x) || x.length !== 2) return expected(path, 'two cards');
  return card(x[0], `${path}[0]`) ?? card(x[1], `${path}[1]`);
};

const pair: Check<[number, number]> = (x, path) => {
  if (!Array.isArray(x) || x.length !== 2) return expected(path, 'a pair of whole numbers');
  return count(x[0], `${path}[0]`) ?? count(x[1], `${path}[1]`);
};

/** §3.2 limits. */
const MAX_SEATS = 9;
const MIN_BB = 2;
const MAX_BB = 100_000;
const MIN_STACK = 200;
const MAX_STACK = 1_000_000;
const MIN_DEPTH_BB = 10;
const MAX_DEPTH_BB = 500;

const seatCount = int(2, MAX_SEATS);
const seatIndex = int(0, MAX_SEATS - 1);
const bigBlind = int(MIN_BB, MAX_BB);
const smallBlind = int(MIN_BB / 2, MAX_BB / 2);
const startingStack = int(MIN_STACK, MAX_STACK);
const seatLevels = array(nullable(botLevel), 2, MAX_SEATS);

/** §3.2: bb even, sb = bb / 2, and a starting stack of 10 to 500 big blinds. */
function stakesProblem(sb: number, bb: number, stack: number, path: string): string | null {
  if (bb % 2 !== 0) return expected(`${path}.bb`, 'an even number');
  if (sb * 2 !== bb) return expected(`${path}.sb`, `half the big blind (${bb / 2})`);
  if (stack < MIN_DEPTH_BB * bb || stack > MAX_DEPTH_BB * bb) {
    return expected(
      `${path}.startingStack`,
      `${MIN_DEPTH_BB} to ${MAX_DEPTH_BB} big blinds (${MIN_DEPTH_BB * bb} to ${MAX_DEPTH_BB * bb})`,
    );
  }
  return null;
}

/** One level per seat; the hero's (seat 0) is always null (§9.3). */
function seatLevelsProblem(levels: readonly unknown[], seats: number, path: string): string | null {
  if (levels.length !== seats) return expected(path, `${seats} entries, one per seat`);
  return levels[0] === null ? null : expected(`${path}[0]`, 'null (seat 0 is the hero)');
}

// ---------------------------------------------------------------------------------------------
// Engine states that persist stores (Appendix A.3). `TableState` is checked here, written from the
// PLAN text (§3.2, §9.3); a `HandState` is checked by `checkInvariants` (I0 is "well-formed").

const betTo = int(1);

const playerAction: Check<PlayerAction> = (x, path) => {
  if (!isPlainObject(x)) return expected(path, 'an action');
  switch (x.type) {
    case 'fold':
    case 'check':
    case 'call':
      return null;
    case 'bet':
    case 'raise':
      return betTo(x.to, `${path}.to`);
    default:
      return expected(`${path}.type`, 'fold, check, call, bet or raise');
  }
};

const engineInput: Check<EngineInput> = (x, path) => {
  if (!isPlainObject(x)) return expected(path, 'an engine input');
  switch (x.kind) {
    case 'act':
      return seatIndex(x.seat, `${path}.seat`) ?? playerAction(x.action, `${path}.action`);
    case 'advance':
      return null;
    case 'reshuffle':
      return count(x.decisionId, `${path}.decisionId`) ?? count(x.undoIndex, `${path}.undoIndex`);
    default:
      return expected(`${path}.kind`, 'act, advance or reshuffle');
  }
};

function inputSeatsProblem(
  inputs: readonly EngineInput[],
  seats: number,
  path: string,
): string | null {
  const i = inputs.findIndex((input) => input.kind === 'act' && input.seat >= seats);
  return i < 0 ? null : expected(`${path}[${i}].seat`, `a seat below ${seats}`);
}

const tableConfig: Check<TableConfig> = refine(
  object<TableConfig>({
    seatCount,
    sb: smallBlind,
    bb: bigBlind,
    startingStack,
    botLevel,
    seatLevels,
  }),
  (c, path) =>
    stakesProblem(c.sb, c.bb, c.startingStack, path) ??
    seatLevelsProblem(c.seatLevels, c.seatCount, `${path}.seatLevels`),
);

const playerSlot: Check<PlayerSlot> = object<PlayerSlot>({
  playerId: text,
  name: text,
  kind: oneOf<PlayerSlot['kind']>({ hero: true, bot: true }),
  personality: nullable(oneOf(PERSONALITY)),
  stack: count,
});

/** Seat 0 is the hero, the others bots; ids and names unique; stacks add up safely (§3.1, §9.3). */
function tableProblemOf(t: TableState, path: string): string | null {
  const n = t.config.seatCount;
  if (t.slots.length !== n) return expected(`${path}.slots`, `${n} seats (config.seatCount)`);
  if (t.button >= n) return expected(`${path}.button`, `-1 or a seat below ${n}`);
  if (t.prevBB !== null && t.prevBB >= n) return expected(`${path}.prevBB`, `a seat below ${n}`);
  const ids = new Set<string>();
  const names = new Set<string>();
  let total = 0;
  for (let i = 0; i < n; i++) {
    const slot = t.slots[i] as PlayerSlot;
    const at = `${path}.slots[${i}]`;
    const ok =
      i === 0
        ? slot.kind === 'hero' && slot.personality === null
        : slot.kind === 'bot' && slot.personality !== null;
    if (!ok)
      return expected(at, i === 0 ? 'the hero, with no personality' : 'a bot with a personality');
    if (ids.has(slot.playerId)) return `${at}.playerId: "${slot.playerId}" is used twice`;
    if (names.has(slot.name)) return `${at}.name: "${slot.name}" is used twice`;
    ids.add(slot.playerId);
    names.add(slot.name);
    total += slot.stack;
  }
  return Number.isSafeInteger(total)
    ? null
    : `${path}.slots: the stacks add up past a safe integer`;
}

const tableState: Check<TableState> = refine(
  object<TableState>({
    schema: literal(1),
    engineVersion: text,
    tableId: text,
    tableSeed: seed,
    config: tableConfig,
    slots: array(playerSlot, 2, MAX_SEATS),
    button: int(-1, MAX_SEATS - 1),
    prevBB: nullable(seatIndex),
    nextHandSeq: int(1),
    handsDealt: count,
    personalityCursor: count,
    nameCursor: count,
    reloads: count,
  }),
  tableProblemOf,
);

/** `checkInvariants` (§4.4) on anything: I0 reports a malformed state, so this never throws. */
const handState: Check<HandState> = (x, path) => {
  try {
    checkInvariants(x as HandState);
    return null;
  } catch (e) {
    return `${path}: ${e instanceof InvariantError ? e.broken.join('; ') : String(e)}`;
  }
};

const seatStats: Check<SeatStats> = object<SeatStats>({
  hands: count,
  vpip: pair,
  pfr: pair,
  threeBet: pair,
  foldTo3bet: pair,
  cbet: pair,
  foldToCbet: pair,
  wtsd: pair,
  aggActions: count,
  passiveActions: count,
});

// ---------------------------------------------------------------------------------------------
// A.7 checks.

const decisionRecord: Check<DecisionRecord> = object<DecisionRecord>({
  decisionId: count,
  street,
  taken: playerAction,
  rec: playerAction,
  grade: nullable(oneOf(GRADE)),
  lossMilliBB: integer,
  eRandom: nullable(num()),
  need: nullable(num()),
  hintSeen: bool,
  undone: bool,
  leak: nullable(oneOf(LEAK)),
  quiz: nullable(object<NonNullable<DecisionRecord['quiz']>>({ correct: count, of: count })),
});

const INDEX_KEY = /^(?:0|[1-9]\d{0,14})$/;

const handMeta: Check<HandMeta> = object<HandMeta>({
  decisions: array(decisionRecord),
  undoCount: count,
  hintShown: dict(bool, (key) => INDEX_KEY.test(key)),
});

const handRecord: Check<HandRecord> = refine(
  object<HandRecord>({
    handSeq: int(1),
    at: isoDate,
    seed,
    commit: nullable(text),
    engineVersion: text,
    table: tableState,
    inputs: array(engineInput),
    heroHole: holeCards,
    board: array(card, 0, 5),
    net: array(integer, 2, MAX_SEATS),
    heroNetMilliBB: integer,
    decisions: array(decisionRecord),
    assisted: bool,
    undoCount: count,
    botLevel,
    coachLevel,
    bestCategory: nullable(oneOf(HAND_CATEGORY)),
    allIn: nullable(
      object<NonNullable<HandRecord['allIn']>>({ expected: num(), actual: num(), pot: count }),
    ),
  }),
  (r, path) => {
    const n = r.table.config.seatCount;
    if (r.net.length !== n) return expected(`${path}.net`, `${n} numbers, one per seat`);
    const cards = [...r.heroHole, ...r.board];
    if (new Set(cards).size !== cards.length) return `${path}: a card appears twice`;
    return inputSeatsProblem(r.inputs, n, `${path}.inputs`);
  },
);

/** The ring's version and list; each record has its own check (`handRecord`). */
const handRing: Check<{ schema: 1; hands: unknown[] }> = object<{ schema: 1; hands: unknown[] }>({
  schema: literal(1),
  hands: array<unknown>(() => null),
});

const resultBucket: Check<ResultBucket> = object<ResultBucket>({
  hands: count,
  handsWon: count,
  netChips: integer,
  netMilliBB: integer,
  vpipHands: count,
  pfrHands: count,
  sawFlop: count,
  wentToShowdown: count,
  wonAtShowdown: count,
  biggestPotWon: count,
  allInExpectedChips: num(),
  allInActualChips: num(),
});

const decisionBucket: Check<DecisionBucket> = object<DecisionBucket>({
  decisions: count,
  byGrade: record(GRADE, count),
  lossMilliBB: integer,
  own: count,
  ownBestOrGood: count,
  hintSeen: count,
  hintFollowed: count,
  undone: count,
  quizAsked: count,
  quizCorrect: count,
});

const sessionSummary: Check<SessionSummary> = object<SessionSummary>({
  start: isoDate,
  end: isoDate,
  hands: count,
  netChips: integer,
  decisionScore: nullable(num(0, 100)),
  mistakes: count,
  blunders: count,
  decisions: count,
  botLevel,
  coachLevel,
  players: seatCount,
  bb: bigBlind,
});

const recentHand: Check<RecentHand> = object<RecentHand>({
  botLevel,
  coachLevel,
  assisted: bool,
  netMilliBB: integer,
  scorePoints: count,
  graded: count,
});

const stats: Check<Stats> = object<Stats>({
  schema: literal(1),
  firstPlayedAt: nullable(isoDate),
  lastPlayedAt: nullable(isoDate),
  sessions: count,
  reloads: count,
  results: object<Stats['results']>({
    clean: resultBucket,
    practice: resultBucket,
    byBotLevel: record(BOT_LEVEL, resultBucket),
  }),
  decisions: object<Stats['decisions']>({
    all: decisionBucket,
    byCoachLevel: record(COACH_LEVEL, decisionBucket),
    byStreet: record(STREET, decisionBucket),
  }),
  leaks: partialRecord(
    LEAK,
    object<{ count: number; lossMilliBB: number }>({ count, lossMilliBB: integer }),
  ),
  collection: record(
    HAND_CATEGORY,
    object<{ count: number; first: string | null }>({ count, first: nullable(isoDate) }),
  ),
  streak: object<Stats['streak']>({ current: count, best: count }),
  recentSessions: array(sessionSummary),
  currentSession: nullable(sessionSummary),
  recentHands: array(recentHand),
});

const settings: Check<Settings> = refine(
  object<Settings>({
    schema: literal(1),
    botLevel,
    coachLevel,
    players: seatCount,
    startingStack,
    sb: smallBlind,
    bb: bigBlind,
    seatLevels,
    speed: oneOf<Settings['speed']>({ normal: true, fast: true, instant: true }),
    autoNext: bool,
    amounts: oneOf<Settings['amounts']>({ chips: true, bb: true }),
    showEquity: bool,
    fourColour: bool,
    textSize: oneOf<Settings['textSize']>({ normal: true, large: true }),
    reduceMotion: oneOf<Settings['reduceMotion']>({ system: true, on: true, off: true }),
    keepAwake: bool,
    sound: bool,
    haptics: bool,
    handsPanel: oneOf<Settings['handsPanel']>({ open: true, collapsed: true }),
  }),
  (s, path) =>
    stakesProblem(s.sb, s.bb, s.startingStack, path) ??
    seatLevelsProblem(s.seatLevels, s.players, `${path}.seatLevels`),
);

const flags: Check<ProfileFlags> = object<ProfileFlags>({
  tips: dict(bool),
  iosInstall: bool,
  safariImport: bool,
  offlineReady: bool,
  suggestionSnoozedUntil: record(SNOOZE, nullable(isoDate)),
});

const profile: Check<Profile> = object<Profile>({
  schema: literal(1),
  rev: count,
  lastCommittedHandSeq: count,
  createdAt: isoDate,
  updatedAt: isoDate,
  settings,
  stats,
  heroModel: seatStats,
  persistGranted: nullable(bool),
  flags,
});

/**
 * The session's hand belongs to its table as at hand start (§14.5): same seats, blinds and
 * handSeq, and every `startStacks[i]` is the table's stack for seat i. That is what lets a void
 * return the chips: the table's stacks are the hand-start stacks.
 */
function handMatchesTable(h: HandState, t: TableState, path: string): string | null {
  if (h.seats.length !== t.config.seatCount) {
    return `${path}: ${h.seats.length} seats, but the table has ${t.config.seatCount}`;
  }
  if (h.handSeq !== t.nextHandSeq) {
    return `${path}.handSeq: ${h.handSeq}, but the table's nextHandSeq is ${t.nextHandSeq}`;
  }
  if (h.sb !== t.config.sb || h.bb !== t.config.bb) {
    return `${path}: blinds ${h.sb}/${h.bb}, but the table has ${t.config.sb}/${t.config.bb}`;
  }
  const seat = h.startStacks.findIndex((stack, i) => stack !== t.slots[i]?.stack);
  if (seat >= 0) {
    return `${path}.startStacks[${seat}]: ${h.startStacks[seat]}, but the table's seat has ${t.slots[seat]?.stack} (the table must be as at hand start)`;
  }
  return null;
}

const undoSnapshot: Check<UndoSnapshot> = object<UndoSnapshot>({
  decisionId: count,
  state: handState,
  meta: handMeta,
  inputCount: count,
});

const sessionState: Check<SessionState> = refine(
  object<SessionState>({
    schema: literal(1),
    savedAt: isoDate,
    sessionStart: isoDate,
    table: tableState,
    hand: nullable(handState),
    handInputs: array(engineInput),
    meta: handMeta,
    undoSnapshot: nullable(undoSnapshot),
    seatStats: array(nullable(seatStats), 2, MAX_SEATS),
    resumeAfterUpdate: bool,
  }),
  (s, path) => {
    const n = s.table.config.seatCount;
    if (s.seatStats.length !== n)
      return expected(`${path}.seatStats`, `${n} entries, one per seat`);
    const inputs = inputSeatsProblem(s.handInputs, n, `${path}.handInputs`);
    if (inputs !== null) return inputs;
    if (s.hand !== null) {
      const problem = handMatchesTable(s.hand, s.table, `${path}.hand`);
      if (problem !== null) return problem;
    }
    const snap = s.undoSnapshot;
    if (snap === null) return null;
    if (s.hand === null) return expected(`${path}.undoSnapshot`, 'null when there is no hand');
    if (snap.inputCount > s.handInputs.length) {
      return expected(
        `${path}.undoSnapshot.inputCount`,
        `at most ${s.handInputs.length} (handInputs.length)`,
      );
    }
    return handMatchesTable(snap.state, s.table, `${path}.undoSnapshot.state`);
  },
);

// ---------------------------------------------------------------------------------------------
// Exported guards: `isX` narrows; `xProblem` says why not (null = valid).

export const isSettings = (x: unknown): x is Settings => settings(x, 'settings') === null;
export const settingsProblem = (x: unknown): string | null => settings(x, 'settings');
export const isProfile = (x: unknown): x is Profile => profile(x, 'profile') === null;
export const profileProblem = (x: unknown): string | null => profile(x, 'profile');
export const isStats = (x: unknown): x is Stats => stats(x, 'stats') === null;
export const isSeatStats = (x: unknown): x is SeatStats => seatStats(x, 'seatStats') === null;
export const isDecisionRecord = (x: unknown): x is DecisionRecord =>
  decisionRecord(x, 'decision') === null;
export const isHandMeta = (x: unknown): x is HandMeta => handMeta(x, 'meta') === null;
export const isHandRecord = (x: unknown): x is HandRecord => handRecord(x, 'record') === null;
export const handRecordProblem = (x: unknown): string | null => handRecord(x, 'record');
/**
 * The `pc.v1.hands` wrapper (A.7 `HandRing`): its version and a list. The records are checked one
 * by one (`handRecordProblem`), so one damaged record does not cost the others.
 */
export const handRingProblem = (x: unknown): string | null => handRing(x, 'hands');
export const isTableState = (x: unknown): x is TableState => tableState(x, 'table') === null;
export const tableStateProblem = (x: unknown): string | null => tableState(x, 'table');
export const isEngineInput = (x: unknown): x is EngineInput => engineInput(x, 'input') === null;
/** The whole session: its shape, `checkInvariants` on both hand states, and hand ↔ table. */
export const isSessionState = (x: unknown): x is SessionState =>
  sessionState(x, 'session') === null;
export const sessionStateProblem = (x: unknown): string | null => sessionState(x, 'session');

// ---------------------------------------------------------------------------------------------
// Schema defaults. Each call returns fresh objects (callers may change them).

/** The first-launch settings (§12.1 Welcome, §3.2): you + 5 bots, 2,000 chips, 10/20, Easy, Beginner. */
export function defaultSettings(): Settings {
  return {
    schema: 1,
    botLevel: 'easy',
    coachLevel: 'beginner',
    players: 6,
    startingStack: 2000,
    sb: 10,
    bb: 20,
    seatLevels: [null, null, null, null, null, null],
    speed: 'normal',
    autoNext: true,
    amounts: 'chips',
    showEquity: true,
    fourColour: true,
    textSize: 'normal',
    reduceMotion: 'system',
    keepAwake: true,
    sound: true,
    haptics: true,
    handsPanel: 'open',
  };
}

export function emptySeatStats(): SeatStats {
  return {
    hands: 0,
    vpip: [0, 0],
    pfr: [0, 0],
    threeBet: [0, 0],
    foldTo3bet: [0, 0],
    cbet: [0, 0],
    foldToCbet: [0, 0],
    wtsd: [0, 0],
    aggActions: 0,
    passiveActions: 0,
  };
}

export function emptyResultBucket(): ResultBucket {
  return {
    hands: 0,
    handsWon: 0,
    netChips: 0,
    netMilliBB: 0,
    vpipHands: 0,
    pfrHands: 0,
    sawFlop: 0,
    wentToShowdown: 0,
    wonAtShowdown: 0,
    biggestPotWon: 0,
    allInExpectedChips: 0,
    allInActualChips: 0,
  };
}

const fill = <K extends string, V>(keys: Readonly<Record<K, true>>, make: () => V): Record<K, V> =>
  Object.fromEntries(Object.keys(keys).map((key) => [key, make()])) as Record<K, V>;

export function emptyDecisionBucket(): DecisionBucket {
  return {
    decisions: 0,
    byGrade: fill(GRADE, () => 0),
    lossMilliBB: 0,
    own: 0,
    ownBestOrGood: 0,
    hintSeen: 0,
    hintFollowed: 0,
    undone: 0,
    quizAsked: 0,
    quizCorrect: 0,
  };
}

export function emptyStats(): Stats {
  return {
    schema: 1,
    firstPlayedAt: null,
    lastPlayedAt: null,
    sessions: 0,
    reloads: 0,
    results: {
      clean: emptyResultBucket(),
      practice: emptyResultBucket(),
      byBotLevel: fill(BOT_LEVEL, emptyResultBucket),
    },
    decisions: {
      all: emptyDecisionBucket(),
      byCoachLevel: fill(COACH_LEVEL, emptyDecisionBucket),
      byStreet: fill(STREET, emptyDecisionBucket),
    },
    leaks: {},
    collection: fill(HAND_CATEGORY, () => ({ count: 0, first: null })),
    streak: { current: 0, best: 0 },
    recentSessions: [],
    currentSession: null,
    recentHands: [],
  };
}

export function defaultFlags(): ProfileFlags {
  return {
    tips: {},
    iosInstall: false,
    safariImport: false,
    offlineReady: false,
    suggestionSnoozedUntil: fill(SNOOZE, () => null),
  };
}

/** A new profile: default settings, empty stats, nothing committed yet (rev 0). */
export function defaultProfile(now: Date): Profile {
  const at = now.toISOString();
  return {
    schema: 1,
    rev: 0,
    lastCommittedHandSeq: 0,
    createdAt: at,
    updatedAt: at,
    settings: defaultSettings(),
    stats: emptyStats(),
    heroModel: emptySeatStats(),
    persistGranted: null,
    flags: defaultFlags(),
  };
}

export function emptyHandMeta(): HandMeta {
  return { decisions: [], undoCount: 0, hintShown: {} };
}

// ---------------------------------------------------------------------------------------------

export type Parsed = { ok: true; value: unknown } | { ok: false; problem: string };

/** `JSON.parse` that never throws (§14.6 rule 1). */
export function parseJson(raw: string): Parsed {
  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch (e) {
    return { ok: false, problem: `not valid JSON (${e instanceof Error ? e.message : String(e)})` };
  }
}
