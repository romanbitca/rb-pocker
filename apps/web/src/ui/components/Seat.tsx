/**
 * One opponent's seat pod (PLAN §12.4, §12.12): avatar, name, compact stack, status tag or thinking
 * dots, dealer disc / blind tag, hole cards and the bet chip.
 *
 * - Position and size come from `tableGeometry()` (layout/seats.ts): the pod box, the bet slot, and
 *   the side facing the table centre (where the dealer disc and blind tag go, inside the box).
 * - ⚠️ Bot cards are face-down backs unless the view says `revealed` (run-out or showdown). The
 *   view model for hidden cards carries no card values, so nothing can leak (acceptance 7).
 * - `React.memo` with a value comparison (`seatPropsEqual`): a store that rebuilds equal view
 *   objects on every update still causes no re-render (PLAN §15.3, pitfall 37).
 * - One screen-reader label per seat ("Anna, bot, Careful, stack 1,250, bet 50, folded"); the
 *   drawing inside is `aria-hidden`. With `onSelect` the pod is a button that opens the bot card
 *   (§9.3); it is the same box, so it adds no DOM node.
 */
import { memo, type CSSProperties } from 'react';
import { cardAriaLabel } from '../../core/cards.ts';
import { fnv1a32 } from '../../core/rng.ts';
import { en } from '../../i18n/en.ts';
import { betChips, compactChips, formatChips } from '../format.ts';
import type { Rect } from '../layout/seats.ts';
import type { CardView, SeatCards, SeatView } from '../views.ts';
import { Card } from './Card.tsx';
import styles from './Seat.module.css';
import { ICONS, SpriteIcon } from './SvgSprite.tsx';

/** Where the seat sits, from `tableGeometry()`: `pods[i]`, `bets[i]`, `inner[i]`. */
export interface SeatPlace {
  readonly pod: Rect;
  readonly bet: Rect;
  readonly inner: 'left' | 'right';
}

export interface SeatProps {
  view: SeatView;
  place: SeatPlace;
  /** Makes the pod a button that opens the bot card (§9.3, §12.1). Pass a stable function. */
  onSelect?: ((seat: number) => void) | undefined;
}

const join = (...names: (string | false | null | undefined)[]): string =>
  names.filter(Boolean).join(' ');

/** Avatar background: one of 8 tokens, by a hash of the name (decoration only, §12.4). */
export function avatarIndex(name: string): number {
  return fnv1a32(name) % 8;
}

function initial(name: string): string {
  return (Array.from(name.trim())[0] ?? '?').toUpperCase();
}

function statusWord(v: SeatView): string | null {
  const L = en.seat.label;
  if (v.folded) return L.folded;
  if (v.allIn) return L.allIn;
  if (v.toAct) return L.thinking;
  return v.lastAction === null ? null : L.action[v.lastAction];
}

/** The seat's screen-reader label (§12.12). */
export function seatLabel(v: SeatView): string {
  const L = en.seat.label;
  const parts: string[] = [v.name, L.bot];
  if (v.personality !== null) parts.push(en.personality[v.personality]);
  parts.push(L.stack(formatChips(v.stack)));
  if (v.bet > 0) parts.push(L.betAmount(formatChips(v.bet)));
  if (v.dealer) parts.push(L.dealer);
  if (v.blind === 'sb') parts.push(L.smallBlind);
  if (v.blind === 'bb') parts.push(L.bigBlind);
  const status = statusWord(v);
  if (status !== null) parts.push(status);
  if (v.cards.kind === 'revealed') {
    const shown = v.cards.cards.flatMap((c) => (c.card === null ? [] : [cardAriaLabel(c.card)]));
    parts.push(...shown);
  }
  if (v.winner) parts.push(L.winner);
  return parts.join(L.separator);
}

function Tag({ view }: { view: SeatView }) {
  const T = en.seat.tag;
  if (view.folded) return <span className={join(styles.tag, styles.tagFold)}>{T.fold}</span>;
  if (view.allIn) return <span className={join(styles.tag, styles.tagAllIn)}>{T.allIn}</span>;
  if (view.toAct) {
    return (
      <span className={join(styles.tag, styles.thinking)}>
        <span className={styles.dot} />
        <span className={styles.dot} />
        <span className={styles.dot} />
      </span>
    );
  }
  if (view.lastAction === null) return null;
  const aggressive = view.lastAction === 'bet' || view.lastAction === 'raise';
  return (
    <span className={join(styles.tag, aggressive && styles.tagAggressive)}>
      {T[view.lastAction]}
    </span>
  );
}

function Marker({ view }: { view: SeatView }) {
  if (view.dealer) return <span className={styles.dealer}>{en.seat.dealer}</span>;
  if (view.blind === null) return null;
  return (
    <span className={styles.blind}>
      {view.blind === 'sb' ? en.seat.smallBlind : en.seat.bigBlind}
    </span>
  );
}

function HoleCards({ cards }: { cards: SeatCards }) {
  switch (cards.kind) {
    case 'none':
      return null;
    case 'hidden':
      return (
        <span className={styles.backs}>
          <Card card={null} size="xs" />
          <Card card={null} size="xs" />
        </span>
      );
    case 'revealed':
      return (
        <span className={styles.shown}>
          {cards.cards.map((c, i) => (
            <Card key={i} card={c.card} size="lg" highlight={c.highlight} />
          ))}
        </span>
      );
  }
}

function SeatImpl({ view, place, onSelect }: SeatProps) {
  const { pod, bet, inner } = place;
  const revealed = view.cards.kind === 'revealed';
  const podClass = join(
    styles.pod,
    inner === 'left' ? styles.innerLeft : styles.innerRight,
    revealed && styles.revealed,
    view.folded && styles.folded,
    view.toAct && styles.toAct,
    view.winner && styles.winner,
  );
  const avatar = { '--avatar': `var(--avatar-${avatarIndex(view.name)})` } as CSSProperties;
  const body = (
    <span className={styles.body} aria-hidden="true">
      <span className={styles.plate} />
      <HoleCards cards={view.cards} />
      {!revealed && (
        <span className={styles.avatar} style={avatar}>
          {initial(view.name)}
        </span>
      )}
      <Marker view={view} />
      <Tag view={view} />
      <span className={styles.name}>
        {view.personality !== null && (
          <SpriteIcon id={ICONS[view.personality]} className={styles.badge} />
        )}
        <span className={styles.nameText}>{view.name}</span>
      </span>
      <span className={styles.stack}>{compactChips(view.stack)}</span>
    </span>
  );
  const label = seatLabel(view);
  return (
    <div className={styles.seat} style={{ left: pod.x, top: pod.y }} data-seat={view.seat}>
      {onSelect === undefined ? (
        <div role="group" aria-label={label} className={podClass}>
          {body}
        </div>
      ) : (
        <button
          type="button"
          aria-label={label}
          aria-haspopup="dialog"
          className={podClass}
          onClick={(e) => {
            // Safari does not focus a button on tap; the card returns focus to its opener (Modal).
            e.currentTarget.focus();
            onSelect(view.seat);
          }}
        >
          {body}
        </button>
      )}
      {view.bet > 0 && (
        <span
          className={styles.bet}
          style={{ left: bet.x - pod.x, top: bet.y - pod.y, width: bet.w, height: bet.h }}
          aria-hidden="true"
        >
          <span className={styles.betPill}>
            <SpriteIcon id={ICONS.chip} className={styles.chip} />
            {betChips(view.bet)}
          </span>
        </span>
      )}
    </div>
  );
}

const sameRect = (a: Rect, b: Rect): boolean =>
  a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

const sameCard = (a: CardView, b: CardView): boolean =>
  a.card === b.card && a.highlight === b.highlight;

function sameCards(a: SeatCards, b: SeatCards): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind !== 'revealed' || b.kind !== 'revealed') return true;
  return sameCard(a.cards[0], b.cards[0]) && sameCard(a.cards[1], b.cards[1]);
}

/** Value equality of two seat views. */
export function seatViewEqual(a: SeatView, b: SeatView): boolean {
  return (
    a === b ||
    (a.seat === b.seat &&
      a.name === b.name &&
      a.personality === b.personality &&
      a.stack === b.stack &&
      a.bet === b.bet &&
      a.dealer === b.dealer &&
      a.blind === b.blind &&
      a.folded === b.folded &&
      a.allIn === b.allIn &&
      a.toAct === b.toAct &&
      a.lastAction === b.lastAction &&
      a.winner === b.winner &&
      sameCards(a.cards, b.cards))
  );
}

/** `React.memo` comparator: equal values, not equal references, skip the render. */
export function seatPropsEqual(a: SeatProps, b: SeatProps): boolean {
  return (
    a.onSelect === b.onSelect &&
    a.place.inner === b.place.inner &&
    sameRect(a.place.pod, b.place.pod) &&
    sameRect(a.place.bet, b.place.bet) &&
    seatViewEqual(a.view, b.view)
  );
}

export const Seat = memo(SeatImpl, seatPropsEqual);
