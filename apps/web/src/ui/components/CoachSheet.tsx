/**
 * The coach sheet (PLAN §12.6, §8.10): the full hint, in the coach's lazy chunk (§15.3).
 *
 * - `CoachDetails`: the sections. (1) **Do this**: the headline (the sheet only: the panels show
 *   it in their head row), "Clear choice" or "Close call: Fold is also fine", the strength meter
 *   at Beginner; (2) **Why**: RANGE_ADJUST first when it applies, then the reason (Intermediate:
 *   its first sentence and "More"); (3) **The numbers**: the HUD's win chance, the labelled range
 *   number (RANGE_ADJUST only), need, pot, to call, the price bar with its verdict, "How is this
 *   calculated?"; (4) **Your hand**: the label, each draw with its out cards (risky ones marked
 *   "!"), next card and by-river chances, the hands that beat you, the Rule of 2 and 4; (5) **Why
 *   not…**; (6) "Use coach size" when the coach bets or raises. Glossary terms are dotted
 *   buttons with a one-line definition (`GlossaryText`). The wide screen's inline panel and the
 *   landscape column show the same sections (§12.5).
 * - `CoachSheet`: the bottom sheet a tap on the strip (or "Why?", or the compact pill) opens. It
 *   fills the host the Table gives it (everything above the action bar; the table column in
 *   landscape) and rises from its bottom, at most 45% of the screen's height, so it never covers
 *   the action bar: the player can act with it open (the Table closes it with the decision).
 *   `role="dialog"` + `aria-modal`, focus moved in and trapped, Esc, ✕ and the scrim close it,
 *   and focus returns to the opener (§12.12).
 *
 * DOM (§15.3): about 40–60 elements with a draw's out cards; mounted only while needed.
 */
import {
  memo,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import {
  selectDrawChips,
  selectHandAnalysis,
  selectHeroView,
  useAppStore,
} from '../../app/store.ts';
import { cardAriaLabel } from '../../core/cards.ts';
import { en } from '../../i18n/en.ts';
import { coachWords } from '../../i18n/coachUi.ts';
import type { CoachView, HintView } from '../coach.ts';
import { pctText } from '../coachText.ts';
import { drawChipViews } from '../equity.ts';
import { Card } from './Card.tsx';
import styles from './CoachSheet.module.css';
import { GlossaryText } from './GlossaryText.tsx';
import { ICONS, SpriteIcon } from './SvgSprite.tsx';

const cx = (...names: (string | false | null | undefined)[]): string =>
  names.filter(Boolean).join(' ');

// ---------------------------------------------------------------------------------------------
// Your hand (§12.6 (4)): the hero strip's facts, with the out cards

function YourHand({ hint }: { hint: HintView }) {
  const hero = useAppStore(selectHeroView);
  const drawData = useAppStore(selectDrawChips);
  const analysis = useAppStore(selectHandAnalysis);
  const draws = useMemo(() => drawChipViews(drawData), [drawData]);
  if (hero === null) return null;
  const next = analysis?.nextCardPct ?? null;
  const river = analysis?.byRiverPct ?? null;
  const beaters = analysis?.beaters ?? null;
  const c = coachWords;
  return (
    <section className={styles.section}>
      <h3 className={styles.heading}>{c.yourHand}</h3>
      <p className={styles.hand}>
        {hero.subLabel === null ? hero.label : `${hero.label} · ${hero.subLabel}`}
      </p>
      {draws.map((d) => (
        <div key={d.key} className={styles.draw}>
          <p className={styles.drawName}>{d.text}</p>
          {d.cards.length > 0 && (
            // `data-examples`: out cards are cards still unseen, never a bot's shown cards (the
            // E2E leak watch skips them, like the draw chips' popover).
            <div className={styles.outs} data-examples="">
              {d.cards.map(({ card, risky }) => (
                <Card
                  key={card}
                  card={card}
                  size="sm"
                  className={risky ? styles.risky : undefined}
                  label={risky ? en.draws.riskyCard(cardAriaLabel(card)) : undefined}
                />
              ))}
            </div>
          )}
        </div>
      ))}
      {draws.some((d) => d.risky > 0) && (
        <p className={styles.small}>{`${en.draws.riskyMark} ${en.draws.riskyCaption}`}</p>
      )}
      {next !== null && river !== null && (
        <p className={styles.small}>{c.nextRiver(pctText(next / 100), pctText(river / 100))}</p>
      )}
      {beaters !== null && (
        <p className={styles.small}>{c.beaters(String(beaters.count), String(beaters.total))}</p>
      )}
      {hint.trick.map((t) => (
        <GlossaryText key={t} text={t} className={styles.small} />
      ))}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// The sections

export interface CoachDetailsProps {
  readonly view: CoachView;
  /** `sheet`: with the headline; `panel`: the head row above shows it (§12.5). */
  readonly place: 'sheet' | 'panel';
  /** "Use coach size" (§12.6): opens the sizing tray at the coach's amount; null: no button. */
  readonly onUseSize: (() => void) | null;
  readonly className?: string | undefined;
}

export const CoachDetails = memo(function CoachDetails({
  view,
  place,
  onUseSize,
  className,
}: CoachDetailsProps) {
  const [more, setMore] = useState(false);
  const [how, setHow] = useState(false);
  const howId = useId();
  const hint = view.hint;
  if (hint === null) return null;
  const c = coachWords;
  const n = hint.numbers;
  const short = view.level === 'intermediate' && !more;
  const confidence = hint.close ?? (hint.confidence === 'clear' ? c.clear : null);
  return (
    <div className={cx(styles.details, className)} data-coach-details={place}>
      <section className={styles.section}>
        <h3 className={styles.heading}>{c.doThis}</h3>
        {place === 'sheet' && <p className={styles.headline}>{hint.headline}</p>}
        {confidence !== null && <GlossaryText text={confidence} className={styles.text} />}
        {hint.strength !== null && (
          <p
            className={styles.meter}
            role="img"
            aria-label={hint.strength.name}
            data-level={hint.strength.level}
          >
            {hint.strength.label}
          </p>
        )}
      </section>
      <section className={styles.section}>
        <h3 className={styles.heading}>{c.whyTitle}</h3>
        {hint.rangeAdjust !== null && (
          <GlossaryText text={hint.rangeAdjust} className={styles.text} />
        )}
        <GlossaryText text={short ? hint.reasonFirst : hint.reason} className={styles.text} />
        {!short && hint.extra.map((t) => <GlossaryText key={t} text={t} className={styles.text} />)}
        {short && (hint.reason !== hint.reasonFirst || hint.extra.length > 0) && (
          <button type="button" className={styles.link} onClick={() => setMore(true)}>
            {c.more}
          </button>
        )}
      </section>
      <section className={styles.section}>
        <h3 className={styles.heading}>{c.numbers}</h3>
        <ul className={styles.numbers}>
          <li>{n.win}</li>
          {n.likely !== null && <li>{n.likely}</li>}
          {n.need !== null && <li>{n.need}</li>}
          <li>{n.pot}</li>
          {n.toCall !== null && <li>{n.toCall}</li>}
        </ul>
        {n.bar !== null && (
          <>
            <div
              className={styles.bar}
              role="img"
              aria-label={n.bar.label}
              style={
                {
                  '--win': n.bar.win.toFixed(3),
                  '--need': n.bar.need.toFixed(3),
                } as CSSProperties
              }
              data-good={n.bar.good ? 'true' : 'false'}
            />
            <p className={styles.verdict} data-good={n.bar.good ? 'true' : 'false'}>
              {n.bar.verdict}
            </p>
          </>
        )}
        <button
          type="button"
          className={styles.link}
          aria-expanded={how}
          aria-controls={how ? howId : undefined}
          onClick={() => setHow(!how)}
        >
          {en.badge.howLink}
        </button>
        {how && (
          <p id={howId} className={styles.small}>
            {en.badge.how(`${pctText(n.winValue)}%`)}
          </p>
        )}
      </section>
      <YourHand hint={hint} />
      {hint.whyNot.length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.heading}>{c.whyNotTitle}</h3>
          <ul className={styles.list}>
            {hint.whyNot.map((t) => (
              <GlossaryText key={t} as="li" text={t} />
            ))}
          </ul>
        </section>
      )}
      {onUseSize !== null && (
        <button type="button" className={styles.useSize} onClick={onUseSize}>
          {c.useSize}
        </button>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------------------------
// The sheet

// `a[href]`, not `[href]`: an SVG `<use href>` is not focusable.
const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface CoachSheetProps {
  readonly view: CoachView;
  readonly onClose: () => void;
  readonly onUseSize: (() => void) | null;
  /** Landscape: the sheet fills the table column (its host) instead of 45% of the height. */
  readonly tall?: boolean;
}

export function CoachSheet({ view, onClose, onUseSize, tall = false }: CoachSheetProps) {
  const titleId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  // Focus in and trapped, Esc closes, focus back to the opener (§12.12).
  useEffect(() => {
    const sheet = sheetRef.current;
    if (sheet === null) return;
    const opener = document.activeElement;
    sheet.focus({ preventScroll: true });
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close.current();
      }
    };
    const onFocusIn = (e: FocusEvent) => {
      if (e.target instanceof Node && !sheet.contains(e.target))
        sheet.focus({ preventScroll: true });
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocusIn);
      if (opener instanceof HTMLElement && opener.isConnected)
        opener.focus({ preventScroll: true });
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const sheet = sheetRef.current;
    if (e.key !== 'Tab' || sheet === null) return;
    const items = [...sheet.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = items[0];
    const lastItem = items[items.length - 1];
    if (first === undefined || lastItem === undefined) {
      e.preventDefault();
      return;
    }
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === sheet)) {
      e.preventDefault();
      lastItem.focus();
    } else if (!e.shiftKey && active === lastItem) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className={cx(styles.layer, tall && styles.tall)}>
      <div className={styles.scrim} aria-hidden="true" onClick={() => close.current()} />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={styles.sheet}
        onKeyDown={onKeyDown}
        data-coach-sheet=""
      >
        <header className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            {en.coachUi.title}
          </h2>
          <button
            type="button"
            className={styles.close}
            aria-label={coachWords.close}
            onClick={() => close.current()}
          >
            <SpriteIcon id={ICONS.close} className={styles.closeIcon} />
          </button>
        </header>
        <div className={styles.scroll}>
          <CoachDetails view={view} place="sheet" onUseSize={onUseSize} />
        </div>
      </div>
    </div>
  );
}
