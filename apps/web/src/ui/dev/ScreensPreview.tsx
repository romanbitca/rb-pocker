/**
 * Dev-only preview of the screens outside the Table: `/?preview=screens` lists the states,
 * `&state=<name>` shows one full size (for checking 375×667 and 390×844), `&state=flow` clicks
 * through them with the real navigation reducer. `main.tsx` loads this only when
 * `import.meta.env.DEV`, so it never ships (tests/ui/dev/screensPreview.test.ts checks the build).
 * Its own labels are developer text, not product copy, so they are not in i18n.
 */
import { useReducer, useState, type ReactNode } from 'react';
import type * as Navigation from '../../app/navigation.ts';
import type { CoachLevel, TableConfig } from '../../engine/types.ts';
import { NewTableDialog, OutOfChipsDialog } from '../screens/Dialogs.tsx';
import { Home, type SessionLine } from '../screens/Home.tsx';
import { Menu } from '../screens/Menu.tsx';
import { ScreenSwitcher } from '../screens/ScreenSwitcher.tsx';
import { Settings, type GameSettings } from '../screens/Settings.tsx';
import { Setup } from '../screens/Setup.tsx';
import { AVAILABLE_LEVELS, type AvailableLevels, type SetupValues } from '../screens/setupForm.ts';
import { Welcome } from '../screens/Welcome.tsx';
import styles from './ScreensPreview.module.css';

/** Found in development builds only; the bundle test looks for it in the production output. */
export const SCREENS_PREVIEW_MARKER = 'rb-dev-screens-preview';

/** The part of app/navigation.ts the flow needs (passed in: ui may not load app/ at run time). */
export type PreviewNavigation = Pick<typeof Navigation, 'initialNav' | 'navigate'>;

const ALL_LEVELS: AvailableLevels = {
  bot: ['easy', 'medium', 'hard', 'expert'],
  coach: ['beginner', 'intermediate', 'advanced', 'exam'],
};

/** §12.1 first-launch defaults. */
const DEFAULTS: SetupValues & GameSettings = {
  players: 6,
  startingStack: 2000,
  bb: 20,
  botLevel: 'easy',
  coachLevel: 'beginner',
  speed: 'normal',
  autoNext: true,
  amounts: 'chips',
};

const SESSION: SessionLine = {
  hand: 23,
  players: 6,
  chips: 2340,
  botLevel: 'easy',
  coachLevel: 'beginner',
};

const log =
  (name: string) =>
  (...args: unknown[]) =>
    console.info('[preview]', name, ...args);

/** A stand-in for the Table (chunk 3.4) with the two ways into its overlays. */
function TableStub({ onMenu, onBust }: { onMenu: () => void; onBust?: () => void }) {
  return (
    <main className={styles.table}>
      <h1 className={styles.tableTitle}>Table (chunk 3.4)</h1>
      <div className={styles.tableButtons}>
        <button type="button" className={styles.devButton} onClick={onMenu}>
          Menu
        </button>
        {onBust && (
          <button type="button" className={styles.devButton} onClick={onBust}>
            Hero busts
          </button>
        )}
      </div>
    </main>
  );
}

function SettingsState() {
  const [settings, setSettings] = useState<GameSettings>(DEFAULTS);
  return (
    <Settings
      settings={settings}
      available={AVAILABLE_LEVELS}
      onChangeSettings={(patch) => {
        log('changeSettings')(patch);
        setSettings((s) => ({ ...s, ...patch }));
      }}
      onBack={log('back')}
    />
  );
}

const menuProps = {
  onResume: log('resume'),
  topUpTo: 2000,
  onTopUp: log('topUp'),
  onOpenRankings: log('rankings'),
  onOpenSettings: log('settings'),
  onLeaveTable: log('leaveTable'),
  onNewTable: log('newTable'),
};

const setupProps = {
  available: AVAILABLE_LEVELS,
  onStartTable: log('startTable'),
  onBack: log('back'),
};

/** Every state: name → what it shows. */
const STATES: Record<string, { label: string; render: (nav: PreviewNavigation) => ReactNode }> = {
  welcome: {
    label: 'Welcome (first launch)',
    render: () => <Welcome onPlay={log('play')} onSetup={log('setup')} />,
  },
  'welcome-later': {
    label: 'Welcome with the later links (guide, Privacy)',
    render: () => (
      <Welcome
        onPlay={log('play')}
        onSetup={log('setup')}
        onOpenGuide={log('guide')}
        onOpenPrivacy={log('privacy')}
      />
    ),
  },
  home: {
    label: 'Home, no saved session',
    render: () => (
      <Home
        session={null}
        onPlay={log('play')}
        onNewTable={log('newTable')}
        onOpenSettings={log('settings')}
      />
    ),
  },
  'home-session': {
    label: 'Home with a saved session',
    render: () => (
      <Home
        session={SESSION}
        onPlay={log('play')}
        onNewTable={log('newTable')}
        onOpenSettings={log('settings')}
      />
    ),
  },
  'home-later': {
    label: 'Home with the later tiles (Learn, Stats, Install)',
    render: () => (
      <Home
        session={SESSION}
        onPlay={log('play')}
        onNewTable={log('newTable')}
        onOpenSettings={log('settings')}
        onOpenLearn={log('learn')}
        onOpenStats={log('stats')}
        onInstall={log('install')}
      />
    ),
  },
  setup: {
    label: 'Setup, defaults',
    render: () => <Setup initial={DEFAULTS} {...setupProps} />,
  },
  'setup-custom': {
    label: 'Setup, custom chips and blinds (3,500 and 15/30)',
    render: () => <Setup initial={{ ...DEFAULTS, startingStack: 3500, bb: 30 }} {...setupProps} />,
  },
  'setup-too-few': {
    label: 'Setup, too few chips (500 with 100/200)',
    render: () => <Setup initial={{ ...DEFAULTS, startingStack: 500, bb: 200 }} {...setupProps} />,
  },
  'setup-later': {
    label: 'Setup with every level available',
    render: () => <Setup initial={DEFAULTS} {...setupProps} available={ALL_LEVELS} />,
  },
  settings: { label: 'Settings (Game)', render: () => <SettingsState /> },
  menu: {
    label: 'Menu over the table',
    render: () => (
      <>
        <TableStub onMenu={log('menu')} />
        <Menu {...menuProps} />
      </>
    ),
  },
  'out-of-chips': {
    label: 'Out of chips',
    render: () => (
      <>
        <TableStub onMenu={log('menu')} />
        <OutOfChipsDialog
          startingStack={2000}
          onTopUp={log('topUp')}
          onChangeTable={log('changeTable')}
        />
      </>
    ),
  },
  'new-table': {
    label: 'New table while a hand is unfinished',
    render: () => (
      <>
        <Setup initial={DEFAULTS} {...setupProps} />
        <NewTableDialog onConfirm={log('confirm')} onCancel={log('cancel')} />
      </>
    ),
  },
  flow: {
    label: 'Flow: click through with the navigation reducer',
    render: (navigation) => <Flow navigation={navigation} />,
  },
};

/** The screens wired to a local reducer, as the store and controller will wire them. */
function Flow({ navigation }: { navigation: PreviewNavigation }) {
  const [nav, dispatch] = useReducer(navigation.navigate, true, navigation.initialNav);
  const [settings, setSettings] = useState(DEFAULTS);
  const [session, setSession] = useState<SessionLine | null>(null);
  const [pending, setPending] = useState<{ config: TableConfig; coach: CoachLevel } | null>(null);
  const go = (screen: Navigation.Screen) => dispatch({ type: 'go', screen });
  const back = () => dispatch({ type: 'back' });

  const start = (players: number, startingStack: number, bb: number, coachLevel: CoachLevel) => {
    log('startTable')({ players, startingStack, bb, coachLevel });
    setSettings((s) => ({ ...s, players, startingStack, bb, coachLevel }));
    setSession({ ...SESSION, hand: 1, players, chips: startingStack, coachLevel });
    go('table');
  };
  const startConfig = (config: TableConfig, coach: CoachLevel) =>
    start(config.seatCount, config.startingStack, config.bb, coach);

  return (
    <ScreenSwitcher
      nav={nav}
      screens={{
        welcome: () => (
          <Welcome
            onPlay={() => start(DEFAULTS.players, DEFAULTS.startingStack, DEFAULTS.bb, 'beginner')}
            onSetup={() => go('setup')}
          />
        ),
        home: () => (
          <Home
            session={session}
            onPlay={() =>
              session
                ? go('table')
                : start(settings.players, settings.startingStack, settings.bb, settings.coachLevel)
            }
            onNewTable={() => go('setup')}
            onOpenSettings={() => go('settings')}
          />
        ),
        setup: () => (
          <Setup
            initial={settings}
            available={AVAILABLE_LEVELS}
            onStartTable={(config, coach) => {
              if (session === null) return startConfig(config, coach);
              setPending({ config, coach });
              dispatch({ type: 'open', overlay: 'newTable' });
            }}
            onBack={back}
          />
        ),
        table: () => (
          <TableStub
            onMenu={() => dispatch({ type: 'open', overlay: 'menu' })}
            onBust={() => {
              setSession((s) => s && { ...s, chips: 0 });
              dispatch({ type: 'open', overlay: 'outOfChips' });
            }}
          />
        ),
        settings: () => (
          <Settings
            settings={settings}
            available={AVAILABLE_LEVELS}
            onChangeSettings={(patch) => setSettings((s) => ({ ...s, ...patch }))}
            onBack={back}
          />
        ),
        // Review is a lazy screen of the real app (ui/screens/Review.tsx); not previewed here.
        review: () => <h1>Review</h1>,
      }}
      overlays={{
        menu: () => (
          <Menu
            onResume={() => dispatch({ type: 'close', overlay: 'menu' })}
            topUpTo={
              session && session.chips < settings.startingStack ? settings.startingStack : null
            }
            onTopUp={() => {
              setSession((s) => s && { ...s, chips: settings.startingStack });
              dispatch({ type: 'close', overlay: 'menu' });
            }}
            onOpenSettings={() => go('settings')}
            onLeaveTable={() => go('home')}
            onNewTable={() => go('setup')}
          />
        ),
        outOfChips: () => (
          <OutOfChipsDialog
            startingStack={settings.startingStack}
            onTopUp={() => {
              setSession((s) => s && { ...s, chips: settings.startingStack });
              dispatch({ type: 'close', overlay: 'outOfChips' });
            }}
            onChangeTable={() => {
              setSession(null);
              dispatch({ type: 'replace', screen: 'setup' });
            }}
          />
        ),
        newTable: () => (
          <NewTableDialog
            onConfirm={() => pending && startConfig(pending.config, pending.coach)}
            onCancel={() => dispatch({ type: 'close', overlay: 'newTable' })}
          />
        ),
      }}
    />
  );
}

export function ScreensPreview({ navigation }: { navigation: PreviewNavigation }) {
  const state = new URLSearchParams(window.location.search).get('state');
  const picked = state === null ? undefined : STATES[state];
  if (picked) return <div data-preview={SCREENS_PREVIEW_MARKER}>{picked.render(navigation)}</div>;
  return (
    <main className={styles.index} data-preview={SCREENS_PREVIEW_MARKER}>
      <h1>Screens preview (dev only)</h1>
      <ul>
        {Object.entries(STATES).map(([name, { label }]) => (
          <li key={name}>
            <a href={`?preview=screens&state=${name}`}>{label}</a>
          </li>
        ))}
      </ul>
    </main>
  );
}
