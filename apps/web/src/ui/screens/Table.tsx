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
 * only when its own view changes, and nothing here reads the `equity` slice. The coach's places
 * (the portrait coach strip, the landscape coach rows, the wide inline panel) stay empty until
 * Stage 5.
 */
import { memo, useCallback, useEffect, useId, useMemo, useRef, type CSSProperties } from 'react';
import {
  selectActionBarInput,
  selectBoardView,
  selectHandEnd,
  selectHeroHandView,
  selectHeroView,
  selectLayout,
  selectOverlayOpen,
  selectPotView,
  selectSeatViews,
  selectTableInfo,
  useAppStore,
  useDispatch,
  useOverlay,
  type ActionBarInputData,
} from '../../app/store.ts';
import type { PlayerAction } from '../../engine/types.ts';
import { en } from '../../i18n/en.ts';
import { actionBarView, useSizing } from '../actionBar.ts';
import { ActionBar } from '../components/ActionBar.tsx';
import { Board } from '../components/Board.tsx';
import { HandEndBanner } from '../components/HandEndBanner.tsx';
import { HandsTab } from '../components/HandsTab.tsx';
import { HeroCards, HeroChips, HeroLabel } from '../components/HeroStrip.tsx';
import { Pot } from '../components/Pot.tsx';
import { RankingsColumn } from '../components/RankingsColumn.tsx';
import { RankingsDrawer } from '../components/RankingsDrawer.tsx';
import { Seat } from '../components/Seat.tsx';
import { SizingTray } from '../components/SizingTray.tsx';
import { ICONS, SpriteIcon } from '../components/SvgSprite.tsx';
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
  onToggleHands: () => void;
}

/** ☰ · "Blinds 10/20 · Hand 12" · Hands (§12.3). The mute button arrives with sound (Stage 9). */
const TopBar = memo(function TopBar({ handsExpanded, onToggleHands }: TopBarProps) {
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
      <button
        type="button"
        className={styles.handsButton}
        aria-label={en.rankings.open}
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

const SeatsLayer = memo(function SeatsLayer({ geometry }: { geometry: TableGeometry }) {
  const seats = useAppStore(selectSeatViews);
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
  return useMemo(() => {
    if (view === null) return null;
    const lines = handEndLines(view);
    return lines.length === 0 ? null : lines;
  }, [view]);
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
// The hero strip (portrait, compact, wide) and the landscape column's head

const HeroStrip = memo(function HeroStrip({
  layout,
  onOpenRankings,
}: {
  layout: TableLayout;
  onOpenRankings: () => void;
}) {
  const hero = useAppStore(selectHeroView);
  return (
    <section className={styles.hero} aria-label={en.table.yourHand}>
      {hero !== null && (
        <>
          <div className={styles.heroLeft}>
            <HeroCards key={hero.handSeq} hero={hero} size={layout === 'compact' ? 'xl' : 'xxl'} />
            <HeroChips hero={hero} />
          </div>
          <HeroLabel hero={hero} onOpenRankings={onOpenRankings} className={styles.heroLabel} />
        </>
      )}
    </section>
  );
});

/** Landscape: the label and chips head the right column; hidden while the tray is open. */
const SideHero = memo(function SideHero({ onOpenRankings }: { onOpenRankings: () => void }) {
  const hero = useAppStore(selectHeroView);
  const trayOpen = useAppStore(selectOverlayOpen('tray'));
  if (hero === null || trayOpen) return null;
  return (
    <section className={styles.sideHero} aria-label={en.table.yourHand}>
      <HeroLabel hero={hero} onOpenRankings={onOpenRankings} />
      <HeroChips hero={hero} />
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
const ActionArea = memo(function ActionArea({ layout }: { layout: TableLayout }) {
  const dispatch = useDispatch();
  const input = useAppStore(selectActionBarInput);
  const view = useMemo(() => actionBarView(input ?? NO_HAND), [input]);
  const sizing = useSizing(view.tray);
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
          className={placement === 'overlay' ? styles.trayOverlay : undefined}
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
        layout={layout === 'landscape' ? 'column' : 'row'}
      />
    </div>
  );
});

// ---------------------------------------------------------------------------------------------
// The hand rankings: a drawer on phones, a column on wide screens (§13.1)

/** Fills the area the drawer may cover: above the action bar (portrait), the table column (landscape). */
const DrawerHost = memo(function DrawerHost() {
  const [open, setOpen] = useOverlay('rankings');
  const hero = useAppStore(selectHeroHandView);
  const onOpenChange = useCallback((next: boolean) => setOpen(next), [setOpen]);
  return (
    <div className={styles.drawerHost}>
      <RankingsDrawer open={open} onOpenChange={onOpenChange} hero={hero} />
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
  return (
    <div className={styles.rankings}>
      <RankingsColumn hero={hero} collapsed={collapsed} onCollapsedChange={onCollapsedChange} />
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
  // would keep the `sheet` gate closed with nothing on screen to close it.
  useEffect(() => {
    if (wide && drawerOpen) setDrawerOpen(false);
  }, [wide, drawerOpen, setDrawerOpen]);

  return (
    <main
      className={cx(styles.table, styles[layout], wide && collapsed && styles.collapsed)}
      data-layout={layout}
    >
      <h1 className={styles.srOnly}>{en.table.heading}</h1>
      <TopBar handsExpanded={wide ? !collapsed : drawerOpen} onToggleHands={toggleHands} />
      <TableArea layout={layout} />
      {landscape ? (
        <aside className={styles.side}>
          <SideHero onOpenRankings={openRankings} />
          <div className={styles.sideMiddle}>
            <SideBanner />
          </div>
          <ActionArea layout={layout} />
        </aside>
      ) : (
        <>
          <HeroStrip layout={layout} onOpenRankings={openRankings} />
          {layout === 'portrait' && <div className={styles.coach} />}
          <ActionArea layout={layout} />
        </>
      )}
      {wide ? (
        <RankingsPanel collapsed={collapsed} onCollapsedChange={setCollapsed} />
      ) : (
        <DrawerHost />
      )}
    </main>
  );
}
