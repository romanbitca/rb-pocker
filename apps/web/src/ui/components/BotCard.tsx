/**
 * The bot card (PLAN §9.3, §12.1, Appendix F.6): the sheet that opens when a seat is tapped. A
 * modal bottom sheet (`Modal`, the same layer as the Menu): focus moves in and is trapped, Esc and
 * a tap on the scrim call `onClose`, and so does ✕. Android Back is the navigation reducer's.
 *
 * - Easy and Medium: the bot's name, the personality's icon and name, a one-line description, the
 *   "How to beat them" tip and the stack.
 * - Hard and Expert (`personality` is null): the name, "Style: unknown.", what the player has seen
 *   the bot do ("Here is what you have seen:" and "Plays 34% of hands · Raises 20% · Bets often",
 *   with the number of hands behind it; chunk 7.1), and the stack.
 *
 * The card is mounted only while it is open and its code is a lazy chunk (App.tsx), so the Table's
 * DOM and the main bundle do not pay for it (§15.3).
 */
import { useId, type CSSProperties } from 'react';
import { en } from '../../i18n/en.ts';
import { formatChips } from '../format.ts';
import type { BotCardView } from '../views.ts';
import s from './BotCard.module.css';
import { Modal } from './Modal.tsx';
import { avatarIndex } from './Seat.tsx';
import { ICONS, SpriteIcon } from './SvgSprite.tsx';

export interface BotCardProps {
  card: BotCardView;
  /** ✕, Esc and the scrim. */
  onClose: () => void;
}

export function BotCard({ card, onClose }: BotCardProps) {
  const titleId = useId();
  const styleId = useId();
  const textId = useId();
  const text = card.personality === null ? null : en.personalityText[card.personality];
  const avatar = { '--avatar': `var(--avatar-${avatarIndex(card.name)})` } as CSSProperties;
  return (
    <Modal
      kind="sheet"
      labelledBy={`${titleId} ${styleId}`}
      describedBy={text === null ? undefined : textId}
      onDismiss={onClose}
    >
      <header className={s.header}>
        <span className={s.avatar} style={avatar} aria-hidden="true">
          {(Array.from(card.name.trim())[0] ?? '?').toUpperCase()}
        </span>
        <h2 id={titleId} className={s.name}>
          {card.name}
        </h2>
        <button type="button" className={s.close} aria-label={en.botCard.close} onClick={onClose}>
          <SpriteIcon id={ICONS.close} className={s.closeIcon} />
        </button>
      </header>
      {card.personality !== null && text !== null ? (
        <>
          <p id={styleId} className={s.style}>
            <SpriteIcon id={ICONS[card.personality]} className={s.styleIcon} />
            {en.personality[card.personality]}
          </p>
          <p id={textId} className={s.text}>
            {text.description}
          </p>
          <h3 className={s.tipTitle}>{en.botCard.howToBeat}</h3>
          <p className={s.text}>{text.tip}</p>
        </>
      ) : (
        <>
          <p id={styleId} className={s.style}>
            {en.botCard.unknownStyle}
          </p>
          <SeenPlay seen={card.seen} />
        </>
      )}
      <p className={s.stack}>{en.botCard.stack(formatChips(card.stack))}</p>
    </Modal>
  );
}

/** What the player has seen a Hard or Expert bot do (§9.3), in plain words. */
function SeenPlay({ seen }: { seen: BotCardView['seen'] }) {
  if (seen === null) return <p className={s.text}>{en.botCard.notSeenYet}</p>;
  const parts = [en.botCard.plays(seen.plays), en.botCard.raises(seen.raises)];
  if (seen.aggression !== null) parts.push(en.botCard.aggression[seen.aggression]);
  return (
    <>
      <p className={s.text}>{en.botCard.seenIntro}</p>
      <p className={s.seen}>{parts.join(en.botCard.separator)}</p>
      <p className={s.hands}>{en.botCard.handsSeen(formatChips(seen.hands))}</p>
    </>
  );
}
