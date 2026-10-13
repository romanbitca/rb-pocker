// @vitest-environment jsdom
/**
 * The non-cheating rule holds in Review too (PLAN §3.9, §4.8, pitfall 13): a replay shows a bot's
 * hole cards only from the step where they were turned face up in the real hand, and a folded
 * hand never. Over seeded hands that ended in folds (and some showdowns as the control), the
 * screen is rendered and stepped through frame by frame; at every frame no hidden bot card is
 * face up in the DOM or named in any text or `aria-label`, and what is hidden is drawn as backs.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addHand, initialReview, type ReviewHand } from '../../../src/app/review.ts';
import { appStore, defaultGameSettings, initialGame, initialUi } from '../../../src/app/store.ts';
import { cardAriaLabel, type Card } from '../../../src/core/cards.ts';
import { replayStates } from '../../../src/engine/replay.ts';
import type { HandState } from '../../../src/engine/types.ts';
import { en } from '../../../src/i18n/en.ts';
import { ReviewRoute } from '../../../src/ui/screens/Review.tsx';
import { collectHands } from '../../app/reviewFixtures.ts';
import { SUIT_CODE_POINTS } from '../dom.ts';

beforeEach(() => {
  appStore.setState({
    game: initialGame(),
    ui: initialUi(false),
    review: initialReview(),
    settings: defaultGameSettings(),
  });
  appStore.getState().dispatch({ type: 'go', screen: 'table' });
});
afterEach(cleanup);

interface Tally {
  hands: number;
  frames: number;
  /** Seat checks while the seat's cards were hidden (still in the hand), folded, and face up. */
  hidden: number;
  folded: number;
  faceUp: number;
}

const hiddenBack = en.cards.hidden;

/** The two hole cards of every bot that must not be seen at `h`: folded, or live and not face up. */
function forbidden(
  h: HandState,
): { seat: number; cards: [Card, Card]; why: 'folded' | 'hidden' }[] {
  const out: { seat: number; cards: [Card, Card]; why: 'folded' | 'hidden' }[] = [];
  h.seats.forEach((s, seat) => {
    if (seat === 0 || !s.dealtIn || s.hole === null) return;
    if (s.folded) out.push({ seat, cards: s.hole, why: 'folded' });
    else if (!h.revealed.includes(seat)) out.push({ seat, cards: s.hole, why: 'hidden' });
  });
  return out;
}

/** Renders Review on `hand`, steps through every frame and checks the DOM at each one. */
function walk(hand: ReviewHand, tally: Tally): void {
  appStore.setState({ review: addHand(initialReview(), hand) });
  act(() => appStore.getState().dispatch({ type: 'review', handSeq: hand.handSeq }));
  const { unmount } = render(<ReviewRoute />);
  const states = replayStates(hand.record);
  const next = screen.getByRole('button', { name: 'Next step' });
  tally.hands++;
  states.forEach((h, i) => {
    tally.frames++;
    const html = document.body.innerHTML;
    expect(SUIT_CODE_POINTS.test(document.body.textContent ?? '')).toBe(false);

    // The hero's own cards are always shown.
    const heroHole = h.seats[0]?.hole ?? [];
    const mine = within(screen.getByRole('region', { name: 'Your hand' }));
    expect(
      mine.getAllByRole('img').map((el) => el.getAttribute('aria-label')),
      `hand ${hand.handSeq} frame ${i}: your hand`,
    ).toEqual(heroHole.map(cardAriaLabel));

    for (const { seat, cards, why } of forbidden(h)) {
      const where = `hand ${hand.handSeq} frame ${i} seat ${seat} (${why})`;
      for (const card of cards) {
        expect(html.includes(cardAriaLabel(card)), `${where}: ${cardAriaLabel(card)} leaked`).toBe(
          false,
        );
      }
      // Hidden hands are two backs, folded hands are no cards at all.
      const pod = document.querySelector(`[data-seat="${seat}"]`) as HTMLElement;
      const faces = [...pod.querySelectorAll('[role="img"]')].map((el) =>
        el.getAttribute('aria-label'),
      );
      expect(faces, where).toEqual(why === 'hidden' ? [hiddenBack, hiddenBack] : []);
      tally[why]++;
    }

    // Revealed live hands are face up, both cards, in the seat's own pod.
    h.seats.forEach((s, seat) => {
      if (seat === 0 || !s.dealtIn || s.folded || s.hole === null) return;
      if (!h.revealed.includes(seat)) return;
      const pod = document.querySelector(`[data-seat="${seat}"]`) as HTMLElement;
      const faces = [...pod.querySelectorAll('[role="img"]')].map((el) =>
        el.getAttribute('aria-label'),
      );
      expect(faces, `hand ${hand.handSeq} frame ${i} seat ${seat} face up`).toEqual(
        s.hole.map(cardAriaLabel),
      );
      tally.faceUp++;
    });

    if (i < states.length - 1) act(() => void fireEvent.click(next));
  });
  unmount();
}

const tally = (): Tally => ({ hands: 0, frames: 0, hidden: 0, folded: 0, faceUp: 0 });

describe('Review never shows a card that was not shown in the real hand', () => {
  it('hands that ended in folds: no bot card, at any step, for 3, 6 and 9 players', () => {
    const t = tally();
    for (const players of [3, 6, 9]) {
      for (const hand of collectHands(8, 'fold', players)) {
        expect(hand.end.endedBy).toBe('fold');
        walk(hand, t);
      }
    }
    expect(t.hands).toBe(24);
    expect(t.frames).toBeGreaterThan(150);
    // Not vacuous: many hidden hands, many folded ones, and nothing ever face up.
    expect(t.hidden).toBeGreaterThan(500);
    expect(t.folded).toBeGreaterThan(300);
    expect(t.faceUp).toBe(0);
  }, 120_000);

  it('the last step of a hand won by folds shows no bot card at all', () => {
    for (const hand of collectHands(10, 'fold', 6)) {
      appStore.setState({ review: addHand(initialReview(), hand) });
      act(() => appStore.getState().dispatch({ type: 'review', handSeq: hand.handSeq }));
      const { unmount } = render(<ReviewRoute />);
      act(() => void fireEvent.click(screen.getByRole('button', { name: 'Last step' })));
      const bots = (replayStates(hand.record).at(-1) as HandState).seats.slice(1);
      for (const s of bots) {
        for (const card of s.hole ?? []) {
          expect(document.body.innerHTML.includes(cardAriaLabel(card))).toBe(false);
        }
      }
      // The result says it was won by folds, and names no hand.
      expect(screen.getByRole('status').textContent).toMatch(/folded|Everyone else folded/);
      unmount();
    }
  }, 60_000);

  it('the control: at a showdown the cards do show, from the reveal step on', () => {
    const t = tally();
    for (const hand of collectHands(6, 'showdown', 6)) walk(hand, t);
    expect(t.faceUp).toBeGreaterThan(20);
    expect(t.hidden).toBeGreaterThan(100);
  }, 120_000);

  it('the same, with the list showing beside the replay (wide screens)', () => {
    appStore.getState().dispatch({ type: 'layout', layout: 'wide' });
    const t = tally();
    for (const hand of collectHands(4, 'fold', 6)) walk(hand, t);
    // The list rows show only your own cards.
    expect(t.faceUp).toBe(0);
    expect(t.hidden).toBeGreaterThan(30);
  }, 60_000);
});
