/**
 * The view-model selectors (app/tableViews.ts, re-exported by app/store.ts): the ui/views.ts shapes
 * built from engine state. ⚠️ A bot's hole cards never become a face-up view before a run-out or a
 * showdown (pitfall 13, Stage 3 acceptance 7): checked at every state of many hands.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseCard, parseCards } from '../../src/core/cards.ts';
import { describe as describeHand } from '../../src/eval/describe.ts';
import {
  boardViewOf,
  handEndViewOf,
  heroHandViewOf,
  heroViewOf,
  potView,
  sameSeatView,
  seatView,
  selectActionBarInput,
  selectBoardView,
  selectHeroHandView,
  selectPotView,
  selectSeatViews,
  selectSessionLine,
  selectTableInfo,
  type CardViewData,
  type HeroHandViewData,
  type PotViewData,
  type SeatViewData,
} from '../../src/app/store.ts';
import { legalActions } from '../../src/engine/legal.ts';
import type { HandState } from '../../src/engine/types.ts';
import type { CardView, HeroHandView, PotView, SeatView } from '../../src/ui/views.ts';
import { deal, rigDeck, tableWith } from '../engine/helpers.ts';
import { ADVANCE, call, check, play, raise } from '../engine/play.ts';
import { drive, heroPolicy, makeHarness, SEED } from './harness.ts';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

// The app builds structurally equal objects (app may not import ui, §2.1): they must fit.
const fitsSeat = (v: SeatViewData): SeatView => v;
const fitsCard = (v: CardViewData): CardView => v;
const fitsPot = (v: PotViewData): PotView => v;
const fitsHero = (v: HeroHandViewData): HeroHandView => v;

describe('hidden cards never become face-up views (pitfall 13, acceptance 7)', () => {
  it('at every state of 60 hands over 2–9 seats, only revealed seats show cards', async () => {
    let states = 0;
    let revealedSeen = 0;
    for (const players of [2, 5, 9]) {
      const h = makeHarness({
        seed: SEED,
        settings: { players, startingStack: 400, bb: 20, sb: 10 },
      });
      h.store.subscribe((s) => {
        const hand = s.game.hand;
        if (hand === null) return;
        states++;
        for (const view of selectSeatViews(s)) {
          fitsSeat(view);
          const seat = hand.seats[view.seat];
          if (view.cards.kind === 'revealed') {
            expect(hand.revealed).toContain(view.seat);
            expect(view.cards.cards.map((c) => c.card)).toEqual(seat?.hole);
            revealedSeen++;
          } else if (view.cards.kind === 'hidden') {
            expect(Object.keys(view.cards)).toEqual(['kind']);
          } else {
            expect(seat?.dealtIn !== true || seat.folded).toBe(true);
          }
        }
      });
      h.dispatch({ type: 'play' });
      await drive(h, { hands: 20, hero: heroPolicy(SEED) });
      h.controller.dispose();
    }
    expect(states).toBeGreaterThan(300);
    expect(revealedSeen).toBeGreaterThan(0);
  }, 60_000);
});

describe('seat views (§12.4)', () => {
  // 0 = button (hero), 1 = SB, 2 = BB, 3 = UTG; 50/100.
  it('names, blinds, dealer, bets, turn and last action', () => {
    const table = tableWith([10000, 10000, 10000, 10000], { button: 0 });
    let h = deal(table);
    expect(seatView(h, table, 1)).toMatchObject({
      seat: 1,
      name: 'P1',
      personality: 'tag', // the table is Easy: personalities are shown
      blind: 'sb',
      bet: 50,
      dealer: false,
      toAct: false,
      lastAction: null,
      cards: { kind: 'hidden' },
    });
    expect(seatView(h, table, 3).toAct).toBe(true);
    h = play(h, raise(3, 300));
    expect(seatView(h, table, 3)).toMatchObject({ bet: 300, lastAction: 'raise', toAct: false });
    h = play(h, call(0), call(1), call(2), ADVANCE);
    expect(seatView(h, table, 3)).toMatchObject({ bet: 0, lastAction: null }); // a new street
  });

  it('hides the personality at Hard and Expert', () => {
    const table = tableWith([10000, 10000], { botLevel: 'hard' });
    expect(seatView(deal(table), table, 1).personality).toBeNull();
  });

  it('keeps an unchanged pod the same object; the array changes only when a pod does', () => {
    const h = makeHarness();
    h.dispatch({ type: 'play' });
    const a = selectSeatViews(h.state());
    expect(selectSeatViews(h.state())).toBe(a);
    const table = h.state().game.table;
    const hand = h.state().game.hand as HandState;
    for (let seat = 1; seat < hand.seats.length; seat++) {
      expect(sameSeatView(a[seat - 1] as SeatViewData, seatView(hand, table as never, seat))).toBe(
        true,
      );
    }
    expect(hand.seats).toHaveLength(6);
  });
});

describe('pot, board, hero (§6.1, §12.3, §13.3)', () => {
  it('the pot is every chip in the middle; side pots once someone is all-in', () => {
    const table = tableWith([10000, 300, 10000], { button: 0 });
    let h = deal(table); // 0 BTN, 1 SB (300 chips), 2 BB
    expect(fitsPot(potView(h))).toEqual({ total: 150, pots: [150] });
    h = play(h, raise(0, 1000), call(1)); // the SB calls all-in for 300 in total
    const pot = potView(h);
    expect(pot.total).toBe(1400);
    expect(pot.pots.length).toBeGreaterThanOrEqual(2);
    expect(pot.pots.reduce((a, b) => a + b, 0)).toBe(pot.total);
  });

  it('the hero hand view and the highlights follow describe()', () => {
    const table = tableWith([10000, 10000], { button: 0 });
    let h = rigDeck(deal(table), { holes: { 0: 'Kh Kd', 1: '2c 3d' }, board: 'Ks 7c 2h 9d 4s' });
    const pre = heroHandViewOf(h) as HeroHandViewData;
    fitsHero(pre);
    expect(pre).toMatchObject({ category: 'pair', best5: [], folded: false });
    const label = describeHand([parseCard('Kh'), parseCard('Kd')], []).name;
    expect(heroViewOf(h, legalActions(h))).toMatchObject({ label, toAct: true });
    h = play(h, call(0), check(1), ADVANCE);
    const hero = heroViewOf(h, null);
    expect(hero?.category).toBe('trips');
    expect(hero?.hole.map((c) => c.highlight)).toEqual(['core', 'core']);
    const board = boardViewOf(h);
    board.forEach(fitsCard);
    // Trips with two kickers: all three flop cards are in the best five.
    expect(board.map((c) => c.highlight)).toEqual(['core', 'kicker', 'kicker']);
    expect(board.map((c) => c.card)).toEqual(parseCards('Ks 7c 2h'));
  });

  it('no highlights once the hero folded; the rankings view says folded', () => {
    const table = tableWith([10000, 10000, 10000], { button: 1 }); // hero is BB... 0 = BB
    let h = rigDeck(deal(table), { holes: { 0: 'Ah Ad' }, board: 'As 7c 2h' });
    const first = h.toAct as number;
    h = play(h, raise(first, 400));
    while (h.toAct !== 0) h = play(h, call(h.toAct as number));
    h = play(h, { kind: 'act', seat: 0, action: { type: 'fold' } });
    expect(heroHandViewOf(h)?.folded).toBe(true);
    expect(heroViewOf(h, null)?.hole.every((c) => c.highlight === undefined)).toBe(true);
  });
});

describe('hand end (§12.9) and the other selectors', () => {
  it('winners, shown hands with names, the hero net', async () => {
    const h = makeHarness({ seed: SEED, settings: { players: 3 } });
    h.dispatch({ type: 'play' });
    const done = await drive(h, { hands: 12, hero: heroPolicy(SEED) });
    const showdown = done.find((x) => x.result?.endedBy === 'showdown') as HandState;
    expect(showdown).toBeDefined();
    const table = h.state().game.table;
    const view = handEndViewOf(showdown, table as never);
    expect(view?.winners.length).toBeGreaterThan(0);
    expect(view?.shown.every((x) => x.handName.length > 0)).toBe(true);
    expect(view?.winners.reduce((a, w) => a + w.amount, 0)).toBe(
      showdown.result?.payouts.reduce((a, b) => a + b, 0),
    );
  });

  it('table info, session line, action bar input, pot and board are memoized per state', () => {
    const h = makeHarness({ settings: { players: 4 } });
    expect(selectTableInfo(h.state())).toBeNull();
    expect(selectSessionLine(h.state())).toBeNull();
    h.dispatch({ type: 'play' });
    const s = h.state();
    expect(selectTableInfo(s)).toMatchObject({
      sb: 10,
      bb: 20,
      handNumber: 1,
      players: 4,
      opponents: 3,
    });
    expect(selectSessionLine(s)).toMatchObject({
      hand: 1,
      players: 4,
      chips: 2000,
      botLevel: 'easy',
    });
    expect(selectTableInfo(h.state())).toBe(selectTableInfo(s));
    expect(selectPotView(h.state())).toBe(selectPotView(s));
    expect(selectBoardView(h.state())).toBe(selectBoardView(s));
    expect(selectHeroHandView(h.state())).toBe(selectHeroHandView(s));
    const bar = selectActionBarInput(s);
    expect(bar).toMatchObject({ street: 'preflop', sb: 10, bb: 20, amounts: 'chips' });
    expect(bar?.legal).toBe(s.game.legal);
  });
});
