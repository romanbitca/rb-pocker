/**
 * The screens after the first tap (PLAN §12.1, §15.3), wired to the store: the Table, Setup,
 * Settings, and the overlays that open over them (the Table's Menu, the two §3.1 dialogs, and the
 * Data dialogs of §14.8: Import's preview and "Delete my stats", chunk 8.4).
 *
 * This file starts a lazy chunk. The first screen (Welcome or Home) does not need any of it, so
 * the initial bundle does not carry it. App loads it with `import()` (`ui/screensModule.ts`) right
 * after the first paint, long before anyone can tap Play, so one tap still deals a hand at once
 * (§12.1); the service worker precaches it like every chunk, so it also loads offline.
 */
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
import { ImportDialog, ResetDialog } from './screens/DataDialogs.tsx';
import { NewTableDialog, OutOfChipsDialog } from './screens/Dialogs.tsx';
import { wakeLockSupport, type DisplayAndSoundSettings } from './screens/DisplayAndSound.tsx';
import { Menu } from './screens/Menu.tsx';
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
  }));
  // How many bots have a level of their own (§9.3): the Bot level row says so.
  const ownLevels = useAppStore((s) => ownLevelCount(s.settings.seatLevels));
  // Display and Sound (chunk 9.1): keep screen on, sound, vibration.
  const device: DisplayAndSoundSettings = useAppStoreShallow((s) => ({
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
    />
  );
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
      onOpenStats={() => dispatch({ type: 'go', screen: 'stats' })}
      onInstall={
        install
          ? () => {
              // The browser's install dialog, from the tap itself (§12.13).
              dispatch({ type: 'install' });
              close();
            }
          : undefined
      }
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
