/**
 * The table between hands (PLAN §3.1–§3.3, §4.2, §9.3): creating it, seating the bots, choosing
 * each hand's button, and moving from one hand to the next.
 *
 * Every function is pure: it returns a new `TableState` and never changes its inputs. Bad input
 * throws `EngineError`: `BAD_AMOUNT` for a number out of range (seat count, blinds, stacks,
 * seats), `ILLEGAL_ACTION` for an invalid choice (slot kind, personality, level, name, seed) and
 * `BAD_PHASE` when the call does not fit the state (a hand that is not over, or not from this
 * table; fewer than two players with chips).
 */
import { EngineError } from '../core/assert.ts';
import {
  deriveSeed,
  isSeed128,
  randInt,
  rngFromSeed,
  shuffleRange,
  type Seed128,
} from '../core/rng.ts';
import { checkInvariants } from './invariants.ts';
import { nextSeat } from './rules.ts';
import {
  BOT_LEVELS,
  ENGINE_VERSION,
  PERSONALITY_IDS,
  type BotLevel,
  type HandState,
  type PersonalityId,
  type PlayerSlot,
  type TableConfig,
  type TableState,
} from './types.ts';

/**
 * The 24 bot names (§9.3): short, neutral, no real public figures. Proper names are not
 * translated, and the engine picks them in `nextTable`, so they live here and not in `i18n`.
 */
export const BOT_NAMES: readonly string[] = [
  'Anna', 'Ben', 'Carla', 'Dev', 'Emeka', 'Fatima', 'Gus', 'Hana', 'Ivan', 'Jade', 'Kofi', 'Lena',
  'Mateo', 'Nora', 'Omar', 'Priya', 'Quinn', 'Rosa', 'Sam', 'Tariq', 'Uma', 'Viktor', 'Wen', 'Yara',
]; // prettier-ignore

/** §9.3 table mix: the personality list of each bot level (entry `personalityCursor mod 8`). */
export const PERSONALITY_LISTS: Readonly<Record<BotLevel, readonly PersonalityId[]>> = {
  easy: ['station', 'station', 'maniac', 'station', 'rock', 'station', 'lag', 'station'],
  medium: ['tag', 'station', 'lag', 'rock', 'station', 'maniac', 'tag', 'station'],
  hard: ['tag', 'lag', 'rock', 'tag', 'lag', 'station', 'tag', 'rock'],
  expert: ['tag', 'lag', 'tag', 'lag', 'tag', 'rock', 'lag', 'tag'],
};

const MAX_BB = 100_000;
const MIN_STACK = 200;
const MAX_STACK = 1_000_000;

const isSafeInt = (x: unknown): x is number => Number.isSafeInteger(x);
const isBotLevel = (x: unknown): x is BotLevel => BOT_LEVELS.includes(x as BotLevel);

function badAmount(detail: string): never {
  throw new EngineError('BAD_AMOUNT', detail);
}
function illegal(detail: string): never {
  throw new EngineError('ILLEGAL_ACTION', detail);
}

/** The table's name order: Fisher–Yates of `BOT_NAMES` with the table seed's 'names' stream. */
export function nameOrder(tableSeed: Seed128): string[] {
  const names = [...BOT_NAMES];
  shuffleRange(names, 0, names.length - 1, rngFromSeed(deriveSeed(tableSeed, 'names')));
  return names;
}

/** The level that decides a seat's bot: its override, else the table level (§9.3). */
function seatLevel(cfg: TableConfig, seat: number): BotLevel {
  return cfg.seatLevels[seat] ?? cfg.botLevel;
}

function personalityFor(cfg: TableConfig, seat: number, cursor: number): PersonalityId {
  return PERSONALITY_LISTS[seatLevel(cfg, seat)][cursor % 8] as PersonalityId;
}

function checkLevels(seatCount: number, botLevel: unknown, seatLevels: unknown): void {
  if (!isBotLevel(botLevel)) illegal(`unknown bot level ${String(botLevel)}`);
  if (!Array.isArray(seatLevels) || seatLevels.length !== seatCount) {
    illegal(`seatLevels must have one entry per seat (${seatCount})`);
  }
  if (seatLevels[0] !== null) illegal('seatLevels[0] is the hero and must be null');
  seatLevels.forEach((level: unknown, i) => {
    if (level !== null && !isBotLevel(level)) {
      illegal(`unknown level ${String(level)} at seat ${i}`);
    }
  });
}

/** §3.2: seat count, blinds and starting stack. */
function checkConfig(cfg: TableConfig): void {
  const { seatCount, sb, bb, startingStack } = cfg;
  if (!isSafeInt(seatCount) || seatCount < 2 || seatCount > 9) {
    badAmount(`seatCount must be 2 to 9, got ${seatCount}`);
  }
  if (!isSafeInt(bb) || bb < 2 || bb > MAX_BB || bb % 2 !== 0) {
    badAmount(`the big blind must be an even number from 2 to ${MAX_BB}, got ${bb}`);
  }
  if (sb !== bb / 2) badAmount(`the small blind must be half the big blind, got ${sb}/${bb}`);
  if (!isSafeInt(startingStack) || startingStack < MIN_STACK || startingStack > MAX_STACK) {
    badAmount(`startingStack must be ${MIN_STACK} to ${MAX_STACK}, got ${startingStack}`);
  }
  if (startingStack < 10 * bb || startingStack > 500 * bb) {
    badAmount(`startingStack must be 10 to 500 big blinds, got ${startingStack} with bb ${bb}`);
  }
  checkLevels(seatCount, cfg.botLevel, cfg.seatLevels);
}

/**
 * Slot 0 is the hero, the rest are bots; ids and names are unique; stacks are whole numbers ≥ 0.
 * (Between hands a table may have a single player with chips: a hero who busted heads-up waits
 * for a reload. `createTable` and `startHand` ask for two.)
 */
function checkSlots(slots: readonly PlayerSlot[], seatCount: number): void {
  if (!Array.isArray(slots) || slots.length !== seatCount) {
    badAmount(`expected ${seatCount} slots, got ${Array.isArray(slots) ? slots.length : 'none'}`);
  }
  const ids = new Set<string>();
  const names = new Set<string>();
  let total = 0;
  slots.forEach((slot, i) => {
    if (i === 0 ? slot.kind !== 'hero' || slot.personality !== null : slot.kind !== 'bot') {
      illegal(`seat ${i} must be ${i === 0 ? 'the hero, with no personality' : 'a bot'}`);
    }
    if (i > 0 && !PERSONALITY_IDS.includes(slot.personality as PersonalityId)) {
      illegal(`seat ${i} has no valid personality`);
    }
    if (typeof slot.playerId !== 'string' || slot.playerId === '' || ids.has(slot.playerId)) {
      illegal(`seat ${i}: playerId must be unique and not empty`);
    }
    if (typeof slot.name !== 'string' || slot.name === '' || names.has(slot.name)) {
      illegal(`seat ${i}: name must be unique and not empty`);
    }
    ids.add(slot.playerId);
    names.add(slot.name);
    if (!isSafeInt(slot.stack) || slot.stack < 0) {
      badAmount(`seat ${i}: stack must be a whole number ≥ 0, got ${slot.stack}`);
    }
    total += slot.stack;
  });
  if (!isSafeInt(total)) badAmount('the stacks add up to more than a safe integer');
}

/**
 * Throws `EngineError` unless `table` is usable: a valid config (§3.2), a hero and bots with
 * unique ids and names, whole-number stacks, and the button, cursors and counters in range. Every
 * function here checks its input table with it; `startHand` does too.
 */
export function validateTable(table: TableState): void {
  checkConfig(table.config);
  checkSlots(table.slots, table.config.seatCount);
  if (!isSeed128(table.tableSeed)) illegal('tableSeed must be 32 lowercase hex characters');
  const n = table.config.seatCount;
  if (!isSafeInt(table.button) || table.button < -1 || table.button >= n) {
    badAmount(`button must be -1 or a seat, got ${table.button}`);
  }
  if (
    table.prevBB !== null &&
    (!isSafeInt(table.prevBB) || table.prevBB < 0 || table.prevBB >= n)
  ) {
    badAmount(`prevBB must be null or a seat, got ${table.prevBB}`);
  }
  if (!isSafeInt(table.nextHandSeq) || table.nextHandSeq < 1) {
    badAmount(`nextHandSeq must be ≥ 1, got ${table.nextHandSeq}`);
  }
  for (const key of ['handsDealt', 'personalityCursor', 'nameCursor', 'reloads'] as const) {
    if (!isSafeInt(table[key]) || table[key] < 0) {
      badAmount(`${key} must be ≥ 0, got ${table[key]}`);
    }
  }
}

const copyConfig = (cfg: TableConfig): TableConfig => ({
  seatCount: cfg.seatCount,
  sb: cfg.sb,
  bb: cfg.bb,
  startingStack: cfg.startingStack,
  botLevel: cfg.botLevel,
  seatLevels: [...cfg.seatLevels],
});

const copySlot = (slot: PlayerSlot): PlayerSlot => ({
  playerId: slot.playerId,
  name: slot.name,
  kind: slot.kind,
  personality: slot.personality,
  stack: slot.stack,
});

/** A fresh copy of every field (nothing shared with the input), stamped with this engine. */
const copyTable = (table: TableState): TableState => ({
  schema: 1,
  engineVersion: ENGINE_VERSION,
  tableId: table.tableId,
  tableSeed: table.tableSeed,
  config: copyConfig(table.config),
  slots: table.slots.map(copySlot),
  button: table.button,
  prevBB: table.prevBB,
  nextHandSeq: table.nextHandSeq,
  handsDealt: table.handsDealt,
  personalityCursor: table.personalityCursor,
  nameCursor: table.nameCursor,
  reloads: table.reloads,
});

/**
 * The players of a new table (§9.3): the hero in seat 0, then one bot per seat, each with the
 * starting stack. Bot `i` (seat i + 1) takes name `i` of the table's name order, id `bot-i`, and
 * entry `i` of its seat level's personality list, so `createTable` leaves both cursors at
 * `seatCount − 1`. `heroName` comes from `i18n` (the hero is always "You", Appendix F.10).
 */
export function initialSlots(cfg: TableConfig, tableSeed: Seed128, heroName: string): PlayerSlot[] {
  checkConfig(cfg);
  if (!isSeed128(tableSeed)) illegal('tableSeed must be 32 lowercase hex characters');
  if (typeof heroName !== 'string' || heroName === '') illegal('the hero needs a name');
  const names = nameOrder(tableSeed);
  const slots: PlayerSlot[] = [
    { playerId: 'hero', name: heroName, kind: 'hero', personality: null, stack: cfg.startingStack },
  ];
  for (let seat = 1; seat < cfg.seatCount; seat++) {
    const cursor = seat - 1;
    slots.push({
      playerId: `bot-${cursor}`,
      name: names[cursor] as string,
      kind: 'bot',
      personality: personalityFor(cfg, seat, cursor),
      stack: cfg.startingStack,
    });
  }
  return slots;
}

/**
 * A new table (§3.1–§3.2, §9.3). `slots` are the players, index = seat (usually
 * `initialSlots(cfg, tableSeed, heroName)`; tests pass their own stacks), and at least two need
 * chips. The first hand's button is drawn from the table seed by `startHand`; until then
 * `button` is −1. Throws `EngineError('BAD_AMOUNT')` when the stakes break §3.2.
 */
export function createTable(cfg: TableConfig, slots: PlayerSlot[], tableSeed: Seed128): TableState {
  checkConfig(cfg);
  checkSlots(slots, cfg.seatCount);
  if (slots.filter((slot) => slot.stack > 0).length < 2) badAmount('two players need chips');
  if (!isSeed128(tableSeed)) illegal('tableSeed must be 32 lowercase hex characters');
  return {
    schema: 1,
    engineVersion: ENGINE_VERSION,
    tableId: deriveSeed(tableSeed, 'id').slice(0, 8),
    tableSeed,
    config: copyConfig(cfg),
    slots: slots.map(copySlot),
    button: -1,
    prevBB: null,
    nextHandSeq: 1,
    handsDealt: 0,
    personalityCursor: cfg.seatCount - 1,
    nameCursor: cfg.seatCount - 1,
    reloads: 0,
  };
}

/**
 * The button of the hand `startHand(table, …)` deals (§3.3). Seats with chips are dealt in.
 * - First hand (`button == −1`): `randInt(rngFromSeed(deriveSeed(tableSeed, 'button')), seatCount)`;
 *   if that seat has no chips, the next dealt-in seat clockwise.
 * - Heads-up (two seats with chips): if the last hand's big blind is still dealt in, it gets the
 *   button and the small blind, so nobody posts the big blind twice in a row (the 3 → 2 rule,
 *   TDA r.34; in a steady heads-up game this is the usual alternation).
 * - Otherwise the next dealt-in seat clockwise after the last button (a moving button: a seat
 *   that busted on the button is skipped, B30).
 * Throws `EngineError('BAD_PHASE')` when fewer than two seats have chips.
 */
export function buttonForHand(table: TableState): number {
  const n = table.config.seatCount;
  const hasChips = (seat: number): boolean => (table.slots[seat]?.stack ?? 0) > 0;
  let k = 0;
  for (let seat = 0; seat < n; seat++) if (hasChips(seat)) k++;
  if (k < 2) throw new EngineError('BAD_PHASE', 'a hand needs at least two players with chips');
  if (table.button === -1) {
    const pick = randInt(rngFromSeed(deriveSeed(table.tableSeed, 'button')), n);
    return hasChips(pick) ? pick : (nextSeat(n, pick, hasChips) as number);
  }
  if (k === 2 && table.prevBB !== null && hasChips(table.prevBB)) return table.prevBB;
  return nextSeat(n, table.button, hasChips) as number;
}

/**
 * The next free name for a new bot (§9.3): the name at `cursor` in the table's name order, moving
 * on past every name in `seated`. Returns the name and the cursor value it was found at.
 */
function nextName(
  names: readonly string[],
  cursor: number,
  seated: ReadonlySet<string>,
): { name: string; at: number } {
  // At most 9 seated players plus 8 newcomers hold names, and there are 24: this always ends.
  for (let at = cursor; at < cursor + names.length; at++) {
    const name = names[at % names.length] as string;
    if (!seated.has(name)) return { name, at };
  }
  throw new Error('nextTable: no free bot name');
}

/**
 * The table after a finished hand (§2.3 "nextTable", §3.1, §9.3): each seat keeps its final
 * stack; the hand's button and big blind become `button` and `prevBB`; `handsDealt` grows by one
 * and `nextHandSeq` passes the hand's `handSeq`. Every bot that busted is replaced, in seat order,
 * by a new bot with the starting stack: the next personality of its seat's level list (the single
 * `personalityCursor` advances) and the next name of the table's name order at `nameCursor`,
 * skipping every name seated now (so never two at once, and never the name that just busted);
 * its id is `'bot-' + nameCursor` before the cursor advances. A busted hero stays at 0: the
 * controller offers a reload (`topUp`) before the next hand.
 * Throws `EngineError('BAD_PHASE')` unless `done` is a complete hand dealt from `table`, and
 * `InvariantError` if `done` breaks an invariant.
 */
export function nextTable(table: TableState, done: HandState): TableState {
  validateTable(table);
  if (done.phase !== 'complete') throw new EngineError('BAD_PHASE', 'the hand is not over yet');
  checkInvariants(done);
  const n = table.config.seatCount;
  const fromThisTable =
    done.seats.length === n && table.slots.every((slot, i) => done.startStacks[i] === slot.stack);
  if (!fromThisTable) throw new EngineError('BAD_PHASE', 'this hand was not dealt from this table');

  const next = copyTable(table);
  const names = nameOrder(table.tableSeed);
  const seated = new Set(table.slots.map((slot) => slot.name));
  next.slots = next.slots.map((slot, seat): PlayerSlot => {
    const stack = (done.seats[seat] as HandState['seats'][number]).stack;
    if (slot.kind === 'hero' || stack > 0) return { ...slot, stack };
    const personality = personalityFor(next.config, seat, next.personalityCursor);
    next.personalityCursor++;
    const { name, at } = nextName(names, next.nameCursor, seated);
    next.nameCursor = at + 1;
    seated.add(name);
    return {
      playerId: `bot-${at}`,
      name,
      kind: 'bot',
      personality,
      stack: next.config.startingStack,
    };
  });
  next.button = done.button;
  next.prevBB = done.bbSeat;
  next.nextHandSeq = Math.max(table.nextHandSeq, done.handSeq + 1);
  next.handsDealt = table.handsDealt + 1;
  return next;
}

/**
 * Hero reload or top-up between hands (§3.1): seat 0's stack becomes `toStack`, which must be
 * more than it has and at most the starting stack; `reloads` grows by one. Only the hero reloads:
 * busted bots are replaced by `nextTable`.
 */
export function topUp(table: TableState, seat: number, toStack: number): TableState {
  validateTable(table);
  if (seat !== 0) illegal('only the hero (seat 0) can reload');
  const next = copyTable(table);
  const hero = next.slots[0] as PlayerSlot;
  if (!isSafeInt(toStack) || toStack <= hero.stack || toStack > next.config.startingStack) {
    badAmount(`top up to more than ${hero.stack} and at most ${next.config.startingStack}`);
  }
  hero.stack = toStack;
  next.reloads++;
  return next;
}

/**
 * New bot levels between hands (§9.3): the table level and the per-seat overrides. Seated bots
 * keep their personality; the new levels decide the next replacements and the bots' play from the
 * next hand.
 */
export function withLevels(
  table: TableState,
  botLevel: BotLevel,
  seatLevels: (BotLevel | null)[],
): TableState {
  validateTable(table);
  checkLevels(table.config.seatCount, botLevel, seatLevels);
  const next = copyTable(table);
  next.config.botLevel = botLevel;
  next.config.seatLevels = [...seatLevels];
  return next;
}
