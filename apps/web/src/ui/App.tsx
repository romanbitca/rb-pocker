/**
 * The app (PLAN §12.1): the screens and overlays of the store's `Nav`, each wired to the store
 * here, plus what sits over every screen (the SVG sprite, toasts, the storage banner).
 *
 * - ⚠️ One tap to play: Welcome's and Home's Play dispatch `play` straight from the tap; the
 *   controller deals at once and shows the Table, with nothing in between (§12.1, Stage 3
 *   acceptance 9).
 * - The first screen is Welcome or Home; everything after a tap (the Table, Setup, Settings, the
 *   Menu, the §3.1 dialogs) is one lazy chunk, `screensEntry.tsx`, asked for as soon as the first
 *   screen is painted (`usePreloadScreens`), so it is there before the first tap (§15.3).
 * - The UI talks to the game only through the store (`useAppStore`, `dispatch`, §2.1): screens
 *   stay presentational; the small wrappers below (and in `screensEntry.tsx`) give them their
 *   props.
 * - The level cards (Setup, Settings) offer `AVAILABLE_LEVELS`; a choice is saved with the settings
 *   (`pc.v1.profile`) and starts with the next table, hand or decision (§10).
 * - Motion (§12.8): `--speed` on the root element follows the speed setting (Normal 1, Fast 0.5,
 *   Instant 0); `data-motion` follows "reduce motion" (the system's choice unless the setting says
 *   otherwise), and `data-deck="two"` the two-colour deck.
 */
import { lazy, Suspense, useCallback, useEffect, useRef } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import {
  selectBotCard,
  selectNav,
  selectReadOnly,
  selectSessionLine,
  selectToasts,
  useAppStore,
  useDispatch,
  type Nav,
  type Speed,
} from '../app/store.ts';
import { en } from '../i18n/en.ts';
import { LoadBoundary } from './components/LoadBoundary.tsx';
import { StorageBanner, Toasts } from './components/Notices.tsx';
import { SvgSprite } from './components/SvgSprite.tsx';
import { Home } from './screens/Home.tsx';
import { ScreenSwitcher } from './screens/ScreenSwitcher.tsx';
import screenStyles from './screens/Screen.module.css';
import { Welcome } from './screens/Welcome.tsx';
import { usePreloadScreens, useScreens, type ScreensModule } from './screensModule.ts';

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
  const readOnly = useAppStore(selectReadOnly);
  return (
    <Home
      session={session}
      onPlay={() => dispatch({ type: 'play' })}
      onNewTable={() => dispatch({ type: 'go', screen: 'setup' })}
      onOpenSettings={() => dispatch({ type: 'go', screen: 'settings' })}
      onOpenStats={() => dispatch({ type: 'go', screen: 'stats' })}
      onPlayHere={readOnly ? () => dispatch({ type: 'playHere' }) : undefined}
    />
  );
}

// The screens after the first tap are in the lazy chunk (`screensEntry.tsx`, see the module note).

type LaterScreenName = 'TableScreen' | 'SetupScreen' | 'SettingsScreen';

/**
 * A screen from the lazy chunk. It is almost always loaded already and renders at once. Only a
 * tap before the chunk has arrived (a first visit on a slow network) shows the page's background
 * for that moment, with a "Loading…" line that CSS shows only after half a second, so a short wait
 * shows nothing; the screen then takes the focus that ScreenSwitcher gives a new screen's heading
 * (§12.12). If the chunk cannot load: a line, Try again and Back.
 */
function LaterScreen({ name }: { name: LaterScreenName }) {
  const { mod, failed } = useScreens();
  const waited = useRef(mod === null);
  useEffect(() => {
    if (mod === null || !waited.current) return;
    waited.current = false;
    const focused = document.activeElement;
    if (focused !== null && focused !== document.body) return;
    const heading = document.querySelector<HTMLElement>('[data-screen] h1');
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }, [mod]);
  if (mod === null) {
    return failed ? (
      <ScreenFailed />
    ) : (
      <div className={screenStyles.page}>
        <p className={`${screenStyles.hint} ${screenStyles.later}`}>{en.screens.loading}</p>
      </div>
    );
  }
  const Screen: ScreensModule[LaterScreenName] = mod[name];
  return <Screen />;
}

/**
 * The chunk could not be loaded (no connection and not cached yet): say so, try again or leave.
 * Try again reloads the page, the sure way to load a module again once it has failed (a browser
 * may keep the failure until then); the game loses nothing (the session is saved after every step,
 * §14.5), and Home's Play goes on.
 */
function ScreenFailed() {
  const dispatch = useDispatch();
  return (
    <main className={screenStyles.page}>
      <p className={screenStyles.hint} role="alert">
        {en.screens.loadFailed}
      </p>
      <button
        type="button"
        className={screenStyles.primary}
        onClick={() => window.location.reload()}
      >
        {en.screens.tryAgain}
      </button>
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

/** An overlay from the lazy chunk; nothing until it is there (it opens only over its screens). */
function LaterOverlay({ name }: { name: 'MenuOverlay' | 'OutOfChipsOverlay' | 'NewTableOverlay' }) {
  const { mod } = useScreens();
  if (mod === null) return null;
  const Overlay = mod[name];
  return <Overlay />;
}

// Review (§12.10) is loaded when it is first opened: a dynamic `import()` keeps the screen out of
// the initial bundle (§15.3; its styles are in the one stylesheet). The service worker still
// precaches it, so it opens offline.
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

// Stats (§14.4, chunk 8.2) is lazy like Review: the screen, its charts and its words are a chunk
// of their own, loaded when Stats is first opened (§15.3), and precached.
const StatsLazy = lazy(async () => {
  try {
    const { StatsRoute } = await import('./screens/Stats.tsx');
    return { default: StatsRoute };
  } catch {
    return { default: StatsFailed };
  }
});

/**
 * While the Stats chunk loads (its heading, so the focus has somewhere to go, and "Loading…" after
 * half a second, as for the screens after the first tap), or when it cannot load (a line and Back).
 */
function StatsWaiting({ failed }: { failed: boolean }) {
  const dispatch = useDispatch();
  return (
    <main className={screenStyles.page}>
      <h1 className={screenStyles.title}>{en.stats.title}</h1>
      {failed ? (
        <>
          <p className={screenStyles.hint} role="alert">
            {en.screens.loadFailed}
          </p>
          <button
            type="button"
            className={screenStyles.secondary}
            onClick={() => dispatch({ type: 'back' })}
          >
            {en.back}
          </button>
        </>
      ) : (
        <p className={`${screenStyles.hint} ${screenStyles.later}`}>{en.screens.loading}</p>
      )}
    </main>
  );
}

const StatsFailed = () => <StatsWaiting failed />;

/** The Stats screen over its lazy chunk; a render error leaves it (Back), as for Review. */
function StatsScreen() {
  const dispatch = useDispatch();
  const leave = useCallback(() => dispatch({ type: 'back' }), [dispatch]);
  return (
    <LoadBoundary onError={leave}>
      <Suspense fallback={<StatsWaiting failed={false} />}>
        <StatsLazy />
      </Suspense>
    </LoadBoundary>
  );
}

const SCREENS = {
  welcome: () => <WelcomeScreen />,
  home: () => <HomeScreen />,
  setup: () => <LaterScreen name="SetupScreen" />,
  table: () => <LaterScreen name="TableScreen" />,
  settings: () => <LaterScreen name="SettingsScreen" />,
  review: () => <ReviewScreen />,
  stats: () => <StatsScreen />,
} as const;

/**
 * §14.7: a read-only tab (another tab has the game) shows Home, whose §12.11 banner and "Play
 * here" replace Play: the game screens are not shown. The controller goes Home too.
 */
const READ_ONLY_NAV: Nav = { screens: ['home'], overlays: [] };

// ---------------------------------------------------------------------------------------------
// Overlays wired to the store (the Menu and the §3.1 dialogs are in the lazy chunk; the rankings
// drawer and the sizing tray belong to the Table)

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
        <BotCardSheet
          card={card}
          onLevel={(level) => dispatch({ type: 'seatLevel', seat: card.seat, level })}
          onClose={close}
        />
      </Suspense>
    </LoadBoundary>
  );
}

const OVERLAYS = {
  menu: () => <LaterOverlay name="MenuOverlay" />,
  outOfChips: () => <LaterOverlay name="OutOfChipsOverlay" />,
  newTable: () => <LaterOverlay name="NewTableOverlay" />,
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
  usePreloadScreens();
  const nav = useAppStore(selectNav);
  const readOnly = useAppStore(selectReadOnly);

  return (
    <>
      <SvgSprite />
      <ScreenSwitcher nav={readOnly ? READ_ONLY_NAV : nav} screens={SCREENS} overlays={OVERLAYS} />
      <NoticeLayer />
    </>
  );
}
