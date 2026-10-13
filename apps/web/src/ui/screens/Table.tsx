/**
 * The Table (PLAN §12.3–§12.9, §13.1): where the game is played, in three layouts (§12.3):
 * - `portrait` (phones; the design target): top bar · table · hero strip · coach strip · tray and
 *   action bar, in one CSS grid that never scrolls. `compact` is portrait at most 640 px tall
 *   (e.g. iPhone SE): smaller hero cards, no coach strip row, and the sizing tray overlays the
 *   bottom of the table instead of pushing rows (§12.3).
 * - `landscape` (phones on their side): the table column (36 px top bar, the hero's cards inset at
 *   the bottom of the felt) and a 280 px right column with the hand label, then the tray and
 *   Fold / Call / Raise stacked under the right thumb (§12.5).
 * - `wide` (desktop, tablet landscape): the portrait column beside the persistent hand-rankings
 *   column (§12.5, §13.1).
 *
 * Seats, bets, the board and the pot are placed by `tableGeometry()` (layout/seats.ts) in the
 * measured table box (minus the Hands edge tab's 28 px gutter in portrait and landscape).
 *
 * Every part subscribes to the store with its own narrow selector (pitfall 37): a seat re-renders
 * only when its own view changes. Only the HUD slots read the `equity` slice (the win badge, the
 * draw chips, the big-move line, the nuts suffix and the "By river" column; the all-in TV-mode bars
 * and the banner's luck line, `components/Runout.tsx`), so equity progress re-renders the badge and
 * nothing else.
 *
 * The coach (chunk 5.9, §12.5, §12.6): the portrait strip under the hero strip, the compact
 * "Coach" pill in the hero strip, the landscape column's coach rows and the wide inline panel;
 * the sheet opens over everything above the action bar. Its words and the sheet are a lazy chunk
 * (`ui/coachModule.ts`), asked for when the Table mounts. The action bar's ring and the tray's
 * coach amount come from `coachAdvice` (no words).
 *
 * Undo and the feedback card (§11, §12.3, §12.6; chunk 6.2): the toolbar Undo sits at the left of
 * the coach strip (portrait), of the coach row (landscape's column, the wide screen's panel head),
 * and in the top bar in compact mode; the feedback card covers everything above the action bar
 * (the table column in landscape) with a 25% scrim while the game waits for Undo or Keep my move.
 */
import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  type CSSProperties,
  type MutableRefObject,
} from 'react';
import {
  selectActionBarInput,
  selectBigMove,
  selectBoardView,
  selectByRiver,
  selectCoach,
  selectCoachLevel,
  selectDrawChips,
  selectFeedback,
  selectHandEnd,
  selectHeroHandView,
  selectHeroView,
  selectLayout,
  selectNuts,
  selectOverlayOpen,
  selectPotView,
  selectSeatViews,
  selectTableInfo,
  selectUndoButton,
  selectWinBadge,
  useAppStore,
  useDispatch,
  useOverlay,
  type ActionBarInputData,
  type AppState,
} from '../../app/store.ts';
import type { PlayerAction } from '../../engine/types.ts';
import { en } from '../../i18n/en.ts';
import { actionBarView, useSizing } from '../actionBar.ts';
import { coachAdvice } from '../coachAdvice.ts';
import { loadCoach, useCoachModule, useCoachView } from '../coachModule.ts';
import { ActionBar } from '../components/ActionBar.tsx';
import { Board } from '../components/Board.tsx';
import type { StripVariant } from '../components/CoachStrip.tsx';
import { DrawChips } from '../components/DrawChips.tsx';
import { HandEndBanner } from '../components/HandEndBanner.tsx';
import { HandsTab } from '../components/HandsTab.tsx';
import { HeroCards, HeroChips, HeroLabel } from '../components/HeroStrip.tsx';
import { LoadBoundary } from '../components/LoadBoundary.tsx';
import { Pot } from '../components/Pot.tsx';
import { RankingsColumn } from '../components/RankingsColumn.tsx';
import { RankingsDrawer } from '../components/RankingsDrawer.tsx';
import { RunoutBars, useLuckLine } from '../components/Runout.tsx';
import { Seat } from '../components/Seat.tsx';
import { SizingTray } from '../components/SizingTray.tsx';
import { ICONS, SpriteIcon } from '../components/SvgSprite.tsx';
import { UndoButton, useUndoKey } from '../components/UndoButton.tsx';
import { BigMoveLine, PriceChip, WinBadge, type BadgePlacement } from '../components/WinBadge.tsx';
import { bigMoveView, drawChipViews, priceChipView, useBadgeView } from '../equity.ts';
import { betChips, formatChips } from '../format.ts';
import { handEndLines } from '../handEnd.ts';
import { useElementSize, useMediaQuery } from '../hooks.ts';
import {
  BET,
  tableFrame,
  tableGeometry,
  type Rect,
  type Size,
  type TableGeometry,
  type TableLayout,
} from '../layout/seats.ts';
import { useHandsTabDot } from '../rankings.ts';
import styles from './Table.module.css';

const cx = (...names: (string | false | null | undefined)[]): string =>
  names.filter(Boolean).join(' ');

const at = (r: Rect): CSSProperties => ({ left: r.x, top: r.y, width: r.w, height: r.h });

/** §12.3 compact mode: portrait and at most 640 px tall. */
export const COMPACT_QUERY = '(max-height: 640px)';

/** The store's layout (the §12.3 media queries), plus compact mode. */
export function useTableLayout(): TableLayout {
  const layout = useAppStore(selectLayout);
  const short = useMediaQuery(COMPACT_QUERY);
  return layout === 'portrait' && short ? 'compact' : layout;
}

/** The table box before it can be measured: the §12.3 shell sizes for the window. */
function estimatedBox(): Size {
  const frame = tableFrame({ w: window.innerWidth, h: window.innerHeight });
  return { w: frame.box.w, h: frame.box.h };
}

// ---------------------------------------------------------------------------------------------
// Top bar

interface TopBarProps {
  handsExpanded: boolean;
  /** Wide screens: the button shows and hides the rankings column (else it opens the drawer). */
  handsColumn: boolean;
  onToggleHands: () => void;
  /** Compact mode: the toolbar Undo sits here, in place of the mute button (§12.3). */
  undo?: boolean;
}

/** ☰ · "Blinds 10/20 · Hand 12" · Hands (§12.3). The mute button arrives with sound (Stage 9). */
const TopBar = memo(function TopBar({
  handsExpanded,
  handsColumn,
  onToggleHands,
  undo = false,
}: TopBarProps) {
  const info = useAppStore(selectTableInfo);
  const [, setMenuOpen] = useOverlay('menu');
  const text =
    info === null
      ? ''
      : [
          en.table.blinds(formatChips(info.sb), formatChips(info.bb)),
          en.table.hand(formatChips(info.handNumber)),
        ].join(en.table.separator);
  return (
    <header className={styles.top}>
      <button
        type="button"
        className={styles.iconButton}
        aria-label={en.table.menu}
        aria-haspopup="dialog"
        onClick={(e) => {
          e.currentTarget.focus();
          setMenuOpen(true);
        }}
      >
        <SpriteIcon id={ICONS.menu} className={styles.icon} />
      </button>
      <p className={styles.info}>{text}</p>
      {undo && <UndoSlot />}
      <button
        type="button"
        className={styles.handsButton}
        aria-label={handsColumn && handsExpanded ? en.rankings.collapse : en.rankings.open}
        aria-expanded={handsExpanded}
        onClick={(e) => {
          e.currentTarget.focus();
          onToggleHands();
        }}
      >
        <span className={styles.handsFace}>{en.rankings.tab}</span>
      </button>
    </header>
  );
});

// ---------------------------------------------------------------------------------------------
// The table box: felt, seats, bets, board, pot, the hero's bet, the hand-end banner

/**
 * The opponents' pods. A tap on a pod opens its bot card (§9.3): the `botCard` command opens the
 * overlay, which closes the `sheet` gate (no bot acts behind the card). The card itself is mounted
 * by `App` only while it is open, so this adds no DOM to the table.
 */
const SeatsLayer = memo(function SeatsLayer({ geometry }: { geometry: TableGeometry }) {
  const seats = useAppStore(selectSeatViews);
  const dispatch = useDispatch();
  const openBotCard = useCallback(
    (seat: number) => dispatch({ type: 'botCard', seat }),
    [dispatch],
  );
  return (
    <>
      {seats.map((view, i) => {
        const pod = geometry.pods[i];
        const bet = geometry.bets[i];
        if (pod === undefined || bet === undefined) return null;
        return (
          <Seat
            key={view.seat}
            view={view}
            place={{ pod, bet, inner: geometry.inner[i] ?? 'right' }}
            onSelect={openBotCard}
          />
        );
      })}
    </>
  );
});

const BoardLayer = memo(function BoardLayer({ geometry }: { geometry: TableGeometry }) {
  const cards = useAppStore(selectBoardView);
  return <Board cards={cards} card={geometry.boardCard} place={geometry.board} />;
});

const PotLayer = memo(function PotLayer({ place }: { place: Rect }) {
  const pot = useAppStore(selectPotView);
  return pot === null ? null : <Pot pot={pot} place={place} />;
});

/** The hero's bet chip: at (50, 94) of the box (§12.4), kept above the hero's cards. */
export function heroBetRect(geometry: TableGeometry): Rect {
  const { size, hero } = geometry;
  const cy =
    geometry.layout === 'landscape'
      ? hero.y - BET.h / 2 - 6
      : Math.min(size.h * 0.94, size.h - hero.h - BET.h / 2 - 4);
  return {
    x: Math.round(size.w / 2 - BET.w / 2),
    y: Math.round(cy - BET.h / 2),
    w: BET.w,
    h: BET.h,
  };
}

const HeroBet = memo(function HeroBet({ geometry }: { geometry: TableGeometry }) {
  const bet = useAppStore((s) => selectHeroView(s)?.bet ?? 0);
  if (bet <= 0) return null;
  return (
    <span
      className={styles.bet}
      style={at(heroBetRect(geometry))}
      role="img"
      aria-label={en.table.yourBet(formatChips(bet))}
    >
      <span className={styles.betPill}>
        <SpriteIcon id={ICONS.chip} className={styles.chip} />
        {betChips(bet)}
      </span>
    </span>
  );
});

/** The banner's lines while the hand-end banner is up (mode `handEnd`), else null. */
function useHandEndLines(): readonly string[] | null {
  const view = useAppStore((s) => (s.game.mode === 'handEnd' ? selectHandEnd(s) : null));
  // After an all-in: the §7.6 luck line under the result (§12.9).
  const luck = useLuckLine();
  return useMemo(() => {
    if (view === null) return null;
    const lines = handEndLines(view);
    if (lines.length === 0) return null;
    return luck === null ? lines : [...lines, luck];
  }, [view, luck]);
}

/** The banner's box in the table: under the board, clear of the side pods; else above the pot. */
export function bannerStyle(geometry: TableGeometry): CSSProperties {
  const { size, board, pot, hero } = geometry;
  const width = Math.max(180, Math.min(360, size.w - 2 * 76));
  const left = Math.round((size.w - width) / 2);
  const top = board.y + board.h + 10;
  const room = size.h - hero.h - 4 - top;
  // About three lines and "Next hand ›" need ~110 px; otherwise it sits above the pot.
  if (room >= 110) return { position: 'absolute', left, top, width };
  return { position: 'absolute', left, width, bottom: size.h - pot.y + 6 };
}

const BannerLayer = memo(function BannerLayer({ geometry }: { geometry: TableGeometry }) {
  const lines = useHandEndLines();
  const dispatch = useDispatch();
  const next = useCallback(() => dispatch({ type: 'nextHand' }), [dispatch]);
  if (lines === null) return null;
  return <HandEndBanner lines={lines} onNext={next} style={bannerStyle(geometry)} />;
});

/** Landscape: the hero's cards inset at the bottom centre of the felt (§12.5). */
const HeroInset = memo(function HeroInset({ rect }: { rect: Rect }) {
  const hero = useAppStore(selectHeroView);
  return (
    <div className={styles.heroInset} style={at(rect)}>
      {hero !== null && <HeroCards key={hero.handSeq} hero={hero} size="xxl" />}
    </div>
  );
});

/** The Hands edge tab (§13.1), in the 28 px gutter at the right edge of the table. */
const TabSlot = memo(function TabSlot() {
  const [open, setOpen] = useOverlay('rankings');
  const hero = useAppStore(selectHeroHandView);
  const dot = useHandsTabDot(hero, open);
  const onOpen = useCallback(() => setOpen(true), [setOpen]);
  return (
    <div className={styles.tabSlot}>
      <HandsTab onOpen={onOpen} expanded={open} dot={dot} />
    </div>
  );
});

const TableArea = memo(function TableArea({ layout }: { layout: TableLayout }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const opponents = useAppStore((s) => selectTableInfo(s)?.opponents ?? 0);
  const fallback = useMemo(estimatedBox, []);
  const { w, h } = useElementSize(boxRef, fallback);
  const geometry = useMemo(
    () => (opponents >= 1 ? tableGeometry(layout, { w, h }, opponents) : null),
    [layout, w, h, opponents],
  );
  return (
    <div className={styles.area}>
      <div ref={boxRef} className={styles.box} data-table-box="">
        <div className={styles.felt} aria-hidden="true" />
        {geometry !== null && (
          <>
            <PotLayer place={geometry.pot} />
            <BoardLayer geometry={geometry} />
            <SeatsLayer geometry={geometry} />
            <HeroBet geometry={geometry} />
            <RunoutBars bets={geometry.bets} hero={heroBetRect(geometry)} />
            {layout === 'landscape' ? (
              <HeroInset rect={geometry.hero} />
            ) : (
              <BannerLayer geometry={geometry} />
            )}
          </>
        )}
      </div>
      {layout !== 'wide' && <TabSlot />}
    </div>
  );
});

// ---------------------------------------------------------------------------------------------
// The HUD: win badge, price chip, big-move line, draw chips (§7.6, §12.3). Each slot subscribes
// on its own: equity progress re-renders the badge only; a bet re-renders the price chip only.

const BadgeSlot = memo(function BadgeSlot({ placement }: { placement: BadgePlacement }) {
  const data = useAppStore(selectWinBadge);
  const view = useBadgeView(data);
  return view === null ? null : <WinBadge key={data.key} view={view} placement={placement} />;
});

const PriceSlot = memo(function PriceSlot({ canWin }: { canWin: boolean }) {
  const input = useAppStore(selectActionBarInput);
  const level = useAppStore(selectCoachLevel);
  const view = useMemo(() => priceChipView(input, level), [input, level]);
  if (view === null) return null;
  // Phones: "Pot you can win" is under the Call button already (§12.7), right below.
  return <PriceChip view={canWin ? view : { ...view, potYouCanWin: null }} />;
});

const MoveSlot = memo(function MoveSlot({ placement }: { placement: BadgePlacement }) {
  const move = useAppStore(selectBigMove);
  const view = useMemo(() => bigMoveView(move), [move]);
  return <BigMoveLine view={view} placement={placement} />;
});

/**
 * The badge column: the badge, the price chip under it, the big-move line by it. `compact`: the
 * 96 px strip of compact mode (§12.3), a 52 px badge.
 */
function OddsColumn({
  placement,
  canWin,
  compact = false,
  className,
}: {
  placement: BadgePlacement;
  canWin: boolean;
  compact?: boolean;
  className?: string | undefined;
}) {
  return (
    <div className={className} data-hero-odds="" data-compact={compact ? '' : undefined}>
      <BadgeSlot placement={placement} />
      <PriceSlot canWin={canWin} />
      <MoveSlot placement={placement} />
    </div>
  );
}

const DrawsSlot = memo(function DrawsSlot({
  max,
  placement,
  compact,
  className,
}: {
  max: number;
  placement: BadgePlacement;
  compact: boolean;
  className?: string | undefined;
}) {
  const data = useAppStore(selectDrawChips);
  const chips = useMemo(() => drawChipViews(data), [data]);
  return (
    <DrawChips
      chips={chips}
      max={max}
      placement={placement}
      compact={compact}
      className={className}
    />
  );
});

// ---------------------------------------------------------------------------------------------
// The hero strip (portrait, compact, wide) and the landscape column's head

const HeroStrip = memo(function HeroStrip({
  layout,
  onOpenRankings,
}: {
  layout: TableLayout;
  onOpenRankings: () => void;
}) {
  const hero = useAppStore(selectHeroView);
  const nuts = useAppStore(selectNuts);
  return (
    <section className={styles.hero} aria-label={en.table.yourHand}>
      {hero !== null && (
        <>
          <div className={styles.heroLeft}>
            <HeroCards key={hero.handSeq} hero={hero} size={layout === 'compact' ? 'xl' : 'xxl'} />
            <HeroChips hero={hero} />
          </div>
          <HeroLabel
            hero={hero}
            nuts={nuts}
            onOpenRankings={onOpenRankings}
            compact={layout === 'compact'}
            className={styles.heroLabel}
          />
          <OddsColumn
            placement="up"
            canWin={layout === 'wide'}
            compact={layout === 'compact'}
            className={styles.heroOdds}
          />
          <DrawsSlot
            max={layout === 'wide' ? 2 : 1}
            placement="up"
            compact={layout !== 'wide'}
            className={styles.heroDraws}
          />
          {/* Compact mode: the coach strip becomes a "Coach" pill here (§12.3). */}
          {layout === 'compact' && (
            <div className={styles.heroPill}>
              <CoachSlot variant="pill" />
            </div>
          )}
        </>
      )}
    </section>
  );
});

/**
 * Landscape: the label with the badge beside it, then the chips and the draw chips, heading the
 * right column (§12.5); hidden while the tray is open.
 */
const SideHero = memo(function SideHero({ onOpenRankings }: { onOpenRankings: () => void }) {
  const hero = useAppStore(selectHeroView);
  const nuts = useAppStore(selectNuts);
  const trayOpen = useAppStore(selectOverlayOpen('tray'));
  if (hero === null || trayOpen) return null;
  return (
    <section className={styles.sideHero} aria-label={en.table.yourHand}>
      <HeroLabel hero={hero} nuts={nuts} onOpenRankings={onOpenRankings} />
      <OddsColumn placement="down" canWin={true} className={styles.sideOdds} />
      <HeroChips hero={hero} />
      <DrawsSlot max={1} placement="down" compact={true} className={styles.sideDraws} />
    </section>
  );
});

/** Landscape: the hand-end banner in the right column, above the buttons. */
const SideBanner = memo(function SideBanner() {
  const lines = useHandEndLines();
  const dispatch = useDispatch();
  const next = useCallback(() => dispatch({ type: 'nextHand' }), [dispatch]);
  if (lines === null) return null;
  return <HandEndBanner lines={lines} onNext={next} />;
});

// ---------------------------------------------------------------------------------------------
// The coach (§10.2, §12.3, §12.5, §12.6)

/** "Use coach size" (§12.6): the action area puts its handler here for the sheet and the panels. */
type CoachSizeRef = MutableRefObject<(() => void) | null>;

/** The strip's taps: open the sheet, "Hint", "Tap to try again". */
function useCoachActions(): {
  onOpen: () => void;
  onHint: () => void;
  onRetry: () => void;
} {
  const dispatch = useDispatch();
  const [, setSheet] = useOverlay('coach');
  return useMemo(
    () => ({
      onOpen: () => {
        // Opening the sheet shows the hint too (it marks an Intermediate decision as helped).
        dispatch({ type: 'showHint' });
        setSheet(true);
      },
      onHint: () => dispatch({ type: 'showHint' }),
      onRetry: () => dispatch({ type: 'retryCoach' }),
    }),
    [dispatch, setSheet],
  );
}

/** The portrait strip (48 px), compact mode's pill, the landscape column's coach rows. */
const CoachSlot = memo(function CoachSlot({
  variant,
  wrap = false,
  collapse = false,
  className,
}: {
  variant: Exclude<StripVariant, 'header'>;
  wrap?: boolean;
  /** Nothing to say takes no space (the landscape column: the hand-end banner needs it). */
  collapse?: boolean;
  className?: string | undefined;
}) {
  const view = useCoachView();
  const mod = useCoachModule();
  const { onOpen, onHint, onRetry } = useCoachActions();
  if (collapse && (view === null || view.strip.kind === 'empty')) return null;
  // The strip is part of the coach's lazy chunk; until it is there its row stays empty.
  if (mod === null || view === null) {
    return variant === 'strip' ? <div className={className} /> : null;
  }
  return (
    <mod.CoachStrip
      view={view.strip}
      variant={variant}
      onOpen={onOpen}
      onHint={onHint}
      onRetry={onRetry}
      wrap={wrap}
      className={className}
    />
  );
});

/**
 * Landscape (§12.5): the coach rows under the label, the reason wrapping, the toolbar Undo at the
 * left of the first; "›" opens the sheet over the table column. The open sizing tray takes their
 * place (the hero is deciding then: nothing to undo).
 */
const SideCoach = memo(function SideCoach() {
  const trayOpen = useAppStore(selectOverlayOpen('tray'));
  if (trayOpen) return null;
  return (
    <div className={styles.sideCoach}>
      <UndoSlot className={styles.stripUndo} />
      <CoachSlot variant="strip" wrap collapse className={styles.coachSide} />
    </div>
  );
});

/**
 * The wide screen's inline coach panel (§12.5): the strip's content as its head row, then the
 * sheet's sections while the advice is on show (no sheet on wide screens), scrolling inside. Its
 * grid row has a fixed height, so the table never changes size with what the coach says (§15.3).
 * The toolbar Undo sits at the left of the head row, outside the scrolling part (chunk 6.2).
 */
const CoachPanel = memo(function CoachPanel({ coachSize }: { coachSize: CoachSizeRef }) {
  const view = useCoachView();
  const mod = useCoachModule();
  const { onOpen, onHint, onRetry } = useCoachActions();
  const onUseSize = useCallback(() => coachSize.current?.(), [coachSize]);
  const undo = <UndoSlot className={styles.panelUndo} />;
  // Nothing to say (or the chunk is still on its way): the panel's box, empty.
  if (mod === null || view === null || (view.strip.kind === 'empty' && view.hint === null)) {
    return (
      <div className={styles.coachBox}>
        {undo}
        <div className={styles.coachPanel} />
      </div>
    );
  }
  const details = view.shown && view.hint !== null;
  // With the sections under it, the head row says the action only (the reason follows below).
  const strip = details && view.strip.kind === 'advice' ? { ...view.strip, line: '' } : view.strip;
  return (
    <div className={styles.coachBox}>
      {undo}
      <section className={styles.coachPanel} aria-label={en.coachUi.title} data-coach-panel="">
        <mod.CoachStrip
          view={strip}
          variant="header"
          onOpen={onOpen}
          onHint={onHint}
          onRetry={onRetry}
        />
        {details && (
          <mod.CoachDetails
            view={view}
            place="panel"
            onUseSize={view.size === null ? null : onUseSize}
            className={styles.panelDetails}
          />
        )}
      </section>
    </div>
  );
});

/**
 * The coach sheet (§12.6), over everything above the action bar (the table column in landscape).
 * It closes when the advice goes (the hero acted, the hand moved on).
 */
const CoachSheetHost = memo(function CoachSheetHost({
  tall,
  coachSize,
}: {
  tall: boolean;
  coachSize: CoachSizeRef;
}) {
  const [open, setOpen] = useOverlay('coach');
  const view = useCoachView();
  const mod = useCoachModule();
  const ready = view !== null && view.shown && view.hint !== null;
  useEffect(() => {
    if (open && !ready) setOpen(false);
  }, [open, ready, setOpen]);
  const onClose = useCallback(() => setOpen(false), [setOpen]);
  const onUseSize = useCallback(() => {
    setOpen(false);
    coachSize.current?.();
  }, [setOpen, coachSize]);
  if (!open || !ready || mod === null) return null;
  return (
    <mod.CoachSheet
      view={view}
      onClose={onClose}
      onUseSize={view.size === null ? null : onUseSize}
      tall={tall}
    />
  );
});

// ---------------------------------------------------------------------------------------------
// The sizing tray and Row A

/** Row A while no hand is dealt: "Waiting…". */
const NO_HAND: ActionBarInputData = {
  legal: null,
  street: 'preflop',
  currentBet: 0,
  sb: 1,
  bb: 2,
  seats: [],
  amounts: 'chips',
};

/**
 * The tray and Row A share `useSizing` (§12.7). The tray is also the `tray` overlay of the
 * navigation model, so Android Back closes it before anything else (§12.1, Stage 3 acceptance 8):
 * it shows while both are open, and whichever closes first closes the other.
 */
const ActionArea = memo(function ActionArea({
  layout,
  coachSize,
}: {
  layout: TableLayout;
  coachSize: CoachSizeRef;
}) {
  const dispatch = useDispatch();
  const input = useAppStore(selectActionBarInput);
  const view = useMemo(() => actionBarView(input ?? NO_HAND), [input]);
  // The coach's advice while on show: the ring on Row A, the tray's start and its coach chip.
  const coach = useAppStore(selectCoach);
  const advice = useMemo(() => coachAdvice(coach), [coach]);
  const coachStart =
    advice.size !== null && view.tray !== null && advice.size.kind === view.tray.kind
      ? advice.size.to
      : null;
  const sizing = useSizing(view.tray, coachStart);
  const [trayShown, setTrayShown] = useOverlay('tray');
  const trayOpen = sizing.open && trayShown;
  const { openTray: openLocal, closeTray: closeLocal } = sizing;
  const trayId = useId();

  const openTray = useCallback(() => {
    openLocal();
    setTrayShown(true);
  }, [openLocal, setTrayShown]);
  const closeTray = useCallback(() => {
    closeLocal();
    setTrayShown(false);
  }, [closeLocal, setTrayShown]);
  // A new decision closes the tray (useSizing): take its overlay away too.
  useEffect(() => {
    if (trayShown && !sizing.open) setTrayShown(false);
  }, [trayShown, sizing.open, setTrayShown]);
  // Android Back closed the overlay: close the tray itself.
  useEffect(() => {
    if (!trayShown && sizing.open) closeLocal();
  }, [trayShown, sizing.open, closeLocal]);

  // "Use coach size" (§12.6): open the tray at the coach's amount (or move the open tray there).
  const setAmount = sizing.setAmount;
  useEffect(() => {
    coachSize.current =
      coachStart === null
        ? null
        : () => {
            if (trayOpen) setAmount(coachStart);
            else openTray();
          };
    return () => {
      coachSize.current = null;
    };
  }, [coachSize, coachStart, trayOpen, setAmount, openTray]);

  const act = useCallback((action: PlayerAction) => dispatch({ type: 'act', action }), [dispatch]);
  const placement = layout === 'landscape' ? 'panel' : layout === 'compact' ? 'overlay' : 'inline';
  return (
    <div className={styles.actions}>
      {trayOpen && view.tray !== null && (
        <SizingTray
          id={trayId}
          tray={view.tray}
          amount={sizing.amount}
          onAmount={sizing.setAmount}
          onClose={closeTray}
          placement={placement}
          coachAmount={coachStart}
          className={
            placement === 'overlay'
              ? styles.trayOverlay
              : placement === 'panel'
                ? styles.trayPanel
                : undefined
          }
        />
      )}
      <ActionBar
        view={view}
        trayOpen={trayOpen}
        amount={sizing.amount}
        trayId={trayId}
        onAct={act}
        onOpenTray={openTray}
        onCloseTray={closeTray}
        recommended={advice.ring}
        layout={layout === 'landscape' ? 'column' : 'row'}
      />
    </div>
  );
});

// ---------------------------------------------------------------------------------------------
// The hand rankings: a drawer on phones, a column on wide screens (§13.1)

/**
 * Fills the area the drawer and the coach sheet may cover: above the action bar (portrait), the
 * table column (landscape).
 */
const DrawerHost = memo(function DrawerHost({
  layout,
  coachSize,
}: {
  layout: TableLayout;
  coachSize: CoachSizeRef;
}) {
  const [open, setOpen] = useOverlay('rankings');
  const hero = useAppStore(selectHeroHandView);
  const byRiver = useAppStore(selectByRiver);
  // §10.2: the rankings' tips at Beginner; Intermediate collapses them.
  const tips = useAppStore(selectCoachLevel) === 'beginner';
  const onOpenChange = useCallback((next: boolean) => setOpen(next), [setOpen]);
  return (
    <div className={styles.drawerHost}>
      <RankingsDrawer
        open={open}
        onOpenChange={onOpenChange}
        hero={hero}
        byRiver={byRiver}
        showTips={tips}
      />
      <CoachSheetHost tall={layout === 'landscape'} coachSize={coachSize} />
    </div>
  );
});

const RankingsPanel = memo(function RankingsPanel({
  collapsed,
  onCollapsedChange,
}: {
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}) {
  const hero = useAppStore(selectHeroHandView);
  const byRiver = useAppStore(selectByRiver);
  const tips = useAppStore(selectCoachLevel) === 'beginner';
  return (
    <div className={styles.rankings}>
      <RankingsColumn
        hero={hero}
        collapsed={collapsed}
        onCollapsedChange={onCollapsedChange}
        byRiver={byRiver}
        showTips={tips}
      />
    </div>
  );
});

// ---------------------------------------------------------------------------------------------
// Undo and the feedback card (§11, §12.3, §12.6)

/** True while an overlay other than the sizing tray covers the table (U then does nothing). */
const selectCovered = (s: AppState): boolean => s.ui.overlays.some((o) => o !== 'tray');

/** The toolbar Undo for the coach level (§10.2), and its U key (§12.5). */
const UndoSlot = memo(function UndoSlot({ className }: { className?: string | undefined }) {
  const button = useAppStore(selectUndoButton);
  const covered = useAppStore(selectCovered);
  const dispatch = useDispatch();
  const onUndo = useCallback(() => dispatch({ type: 'undo' }), [dispatch]);
  useUndoKey(button === 'enabled' && !covered, onUndo);
  return button === 'hidden' ? null : (
    <UndoButton state={button} onUndo={onUndo} className={className} />
  );
});

const selectAmountUnit = (s: AppState): 'chips' | 'bb' => s.settings.amounts;

/**
 * The card's code (and the coach-line renderer it uses) is a lazy chunk, still precached for
 * offline play (§15.1): it shows only after a mistake, so the first paint does without it (§15.3).
 */
const FeedbackCard = lazy(() =>
  import('../components/FeedbackCard.tsx').then((m) => ({ default: m.FeedbackCard })),
);

/** The feedback card over everything above the action bar, while the game waits (§11.1). */
const FeedbackLayer = memo(function FeedbackLayer() {
  const open = useAppStore(selectOverlayOpen('feedback'));
  const view = useAppStore(selectFeedback);
  const unit = useAppStore(selectAmountUnit);
  const dispatch = useDispatch();
  const onUndo = useCallback(() => dispatch({ type: 'undo' }), [dispatch]);
  const onKeep = useCallback(() => dispatch({ type: 'keepMove' }), [dispatch]);
  if (!open || view === null) return null;
  return (
    <div className={styles.feedbackHost}>
      <div className={styles.feedbackScrim} aria-hidden="true" />
      {/* A chunk that cannot load keeps the move: the game never waits on it. */}
      <LoadBoundary onError={onKeep}>
        <Suspense fallback={null}>
          <FeedbackCard view={view} unit={unit} onUndo={onUndo} onKeep={onKeep} />
        </Suspense>
      </LoadBoundary>
    </div>
  );
});

// ---------------------------------------------------------------------------------------------
// The screen

export function Table() {
  const layout = useTableLayout();
  const wide = layout === 'wide';
  const landscape = layout === 'landscape';
  const dispatch = useDispatch();
  const [drawerOpen, setDrawerOpen] = useOverlay('rankings');
  const collapsed = useAppStore((s) => s.settings.handsPanel === 'collapsed');

  const setCollapsed = useCallback(
    (next: boolean) =>
      dispatch({ type: 'settings', patch: { handsPanel: next ? 'collapsed' : 'open' } }),
    [dispatch],
  );
  const openRankings = useCallback(() => {
    if (wide) setCollapsed(false);
    else setDrawerOpen(true);
  }, [wide, setCollapsed, setDrawerOpen]);
  const toggleHands = useCallback(() => {
    if (wide) setCollapsed(!collapsed);
    else setDrawerOpen(!drawerOpen);
  }, [wide, collapsed, drawerOpen, setCollapsed, setDrawerOpen]);

  // Wide screens have the column, not the drawer: a drawer left open by a rotation or a resize
  // would keep the `sheet` gate closed with nothing on screen to close it. The same for the coach
  // sheet: wide screens show the coach inline.
  const [coachOpen, setCoachOpen] = useOverlay('coach');
  useEffect(() => {
    if (wide && drawerOpen) setDrawerOpen(false);
    if (wide && coachOpen) setCoachOpen(false);
  }, [wide, drawerOpen, setDrawerOpen, coachOpen, setCoachOpen]);

  // The coach's words and sheet: a lazy chunk, asked for now, long before the first hint.
  useEffect(() => {
    void loadCoach().catch(() => {});
  }, []);
  const coachSize: CoachSizeRef = useRef<(() => void) | null>(null);

  return (
    <main
      className={cx(styles.table, styles[layout], wide && collapsed && styles.collapsed)}
      data-layout={layout}
    >
      <h1 className={styles.srOnly}>{en.table.heading}</h1>
      <TopBar
        handsExpanded={wide ? !collapsed : drawerOpen}
        handsColumn={wide}
        onToggleHands={toggleHands}
        undo={layout === 'compact'}
      />
      <TableArea layout={layout} />
      {landscape ? (
        <aside className={styles.side}>
          <SideHero onOpenRankings={openRankings} />
          <div className={styles.sideMiddle}>
            <SideCoach />
            <SideBanner />
          </div>
          <ActionArea layout={layout} coachSize={coachSize} />
        </aside>
      ) : (
        <>
          <HeroStrip layout={layout} onOpenRankings={openRankings} />
          {layout === 'portrait' && (
            <div className={styles.coach}>
              <UndoSlot className={styles.stripUndo} />
              <CoachSlot variant="strip" />
            </div>
          )}
          {wide && <CoachPanel coachSize={coachSize} />}
          <ActionArea layout={layout} coachSize={coachSize} />
        </>
      )}
      {wide ? (
        <RankingsPanel collapsed={collapsed} onCollapsedChange={setCollapsed} />
      ) : (
        <DrawerHost layout={layout} coachSize={coachSize} />
      )}
      <FeedbackLayer />
    </main>
  );
}
