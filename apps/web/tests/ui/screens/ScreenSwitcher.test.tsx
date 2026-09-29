// @vitest-environment jsdom
// The screen switcher (PLAN §12.1: no router) driven by the real navigation reducer.
import '../../../src/ui/styles/tokens.css';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useReducer } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialNav, navigate, type Nav, type NavAction } from '../../../src/app/navigation.ts';
import { Home } from '../../../src/ui/screens/Home.tsx';
import { Menu } from '../../../src/ui/screens/Menu.tsx';
import { OutOfChipsDialog } from '../../../src/ui/screens/Dialogs.tsx';
import { ScreenSwitcher } from '../../../src/ui/screens/ScreenSwitcher.tsx';
import { Settings } from '../../../src/ui/screens/Settings.tsx';
import { Setup } from '../../../src/ui/screens/Setup.tsx';
import { Welcome } from '../../../src/ui/screens/Welcome.tsx';

afterEach(cleanup);

/** A stand-in for the Table screen (chunk 3.4): the hero's cards are visible at once. */
function Table({ dispatch }: { dispatch: (a: NavAction) => void }) {
  return (
    <main>
      <h1>Table</h1>
      <p data-testid="hero-cards">Your cards</p>
      <button type="button" onClick={() => dispatch({ type: 'open', overlay: 'menu' })}>
        Menu
      </button>
    </main>
  );
}

/** The app as the store and controller will wire it, with a local reducer. */
function App({ firstLaunch, onPlay }: { firstLaunch: boolean; onPlay: () => void }) {
  const [nav, dispatch] = useReducer(navigate, firstLaunch, initialNav);
  const go = (screen: 'home' | 'setup' | 'table' | 'settings') => dispatch({ type: 'go', screen });
  const back = () => dispatch({ type: 'back' });
  return (
    <ScreenSwitcher
      nav={nav}
      screens={{
        welcome: () => (
          <Welcome
            onPlay={() => {
              onPlay();
              go('table');
            }}
            onSetup={() => go('setup')}
          />
        ),
        home: () => (
          <Home
            session={null}
            onPlay={() => go('table')}
            onNewTable={() => go('setup')}
            onOpenSettings={() => go('settings')}
          />
        ),
        setup: () => (
          <Setup
            initial={{
              players: 6,
              startingStack: 2000,
              bb: 20,
              botLevel: 'easy',
              coachLevel: 'beginner',
            }}
            available={{ bot: ['easy'], coach: ['beginner'] }}
            onStartTable={() => go('table')}
            onBack={back}
          />
        ),
        table: () => <Table dispatch={dispatch} />,
        settings: () => (
          <Settings
            settings={{ speed: 'normal', autoNext: true, amounts: 'chips' }}
            onChangeSettings={() => {}}
            onBack={back}
          />
        ),
      }}
      overlays={{
        menu: () => (
          <Menu
            onResume={() => dispatch({ type: 'close', overlay: 'menu' })}
            topUpTo={null}
            onTopUp={() => {}}
            onOpenSettings={() => go('settings')}
            onLeaveTable={() => go('home')}
            onNewTable={() => go('setup')}
          />
        ),
        outOfChips: () => (
          <OutOfChipsDialog
            startingStack={2000}
            onTopUp={() => dispatch({ type: 'close', overlay: 'outOfChips' })}
            onChangeTable={() => dispatch({ type: 'replace', screen: 'setup' })}
          />
        ),
        newTable: () => null,
      }}
    />
  );
}

const shown = () => document.querySelector('[data-screen]')?.getAttribute('data-screen');
const anyDialog = () => screen.queryByRole('dialog') ?? screen.queryByRole('alertdialog');

describe('one tap to play (§12.1, §18 Stage 3 acceptance 9)', () => {
  it('fresh profile: Welcome → one tap on Play → the Table, with nothing in between', () => {
    const onPlay = vi.fn();
    render(<App firstLaunch onPlay={onPlay} />);
    expect(shown()).toBe('welcome');
    expect(anyDialog()).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Play' }));

    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(shown()).toBe('table');
    expect(screen.getByTestId('hero-cards')).toBeTruthy();
    expect(anyDialog()).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Set up your table' })).toBeNull();
  });

  it('later launches: Home → one tap on Play → the Table', () => {
    render(<App firstLaunch={false} onPlay={() => {}} />);
    expect(shown()).toBe('home');
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(shown()).toBe('table');
    expect(anyDialog()).toBeNull();
  });
});

describe('ScreenSwitcher', () => {
  it('renders only the current screen, and open overlays above it in order', () => {
    const calls: string[] = [];
    const renderer = (name: string) => () => {
      calls.push(name);
      return <p>{name}</p>;
    };
    const nav: Nav = { screens: ['home', 'table'], overlays: ['menu', 'outOfChips'] };
    const { container } = render(
      <ScreenSwitcher
        nav={nav}
        screens={{
          welcome: renderer('welcome'),
          home: renderer('home'),
          setup: renderer('setup'),
          table: renderer('table'),
          settings: renderer('settings'),
        }}
        overlays={{
          menu: renderer('menu'),
          outOfChips: renderer('outOfChips'),
          newTable: renderer('newTable'),
        }}
      />,
    );
    expect(calls).toEqual(['table', 'menu', 'outOfChips']);
    expect([...container.querySelectorAll('p')].map((p) => p.textContent)).toEqual([
      'table',
      'menu',
      'outOfChips',
    ]);
  });

  it('moves focus to the new screen heading on a change, not on the first render (§12.12)', () => {
    render(<App firstLaunch={false} onPlay={() => {}} />);
    expect(document.activeElement).toBe(document.body);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const heading = screen.getByRole('heading', { level: 1, name: 'Settings' });
    expect(document.activeElement).toBe(heading);
    expect(heading.tabIndex).toBe(-1);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
    expect(shown()).toBe('home');
  });

  it('drops a screen’s local state when it is left: Setup opens fresh', () => {
    render(<App firstLaunch={false} onPlay={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'New table…' }));
    fireEvent.click(screen.getByRole('button', { name: 'More players' }));
    expect(screen.getByText('You and 6 bots')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: 'New table…' }));
    expect(screen.getByText('You and 5 bots')).toBeTruthy();
  });

  it('Table → Menu → Settings → Back returns to the Table with the Menu closed', () => {
    render(<App firstLaunch={false} onPlay={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    expect(screen.getByRole('dialog', { name: 'Menu' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(shown()).toBe('settings');
    expect(anyDialog()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(shown()).toBe('table');
    expect(anyDialog()).toBeNull();
  });

  it('follows the Nav it is given (the store drives it)', () => {
    const switcher = (nav: Nav) => (
      <ScreenSwitcher
        nav={nav}
        screens={{
          welcome: () => <h1>W</h1>,
          home: () => <h1>H</h1>,
          setup: () => <h1>S</h1>,
          table: () => <h1>T</h1>,
          settings: () => <h1>G</h1>,
        }}
        overlays={{ menu: () => null, outOfChips: () => null, newTable: () => null }}
      />
    );
    const { rerender } = render(switcher(initialNav(false)));
    expect(screen.getByRole('heading').textContent).toBe('H');
    rerender(switcher(navigate(initialNav(false), { type: 'go', screen: 'table' })));
    expect(screen.getByRole('heading').textContent).toBe('T');
    expect(document.activeElement).toBe(screen.getByRole('heading'));
    rerender(switcher(initialNav(true)));
    expect(screen.getByRole('heading').textContent).toBe('W');
  });
});
