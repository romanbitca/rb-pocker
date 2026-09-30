/** PLAN §8.3 `openPct` and the brain's copy of the §9.3 level lists. */
import { describe, expect, it } from 'vitest';
import { LEVEL_PERSONALITIES, OPEN_PCT, openPct, PERSONALITIES } from '../../src/brain/tunables.ts';
import { PERSONALITY_LISTS } from '../../src/engine/table.ts';
import { BOT_LEVELS, PERSONALITY_IDS } from '../../src/engine/types.ts';

describe('tunables', () => {
  it('the level lists equal the engine’s (§9.3): the brain may not import engine code', () => {
    expect(LEVEL_PERSONALITIES).toStrictEqual(PERSONALITY_LISTS);
    for (const level of BOT_LEVELS) expect(LEVEL_PERSONALITIES[level]).toHaveLength(8);
  });

  it('has a §9.1 row for every personality', () => {
    expect(Object.keys(PERSONALITIES).sort()).toEqual([...PERSONALITY_IDS].sort());
  });

  it('openPct follows the §8.3 table; k is clamped to 1..8; heads-up is 80', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((k) => openPct(k, false))).toEqual([
      40, 43, 27, 21, 17, 15, 13, 11,
    ]);
    expect(OPEN_PCT).toHaveLength(8);
    expect(openPct(0, false)).toBe(40);
    expect(openPct(12, false)).toBe(11);
    expect(openPct(1, true)).toBe(80);
    expect(openPct(5, true)).toBe(80);
  });
});
