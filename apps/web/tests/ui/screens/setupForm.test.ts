// Setup's form rules (PLAN §12.2, §3.2), with the engine's createTable as the oracle.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { seedWords } from '../../../src/core/rng.ts';
import { createTable, initialSlots } from '../../../src/engine/table.ts';
import { BOT_LEVELS, COACH_LEVELS, type TableConfig } from '../../../src/engine/types.ts';
import {
  amountFor,
  BIG_BLIND_PRESETS,
  bigBlindValue,
  BOT_LEVEL_ORDER,
  checkSetup,
  checkStakes,
  COACH_LEVEL_ORDER,
  depthBand,
  digitsOnly,
  initialForm,
  ownLevelCount,
  parseAmount,
  resizeSeatLevels,
  roundUpToEven,
  STACK_PRESETS,
  stackValue,
  stepPlayers,
  tableConfig,
  type AvailableLevels,
  type SetupForm,
  type SetupValues,
} from '../../../src/ui/screens/setupForm.ts';
import { testSeed } from '../../helpers/seed.ts';

const FC_SEED = (seedWords(testSeed('20260929000000000000000000003701'))[0] as number) | 0;
const TABLE_SEED = '0123456789abcdef0123456789abcdef';

const STAGE_3: AvailableLevels = { bot: ['easy'], coach: ['beginner'] };
const ALL: AvailableLevels = { bot: BOT_LEVELS, coach: COACH_LEVELS };

const custom = (text: string) => ({ custom: true, text });
const preset = (value: number) => ({ custom: false, text: String(value) });

function form(patch: Partial<SetupForm> = {}): SetupForm {
  return {
    players: 6,
    stack: preset(2000),
    bigBlind: preset(20),
    botLevel: 'easy',
    coachLevel: 'beginner',
    seatLevels: [null, null, null, null, null, null],
    speed: 'normal',
    fourColour: true,
    ...patch,
  };
}

/** The last-used values Setup opens with (a `Settings` object fits). */
function values(patch: Partial<SetupValues> = {}): SetupValues {
  return {
    players: 6,
    startingStack: 2000,
    bb: 20,
    botLevel: 'easy',
    coachLevel: 'beginner',
    seatLevels: [null, null, null, null, null, null],
    speed: 'normal',
    fourColour: true,
    ...patch,
  };
}

/** Whether the engine accepts the config (§3.2 is enforced by createTable). */
function engineAccepts(config: TableConfig): boolean {
  try {
    createTable(config, initialSlots(config, TABLE_SEED, 'You'), TABLE_SEED);
    return true;
  } catch {
    return false;
  }
}

describe('presets and levels (§12.2, Appendix A.3)', () => {
  it('offers the §12.2 chips and blinds', () => {
    expect(STACK_PRESETS).toEqual([500, 1000, 2000, 5000, 10000]);
    expect(BIG_BLIND_PRESETS.map((bb) => `${bb / 2}/${bb}`)).toEqual([
      '5/10',
      '10/20',
      '25/50',
      '50/100',
      '100/200',
    ]);
  });

  it('lists the levels in the engine order', () => {
    expect(BOT_LEVEL_ORDER).toEqual(BOT_LEVELS);
    expect(COACH_LEVEL_ORDER).toEqual(COACH_LEVELS);
  });

  it('the defaults make a valid 6-player table: 2,000 chips, 10/20 = 100 big blinds (§3.2)', () => {
    const check = checkSetup(form(), STAGE_3);
    expect(check.stakes).toEqual({ kind: 'ok', bigBlinds: 100, band: 'normal' });
    expect(check.config).toEqual({
      seatCount: 6,
      sb: 10,
      bb: 20,
      startingStack: 2000,
      botLevel: 'easy',
      seatLevels: [null, null, null, null, null, null],
    });
    expect(engineAccepts(check.config as TableConfig)).toBe(true);
  });
});

describe('typed amounts (§12.2 Custom)', () => {
  it('strips non-digits and leading zeros', () => {
    expect(digitsOnly('2,500')).toBe('2500');
    expect(digitsOnly(' 1 000 000 chips')).toBe('1000000');
    expect(digitsOnly('-30')).toBe('30');
    expect(digitsOnly('007')).toBe('7');
    expect(digitsOnly('0')).toBe('0');
    expect(digitsOnly('abc')).toBe('');
    expect(digitsOnly('12345678901')).toBe('12345678');
  });

  it('reads an empty field as nothing', () => {
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('x')).toBeNull();
    expect(parseAmount('4,000')).toBe(4000);
  });

  it('keeps the starting stack to 200–1,000,000', () => {
    expect(stackValue(custom('199'))).toBeNull();
    expect(stackValue(custom('200'))).toBe(200);
    expect(stackValue(custom('1000000'))).toBe(1_000_000);
    expect(stackValue(custom('1000001'))).toBeNull();
    expect(stackValue(custom(''))).toBeNull();
  });

  it('rounds the big blind up to even and keeps it to 2–100,000', () => {
    expect(roundUpToEven(25)).toBe(26);
    expect(roundUpToEven(26)).toBe(26);
    expect(bigBlindValue(custom('25'))).toBe(26);
    expect(bigBlindValue(custom('1'))).toBe(2);
    expect(bigBlindValue(custom('0'))).toBeNull();
    expect(bigBlindValue(custom('2'))).toBe(2);
    expect(bigBlindValue(custom('99999'))).toBe(100_000);
    expect(bigBlindValue(custom('100000'))).toBe(100_000);
    expect(bigBlindValue(custom('100001'))).toBeNull();
    expect(bigBlindValue(custom(''))).toBeNull();
  });

  it('shows a value as its preset, or as Custom', () => {
    expect(amountFor(2000, STACK_PRESETS)).toEqual(preset(2000));
    expect(amountFor(3500, STACK_PRESETS)).toEqual(custom('3500'));
  });
});

describe('depth in big blinds (§3.2, §12.2)', () => {
  it('labels 10–24 short, 25–59 medium, 60–150 normal, 151–500 deep', () => {
    expect([10, 24, 25, 59, 60, 150, 151, 500].map(depthBand)).toEqual([
      'short',
      'short',
      'medium',
      'medium',
      'normal',
      'normal',
      'deep',
      'deep',
    ]);
  });

  it('needs 10 to 500 big blinds, compared exactly, and shows floor(chips / bb)', () => {
    expect(checkStakes(199, 20)).toEqual({ kind: 'tooShallow' });
    expect(checkStakes(200, 20)).toEqual({ kind: 'ok', bigBlinds: 10, band: 'short' });
    expect(checkStakes(10_000, 20)).toEqual({ kind: 'ok', bigBlinds: 500, band: 'deep' });
    // 500 bb plus one chip: floor says 500, but it is too deep.
    expect(checkStakes(10_001, 20)).toEqual({ kind: 'tooDeep' });
    expect(checkStakes(3_500, 30)).toEqual({ kind: 'ok', bigBlinds: 116, band: 'normal' });
  });

  it('flags the preset pairs that do not fit', () => {
    // 500 chips with 100/200 is 2.5 bb; 10,000 with 5/10 is 1,000 bb.
    expect(checkSetup(form({ stack: preset(500), bigBlind: preset(200) }), STAGE_3).stakes).toEqual(
      { kind: 'tooShallow' },
    );
    expect(
      checkSetup(form({ stack: preset(10_000), bigBlind: preset(10) }), STAGE_3).stakes,
    ).toEqual({ kind: 'tooDeep' });
  });
});

describe('checkSetup: Start is allowed exactly when the engine accepts the table', () => {
  it('has no config while a field is empty or out of range, or a level is not available', () => {
    expect(checkSetup(form({ stack: custom('') }), STAGE_3)).toMatchObject({
      stack: null,
      stakes: null,
      config: null,
    });
    expect(checkSetup(form({ bigBlind: custom('200000') }), STAGE_3)).toMatchObject({
      bb: null,
      config: null,
    });
    expect(checkSetup(form({ botLevel: 'hard' }), STAGE_3).config).toBeNull();
    expect(checkSetup(form({ coachLevel: 'exam' }), STAGE_3).config).toBeNull();
    expect(checkSetup(form({ botLevel: 'hard', coachLevel: 'exam' }), ALL).config).not.toBeNull();
  });

  it('agrees with createTable on random tables, presets and typed amounts alike', () => {
    const amount = fc.oneof(
      fc.integer({ min: 0, max: 1_200_000 }).map(String),
      fc.integer({ min: 0, max: 60 }).map(String),
      fc.constantFrom('', '0', '00', '1,000'),
    );
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 9 }),
        fc.oneof(fc.constantFrom(...STACK_PRESETS).map(preset), amount.map(custom)),
        fc.oneof(fc.constantFrom(...BIG_BLIND_PRESETS).map(preset), amount.map(custom)),
        fc.constantFrom(...BOT_LEVELS),
        (players, stack, bigBlind, botLevel) => {
          const check = checkSetup(form({ players, stack, bigBlind, botLevel }), ALL);
          const s = stackValue(stack);
          const bb = bigBlindValue(bigBlind);
          if (s === null || bb === null) {
            expect(check.config).toBeNull();
            return;
          }
          const config = tableConfig(players, s, bb, botLevel);
          expect(check.config !== null).toBe(engineAccepts(config));
          if (check.config !== null) expect(check.config).toEqual(config);
        },
      ),
      { seed: FC_SEED, numRuns: 3000 },
    );
  });

  it('agrees with createTable around the depth limits', () => {
    for (const bb of [2, 20, 30, 200, 100_000]) {
      for (const stack of [10 * bb - 1, 10 * bb, 500 * bb, 500 * bb + 1]) {
        const config = tableConfig(6, stack, bb, 'easy');
        const valid = checkSetup(
          form({ stack: custom(String(stack)), bigBlind: custom(String(bb)) }),
          STAGE_3,
        );
        expect([bb, stack, valid.config !== null]).toEqual([bb, stack, engineAccepts(config)]);
      }
    }
  });
});

describe('players and the opening form', () => {
  it('steps players within 2–9', () => {
    expect(stepPlayers(2, -1)).toBe(2);
    expect(stepPlayers(2, 1)).toBe(3);
    expect(stepPlayers(9, 1)).toBe(9);
    expect(stepPlayers(9, -1)).toBe(8);
  });

  it('opens with the last-used values (§12.2)', () => {
    expect(
      initialForm(
        values({
          players: 4,
          startingStack: 5000,
          bb: 50,
          seatLevels: [null, null, null, null],
          speed: 'fast',
          fourColour: false,
        }),
        STAGE_3,
      ),
    ).toEqual({
      players: 4,
      stack: preset(5000),
      bigBlind: preset(50),
      botLevel: 'easy',
      coachLevel: 'beginner',
      seatLevels: [null, null, null, null],
      speed: 'fast',
      fourColour: false,
    });
    expect(initialForm(values({ players: 3, startingStack: 3500, bb: 30 }), STAGE_3)).toMatchObject(
      { stack: custom('3500'), bigBlind: custom('30') },
    );
  });

  it('replaces a level that is not available yet and keeps players to 2–9', () => {
    const opened = initialForm(
      values({ players: 12, botLevel: 'expert', coachLevel: 'exam' }),
      STAGE_3,
    );
    expect(opened).toMatchObject({ players: 9, botLevel: 'easy', coachLevel: 'beginner' });
    expect(opened.seatLevels).toHaveLength(9);
    expect(initialForm(values({ players: Number.NaN }), STAGE_3).players).toBe(6);
  });
});

describe('per-seat levels: "Set each bot\'s level" (§9.3, §12.2, chunk 7.2)', () => {
  it('fits the list to the players: bots kept, new seats at the table level, the hero null', () => {
    const own = [null, 'hard', null, 'expert'] as const;
    expect(resizeSeatLevels(own, 4)).toEqual([null, 'hard', null, 'expert']);
    expect(resizeSeatLevels(own, 6)).toEqual([null, 'hard', null, 'expert', null, null]);
    expect(resizeSeatLevels(own, 3)).toEqual([null, 'hard', null]);
    expect(resizeSeatLevels(own, 2)).toEqual([null, 'hard']);
    // Whatever stood at seat 0, the hero has no level.
    expect(resizeSeatLevels(['easy', 'hard'], 2)).toEqual([null, 'hard']);
    expect(resizeSeatLevels([], 4)).toEqual([null, null, null, null]);
    // The input is not changed.
    const input: ('easy' | null)[] = [null, 'easy'];
    resizeSeatLevels(input, 5);
    expect(input).toEqual([null, 'easy']);
  });

  it('counts the bots that have a level of their own, never the hero', () => {
    expect(ownLevelCount([null, null, null])).toBe(0);
    expect(ownLevelCount([null, 'easy', null, 'expert'])).toBe(2);
    expect(ownLevelCount(['hard', null])).toBe(0);
    expect(ownLevelCount([])).toBe(0);
  });

  it('puts the overrides in the table config, one per seat, as the engine wants them', () => {
    const config = tableConfig(4, 2000, 20, 'medium', [null, 'hard', null, 'expert']);
    expect(config).toEqual({
      seatCount: 4,
      sb: 10,
      bb: 20,
      startingStack: 2000,
      botLevel: 'medium',
      seatLevels: [null, 'hard', null, 'expert'],
    });
    expect(engineAccepts(config)).toBe(true);
    // No list at all (the old call): every seat follows the table.
    expect(tableConfig(3, 2000, 20, 'easy').seatLevels).toEqual([null, null, null]);
    // A list for other players is fitted, so the config is always valid.
    expect(tableConfig(3, 2000, 20, 'easy', [null, 'hard', 'easy', 'expert']).seatLevels).toEqual([
      null,
      'hard',
      'easy',
    ]);
  });

  it('Start sends the form’s overrides, and agrees with createTable for any list', () => {
    const level = fc.constantFrom(null, ...BOT_LEVELS);
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 9 }),
        fc.array(level, { minLength: 0, maxLength: 12 }),
        fc.constantFrom(...BOT_LEVELS),
        (players, seatLevels, botLevel) => {
          const check = checkSetup(form({ players, seatLevels, botLevel }), ALL);
          expect(check.config).not.toBeNull();
          const config = check.config as TableConfig;
          expect(config.seatLevels).toHaveLength(players);
          expect(config.seatLevels[0]).toBeNull();
          expect(engineAccepts(config)).toBe(true);
          config.seatLevels.forEach((own, seat) => {
            if (seat > 0) expect(own).toBe(seatLevels[seat] ?? null);
          });
        },
      ),
      { seed: FC_SEED, numRuns: 500 },
    );
  });

  it('has no config while a bot has a level that cannot be picked yet (like the cards)', () => {
    const own = form({ seatLevels: [null, 'hard', null, null, null, null] });
    expect(checkSetup(own, STAGE_3).config).toBeNull();
    expect(checkSetup(own, ALL).config).not.toBeNull();
    expect(
      checkSetup(form({ seatLevels: [null, 'easy', null, null, null, null] }), STAGE_3).config,
    ).not.toBeNull();
  });

  it('opens with the saved overrides, dropping those that cannot be picked and fitting the players', () => {
    const saved = values({ players: 4, seatLevels: [null, 'hard', 'expert', 'medium'] });
    expect(initialForm(saved, ALL).seatLevels).toEqual([null, 'hard', 'expert', 'medium']);
    // Only Easy is available: the others open as "Same as table", like a level card would.
    expect(initialForm(saved, STAGE_3).seatLevels).toEqual([null, null, null, null]);
    // The list always has one entry per player, whatever was saved.
    expect(initialForm(values({ players: 6, seatLevels: [null, 'hard'] }), ALL).seatLevels).toEqual(
      [null, 'hard', null, null, null, null],
    );
    expect(
      initialForm(values({ players: 2, seatLevels: [null, null, 'hard'] }), ALL).seatLevels,
    ).toEqual([null, null]);
  });

  it('opens with the saved speed and four-colour setting', () => {
    expect(initialForm(values({ speed: 'instant', fourColour: false }), ALL)).toMatchObject({
      speed: 'instant',
      fourColour: false,
    });
  });
});
