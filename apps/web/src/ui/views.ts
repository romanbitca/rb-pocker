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
import type { HandCategory } from '../eval/evaluate.ts';

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

/**
 * What the player has seen a Hard or Expert bot do (PLAN §9.3, chunk 7.1): "Plays 34% of hands ·
 * Raises 20% · Bets often". Whole percentages of the hands in which it decided before the flop.
 */
export interface SeenPlayView {
  readonly hands: number;
  readonly plays: number;
  readonly raises: number;
  /** After the flop; null before it has bet, raised or called there. */
  readonly aggression: 'betsOften' | 'betsSometimes' | 'mostlyCalls' | null;
}

/**
 * A bot's card (PLAN §9.3, Appendix F.6), the sheet for a tapped seat. ⚠️ `personality` is null
 * at Hard and Expert, where the style is hidden ("Style: unknown.") and the card shows what the
 * player has seen it do instead (`seen`); the card never shows a hidden card.
 */
export interface BotCardView {
  readonly name: string;
  readonly personality: SeatPersonality | null;
  /** Chips behind. */
  readonly stack: number;
  /** Hard and Expert: what it was seen doing; null before its first preflop decision. */
  readonly seen: SeenPlayView | null;
}

/** The pot (PLAN §12.3): "Pot 340", plus "Main 300 · Side 400" once side pots exist. */
export interface PotView {
  /** Every chip in the middle, current street bets included (PLAN §0.3 `pot`). */
  readonly total: number;
  /** Main pot first, then side pots. Fewer than two entries = no side-pot line. */
  readonly pots: readonly number[];
}

/**
 * The hero's hand for the hand-rankings panel (PLAN §13.3): `describe(hole, board)` on the main
 * thread, mapped by `heroHandView()` (ui/rankings.ts). `null` between hands: no highlight.
 */
export interface HeroHandView {
  /** The engine's `handSeq`: the "improved" pulse and the tab dot never compare two hands. */
  readonly handSeq: number;
  /** `describe().category`: the highlighted row. Preflop: pair or high card. */
  readonly category: HandCategory;
  /** `describe().best5`, category-forming cards first; `[]` preflop. */
  readonly best5: readonly Card[];
  /** `describe().kickers`: dimmed on the "You" line. */
  readonly kickers: readonly Card[];
  /** The hero's hole cards: outlined on the "You" line where they are used. */
  readonly hole: readonly [Card, Card];
  /** The hero folded this hand: grey highlight and "You folded". */
  readonly folded: boolean;
}

/**
 * The rankings panel's "By river" column (PLAN §6.6, §13.2): the hero's chance to finish with
 * exactly each hand, in percent; `exactly: null` while the hand analysis is on its way.
 */
export interface ByRiverView {
  readonly handSeq: number;
  readonly exactly: Readonly<Record<HandCategory, number>> | null;
}
