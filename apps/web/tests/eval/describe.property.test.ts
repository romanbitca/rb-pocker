import { describe as suite, expect, it } from 'vitest';
import { formatCards, rankOf, suitOf, type Card } from '../../src/core/cards.ts';
import { deriveSeed, ZERO_SEED } from '../../src/core/rng.ts';
import { describe, HAND_TEXT, type HandInfo } from '../../src/eval/describe.ts';
import { categoryOf, score5, score7 } from '../../src/eval/evaluate.ts';
import { testSeed } from '../helpers/seed.ts';
import { HandSource } from './hands.ts';

const FIXED_SUB_LABELS = new Set<string | null>([
  null,
  HAND_TEXT.boardPlays,
  HAND_TEXT.overpair,
  HAND_TEXT.secondPair,
  HAND_TEXT.weakPair,
  HAND_TEXT.pairUnderBoard,
  HAND_TEXT.pairOnBoard,
  HAND_TEXT.bothCardsPair,
  HAND_TEXT.bothPairsOnBoard,
  HAND_TEXT.onePairOnBoard,
  HAND_TEXT.set,
  HAND_TEXT.trips1,
  HAND_TEXT.tripsOnBoard,
]);
const VARIABLE_SUB_LABEL = /^(Top pair, [A-Z][a-z]+ kicker|Uses [12] of your cards)$/;
const FLUSHES = new Set(['flush', 'straightFlush', 'royalFlush']);

/** Every rule a describe() result must satisfy; returns the first broken one, or null. */
function broken(hole: [Card, Card], board: Card[], info: HandInfo): string | null {
  const all = [...hole, ...board];
  const score = score7(all, all.length);
  if (info.score !== score) return 'score';
  if (score5(info.best5) !== score) return 'score5(best5) != score7(hole + board)';
  if (info.category !== categoryOf(score)) return 'category';
  if (new Set(info.best5).size !== 5 || !info.best5.every((c) => all.includes(c))) return 'best5';
  const joined = [...info.core, ...info.kickers];
  if (joined.length !== 5 || joined.some((c, i) => c !== info.best5[i])) {
    return 'core + kickers != best5';
  }
  if (info.holeUsed !== info.best5.filter((c) => hole.includes(c)).length) return 'holeUsed';
  if (info.preflopClass !== null) return 'preflopClass';
  if (info.name.length === 0) return 'name';

  const boardPlays = board.length === 5 && score7(board, 5) === score;
  if (info.playsTheBoard !== boardPlays) return 'playsTheBoard';
  if (boardPlays) {
    if (!info.best5.every((c) => board.includes(c))) return 'board plays but best5 uses the hand';
    if (info.subLabel !== HAND_TEXT.boardPlays) return 'board-plays sub-label';
  } else if (info.holeUsed === 0) {
    return 'holeUsed 0 without playsTheBoard';
  }
  if (!FIXED_SUB_LABELS.has(info.subLabel) && !VARIABLE_SUB_LABEL.test(info.subLabel ?? '')) {
    return `unknown sub-label "${info.subLabel}"`;
  }

  // §5.4 selection: among equal ranks, hole cards first, then the higher suit.
  if (!boardPlays && !FLUSHES.has(info.category)) {
    for (const chosen of info.best5) {
      for (const other of all) {
        if (info.best5.includes(other) || rankOf(other) !== rankOf(chosen)) continue;
        const chosenHole = hole.includes(chosen);
        const otherHole = hole.includes(other);
        if (otherHole && !chosenHole) return 'left out a hole card';
        if (otherHole === chosenHole && suitOf(other) > suitOf(chosen))
          return 'left out a higher suit';
      }
    }
  }
  return null;
}

// PLAN §5.5 "describe consistency": score5(best5) == score7(hole + board), 100,000 random hands.
suite('describe(): properties over random hands', () => {
  it(
    'best five scores the same as the whole hand; fields are consistent',
    { timeout: 120_000 },
    () => {
      const src = new HandSource(testSeed(deriveSeed(ZERO_SEED, 'test|describe')));
      const failures: string[] = [];
      let playsTheBoard = 0;
      for (let i = 0; i < 100_000; i++) {
        const boardSize = [3, 4, 5][i % 3] as number;
        const drawn = i % 4 === 3 ? src.biased(2 + boardSize) : src.uniform(2 + boardSize);
        const hole: [Card, Card] = [drawn[0] as Card, drawn[1] as Card];
        const board = drawn.slice(2);
        const info = describe(hole, board);
        if (info.playsTheBoard) playsTheBoard++;
        const why = broken(hole, board, info);
        if (why !== null && failures.length < 10) {
          failures.push(`${formatCards(hole)} | ${formatCards(board)}: ${why}`);
        }
      }
      expect(failures).toEqual([]);
      expect(playsTheBoard).toBeGreaterThan(0);
    },
  );

  it('names every preflop hand', () => {
    for (let a = 0; a < 52; a++) {
      for (let b = a + 1; b < 52; b++) {
        const info = describe([a, b], []);
        expect(info.score).toBe(0);
        expect(info.best5).toEqual([]);
        expect(info.subLabel).toBeNull();
        expect(info.category).toBe(rankOf(a) === rankOf(b) ? 'pair' : 'highCard');
        expect(info.name).toMatch(
          /^(Pocket [A-Z][a-z]+|[A-Z][a-z]+-[A-Z][a-z]+ (suited|offsuit))$/,
        );
        expect(info.preflopClass).toMatch(/^([2-9TJQKA])\1$|^[2-9TJQKA]{2}[so]$/);
      }
    }
  });
});
