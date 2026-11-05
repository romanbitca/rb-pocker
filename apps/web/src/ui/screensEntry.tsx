/**
 * The screens after the first tap (PLAN §12.1, §15.3), wired to the store: the Table, Setup,
 * Settings, and the overlays that open over them (the Table's Menu and the two §3.1 dialogs).
 *
 * This file starts a lazy chunk. The first screen (Welcome or Home) does not need any of it, so
 * the initial bundle does not carry it. App loads it with `import()` (`ui/screensModule.ts`) right
 * after the first paint, long before anyone can tap Play, so one tap still deals a hand at once
 * (§12.1); the service worker precaches it like every chunk, so it also loads offline.
 */
import {
  selectCanTopUp,
  selectCurrentTable,
  selectLayout,
  selectReviewCount,
  useAppStore,
  useAppStoreShallow,
  useDispatch,
} from '../app/store.ts';
import type { CoachLevel, TableConfig } from '../engine/types.ts';
import { NewTableDialog, OutOfChipsDialog } from './screens/Dialogs.tsx';
import { Menu } from './screens/Menu.tsx';
import { Settings } from './screens/Settings.tsx';
import { Setup } from './screens/Setup.tsx';
import { AVAILABLE_LEVELS, ownLevelCount, type MoreChoices } from './screens/setupForm.ts';

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
  return (
    <Settings
      settings={settings}
      ownLevels={ownLevels}
      available={AVAILABLE_LEVELS}
      onChangeSettings={(patch) => dispatch({ type: 'settings', patch })}
      onBack={() => dispatch({ type: 'back' })}
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

export function NewTableOverlay() {
  const dispatch = useDispatch();
  return (
    <NewTableDialog
      onConfirm={() => dispatch({ type: 'newTable', confirmed: true })}
      onCancel={() => dispatch({ type: 'close', overlay: 'newTable' })}
    />
  );
}
