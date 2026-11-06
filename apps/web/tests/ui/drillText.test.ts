// PLAN §13.5, Appendix F.10: the hand drill's words. The reason a hand wins (the standalone
// drill's `whyWins`, now RB's evaluator plus these words), the trap notes, and the two lines of
// every answer, in plain short English: no sentence over 15 words (the coach's rule, §8.10).
import { describe, expect, it } from 'vitest';
import { formatCards, parseCards, type Card } from '../../src/core/cards.ts';
import { deriveSeed, rngFromSeed, ZERO_SEED } from '../../src/core/rng.ts';
import { emptyHands } from '../../src/drill/data.ts';
import { TRAPS_5, TRAPS_7 } from '../../src/drill/deal.ts';
import { facts5, facts7, why, type Why } from '../../src/drill/explain.ts';
import type { Position } from '../../src/drill/ladder.ts';
import {
  buildQuestion,
  DIFFICULTIES,
  GAME_IDS,
  gameFor,
  NO_PICKS,
  optionsOf,
  rightName,
  rightOption,
  rightPosition,
  SHOWDOWN_KINDS,
  VERSUS_KINDS,
  type BuildContext,
  type Picks,
  type Question,
} from '../../src/drill/questions.ts';
import { describe as describeHand } from '../../src/eval/describe.ts';
import { drillWords } from '../../src/i18n/drill.ts';
import { HandSource } from '../eval/hands.ts';
import { testSeed } from '../helpers/seed.ts';
import {
  answerLines,
  hintOf,
  nameAt,
  optionLabel,
  promptOf,
  trapText,
  whyText,
} from '../../src/ui/drillText.ts';

const cards = (text: string) => facts5(parseCards(text));
const reason = (a: string, b: string): string => whyText(why(cards(a), cards(b)));

/** The words of each sentence (a sentence ends at ". ", "? " or "! "). */
function sentences(text: string): string[][] {
  return text
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)))
    .filter((w) => w.length > 0);
}

function plain(text: string): string[] {
  const problems: string[] = [];
  if (/undefined|NaN|\{|\}/.test(text)) problems.push(`a hole in "${text}"`);
  for (const words of sentences(text)) {
    if (words.length > 15) problems.push(`${words.length} words: "${words.join(' ')}"`);
  }
  return problems;
}

describe('why a hand wins', () => {
  it('names the rows when the hands differ', () => {
    expect(reason('Ad Jd 8d 5d 2d', 'Tc 9d 8s 7h 6c')).toBe('Flush (#5) beats Straight (#6).');
    expect(reason('2c 2d 7h 9s Kc', 'As Ks Qs Js Ts')).toBe(
      'Royal flush (#1) beats One pair (#9).',
    );
  });

  it('explains a split pot, with side cards only when the hand has them', () => {
    expect(reason('Ac Kd Qh Jc Ts', 'Ad Kh Qs Jd Tc')).toBe(
      'Both have Straight, Ace-high. Suits never break ties, so the pot is split.',
    );
    expect(reason('Kc Kd 5h 5c 9s', 'Kh Ks 5d 5s 9c')).toBe(
      'Both have Two Pair, Kings and Fives, with the same side cards. Suits never break ties, so the pot is split.',
    );
  });

  it('finds the card that decides inside one row', () => {
    expect(reason('6c 5d 4h 3s 2c', '5c 4d 3h 2s Ac')).toBe(
      'Both have a straight. Six-high beats Five-high. A-2-3-4-5 is the lowest straight.',
    );
    expect(reason('9h 8h 7h 6h 5h', '8c 7c 6c 5c 4c')).toBe(
      'Both have a straight flush. Nine-high beats Eight-high.',
    );
    expect(reason('9c 9d 9h 9s Ac', '9c 9d 9h 9s Kc')).toBe(
      'Same four Nines. Kicker Ace beats King.',
    );
    expect(reason('Qc Qd Qh Qs 2c', 'Jc Jd Jh Js Ac')).toBe(
      'Both have four of a kind. Four Queens beat four Jacks.',
    );
    expect(reason('Ks Kh Kd 4c 4h', 'Qs Qh Qd Ac Ah')).toBe(
      'Both have a full house. The three of a kind decides first: Kings full beats Queens full.',
    );
    expect(reason('Ks Kh Kd 4c 4h', 'Ks Kh Kd 3c 3h')).toBe(
      'Same three Kings. Pair of Fours beats pair of Threes.',
    );
    expect(reason('7s 7h 7c Kd 2s', '7s 7h 7c Qd 2s')).toBe(
      'Same three Sevens. Kicker King beats Queen.',
    );
    expect(reason('7s 7h 7c Kd 3s', '7s 7h 7c Kd 2s')).toBe(
      'Same three Sevens. Next kicker Three beats Two.',
    );
    expect(reason('Jh Jc 5s 5d Ac', 'Jh Jc 4s 4d Ac')).toBe(
      'Same top pair (Jacks). Second pair Fives beats Fours.',
    );
    expect(reason('Jh Jc 5s 5d Ac', 'Jh Jc 5s 5d Kc')).toBe(
      'Same two pairs. Kicker Ace beats King.',
    );
    expect(reason('Th Ts Kc 6d 3h', 'Th Ts Kc 5d 3h')).toBe(
      'Same pair of Tens. Next kicker Six beats Five.',
    );
    expect(reason('Ac Qd 9s 6h 3c', 'Ac Qd 8s 6h 3c')).toBe(
      'Both have high card. Equal down to the third card: Nine beats Eight.',
    );
    expect(reason('Ad Jd 8d 5d 2d', 'Kh Jh 8h 5h 2h')).toBe(
      'Both have a flush. Top card Ace beats King.',
    );
  });

  it('gives the same reason whichever hand comes first', () => {
    expect(reason('Tc 9d 8s 7h 6c', 'Ad Jd 8d 5d 2d')).toBe(
      reason('Ad Jd 8d 5d 2d', 'Tc 9d 8s 7h 6c'),
    );
    const w: Why = why(cards('Ks Kh Kd 4c 4h'), cards('Ks Kh Kd 3c 3h'));
    expect(w).toEqual({ kind: 'cards', pos: 4, step: 2, a: 2, b: 1, main: 11 });
  });
});

describe('the drill’s other words', () => {
  it('has a note for every trap, in plain words', () => {
    for (const t of [...TRAPS_5, ...TRAPS_7]) {
      const text = trapText({ key: t.note, rank: 4 });
      expect(text.length, t.note).toBeGreaterThan(10);
      expect(plain(text), t.note).toEqual([]);
    }
    expect(trapText({ key: 'pairDoesNotPlay', rank: 4 })).toBe(
      'Your pair of Sixes does not play. The two higher pairs on the table make your two pair.',
    );
  });

  it('keeps every static line short', () => {
    const lines: string[] = [
      ...Object.values(drillWords.prompts),
      ...Object.values(drillWords.hints),
      ...Object.values(drillWords.games).map((g) => g.desc),
      ...Object.values(drillWords.difficulties).map((d) => d.desc),
      drillWords.answer.legend,
      drillWords.statsSummary(120, 7),
      drillWords.keyboard,
    ];
    for (const line of lines) expect(plain(line), line).toEqual([]);
  });

  it(
    'writes both lines of every answer, right and wrong, in every game',
    { timeout: 30_000 },
    () => {
      const rng = rngFromSeed(deriveSeed(ZERO_SEED, 'test|drill-text'));
      const problems: string[] = [];
      for (const game of GAME_IDS) {
        for (const difficulty of DIFFICULTIES) {
          for (let i = 0; i < 60; i++) {
            const ctx = {
              difficulty,
              hands: emptyHands(),
              last: null,
              lastTrap: { five: null, seven: null },
            };
            const q: Question = buildQuestion(rng, gameFor(rng, game), ctx).question;
            expect(promptOf(q).length).toBeGreaterThan(5);
            expect(hintOf(q).length).toBeGreaterThan(5);
            const right: Picks = {
              name: rightName(q),
              position: rightPosition(q),
              option: rightOption(q),
            };
            const other = (p: Position | null) =>
              p === null ? null : (((p % 10) + 1) as Position);
            const wrong: Picks =
              optionsOf(q).length > 0
                ? { ...NO_PICKS, option: optionsOf(q).find((id) => id !== right.option) ?? null }
                : { name: other(right.name), position: other(right.position), option: null };
            const yes = answerLines(q, right, true);
            const no = answerLines(q, wrong, false);
            expect(yes.first.startsWith('Correct.'), yes.first).toBe(true);
            expect(no.first.startsWith('Correct.'), no.first).toBe(false);
            for (const line of [yes.first, yes.second, no.first, no.second])
              problems.push(...plain(line));
            for (const id of optionsOf(q)) expect(optionLabel(q, id).length).toBeGreaterThan(2);
          }
        }
      }
      expect(problems.slice(0, 10)).toEqual([]);
    },
  );

  it('Easy promises different hand types only for most matchups, as its weights deal them', () => {
    // §13.5: on Easy, 15% of Which wins and 30% of Showdown are the same type (kickers) or a split.
    expect(VERSUS_KINDS.easy[0]).toBe(0.85);
    expect(SHOWDOWN_KINDS.easy[0]).toBe(0.7);
    const rng = rngFromSeed(deriveSeed(ZERO_SEED, 'test|drill-easy'));
    const ctx: BuildContext = {
      difficulty: 'easy',
      hands: emptyHands(),
      last: null,
      lastTrap: { five: null, seven: null },
    };
    let sameType = 0;
    for (let i = 0; i < 200; i++) {
      for (const game of ['versus', 'showdown'] as const) {
        const q = buildQuestion(rng, game, ctx).question;
        if ((q.type === 'versus' || q.type === 'showdown') && q.hands[0].pos === q.hands[1].pos) {
          sameType++;
        }
      }
    }
    expect(sameType).toBeGreaterThan(20);
    expect(drillWords.difficulties.easy.desc).toBe(
      'Clear textbook hands. Most matchups are different hand types.',
    );
  });

  it('says what the player said when only one of name and position is right', () => {
    const q = buildQuestion(rngFromSeed(deriveSeed(ZERO_SEED, 'test|drill-said')), 'cards', {
      difficulty: 'easy',
      hands: emptyHands(),
      last: null,
      lastTrap: { five: null, seven: null },
    }).question;
    if (q.type !== 'cards') throw new Error(q.type);
    const pos = q.hand.pos;
    const off = ((pos % 10) + 1) as Position;
    expect(answerLines(q, { name: off, position: pos, option: null }, false).second).toContain(
      `Position right. You named it ${nameAt(off)}.`,
    );
    expect(answerLines(q, { name: pos, position: off, option: null }, false).second).toContain(
      `Name right. You put it at #${off}.`,
    );
    expect(answerLines(q, { name: off, position: off, option: null }, false).second).toContain(
      `You said ${nameAt(off)}, #${off}.`,
    );
  });
});

// §13.5: in Hold'em the answer says how many of the player's own cards play: the cards in the best
// five, kickers too, the Table's own rule (`describe()`'s `holeUsed`, §5.4; pitfall 10: when the
// board plays, none of them do).
describe("Hold'em: how many of your cards play", () => {
  const USES = [0, 1, 2].map((n) => drillWords.answer.uses(n));

  /** The uses lines a right answer to this Hold'em hand says (exactly one is expected). */
  function usesSaid(hole: readonly Card[], board: readonly Card[]): string[] {
    const q: Question = { type: 'holdem', board, hole, hand: facts7(hole, board), trap: null };
    const picks: Picks = { name: q.hand.pos, position: q.hand.pos, option: null };
    const { second } = answerLines(q, picks, true);
    return USES.filter((line) => second.includes(line));
  }
  const said = (hole: string, board: string): string[] =>
    usesSaid(parseCards(hole), parseCards(board));

  it('counts the kickers from your hand, as the Table does', () => {
    // Four Kings on the table: your Ace is the kicker (the Table: "Uses 1 of your cards").
    expect(said('Ah Qc', 'Ks Kd Kh Kc 2s')).toEqual(['Uses 1 of your cards.']);
    const quads = parseCards('Ah Qc') as [Card, Card];
    expect(describeHand(quads, parseCards('Ks Kd Kh Kc 2s')).subLabel).toBe('Uses 1 of your cards');
    // A pair, two pair or three of a kind on the table, high card: your side cards play.
    expect(said('Ah Kc', '9s 9d 7h 5c 2s')).toEqual(['Uses both your cards.']);
    expect(said('Ad 3c', 'Ks Kd 7h 7c 2s')).toEqual(['Uses 1 of your cards.']);
    expect(said('Ah Qc', '9s 9d 9h 5c 2s')).toEqual(['Uses both your cards.']);
    expect(said('Ah Qc', 'Ks 9d 7h 5c 2s')).toEqual(['Uses both your cards.']);
    // The board plays (pitfall 10): a 10 in your hand matches the table's, but none of yours plays.
    expect(said('Tc 2d', 'As Kd Qc Jh Ts')).toEqual(['Made only from the table.']);
    expect(said('3c 2d', 'Ks Kd Kh Kc As')).toEqual(['Made only from the table.']);
  });

  it(
    'agrees with describe() over random 7-card hands, in every category',
    { timeout: 30_000 },
    () => {
      const src = new HandSource(testSeed(deriveSeed(ZERO_SEED, 'test|drill-uses')));
      const problems: string[] = [];
      /** The categories where a side card of yours played (the cards the old count missed). */
      const kickers = new Set<string>();
      for (let i = 0; i < 20_000; i++) {
        const seven = i % 2 === 0 ? src.uniform(7) : src.biased(7);
        const hole = seven.slice(0, 2) as [Card, Card];
        const board = seven.slice(2);
        const info = describeHand(hole, board);
        const yours = info.best5.filter((c) => hole.includes(c)).length;
        const table = /^Uses (\d) of your cards$/.exec(info.subLabel ?? '');
        const lines = usesSaid(hole, board);
        const why =
          lines.length !== 1 || lines[0] !== drillWords.answer.uses(yours)
            ? `says ${JSON.stringify(lines)}, ${yours} of yours in the best five`
            : (yours === 0) !== info.playsTheBoard
              ? 'the board plays exactly when none of yours do'
              : table !== null && Number(table[1]) !== yours
                ? `the Table says ${info.subLabel}`
                : null;
        if (why !== null && problems.length < 10) {
          problems.push(`${formatCards(hole)} | ${formatCards(board)}: ${why}`);
        }
        if (info.kickers.some((c) => hole.includes(c))) kickers.add(info.category);
      }
      expect(problems).toEqual([]);
      expect([...kickers].sort()).toEqual(['highCard', 'pair', 'quads', 'trips', 'twoPair']);
    },
  );
});
