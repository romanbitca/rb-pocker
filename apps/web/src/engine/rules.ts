/**
 * Shared rule helpers of PLAN §3 for the code that builds hand states (start.ts now; step.ts and
 * settle.ts later). `invariants.ts` does not use them on purpose: it re-derives the same rules on
 * its own, so a mistake here is caught there instead of copied.
 *
 * Seats are numbered clockwise (§0.3), so "left of" a seat means the next seat clockwise.
 */
import type { HandState, SeatState } from './types.ts';

/** Dealt in and not folded (§3.7 `L`). */
export const isLive = (s: SeatState): boolean => s.dealtIn && !s.folded;

/** Live and not all-in: can still act (§3.7 `A`). */
export const isActive = (s: SeatState): boolean => s.dealtIn && !s.folded && !s.allIn;

/**
 * The first seat clockwise strictly after `from`, wrapping round (so `from` itself is tried last),
 * for which `ok` holds; null when there is none.
 */
export function nextSeat(n: number, from: number, ok: (seat: number) => boolean): number | null {
  for (let d = 1; d <= n; d++) {
    const seat = (from + d) % n;
    if (ok(seat)) return seat;
  }
  return null;
}

/** Dealt-in seats in dealing order: from the first one left of the button, the button last (§3.4). */
export function dealOrder(dealtIn: readonly boolean[], button: number): number[] {
  const n = dealtIn.length;
  const order: number[] = [];
  for (let d = 1; d <= n; d++) {
    const seat = (button + d) % n;
    if (dealtIn[seat] === true) order.push(seat);
  }
  return order;
}

/**
 * The blind seats for a button (§3.3). Heads-up the button posts the small blind and the other
 * seat the big blind; with 3+ players they are the next two dealt-in seats left of the button.
 * Needs at least two dealt-in seats, the button among them.
 */
export function blindSeats(
  dealtIn: readonly boolean[],
  button: number,
): { sbSeat: number; bbSeat: number } {
  const n = dealtIn.length;
  const ok = (seat: number): boolean => dealtIn[seat] === true;
  const k = dealtIn.filter(Boolean).length;
  if (k < 2 || !ok(button)) {
    throw new RangeError('blindSeats: needs two dealt-in seats and the button');
  }
  const sbSeat = k === 2 ? button : (nextSeat(n, button, ok) as number);
  const bbSeat = nextSeat(n, sbSeat, ok) as number;
  return { sbSeat, bbSeat };
}

/**
 * §3.7: is the betting round over? Evaluate it before the uncalled refund (the refund lowers the
 * top street bet). `A` = the seats that can still act:
 * - nobody can act; or
 * - one seat can act and it faces no bet (`streetBet ≥ currentBet`). Preflop against a short
 *   all-in BB `currentBet` is still the full bb (§3.3), so a small blind with more in than the BB
 *   must still call or fold (B34); or
 * - two or more can act, all have acted this street and all have matched `currentBet`.
 * A hand won by folds (one live seat) is handled by the caller before this.
 */
export function roundComplete(h: HandState): boolean {
  const active = h.seats.filter(isActive);
  if (active.length === 0) return true;
  if (active.length === 1) return (active[0] as SeatState).streetBet >= h.currentBet;
  return active.every((s) => s.lastActedAtBet !== null && s.streetBet === h.currentBet);
}

/**
 * The first seat to act on the current street (§3.7): preflop the first active seat strictly
 * after the big blind (heads-up that is the button), on later streets the first active seat
 * strictly after the button (so an active button acts last). Null when nobody can act.
 */
export function firstToAct(h: HandState): number | null {
  const from = h.street === 'preflop' ? h.bbSeat : h.button;
  return nextSeat(h.seats.length, from, (seat) => isActive(h.seats[seat] as SeatState));
}

/**
 * §4.3 `put`: moves up to `x` chips from the stack into the street and hand bets, marks the seat
 * all-in when its stack runs out, and returns the chips moved. Mutates `s` (a fresh state).
 */
export function put(s: SeatState, x: number): number {
  const amount = Math.min(x, s.stack);
  s.stack -= amount;
  s.streetBet += amount;
  s.totalBet += amount;
  if (s.stack === 0) s.allIn = true;
  return amount;
}
