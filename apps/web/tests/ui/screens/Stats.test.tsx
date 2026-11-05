// @vitest-environment jsdom
/**
 * The Stats screen (PLAN §14.4, chunk 8.2): four pages in a radio group, empty states that teach
 * below 5 hands, History's loading, empty and footer states, the chart's hidden data table, tap
 * targets (§12.12) and no suit symbols (pitfall 31). The numbers of every card for 20 scripted
 * hands are `tests/ui/stats.fixture.test.tsx`.
 */
import '../../../src/ui/styles/tokens.css';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HistoryItem } from '../../../src/app/history.ts';
import { appStore, initialData } from '../../../src/app/store.ts';
import { emptyStats, type Stats as StatsData } from '../../../src/persist/schema.ts';
import { Stats, type StatsProps, type StatsTab } from '../../../src/ui/screens/Stats.tsx';
import { SUIT_CODE_POINTS } from '../dom.ts';
import { BB, NOW, playFixture } from '../fixtures/stats20.ts';
import { smallTargets } from './targets.ts';

afterEach(cleanup);

const { stats: TWENTY } = playFixture();

/** `n` clean hands of 0 chips (the view counts the buckets). */
function hands(n: number): StatsData {
  const s = emptyStats();
  return { ...s, results: { ...s.results, clean: { ...s.results.clean, hands: n } } };
}

function show(props: Partial<StatsProps> = {}) {
  const all: StatsProps = {
    stats: TWENTY,
    bb: BB,
    now: NOW,
    history: [],
    tab: 'progress',
    onTab: vi.fn(),
    onOpenHand: vi.fn(),
    onBack: vi.fn(),
    ...props,
  };
  return { ...all, ...render(<Stats {...all} />) };
}

const EMPTY = 'Play 5 hands to see your first stats.';

describe('the Stats screen', () => {
  it('has a title, Back, and four pages as one radio group', () => {
    const { onTab, onBack } = show();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Stats');
    const group = screen.getByRole('group', { name: 'Stats pages' });
    const radios = within(group).getAllByRole('radio') as HTMLInputElement[];
    expect(radios.map((r) => r.labels?.[0]?.textContent)).toEqual([
      'Progress',
      'Results',
      'Hands',
      'History',
    ]);
    expect(radios.map((r) => r.checked)).toEqual([true, false, false, false]);
    fireEvent.click(radios[1] as HTMLInputElement);
    expect(onTab).toHaveBeenCalledWith('results');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledOnce();
  }, 15_000);

  it('below 5 hands Progress and Results teach; Hands and History still show', () => {
    for (const tab of ['progress', 'results'] as StatsTab[]) {
      show({ stats: hands(4), tab });
      expect(screen.getByText(EMPTY)).toBeTruthy();
      expect(screen.getByText('Hands so far: 4')).toBeTruthy();
      cleanup();
    }
    show({ stats: hands(5), tab: 'results' });
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(document.querySelector('[data-stat="hands"] dd')?.textContent).toBe('5');
    cleanup();
    show({ stats: hands(0), tab: 'hands' });
    expect(document.querySelectorAll('[data-category]')).toHaveLength(10);
    cleanup();
    // No stats at all (no storage): as no hand yet.
    show({ stats: null, tab: 'progress' });
    expect(screen.getByText('Hands so far: 0')).toBeTruthy();
  }, 15_000);

  it('History: loading, then the list or "No finished hands yet."; the footer says where stats live', () => {
    show({ tab: 'history', history: null });
    expect(screen.getByText('Loading…')).toBeTruthy();
    cleanup();
    show({ tab: 'history', history: [] });
    expect(screen.getByText('No finished hands yet.')).toBeTruthy();
    expect(screen.getByText('Your stats are saved only on this device.')).toBeTruthy();
    const where = screen.getByText('Where are my stats?');
    expect(where.tagName).toBe('SUMMARY');
    expect(where.parentElement?.textContent).toMatch(/add the game to your Home Screen/);
  }, 15_000);

  it('a History row is a button named by its hand; it opens that hand', () => {
    const items: HistoryItem[] = [
      {
        handSeq: 41,
        handNumber: 12,
        at: '2026-10-20T09:30:00.000Z',
        net: 340,
        bestCategory: 'flush',
        grades: ['best', 'inaccuracy'],
        practice: false,
      },
      {
        handSeq: 40,
        handNumber: 11,
        at: '2026-10-20T09:28:00.000Z',
        net: -20,
        bestCategory: null,
        grades: [],
        practice: true,
      },
    ];
    const { onOpenHand } = show({ tab: 'history', history: items });
    const rows = screen.getAllByRole('button', { name: /^Hand / });
    expect(rows.map((r) => r.getAttribute('data-history-hand'))).toEqual(['41', '40']);
    expect(rows[0]?.textContent).toMatch(/^Hand 12.*Flush\+340Grades: Best move, Slightly off\.$/);
    expect(rows[1]?.textContent).toMatch(/Practice−20No decisions\.$/);
    fireEvent.click(rows[1] as HTMLElement);
    expect(onOpenHand).toHaveBeenCalledWith(40);
    // Long lists skip the work for rows off screen (§14.4).
    expect((rows[0]?.parentElement as HTMLElement).style.contentVisibility).toBe('auto');
  }, 15_000);

  it('every control is big enough to touch, and no suit symbol is drawn as text', () => {
    for (const tab of ['progress', 'results', 'hands', 'history'] as StatsTab[]) {
      const history: HistoryItem[] = [
        {
          handSeq: 1,
          handNumber: 1,
          at: '2026-10-20T09:30:00.000Z',
          net: 0,
          bestCategory: null,
          grades: [null],
          practice: false,
        },
      ];
      const { container } = show({ tab, history });
      expect(
        smallTargets(container, () => false),
        tab,
      ).toEqual([]);
      expect(SUIT_CODE_POINTS.test(container.textContent ?? ''), tab).toBe(false);
      cleanup();
    }
  }, 15_000);
});

describe('Stats, chunk 8.4: History`s [Export] [Import] and the level suggestion card', () => {
  afterEach(() => {
    act(() => appStore.setState({ data: initialData() }));
  });

  it('History`s footer: Export from the tap, Import through the file picker (§14.4, §14.8)', () => {
    const onExport = vi.fn();
    const onImport = vi.fn();
    const { container } = show({ tab: 'history', history: [], onExport, onImport });
    const footer = screen.getByText('Your stats are saved only on this device.')
      .parentElement as HTMLElement;
    fireEvent.click(within(footer).getByRole('button', { name: 'Export' }));
    expect(onExport).toHaveBeenCalledTimes(1);
    const input = footer.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.accept).toBe('application/json,.json');
    expect(input.labels?.[0]?.textContent).toBe('Import');
    const file = new File(['{}'], 'stats.json');
    fireEvent.change(input, { target: { files: [file] } });
    expect(onImport).toHaveBeenCalledWith(file);
    expect(smallTargets(container, () => false)).toEqual([]);
    cleanup();
    show({ tab: 'history', history: [] }); // without the commands: no buttons
    expect(screen.queryByRole('button', { name: 'Export' })).toBeNull();
  }, 15_000);

  it('the level suggestion card (§10.4) at the top of Progress, from the store', () => {
    act(() =>
      appStore.setState({
        data: { ...initialData(), suggestion: { rule: 'botsUp', from: 'easy', to: 'medium' } },
      }),
    );
    show({ tab: 'progress' });
    const card = screen.getByRole('region', { name: 'You beat Easy bots. Try Medium?' });
    // First on the page, before the decision score.
    const page = card.parentElement as HTMLElement;
    expect(page.firstElementChild).toBe(card);
    expect(within(card).getByRole('button', { name: 'Try Medium' })).toBeTruthy();
    cleanup();
    act(() => appStore.setState({ data: initialData() }));
    show({ tab: 'progress' });
    expect(screen.queryByRole('region', { name: /Try Medium/ })).toBeNull();
  }, 15_000);
});
