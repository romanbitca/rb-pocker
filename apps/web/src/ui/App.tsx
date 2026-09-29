/**
 * The app (PLAN §12.1): the screens and overlays of the store's `Nav`, each wired to the store
 * here, plus what sits over every screen (the SVG sprite, toasts, the storage banner).
 *
 * - ⚠️ One tap to play: Welcome's and Home's Play dispatch `play` straight from the tap; the
 *   controller deals at once and shows the Table, with nothing in between (§12.1, Stage 3
 *   acceptance 9).
 * - The UI talks to the game only through the store (`useAppStore`, `dispatch`, §2.1): screens
 *   stay presentational; the small wrappers below give them their props.
 * - Motion (§12.8): `--speed` on the root element follows the speed setting (Normal 1, Fast 0.5,
 *   Instant 0); `data-motion` follows "reduce motion" (the system's choice unless the setting says
 *   otherwise), and `data-deck="two"` the two-colour deck.
 */
import { useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import {
  selectCanTopUp,
  selectCurrentTable,
  selectLayout,
  selectNav,
  selectSessionLine,
  selectToasts,
  useAppStore,
  useAppStoreShallow,
  useDispatch,
  type Speed,
} from '../app/store.ts';
import type { CoachLevel, TableConfig } from '../engine/types.ts';
import { StorageBanner, Toasts } from './components/Notices.tsx';
import { SvgSprite } from './components/SvgSprite.tsx';
import { NewTableDialog, OutOfChipsDialog } from './screens/Dialogs.tsx';
import { Home } from './screens/Home.tsx';
import { Menu } from './screens/Menu.tsx';
import { ScreenSwitcher } from './screens/ScreenSwitcher.tsx';
import { Settings } from './screens/Settings.tsx';
import { Setup } from './screens/Setup.tsx';
import type { AvailableLevels } from './screens/setupForm.ts';
import { Table } from './screens/Table.tsx';
import { Welcome } from './screens/Welcome.tsx';

/** §12.8: animation and pause factor per speed. */
const SPEED: Readonly<Record<Speed, number>> = { normal: 1, fast: 0.5, instant: 0 };

/** Stage 3 offers Easy bots and the Beginner coach only (§18); the other levels say "Coming soon". */
const STAGE_3_LEVELS: AvailableLevels = { bot: ['easy'], coach: ['beginner'] };

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
      available={STAGE_3_LEVELS}
      onStartTable={start}
      onBack={() => dispatch({ type: 'back' })}
    />
  );
}

function SettingsScreen() {
  const dispatch = useDispatch();
  const settings = useAppStoreShallow((s) => ({
    speed: s.settings.speed,
    autoNext: s.settings.autoNext,
    amounts: s.settings.amounts,
  }));
  return (
    <Settings
      settings={settings}
      onChangeSettings={(patch) => dispatch({ type: 'settings', patch })}
      onBack={() => dispatch({ type: 'back' })}
    />
  );
}

const SCREENS = {
  welcome: () => <WelcomeScreen />,
  home: () => <HomeScreen />,
  setup: () => <SetupScreen />,
  table: () => <Table />,
  settings: () => <SettingsScreen />,
} as const;

// ---------------------------------------------------------------------------------------------
// Overlays wired to the store (the rankings drawer and the sizing tray belong to the Table)

function MenuOverlay() {
  const dispatch = useDispatch();
  const canTopUp = useAppStore(selectCanTopUp);
  const startingStack = useAppStore((s) => selectCurrentTable(s)?.config.startingStack ?? null);
  const wide = useAppStore((s) => selectLayout(s) === 'wide');
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

const OVERLAYS = {
  menu: () => <MenuOverlay />,
  outOfChips: () => <OutOfChipsOverlay />,
  newTable: () => <NewTableOverlay />,
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
