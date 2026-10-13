/**
 * The HUD's data views (app/equityViews.ts; PLAN §6, §7.6, §10.2, §13.2): the adapter over the
 * 4.5 equity slice, the badge's data, the draw chips from the hand analysis (Appendix D.2), the
 * exact outs formula (Appendix C.5, never the rule of 2 and 4), the "By river" and nuts rules,
 * the EQ_DANGER threats and the big-move selection, and the selectors' memoization.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { analyzeHand } from '../../src/analysis/handinfo.ts';
import type { EquityResult, HandAnalysis } from '../../src/analysis/types.ts';
import {
  BIG_MOVE_POINTS,
  bigMoveOf,
  boardThreats,
  byRiverShown,
  drawCards,
  drawChipsOf,
  initialCoach,
  initialEquity,
  initialGame,
  nutsOf,
  outsPct,
  selectByRiver,
  selectWinBadge,
  winBadgeOf,
  type AppState,
  type EquitySlice,
} from '../../src/app/store.ts';
import { defaultSettings } from '../../src/persist/schema.ts';
import type { Card } from '../../src/core/cards.ts';
import type { HandState, LogEvent, TableState } from '../../src/engine/types.ts';
import { FC_SEED, heroHand } from '../analysis/states.ts';
import { card, cards, hole } from '../helpers/cards.ts';

// ---------------------------------------------------------------------------------------------
// Fixtures

const result = (equity: number, final = true, extra: Partial<EquityResult> = {}): EquityResult => ({
  n: 40_000,
  win: equity,
  split: 0,
  equity,
  exact: false,
  final,
  truncated: false,
  ...extra,
});

/** An `equity` slice as the equity jobs write it (chunk 4.5). */
const fields = (patch: Partial<EquitySlice> = {}): EquitySlice => ({
  ...initialEquity(),
  status: 'done',
  ...patch,
});

/** A situation (§7.4) for the hero's A♥K♥ unless told otherwise. */
const sit = (handSeq: number, board: Card[], nOpp: number, heroCards = hole('A♥ K♥')) => ({
  handSeq,
  hero: heroCards,
  board,
  nOpp,
});

interface HandOptions {
  hole: string;
  board: string;
  handSeq?: number;
  folded?: boolean;
  phase?: HandState['phase'];
  runout?: boolean;
  log?: LogEvent[];
}

/** A hand state with what the builders read: the hero (seat 0) and two bots. */
function handOf(o: HandOptions): HandState {
  const seat = (holeCards: [Card, Card] | null, folded = false) => ({
    dealtIn: true,
    stack: 1000,
    hole: holeCards,
    folded,
    allIn: false,
    streetBet: 0,
    totalBet: 20,
    lastActedAtBet: null,
  });
  return {
    handSeq: o.handSeq ?? 7,
    phase: o.phase ?? 'betting',
    board: cards(o.board),
    seats: [seat(hole(o.hole), o.folded), seat(null), seat(null)],
    log: o.log ?? [],
    runout: o.runout ?? false,
    revealed: [],
  } as unknown as HandState;
}

const TABLE = {
  slots: [{ name: 'You' }, { name: 'Ben' }, { name: 'Anna' }],
} as unknown as TableState;

const fold = (seat: number): LogEvent =>
  ({ e: 'act', seat, street: 'flop', action: { type: 'fold' } }) as unknown as LogEvent;

function analysisOf(holeText: string, boardText: string): HandAnalysis {
  const a = analyzeHand(hole(holeText), cards(boardText));
  return { ...a, nextCardPct: null, byRiverPct: null, chances: null };
}

// ---------------------------------------------------------------------------------------------

describe('the badge data (§7.6, §10.2)', () => {
  const s3 = sit(3, cards('Qh 7h 2c'), 3);

  it('is off when "Show win chance" is off, at Exam, and with no hand', () => {
    const f = fields({ status: 'computing', situation: s3, result: result(0.6, false) });
    expect(winBadgeOf(f, false, 'beginner').status).toBe('off');
    expect(winBadgeOf(f, true, 'exam').status).toBe('off');
    expect(winBadgeOf(fields({ status: 'off' }), true, 'beginner').status).toBe('off');
  });

  it('keys the estimate by hand, board and live opponents', () => {
    const f = fields({ status: 'computing', situation: s3, result: result(0.6, false) });
    const b = winBadgeOf(f, true, 'advanced');
    expect(b).toMatchObject({ status: 'computing', nOpp: 3, known: false });
    expect(b.key).toBe(`3|${s3.board.join(',')}|3`);
    const folded = winBadgeOf(fields({ ...f, situation: { ...s3, nOpp: 2 } }), true, 'beginner');
    expect(folded.key).not.toBe(b.key);
  });

  it('shows "Folded" when the hero folded', () => {
    expect(winBadgeOf(fields({ status: 'folded' }), true, 'beginner').status).toBe('folded');
  });

  it("known hands (an all-in run-out): the hero's own run-out number", () => {
    const f = fields({
      status: 'done',
      mode: 'known',
      known: {
        handSeq: 4,
        seats: [2, 0],
        board: [],
        perPlayer: [0.3, 0.7],
        exact: true,
        final: true,
      },
    });
    const b = winBadgeOf(f, true, 'beginner');
    expect(b.known).toBe(true);
    expect(b.result?.equity).toBe(0.7);
    expect(b.result?.final).toBe(true);
    expect(b.nOpp).toBe(1);
  });
});

describe('outs → exact chance (§6.6, Appendix C.5; pitfall 12)', () => {
  it('matches Appendix C.5 to 0.1 points', () => {
    const rows: [number, number, number][] = [
      // outs, turn → river (next card on the turn), flop → river
      [4, 8.7, 16.5],
      [8, 17.4, 31.5],
      [9, 19.6, 35.0],
      [12, 26.1, 45.0],
      [15, 32.6, 54.1],
      [21, 45.7, 69.9],
    ];
    for (const [outs, turn, flop] of rows) {
      expect(outsPct(outs, 4)).toBeCloseTo(turn, 1);
      expect(outsPct(outs, 3)).toBeCloseTo(flop, 1);
    }
  });

  it('is never the rule of 4 and 2 where those differ (15 outs: 54.1%, not 60%)', () => {
    for (let outs = 1; outs <= 21; outs++) {
      const flop = outsPct(outs, 3);
      const exact = 100 * (1 - ((47 - outs) * (46 - outs)) / (47 * 46));
      expect(flop).toBeCloseTo(exact, 9);
      expect(outsPct(outs, 4)).toBeCloseTo((100 * outs) / 46, 9);
      if (Math.round(exact) !== 4 * outs) expect(Math.round(flop)).not.toBe(4 * outs);
    }
    expect(Math.round(outsPct(15, 3))).toBe(54);
  });
});

describe('the draw chips (§6.2, §6.3, Appendix D.2)', () => {
  it('A♥K♥ on Q♥7♥2♣: nut flush draw (9, the 2♥ risky) then two overcards (6, all risky)', () => {
    const hand = handOf({ hole: 'A♥ K♥', board: 'Q♥ 7♥ 2♣' });
    const chips = drawChipsOf(hand, analysisOf('A♥ K♥', 'Q♥ 7♥ 2♣'), 'beginner');
    expect(chips?.draws.map((d) => d.kind)).toEqual(['nutFlush', 'overcards']);
    const [flush, over] = chips?.draws ?? [];
    expect(flush?.outs).toBe(9);
    expect(flush?.cards.map((c) => c.card).sort((a, b) => a - b)).toEqual(
      cards('2♥ 3♥ 4♥ 5♥ 6♥ 8♥ 9♥ 10♥ J♥').sort((a, b) => a - b),
    );
    expect(flush?.cards.filter((c) => c.risky).map((c) => c.card)).toEqual([card('2♥')]);
    expect(flush?.when).toBe('byRiver');
    expect(flush?.pct).toBeCloseTo(34.97, 2);
    expect(over?.outs).toBe(6);
    expect(over?.cards.every((c) => c.risky)).toBe(true);
    expect(chips?.namesOnly).toBe(false);
  });

  it('J♠10♠ on Q♠9♦2♠: flush draw (9) and open-ended (6 straight outs + shared flush cards)', () => {
    const hand = handOf({ hole: 'J♠ 10♠', board: 'Q♠ 9♦ 2♠' });
    const chips = drawChipsOf(hand, analysisOf('J♠ 10♠', 'Q♠ 9♦ 2♠'), 'beginner');
    expect(chips?.draws.map((d) => [d.kind, d.outs, d.cards.length])).toEqual([
      ['flush', 9, 9],
      ['oesd', 8, 8],
    ]);
  });

  it('on the turn: the next card, out of 46', () => {
    const hand = handOf({ hole: 'A♥ K♥', board: 'Q♥ 7♥ 2♣ 3♦' });
    const chips = drawChipsOf(hand, analysisOf('A♥ K♥', 'Q♥ 7♥ 2♣ 3♦'), 'beginner');
    const flush = chips?.draws[0];
    expect(flush?.when).toBe('nextCard');
    expect(flush?.pct).toBeCloseTo((100 * 9) / 46, 9);
  });

  it('none preflop, on the river, without a draw, after a fold, and for a stale analysis', () => {
    const flop = analysisOf('A♥ K♥', 'Q♥ 7♥ 2♣');
    expect(drawChipsOf(handOf({ hole: 'A♥ K♥', board: '' }), flop, 'beginner')).toBeNull();
    const river = handOf({ hole: 'A♥ K♥', board: 'Q♥ 7♥ 2♣ 3♦ 9♠' });
    expect(drawChipsOf(river, flop, 'beginner')).toBeNull();
    const set = handOf({ hole: '9♥ 9♦', board: 'K♠ 7♣ 2♦' });
    expect(drawChipsOf(set, analysisOf('9♥ 9♦', 'K♠ 7♣ 2♦'), 'beginner')).toBeNull();
    const folded = handOf({ hole: 'A♥ K♥', board: 'Q♥ 7♥ 2♣', folded: true });
    expect(drawChipsOf(folded, flop, 'beginner')).toBeNull();
    // The turn brought the 9♥ (a flop out): the flop's analysis no longer fits the hand.
    const turn = handOf({ hole: 'A♥ K♥', board: 'Q♥ 7♥ 2♣ 9♥' });
    expect(drawChipsOf(turn, flop, 'beginner')).toBeNull();
  });

  it('J♠10♠ on Q♠9♦2♠: the straight draw has all 8s and Ks, the 8♠ and K♠ in both draws', () => {
    const h = hole('J♠ 10♠');
    const board = cards('Q♠ 9♦ 2♠');
    const { outs } = analyzeHand(h, board);
    const sorted = (cs: readonly { card: number }[]) => cs.map((o) => o.card).sort((a, b) => a - b);
    expect(sorted(drawCards('oesd', h, board, outs))).toEqual(
      sorted(cards('8♣ 8♦ 8♥ 8♠ K♣ K♦ K♥ K♠').map((c) => ({ card: c }))),
    );
    expect(sorted(drawCards('flush', h, board, outs))).toEqual(
      sorted(cards('3♠ 4♠ 5♠ 6♠ 7♠ 8♠ 9♠ K♠ A♠').map((c) => ({ card: c }))),
    );
  });

  for (const boardLength of [3, 4] as const) {
    it(`picks exactly each draw's outs on 1,000 random ${boardLength === 3 ? 'flops' : 'turns'}`, () => {
      let chips = 0;
      fc.assert(
        fc.property(heroHand(boardLength), ({ hole: h, board }) => {
          const { draws, outs } = analyzeHand(h, board);
          for (const d of draws) {
            if (d.kind === 'backdoorFlush' || d.kind === 'backdoorStraight') continue;
            const picked = drawCards(d.kind, h, board, outs);
            expect(picked).toHaveLength(d.outs);
            for (const o of picked) expect(outs).toContain(o);
            chips++;
          }
        }),
        { numRuns: 1_000, seed: FC_SEED },
      );
      expect(chips).toBeGreaterThan(100);
    }, 60_000);
  }

  it('Exam shows the names only (§10.2)', () => {
    const hand = handOf({ hole: 'A♥ K♥', board: 'Q♥ 7♥ 2♣' });
    expect(drawChipsOf(hand, analysisOf('A♥ K♥', 'Q♥ 7♥ 2♣'), 'exam')?.namesOnly).toBe(true);
  });
});

describe('"By river" and the nuts suffix (§6.5, §6.6, §13.2)', () => {
  it('the column shows while the hero plays the hand, not at Exam, after a fold, at the end or in a run-out', () => {
    const live = handOf({ hole: 'A♥ K♥', board: '' });
    expect(byRiverShown(live, 'beginner')).toBe(true);
    expect(byRiverShown(live, 'advanced')).toBe(true);
    expect(byRiverShown(live, 'exam')).toBe(false);
    expect(byRiverShown(handOf({ hole: 'A♥ K♥', board: '', folded: true }), 'beginner')).toBe(
      false,
    );
    expect(byRiverShown(handOf({ hole: 'A♥ K♥', board: '', phase: 'complete' }), 'beginner')).toBe(
      false,
    );
    expect(byRiverShown(handOf({ hole: 'A♥ K♥', board: '', runout: true }), 'beginner')).toBe(
      false,
    );
    expect(byRiverShown(null, 'beginner')).toBe(false);
  });

  it('nuts: from the flop, while live, for an analysis of these cards', () => {
    const nutsA: HandAnalysis = { ...analysisOf('A♥ K♥', 'Q♥ 7♥ 2♣'), nuts: true };
    expect(nutsOf(handOf({ hole: 'A♥ K♥', board: 'Q♥ 7♥ 2♣' }), nutsA)).toBe(true);
    expect(nutsOf(handOf({ hole: 'A♥ K♥', board: 'Q♥ 7♥ 2♣', folded: true }), nutsA)).toBe(false);
    expect(nutsOf(handOf({ hole: 'A♥ K♥', board: 'Q♥ 7♥ 2♣' }), { ...nutsA, nuts: false })).toBe(
      false,
    );
    expect(nutsOf(handOf({ hole: 'A♥ K♥', board: 'Q♥ 7♥ 2♣ 9♥' }), nutsA)).toBe(false);
  });
});

describe('EQ_DANGER threats (Appendix F.3)', () => {
  it('paired → a full house, 3 of a suit → a flush, 4 to a straight → a straight', () => {
    expect(boardThreats(cards('K♠ 7♣ 2♦'))).toEqual([]);
    expect(boardThreats(cards('K♠ 7♣ 7♦'))).toEqual(['fullHouse']);
    expect(boardThreats(cards('K♠ 7♠ 2♠'))).toEqual(['flush']);
    expect(boardThreats(cards('9♠ 8♣ 7♦ 5♥'))).toEqual(['straight']);
    expect(boardThreats(cards('9♠ 8♣ 7♦ 2♥'))).toEqual([]);
    expect(boardThreats(cards('A♠ 2♣ 3♦ 4♥'))).toEqual(['straight']);
    expect(boardThreats(cards('A♠ K♣ Q♦ J♥'))).toEqual(['straight']);
    expect(boardThreats(cards('Q♠ K♣ A♦ 2♥'))).toEqual([]);
    expect(boardThreats(cards('9♠ 9♣ 8♠ 7♠ 6♦'))).toEqual(['fullHouse', 'flush', 'straight']);
  });
});

describe('the big-move line (§7.6)', () => {
  const flop = cards('Q♥ 7♥ 2♣');

  it('a fold that adds 8 points or more names the bot', () => {
    const hand = handOf({ hole: 'A♥ K♥', board: 'Q♥ 7♥ 2♣', log: [fold(1), fold(2)] });
    const f = fields({
      situation: sit(7, flop, 1),
      result: result(0.62),
      previous: { equity: 0.5, nOpp: 2, board: flop },
    });
    expect(bigMoveOf(f, hand, TABLE)).toEqual({
      key: `7|${flop.join(',')}|1`,
      kind: 'fold',
      name: 'Anna',
    });
  });

  it(`nothing under ${BIG_MOVE_POINTS} points, before the final, for two folds at once, or on the flop`, () => {
    const hand = handOf({ hole: 'A♥ K♥', board: 'Q♥ 7♥ 2♣', log: [fold(1)] });
    const base = fields({
      situation: sit(7, flop, 1),
      result: result(0.579),
      previous: { equity: 0.5, nOpp: 2, board: flop },
    });
    expect(bigMoveOf(base, hand, TABLE)).toBeNull();
    expect(bigMoveOf({ ...base, result: result(0.7, false) }, hand, TABLE)).toBeNull();
    expect(
      bigMoveOf(
        { ...base, result: result(0.7), previous: { equity: 0.5, nOpp: 3, board: flop } },
        hand,
        TABLE,
      ),
    ).toBeNull();
    // Preflop → flop: three cards at once, no line.
    expect(
      bigMoveOf(
        { ...base, result: result(0.3), previous: { equity: 0.66, nOpp: 1, board: [] } },
        hand,
        TABLE,
      ),
    ).toBeNull();
  });

  it('a turn card that makes a better hand: EQ_IMPROVED with the new hand name', () => {
    const hand = handOf({ hole: 'A♥ K♥', board: 'Q♥ 7♥ 2♣ 5♥' });
    const f = fields({
      situation: sit(7, cards('Q♥ 7♥ 2♣ 5♥'), 1),
      result: result(0.95),
      previous: { equity: 0.6, nOpp: 1, board: flop },
    });
    expect(bigMoveOf(f, hand, TABLE)).toMatchObject({
      kind: 'improved',
      card: card('5♥'),
      handName: 'Flush, Ace-high',
    });
  });

  it('a turn card that drops the number: EQ_DANGER with the new threat, else EQ_BLANK_DROP', () => {
    const drop = (board: string) =>
      bigMoveOf(
        fields({
          situation: sit(7, cards(board), 1),
          result: result(0.4),
          previous: { equity: 0.6, nOpp: 1, board: cards('K♠ 8♦ 2♣') },
        }),
        handOf({ hole: 'A♠ K♦', board }),
        TABLE,
      );
    expect(drop('K♠ 8♦ 2♣ 8♣')).toMatchObject({ kind: 'danger', threat: 'fullHouse' });
    expect(drop('K♠ 8♦ 2♣ 3♣')).toEqual({
      key: `7|${cards('K♠ 8♦ 2♣ 3♣').join(',')}|1`,
      kind: 'blank',
      card: card('3♣'),
    });
  });

  it('nothing after the hero folded or in known-hands mode', () => {
    const f = fields({
      situation: sit(7, flop, 1),
      result: result(0.62),
      previous: { equity: 0.5, nOpp: 2, board: flop },
    });
    const folded = handOf({ hole: 'A♥ K♥', board: 'Q♥ 7♥ 2♣', folded: true, log: [fold(1)] });
    expect(bigMoveOf(f, folded, TABLE)).toBeNull();
    const live = handOf({ hole: 'A♥ K♥', board: 'Q♥ 7♥ 2♣', log: [fold(1)] });
    expect(bigMoveOf({ ...f, mode: 'known' }, live, TABLE)).toBeNull();
  });
});

describe('selectors keep their objects (pitfall 37)', () => {
  const state = (equity: EquitySlice, hand: HandState | null = null): AppState =>
    ({
      game: { ...initialGame(), hand },
      equity,
      coach: initialCoach(),
      settings: defaultSettings(),
    }) as unknown as AppState;

  it('a slice write that changes nothing on the badge returns the same badge object', () => {
    const r = result(0.6, false);
    const slice = (): EquitySlice =>
      fields({ status: 'computing', situation: sit(1, [], 2), result: r });
    const a = selectWinBadge(state(slice()));
    const b = selectWinBadge(state(slice()));
    expect(b).toBe(a);
    expect(selectWinBadge(state(initialEquity()))).not.toBe(a);
  });

  it('"By river" keeps its object across bot actions (a new hand state, same cards)', () => {
    const hand = handOf({ hole: 'A♥ K♥', board: '' });
    const eq = initialEquity();
    const a = selectByRiver(state(eq, hand));
    const b = selectByRiver(state(eq, { ...hand, log: [fold(1)] }));
    expect(a).toEqual({ handSeq: 7, exactly: null });
    expect(b).toBe(a);
  });
});
