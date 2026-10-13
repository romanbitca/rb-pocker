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
import chips from '../screens/Screen.module.css';
import { BOT_LEVEL_ORDER } from '../screens/setupForm.ts';
import { formatChips } from '../format.ts';
import type { BotCardView, BotLevelName } from '../views.ts';
import s from './BotCard.module.css';
import { Modal } from './Modal.tsx';
import { avatarIndex } from './Seat.tsx';
import { ICONS, SpriteIcon } from './SvgSprite.tsx';

export interface BotCardProps {
  card: BotCardView;
  /** The level picker: this bot's own level from the next hand on, or null for the table's. */
  onLevel: (level: BotLevelName | null) => void;
  /** ✕, Esc and the scrim. */
  onClose: () => void;
}

export function BotCard({ card, onLevel, onClose }: BotCardProps) {
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
      <LevelPicker choice={card.nextLevel} onLevel={onLevel} />
    </Modal>
  );
}

/**
 * The per-seat override (PLAN §9.3, chunk 7.2): "Same as table (Easy)" and the four levels, one
 * radio group. A pick is sent at once and starts with the next hand; the rest of the card keeps
 * describing the hand in play, so the hint says so. The chips are the Settings look (native
 * radios under their faces, 44 px or more).
 */
function LevelPicker({
  choice,
  onLevel,
}: {
  choice: BotCardView['nextLevel'];
  onLevel: BotCardProps['onLevel'];
}) {
  const name = useId();
  const legendId = `${name}-legend`;
  const hintId = `${name}-hint`;
  const options: readonly (BotLevelName | null)[] = [null, ...BOT_LEVEL_ORDER];
  // A group, not a fieldset: a fieldset's border runs through its legend.
  return (
    <div className={s.level} role="group" aria-labelledby={legendId} aria-describedby={hintId}>
      <p id={legendId} className={s.levelLegend}>
        {en.botCard.level.legend}
      </p>
      <div className={`${chips.choices} ${s.picker}`}>
        {options.map((level) => (
          <label
            key={level ?? 'table'}
            className={level === null ? `${chips.choice} ${s.wide}` : chips.choice}
          >
            <input
              type="radio"
              name={name}
              value={level ?? ''}
              checked={choice.own === level}
              onChange={() => onLevel(level)}
            />
            <span className={`${chips.face} ${s.face}`}>
              {level === null
                ? en.botCard.level.sameAsTable(en.levels.bot[choice.table])
                : en.levels.bot[level]}
            </span>
          </label>
        ))}
      </div>
      <p id={hintId} className={chips.hint}>
        {en.botCard.level.hint}
      </p>
    </div>
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
