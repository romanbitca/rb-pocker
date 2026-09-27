/**
 * Sample view models for the dev preview (`?preview=ui`, development builds only).
 * `ui` may not call `describe()` at run time (PLAN §2.1), so the hero's hand facts are written out
 * here; tests/ui/dev/fixtures.test.ts checks them against `describe()`.
 */
import { parseCard, type Card } from '../../core/cards.ts';
import { heroHandView } from '../rankings.ts';
import type { CardHighlight, CardView, HeroHandView, PotView, SeatView } from '../views.ts';

/** `folded`: the hero folded on the flop. `between`: no hand running. */
export const PREVIEW_STATES = [
  'preflop',
  'flop',
  'river',
  'showdown',
  'folded',
  'between',
] as const;
export type PreviewState = (typeof PREVIEW_STATES)[number];

const cards = (text: string): Card[] => text.split(' ').map(parseCard);

/** The hero's cards and the full board of the sample hand. */
export const SAMPLE = {
  hole: cards('Kh Kc') as [Card, Card],
  board: cards('Qh 7h 2h Kd 4s'),
  /** describe(hole, board) at the river: Three of a Kind, Kings. */
  river: {
    category: 'trips',
    best5: cards('Kh Kd Kc Qh 7h'),
    core: cards('Kh Kd Kc'),
    kickers: cards('Qh 7h'),
  },
  /** describe(hole, flop): Pair of Kings (an overpair). */
  flop: {
    category: 'pair',
    best5: cards('Kh Kc Qh 7h 2h'),
    core: cards('Kh Kc'),
    kickers: cards('Qh 7h 2h'),
  },
} as const;

const NAMES = ['Anna', 'Ben', 'Carla', 'Dev', 'Emeka', 'Fatima', 'Goran', 'Hana'] as const;
const PERSONALITIES = ['rock', 'tag', 'lag', 'station', 'maniac', null, 'tag', 'rock'] as const;

/** Board cards for a state, with the §6.1 highlight of the hero's best five. */
export function previewBoard(state: PreviewState): CardView[] {
  if (state === 'between' || state === 'preflop') return [];
  if (state === 'folded') return SAMPLE.board.slice(0, 3).map((card) => ({ card }));
  const facts = state === 'flop' ? SAMPLE.flop : SAMPLE.river;
  return SAMPLE.board.slice(0, state === 'flop' ? 3 : 5).map((card) => {
    const highlight: CardHighlight = (facts.core as readonly Card[]).includes(card)
      ? 'core'
      : (facts.kickers as readonly Card[]).includes(card)
        ? 'kicker'
        : 'off';
    return { card, highlight };
  });
}

export function previewPot(state: PreviewState): PotView {
  switch (state) {
    case 'between':
      return { total: 0, pots: [] };
    case 'preflop':
      return { total: 30, pots: [30] };
    case 'flop':
    case 'folded':
      return { total: 340, pots: [340] };
    default:
      return { total: 2_990, pots: [1_250, 1_740] };
  }
}

/** The hero's hand for the rankings panel; `null` between hands. */
export function previewHero(state: PreviewState): HeroHandView | null {
  const handSeq = 12;
  switch (state) {
    case 'between':
      return null;
    case 'preflop':
      return heroHandView(
        { category: 'pair', best5: [], kickers: [] },
        SAMPLE.hole,
        false,
        handSeq,
      );
    case 'flop':
    case 'folded':
      return heroHandView(SAMPLE.flop, SAMPLE.hole, state === 'folded', handSeq);
    default:
      return heroHandView(SAMPLE.river, SAMPLE.hole, false, handSeq);
  }
}

/** Opponents in a mix of states: folded, called, raised, thinking, all-in, checked. */
export function previewSeats(opponents: number, state: PreviewState): SeatView[] {
  const showdown = state === 'showdown';
  if (state === 'between') {
    return previewSeats(opponents, 'preflop').map((s) => ({
      ...s,
      bet: 0,
      folded: false,
      allIn: false,
      toAct: false,
      lastAction: null,
      blind: null,
      cards: { kind: 'none' },
    }));
  }
  return Array.from({ length: opponents }, (_, i): SeatView => {
    const seat = i + 1;
    const base: SeatView = {
      seat,
      name: NAMES[i] ?? `Bot ${seat}`,
      personality: PERSONALITIES[i] ?? null,
      stack: [1_250, 2_340, 880, 12_399, 0, 1_975, 2_000, 640][i] ?? 1_000,
      bet: 0,
      dealer: seat === Math.min(3, opponents),
      blind: seat === 1 ? 'sb' : seat === 2 ? 'bb' : null,
      folded: false,
      allIn: false,
      toAct: false,
      lastAction: null,
      cards: { kind: 'hidden' },
      winner: false,
    };
    switch (i % 6) {
      case 0:
        return { ...base, folded: true, cards: { kind: 'none' } };
      case 1:
        if (!showdown) return { ...base, bet: state === 'preflop' ? 20 : 120, lastAction: 'call' };
        // The first of these wins with a flush (A-Q-9-7-2 of hearts); a later one just shows.
        return i === 1
          ? {
              ...base,
              winner: true,
              cards: {
                kind: 'revealed',
                cards: [
                  { card: parseCard('Ah'), highlight: 'core' },
                  { card: parseCard('9h'), highlight: 'core' },
                ],
              },
            }
          : {
              ...base,
              cards: {
                kind: 'revealed',
                cards: [{ card: parseCard('Js') }, { card: parseCard('Td') }],
              },
            };
      case 2:
        return showdown
          ? {
              ...base,
              cards: {
                kind: 'revealed',
                cards: [{ card: parseCard('Qs') }, { card: parseCard('Qc') }],
              },
            }
          : { ...base, bet: state === 'preflop' ? 60 : 1_250, lastAction: 'raise' };
      case 3:
        return { ...base, toAct: !showdown };
      case 4:
        return { ...base, allIn: true, bet: showdown ? 0 : 2_340 };
      default:
        return { ...base, lastAction: 'check' };
    }
  });
}
