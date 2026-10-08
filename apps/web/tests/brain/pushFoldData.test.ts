import { describe, expect, it } from 'vitest';
import {
  classByName,
  PUSH_FOLD_SPOTS,
  PUSH_FOLD_TOLERANCE_POINTS,
  pushFoldAcceptance,
  pushFoldMisses,
} from '../../src/data/rangesLayout.ts';
import {
  callPct,
  pushFoldPlayers,
  pushFoldStack,
  pushPct,
  PUSH_MAX_PLAYERS_BEHIND,
  PUSH_MAX_STACK_BB,
} from '../../src/brain/pushFoldData.ts';
import { rankPctOfClass } from '../../src/brain/rangesData.ts';

/**
 * The published no-ante Nash push/fold chart for 9-handed play, 5 to 15 bb (Jonathan Little,
 * PokerCoaching.com, "Push Fold Charts No Ante", https://pokercoaching.com/push-fold-charts/, read
 * on 1 Oct 2026): percent of hands shoved when folded to, by players behind k = 1 (SB) .. 8 (UTG).
 * The §8.4 acceptance spots are five of these cells (PLAN §8.4, risk R16).
 */
const PUBLISHED_NO_ANTE: Readonly<Record<number, readonly number[]>> = {
  5: [71.3, 41.8, 33.0, 29.4, 24.0, 20.7, 18.1, 15.7],
  6: [68.6, 38.5, 32.7, 27.0, 22.2, 18.9, 16.0, 14.3],
  7: [66.5, 37.6, 31.2, 24.6, 20.1, 17.2, 14.6, 12.7],
  8: [61.7, 34.5, 29.1, 22.2, 18.9, 15.4, 13.4, 11.5],
  9: [59.9, 34.2, 27.6, 20.7, 17.2, 14.6, 11.8, 10.9],
  10: [58.4, 33.0, 25.8, 20.1, 16.3, 13.4, 10.9, 9.4],
  11: [54.4, 32.1, 23.1, 18.7, 14.6, 12.1, 10.9, 9.0],
  12: [53.2, 32.1, 23.1, 16.6, 13.7, 10.9, 9.4, 7.5],
  13: [51.7, 30.9, 21.3, 16.0, 12.4, 10.4, 9.0, 7.5],
  14: [48.1, 28.8, 20.1, 16.0, 12.1, 9.4, 7.8, 7.2],
  15: [45.7, 28.2, 18.9, 13.7, 10.9, 9.0, 7.5, 6.8],
};

/**
 * HoldemResources' heads-up Nash chart without antes (https://www.holdemresources.net/hune): the
 * share of hands the small blind pushes and the big blind calls, counted from its per-hand stack
 * limits (a hand counts at S when its limit is at least S).
 */
const HOLDEM_RESOURCES_HEADS_UP: readonly { S: number; push: number; call: number }[] = [
  { S: 8, push: 61.7, call: 45.4 },
  { S: 10, push: 57.8, call: 37.3 },
  { S: 12, push: 52.9, call: 33.0 },
  { S: 15, push: 45.7, call: 28.8 },
];

describe('push/fold acceptance (PLAN §8.4: the published no-ante chart ± 3 points)', () => {
  for (const spot of PUSH_FOLD_SPOTS) {
    it(`${spot.name} is ${spot.min.toFixed(1)} to ${spot.max.toFixed(1)} percent (published ${spot.published})`, () => {
      const got = pushPct(spot.k, spot.S);
      expect(got, `${spot.name}: ${got}%`).toBeGreaterThanOrEqual(spot.min);
      expect(got, `${spot.name}: ${got}%`).toBeLessThanOrEqual(spot.max);
    });
  }

  it('the spots are cells of the published chart, and the acceptance of the layout passes', () => {
    for (const spot of PUSH_FOLD_SPOTS) {
      expect(PUBLISHED_NO_ANTE[spot.S]?.[spot.k - 1]).toBe(spot.published);
      expect(spot.max - spot.min).toBeCloseTo(2 * PUSH_FOLD_TOLERANCE_POINTS, 9);
    }
    expect(pushFoldMisses(pushPct)).toEqual([]);
    expect(pushFoldAcceptance(pushPct)).toEqual([]);
  });

  it('the whole table from 5 to 15 bb stays within 2.5 points of the chart, 1 on average', () => {
    let sum = 0;
    let n = 0;
    for (let S = 5; S <= 15; S++) {
      for (let k = 1; k <= PUSH_MAX_PLAYERS_BEHIND; k++) {
        const published = PUBLISHED_NO_ANTE[S]?.[k - 1] as number;
        const diff = Math.abs(pushPct(k, S) - published);
        expect(diff, `k=${k} S=${S}: ${pushPct(k, S)}% against ${published}%`).toBeLessThan(2.5);
        sum += diff;
        n++;
      }
    }
    expect(sum / n).toBeLessThan(1);
  });

  it('heads-up, the small blind and the big blind are within 1 point of HoldemResources', () => {
    for (const { S, push, call } of HOLDEM_RESOURCES_HEADS_UP) {
      expect(Math.abs(pushPct(1, S) - push), `push at ${S} bb: ${pushPct(1, S)}%`).toBeLessThan(1);
      expect(Math.abs(callPct(S) - call), `call at ${S} bb: ${callPct(S)}%`).toBeLessThan(1);
    }
  });
});

describe('the table', () => {
  const all = (): number[] => {
    const values: number[] = [];
    for (let k = 1; k <= PUSH_MAX_PLAYERS_BEHIND; k++) {
      for (let S = 1; S <= PUSH_MAX_STACK_BB; S++) values.push(pushPct(k, S));
    }
    return values;
  };

  it('holds percentages, and with 1 bb the small blind shoves every hand (the big blind calls for free)', () => {
    for (const value of all()) {
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThanOrEqual(100);
    }
    expect(pushPct(1, 1)).toBe(100);
    for (let S = 1; S <= PUSH_MAX_STACK_BB; S++) {
      expect(callPct(S)).toBeGreaterThan(0);
      expect(callPct(S)).toBeLessThanOrEqual(100);
    }
  });

  it('shoves fewer hands as the stack grows, and from 3 bb as more players are behind', () => {
    for (let k = 1; k <= PUSH_MAX_PLAYERS_BEHIND; k++) {
      for (let S = 2; S <= PUSH_MAX_STACK_BB; S++) {
        // The answer is a fictitious-play average: it may wobble by a point.
        expect(pushPct(k, S), `k=${k} S=${S}`).toBeLessThan(pushPct(k, S - 1) + 1.5);
      }
    }
    // With 1 or 2 bb the blinds call for (almost) nothing, so the button, whose callers are both
    // blinds, shoves less than a seat with a player who has posted nothing behind it; the
    // published chart is not monotone there either (1 bb: button 44.3%, UTG 46.9%).
    for (let S = 3; S <= PUSH_MAX_STACK_BB; S++) {
      for (let k = 2; k <= PUSH_MAX_PLAYERS_BEHIND; k++) {
        expect(pushPct(k, S), `k=${k} S=${S}`).toBeLessThan(pushPct(k - 1, S) + 0.5);
      }
    }
    expect(pushPct(1, 15)).toBeLessThan(pushPct(1, 5));
    expect(pushPct(8, 15)).toBeLessThan(pushPct(1, 15));
  });

  it('calls fewer hands against a bigger shove', () => {
    for (let S = 2; S <= PUSH_MAX_STACK_BB; S++) {
      expect(callPct(S), `S=${S}`).toBeLessThan(callPct(S - 1) + 0.5);
    }
  });
});

describe('the golden spots of Appendix E that read this table', () => {
  const rank = (name: string): number => rankPctOfClass(classByName(name));

  it('E7: on the button (k = 2) with 10 bb, A5o goes all-in', () => {
    expect(rank('A5o')).toBeLessThanOrEqual(pushPct(2, 10));
  });

  it('E18: 9-handed first to act (k = 8) with 8 bb, 94o folds', () => {
    expect(rank('94o')).toBeGreaterThan(pushPct(8, 8));
  });
});

describe('the accessors', () => {
  it('round the stack and clamp it to 1..15, clamp the players behind to 1..8 (§8.4)', () => {
    expect(pushFoldStack(0.2)).toBe(1);
    expect(pushFoldStack(9.49)).toBe(9);
    expect(pushFoldStack(9.5)).toBe(10);
    expect(pushFoldStack(40)).toBe(15);
    expect(pushFoldPlayers(0)).toBe(1);
    expect(pushFoldPlayers(3)).toBe(3);
    expect(pushFoldPlayers(12)).toBe(8);
    expect(pushPct(2, 9.6)).toBe(pushPct(2, 10));
    expect(pushPct(99, 99)).toBe(pushPct(8, 15));
    expect(pushPct(-3, -3)).toBe(pushPct(1, 1));
    expect(callPct(99)).toBe(callPct(15));
  });

  it('refuses a number that is not one', () => {
    expect(() => pushPct(Number.NaN, 10)).toThrow(RangeError);
    expect(() => pushPct(2, Number.NaN)).toThrow(RangeError);
    expect(() => callPct(Number.NaN)).toThrow(RangeError);
  });
});
