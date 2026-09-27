/**
 * Settlement (PLAN §3.8). For now only the uncalled-bet refund, which `startHand` needs when the
 * blinds already end the round (B36); side pots, odd chips and payouts come with chunk 2.4.
 */
import type { HandState, SeatState } from './types.ts';

/**
 * §3.8 uncalled refund (TDA r.15-B): `top` = the largest `streetBet` of any dealt-in seat (folded
 * seats included), `second` = the largest among all the others. If `top > second`, the difference
 * goes back from that seat's `streetBet` and `totalBet` to its stack, even if it folded (only
 * possible with forced blinds, B34), and a `refund` event is logged. A seat that gets chips back
 * is no longer all-in (I7). Idempotent: a second call finds `top == second` and does nothing.
 * Mutates `h`, which must be a fresh state or a clone (§4.2).
 */
export function refundUncalled(h: HandState): void {
  let top = 0;
  let topSeat = -1;
  let second = 0;
  h.seats.forEach((s, i) => {
    if (!s.dealtIn) return;
    if (s.streetBet > top) {
      second = top;
      top = s.streetBet;
      topSeat = i;
    } else if (s.streetBet > second) {
      second = s.streetBet;
    }
  });
  if (topSeat < 0 || top === second) return;
  const s = h.seats[topSeat] as SeatState;
  const amount = top - second;
  s.streetBet -= amount;
  s.totalBet -= amount;
  s.stack += amount;
  s.allIn = !s.folded && s.stack === 0;
  h.log.push({ e: 'refund', seat: topSeat, amount });
}
