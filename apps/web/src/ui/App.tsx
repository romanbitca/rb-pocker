/**
 * The app (PLAN §12.1): the screens and overlays of the store's `Nav`, each wired to the store
 * here, plus what sits over every screen (the SVG sprite, toasts, the storage banner).
 *
 * - ⚠️ One tap to play: Welcome's and Home's Play dispatch `play` straight from the tap; the
 *   controller deals at once and shows the Table, with nothing in between (§12.1, Stage 3
 *   acceptance 9).
 * - The UI talks to the game only through the store (`useAppStore`, `dispatch`, §2.1): screens
 *   stay presentational; the small wrappers below give them their props.
 * - The level cards (Setup, Settings) offer `AVAILABLE_LEVELS`; a choice is saved with the settings
 *   (`pc.v1.profile`) and starts with the next table, hand or decision (§10).
 * - Motion (§12.8): `--speed` on the root element follows the speed setting (Normal 1, Fast 0.5,
 *   Instant 0); `data-motion` follows "reduce motion" (the system's choice unless the setting says
 *   otherwise), and `data-deck="two"` the two-colour deck.
 */
import { lazy, Suspense, useCallback, useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import {
  selectBotCard,
  selectCanTopUp,
  selectCurrentTable,
  selectLayout,
  selectNav,
  selectReviewCount,
  selectSessionLine,
  selectToasts,
  useAppStore,
  useAppStoreShallow,
  useDispatch,
  type Speed,
} from '../app/store.ts';
import type { CoachLevel, TableConfig } from '../engine/types.ts';
import { en } from '../i18n/en.ts';
import { LoadBoundary } from './components/LoadBoundary.tsx';
import { StorageBanner, Toasts } from './components/Notices.tsx';
import { SvgSprite } from './components/SvgSprite.tsx';
import { NewTableDialog, OutOfChipsDialog } from './screens/Dialogs.tsx';
import { Home } from './screens/Home.tsx';
import { Menu } from './screens/Menu.tsx';
import { ScreenSwitcher } from './screens/ScreenSwitcher.tsx';
import screenStyles from './screens/Screen.module.css';
import { Settings } from './screens/Settings.tsx';
import { Setup } from './screens/Setup.tsx';
import { AVAILABLE_LEVELS } from './screens/setupForm.ts';
import { Table } from './screens/Table.tsx';
import { Welcome } from './screens/Welcome.tsx';

/** §12.8: animation and pause factor per speed. */
const SPEED: Readonly<Record<Speed, number>> = { normal: 1, fast: 0.5, instant: 0 };

/**
 * The bot card's code is a lazy chunk (still precached for offline play, §15.1): the main bundle
 * and the Table's DOM pay nothing for it until a seat is tapped (§15.3).
 */
const BotCardSheet = lazy(() =>
  import('./components/BotCard.tsx').then((m) => ({ default: m.BotCard })),
);

// ---------------------------------------------------------------------------------------------
// Screens wired to the store

function WelcomeScreen() {
  const dispatch = useDispatch();
  return (
    <Welcome
      onPlay={() => dispatch({ type: 'play' })}
      onSetup={() => dispatch({ type: 'go', screen: 'setup' })}
    />
  );
}

function HomeScreen() {
  const dispatch = useDispatch();
  const session = useAppStore(selectSessionLine);
  return (
    <Home
      session={session}
      onPlay={() => dispatch({ type: 'play' })}
      onNewTable={() => dispatch({ type: 'go', screen: 'setup' })}
      onOpenSettings={() => dispatch({ type: 'go', screen: 'settings' })}
    />
  );
}

function SetupScreen() {
  const dispatch = useDispatch();
  const initial = useAppStoreShallow((s) => ({
    players: s.settings.players,
    startingStack: s.settings.startingStack,
    bb: s.settings.bb,
    botLevel: s.settings.botLevel,
    coachLevel: s.settings.coachLevel,
  }));
  const start = (config: TableConfig, coachLevel: CoachLevel) =>
    dispatch({
      type: 'newTable',
      setup: {
        players: config.seatCount,
        startingStack: config.startingStack,
        sb: config.sb,
        bb: config.bb,
        botLevel: config.botLevel,
        seatLevels: config.seatLevels,
        coachLevel,
      },
    });
  return (
    <Setup
      initial={initial}
      available={AVAILABLE_LEVELS}
      onStartTable={start}
      onBack={() => dispatch({ type: 'back' })}
    />
  );
}

function SettingsScreen() {
  const dispatch = useDispatch();
  const settings = useAppStoreShallow((s) => ({
    coachLevel: s.settings.coachLevel,
    botLevel: s.settings.botLevel,
    speed: s.settings.speed,
    autoNext: s.settings.autoNext,
    amounts: s.settings.amounts,
  }));
  return (
    <Settings
      settings={settings}
      available={AVAILABLE_LEVELS}
      onChangeSettings={(patch) => dispatch({ type: 'settings', patch })}
      onBack={() => dispatch({ type: 'back' })}
    />
  );
}

// Review (§12.10) is loaded when it is first opened: a dynamic `import()` keeps the screen and its
// styles out of the initial bundle (§15.3). The service worker still precaches them, so it opens
// offline.
const ReviewLazy = lazy(async () => {
  try {
    const { ReviewRoute } = await import('./screens/Review.tsx');
    return { default: ReviewRoute };
  } catch {
    return { default: ReviewFailed };
  }
});

/** While the Review chunk loads: a heading (a screen change moves the focus to it) and one line. */
function ReviewLoading() {
  return (
    <main className={screenStyles.page}>
      <h1 className={screenStyles.title}>{en.review.screenTitle}</h1>
      <p className={screenStyles.hint}>{en.review.loading}</p>
    </main>
  );
}

/** The chunk could not be loaded (no connection and not cached yet): say so, and leave. */
function ReviewFailed() {
  const dispatch = useDispatch();
  return (
    <main className={screenStyles.page}>
      <h1 className={screenStyles.title}>{en.review.screenTitle}</h1>
      <p className={screenStyles.hint}>{en.review.loadFailed}</p>
      <button
        type="button"
        className={screenStyles.secondary}
        onClick={() => dispatch({ type: 'back' })}
      >
        {en.back}
      </button>
    </main>
  );
}

/**
 * The Review screen over its lazy chunk. A chunk that cannot load shows `ReviewFailed`; if the
 * screen throws while rendering, the boundary takes Back instead, so a bug in Review never takes
 * the game down with it.
 */
function ReviewScreen() {
  const dispatch = useDispatch();
  const leave = useCallback(() => dispatch({ type: 'back' }), [dispatch]);
  return (
    <LoadBoundary onError={leave}>
      <Suspense fallback={<ReviewLoading />}>
        <ReviewLazy />
      </Suspense>
    </LoadBoundary>
  );
}

const SCREENS = {
  welcome: () => <WelcomeScreen />,
  home: () => <HomeScreen />,
  setup: () => <SetupScreen />,
  table: () => <Table />,
  settings: () => <SettingsScreen />,
  review: () => <ReviewScreen />,
} as const;

// ---------------------------------------------------------------------------------------------
// Overlays wired to the store (the rankings drawer and the sizing tray belong to the Table)

function MenuOverlay() {
  const dispatch = useDispatch();
  const canTopUp = useAppStore(selectCanTopUp);
  const startingStack = useAppStore((s) => selectCurrentTable(s)?.config.startingStack ?? null);
  const wide = useAppStore((s) => selectLayout(s) === 'wide');
  const hands = useAppStore(selectReviewCount);
  const close = () => dispatch({ type: 'close', overlay: 'menu' });
  return (
    <Menu
      onResume={close}
      topUpTo={canTopUp ? startingStack : null}
      onTopUp={() => {
        dispatch({ type: 'topUp' });
        close();
      }}
      onOpenRankings={() => {
        close();
        if (wide) dispatch({ type: 'settings', patch: { handsPanel: 'open' } });
        else dispatch({ type: 'open', overlay: 'rankings' });
      }}
      onOpenHands={hands > 0 ? () => dispatch({ type: 'review', handSeq: null }) : undefined}
      onOpenSettings={() => dispatch({ type: 'go', screen: 'settings' })}
      onLeaveTable={() => dispatch({ type: 'leaveTable' })}
      onNewTable={() => dispatch({ type: 'go', screen: 'setup' })}
    />
  );
}

function OutOfChipsOverlay() {
  const dispatch = useDispatch();
  const startingStack = useAppStore((s) => selectCurrentTable(s)?.config.startingStack ?? 0);
  return (
    <OutOfChipsDialog
      startingStack={startingStack}
      onTopUp={() => dispatch({ type: 'reload' })}
      onChangeTable={() => dispatch({ type: 'changeTable' })}
    />
  );
}

function NewTableOverlay() {
  const dispatch = useDispatch();
  return (
    <NewTableDialog
      onConfirm={() => dispatch({ type: 'newTable', confirmed: true })}
      onCancel={() => dispatch({ type: 'close', overlay: 'newTable' })}
    />
  );
}

/**
 * A tapped seat's card (§9.3). ScreenSwitcher mounts this only while the `botCard` overlay is open;
 * the overlay keeps the `sheet` gate closed, so no bot acts behind it. If there is nothing to show
 * (the seat is gone) or the chunk cannot load, the overlay closes again: the gate never stays shut
 * over an empty screen.
 */
function BotCardOverlay() {
  const dispatch = useDispatch();
  const card = useAppStore(selectBotCard);
  const close = useCallback(() => dispatch({ type: 'close', overlay: 'botCard' }), [dispatch]);
  useEffect(() => {
    if (card === null) close();
  }, [card, close]);
  if (card === null) return null;
  return (
    <LoadBoundary onError={close}>
      <Suspense fallback={null}>
        <BotCardSheet card={card} onClose={close} />
      </Suspense>
    </LoadBoundary>
  );
}

const OVERLAYS = {
  menu: () => <MenuOverlay />,
  outOfChips: () => <OutOfChipsOverlay />,
  newTable: () => <NewTableOverlay />,
  botCard: () => <BotCardOverlay />,
} as const;

// ---------------------------------------------------------------------------------------------
// Over every screen

function NoticeLayer() {
  const dispatch = useDispatch();
  const toasts = useAppStore(selectToasts);
  const storageBanner = useAppStore((s) => s.ui.storageBanner);
  return (
    <>
      <Toasts toasts={toasts} onDismiss={(id) => dispatch({ type: 'dismissToast', id })} />
      {storageBanner && (
        <StorageBanner onDismiss={() => dispatch({ type: 'dismissStorageBanner' })} />
      )}
    </>
  );
}

/** `--speed`, `data-motion` and `data-deck` on the root element (see the module comment). */
function useDocumentMotion(): void {
  const speed = useAppStore((s) => s.settings.speed);
  const reduceMotion = useAppStore((s) => s.settings.reduceMotion);
  const fourColour = useAppStore((s) => s.settings.fourColour);
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--speed', String(SPEED[speed]));
    if (reduceMotion === 'system') delete root.dataset.motion;
    else root.dataset.motion = reduceMotion === 'on' ? 'reduced' : 'full';
    if (fourColour) delete root.dataset.deck;
    else root.dataset.deck = 'two';
  }, [speed, reduceMotion, fourColour]);
}

export function App() {
  // Registers the service worker (PLAN §15.1). Always called: React's rules of hooks forbid an
  // `if`, and it already does nothing where service workers are unavailable (insecure origins,
  // §12.14, app/secure.ts). The update and offline-ready toasts come later (chunk 9.5).
  useRegisterSW();
  useDocumentMotion();
  const nav = useAppStore(selectNav);

  return (
    <>
      <SvgSprite />
      <ScreenSwitcher nav={nav} screens={SCREENS} overlays={OVERLAYS} />
      <NoticeLayer />
    </>
  );
}
