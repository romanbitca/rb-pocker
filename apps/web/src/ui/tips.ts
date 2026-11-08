/**
 * The first-table tips (PLAN §12.11, chunk 9.3): when each one is due. Pure; the Table's
 * `TipLayer` opens them (`tip` command) and `TipBubble` draws them (a lazy chunk, with its words
 * and `ui/tipPlace.ts`, loaded only while a tip is due).
 *
 * - Once each: the controller marks a tip seen when it closes (`profile.flags.tips`); a seen tip is
 *   never due again.
 * - One at a time, in this order when two are due together: the hero strip, the coach (both at a
 *   hero turn), Undo (after an action, while Undo can take it back), the board's gold edge (the
 *   first time the hero has a best five: after a flop the hero still plays, 1.3.97), the Hands tab
 *   (after a flop the hero still plays). The gold edge comes first: it is what just changed on
 *   the table.
 * - None before the hero's cards are dealt, none over another layer (a sheet, a dialog, the
 *   feedback card, the sizing tray), none at a hand's end: so Play still reaches a dealt hand in
 *   one tap (§12.1), and a tip never covers what the player is using.
 * - A tip shows once its moment has lasted `TIP_DELAY_MS` (the cards have landed; a tap that
 *   closed the previous tip has done what it does: a tap on Call ends the hero's turn, and the
 *   coach's tip waits for the next one).
 */
import type { ControllerMode, Overlay, Screen, TipId } from '../app/store.ts';
import type { HandState } from '../engine/types.ts';

/** The tips in the order they come when several are due at once. */
export const TIP_ORDER: readonly TipId[] = [
  'heroStrip',
  'coachStrip',
  'undo',
  'bestFive',
  'handsTab',
];

/** How long a tip's moment lasts before the tip shows (a display timer, §0.3). */
export const TIP_DELAY_MS = 400;

export interface TipInput {
  /** The tips seen (`data.tips`); null: no tips (tests of other features). */
  readonly seen: Readonly<Record<string, boolean>> | null;
  readonly screen: Screen;
  readonly overlays: readonly Overlay[];
  readonly mode: ControllerMode;
  readonly hand: HandState | null;
  /** The toolbar Undo (`selectUndoButton`): the Undo tip needs one that works. */
  readonly undo: 'hidden' | 'disabled' | 'enabled';
}

/** The tip due now, or null (see the module note). */
export function dueTip(t: TipInput): TipId | null {
  const { seen, hand } = t;
  if (seen === null || t.screen !== 'table' || t.overlays.length > 0) return null;
  if (hand === null || hand.phase === 'complete') return null;
  const hero = hand.seats[0];
  if (hero === undefined || !hero.dealtIn || hero.hole === null) return null;
  for (const tip of TIP_ORDER) {
    if (seen[tip] === true) continue;
    switch (tip) {
      case 'heroStrip':
      case 'coachStrip':
        if (t.mode === 'heroTurn') return tip;
        break;
      case 'undo':
        if (t.undo === 'enabled') return tip;
        break;
      // From the flop on, a hero still in the hand has a best five: its gold edge is on the table.
      case 'bestFive':
      case 'handsTab':
        if (hand.board.length >= 3 && !hero.folded) return tip;
        break;
    }
  }
  return null;
}
