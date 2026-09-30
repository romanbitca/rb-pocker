/**
 * All-in TV mode and the luck line as data (PLAN §7.6, §12.9; chunk 4.7, `app/runoutViews.ts`):
 * which seats get a bar and with which number, when the bars show, and when the luck line says
 * "unlucky" or "lucky". Real engine hands (a rigged deck), hand-made equity slices.
 */
import { describe, expect, it } from 'vitest';
import {
  faceUpSeats,
  LUCKY_PCT,
  luckLineOf,
  runoutViewOf,
  selectLuckLine,
  selectRunoutView,
  UNLUCKY_PCT,
} from '../../src/app/runoutViews.ts';
import type { AppState, KnownEquity } from '../../src/app/store.ts';
import type { HandState, TableState } from '../../src/engine/types.ts';
import { deal, rigDeck, tableWith } from '../engine/helpers.ts';
import { ADVANCE, call, fold, play, raise } from '../engine/play.ts';

/** Heads-up, the hero on the button: the hero moves all in before the flop and the bot calls. */
function allInPreflop(holes: { hero: string; bot: string }, board: string) {
  const table = tableWith([10_000, 10_000], { button: 0 });
  const dealt = rigDeck(deal(table), { holes: { 0: holes.hero, 1: holes.bot }, board });
  const called = play(dealt, raise(0, 10_000), call(1)); // roundComplete, nothing shown yet
  const flop = play(called, ADVANCE); // the hands turn face up with the flop
  const turn = play(flop, ADVANCE);
  const river = play(turn, ADVANCE);
  const complete = play(river, ADVANCE, ADVANCE); // showdown, then settled
  return { table, called, flop, turn, river, complete };
}

const known = (hand: HandState, perPlayer: number[], final = true): KnownEquity => ({
  handSeq: hand.handSeq,
  seats: faceUpSeats(hand),
  board: [...hand.board],
  perPlayer,
  exact: true,
  final,
});

const state = (
  hand: HandState | null,
  table: TableState | null,
  equity: { known?: KnownEquity | null; allIn?: KnownEquity | null },
): AppState =>
  ({
    game: { hand, table },
    equity: { known: equity.known ?? null, allIn: equity.allIn ?? null },
  }) as unknown as AppState;

describe('TV mode bars (§7.6)', () => {
  const run = allInPreflop({ hero: 'Kh Kd', bot: '2c 3d' }, 'Ks 7c 2h 9d 4s');

  it('none before the hands are face up, and none once the hand is complete', () => {
    expect(faceUpSeats(run.called)).toEqual([]);
    expect(runoutViewOf(run.called, run.table, null)).toBeNull();
    const done = known(run.complete, [1, 0]);
    expect(runoutViewOf(run.complete, run.table, done)).toBeNull();
  });

  it('one bar per face-up player, in reveal order, whole percent, the bot named', () => {
    expect(run.flop.runout).toBe(true);
    const seats = faceUpSeats(run.flop);
    expect([...seats].sort()).toEqual([0, 1]);
    const eq = seats.map((s) => (s === 0 ? 0.9131 : 0.0869));
    const view = runoutViewOf(run.flop, run.table, known(run.flop, eq));
    const botName = run.table.slots[1]?.name ?? '';
    expect(botName).not.toBe('');
    expect(view?.bars).toEqual(
      seats.map((seat) =>
        seat === 0 ? { seat, name: '', pct: 91 } : { seat, name: botName, pct: 9 },
      ),
    );
  });

  it('keeps the last street’s numbers until the new ones come; ignores another hand’s', () => {
    const flopEq = known(run.flop, [0.5, 0.5]);
    // The turn is out, its equities are not: the flop's stay on the bars.
    expect(runoutViewOf(run.turn, run.table, flopEq)?.bars.map((b) => b.pct)).toEqual([50, 50]);
    const other = { ...flopEq, handSeq: run.flop.handSeq + 1 };
    expect(runoutViewOf(run.turn, run.table, other)).toBeNull();
  });

  it('a seat missing from the equities gets no bar (and never a hidden seat)', () => {
    const eq = known(run.flop, [0.7, 0.3]);
    const onlyFirst = { ...eq, seats: eq.seats.slice(0, 1), perPlayer: [0.7] };
    const view = runoutViewOf(run.flop, run.table, onlyFirst);
    expect(view?.bars).toHaveLength(1);
    expect(view?.bars[0]?.seat).toBe(eq.seats[0]);
  });

  it('selectRunoutView keeps its object while the bars do not change (pitfall 37)', () => {
    const eq = known(run.flop, [0.62, 0.38]);
    const a = selectRunoutView(state(run.flop, run.table, { known: eq }));
    const b = selectRunoutView(state({ ...run.flop }, run.table, { known: { ...eq } }));
    expect(a).not.toBeNull();
    expect(b).toBe(a);
    const c = selectRunoutView(
      state(run.flop, run.table, { known: { ...eq, perPlayer: [0.7, 0.3] } }),
    );
    expect(c).not.toBe(a);
    expect(selectRunoutView(state(null, null, {}))).toBeNull();
  });
});

describe('the luck line (§7.6)', () => {
  const heroWins = allInPreflop({ hero: 'Kh Kd', bot: '2c 3d' }, 'Ks 7c 2h 9d 4s');
  const heroLoses = allInPreflop({ hero: '2c 3d', bot: 'Kh Kd' }, 'Ks 7c 2h 9d 4s');
  const split = allInPreflop({ hero: '2c 3d', bot: '4c 5d' }, 'Ah Kh Qh Jh Th');

  /** The all-in equities with the hero at `hero` (a fraction). */
  const allInFor = (hand: HandState, hero: number, final = true): KnownEquity => {
    const seats = faceUpSeats(hand);
    return {
      ...known(
        hand,
        seats.map((s) => (s === 0 ? hero : 1 - hero)),
        final,
      ),
      board: [],
    };
  };

  it('uses the §7.6 thresholds', () => {
    expect(UNLUCKY_PCT).toBe(60);
    expect(LUCKY_PCT).toBe(35);
  });

  it('lost with 60% or more: unlucky; the threshold is on the whole percent shown', () => {
    const h = heroLoses.complete;
    expect(h.result?.payouts[0]).toBe(0);
    expect(luckLineOf(h, allInFor(h, 0.81))).toEqual({
      handSeq: h.handSeq,
      kind: 'unlucky',
      pct: 81,
    });
    expect(luckLineOf(h, allInFor(h, 0.6))?.pct).toBe(60);
    expect(luckLineOf(h, allInFor(h, 0.595))?.kind).toBe('unlucky'); // shown as 60%
    expect(luckLineOf(h, allInFor(h, 0.594))).toBeNull(); // 59%
  });

  it('won the pot alone with 35% or less: lucky', () => {
    const h = heroWins.complete;
    expect(h.result?.potWinners[0]).toEqual([0]);
    expect(luckLineOf(h, allInFor(h, 0.18))).toEqual({
      handSeq: h.handSeq,
      kind: 'lucky',
      pct: 18,
    });
    expect(luckLineOf(h, allInFor(h, 0.354))?.pct).toBe(35);
    expect(luckLineOf(h, allInFor(h, 0.355))).toBeNull(); // 36%
    // Winning as the favourite, or losing as the underdog, is no luck.
    expect(luckLineOf(h, allInFor(h, 0.8))).toBeNull();
    expect(luckLineOf(heroLoses.complete, allInFor(heroLoses.complete, 0.2))).toBeNull();
  });

  it('a split pot is neither', () => {
    const h = split.complete;
    expect(h.result?.potWinners[0]).toEqual(expect.arrayContaining([0, 1]));
    expect(luckLineOf(h, allInFor(h, 0.1))).toBeNull();
    expect(luckLineOf(h, allInFor(h, 0.9))).toBeNull();
  });

  it('only with a final number for this hand, at its end, after a run-out the hero was in', () => {
    const h = heroLoses.complete;
    expect(luckLineOf(h, allInFor(h, 0.9, false))).toBeNull(); // still computing
    expect(luckLineOf(h, { ...allInFor(h, 0.9), handSeq: h.handSeq + 1 })).toBeNull();
    expect(luckLineOf(heroLoses.river, allInFor(heroLoses.river, 0.9))).toBeNull(); // not over
    expect(luckLineOf(h, null)).toBeNull();
    const botsOnly = { ...allInFor(h, 0.9), seats: [1, 2], perPlayer: [0.5, 0.5] };
    expect(luckLineOf(h, botsOnly)).toBeNull();
    // A hand won by a fold has no run-out.
    const table = tableWith([10_000, 10_000], { button: 0 });
    const folded = play(deal(table), fold(0));
    expect(luckLineOf(folded, { ...allInFor(h, 0.9), handSeq: folded.handSeq })).toBeNull();
  });

  it('selectLuckLine keeps its object for the same line', () => {
    const h = heroLoses.complete;
    const a = selectLuckLine(state(h, null, { allIn: allInFor(h, 0.7) }));
    const b = selectLuckLine(state({ ...h }, null, { allIn: allInFor(h, 0.7) }));
    expect(a).toEqual({ handSeq: h.handSeq, kind: 'unlucky', pct: 70 });
    expect(b).toBe(a);
  });
});
