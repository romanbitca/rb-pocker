/**
 * The bot level of each seat (PLAN §9.2, §9.3, §10; chunk 7.2): which level decides a seat, which
 * levels show a personality, and which levels the next hand is dealt at. One set of functions
 * serves the pods, the bot card, the brain's observation and the controller, so these rules are
 * pinned here once. (The coach levels as data are `levels.test.ts`.)
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { levelsOf, nextLevels, sameSeatLevels } from '../../src/app/botLevels.ts';
import { labelVisible, seatLevelOf } from '../../src/app/tableViews.ts';
import { BOT_LEVELS, type BotLevel, type TableState } from '../../src/engine/types.ts';
import { defaultSettings } from '../../src/persist/schema.ts';
import { tableWith } from '../engine/helpers.ts';

const levelArb = fc.constantFrom<BotLevel | null>(null, ...BOT_LEVELS);

describe('seatLevelOf and levelsOf: a seat’s own level, else the table’s (§9.3)', () => {
  const table = tableWith([1000, 1000, 1000, 1000], {
    botLevel: 'medium',
    seatLevels: [null, 'expert', null, 'easy'],
  });

  it('reads the override of a seat and the table level of the others', () => {
    expect([1, 2, 3].map((seat) => seatLevelOf(table, seat))).toEqual(['expert', 'medium', 'easy']);
  });

  it('levelsOf lists every seat; the hero’s entry is the table level and is never used', () => {
    expect(levelsOf(table)).toEqual(['medium', 'expert', 'medium', 'easy']);
  });

  it('agrees with seatLevelOf for any table', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...BOT_LEVELS),
        fc.array(levelArb, { minLength: 3, maxLength: 3 }),
        (botLevel, own) => {
          const t = tableWith([1000, 1000, 1000, 1000], {
            botLevel,
            seatLevels: [null, ...own],
          });
          expect(levelsOf(t)).toEqual([0, 1, 2, 3].map((seat) => seatLevelOf(t, seat)));
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('labelVisible: Easy and Medium show the personality, Hard and Expert do not (§9.2)', () => {
  it.each<[BotLevel, boolean]>([
    ['easy', true],
    ['medium', true],
    ['hard', false],
    ['expert', false],
  ])('%s: %s', (level, shown) => {
    expect(labelVisible(level)).toBe(shown);
  });
});

describe('nextLevels: the levels the next hand is dealt at (§9.3, §10)', () => {
  const table = tableWith([1000, 1000, 1000, 1000], {
    botLevel: 'easy',
    seatLevels: [null, 'hard', null, null],
  });
  const settings = (patch: Partial<ReturnType<typeof defaultSettings>>) => ({
    ...defaultSettings(),
    ...patch,
  });

  it('takes the settings’ table level and per-seat overrides when they are for this table', () => {
    const next = nextLevels(
      settings({ botLevel: 'medium', players: 4, seatLevels: [null, null, 'expert', 'easy'] }),
      table,
    );
    expect(next).toEqual({ botLevel: 'medium', seatLevels: [null, null, 'expert', 'easy'] });
  });

  it('is the table’s own overrides when the settings were for another number of seats', () => {
    const next = nextLevels(
      settings({
        botLevel: 'medium',
        players: 6,
        seatLevels: [null, 'expert', 'expert', null, null, null],
      }),
      table,
    );
    // Only the table level comes from the settings: its overrides belong to other seats.
    expect(next).toEqual({ botLevel: 'medium', seatLevels: [null, 'hard', null, null] });
  });

  it('keeps the hero at null whatever the settings hold, and is a fresh list', () => {
    const own: (BotLevel | null)[] = ['expert', 'hard', null, null];
    const next = nextLevels(settings({ players: 4, seatLevels: own }), table);
    expect(next.seatLevels[0]).toBeNull();
    expect(next.seatLevels).not.toBe(own);
    next.seatLevels[1] = 'easy';
    expect(own[1]).toBe('hard');
    const fromTable = nextLevels(settings({ players: 9 }), table);
    expect(fromTable.seatLevels).not.toBe(table.config.seatLevels);
  });

  it('always has one entry per seat of the table, whatever the settings hold', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 9 }),
        fc.array(levelArb, { minLength: 0, maxLength: 12 }),
        fc.constantFrom(...BOT_LEVELS),
        (players, own, botLevel) => {
          const next = nextLevels(
            { botLevel, players, seatLevels: own } as never,
            table as TableState,
          );
          expect(next.seatLevels).toHaveLength(4);
          expect(next.seatLevels[0]).toBeNull();
          expect(next.botLevel).toBe(botLevel);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('sameSeatLevels', () => {
  it('is true for equal lists and false for any difference or length', () => {
    expect(sameSeatLevels([null, 'easy'], [null, 'easy'])).toBe(true);
    expect(sameSeatLevels([null, 'easy'], [null, 'hard'])).toBe(false);
    expect(sameSeatLevels([null, null], [null, 'easy'])).toBe(false);
    expect(sameSeatLevels([null, null], [null, null, null])).toBe(false);
    expect(sameSeatLevels([], [])).toBe(true);
  });
});
