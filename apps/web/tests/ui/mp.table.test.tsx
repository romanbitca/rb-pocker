// @vitest-environment jsdom
/**
 * The one Table at a table of the server's (PLAN §19.6's table of places, §19.10): the real App,
 * store and driver over a fake WebSocket. Nothing of the single-player code knows where the data
 * came from; these are the places that do.
 */
import '../../src/ui/styles/tokens.css';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { GIVE_UP_AFTER_MS } from '../../src/app/mp/socket.ts';
import { appStore } from '../../src/app/store.ts';
import { startHand } from '../../src/engine/start.ts';
import type { TableView } from '../../src/net/protocol.ts';
import { en } from '../../src/i18n/en.ts';
import { mpWords as W } from '../../src/i18n/mp.ts';
import { App } from '../../src/ui/App.tsx';
import { Seat } from '../../src/ui/components/Seat.tsx';
import { loadCoach } from '../../src/ui/coachModule.ts';
import { COMPACT_QUERY } from '../../src/ui/screens/Table.tsx';
import {
  CODE,
  playedHand,
  remoteTable,
  seatInfo,
  SERVER_NOW,
  viewOfHand,
  type SeatKind,
} from '../app/mpFixtures.ts';
import { SEED } from '../engine/helpers.ts';
import {
  HAND,
  KINDS,
  loadMpChunks,
  nextRev,
  OTHER,
  playingView,
  startMp,
  TO_ACT,
  type MpHarness,
} from './mpHarness.ts';
import { elapse, startTableHarness, type TableHarness } from './tableHarness.ts';
import { PLACE, seatView } from './views.ts';

vi.mock('../../src/ui/coachModule.ts', async (actual) => ({
  ...(await actual<typeof import('../../src/ui/coachModule.ts')>()),
  loadCoach: vi.fn(() => Promise.resolve()),
}));

beforeAll(loadMpChunks);

let h: MpHarness | null = null;

afterEach(() => {
  cleanup();
  h?.dispose();
  h = null;
  vi.mocked(loadCoach).mockClear();
});

/** Seated at the table as the viewer `you`, on the Table screen. */
function atTable(you: number, patch: Partial<TableView> = {}): MpHarness {
  const rig = startMp({ startParam: CODE });
  h = rig;
  render(<App />);
  rig.connect();
  rig.table(playingView(you, patch));
  expect(rig.state().ui.screen).toBe('table');
  return rig;
}

const yourTurn = (patch: Partial<TableView> = {}): MpHarness => atTable(TO_ACT, patch);
const theirTurn = (patch: Partial<TableView> = {}): MpHarness => atTable(OTHER, patch);

const strip = (): HTMLElement => document.querySelector('[data-turn]') as HTMLElement;
const seatOf = (n: number): HTMLElement =>
  document.querySelector(`[data-seat="${n}"] > [role="group"]`) as HTMLElement;
const pods = (): Element[] => [...document.querySelectorAll('[data-seat]')];
const button = (name: string): HTMLElement => screen.getByRole('button', { name });

/** Local seat of real seat `real` for a viewer at real seat `you`, at the table of three. */
const localSeat = (real: number, you: number): number => (real - you + 3) % 3;

describe("the status strip (§19.10), in the coach's place", () => {
  it('your turn: "Your turn" and the seconds', () => {
    yourTurn();
    expect(strip().getAttribute('data-turn')).toBe('you');
    expect(strip().textContent).toContain(W.strip.yourTurn);
    expect(strip().textContent).toContain(W.strip.seconds(30));
  });

  it('someone else\'s: "{name} is thinking"', () => {
    theirTurn();
    expect(strip().textContent).toContain(W.strip.thinking(`P${TO_ACT}`));
  });

  it('counts down on the fake clock, once a second', async () => {
    yourTurn();
    await elapse(1000);
    expect(strip().textContent).toContain(W.strip.seconds(29));
    await elapse(9000);
    expect(strip().textContent).toContain(W.strip.seconds(20));
  });

  it('below 10 seconds the seconds are bold (not colour alone)', async () => {
    yourTurn();
    const seconds = () => strip().querySelector('[data-seconds]') as HTMLElement;
    expect(seconds().style.fontWeight).toBe('400');
    expect(seconds().getAttribute('data-seconds')).toBe('');
    await elapse(20_500);
    expect(seconds().textContent).toBe(W.strip.seconds(10));
    expect(seconds().style.fontWeight).toBe('400');
    await elapse(1000);
    expect(seconds().textContent).toBe(W.strip.seconds(9));
    expect(seconds().style.fontWeight).toBe('700');
    expect(seconds().getAttribute('data-seconds')).toBe('low');
  });

  it('stops at 0 and keeps no timer behind', async () => {
    theirTurn();
    await elapse(31_000);
    expect(strip().textContent).toContain(W.strip.seconds(0));
  });

  it('a later view of the same decision does not restart the clock', async () => {
    const rig = yourTurn();
    await elapse(5000);
    rig.table(playingView(TO_ACT));
    expect(strip().textContent).toContain(W.strip.seconds(25));
  });

  it('the running seconds are not announced, the turn is', () => {
    yourTurn();
    expect(strip().querySelector('[data-seconds]')?.getAttribute('aria-hidden')).toBe('true');
    expect(within(strip()).getByRole('status').textContent).toBe(W.strip.yourTurn);
  });

  it('with nothing to say it stays, empty, so the rows do not move', () => {
    atTable(0, { decision: null, legal: null });
    expect(strip().getAttribute('data-turn')).toBe('');
    expect(strip().textContent).toBe('');
  });

  it('not dealt in: "You get cards in the next hand."', () => {
    const kinds: SeatKind[] = ['in', 'in', 'out'];
    const hand = startHand(remoteTable(kinds), SEED);
    const rig = startMp({ startParam: CODE });
    h = rig;
    render(<App />);
    rig.connect();
    rig.table(viewOfHand(kinds, hand, 2, { rev: nextRev() }));
    expect(strip().textContent).toBe(W.strip.notDealtIn);
  });
});

describe('the ring on the seat whose turn it is (§19.10)', () => {
  const ring = (n: number) => seatOf(n).querySelector<HTMLElement>('[style*="--turn-ms"]');

  it('on that pod only, with the time left, a CSS animation', () => {
    theirTurn();
    const seat = localSeat(TO_ACT, OTHER);
    expect(ring(seat)?.style.getPropertyValue('--turn-ms')).toBe('30000ms');
    expect(ring(seat === 1 ? 2 : 1)).toBeNull();
  });

  it("none on the viewer's own turn: there is no pod, the strip says it", () => {
    yourTurn();
    expect(document.querySelector('[style*="--turn-ms"]')).toBeNull();
  });

  it('keeps its time while a later view changes something else', async () => {
    const rig = theirTurn();
    await elapse(5000);
    rig.table(playingView(OTHER));
    const seat = localSeat(TO_ACT, OTHER);
    expect(ring(seat)?.style.getPropertyValue('--turn-ms')).toBe('30000ms');
  });
});

describe('the pods (§19.6)', () => {
  it('are not buttons: no bot card at a table of people', () => {
    theirTurn();
    expect(pods().length).toBe(2);
    expect(document.querySelector('[data-seat] > button')).toBeNull();
  });

  it('the label says the name and not "bot"', () => {
    theirTurn();
    const seat = localSeat(TO_ACT, OTHER);
    const label = seatOf(seat).getAttribute('aria-label') ?? '';
    expect(label.startsWith(`P${TO_ACT}, stack`)).toBe(true);
    expect(label).not.toContain(', bot');
  });

  it("others' cards are face-down backs, their stacks and names are shown", () => {
    theirTurn();
    const seat = seatOf(localSeat(TO_ACT, OTHER));
    expect(seat.textContent).toContain(`P${TO_ACT}`);
    expect(seat.querySelectorAll('[data-card], [class*="card"]').length).toBeGreaterThan(0);
    expect(seat.getAttribute('aria-label')).not.toMatch(/of (spades|hearts|diamonds|clubs)/i);
  });

  it.each([
    [{ online: false }, W.seatNote.offline],
    [{ status: 'sittingOut' as const }, W.seatNote.out],
    [{ status: 'busted' as const }, W.seatNote.out],
    [{ status: 'leaving' as const }, W.seatNote.out],
    [{ status: 'nextHand' as const }, W.seatNote.next],
    [{ online: false, status: 'sittingOut' as const }, W.seatNote.offline],
  ])('%j shows %s, on the pod and in its label', (patch, note) => {
    const rig = theirTurn();
    const seats = [...playingView(OTHER).seats];
    const real = (OTHER + 2) % 3;
    seats[real] = seatInfo(`P${real}`, patch);
    rig.table(playingView(OTHER, { seats }));
    const pod = seatOf(localSeat(real, OTHER));
    expect(pod.textContent).toContain(note);
    expect(pod.getAttribute('aria-label')).toContain(note);
  });

  it('no note on a plain seat', () => {
    theirTurn();
    for (const pod of pods()) {
      for (const note of Object.values(W.seatNote)) expect(pod.textContent).not.toContain(note);
    }
  });

  it("the Seat keeps the bot word for bots, and a note takes the tag's place", () => {
    render(<Seat view={seatView({ lastAction: 'call' })} place={PLACE} />);
    expect(document.querySelector('[role="group"]')?.getAttribute('aria-label')).toContain(
      'Anna, bot, ',
    );
    expect(document.body.textContent).toContain('Call');
    cleanup();
    render(<Seat view={seatView({ bot: false, lastAction: 'call' })} place={PLACE} note="Out" />);
    expect(document.querySelector('[role="group"]')?.getAttribute('aria-label')).not.toContain(
      'bot',
    );
    expect(document.body.textContent).toContain('Out');
    expect(document.body.textContent).not.toContain('Call');
  });
});

describe('no coach at these tables (§19.1 decision 5)', () => {
  it('no coach strip, no win badge, no price chip, no Undo; the bar works', () => {
    yourTurn();
    expect(document.querySelector('[data-coach-panel]')).toBeNull();
    expect(screen.queryByRole('button', { name: en.undo.button })).toBeNull();
    expect(screen.queryByText(/win chance/i)).toBeNull();
    expect(button(en.actions.fold)).toBeTruthy();
  });

  it("asks for neither the coach's nor the summary's chunk", () => {
    yourTurn();
    expect(loadCoach).not.toHaveBeenCalled();
  });

  it('a Table of the local game still asks for them', () => {
    const local: TableHarness = startTableHarness();
    try {
      render(<App />);
      act(() => local.state().dispatch({ type: 'play' }));
      expect(loadCoach).toHaveBeenCalled();
    } finally {
      cleanup();
      local.dispose();
    }
  });

  it('shows no first-table tip and has no coach key', async () => {
    const rig = yourTurn();
    await elapse(10_000);
    expect(rig.state().ui.tip).toBeNull();
    fireEvent.keyDown(window, { key: 'h' });
    expect(rig.ws().kinds()).toEqual(['hello', 'join']);
  });

  it('the hand rankings stay', () => {
    const rig = yourTurn();
    fireEvent.click(screen.getAllByRole('button', { name: en.rankings.open })[0] as HTMLElement);
    expect(rig.state().ui.overlays).toContain('rankings');
  });
});

describe('the bar (§19.6)', () => {
  it("acts through the driver with the decision's `seq`, then locks", () => {
    const rig = yourTurn();
    const check = screen.queryByRole('button', { name: en.actions.check });
    const call = check ?? screen.getByRole('button', { name: /^Call/ });
    fireEvent.click(call);
    const sent = rig.ws().sent.at(-1);
    expect(sent).toMatchObject({ t: 'act', seq: 7 });
    expect(rig.state().game.legal).toBeNull();
  });

  it("is locked on someone else's turn", () => {
    theirTurn();
    expect(button(en.actions.fold).getAttribute('aria-disabled')).toBe('true');
  });
});

describe("the hand end (§19.5, §19.6): the next hand is the server's", () => {
  const states = playedHand(remoteTable(KINDS));
  const ended = states[states.length - 1] as (typeof states)[number];

  function handEnd(you = 0): MpHarness {
    const rig = startMp({ startParam: CODE });
    h = rig;
    render(<App />);
    rig.connect();
    rig.table(viewOfHand(KINDS, ended, you, { rev: nextRev() }));
    return rig;
  }

  it('the result is words on the table, as at a local table (1.3.99)', () => {
    handEnd();
    const result = document.querySelector('[data-hand-result]') as HTMLElement;
    expect(result.getAttribute('role')).toBe('status');
    expect(result.textContent?.length).toBeGreaterThan(0);
  });

  it('no "Next hand ›", no "Review this hand", no "Hand summary"', () => {
    handEnd();
    expect(document.querySelector('[data-hand-end]')).toBeNull();
    expect(screen.queryByText(en.handEnd.nextHand)).toBeNull();
    expect(screen.queryByText(en.handEnd.review)).toBeNull();
    expect(screen.queryByText(en.handEnd.summary)).toBeNull();
    expect(button(en.actions.fold).getAttribute('aria-disabled')).toBe('true');
  });

  it('Enter and Space deal nothing: the next hand is the server`s', () => {
    const rig = handEnd();
    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.keyDown(window, { key: ' ' });
    expect(rig.ws().kinds()).toEqual(['hello', 'join']);
  });

  it('the strip counts the seconds to the next hand', async () => {
    handEnd();
    expect(strip().getAttribute('data-turn')).toBe('nextHand');
    expect(strip().textContent).toBe(W.strip.nextHand(4));
    await elapse(1000);
    expect(strip().textContent).toBe(W.strip.nextHand(3));
  });

  it('the driver swallows `nextHand` and `skipHand`', () => {
    const rig = handEnd();
    act(() => rig.state().dispatch({ type: 'nextHand' }));
    act(() => rig.state().dispatch({ type: 'skipHand' }));
    expect(rig.ws().kinds()).toEqual(['hello', 'join']);
    expect(rig.state().game.mode).toBe('handEnd');
  });

  it('wide: the result goes in the panel, under the strip, with no links', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('min-width: 900px'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    try {
      const rig = handEnd();
      act(() => appStore.setState((s) => ({ ui: { ...s.ui, layout: 'wide' } })));
      expect(rig.state().ui.layout).toBe('wide');
      expect(document.querySelector('[data-hand-panel] [data-hand-result]')).not.toBeNull();
      expect(document.querySelector('[data-hand-panel] [data-turn="nextHand"]')).not.toBeNull();
      expect(screen.queryByText(en.handEnd.review)).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('after a fold there is no "Skip to result ›": the hand keeps the server`s pace', () => {
    const folded = states.find((st) => st.phase === 'betting' && st.seats.some((x) => x.folded));
    if (folded === undefined) throw new Error('the seeded hand has no fold');
    const rig = startMp({ startParam: CODE });
    h = rig;
    render(<App />);
    rig.connect();
    rig.table(
      viewOfHand(
        KINDS,
        folded,
        folded.seats.findIndex((x) => x.folded),
        { rev: nextRev() },
      ),
    );
    expect(rig.state().game.hand?.seats[0]?.folded).toBe(true);
    expect(screen.queryByText(en.actions.skip)).toBeNull();
  });
});

describe('the Menu at these tables (§19.6)', () => {
  const items = (): (string | null)[] =>
    within(screen.getByRole('dialog', { name: en.menu.title }))
      .getAllByRole('button')
      .map((b) => b.textContent);

  it('Resume · Hand rankings · Leave table', () => {
    yourTurn();
    fireEvent.click(button(en.table.menu));
    expect(items()).toEqual([en.menu.resume, en.menu.rankings, en.menu.leaveTable]);
  });

  it('with the sound item in compact mode', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === COMPACT_QUERY,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    try {
      yourTurn();
      fireEvent.click(button(en.table.menu));
      expect(items()).toHaveLength(4);
      // The strip is compact mode's pill, in the hero strip.
      expect(strip().closest('section')).toBe(
        screen.getByRole('region', { name: en.table.yourHand }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('"Leave table" asks first; the dialog\'s button leaves; `left` goes Home', () => {
    const rig = yourTurn();
    fireEvent.click(button(en.table.menu));
    fireEvent.click(button(en.menu.leaveTable));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toContain(W.leave.text);
    fireEvent.click(within(dialog).getByRole('button', { name: W.leave.confirm }));
    expect(rig.ws().sent.at(-1)).toEqual({ t: 'leave' });
    rig.receive({ t: 'left' });
    expect(rig.state().ui.screen).toBe('home');
  });

  it('Back asks too (§19.6)', () => {
    const rig = yourTurn();
    act(() => rig.state().dispatch({ type: 'back' }));
    expect(screen.getByRole('alertdialog').textContent).toContain(W.leave.text);
    expect(rig.state().ui.screen).toBe('table');
  });
});

describe('sitting out (§19.10)', () => {
  const sitOut = (): MpHarness => {
    const seats = [...playingView(OTHER).seats];
    seats[OTHER] = seatInfo(`P${OTHER}`, { status: 'sittingOut' });
    return theirTurn({ seats });
  };

  it('the line and "I\'m back" take Row A\'s place', () => {
    sitOut();
    expect(screen.getByText(W.sittingOut.line)).toBeTruthy();
    expect(screen.queryByRole('button', { name: en.actions.fold })).toBeNull();
  });

  it('"I\'m back" sends `back`', () => {
    const rig = sitOut();
    fireEvent.click(button(W.sittingOut.back));
    expect(rig.ws().sent.at(-1)).toEqual({ t: 'back' });
  });

  it('Row A comes back with the view that says so', () => {
    const rig = sitOut();
    rig.table(playingView(OTHER));
    expect(screen.queryByText(W.sittingOut.line)).toBeNull();
    expect(button(en.actions.fold)).toBeTruthy();
  });
});

describe('busted (§19.10)', () => {
  const bust = (): MpHarness => {
    const seats = [...playingView(OTHER).seats];
    seats[OTHER] = seatInfo(`P${OTHER}`, { status: 'busted', stack: 0 });
    return theirTurn({ seats });
  };

  it("the out-of-chips dialog, in this table's words", () => {
    bust();
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toContain(W.busted.text);
    expect(within(dialog).getByRole('button', { name: W.busted.reload('2,000') })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: W.busted.leave })).toBeTruthy();
  });

  it('"Get 2,000 chips" reloads; "Leave table" leaves', () => {
    const rig = bust();
    fireEvent.click(button(W.busted.reload('2,000')));
    expect(rig.ws().sent.at(-1)).toEqual({ t: 'reload' });
    fireEvent.click(button(W.busted.leave));
    expect(rig.ws().sent.at(-1)).toEqual({ t: 'leave' });
  });

  it('the dialog goes when the view says the seat has chips again', () => {
    const rig = bust();
    rig.table(playingView(OTHER));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('a bust at a local table keeps its own words', () => {
    const local = startTableHarness();
    try {
      render(<App />);
      act(() => {
        local.state().dispatch({ type: 'go', screen: 'table' });
        local.state().dispatch({ type: 'open', overlay: 'outOfChips' });
      });
      expect(screen.getByRole('alertdialog').textContent).toContain(en.dialog.outOfChips.text);
    } finally {
      cleanup();
      local.dispose();
    }
  });
});

describe('the connection (§19.10)', () => {
  it('a thin banner while it tries again, and the bar locks', () => {
    const rig = yourTurn();
    expect(button(en.actions.fold).getAttribute('aria-disabled')).not.toBe('true');
    act(() => rig.ws().drop(1006));
    expect(screen.getByText(W.connection.lost)).toBeTruthy();
    expect(button(en.actions.fold).getAttribute('aria-disabled')).toBe('true');
  });

  it('comes back by itself: the banner goes and the next view opens the bar', async () => {
    const rig = yourTurn();
    act(() => rig.ws().drop(1006));
    await elapse(1000);
    rig.connect('ABCD2345');
    expect(screen.queryByText(W.connection.lost)).toBeNull();
    rig.table(playingView(TO_ACT));
    expect(button(en.actions.fold).getAttribute('aria-disabled')).not.toBe('true');
  });

  it('after two minutes: "We can\'t reach the game.", "Try again" and "Leave table"', async () => {
    const rig = yourTurn();
    act(() => rig.ws().drop(1006));
    await elapse(GIVE_UP_AFTER_MS + 60_000);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain(W.connection.gone);
    const before = rig.sockets.length;
    fireEvent.click(within(alert).getByRole('button', { name: W.connection.tryAgain }));
    expect(rig.sockets.length).toBe(before + 1);
  });

  it('"Leave table" there goes Home without the server', async () => {
    const rig = yourTurn();
    act(() => rig.ws().drop(1006));
    await elapse(GIVE_UP_AFTER_MS + 60_000);
    fireEvent.click(
      within(screen.getByRole('alert')).getByRole('button', { name: W.leave.confirm }),
    );
    expect(rig.state().ui.screen).toBe('home');
    expect(rig.state().mp.active).toBe(false);
  });
});

describe('the toasts of a table (§19.10)', () => {
  it.each([
    [{ n: 'joined', name: 'Cy' } as const, 'Cy joined the table.'],
    [{ n: 'left', name: 'Cy' } as const, 'Cy left the table.'],
    [{ n: 'hostChanged', name: 'Cy' } as const, 'Cy is now the host.'],
    [{ n: 'timedOut', action: 'fold' } as const, 'Your time ran out. You folded.'],
    [{ n: 'timedOut', action: 'check' } as const, 'Your time ran out. You checked.'],
    [{ n: 'handVoided' } as const, en.toast.handVoided],
  ])('%j says "%s"', async (notice, text) => {
    const rig = yourTurn();
    rig.table(playingView(TO_ACT), [notice]);
    await act(async () => {
      await vi.dynamicImportSettled(); // F.10's line is in `en`, the toasts' lazy words
    });
    expect(button(text)).toBeTruthy();
  });
});

describe('a table that ends (§19.10)', () => {
  it('shows its dialog over the Table; OK goes Home and the local game is back', () => {
    const rig = yourTurn();
    rig.receive({ t: 'ended', code: CODE, reason: 'idle' });
    expect(rig.state().ui.screen).toBe('table');
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toContain(W.ended.idle);
    fireEvent.click(within(dialog).getByRole('button', { name: W.ok }));
    expect(rig.state().ui.screen).toBe('home');
    expect(rig.state().mp.active).toBe(false);
  });
});

describe('the fixtures', () => {
  it("are a live hand at the server's clock", () => {
    expect(HAND.phase).toBe('betting');
    expect(SERVER_NOW).toBeGreaterThan(0);
  });
});
