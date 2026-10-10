/**
 * Setup's form rules (PLAN §12.2), pure: presets, what a typed amount means, the "= 100 big blinds"
 * depth and whether Start is allowed. The limits are §3.2's, the same ones `createTable` enforces
 * (engine/table.ts); tests/ui/screens/setupForm.test.ts checks that both accept exactly the same
 * configs. The UI may not import the engine at run time (§2.1), hence this copy.
 */
import type { BotLevel, CoachLevel, TableConfig } from '../../engine/types.ts';

/** §3.2 limits. Depth is in big blinds: the starting stack must be 10 to 500 of them. */
export const PLAYERS = { min: 2, max: 9 } as const;
export const STACK = { min: 200, max: 1_000_000 } as const;
export const BIG_BLIND = { min: 2, max: 100_000 } as const;
export const DEPTH = { min: 10, max: 500 } as const;

/** §12.2 presets (the defaults are 2,000 chips and blinds 10/20). Blinds are big blinds; sb = bb / 2. */
export const STACK_PRESETS: readonly number[] = [500, 1_000, 2_000, 5_000, 10_000];
export const BIG_BLIND_PRESETS: readonly number[] = [10, 20, 50, 100, 200];

/** Every level, in card order (the UI may not load engine/types' `BOT_LEVELS` at run time). */
export const BOT_LEVEL_ORDER: readonly BotLevel[] = ['easy', 'medium', 'hard', 'expert'];
export const COACH_LEVEL_ORDER: readonly CoachLevel[] = [
  'beginner',
  'intermediate',
  'advanced',
  'exam',
];

/** Longest amount a custom field takes: 1,000,000 has 7 digits; one more shows the range error. */
export const MAX_DIGITS = 8;

/** The values Setup starts from, the last-used ones: a `Settings` object fits (Appendix A.7). */
export interface SetupValues {
  players: number;
  startingStack: number;
  bb: number;
  botLevel: BotLevel;
  coachLevel: CoachLevel;
}

/** The levels a player can pick now; the others show "Coming soon" (§18). */
export interface AvailableLevels {
  bot: readonly BotLevel[];
  coach: readonly CoachLevel[];
}

/**
 * What the app offers in Setup and Settings: Easy and Medium bots (Hard and Expert come with
 * Stage 7; the stored settings and the engine already accept all four), and all four coach levels
 * (Advanced and Exam since chunk 6.4, §10.2).
 */
export const AVAILABLE_LEVELS: AvailableLevels = {
  bot: ['easy', 'medium'],
  coach: ['beginner', 'intermediate', 'advanced', 'exam'],
};

/**
 * A chips or big-blind field: a preset, or Custom with the digits typed so far. A preset keeps
 * its value in `text` too, so choosing Custom starts from the amount already on screen.
 */
export interface Amount {
  custom: boolean;
  text: string;
}

export interface SetupForm {
  players: number;
  stack: Amount;
  bigBlind: Amount;
  botLevel: BotLevel;
  coachLevel: CoachLevel;
}

/** Depth labels (§12.2): 10–24 short, 25–59 medium, 60–150 normal, 151–500 deep. */
export type DepthBand = 'short' | 'medium' | 'normal' | 'deep';

export type Stakes =
  { kind: 'ok'; bigBlinds: number; band: DepthBand } | { kind: 'tooShallow' } | { kind: 'tooDeep' };

export interface SetupCheck {
  /** The starting stack, or null when the field is empty or out of range (show its range). */
  stack: number | null;
  /** The big blind after rounding up to even, or null when empty or out of range. */
  bb: number | null;
  /** Chips against blinds, once both fields are valid. */
  stakes: Stakes | null;
  /** The table to start, only when everything is valid: Start is enabled exactly then. */
  config: TableConfig | null;
}

/** Keeps the digits only (§12.2 "non-digits are stripped"), without leading zeros. */
export function digitsOnly(text: string): string {
  return text
    .replace(/\D/g, '')
    .replace(/^0+(?=\d)/, '')
    .slice(0, MAX_DIGITS);
}

/** A field's whole number, or null when it is empty. */
export function parseAmount(text: string): number | null {
  const digits = digitsOnly(text);
  return digits === '' ? null : Number(digits);
}

/** §12.2: a custom big blind is rounded up to even (the small blind is half of it). */
export function roundUpToEven(n: number): number {
  return n % 2 === 0 ? n : n + 1;
}

const inRange = (n: number, range: { min: number; max: number }): boolean =>
  Number.isSafeInteger(n) && n >= range.min && n <= range.max;

/** The typed starting stack, or null when empty or out of range. */
export function stackValue(amount: Amount): number | null {
  const n = parseAmount(amount.text);
  return n !== null && inRange(n, STACK) ? n : null;
}

/** The typed big blind rounded up to even, or null when empty or out of range. */
export function bigBlindValue(amount: Amount): number | null {
  const n = parseAmount(amount.text);
  if (n === null) return null;
  const even = roundUpToEven(n);
  return inRange(even, BIG_BLIND) ? even : null;
}

/** The depth label for a depth of 10 to 500 big blinds. */
export function depthBand(bigBlinds: number): DepthBand {
  if (bigBlinds <= 24) return 'short';
  if (bigBlinds <= 59) return 'medium';
  if (bigBlinds <= 150) return 'normal';
  return 'deep';
}

/**
 * Chips against blinds (§3.2): the stack must be 10 × bb to 500 × bb, compared exactly. The
 * depth shown is `floor(stack / bb)`, so 500 bb plus one chip shows as too deep, not as 500.
 */
export function checkStakes(stack: number, bb: number): Stakes {
  if (stack < DEPTH.min * bb) return { kind: 'tooShallow' };
  if (stack > DEPTH.max * bb) return { kind: 'tooDeep' };
  const bigBlinds = Math.floor(stack / bb);
  return { kind: 'ok', bigBlinds, band: depthBand(bigBlinds) };
}

/** The table config Setup starts: no per-seat level overrides yet (Stage 7 adds them). */
export function tableConfig(
  players: number,
  startingStack: number,
  bb: number,
  botLevel: BotLevel,
): TableConfig {
  return {
    seatCount: players,
    sb: bb / 2,
    bb,
    startingStack,
    botLevel,
    seatLevels: Array.from({ length: players }, () => null),
  };
}

/** Everything Setup shows about the form, and the config when Start is allowed. */
export function checkSetup(form: SetupForm, available: AvailableLevels): SetupCheck {
  const stack = stackValue(form.stack);
  const bb = bigBlindValue(form.bigBlind);
  const stakes = stack !== null && bb !== null ? checkStakes(stack, bb) : null;
  const levelsOk =
    available.bot.includes(form.botLevel) && available.coach.includes(form.coachLevel);
  const config =
    stack !== null &&
    bb !== null &&
    stakes?.kind === 'ok' &&
    levelsOk &&
    inRange(form.players, PLAYERS)
      ? tableConfig(form.players, stack, bb, form.botLevel)
      : null;
  return { stack, bb, stakes, config };
}

/** One step of the players stepper, kept to 2–9. */
export function stepPlayers(players: number, delta: -1 | 1): number {
  return Math.min(PLAYERS.max, Math.max(PLAYERS.min, players + delta));
}

/** A field showing `value`: its preset when there is one, else Custom. */
export function amountFor(value: number, presets: readonly number[]): Amount {
  return { custom: !presets.includes(value), text: String(value) };
}

/**
 * The form Setup opens with: the last-used values (§12.2), players kept to 2–9, and a level that
 * cannot be picked yet replaced by the first one that can.
 */
export function initialForm(values: SetupValues, available: AvailableLevels): SetupForm {
  const players = Number.isSafeInteger(values.players)
    ? Math.min(PLAYERS.max, Math.max(PLAYERS.min, values.players))
    : 6;
  return {
    players,
    stack: amountFor(values.startingStack, STACK_PRESETS),
    bigBlind: amountFor(values.bb, BIG_BLIND_PRESETS),
    botLevel: available.bot.includes(values.botLevel)
      ? values.botLevel
      : (available.bot[0] ?? values.botLevel),
    coachLevel: available.coach.includes(values.coachLevel)
      ? values.coachLevel
      : (available.coach[0] ?? values.coachLevel),
  };
}
