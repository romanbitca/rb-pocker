/**
 * All-in "TV mode" and the luck line (PLAN §7.6, §12.9; chunk 4.7), as data for the table. `app`
 * may not import `ui` (§2.1), so the shapes are declared here and the UI reaches them through
 * `app/store.ts`, which re-exports this module; `ui/components/RunoutBars.tsx` draws them and
 * `ui/handEnd.ts` words the luck line.
 *
 * - TV mode: once the engine turns the hands face up for a run-out (`hand.runout`, the seats in
 *   `hand.revealed`), every face-up player gets an equity bar that follows the board street by
 *   street, from the `equityKnown` jobs over the face-up hands only (`equity.known`). A street's
 *   numbers stay until the next street's arrive (exact from the flop on, so within milliseconds).
 *   The bars go when the hand is complete: the result banner speaks then.
 * - Luck line: at the hand end, when the hero was one of the face-up hands, compare the hero's
 *   equity when the chips went in (`equity.allIn`, the board as it was at the reveal, final) with
 *   the result: lost with ≥ 60% → "unlucky", won the main pot alone with ≤ 35% → "lucky". The
 *   thresholds apply to the whole percent the line prints.
 *
 * ⚠️ Nothing hidden: a seat gets a bar only when it is face up (`hand.revealed`), and every number
 * comes from a job that saw face-up hands and the board only (§2.2, pitfall 13).
 */
import type { HandState, TableState } from '../engine/types.ts';
import type { AppState, KnownEquity } from './store.ts';

const HERO = 0;

/** §7.6: the hero lost with at least this win chance (whole percent). */
export const UNLUCKY_PCT = 60;
/** §7.6: the hero won with at most this win chance (whole percent). */
export const LUCKY_PCT = 35;

/** One face-up player's equity bar. */
export interface RunoutBarData {
  /** Engine seat: 0 is the hero, the bar sits at the hero's bet slot. */
  readonly seat: number;
  /** The bot's name (for the screen-reader label); '' for the hero. */
  readonly name: string;
  /** Win chance in whole percent, from the face-up hands and the board. */
  readonly pct: number;
}

/** The TV-mode bars of one hand (face-up seats in reveal order that have a number). */
export interface RunoutView {
  readonly handSeq: number;
  readonly bars: readonly RunoutBarData[];
}

/** The §7.6 luck line at the hand end. */
export interface LuckLineData {
  readonly handSeq: number;
  readonly kind: 'unlucky' | 'lucky';
  /** The hero's win chance when the chips went in, whole percent. */
  readonly pct: number;
}

/** The face-up live seats of a run-out, in `hand.revealed` order; [] without a run-out. */
export function faceUpSeats(hand: HandState): number[] {
  if (!hand.runout) return [];
  return hand.revealed.filter((seat) => {
    const s = hand.seats[seat];
    return s !== undefined && s.dealtIn && !s.folded && s.hole !== null;
  });
}

const pctOf = (fraction: number): number => Math.round(fraction * 100);

/**
 * The bars while a run-out is on the table: null without one, once the hand is complete, and
 * before the first equities of this hand arrive.
 */
export function runoutViewOf(
  hand: HandState | null,
  table: TableState | null,
  known: KnownEquity | null,
): RunoutView | null {
  if (hand === null || hand.phase === 'complete') return null;
  const seats = faceUpSeats(hand);
  if (seats.length < 2 || known === null || known.handSeq !== hand.handSeq) return null;
  const bars: RunoutBarData[] = [];
  for (const seat of seats) {
    const i = known.seats.indexOf(seat);
    const equity = known.perPlayer[i];
    if (i < 0 || equity === undefined) continue;
    const name = seat === HERO ? '' : (table?.slots[seat]?.name ?? '');
    bars.push({ seat, name, pct: pctOf(equity) });
  }
  return bars.length === 0 ? null : { handSeq: hand.handSeq, bars };
}

/** The luck line for a complete hand, or null (see the module note). */
export function luckLineOf(hand: HandState | null, allIn: KnownEquity | null): LuckLineData | null {
  const result = hand?.result ?? null;
  if (hand === null || result === null || hand.phase !== 'complete' || !hand.runout) return null;
  if (allIn === null || allIn.handSeq !== hand.handSeq || !allIn.final) return null;
  const i = allIn.seats.indexOf(HERO);
  const equity = allIn.perPlayer[i];
  if (i < 0 || equity === undefined) return null;
  const pct = pctOf(equity);
  const lost = (result.payouts[HERO] ?? 0) === 0;
  const main = result.potWinners[0] ?? [];
  const wonAlone = main.length === 1 && main[0] === HERO;
  if (lost && pct >= UNLUCKY_PCT) return { handSeq: hand.handSeq, kind: 'unlucky', pct };
  if (wonAlone && pct <= LUCKY_PCT) return { handSeq: hand.handSeq, kind: 'lucky', pct };
  return null;
}

const sameBars = (a: readonly RunoutBarData[], b: readonly RunoutBarData[]): boolean =>
  a.length === b.length &&
  a.every((x, i) => {
    const y = b[i];
    return y !== undefined && x.seat === y.seat && x.name === y.name && x.pct === y.pct;
  });

let lastRunout: RunoutView | null = null;
let lastRunoutArgs: readonly unknown[] = [];

/**
 * The TV-mode bars (memoized: the same object while the bars do not change, so the layer
 * re-renders only when a number moves, pitfall 37).
 */
export function selectRunoutView(s: AppState): RunoutView | null {
  const args = [s.game.hand, s.game.table, s.equity.known];
  if (args.every((x, i) => x === lastRunoutArgs[i])) return lastRunout;
  lastRunoutArgs = args;
  const next = runoutViewOf(s.game.hand, s.game.table, s.equity.known);
  const same =
    next !== null &&
    lastRunout !== null &&
    next.handSeq === lastRunout.handSeq &&
    sameBars(next.bars, lastRunout.bars);
  if (!same) lastRunout = next;
  return lastRunout;
}

let lastLuck: LuckLineData | null = null;
let lastLuckArgs: readonly unknown[] = [];

/** The luck line of the hand on the table (memoized like `selectRunoutView`). */
export function selectLuckLine(s: AppState): LuckLineData | null {
  const args = [s.game.hand, s.equity.allIn];
  if (args.every((x, i) => x === lastLuckArgs[i])) return lastLuck;
  lastLuckArgs = args;
  const next = luckLineOf(s.game.hand, s.equity.allIn);
  const same =
    next !== null &&
    lastLuck !== null &&
    next.handSeq === lastLuck.handSeq &&
    next.kind === lastLuck.kind &&
    next.pct === lastLuck.pct;
  if (!same) lastLuck = next;
  return lastLuck;
}
