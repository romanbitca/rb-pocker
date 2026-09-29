// @vitest-environment jsdom
/**
 * Stage 3 acceptance 7 (PLAN pitfall 13, §4.8): over seeded multi-hand games rendered by the real
 * App, no bot hole card is ever face up in the DOM, or named in any text or `aria-label`, before a
 * run-out or showdown reveals it (`hand.revealed`). Checked after every step of play, with the
 * hero acting at random; folded bots' cards stay hidden for good. Also: no Unicode suit code
 * point (U+2660–U+2667) ever reaches the DOM (pitfall 31).
 */
import { cleanup, render } from '@testing-library/react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cardAriaLabel } from '../../../src/core/cards.ts';
import type { HandState } from '../../../src/engine/types.ts';
import { en } from '../../../src/i18n/en.ts';
import { App } from '../../../src/ui/App.tsx';
import { heroPolicy } from '../../app/harness.ts';
import { SUIT_CODE_POINTS } from '../dom.ts';
import { playUntil, startTableHarness, type TableHarness } from '../tableHarness.ts';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [false, () => {}],
    offlineReady: [false, () => {}],
    updateServiceWorker: async () => {},
  }),
}));

let h: TableHarness | null = null;

afterEach(() => {
  cleanup();
  h?.dispose();
  h = null;
});

interface Tally {
  steps: number;
  /** Seat checks while the seat's cards were hidden, and while they were revealed. */
  hidden: number;
  revealed: number;
}

/** Every bot seat: face-down (and unnamed) unless revealed; revealed cards are face up. */
function checkNoLeak(hand: HandState | null, tally: Tally): void {
  tally.steps++;
  const html = document.body.innerHTML;
  expect(SUIT_CODE_POINTS.test(document.body.textContent)).toBe(false);
  if (hand === null) return;
  for (let seat = 1; seat < hand.seats.length; seat++) {
    const hole = hand.seats[seat]?.hole ?? null;
    if (hole === null) continue;
    const pod = document.querySelector(`[data-seat="${seat}"]`);
    const faces = [...(pod?.querySelectorAll('[role="img"]') ?? [])].filter(
      (el) => el.getAttribute('aria-label') !== en.cards.hidden,
    );
    if (hand.revealed.includes(seat)) {
      tally.revealed++;
      expect(faces.map((el) => el.getAttribute('aria-label'))).toEqual(hole.map(cardAriaLabel));
    } else {
      tally.hidden++;
      expect(faces).toEqual([]);
      for (const card of hole) {
        if (html.includes(cardAriaLabel(card))) {
          throw new Error(`hand ${hand.handSeq}: seat ${seat}'s ${cardAriaLabel(card)} leaked`);
        }
      }
    }
  }
}

async function playHands(players: number, hands: number, seed: `${string}`): Promise<Tally> {
  h = startTableHarness({ settings: { players } });
  render(<App />);
  act(() => h?.state().dispatch({ type: 'play' }));
  const tally: Tally = { steps: 0, hidden: 0, revealed: 0 };
  const hero = heroPolicy(seed);
  const first = h.state().game.hand?.handSeq ?? 1;
  await playUntil(() => (h?.state().game.hand?.handSeq ?? 0) >= first + hands, {
    hero,
    onStep: () => checkNoLeak(h?.state().game.hand ?? null, tally),
    maxSteps: 20_000,
  });
  return tally;
}

describe('no bot card reaches the DOM before it is revealed (acceptance 7)', () => {
  it('6 players, 30 hands: checked after every step', async () => {
    const tally = await playHands(6, 30, 'a11ce000a11ce000a11ce000a11ce000');
    expect(tally.steps).toBeGreaterThan(500);
    expect(tally.hidden).toBeGreaterThan(1000);
    // Showdowns happened, and their cards did show: the check is not vacuous.
    expect(tally.revealed).toBeGreaterThan(0);
  }, 60_000);

  it('9 players and heads-up, 15 hands each', async () => {
    const nine = await playHands(9, 15, 'b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0');
    cleanup();
    h?.dispose();
    const two = await playHands(2, 15, 'c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0');
    expect(nine.hidden).toBeGreaterThan(500);
    expect(two.hidden).toBeGreaterThan(50);
    expect(nine.revealed + two.revealed).toBeGreaterThan(0);
  }, 60_000);
});
