/**
 * `localView` (PLAN §19.6, Stage 10 acceptance 11): every mapping from a server view to the `game`
 * slice, over real hands played to their end through `publicHand`, with 2 to 9 seats, empty seats
 * and a viewer who is not dealt in. The expected order is worked out here, not with `seatOrder`.
 */
import { describe, expect, it } from 'vitest';
import { localView } from '../../src/app/mp/localView.ts';
import {
  heroViewOf,
  handEndViewOf,
  potView,
  boardViewOf,
  seatView,
} from '../../src/app/tableViews.ts';
import { NO_SEAT_STATS } from '../../src/app/store.ts';
import { rngFromSeed, randInt, ZERO_SEED } from '../../src/core/rng.ts';
import { startHand } from '../../src/engine/start.ts';
import type { HandState, LogEvent, PublicHand, TableState } from '../../src/engine/types.ts';
import type { SeatInfo, TableView } from '../../src/net/protocol.ts';
import { finishAllIn, SEED } from '../engine/helpers.ts';
import {
  OUT_STACK,
  playedHand,
  remoteTable,
  seatInfo,
  viewOfHand,
  waitingView,
  type SeatKind,
} from './mpFixtures.ts';

/** The real seats that have a player, clockwise from the viewer. */
function orderOf(view: TableView): number[] {
  const n = view.seats.length;
  return Array.from({ length: n }, (_, i) => (view.you + i) % n).filter(
    (real) => view.seats[real] !== null,
  );
}

function mapEvent(e: LogEvent, local: (real: number) => number): LogEvent {
  const copy = { ...e } as LogEvent & { seat?: number; seats?: number[] };
  if (copy.seat !== undefined) copy.seat = local(copy.seat);
  if (copy.seats !== undefined) copy.seats = copy.seats.map(local);
  return copy;
}

function expectMapped(view: TableView): void {
  const order = orderOf(view);
  const at = new Map(order.map((real, i) => [real, i]));
  const local = (real: number): number => {
    const i = at.get(real);
    if (i === undefined) throw new Error(`seat ${real} of the hand is not at the table`);
    return i;
  };
  const game = localView(view, 'You');
  const p = view.hand as PublicHand;
  const h = game.hand as HandState;

  expect(h.seats).toHaveLength(order.length);
  order.forEach((real, i) => {
    const seat = p.seats[real] as PublicHand['seats'][number];
    const info = view.seats[real] as SeatInfo;
    expect(h.seats[i]).toEqual({
      ...seat,
      stack: seat.dealtIn ? seat.stack : info.stack,
      lastActedAtBet: null,
    });
    expect(h.startStacks[i]).toBe(p.startStacks[real]);
  });
  expect(h.button).toBe(local(p.button));
  expect(h.sbSeat).toBe(local(p.sbSeat));
  expect(h.bbSeat).toBe(local(p.bbSeat));
  expect(h.toAct).toBe(p.toAct === null ? null : local(p.toAct));
  expect(h.revealed).toEqual(p.revealed.map(local));
  expect(h.log).toEqual(p.log.map((e) => mapEvent(e, local)));
  expect(h.startTotal).toBe(p.startStacks.reduce((a, b) => a + b, 0));

  if (p.result === null) {
    expect(h.result).toBeNull();
  } else {
    const r = p.result;
    expect(h.result).toEqual({
      endedBy: r.endedBy,
      pots: r.pots.map((pot) => ({ amount: pot.amount, eligible: pot.eligible.map(local) })),
      potWinners: r.potWinners.map((w) => w.map(local)),
      payouts: order.map((real) => r.payouts[real]),
      net: order.map((real) => r.net[real]),
      shown: r.shown.map((x) => ({ ...x, seat: local(x.seat) })),
    });
  }

  // The fields the type needs and the server never sends.
  expect(h).toMatchObject({
    schema: 1,
    engineVersion: '',
    seed: ZERO_SEED,
    deck: [],
    deckPos: 0,
    lastAggressor: null,
    preflopAggressor: null,
    undoneDecisions: [],
  });

  // Chips: nothing is lost by dropping the empty seats.
  const bets = (seats: readonly { totalBet: number }[]): number =>
    seats.reduce((a, s) => a + s.totalBet, 0);
  expect(bets(h.seats)).toBe(bets(p.seats));

  // The Table's own view builders run on this hand.
  const table = game.table as TableState;
  expect(() => potView(h)).not.toThrow();
  expect(() => boardViewOf(h)).not.toThrow();
  expect(() => heroViewOf(h, game.legal)).not.toThrow();
  expect(() => handEndViewOf(h, table)).not.toThrow();
  for (let seat = 1; seat < h.seats.length; seat++) {
    expect(() => seatView(h, table, seat)).not.toThrow();
  }
}

/** Seats where at least two are dealt in, drawn from `seed`. */
function drawKinds(count: number, seed: number): SeatKind[] {
  const rng = rngFromSeed(`${seed.toString(16).padStart(8, '0')}`.repeat(4));
  for (;;) {
    const kinds = Array.from({ length: count }, (): SeatKind => {
      const pick = randInt(rng, 5);
      return pick < 3 ? 'in' : pick === 3 ? 'out' : 'empty';
    });
    if (kinds.filter((k) => k === 'in').length >= 2) return kinds;
  }
}

describe('every mapping, over whole hands', () => {
  it.each([2, 3, 4, 5, 6, 7, 8, 9])(
    '%i seats, every viewer, empty seats and seats not dealt in',
    (count) => {
      for (let round = 0; round < 3; round++) {
        const kinds = round === 0 ? new Array<SeatKind>(count).fill('in') : drawKinds(count, round);
        const states = playedHand(remoteTable(kinds));
        expect(states[states.length - 1]?.phase).toBe('complete');
        kinds.forEach((kind, you) => {
          if (kind === 'empty') return;
          for (const h of states) expectMapped(viewOfHand(kinds, h, you));
        });
      }
    },
    30_000,
  );
});

describe('the order', () => {
  const kinds: SeatKind[] = ['in', 'empty', 'in', 'empty', 'in', 'in'];
  const hand = startHand(remoteTable(kinds), SEED);

  it('the viewer is local seat 0, the others follow clockwise, empty seats do not exist', () => {
    const game = localView(viewOfHand(kinds, hand, 4), 'You');
    expect(game.table?.slots.map((s) => s.playerId)).toEqual(['s4', 's5', 's0', 's2']);
    expect(game.hand?.seats).toHaveLength(4);
  });

  it('the viewer at the last seat wraps round', () => {
    const game = localView(viewOfHand(kinds, hand, 5), 'You');
    expect(game.table?.slots.map((s) => s.playerId)).toEqual(['s5', 's0', 's2', 's4']);
  });
});

describe('the table', () => {
  const kinds: SeatKind[] = ['in', 'empty', 'in', 'out'];
  const hand = startHand(remoteTable(kinds), SEED);
  const view = viewOfHand(kinds, hand, 2);
  const table = localView(view, 'You').table as TableState;

  it('config: the settings, with one seat per player', () => {
    expect(table.config).toEqual({
      seatCount: 3,
      sb: view.settings.sb,
      bb: view.settings.bb,
      startingStack: view.settings.stack,
      botLevel: 'easy',
      seatLevels: [null, null, null],
    });
  });

  it('slots: the viewer is the hero with the given name, the others are remote', () => {
    expect(table.slots.map((s) => s.kind)).toEqual(['hero', 'remote', 'remote']);
    expect(table.slots.map((s) => s.name)).toEqual(['You', 'P3', 'P0']);
    expect(table.slots.map((s) => s.personality)).toEqual([null, null, null]);
    expect(table.slots.map((s) => s.playerId)).toEqual(['s2', 's3', 's0']);
    expect(table.slots.map((s) => s.stack)).toEqual([
      (view.seats[2] as SeatInfo).stack,
      OUT_STACK,
      (view.seats[0] as SeatInfo).stack,
    ]);
  });

  it('handsDealt keeps this hand`s number on the banner', () => {
    const later = viewOfHand(kinds, { ...hand, handSeq: 12 }, 2, { handsPlayed: 12 });
    expect(localView(later, 'You').table?.handsDealt).toBe(11);
  });

  it('with no hand, handsDealt is the hands played and the hand is null', () => {
    const game = localView(waitingView({ handsPlayed: 3 }), 'You');
    expect(game.hand).toBeNull();
    expect(game.table?.handsDealt).toBe(3);
    expect(game.table?.button).toBe(-1);
  });
});

describe('a seat not dealt in', () => {
  const kinds: SeatKind[] = ['in', 'out', 'in'];
  const hand = startHand(remoteTable(kinds), SEED);

  it('takes its chips from the seat info: the engine`s slot says 0', () => {
    expect(hand.seats[1]?.stack).toBe(0);
    const game = localView(viewOfHand(kinds, hand, 0), 'You');
    const local = game.table?.slots.findIndex((s) => s.playerId === 's1') as number;
    expect(game.hand?.seats[local]?.stack).toBe(OUT_STACK);
  });

  it('a viewer who is not dealt in has no cards and sees backs on the live seats', () => {
    const game = localView(viewOfHand(kinds, hand, 1), 'You');
    const h = game.hand as HandState;
    expect(h.seats[0]).toMatchObject({ dealtIn: false, hole: null, stack: OUT_STACK });
    expect(game.legal).toBeNull();
    expect(heroViewOf(h, game.legal)).toBeNull();
    const table = game.table as TableState;
    expect(seatView(h, table, 1).cards).toEqual({ kind: 'hidden' });
    expect(seatView(h, table, 2).cards).toEqual({ kind: 'hidden' });
  });
});

describe('cards on the pods', () => {
  const kinds: SeatKind[] = ['in', 'in', 'in'];
  const table = remoteTable(kinds);
  const states = playedHand(table);

  it('a live seat with unknown cards shows backs; a folded one shows none', () => {
    const folded = states.find((h) => h.seats.some((s) => s.folded) && h.phase === 'betting');
    expect(folded).toBeDefined();
    const h = folded as HandState;
    const you = h.seats.findIndex((s) => !s.folded);
    const game = localView(viewOfHand(kinds, h, you), 'You');
    const local = game.hand as HandState;
    for (let seat = 1; seat < local.seats.length; seat++) {
      const pod = seatView(local, game.table as TableState, seat);
      expect(pod.cards.kind).toBe(local.seats[seat]?.folded === true ? 'none' : 'hidden');
    }
  });

  it('a revealed seat shows its cards', () => {
    const shown = finishAllIn(startHand(remoteTable(['in', 'in']), SEED));
    expect(shown.revealed.length).toBeGreaterThan(0);
    const game = localView(viewOfHand(['in', 'in'], shown, 0), 'You');
    const local = game.hand as HandState;
    expect(local.revealed).toContain(1);
    expect(seatView(local, game.table as TableState, 1).cards.kind).toBe('revealed');
  });
});

describe('legal, mode and the rest', () => {
  const kinds: SeatKind[] = ['in', 'in', 'in'];
  const states = playedHand(remoteTable(kinds));
  const first = states[0] as HandState;
  const toAct = first.toAct as number;

  it('legal is the view`s, with the viewer`s local seat', () => {
    const view = viewOfHand(kinds, first, toAct);
    expect(view.legal?.seat).toBe(toAct);
    expect(toAct).not.toBe(0); // or the mapping below would prove nothing
    expect(localView(view, 'You').legal).toEqual({ ...view.legal, seat: 0 });
  });

  it('modes: heroTurn, botTurn, advancing, handEnd, idle', () => {
    const betting = viewOfHand(kinds, first, toAct);
    expect(localView(betting, 'You').mode).toBe('heroTurn');
    expect(localView(viewOfHand(kinds, first, (toAct + 1) % 3), 'You').mode).toBe('botTurn');
    const roundComplete = states.find((h) => h.phase === 'roundComplete') as HandState;
    expect(roundComplete).toBeDefined();
    expect(localView(viewOfHand(kinds, roundComplete, 0), 'You').mode).toBe('advancing');
    const last = states[states.length - 1] as HandState;
    expect(localView(viewOfHand(kinds, last, 0), 'You').mode).toBe('handEnd');
    expect(localView(waitingView(), 'You').mode).toBe('idle');
  });

  it('a showdown phase is advancing', () => {
    const view = viewOfHand(kinds, { ...first, phase: 'showdown', toAct: null }, 0);
    expect(localView(view, 'You').mode).toBe('advancing');
  });

  it('heroBust comes from the viewer`s own seat', () => {
    const seats = [seatInfo('A', { status: 'busted' }), seatInfo('B'), null];
    expect(localView(waitingView({ seats, you: 0 }), 'You').heroBust).toBe(true);
    expect(localView(waitingView({ seats, you: 1 }), 'You').heroBust).toBe(false);
  });

  it('no learning aids: Exam, nothing to undo, no summary, no feedback', () => {
    const game = localView(viewOfHand(kinds, first, toAct), 'You');
    expect(game).toMatchObject({
      next: null,
      canUndo: false,
      feedback: null,
      decisions: [],
      coachLevel: 'exam',
      summary: null,
      skipping: false,
    });
    expect(game.seatStats).toBe(NO_SEAT_STATS);
  });

  it('is pure: the view is not changed', () => {
    const view = viewOfHand(kinds, states[states.length - 1] as HandState, 1);
    const before = JSON.stringify(view);
    localView(view, 'You');
    expect(JSON.stringify(view)).toBe(before);
  });
});
