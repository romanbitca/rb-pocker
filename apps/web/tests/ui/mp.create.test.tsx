// @vitest-environment jsdom
/**
 * "Play with friends": where it shows, and the Create screen (PLAN §19.10, Stage 10 acceptance 13's
 * first step and 14), through the real App, store and driver over a fake WebSocket.
 */
import '../../src/ui/styles/tokens.css';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { appStore } from '../../src/app/store.ts';
import type { TableSettings } from '../../src/net/protocol.ts';
import { mpWords as W } from '../../src/i18n/mp.ts';
import { App } from '../../src/ui/App.tsx';
import { Home } from '../../src/ui/screens/Home.tsx';
import { Welcome } from '../../src/ui/screens/Welcome.tsx';
import { GIVE_UP_AFTER_MS } from '../../src/app/mp/socket.ts';
import styles from '../../src/ui/screens/Screen.module.css';
import { cssClass, smallTargets } from './screens/targets.ts';
import { waitingView } from '../app/mpFixtures.ts';
import { loadMpChunks, startMp, type MpHarness } from './mpHarness.ts';
import { elapse, startTableHarness, type TableHarness } from './tableHarness.ts';

const FRIENDS = 'Play with friends';

beforeAll(loadMpChunks);

let h: MpHarness | TableHarness | null = null;

afterEach(() => {
  cleanup();
  h?.dispose();
  h = null;
});

function open(options: Parameters<typeof startMp>[0] = {}): MpHarness {
  const rig = startMp(options);
  h = rig;
  render(<App />);
  return rig;
}

/** Inside Telegram, on the Create screen. */
function onCreate(): MpHarness {
  const rig = open();
  fireEvent.click(screen.getByRole('button', { name: FRIENDS }));
  return rig;
}

const choose = (name: string): void => {
  fireEvent.click(screen.getByRole('radio', { name }));
};
const checked = (group: string): string[] =>
  within(screen.getByRole('group', { name: group }))
    .getAllByRole<HTMLInputElement>('radio')
    .filter((r) => r.checked)
    .map((r) => r.value);

describe('"Play with friends" shows only inside Telegram (§19.1, §19.10)', () => {
  const noop = () => {};

  it('Home has the button under Play and its session line, before "New table…"', () => {
    render(
      <Home
        session={null}
        onPlay={noop}
        onNewTable={noop}
        onOpenSettings={noop}
        onPlayWithFriends={noop}
      />,
    );
    const names = screen.getAllByRole('button').map((b) => b.textContent);
    expect(names.slice(0, 3)).toEqual(['Play', FRIENDS, 'New table…']);
  });

  it('Welcome has it under Play, on a first launch too', () => {
    render(<Welcome onPlay={noop} onSetup={noop} onPlayWithFriends={noop} />);
    const names = screen.getAllByRole('button').map((b) => b.textContent);
    expect(names.slice(0, 2)).toEqual(['Play', FRIENDS]);
  });

  it('neither has it without the callback', () => {
    render(<Home session={null} onPlay={noop} onNewTable={noop} onOpenSettings={noop} />);
    expect(screen.queryByRole('button', { name: FRIENDS })).toBeNull();
    cleanup();
    render(<Welcome onPlay={noop} onSetup={noop} />);
    expect(screen.queryByRole('button', { name: FRIENDS })).toBeNull();
  });

  it('outside Telegram the app offers none and asks nothing of the server', () => {
    h = startTableHarness();
    render(<App />);
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: FRIENDS })).toBeNull();
  });

  it('inside Telegram Home has the button, and no socket opens before it is tapped', () => {
    const rig = open();
    expect(screen.getByRole('button', { name: FRIENDS })).toBeTruthy();
    expect(rig.sockets).toEqual([]);
  });

  it('inside Telegram Welcome (a first launch) has it too', () => {
    const rig = startMp();
    h = rig;
    act(() =>
      appStore.setState((s) => ({
        ui: { ...s.ui, nav: { screens: ['welcome'], overlays: [] }, screen: 'welcome' },
      })),
    );
    render(<App />);
    expect(screen.getByRole('button', { name: FRIENDS })).toBeTruthy();
  });

  it('a read-only tab shows the banner instead (§14.7): no Play, so no friends either', () => {
    open();
    act(() => appStore.setState((s) => ({ data: { ...s.data, tab: 'readOnly' } })));
    expect(screen.queryByRole('button', { name: FRIENDS })).toBeNull();
  });
});

describe('"New table" (§19.10)', () => {
  it('the tap shows it, opens the socket and says hello; Back goes Home and closes it', () => {
    const rig = onCreate();
    expect(rig.state().ui.screen).toBe('mpCreate');
    expect(screen.getByRole('heading', { level: 1, name: W.create.title })).toBeTruthy();
    expect(rig.sockets).toHaveLength(1);
    const ws = rig.connect();
    expect(ws.kinds()).toEqual(['hello']);

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(rig.state().ui.screen).toBe('home');
    expect(ws.closedWith).not.toBeNull();
  });

  it('`startapp=new` opens it at once', () => {
    const rig = open({ startParam: 'new' });
    expect(rig.state().ui.screen).toBe('mpCreate');
    expect(screen.getByRole('heading', { level: 1, name: W.create.title })).toBeTruthy();
  });

  it('every word of the form is §19.10 and the choices start at 6, Normal, 30 seconds', () => {
    onCreate();
    for (const word of [
      W.create.players,
      W.create.playersHint,
      W.create.game,
      W.create.time,
      W.create.notInStats,
    ]) {
      expect(screen.getByText(word)).toBeTruthy();
    }
    expect(screen.getByText(`${W.create.playMoney} ${W.create.noValue}`)).toBeTruthy();
    for (const game of Object.values(W.create.games)) {
      expect(screen.getByRole('radio', { name: `${game.name} ${game.detail}` })).toBeTruthy();
    }
    for (const seconds of Object.values(W.create.seconds)) {
      expect(screen.getByRole('radio', { name: seconds })).toBeTruthy();
    }
    expect(screen.getByRole('button', { name: W.create.button })).toBeTruthy();
    expect(checked(W.create.players)).toEqual(['6']);
    expect(checked(W.create.game)).toEqual(['normal']);
    expect(checked(W.create.time)).toEqual(['30']);
  });

  it('offers 2 to 9 players', () => {
    onCreate();
    const values = within(screen.getByRole('group', { name: W.create.players }))
      .getAllByRole<HTMLInputElement>('radio')
      .map((r) => r.value);
    expect(values).toEqual(['2', '3', '4', '5', '6', '7', '8', '9']);
  });

  it.each<[string, string, string, TableSettings]>([
    ['2', 'Quick game', '15 seconds', { seats: 2, stakes: 'quick', turnSeconds: 15 }],
    ['9', 'Long game', '60 seconds', { seats: 9, stakes: 'long', turnSeconds: 60 }],
    ['6', 'Normal game', '30 seconds', { seats: 6, stakes: 'normal', turnSeconds: 30 }],
  ])('%s players, %s, %s: the server gets exactly these', (players, game, time, settings) => {
    const rig = onCreate();
    const ws = rig.connect();
    choose(players);
    const detail = Object.values(W.create.games).find((g) => g.name === game)?.detail;
    choose(`${game} ${detail}`);
    choose(time);
    fireEvent.click(screen.getByRole('button', { name: W.create.button }));
    expect(ws.sent.at(-1)).toEqual({ t: 'create', settings });
  });

  it('a second tap sends nothing more, and the table shows the waiting room', () => {
    const rig = onCreate();
    const ws = rig.connect();
    const create = screen.getByRole('button', { name: W.create.button });
    fireEvent.click(create);
    fireEvent.click(create);
    expect(ws.kinds()).toEqual(['hello', 'create']);
    rig.table(waitingView());
    expect(rig.state().ui.screen).toBe('mpRoom');
  });

  it('a tap before the socket is up waits for it', () => {
    const rig = onCreate();
    const ws = rig.ws();
    fireEvent.click(screen.getByRole('button', { name: W.create.button }));
    expect(ws.sent).toEqual([]);
    rig.connect();
    expect(ws.kinds()).toEqual(['hello', 'create']);
  });

  it('says so when the connection is lost, and "Try again" dials again', async () => {
    const rig = onCreate();
    rig.connect();
    act(() => rig.ws().drop(1006));
    expect(screen.getByText(W.connection.lost)).toBeTruthy();
    await elapse(GIVE_UP_AFTER_MS + 20_000);
    expect(rig.state().mp.connection).toBe('lost');
    expect(screen.getByRole('alert').textContent).toContain(W.connection.gone);
    const before = rig.sockets.length;
    fireEvent.click(screen.getByRole('button', { name: W.connection.tryAgain }));
    expect(rig.state().mp.connection).not.toBe('lost');
    expect(rig.sockets.length).toBe(before + 1);
  });

  it('no control is under 44 × 44 px, and Create table is 56 px tall (§12.12)', () => {
    onCreate();
    const isPrimary = (el: Element): boolean => el.className.includes(cssClass(styles, 'primary'));
    expect(smallTargets(document.querySelector('main') as HTMLElement, isPrimary)).toEqual([]);
  });
});
