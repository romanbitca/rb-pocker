/**
 * Review (PLAN §12.10): a read-only replay of a finished hand, and the list of the recent ones.
 * Loaded on demand (`React.lazy` in ui/App.tsx; a dynamic `import()` keeps it out of the initial
 * bundle, §15.3).
 *
 * - The replay steps through the frames of `buildReview()` (app/reviewViews.ts, built from
 *   `replay()`): first, back, forward, last, a slider and auto-play. The arrow keys, Home and End
 *   do the same. The table is the live Table's layout (`ReviewTable`); under it a line says what
 *   happened at this step, and on the last step the result the hand-end banner showed.
 * - ⚠️ The frames never hold a card that was not shown in the real hand: a bot's hole cards
 *   appear only from the step where the engine turned them face up, and a folded hand never.
 *   The replay is the same for the screen reader as for the eye (the DOM test in
 *   tests/ui/screens/Review.leak.test.tsx checks both).
 * - Phones show either the list or one replay ("All hands" switches); wide screens show the list
 *   beside the replay. Back leaves the screen (Android Back too), whichever it shows.
 * - Under the controls, "Check the shuffle" (§16.3, chunk 9.4): the hand's shuffle code and seed;
 *   the check deals the hand again from the seed and says ✓ or ✗ (drawn marks, never glyphs),
 *   and only then shows the whole deck, folded and unseen cards included.
 * - Stage 6.1 adds a hero decision's grade, win chance and the coach's move to its step.
 */
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  buildReview,
  loadShuffleCheck,
  selectReviewHand,
  selectReviewList,
  shuffleRowOf,
  useAppStore,
  useDispatch,
  type ReviewListItem,
  type ReviewReplay,
  type ReviewSummary,
  type ShuffleCheck,
  type ShuffleRow,
} from '../../app/store.ts';
import { en } from '../../i18n/en.ts';
import { enReview } from '../../i18n/review.ts';
import { Card } from '../components/Card.tsx';
import { formatChips } from '../format.ts';
import { handEndLines } from '../handEnd.ts';
import { AUTOPLAY_MS, frameLines, netSpoken, netText, stepLabel } from '../review.ts';
import type { TableLayout } from '../layout/seats.ts';
import { ChevronLeftIcon } from './icons.tsx';
import styles from './Review.module.css';
import { FirstIcon, LastIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon } from './reviewIcons.tsx';
import { REVIEW_MARKER } from './reviewMarker.ts';
import { ReviewHero, ReviewTable } from './ReviewTable.tsx';
import screen from './Screen.module.css';
import { useTableLayout } from './Table.tsx';

const cx = (...names: (string | false | null | undefined)[]): string =>
  names.filter(Boolean).join(' ');

// ---------------------------------------------------------------------------------------------
// The list of recent hands

interface ListProps {
  items: readonly ReviewListItem[];
  /** The hand on show (marked with `aria-current`), or null. */
  current: number | null;
  onOpen: (handSeq: number) => void;
}

/** One button per hand: your cards, "Hand 12", how it ended, and your net. */
const HandList = memo(function HandList({ items, current, onOpen }: ListProps) {
  return (
    <ul className={styles.list}>
      {items.map((item) => (
        <li key={item.handSeq}>
          <button
            type="button"
            className={styles.row}
            aria-current={item.handSeq === current ? 'true' : undefined}
            onClick={() => onOpen(item.handSeq)}
          >
            <span className={styles.rowCards}>
              {item.heroHole?.map((card) => (
                <Card key={card} card={card} size="sm" />
              ))}
            </span>
            <span className={styles.rowText}>
              <span className={styles.rowTitle}>
                {enReview.title(formatChips(item.handNumber))}
              </span>
              <span className={styles.rowLine}>{handEndLines(item.end)[0] ?? ''}</span>
            </span>
            <span className={styles.rowNet}>
              <span aria-hidden="true">{netText(item.end.heroNet)}</span>
              <span className={screen.srOnly}>{netSpoken(item.end.heroNet)}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
});

function Empty({ onBack }: { onBack: () => void }) {
  return (
    <div className={styles.empty}>
      <p className={styles.emptyTitle}>{enReview.empty}</p>
      <p className={styles.hint}>{enReview.emptyHint}</p>
      <button type="button" className={screen.secondary} onClick={() => onBack()}>
        {enReview.backToGame}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// The replay

const clamp = (n: number, last: number): number => Math.max(0, Math.min(last, n));

/** Keys that move through the hand are ignored while a text field or the slider has the focus. */
function ignoresKeys(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target instanceof HTMLInputElement
    ? target.type === 'range' || target.type === 'text'
    : target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

interface StepButtonProps {
  label: string;
  /** Looks and acts disabled but keeps the focus (`aria-disabled`, not `disabled`). */
  off: boolean;
  onClick: () => void;
  children: ReactNode;
}

function StepButton({ label, off, onClick, children }: StepButtonProps) {
  return (
    <button
      type="button"
      className={cx(styles.step, off && styles.off)}
      aria-label={label}
      aria-disabled={off ? 'true' : undefined}
      onClick={() => {
        if (!off) onClick();
      }}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------------------------
// "Check the shuffle" (§16.3)

/** The row's data and its check, made by the screen from the hand (the seed stays out of view). */
interface ShuffleProps {
  row: ShuffleRow;
  check: () => Promise<ShuffleCheck>;
}

const SHUFFLE_SAYS: Record<Exclude<ShuffleCheck['status'], 'ok'>, string> = {
  code: enReview.shuffle.badCode,
  cards: enReview.shuffle.badCards,
  broken: enReview.shuffle.broken,
  none: enReview.shuffle.none,
  insecure: enReview.shuffle.insecure,
};

/**
 * The shuffle code and the seed, "Check the shuffle", and its answer: ✓ with the deck the hand was
 * dealt from, or ✗ and why. On a plain-http page, or for a hand without a code, one line says so.
 */
function Shuffle({ row, check }: ShuffleProps) {
  const T = enReview.shuffle;
  const deckId = useId();
  const [result, setResult] = useState<ShuffleCheck | null>(null);
  if (row.kind !== 'code') {
    return (
      <section className={styles.shuffle} aria-label={T.title} data-shuffle={row.kind}>
        <p className={styles.hint}>{row.kind === 'insecure' ? T.insecure : T.none}</p>
      </section>
    );
  }
  const run = (): void => {
    void check().then(setResult);
  };
  const ok = result?.status === 'ok' ? result : null;
  const says = result === null ? '' : result.status === 'ok' ? T.ok : SHUFFLE_SAYS[result.status];
  return (
    <section
      className={styles.shuffle}
      aria-label={T.title}
      data-shuffle={result?.status ?? 'code'}
    >
      <dl className={styles.codes}>
        <div>
          <dt>{T.code}</dt>
          <dd className={styles.hex}>{row.commit}</dd>
        </div>
        <div>
          <dt>{T.seed}</dt>
          <dd className={styles.hex}>{row.seed}</dd>
        </div>
      </dl>
      <p className={styles.hint}>{T.saved}</p>
      <button type="button" className={styles.check} onClick={run}>
        {T.check}
      </button>
      <p
        className={styles.verdict}
        data-good={result === null ? undefined : String(ok !== null)}
        aria-live="polite"
      >
        {says}
      </p>
      {ok !== null && (
        <>
          <p id={deckId} className={styles.deckTitle}>
            {T.deck}
          </p>
          <ol className={styles.deck} aria-labelledby={deckId}>
            {ok.deck.map((card) => (
              <li key={card}>
                <Card card={card} size="sm" />
              </li>
            ))}
          </ol>
          {ok.reshuffled && <p className={styles.hint}>{T.reshuffled}</p>}
        </>
      )}
    </section>
  );
}

/** One hand, frame by frame. Mount it with `key={handSeq}`: a new hand starts at the deal. */
function Replay({ view, layout }: { view: ReviewReplay; layout: TableLayout }) {
  const last = view.frames.length - 1;
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const frame = view.frames[index] ?? view.frames[0];

  const go = useCallback(
    (to: number) => {
      setPlaying(false);
      setIndex(clamp(to, last));
    },
    [last],
  );
  const by = useCallback(
    (delta: number) => {
      setPlaying(false);
      setIndex((i) => clamp(i + delta, last));
    },
    [last],
  );

  // Auto-play: one step every AUTOPLAY_MS, a chain of timeouts that stops at the last step. It
  // only moves the picture; it never touches the game (§0.3 "Time").
  useEffect(() => {
    if (!playing) return;
    if (index >= last) {
      setPlaying(false);
      return;
    }
    const id = setTimeout(() => setIndex((i) => clamp(i + 1, last)), AUTOPLAY_MS);
    return () => clearTimeout(id);
  }, [playing, index, last]);

  // Keyboard (§12.12): ← → step, Home and End jump. Native controls keep their own keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || ignoresKeys(e.target)) return;
      if (e.key === 'ArrowRight') by(1);
      else if (e.key === 'ArrowLeft') by(-1);
      else if (e.key === 'Home') go(0);
      else if (e.key === 'End') go(last);
      else return;
      e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [by, go, last]);

  const togglePlay = (): void => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (index >= last) setIndex(0);
    setPlaying(true);
  };

  if (frame === undefined) return null;
  const lines = frameLines(view, frame);
  const label = stepLabel(index, last);
  const landscape = layout === 'landscape';
  return (
    <>
      <div className={styles.area}>
        <ReviewTable
          frame={frame}
          opponents={view.opponents}
          layout={layout}
          handSeq={view.handSeq}
          label={enReview.title(formatChips(view.handNumber))}
        />
      </div>
      {!landscape && frame.hero !== null && (
        <div className={styles.heroSlot}>
          <ReviewHero hero={frame.hero} handSeq={view.handSeq} compact={layout === 'compact'} />
        </div>
      )}
      {/* Stage 6.1 adds a hero decision's grade, win chance and the coach's move to its step here. */}
      <div className={styles.story} role="status" aria-atomic="true">
        <span className={screen.srOnly}>{label}. </span>
        {lines.map((line, i) => (
          <p key={i} className={i === 0 ? styles.lineMain : styles.line}>
            {line}
          </p>
        ))}
      </div>
      <div className={styles.controls}>
        <div className={styles.scrub}>
          <input
            type="range"
            className={styles.slider}
            min={0}
            max={last}
            step={1}
            value={index}
            aria-label={enReview.steps.slider}
            aria-valuetext={label}
            onChange={(e) => go(Number(e.currentTarget.value))}
          />
          <span className={styles.count} aria-hidden="true">
            {label}
          </span>
        </div>
        <div className={styles.buttons} role="group" aria-label={enReview.steps.group}>
          <StepButton label={enReview.steps.first} off={index === 0} onClick={() => go(0)}>
            <FirstIcon />
          </StepButton>
          <StepButton label={enReview.steps.prev} off={index === 0} onClick={() => by(-1)}>
            <PrevIcon />
          </StepButton>
          <button type="button" className={styles.play} onClick={togglePlay}>
            {playing ? <PauseIcon /> : <PlayIcon />}
            <span>{playing ? enReview.steps.pause : enReview.steps.play}</span>
          </button>
          <StepButton label={enReview.steps.next} off={index === last} onClick={() => by(1)}>
            <NextIcon />
          </StepButton>
          <StepButton label={enReview.steps.last} off={index === last} onClick={() => go(last)}>
            <LastIcon />
          </StepButton>
        </div>
      </div>
    </>
  );
}

/** A hand that cannot be replayed (§4.7): why, and how it ended. */
function SummaryOnly({ view }: { view: ReviewSummary }) {
  return (
    <div className={styles.summaryOnly}>
      <p className={styles.lineMain}>
        {view.reason === 'version' ? enReview.version : enReview.broken}
      </p>
      {[...handEndLines(view.end), netSpoken(view.end.heroNet)].map((line, i) => (
        <p key={i} className={styles.line}>
          {line}
        </p>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// The screen

export function ReviewRoute() {
  const dispatch = useDispatch();
  const layout = useTableLayout();
  const wide = layout === 'wide';
  const items = useAppStore(selectReviewList);
  const hand = useAppStore(selectReviewHand);
  const view = useMemo(() => (hand === null ? null : buildReview(hand)), [hand]);
  // §16.3: the shuffle row's data. The check is a lazy chunk, loaded when asked for; when it
  // cannot load (offline and not cached) the row says the hand cannot be checked.
  const shuffle = useMemo<ShuffleProps | null>(
    () =>
      hand === null
        ? null
        : {
            row: shuffleRowOf(hand),
            check: () =>
              loadShuffleCheck().then(
                (m) => m.checkShuffle(m.shuffleInputOf(hand)),
                (): ShuffleCheck => ({ status: 'broken' }),
              ),
          },
    [hand],
  );
  const open = useCallback(
    (handSeq: number | null) => dispatch({ type: 'review', handSeq }),
    [dispatch],
  );
  const back = useCallback(() => dispatch({ type: 'back' }), [dispatch]);

  // Wide screens show the list beside a replay, so there is always one: the newest hand.
  const newest = items[0]?.handSeq ?? null;
  useEffect(() => {
    if (wide && view === null && newest !== null) open(newest);
  }, [wide, view, newest, open]);

  // A change of page (list ↔ replay on a phone) moves the focus to its heading (§12.12).
  const heading = useRef<HTMLHeadingElement>(null);
  const page = wide ? 'wide' : view === null ? 'list' : String(view.handSeq);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [page]);

  const title = view === null ? enReview.listTitle : enReview.title(formatChips(view.handNumber));
  const replay = view?.replayable === true ? view : null;
  const showList = wide ? items.length > 0 : view === null && items.length > 0;
  // The replay fills the screen as one grid; the shuffle row comes after it, below the fold on a
  // phone, so it never takes height from the table.
  return (
    <main className={styles.page} data-layout={layout} data-review={REVIEW_MARKER}>
      <div className={cx(styles.review, styles[layout], replay === null && styles.plain)}>
        <header className={styles.top}>
          <button type="button" className={cx(screen.back, styles.back)} onClick={back}>
            <ChevronLeftIcon />
            <span>{en.back}</span>
          </button>
          <h1 ref={heading} tabIndex={-1} className={styles.title}>
            {title}
          </h1>
          {view !== null && !wide ? (
            <button type="button" className={styles.allHands} onClick={() => open(null)}>
              {enReview.allHands}
            </button>
          ) : (
            <span aria-hidden="true" />
          )}
        </header>
        {replay !== null && <Replay key={replay.handSeq} view={replay} layout={layout} />}
        {view !== null && !view.replayable && <SummaryOnly view={view} />}
        {items.length === 0 && <Empty onBack={back} />}
        {showList && (
          <section className={styles.listSlot} aria-label={enReview.listTitle}>
            {wide && <h2 className={styles.listTitle}>{enReview.listTitle}</h2>}
            <HandList items={items} current={view?.handSeq ?? null} onOpen={open} />
          </section>
        )}
      </div>
      {replay !== null && shuffle !== null && (
        <Shuffle key={replay.handSeq} row={shuffle.row} check={shuffle.check} />
      )}
    </main>
  );
}
