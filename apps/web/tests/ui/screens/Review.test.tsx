// @vitest-environment jsdom
/**
 * The Review screen (PLAN §12.10, §12.12): stepping through a finished hand, the list of recent
 * hands, the keyboard, the screen-reader names, auto-play, and the pages that are not a replay.
 * It reads the app's one store, as the app does; the hands come from the engine's own play.
 */
import '../../../src/ui/styles/tokens.css';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addHand, initialReview, type ReviewHand } from '../../../src/app/review.ts';
import { buildReview, type ReviewReplay } from '../../../src/app/reviewViews.ts';
import { appStore, defaultGameSettings, initialGame, initialUi } from '../../../src/app/store.ts';
import { AUTOPLAY_MS, frameLines, netSpoken, stepLabel } from '../../../src/ui/review.ts';
import { ReviewRoute } from '../../../src/ui/screens/Review.tsx';
import { collectHands } from '../../app/reviewFixtures.ts';
import { SUIT_CODE_POINTS } from '../dom.ts';
import { smallTargets } from './targets.ts';

const folds = collectHands(3, 'fold');
const shows = collectHands(2, 'showdown').map((h) => ({ ...h, handSeq: h.handSeq + 1000 }));
const [fold, otherFold] = folds as [ReviewHand, ReviewHand, ReviewHand];
const [show] = shows as [ReviewHand, ReviewHand];

const numberOf = (hand: ReviewHand): number => hand.record.table.handsDealt + 1;
const viewOf = (hand: ReviewHand): ReviewReplay => buildReview(hand) as ReviewReplay;

beforeEach(() => {
  appStore.setState({
    game: initialGame(),
    ui: initialUi(false),
    review: initialReview(),
    settings: defaultGameSettings(),
  });
  appStore.getState().dispatch({ type: 'go', screen: 'table' });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** The store as if these hands were played (newest last in the argument) and one is open. */
function open(
  hands: ReviewHand[],
  selected: number | null = hands[hands.length - 1]?.handSeq ?? null,
) {
  appStore.setState({
    review: { hands: hands.reduce((s, h) => addHand(s, h), initialReview()).hands, selected },
  });
  act(() => appStore.getState().dispatch({ type: 'review', handSeq: selected }));
  return render(<ReviewRoute />);
}

const button = (name: string | RegExp) => screen.getByRole('button', { name });
const caption = () => screen.getByRole('status');
const slider = () => screen.getByRole('slider', { name: 'Step' }) as HTMLInputElement;
/** The slider's position (a native range input: its value, not an aria attribute). */
const at = () => Number(slider().value);
const press = (key: string) => act(() => void fireEvent.keyDown(document.body, { key }));

describe('a replay', () => {
  it('is titled with the hand number, takes the focus, and starts at the deal', () => {
    open([fold]);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toBe(`Hand ${numberOf(fold)}`);
    expect(document.activeElement).toBe(heading);
    expect(caption().textContent).toContain('The cards are dealt.');
    expect(slider().getAttribute('aria-valuetext')).toBe('Start');
    expect(slider().max).toBe(String(viewOf(fold).frames.length - 1));
  });

  it('shows the table: the board, the pot, the hero, and the bots with their cards face down', () => {
    open([fold]);
    expect(screen.getByRole('group', { name: `Hand ${numberOf(fold)}` })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Board' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Your hand' })).toBeTruthy();
    const frame0 = viewOf(fold).frames[0];
    expect(screen.getByText(`Pot ${frame0?.pot.total}`)).toBeTruthy();
    for (const bot of frame0?.seats ?? []) {
      // A seat is one labelled group; its cards are drawn face down and not named.
      const pod = document.querySelector(`[data-seat="${bot.seat}"] [role="group"]`);
      expect(pod?.getAttribute('aria-label')).toContain(bot.name);
      expect(pod?.getAttribute('aria-label')).not.toMatch(/ of (spades|hearts|diamonds|clubs)/);
    }
  });

  it('Next and Back step through the hand; the line under the table follows', () => {
    open([fold]);
    const frames = viewOf(fold).frames;
    for (let i = 1; i < frames.length; i++) {
      act(() => void fireEvent.click(button('Next step')));
      const expected = frameLines(viewOf(fold), frames[i] as ReviewReplay['frames'][number]);
      expect(caption().textContent).toContain(expected[0] ?? '');
      expect(at()).toBe(i);
    }
    act(() => void fireEvent.click(button('Previous step')));
    expect(at()).toBe(frames.length - 2);
    act(() => void fireEvent.click(button('First step')));
    expect(at()).toBe(0);
    act(() => void fireEvent.click(button('Last step')));
    expect(at()).toBe(frames.length - 1);
  });

  it('the first step has no Back and the last no Next: aria-disabled, and a click does nothing', () => {
    open([fold]);
    for (const name of ['First step', 'Previous step']) {
      expect(button(name).getAttribute('aria-disabled')).toBe('true');
      act(() => void fireEvent.click(button(name)));
    }
    expect(at()).toBe(0);
    expect(button('Next step').getAttribute('aria-disabled')).toBeNull();
    act(() => void fireEvent.click(button('Last step')));
    for (const name of ['Next step', 'Last step']) {
      expect(button(name).getAttribute('aria-disabled')).toBe('true');
    }
    expect(at()).toBe(viewOf(fold).frames.length - 1);
  });

  it('a button that turns off keeps the keyboard focus (aria-disabled, not disabled)', () => {
    open([fold]);
    const last = viewOf(fold).frames.length - 1;
    const next = button('Next step');
    next.focus();
    for (let i = 0; i < last; i++) act(() => void fireEvent.click(next));
    expect(next.getAttribute('aria-disabled')).toBe('true');
    expect(next.hasAttribute('disabled')).toBe(false);
    expect(document.activeElement).toBe(next);
  });

  it('the slider jumps to any step', () => {
    open([fold]);
    act(() => void fireEvent.change(slider(), { target: { value: '2' } }));
    expect(at()).toBe(2);
    expect(slider().getAttribute('aria-valuetext')).toBe(
      stepLabel(2, viewOf(fold).frames.length - 1),
    );
  });

  it('the last step says how the hand ended and what you won or lost', () => {
    open([fold]);
    act(() => void fireEvent.click(button('Last step')));
    const view = viewOf(fold);
    const text = caption().textContent ?? '';
    expect(text).toContain(frameLines(view, view.frames[view.frames.length - 1] as never)[0]);
    expect(text).toContain(netSpoken(view.end.heroNet));
  });

  it('the line under the table is one polite live region that names the step', () => {
    open([fold]);
    const region = caption();
    expect(region.getAttribute('aria-atomic')).toBe('true');
    act(() => void fireEvent.click(button('Next step')));
    expect(caption().textContent).toContain(`Step 1 of ${viewOf(fold).frames.length - 1}.`);
  });

  it('names its controls and groups them', () => {
    open([fold]);
    const group = screen.getByRole('group', { name: 'Step through the hand' });
    expect(
      within(group)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label') ?? b.textContent),
    ).toEqual(['First step', 'Previous step', 'Play', 'Next step', 'Last step']);
  });

  it('draws no suit symbol and every control is big enough to touch', () => {
    const { container } = open([show]);
    for (let i = 0; i < viewOf(show).frames.length; i++) {
      expect(SUIT_CODE_POINTS.test(document.body.textContent ?? '')).toBe(false);
      act(() => void fireEvent.click(button('Next step')));
    }
    expect(smallTargets(container, () => false)).toEqual([]);
  });
});

describe('the keyboard (PLAN §12.12)', () => {
  it('the arrow keys step, Home and End jump', () => {
    open([fold]);
    const last = viewOf(fold).frames.length - 1;
    press('ArrowRight');
    press('ArrowRight');
    expect(at()).toBe(2);
    press('ArrowLeft');
    expect(at()).toBe(1);
    press('End');
    expect(at()).toBe(last);
    press('ArrowRight');
    expect(at()).toBe(last);
    press('Home');
    expect(at()).toBe(0);
    press('ArrowLeft');
    expect(at()).toBe(0);
  });

  it('other keys and modified keys do nothing', () => {
    open([fold]);
    press('a');
    press('ArrowUp');
    act(() => void fireEvent.keyDown(document.body, { key: 'ArrowRight', ctrlKey: true }));
    act(() => void fireEvent.keyDown(document.body, { key: 'ArrowRight', altKey: true }));
    act(() => void fireEvent.keyDown(document.body, { key: 'ArrowRight', metaKey: true }));
    expect(at()).toBe(0);
  });

  it('on the slider the arrow keys are the slider’s own: no second step from the screen', () => {
    open([fold]);
    act(() => void fireEvent.keyDown(slider(), { key: 'ArrowRight' }));
    expect(at()).toBe(0);
  });

  it('the handled keys are not left to scroll the page', () => {
    open([fold]);
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true,
    });
    act(() => void document.body.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    const other = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
    act(() => void document.body.dispatchEvent(other));
    expect(other.defaultPrevented).toBe(false);
  });

  it('every control can be reached with Tab and used with Enter', () => {
    open([fold]);
    const next = button('Next step');
    next.focus();
    expect(document.activeElement).toBe(next);
    expect(next.tabIndex).toBe(0);
    expect(slider().tabIndex).toBe(0);
  });
});

describe('auto-play', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

  it('Play moves one step every AUTOPLAY_MS and stops at the last step', () => {
    open([fold]);
    const last = viewOf(fold).frames.length - 1;
    act(() => void fireEvent.click(button('Play')));
    expect(button('Pause')).toBeTruthy();
    wait(AUTOPLAY_MS - 1);
    expect(at()).toBe(0);
    wait(1);
    expect(at()).toBe(1);
    // One step per timer: each render schedules the next.
    for (let i = 1; i < last + 2; i++) wait(AUTOPLAY_MS);
    expect(at()).toBe(last);
    expect(button('Play')).toBeTruthy();
    wait(AUTOPLAY_MS * 3);
    expect(at()).toBe(last);
  });

  it('Pause stops it, and a step by hand stops it too', () => {
    open([fold]);
    act(() => void fireEvent.click(button('Play')));
    wait(AUTOPLAY_MS);
    expect(at()).toBe(1);
    act(() => void fireEvent.click(button('Pause')));
    wait(AUTOPLAY_MS * 3);
    expect(at()).toBe(1);
    act(() => void fireEvent.click(button('Play')));
    press('ArrowRight');
    expect(at()).toBe(2);
    expect(button('Play')).toBeTruthy();
    wait(AUTOPLAY_MS * 3);
    expect(at()).toBe(2);
  });

  it('Play at the end starts the hand again from the deal', () => {
    open([fold]);
    act(() => void fireEvent.click(button('Last step')));
    act(() => void fireEvent.click(button('Play')));
    expect(at()).toBe(0);
    wait(AUTOPLAY_MS);
    expect(at()).toBe(1);
  });

  it('leaving the screen stops it (no timer is left running)', () => {
    const { unmount } = open([fold]);
    const before = vi.getTimerCount();
    act(() => void fireEvent.click(button('Play')));
    expect(vi.getTimerCount()).toBe(before + 1);
    unmount();
    expect(vi.getTimerCount()).toBe(before);
  });
});

describe('the list of recent hands', () => {
  it('with no hand: says so and offers the way back', () => {
    open([], null);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Recent hands');
    expect(screen.getByText('No finished hands yet.')).toBeTruthy();
    expect(screen.getByText('Play a hand, then come back here to replay it.')).toBeTruthy();
    act(() => void fireEvent.click(button('Back to the game')));
    expect(appStore.getState().ui.screen).toBe('table');
  });

  it('one row per hand, newest first, with your cards, how it ended and your net', () => {
    open([fold, otherFold, show], null);
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    const first = within(rows[0] as HTMLElement);
    expect(first.getByText(`Hand ${numberOf(show)}`)).toBeTruthy();
    expect(first.getAllByRole('img')).toHaveLength(2);
    const sign = show.end.heroNet > 0 ? '+' : show.end.heroNet < 0 ? '−' : '';
    expect(rows[0]?.textContent).toContain(`${sign}${Math.abs(show.end.heroNet)}`);
    expect(rows[0]?.textContent).toContain(netSpoken(show.end.heroNet));
    expect(within(rows[2] as HTMLElement).getByText(`Hand ${numberOf(fold)}`)).toBeTruthy();
  });

  it('a row opens that hand; "All hands" comes back to the list', () => {
    open([fold, otherFold], null);
    act(
      () => void fireEvent.click(screen.getAllByRole('button', { name: /Hand/ })[1] as HTMLElement),
    );
    expect(appStore.getState().review.selected).toBe(fold.handSeq);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(`Hand ${numberOf(fold)}`);
    act(() => void fireEvent.click(button('All hands')));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Recent hands');
    expect(appStore.getState().review.selected).toBeNull();
  });

  it('moves the focus to the heading when the page changes', () => {
    open([fold, otherFold], null);
    act(
      () => void fireEvent.click(screen.getAllByRole('button', { name: /Hand/ })[0] as HTMLElement),
    );
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
    act(() => void fireEvent.click(button('All hands')));
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
  });

  it('Back leaves Review for the Table, whichever page is showing', () => {
    open([fold], null);
    act(() => void fireEvent.click(button('Back')));
    expect(appStore.getState().ui.screen).toBe('table');
    act(() => appStore.getState().dispatch({ type: 'review', handSeq: fold.handSeq }));
    expect(appStore.getState().ui.screen).toBe('review');
    cleanup();
    render(<ReviewRoute />);
    act(() => void fireEvent.click(button('Back')));
    expect(appStore.getState().ui.screen).toBe('table');
  });

  it('every row is big enough to touch', () => {
    const { container } = open([fold, otherFold, show], null);
    expect(smallTargets(container, () => false)).toEqual([]);
  });
});

describe('wide screens show the list beside the replay', () => {
  beforeEach(() => {
    appStore.getState().dispatch({ type: 'layout', layout: 'wide' });
  });

  it('the replay of the open hand, the list at its side with that hand marked, and no "All hands"', () => {
    open([fold, otherFold], fold.handSeq);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(`Hand ${numberOf(fold)}`);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Recent hands');
    expect(screen.queryByRole('button', { name: 'All hands' })).toBeNull();
    const current = document.querySelector('[aria-current="true"]');
    expect(current?.textContent).toContain(`Hand ${numberOf(fold)}`);
    // A row switches the replay without moving the focus off the list.
    const row = screen
      .getAllByRole('button', { name: /Hand/ })
      .find((b) => b.textContent?.includes(`Hand ${numberOf(otherFold)}`)) as HTMLElement;
    row.focus();
    act(() => void fireEvent.click(row));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      `Hand ${numberOf(otherFold)}`,
    );
    expect(document.activeElement).toBe(row);
  });

  it('opened on the list it shows the newest hand', () => {
    open([fold, otherFold], null);
    expect(appStore.getState().review.selected).toBe(otherFold.handSeq);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      `Hand ${numberOf(otherFold)}`,
    );
  });
});

describe('the other layouts', () => {
  it.each(['landscape', 'compact'] as const)(
    'on a phone in %s the replay has the same controls and the hero’s two cards',
    (layout) => {
      appStore
        .getState()
        .dispatch({ type: 'layout', layout: layout === 'compact' ? 'portrait' : layout });
      if (layout === 'compact') {
        // Portrait and at most 640 px tall (§12.3): the media query reports it.
        window.matchMedia = ((query: string) => ({
          matches: query === '(max-height: 640px)',
          addEventListener: () => {},
          removeEventListener: () => {},
        })) as unknown as typeof window.matchMedia;
      }
      try {
        open([fold]);
        const root = document.querySelector('[data-review]') as HTMLElement;
        expect(root.getAttribute('data-layout')).toBe(layout);
        expect(root.querySelectorAll('[data-hero-cards] [role="img"]')).toHaveLength(2);
        const hero = screen.getByRole(layout === 'landscape' ? 'group' : 'region', {
          name: 'Your hand',
        });
        expect(hero).toBeTruthy();
        act(() => void fireEvent.click(button('Next step')));
        expect(at()).toBe(1);
        expect(button('Play')).toBeTruthy();
        expect(screen.getByRole('slider', { name: 'Step' })).toBeTruthy();
      } finally {
        Reflect.deleteProperty(window, 'matchMedia');
      }
    },
  );
});

describe('a hand that cannot be replayed', () => {
  it('shows why and how it ended, without step controls (§4.7)', () => {
    const old = { ...fold, record: { ...fold.record, engineVersion: '1.0.0' } };
    open([old]);
    expect(screen.getByText(/saved by an older version of the game/)).toBeTruthy();
    expect(screen.getByText(netSpoken(fold.end.heroNet))).toBeTruthy();
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Next step' })).toBeNull();
  });

  it('a broken record says so too', () => {
    const broken = { ...fold, record: { ...fold.record, inputs: [] } };
    open([broken]);
    expect(screen.getByText('This hand cannot be replayed.')).toBeTruthy();
    expect(screen.queryByRole('slider')).toBeNull();
  });
});
