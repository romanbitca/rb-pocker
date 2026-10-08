// @vitest-environment jsdom
/**
 * The bot card on the Table, wired to the real store and controller (PLAN §9.2, §9.3, §10, §12.1,
 * Appendix A.8, chunk 5.10): a tap on a seat opens that bot's card as a modal sheet (the `sheet`
 * gate closes, so no bot acts behind it); Esc, ✕ and Android Back close it and play goes on. The
 * card is a lazy chunk mounted only while open, so the Table's DOM is the same with it closed.
 * The personality badge on the pods follows the level rules: shown at Easy and Medium, hidden at
 * Hard and Expert, per seat when a seat has its own level, and a new bot level starts with the next
 * hand.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { BotLevel, HandState, TableState } from '../../../src/engine/types.ts';
import { en } from '../../../src/i18n/en.ts';
import { App } from '../../../src/ui/App.tsx';
import { formatChips } from '../../../src/ui/format.ts';
import { elapse, playUntil, startTableHarness, type TableHarness } from '../tableHarness.ts';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [false, () => {}],
    offlineReady: [false, () => {}],
    updateServiceWorker: async () => {},
  }),
}));

// The card's chunk is loaded before the tests, so a tap shows it after a few microtasks (in the
// app the chunk is precached and loads from the cache).
beforeAll(async () => {
  await import('../../../src/ui/components/BotCard.tsx');
});

let h: TableHarness | null = null;

afterEach(() => {
  cleanup();
  h?.dispose();
  h = null;
});

type Settings = Parameters<typeof startTableHarness>[0] extends infer O
  ? O extends { settings?: infer S }
    ? S
    : never
  : never;

/** Renders the app on a table and deals (one tap on Play). */
function renderTable(settings: Settings = {}): TableHarness {
  h = startTableHarness({ settings });
  render(<App />);
  act(() => h?.state().dispatch({ type: 'play' }));
  expect(h.state().ui.screen).toBe('table');
  return h;
}

const state = () => (h as TableHarness).state();
const hand = (): HandState => state().game.hand as HandState;
const table = (): TableState => state().game.table as TableState;
const inputs = (): number => (h as TableHarness).controller.snapshot().inputs.length;

/** The bot pods' buttons, seat 1 first. */
const pods = (): HTMLButtonElement[] => [
  ...document.querySelectorAll<HTMLButtonElement>('[data-seat] > button'),
];
const pod = (seat: number): HTMLButtonElement => {
  const el = document.querySelector<HTMLButtonElement>(`[data-seat="${seat}"] > button`);
  if (el === null) throw new Error(`no pod for seat ${seat}`);
  return el;
};
const badges = (root: ParentNode = document): number =>
  root.querySelectorAll('[data-seat] use[href^="#p-"]').length;

/** Lets the lazy card load and render (React suspends once, then shows it). */
async function loaded(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

async function tap(seat: number): Promise<void> {
  fireEvent.click(pod(seat));
  await loaded();
}

const back = () =>
  act(() => {
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
  });

/** The sheet's text. */
const card = (): HTMLElement => screen.getByRole('dialog');

describe('the pods are buttons that open the bot card', () => {
  it('every bot pod is a button with the screen-reader label, and the hero has none', () => {
    renderTable();
    expect(pods()).toHaveLength(5);
    for (const [i, el] of pods().entries()) {
      const slot = table().slots[i + 1];
      expect(el.getAttribute('aria-haspopup')).toBe('dialog');
      expect(el.getAttribute('aria-label')).toMatch(
        new RegExp(`^${slot?.name}, bot, ${en.personality[slot?.personality ?? 'tag']}, stack `),
      );
    }
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a tap opens that bot’s card: name, personality, F.6 text, stack', async () => {
    renderTable();
    await tap(3);
    const slot = table().slots[3];
    expect(slot?.personality).toBe('maniac'); // the Easy list: station, station, maniac, …
    const text = card().textContent ?? '';
    expect(text).toContain(slot?.name);
    expect(text).toContain('Wild');
    expect(text).toContain('Bets and raises with anything.');
    expect(text).toContain('How to beat them');
    expect(text).toContain('Wait for a good hand. Then let them bet for you.');
    expect(text).toContain(en.botCard.stack(formatChips(hand().seats[3]?.stack ?? 0)));
    expect(card().querySelector('use[href="#p-maniac"]')).not.toBeNull();
    // Over the table, as a modal sheet that closes the `sheet` gate.
    expect(state().ui.overlays).toEqual(['botCard']);
    expect(state().ui.botCardSeat).toBe(3);
    expect(state().ui.gates).toEqual(['sheet']);
  });

  it('each seat has its own card', async () => {
    renderTable();
    for (const seat of [1, 5]) {
      await tap(seat);
      const slot = table().slots[seat];
      expect(card().textContent).toContain(slot?.name);
      expect(card().textContent).toContain(en.personalityText[slot?.personality ?? 'tag'].tip);
      fireEvent.click(screen.getByRole('button', { name: en.botCard.close }));
    }
  });
});

describe('the card is mounted only while it is open', () => {
  it('adds nothing to the Table’s DOM when closed, and leaves nothing behind after closing', async () => {
    renderTable();
    const nodes = document.querySelectorAll('*').length;
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.textContent).not.toContain(en.botCard.howToBeat);

    await tap(1);
    expect(document.querySelectorAll('*').length).toBeGreaterThan(nodes);
    fireEvent.click(screen.getByRole('button', { name: en.botCard.close }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelectorAll('*').length).toBe(nodes);
  });

  it('a pod costs no DOM node: the button is the box the labelled group was', () => {
    renderTable();
    expect(document.querySelectorAll('[data-seat] > [role="group"]')).toHaveLength(0);
    const seats = [...document.querySelectorAll('[data-seat]')];
    expect(seats).toHaveLength(5);
    // A seat holds its pod (first) and, when it has one, its bet chip: nothing else.
    for (const seat of seats) {
      expect(seat.firstElementChild?.tagName).toBe('BUTTON');
      expect(seat.children.length).toBeLessThanOrEqual(2);
    }
  });
});

describe('the bots wait while the card is open', () => {
  it('no bot acts behind it; Esc closes it and play goes on', async () => {
    renderTable();
    await playUntil(() => state().game.mode === 'botTurn');
    const before = inputs();
    await tap(2);
    expect(state().ui.gates).toEqual(['sheet']);
    await elapse(30_000);
    expect(inputs()).toBe(before);
    expect(state().game.mode).toBe('botTurn');

    fireEvent.keyDown(card(), { key: 'Escape' });
    expect(state().ui.overlays).toEqual([]);
    expect(state().ui.botCardSeat).toBeNull();
    expect(state().ui.gates).toEqual([]);
    await elapse(4000);
    expect(inputs()).toBeGreaterThan(before);
  }, 20_000);

  it('✕ closes it and play goes on', async () => {
    renderTable();
    await playUntil(() => state().game.mode === 'botTurn');
    const before = inputs();
    await tap(4);
    await elapse(10_000);
    expect(inputs()).toBe(before);
    fireEvent.click(screen.getByRole('button', { name: en.botCard.close }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(state().ui.gates).toEqual([]);
    await elapse(4000);
    expect(inputs()).toBeGreaterThan(before);
  }, 20_000);

  it('a tap on the dimmed table closes it', async () => {
    renderTable();
    await tap(1);
    fireEvent.click(document.querySelector('[class*="scrim"]') as Element);
    expect(state().ui.overlays).toEqual([]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Android Back closes it, never the table', async () => {
    renderTable();
    await playUntil(() => state().game.mode === 'botTurn');
    const before = inputs();
    await tap(2);
    expect(window.history.state).toEqual({ pc: 'back-guard' });
    back();
    expect(state().ui.overlays).toEqual([]);
    expect(state().ui.botCardSeat).toBeNull();
    expect(state().ui.screen).toBe('table');
    expect(state().ui.gates).toEqual([]);
    expect(screen.queryByRole('dialog')).toBeNull();
    await elapse(4000);
    expect(inputs()).toBeGreaterThan(before);
    // The next Back leaves the table, as before.
    back();
    expect(state().ui.screen).toBe('home');
  }, 20_000);

  it('focus returns to the seat that was tapped', async () => {
    renderTable();
    await tap(3);
    expect(card().contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(card(), { key: 'Escape' });
    expect(document.activeElement).toBe(pod(3));
  });
});

describe('the personality label follows the level rules (§9.2)', () => {
  it.each<[BotLevel, boolean]>([
    ['easy', true],
    ['medium', true],
    ['hard', false],
    ['expert', false],
  ])('at %s the pods show the personality: %s', async (botLevel, shown) => {
    renderTable({ botLevel });
    expect(table().config.botLevel).toBe(botLevel);
    expect(badges()).toBe(shown ? 5 : 0);
    const names = Object.values(en.personality);
    for (const el of pods()) {
      const label = el.getAttribute('aria-label') ?? '';
      expect(names.some((n) => label.includes(`, ${n},`))).toBe(shown);
    }
    // And the card says the same.
    await tap(1);
    if (shown) {
      expect(card().textContent).toContain(en.botCard.howToBeat);
      expect(card().textContent).not.toContain(en.botCard.unknownStyle);
    } else {
      expect(card().textContent).toContain(en.botCard.unknownStyle);
      expect(card().textContent).not.toContain(en.botCard.howToBeat);
      for (const text of Object.values(en.personalityText)) {
        expect(card().textContent).not.toContain(text.description);
      }
      expect(card().querySelector('use[href^="#p-"]')).toBeNull();
    }
  });

  it('a seat with its own level follows it: Hard hides one personality among Easy bots', async () => {
    renderTable({ players: 4, seatLevels: [null, 'hard', null, 'expert'] });
    expect(table().config.botLevel).toBe('easy');
    expect(badges(pod(1).parentElement as ParentNode)).toBe(0);
    expect(badges(pod(2).parentElement as ParentNode)).toBe(1);
    expect(badges(pod(3).parentElement as ParentNode)).toBe(0);
    await tap(1);
    expect(card().textContent).toContain(en.botCard.unknownStyle);
    fireEvent.click(screen.getByRole('button', { name: en.botCard.close }));
    await tap(2);
    expect(card().textContent).toContain(en.botCard.howToBeat);
  });

  it('a new bot level starts with the next hand, not in the middle of this one', async () => {
    renderTable();
    expect(badges()).toBe(5);
    const first = hand().handSeq;
    act(() => state().dispatch({ type: 'settings', patch: { botLevel: 'hard' } }));
    // The hand being played keeps the level it was dealt at: its table, its labels.
    expect(table().config.botLevel).toBe('easy');
    expect(badges()).toBe(5);
    await playUntil(() => hand().handSeq === first + 1);
    expect(table().config.botLevel).toBe('hard');
    expect(badges()).toBe(0);
  }, 30_000);
});
