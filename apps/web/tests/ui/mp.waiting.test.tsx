// @vitest-environment jsdom
/**
 * The waiting room, joining, the dialogs (PLAN §19.10, Stage 10 acceptance 13): the real App, store
 * and driver over a fake WebSocket. Telegram's share list goes through the driver's port; the words
 * are §19.10's.
 */
import '../../src/ui/styles/tokens.css';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { GIVE_UP_AFTER_MS } from '../../src/app/mp/socket.ts';
import type { MpProblem } from '../../src/app/store.ts';
import { appStore } from '../../src/app/store.ts';
import { mpWords as W } from '../../src/i18n/mp.ts';
import type { TableView } from '../../src/net/protocol.ts';
import { App } from '../../src/ui/App.tsx';
import { problemText } from '../../src/ui/screens/mp/Dialogs.tsx';
import styles from '../../src/ui/screens/Screen.module.css';
import { CODE, OTHER_CODE, seatInfo, waitingView } from '../app/mpFixtures.ts';
import { loadMpChunks, nextRev, startMp, type MpHarness } from './mpHarness.ts';
import { cssClass, smallTargets } from './screens/targets.ts';
import { elapse } from './tableHarness.ts';

beforeAll(loadMpChunks);

let h: MpHarness | null = null;

afterEach(() => {
  cleanup();
  h?.dispose();
  h = null;
  Reflect.deleteProperty(navigator, 'clipboard');
});

function open(options: Parameters<typeof startMp>[0] = {}): MpHarness {
  const rig = startMp(options);
  h = rig;
  render(<App />);
  return rig;
}

const room = (patch: Partial<TableView> = {}): TableView =>
  waitingView({ rev: nextRev(), ...patch });

/** Seated in the waiting room (an invite's way in). */
function inRoom(view: TableView = room()): MpHarness {
  const rig = open({ startParam: CODE });
  rig.connect();
  rig.table(view);
  return rig;
}

const button = (name: string): HTMLElement => screen.getByRole('button', { name });
const noButton = (name: string): void => {
  expect(screen.queryByRole('button', { name })).toBeNull();
};

describe('joining by an invite (§19.10)', () => {
  it('says "Joining the table…" at once, sends `join` after `welcome`, then the waiting room', () => {
    const rig = open({ startParam: CODE });
    expect(rig.state().ui.screen).toBe('mpRoom');
    expect(screen.getByRole('heading', { level: 1, name: W.joining })).toBeTruthy();
    const ws = rig.connect();
    expect(ws.kinds()).toEqual(['hello', 'join']);
    expect(ws.sent.at(-1)).toEqual({ t: 'join', code: CODE });
    rig.table(room());
    expect(screen.getByRole('heading', { level: 1, name: W.waiting.title(CODE) })).toBeTruthy();
  });

  it('Back from "Joining the table…" goes Home and closes the socket', () => {
    const rig = open({ startParam: CODE });
    const ws = rig.ws();
    fireEvent.click(button('Back'));
    expect(rig.state().ui.screen).toBe('home');
    expect(ws.closedWith).not.toBeNull();
  });

  it('after two minutes without the server: "We can\'t reach the game." and "Try again"', async () => {
    const rig = open({ startParam: CODE });
    await elapse(GIVE_UP_AFTER_MS + 60_000);
    expect(rig.state().mp.connection).toBe('lost');
    expect(screen.getByRole('alert').textContent).toContain(W.connection.gone);
    const before = rig.sockets.length;
    fireEvent.click(button(W.connection.tryAgain));
    expect(rig.sockets.length).toBe(before + 1);
  });

  it('a table that is already playing goes straight to the Table', () => {
    const rig = open({ startParam: CODE });
    rig.connect();
    rig.table(room({ status: 'playing', started: true }));
    expect(rig.state().ui.screen).toBe('table');
  });
});

describe('the waiting room: the host (§19.10)', () => {
  it('says the table and the invite on top, every word from §19.10', () => {
    inRoom();
    expect(screen.getByRole('heading', { level: 1, name: W.waiting.title(CODE) })).toBeTruthy();
    expect(screen.getByText(W.waiting.inviteLine)).toBeTruthy();
    expect(button(W.waiting.invite)).toBeTruthy();
  });

  it('"Invite friends" opens Telegram\'s share list with the link and the words', () => {
    const rig = inRoom();
    fireEvent.click(button(W.waiting.invite));
    expect(rig.shared).toEqual([[room().invite, W.waiting.shareText]]);
    expect(rig.ws().kinds()).toEqual(['hello', 'join']); // no message to the server
  });

  it('"Copy link" shows only where the page has a clipboard', () => {
    inRoom();
    noButton(W.waiting.copy);
  });

  it('"Copy link" copies the invite and says "Link copied." for a moment', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    inRoom();
    expect(screen.queryByText(W.waiting.copied)).toBeNull();
    fireEvent.click(button(W.waiting.copy));
    expect(writeText).toHaveBeenCalledWith(room().invite);
    await elapse(0);
    expect(screen.getByText(W.waiting.copied).getAttribute('role')).toBe('status');
    await elapse(3100);
    expect(screen.queryByText(W.waiting.copied)).toBeNull();
  });

  it('a refused copy changes nothing', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.reject(new Error('no')));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    inRoom();
    fireEvent.click(button(W.waiting.copy));
    await elapse(0);
    expect(screen.queryByText(W.waiting.copied)).toBeNull();
  });

  it('lists the seats: "You" with "Host", the others, "Offline", "Empty seat"', () => {
    inRoom(
      room({
        seats: [
          seatInfo('Ann', { host: true, status: 'nextHand' }),
          seatInfo('Ben', { status: 'nextHand', online: false }),
          null,
        ],
      }),
    );
    const rows = [...document.querySelectorAll('main li')].map((row) => [
      row.querySelector('span')?.textContent,
      row.querySelector('strong')?.textContent ?? null,
    ]);
    expect(rows).toEqual([
      [W.waiting.you, W.waiting.host],
      ['Ben', W.waiting.offline],
      [W.waiting.emptySeat, null],
    ]);
  });

  it('an offline host reads "Host · Offline"', () => {
    inRoom(
      room({
        you: 1,
        seats: [seatInfo('Ann', { host: true, online: false }), seatInfo('Ben'), null],
      }),
    );
    expect(document.querySelector('main li strong')?.textContent).toBe(
      `${W.waiting.host} · ${W.waiting.offline}`,
    );
  });

  it('"Start game" works from 2 players', () => {
    const rig = inRoom();
    fireEvent.click(button(W.waiting.start));
    expect(rig.ws().sent.at(-1)).toEqual({ t: 'start' });
    expect(screen.queryByText(W.waiting.needPlayers)).toBeNull();
  });

  it('alone: "Start game" is off and says why', () => {
    const rig = inRoom(
      room({ seats: [seatInfo('Ann', { host: true, status: 'nextHand' }), null, null] }),
    );
    expect((button(W.waiting.start) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(W.waiting.needPlayers)).toBeTruthy();
    fireEvent.click(button(W.waiting.start));
    expect(rig.ws().sent.at(-1)).not.toEqual({ t: 'start' });
  });

  it('a seat that cannot be dealt in does not count', () => {
    inRoom(
      room({
        seats: [
          seatInfo('Ann', { host: true, status: 'nextHand' }),
          seatInfo('Ben', { status: 'nextHand', stack: 0 }),
          seatInfo('Cy', { status: 'sittingOut' }),
        ],
      }),
    );
    expect((button(W.waiting.start) as HTMLButtonElement).disabled).toBe(true);
  });

  it('no control is under 44 × 44 px, and the primary ones are 56 px tall (§12.12)', () => {
    inRoom();
    const isPrimary = (el: Element): boolean => el.className.includes(cssClass(styles, 'primary'));
    expect(smallTargets(document.querySelector('main') as HTMLElement, isPrimary)).toEqual([]);
  });
});

describe('the waiting room: a guest (§19.10)', () => {
  const guest = (): TableView =>
    room({
      you: 1,
      seats: [
        seatInfo('Ann', { host: true, status: 'nextHand' }),
        seatInfo('Ben', { status: 'nextHand' }),
        null,
      ],
    });

  it('waits for the host, by name, with no "Start game"', () => {
    inRoom(guest());
    expect(screen.getByText(W.waiting.guest('Ann'))).toBeTruthy();
    noButton(W.waiting.start);
  });

  it('sees itself as "You" and the seats fill as views come', () => {
    const rig = inRoom(guest());
    expect(document.querySelectorAll('main li')[1]?.querySelector('span')?.textContent).toBe(
      W.waiting.you,
    );
    const view = guest();
    const seats = [...view.seats];
    seats[2] = seatInfo('Cy', { status: 'nextHand' });
    rig.table({ ...view, rev: nextRev(), seats });
    expect(screen.getByText('Cy')).toBeTruthy();
  });
});

describe('a table that was started and has too few now (§19.10)', () => {
  it('says "Waiting for more players." to everyone, with no "Start game"', () => {
    inRoom(room({ started: true }));
    expect(screen.getByText(W.waiting.tooFew)).toBeTruthy();
    noButton(W.waiting.start);
  });
});

describe('leaving (§19.10)', () => {
  const dialog = (): HTMLElement => screen.getByRole('alertdialog');

  it('"Leave table" asks first; "Stay" keeps the seat', () => {
    const rig = inRoom();
    fireEvent.click(button(W.waiting.leave));
    expect(dialog().textContent).toContain(W.leave.text);
    fireEvent.click(within(dialog()).getByRole('button', { name: W.leave.stay }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(rig.ws().sent.at(-1)).not.toEqual({ t: 'leave' });
    expect(rig.state().ui.screen).toBe('mpRoom');
  });

  it('the dialog\'s "Leave table" sends `leave`; `left` goes Home', () => {
    const rig = inRoom();
    fireEvent.click(button(W.waiting.leave));
    fireEvent.click(within(dialog()).getByRole('button', { name: W.leave.confirm }));
    expect(rig.ws().sent.at(-1)).toEqual({ t: 'leave' });
    rig.receive({ t: 'left' });
    expect(rig.state().ui.screen).toBe('home');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(rig.state().mp.active).toBe(false);
  });

  it("Back asks too (the driver's trap, §19.6)", () => {
    const rig = inRoom();
    act(() => rig.state().dispatch({ type: 'back' }));
    expect(dialog().textContent).toContain(W.leave.text);
    expect(rig.state().ui.screen).toBe('mpRoom');
  });

  it('Esc closes it (the same as "Stay")', () => {
    const rig = inRoom();
    fireEvent.click(button(W.waiting.leave));
    fireEvent.keyDown(dialog(), { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(rig.state().ui.screen).toBe('mpRoom');
  });
});

describe('the problem dialog (§19.10)', () => {
  it.each<[MpProblem, string]>([
    [{ kind: 'ended', reason: 'server_restart' }, W.ended.server_restart],
    [{ kind: 'ended', reason: 'idle' }, W.ended.idle],
    [{ kind: 'ended', reason: 'error' }, W.ended.error],
    [{ kind: 'ended', reason: 'gone' }, W.ended.gone],
    [{ kind: 'joinGone' }, W.joinGone],
    [{ kind: 'joinFull' }, W.joinFull],
    [{ kind: 'tooManyTables' }, W.tooManyTables],
    [{ kind: 'login' }, W.login],
    [{ kind: 'outdated' }, W.outdated],
    [{ kind: 'replaced' }, W.replaced],
    [{ kind: 'alreadySeated', other: OTHER_CODE }, W.alreadySeated],
  ])('%j says its §19.10 line', (problem, text) => {
    expect(problemText(problem)).toBe(text);
  });

  it('a table the server ended: the dialog has only OK, Esc does nothing, OK goes Home', () => {
    const rig = inRoom();
    rig.receive({ t: 'ended', code: CODE, reason: 'server_restart' });
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toContain(W.ended.server_restart);
    expect(
      within(dialog)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual([W.ok]);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    act(() => rig.state().dispatch({ type: 'back' }));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    fireEvent.click(button(W.ok));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(rig.state().ui.screen).toBe('home');
  });

  it('a join that failed: "This table is gone." and OK goes Home', () => {
    const rig = open({ startParam: CODE });
    rig.connect();
    rig.receive({ t: 'error', code: 'not_found', re: 'join' });
    expect(screen.getByRole('alertdialog').textContent).toContain(W.joinGone);
    fireEvent.click(button(W.ok));
    expect(rig.state().ui.screen).toBe('home');
  });

  it('already at another table: "Go to my table" and "Leave it and join this one"', () => {
    const rig = open({ startParam: CODE });
    const ws = rig.connect();
    rig.receive({ t: 'error', code: 'already_seated', re: 'join', other: OTHER_CODE });
    expect(screen.getByRole('alertdialog').textContent).toContain(W.alreadySeated);
    noButton(W.ok);
    fireEvent.click(button(W.goToMyTable));
    expect(ws.sent.at(-1)).toEqual({ t: 'join', code: OTHER_CODE });
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('"Leave it and join this one" leaves, then joins', () => {
    const rig = open({ startParam: CODE });
    const ws = rig.connect();
    rig.receive({ t: 'error', code: 'already_seated', re: 'join', other: OTHER_CODE });
    fireEvent.click(button(W.leaveAndJoin));
    expect(ws.sent.at(-1)).toEqual({ t: 'leave' });
    rig.receive({ t: 'left' });
    expect(ws.sent.at(-1)).toEqual({ t: 'join', code: CODE });
  });

  it('a refused login: the §19.10 line on the screen in front', () => {
    const rig = open({ startParam: CODE });
    act(() => rig.ws().open());
    rig.receive({ t: 'error', code: 'auth_failed', re: 'hello' });
    expect(screen.getByRole('alertdialog').textContent).toContain(W.login);
  });
});

describe('the words of the toasts (§19.10)', () => {
  it("the waiting room shows a table's notices", () => {
    const rig = inRoom();
    rig.table(room(), [{ n: 'joined', name: 'Cy' }]);
    expect(screen.getByRole('button', { name: W.toast.joined('Cy') })).toBeTruthy();
  });

  it('every notice has its line', async () => {
    const { noticeText } = await import('../../src/ui/mpEntry.tsx');
    expect(noticeText({ n: 'joined', name: 'Ann' })).toBe('Ann joined the table.');
    expect(noticeText({ n: 'left', name: 'Ann' })).toBe('Ann left the table.');
    expect(noticeText({ n: 'hostChanged', name: 'Ann' })).toBe('Ann is now the host.');
    expect(noticeText({ n: 'timedOut', action: 'fold' })).toBe('Your time ran out. You folded.');
    expect(noticeText({ n: 'timedOut', action: 'check' })).toBe('Your time ran out. You checked.');
    expect(noticeText({ n: 'sittingOut' })).toBe('You are sitting out.');
  });
});

describe('the store stays clean', () => {
  it('leaving forgets the table', () => {
    const rig = inRoom();
    fireEvent.click(button(W.waiting.leave));
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: W.leave.confirm }),
    );
    rig.receive({ t: 'left' });
    expect(appStore.getState().mp.view).toBeNull();
  });
});
