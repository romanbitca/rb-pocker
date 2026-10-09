/**
 * PLAN §9.5: per-seat statistics from real hand logs (the engine plays scripted hands), the
 * shrunk estimates and `loosenessEstimate`.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { rngFromSeed } from '../../src/core/rng.ts';
import {
  emptySeatStats,
  loosenessEstimate,
  observedSeatModel,
  seatModel,
  seatPrior,
  shrink,
  updateSeatStats,
} from '../../src/brain/opponentStats.ts';
import { PERSONALITIES } from '../../src/brain/tunables.ts';
import { step } from '../../src/engine/step.ts';
import type { HandState, Observation, SeatStats } from '../../src/engine/types.ts';
import { FC_SEED, deal, tableWith } from '../engine/helpers.ts';
import {
  ADVANCE,
  advanceWhileRoundComplete,
  bet,
  call,
  check,
  fold,
  handArb,
  play,
  raise,
  randomInput,
} from '../engine/play.ts';

/** Three seats, 50/100, 10,000 each; seat 0 is the button, 1 the SB, 2 the BB. */
const threeHanded = (): HandState => deal(tableWith([10000, 10000, 10000], { button: 0 }));

/** Plays to the end: every street's `advance`, the showdown and the settlement. */
function finish(h: HandState): HandState {
  let s = h;
  while (s.phase !== 'complete' && s.phase !== 'betting') s = play(s, ADVANCE);
  return s;
}

const statsAfter = (h: HandState, seat: number, before: SeatStats | null = null): SeatStats =>
  updateSeatStats(before, h.log, seat);

describe('updateSeatStats (§9.5)', () => {
  it('open, 3-bet, fold to the 3-bet: VPIP, PFR, 3-bet and fold-to-3-bet counters', () => {
    const h = finish(play(threeHanded(), raise(0, 300), raise(1, 900), fold(2), fold(0)));
    expect(h.phase).toBe('complete');
    const opener = statsAfter(h, 0);
    expect(opener).toMatchObject({
      hands: 1,
      vpip: [1, 1],
      pfr: [1, 1],
      threeBet: [0, 0],
      foldTo3bet: [1, 1],
      wtsd: [0, 0],
    });
    const threeBettor = statsAfter(h, 1);
    expect(threeBettor).toMatchObject({ vpip: [1, 1], pfr: [1, 1], threeBet: [1, 1] });
    expect(threeBettor.foldTo3bet).toEqual([0, 0]);
    // The big blind faced two raises: a 4-bet spot, not a 3-bet opportunity.
    expect(statsAfter(h, 2)).toMatchObject({ vpip: [0, 1], pfr: [0, 1], threeBet: [0, 0] });
  });

  it('a limper facing one raise has a 3-bet opportunity; calling is not a 3-bet', () => {
    const h = play(threeHanded(), call(0), raise(1, 400), fold(2), call(0));
    const limper = statsAfter(h, 0);
    expect(limper.threeBet).toEqual([0, 1]);
    expect(limper.vpip).toEqual([1, 1]);
    expect(limper.pfr).toEqual([0, 1]);
    expect(statsAfter(h, 1).threeBet).toEqual([0, 0]); // the SB made the first raise
  });

  it('c-bet and fold to c-bet on the flop; AF counts postflop bets, raises and calls only', () => {
    let h = play(threeHanded(), raise(0, 300), fold(1), call(2));
    h = advanceWhileRoundComplete(h);
    expect(h.street).toBe('flop');
    h = finish(play(h, check(2), bet(0, 200), fold(2)));
    const aggressor = statsAfter(h, 0);
    expect(aggressor.cbet).toEqual([1, 1]);
    expect(aggressor.aggActions).toBe(1); // the preflop raise does not count
    expect(aggressor.passiveActions).toBe(0);
    const defender = statsAfter(h, 2);
    expect(defender.foldToCbet).toEqual([1, 1]);
    expect(defender.passiveActions).toBe(0); // the preflop call does not count
    expect(defender.wtsd).toEqual([0, 1]);
    expect(statsAfter(h, 1)).toMatchObject({ vpip: [0, 1], wtsd: [0, 0] });
  });

  it('checked-through hand to showdown: c-bet chance not taken, WTSD for both players', () => {
    let h = play(threeHanded(), raise(0, 300), fold(1), call(2));
    for (let street = 0; street < 3; street++) {
      h = advanceWhileRoundComplete(h);
      h = play(h, check(2), check(0));
    }
    h = finish(h);
    expect(h.result?.endedBy).toBe('showdown');
    expect(statsAfter(h, 0)).toMatchObject({ cbet: [0, 1], wtsd: [1, 1] });
    expect(statsAfter(h, 2)).toMatchObject({ foldToCbet: [0, 0], wtsd: [1, 1] });
  });

  it('raising a c-bet is a fold-to-c-bet chance not taken; a donk bet removes the c-bet chance', () => {
    let h = play(threeHanded(), call(0), raise(1, 300), fold(2), call(0));
    h = advanceWhileRoundComplete(h);
    // Seat 1 (SB) made the only raise and acts first: it bets = a c-bet; seat 0 raises.
    h = play(h, bet(1, 200), raise(0, 800), call(1));
    expect(statsAfter(h, 1).cbet).toEqual([1, 1]);
    expect(statsAfter(h, 0).foldToCbet).toEqual([0, 1]); // faced the c-bet, did not fold
    expect(statsAfter(h, 0)).toMatchObject({ aggActions: 1, passiveActions: 0 });
    expect(statsAfter(h, 1)).toMatchObject({ aggActions: 1, passiveActions: 1 });

    let d = play(threeHanded(), raise(0, 300), fold(1), call(2));
    d = advanceWhileRoundComplete(d);
    d = play(d, bet(2, 200), call(0)); // the BB leads (a donk bet)
    expect(statsAfter(d, 0).cbet).toEqual([0, 0]);
    expect(statsAfter(d, 2).foldToCbet).toEqual([0, 0]);
  });

  it('a walk gives the big blind a hand but no VPIP chance; unseated seats are unchanged', () => {
    const h = finish(play(threeHanded(), fold(0), fold(1)));
    expect(statsAfter(h, 2)).toMatchObject({ hands: 1, vpip: [0, 0], pfr: [0, 0] });
    expect(statsAfter(h, 1)).toMatchObject({ hands: 1, vpip: [0, 1] });

    const empty = deal(tableWith([10000, 0, 10000, 10000], { button: 0 }));
    const before: SeatStats = { ...emptySeatStats(), hands: 7, vpip: [2, 7] };
    const after = updateSeatStats(before, empty.log, 1);
    expect(after).toEqual(before);
    expect(after).not.toBe(before);
    expect(after.vpip).not.toBe(before.vpip);
  });

  it('accumulates over hands, never mutates its input, and treats null as empty', () => {
    const h = finish(play(threeHanded(), raise(0, 300), raise(1, 900), fold(2), fold(0)));
    const first = updateSeatStats(null, h.log, 1);
    const frozen = Object.freeze({ ...first, vpip: Object.freeze([...first.vpip]) }) as SeatStats;
    const second = updateSeatStats(frozen, h.log, 1);
    expect(second).toMatchObject({ hands: 2, vpip: [2, 2], pfr: [2, 2], threeBet: [2, 2] });
    expect(updateSeatStats(emptySeatStats(), h.log, 1)).toEqual(first);
  });

  it('property: x ≤ n for every counter, and the counters only grow (random hands)', () => {
    fc.assert(
      fc.property(handArb, ({ h, policySeed }) => {
        const rng = rngFromSeed(policySeed);
        let s = h;
        for (let i = 0; i < 400 && s.phase !== 'complete'; i++) s = step(s, randomInput(s, rng));
        for (let seat = 0; seat < s.seats.length; seat++) {
          const one = updateSeatStats(null, s.log, seat);
          const two = updateSeatStats(one, s.log, seat);
          for (const key of [
            'vpip',
            'pfr',
            'threeBet',
            'foldTo3bet',
            'cbet',
            'foldToCbet',
            'wtsd',
          ] as const) {
            const [x, n] = one[key];
            expect(x).toBeLessThanOrEqual(n);
            expect(n).toBeLessThanOrEqual(1);
            expect(two[key]).toEqual([2 * x, 2 * n]);
          }
          expect(one.hands).toBe(s.seats[seat]?.dealtIn === true ? 1 : 0);
        }
      }),
      { seed: FC_SEED, numRuns: 200 },
    );
  });
});

describe('estimates (§9.5)', () => {
  it('shrinks toward the prior with k = 20 opportunities', () => {
    expect(shrink(0, 0, 0.3)).toBeCloseTo(0.3, 12);
    expect(shrink(10, 20, 0.3)).toBeCloseTo((10 + 20 * 0.3) / 40, 12);
    expect(shrink(1000, 1000, 0.3)).toBeCloseTo((1000 + 6) / 1020, 12);
  });

  it('prior: the visible personality, else the average of the level list', () => {
    expect(seatPrior('rock', 'easy')).toEqual({ vpip: 0.12, pfr: 0.09, af: 1.5 });
    // Hard: TAG, LAG, Rock, TAG, LAG, Station, TAG, Rock.
    const hard = seatPrior(null, 'hard');
    expect(hard.vpip).toBeCloseTo((3 * 0.22 + 2 * 0.32 + 2 * 0.12 + 0.45) / 8, 12);
    expect(hard.af).toBeCloseTo((3 * 2.5 + 2 * 3.5 + 2 * 1.5 + 0.7) / 8, 12);
    expect(hard.pfr).toBeCloseTo((3 * 0.18 + 2 * 0.26 + 2 * 0.09 + 0.07) / 8, 12);
  });

  it('with no hands seen the model is exactly the prior; AF shrinks in frequency space', () => {
    const prior = seatPrior('station', 'medium');
    const m = seatModel(null, prior);
    expect(m.vpip).toBeCloseTo(0.45, 12);
    expect(m.pfr).toBeCloseTo(0.07, 12);
    expect(m.af).toBeCloseTo(0.7, 12);
    expect(m.vpipN).toBe(0);
    expect(m.afN).toBe(0);
    // 30 bets/raises and 10 calls against the Station's AF 0.7 (frequency 0.7/1.7).
    const seen = { ...emptySeatStats(), aggActions: 30, passiveActions: 10 };
    const f = (30 + 20 * (0.7 / 1.7)) / 60;
    expect(seatModel(seen, prior).af).toBeCloseTo(f / (1 - f), 12);
  });

  it('looseness = clamp(estVPIP / 0.22, 0.5, 3.0): the coach’s read of a seat, from its VPIP', () => {
    expect(loosenessEstimate(0.22)).toBeCloseTo(1, 12);
    expect(loosenessEstimate(0.05)).toBe(0.5);
    expect(loosenessEstimate(0.9)).toBe(3);
    // The TAG's target reads as the coach's own ranges. The other §9.1 looseness values are the
    // bots' own threshold factors, calibrated by self-play (§9.7, chunk 5.11), not VPIP / 0.22:
    // a Station needs 3.4 for its 45% because its calls facing a raise are bound by EV(call) > 0.
    expect(loosenessEstimate(PERSONALITIES.tag.vpip)).toBeCloseTo(PERSONALITIES.tag.looseness, 12);
  });

  it('a loose seat widens with evidence: 60 of 100 hands played', () => {
    const stats = { ...emptySeatStats(), hands: 100, vpip: [60, 100] as [number, number] };
    const m = seatModel(stats, seatPrior('tag', 'medium'));
    expect(m.vpip).toBeCloseTo((60 + 20 * 0.22) / 120, 12);
    expect(m.looseness).toBeCloseTo(m.vpip / 0.22, 12);
  });

  it('observedSeatModel reads the seat’s stats, label and level from the observation', () => {
    const obs = {
      seatStats: [null, { ...emptySeatStats(), vpip: [10, 10] as [number, number] }],
      visiblePersonality: [null, 'rock'],
      seatLevels: ['easy', 'easy'],
    } as unknown as Observation;
    const m = observedSeatModel(obs, 1);
    expect(m.vpip).toBeCloseTo((10 + 20 * 0.12) / 30, 12);
    const unknown = observedSeatModel(obs, 0);
    expect(unknown.vpip).toBeCloseTo(seatPrior(null, 'easy').vpip, 12);
  });
});
