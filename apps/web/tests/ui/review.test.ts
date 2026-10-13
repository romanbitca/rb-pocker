// Review's words (PLAN §12.10): what each step of a replay says, in plain English, with cards
// named in words and amounts with thousands separators.
import { describe, expect, it } from 'vitest';
import {
  buildReview,
  type ReviewActor,
  type ReviewEvent,
  type ReviewReplay,
} from '../../src/app/reviewViews.ts';
import { SUIT_CODE_POINTS } from './dom.ts';
import { handEndLines } from '../../src/ui/handEnd.ts';
import { eventLines, frameLines, netSpoken, netText, stepLabel } from '../../src/ui/review.ts';
import { collectHands } from '../app/reviewFixtures.ts';

const you: ReviewActor = { seat: 0, name: 'You', hero: true };
const ben: ReviewActor = { seat: 3, name: 'Ben', hero: false };

describe('eventLines', () => {
  const lines = (e: ReviewEvent) => eventLines(e);

  it('blinds', () => {
    expect(lines({ kind: 'blind', who: ben, blind: 'sb', amount: 10 })).toEqual([
      'Ben posts the small blind, 10.',
    ]);
    expect(lines({ kind: 'blind', who: you, blind: 'bb', amount: 2000 })).toEqual([
      'You post the big blind, 2,000.',
    ]);
  });

  it('actions: "You fold." for the hero, "Ben folds." for a bot', () => {
    const act = (action: 'fold' | 'check' | 'call' | 'bet' | 'raise', who = ben) =>
      lines({ kind: 'act', who, action, to: 120, amountIn: 80, allIn: false });
    expect(act('fold')).toEqual(['Ben folds.']);
    expect(act('fold', you)).toEqual(['You fold.']);
    expect(act('check')).toEqual(['Ben checks.']);
    expect(act('call')).toEqual(['Ben calls 80.']);
    expect(act('call', you)).toEqual(['You call 80.']);
    expect(act('bet')).toEqual(['Ben bets 120.']);
    expect(act('raise')).toEqual(['Ben raises to 120.']);
    expect(act('raise', you)).toEqual(['You raise to 120.']);
  });

  it('an all-in action says so in a second sentence', () => {
    expect(
      lines({ kind: 'act', who: ben, action: 'raise', to: 1980, amountIn: 1900, allIn: true }),
    ).toEqual(['Ben raises to 1,980.', 'All-in.']);
  });

  it('streets name the cards in words, never with suit symbols', () => {
    const [flop] = lines({ kind: 'street', street: 'flop', cards: [51, 26, 4] });
    expect(flop).toBe('The flop: Ace of spades, Eight of hearts, Three of clubs.');
    expect(SUIT_CODE_POINTS.test(flop ?? '')).toBe(false);
    expect(lines({ kind: 'street', street: 'turn', cards: [9] })).toEqual([
      'The turn: Four of diamonds.',
    ]);
    expect(lines({ kind: 'street', street: 'river', cards: [14] })).toEqual([
      'The river: Five of hearts.',
    ]);
  });

  it('reveals, refunds and undo', () => {
    expect(lines({ kind: 'reveal', who: [ben, you], reason: 'showdown' })).toEqual([
      'Showdown. Cards face up: Ben and you.',
    ]);
    expect(lines({ kind: 'reveal', who: [you, ben], reason: 'runout' })).toEqual([
      'All-in. Cards face up: you and Ben.',
    ]);
    expect(lines({ kind: 'refund', who: ben, amount: 40 })).toEqual([
      'Ben gets 40 back. Nobody called.',
    ]);
    expect(lines({ kind: 'refund', who: you, amount: 40 })).toEqual([
      'You get 40 back. Nobody called.',
    ]);
    expect(lines({ kind: 'reshuffle' })).toEqual([
      'Move taken back. The unseen cards were shuffled again.',
    ]);
  });
});

describe('net and step labels', () => {
  it('signs: "+160", "−80" with a real minus sign, "0"', () => {
    expect(netText(160)).toBe('+160');
    expect(netText(-80)).toBe('−80');
    expect(netText(0)).toBe('0');
    expect(netText(12_340)).toBe('+12,340');
  });

  it('what a screen reader says', () => {
    expect(netSpoken(160)).toBe('You won 160 chips.');
    expect(netSpoken(-1080)).toBe('You lost 1,080 chips.');
    expect(netSpoken(0)).toBe('You broke even.');
  });

  it('"Start" on the deal, then "Step 7 of 23"', () => {
    expect(stepLabel(0, 23)).toBe('Start');
    expect(stepLabel(7, 23)).toBe('Step 7 of 23');
  });
});

describe('frameLines', () => {
  const view = (() => {
    const [hand] = collectHands(1, 'showdown');
    if (hand === undefined) throw new Error('no hand');
    return buildReview(hand) as ReviewReplay;
  })();
  const last = view.frames.length - 1;

  it('the deal says the cards are dealt, then the blinds', () => {
    const lines = frameLines(view, view.frames[0] ?? fail());
    expect(lines[0]).toBe('The cards are dealt.');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toMatch(/small blind, 10\.$/);
    expect(lines[2]).toMatch(/big blind, 20\.$/);
  });

  it('a middle step says what its events were', () => {
    const lines = frameLines(view, view.frames[1] ?? fail());
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/\.$/);
  });

  it('the last step is the result the hand-end banner showed, then your net', () => {
    const lines = frameLines(view, view.frames[last] ?? fail());
    expect(lines).toEqual([...handEndLines(view.end), netSpoken(view.end.heroNet)]);
  });

  it('no step ever uses a suit symbol', () => {
    for (const frame of view.frames) {
      expect(SUIT_CODE_POINTS.test(frameLines(view, frame).join(' '))).toBe(false);
    }
  });
});

function fail(): never {
  throw new Error('missing frame');
}
