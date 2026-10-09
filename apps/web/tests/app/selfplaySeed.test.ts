/**
 * Self-play (`scripts/selfplay-jobs.ts`, PLAN §9.7) seeds each bot decision exactly as the
 * controller does (§2.4: from the table seed only, never the hand seed), so a self-play hand and a
 * game hand at the same table make the same decisions. The self-play module keeps its own copy of
 * the one-line formula (the controller module pulls in the store); this test keeps the two equal.
 */
import { describe, expect, it } from 'vitest';
import { botSeed } from '../../src/app/controller.ts';
import { deriveSeed, ZERO_SEED } from '../../src/core/rng.ts';
import { botSeed as selfPlayBotSeed } from '../../scripts/selfplay-jobs.ts';

describe('self-play bot seeds', () => {
  it("are the controller's botSeed", () => {
    const table = deriveSeed(ZERO_SEED, 'selfplay-seed-test');
    for (const [handSeq, seat, logLength] of [
      [1, 0, 2],
      [7, 5, 31],
      [123, 8, 4],
      [20_000, 3, 57],
    ] as const) {
      expect(selfPlayBotSeed(table, handSeq, seat, logLength)).toBe(
        botSeed(table, handSeq, seat, logLength),
      );
    }
  });
});
