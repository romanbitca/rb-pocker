import { describe, expect, it } from 'vitest';
import {
  classByName,
  PUSH_FOLD_KNOWN_MISSES,
  PUSH_FOLD_SPOTS,
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

describe('push/fold acceptance at 10 bb (PLAN §8.4, against published charts)', () => {
  for (const spot of PUSH_FOLD_SPOTS) {
    // A known miss of the model as written (risk R16) stays a test of the plan's own band, marked
    // `it.fails`: it turns red the day the table reaches the band, and the list must then shrink.
    const run = PUSH_FOLD_KNOWN_MISSES.includes(spot.name) ? it.fails : it;
    run(`${spot.name} is ${spot.min} to ${spot.max} percent`, () => {
      const got = pushPct(spot.k, spot.S);
      expect(got, `${spot.name}: ${got}%`).toBeGreaterThanOrEqual(spot.min);
      expect(got, `${spot.name}: ${got}%`).toBeLessThanOrEqual(spot.max);
    });
  }

  it('misses exactly the spots listed as known misses, no others', () => {
    expect(pushFoldMisses(pushPct).map((spot) => spot.name)).toEqual([...PUSH_FOLD_KNOWN_MISSES]);
  });

  it('the acceptance function of the layout agrees', () => {
    expect(pushFoldAcceptance(pushPct)).toHaveLength(PUSH_FOLD_KNOWN_MISSES.length);
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

  it('holds percentages, and with 1 bb every seat shoves every hand', () => {
    for (const value of all()) {
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThanOrEqual(100);
    }
    for (let k = 1; k <= PUSH_MAX_PLAYERS_BEHIND; k++) expect(pushPct(k, 1)).toBe(100);
    for (let S = 1; S <= PUSH_MAX_STACK_BB; S++) {
      expect(callPct(S)).toBeGreaterThan(0);
      expect(callPct(S)).toBeLessThanOrEqual(100);
    }
  });

  it('shoves fewer hands as the stack grows and as more players are behind', () => {
    for (let k = 1; k <= PUSH_MAX_PLAYERS_BEHIND; k++) {
      for (let S = 2; S <= PUSH_MAX_STACK_BB; S++) {
        // The answer is a fictitious-play average (300 rounds): it may wobble by a point.
        expect(pushPct(k, S), `k=${k} S=${S}`).toBeLessThan(pushPct(k, S - 1) + 1.5);
      }
    }
    for (let S = 1; S <= PUSH_MAX_STACK_BB; S++) {
      for (let k = 2; k <= PUSH_MAX_PLAYERS_BEHIND; k++) {
        expect(pushPct(k, S), `k=${k} S=${S}`).toBeLessThan(pushPct(k - 1, S) + 0.5);
      }
    }
    expect(pushPct(1, 15)).toBeLessThan(pushPct(1, 5));
    expect(pushPct(8, 15)).toBeLessThan(pushPct(1, 15));
  });

  it('calls fewer hands against a bigger shove, and 10 bb heads-up calls about a third to two fifths', () => {
    for (let S = 2; S <= PUSH_MAX_STACK_BB; S++) {
      expect(callPct(S), `S=${S}`).toBeLessThan(callPct(S - 1) + 0.5);
    }
    // The published heads-up charts have the big blind calling roughly 35 to 40% at 10 bb.
    expect(callPct(10)).toBeGreaterThan(30);
    expect(callPct(10)).toBeLessThan(45);
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
