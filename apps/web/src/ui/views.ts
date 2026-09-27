/**
 * View models: the small, plain props the table components take (PLAN §2.5 "State").
 *
 * The store (`app/store.ts`) maps engine state to these. `app` may not import `ui`, not even its
 * types (PLAN §2.1), so the store builds structurally equal objects and the screens pass them on.
 * Everything here is JSON-like data: no functions, no class instances.
 *
 * ⚠️ Hidden information never enters a view model: a face-down card is `card: null`, and a bot's
 * unrevealed hole cards are `{ kind: 'hidden' }` with no card values at all (PLAN pitfall 13,
 * Stage 3 acceptance 7). A component cannot leak what it is never given.
 */
import type { Card } from '../core/cards.ts';

/** How a face-up card is marked (PLAN §6.1): core = raised + 3 px outline, kicker = 1 px outline,
 * off = dimmed to 60% (board cards outside the best five, after the flop). */
export type CardHighlight = 'core' | 'kicker' | 'off';

/** One card. `card: null` = face down. */
export interface CardView {
  readonly card: Card | null;
  readonly highlight?: CardHighlight;
}

/** Bot personality ids, the same strings as `PersonalityId` (PLAN Appendix A.3). */
export type SeatPersonality = 'rock' | 'tag' | 'lag' | 'station' | 'maniac';

/** The seat's last action this street, for the pod's status tag (PLAN §12.4). */
export type SeatAction = 'check' | 'call' | 'bet' | 'raise';

/** A bot's hole cards as the table shows them. */
export type SeatCards =
  /** No cards: not dealt in, or folded (the cards are mucked). */
  | { readonly kind: 'none' }
  /** Two face-down backs. ⚠️ Carries no card values, by design. */
  | { readonly kind: 'hidden' }
  /** Face up, only at a run-out or a showdown (the engine's `revealed` seats). */
  | { readonly kind: 'revealed'; readonly cards: readonly [CardView, CardView] };

/** One opponent's pod (PLAN §12.4). The hero (seat 0) is drawn by the hero strip instead. */
export interface SeatView {
  /** Engine seat index, 1..8. */
  readonly seat: number;
  readonly name: string;
  /** The personality badge; `null` hides it (it shows only at Easy and Medium, §12.4). */
  readonly personality: SeatPersonality | null;
  readonly stack: number;
  /** Chips in front of the seat this street (`streetBet`); 0 = no bet chip. */
  readonly bet: number;
  readonly dealer: boolean;
  readonly blind: 'sb' | 'bb' | null;
  readonly folded: boolean;
  readonly allIn: boolean;
  /** It is this bot's turn: thinking dots and a ring. */
  readonly toAct: boolean;
  readonly lastAction: SeatAction | null;
  readonly cards: SeatCards;
  /** Won all or part of the pot at this showdown. */
  readonly winner: boolean;
}

/** The pot (PLAN §12.3): "Pot 340", plus "Main 300 · Side 400" once side pots exist. */
export interface PotView {
  /** Every chip in the middle, current street bets included (PLAN §0.3 `pot`). */
  readonly total: number;
  /** Main pot first, then side pots. Fewer than two entries = no side-pot line. */
  readonly pots: readonly number[];
}
