/**
 * The screens after the first tap (PLAN §12.1, §15.3), wired to the store: the Table, Setup,
 * Settings, About, the hand drill's frame (§13.5: its page and logic are lazy chunks of their own),
 * and the overlays that open over them (the Table's Menu, the two §3.1 dialogs, and the Data
 * dialogs of §14.8: Import's preview and "Delete my stats", chunk 8.4).
 *
 * This file starts a lazy chunk. The first screen (Welcome or Home) does not need any of it, so
 * the initial bundle does not carry it. App loads it with `import()` (`ui/screensModule.ts`) right
 * after the first paint, long before anyone can tap Play, so one tap still deals a hand at once
 * (§12.1); the service worker precaches it like every chunk, so it also loads offline. About's own
 * page is one more chunk, asked for when About first opens (`ui/aboutModule.ts`, chunk 9.2c).
 */
import { useCallback } from 'react';
import {
  missingFeatures,
  secureFeatures,
  selectCanTopUp,
  selectCurrentTable,
  selectDiagnostics,
  selectHandInProgress,
  selectImportCheck,
  selectInstall,
  selectLayout,
  selectPersisted,
  selectReviewCount,
  useAppStore,
  useAppStoreShallow,
  useDispatch,
} from '../app/store.ts';
import type { CoachLevel, TableConfig } from '../engine/types.ts';
import { en } from '../i18n/en.ts';
import { useAboutModule } from './aboutModule.ts';
import { LoadBoundary } from './components/LoadBoundary.tsx';
import { RankingsDrawer } from './components/RankingsDrawer.tsx';
import { useDrillChunks } from './drillModule.ts';
import { useMediaQuery } from './hooks.ts';
import { ImportDialog, ResetDialog } from './screens/DataDialogs.tsx';
import { NewTableDialog, OutOfChipsDialog } from './screens/Dialogs.tsx';
import { wakeLockSupport, type DisplayAndSoundSettings } from './screens/DisplayAndSound.tsx';
import { Menu } from './screens/Menu.tsx';
import { ScreenBar } from './screens/ScreenBar.tsx';
import screen from './screens/Screen.module.css';
import { Settings } from './screens/Settings.tsx';
import { Setup } from './screens/Setup.tsx';
import { AVAILABLE_LEVELS, ownLevelCount, type MoreChoices } from './screens/setupForm.ts';
import { useTableLayout } from './screens/Table.tsx';

export { Table as TableScreen } from './screens/Table.tsx';

// ---------------------------------------------------------------------------------------------
// Screens

export function SetupScreen() {
  const dispatch = useDispatch();
  const initial = useAppStoreShallow((s) => ({
    players: s.settings.players,
    startingStack: s.settings.startingStack,
    bb: s.settings.bb,
    botLevel: s.settings.botLevel,
    coachLevel: s.settings.coachLevel,
    seatLevels: s.settings.seatLevels,
    speed: s.settings.speed,
    fourColour: s.settings.fourColour,
  }));
  const start = (config: TableConfig, coachLevel: CoachLevel, more: MoreChoices) =>
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
        speed: more.speed,
        fourColour: more.fourColour,
      },
    });
  return (
    <Setup
      initial={initial}
      available={AVAILABLE_LEVELS}
      onStartTable={start}
      onBack={() => dispatch({ type: 'back' })}
      onOpenPrivacy={() => dispatch({ type: 'go', screen: 'privacy' })}
    />
  );
}

export function SettingsScreen() {
  const dispatch = useDispatch();
  const settings = useAppStoreShallow((s) => ({
    coachLevel: s.settings.coachLevel,
    botLevel: s.settings.botLevel,
    speed: s.settings.speed,
    autoNext: s.settings.autoNext,
    amounts: s.settings.amounts,
    showEquity: s.settings.showEquity,
  }));
  // How many bots have a level of their own (§9.3): the Bot level row says so.
  const ownLevels = useAppStore((s) => ownLevelCount(s.settings.seatLevels));
  // Display and Sound (chunks 9.1, 9.1b): four-colour cards, text size, reduce motion, keep screen
  // on; sound, vibration.
  const device: DisplayAndSoundSettings = useAppStoreShallow((s) => ({
    fourColour: s.settings.fourColour,
    textSize: s.settings.textSize,
    reduceMotion: s.settings.reduceMotion,
    keepAwake: s.settings.keepAwake,
    sound: s.settings.sound,
    haptics: s.settings.haptics,
  }));
  const persisted = useAppStore(selectPersisted);
  const counters = useAppStore(selectDiagnostics);
  return (
    <Settings
      settings={settings}
      ownLevels={ownLevels}
      available={AVAILABLE_LEVELS}
      onChangeSettings={(patch) => dispatch({ type: 'settings', patch })}
      onBack={() => dispatch({ type: 'back' })}
      device={{
        settings: device,
        wakeLock: wakeLockSupport(window),
        onChange: (patch) => dispatch({ type: 'settings', patch }),
      }}
      data={{
        persisted,
        // From the tap itself: the share sheet opens only inside it (§14.8).
        onExport: () => dispatch({ type: 'exportStats' }),
        onImport: (file) => dispatch({ type: 'importFile', file }),
        onReset: () => dispatch({ type: 'open', overlay: 'dataReset' }),
      }}
      diagnostics={{
        counters,
        featuresOff: missingFeatures(secureFeatures()),
        onExportDebug: () => dispatch({ type: 'exportDebug' }),
      }}
      onOpenAbout={() => dispatch({ type: 'go', screen: 'about' })}
    />
  );
}

/**
 * The hand drill (§13.5): Back and the title at once (a screen change moves the focus to the
 * title), then the page when its two chunks are there; "Loading…" only after half a second, as for
 * the screens after the first tap. If they cannot load: a line, Try again (a reload) and Back. A
 * page that throws while rendering leaves (Back), so the drill never takes the app down.
 */
export function DrillScreen() {
  const dispatch = useDispatch();
  const { chunks, failed } = useDrillChunks();
  const back = useCallback(() => dispatch({ type: 'back' }), [dispatch]);
  let body;
  if (chunks !== null) {
    const { DrillPage } = chunks.page;
    body = (
      <LoadBoundary onError={back}>
        <DrillPage logic={chunks.logic} Drawer={RankingsDrawer} />
      </LoadBoundary>
    );
  } else if (failed) {
    body = (
      <>
        <p className={screen.hint} role="alert">
          {en.screens.loadFailed}
        </p>
        <button type="button" className={screen.primary} onClick={() => window.location.reload()}>
          {en.screens.tryAgain}
        </button>
      </>
    );
  } else {
    body = <p className={`${screen.hint} ${screen.later}`}>{en.screens.loading}</p>;
  }
  return (
    <main className={screen.page}>
      <ScreenBar title={en.drill.title} onBack={back} />
      {body}
    </main>
  );
}

/**
 * About (§12.1, chunk 9.2c) over its own lazy chunk (`aboutModule.ts`): at once when the chunk is
 * there, else the page's title and a "Loading…" line that CSS shows after half a second (as for the
 * screens of this chunk, ui/App.tsx). If it cannot load: the line, Try again (a reload, the sure way
 * to load a module that failed) and Back.
 */
function AboutPage({ at }: { at: 'top' | 'privacy' }) {
  const dispatch = useDispatch();
  const { mod, failed } = useAboutModule();
  const back = () => dispatch({ type: 'back' });
  if (mod !== null) return <mod.About at={at} onBack={back} />;
  return (
    <main className={screen.page}>
      <ScreenBar title={en.about} onBack={back} />
      {failed ? (
        <>
          <p className={screen.hint} role="alert">
            {en.screens.loadFailed}
          </p>
          <button type="button" className={screen.primary} onClick={() => window.location.reload()}>
            {en.screens.tryAgain}
          </button>
        </>
      ) : (
        <p className={`${screen.hint} ${screen.later}`}>{en.screens.loading}</p>
      )}
    </main>
  );
}

/** About at the top (Settings, the Menu). */
export function AboutScreen() {
  return <AboutPage at="top" />;
}

/** About at its Privacy section (the Privacy links of Welcome and Setup, Appendix G.2). */
export function PrivacyScreen() {
  return <AboutPage at="privacy" />;
}

// ---------------------------------------------------------------------------------------------
// Overlays (the rankings drawer and the sizing tray belong to the Table)

export function MenuOverlay() {
  const dispatch = useDispatch();
  const canTopUp = useAppStore(selectCanTopUp);
  const startingStack = useAppStore((s) => selectCurrentTable(s)?.config.startingStack ?? null);
  const wide = useAppStore((s) => selectLayout(s) === 'wide');
  const hands = useAppStore(selectReviewCount);
  const install = useAppStore(selectInstall);
  // Compact mode (§12.3): Undo has the mute button's place, so the Menu turns sound off and on.
  const compact = useTableLayout() === 'compact';
  const soundOn = useAppStore((s) => s.settings.sound);
  // A mouse or a trackpad: most likely a keyboard too (§12.5's shortcuts are for the desktop).
  const pointer = useMediaQuery('(any-pointer: fine)');
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
      onOpenDrill={() => dispatch({ type: 'go', screen: 'drill' })}
      onOpenHands={hands > 0 ? () => dispatch({ type: 'review', handSeq: null }) : undefined}
      onShowKeys={
        pointer
          ? () => {
              close();
              dispatch({ type: 'open', overlay: 'shortcuts' });
            }
          : undefined
      }
      onOpenSettings={() => dispatch({ type: 'go', screen: 'settings' })}
      onOpenStats={() => dispatch({ type: 'go', screen: 'stats' })}
      onOpenLearn={() => dispatch({ type: 'go', screen: 'learn' })}
      onInstall={
        install
          ? () => {
              // The browser's install dialog, from the tap itself (§12.13).
              dispatch({ type: 'install' });
              close();
            }
          : undefined
      }
      onOpenAbout={() => dispatch({ type: 'go', screen: 'about' })}
      onLeaveTable={() => dispatch({ type: 'leaveTable' })}
      onNewTable={() => dispatch({ type: 'go', screen: 'setup' })}
      sound={
        compact
          ? {
              on: soundOn,
              onToggle: () => {
                dispatch({ type: 'settings', patch: { sound: !soundOn } });
                close();
              },
            }
          : undefined
      }
    />
  );
}

export function OutOfChipsOverlay() {
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

/**
 * Import's dialog (§14.8): open while the controller holds a picked file's check (it opens and
 * closes the `dataImport` overlay with it). Replace writes it; Cancel, OK, Esc and the scrim
 * forget it (Back too: the controller sees the overlay close).
 */
export function ImportOverlay() {
  const dispatch = useDispatch();
  const check = useAppStore(selectImportCheck);
  const handInProgress = useAppStore(selectHandInProgress);
  if (check === null) return null;
  return (
    <ImportDialog
      check={check}
      handInProgress={handInProgress}
      onReplace={() => dispatch({ type: 'importConfirm' })}
      onCancel={() => dispatch({ type: 'importCancel' })}
    />
  );
}

/** Reset stats (§14.8): "Delete my stats" sends Reset; Cancel, Esc, the scrim and Back close it. */
export function ResetOverlay() {
  const dispatch = useDispatch();
  const close = () => dispatch({ type: 'close', overlay: 'dataReset' });
  return (
    <ResetDialog
      onConfirm={() => {
        close();
        dispatch({ type: 'resetStats' });
      }}
      onCancel={close}
    />
  );
}

export function NewTableOverlay() {
  const dispatch = useDispatch();
  return (
    <NewTableDialog
      onConfirm={() => dispatch({ type: 'newTable', confirmed: true })}
      onCancel={() => dispatch({ type: 'close', overlay: 'newTable' })}
    />
  );
}
