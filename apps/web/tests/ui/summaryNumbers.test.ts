/**
 * The hand summary's numbers (PLAN §12.9; QA-1 of 6 Nov 2026): the summary showed the HUD's
 * any-cards number beside a grade that read the likely-hands number ("Slightly off · Coach: Fold
 * · You had 45%, needed 30%." while the grade's number was far below the price), which teaches the
 * opposite of lesson 6. Now a row shows the grade's own number, labelled as the coach labels it,
 * and never a comparison that argues against the coach's move.
 */
import { describe, expect, it } from 'vitest';
import { decisionRecord } from '../../src/app/undo.ts';
import { grade } from '../../src/brain/grade.ts';
import { hudEquity } from '../../src/brain/features.ts';
import type { PlayerAction } from '../../src/engine/types.ts';
import { rowNotes } from '../../src/ui/components/HandSummary.tsx';
import { rowNumbers, type RowNumbers, type SummaryRow } from '../../src/ui/summary.ts';
import { observeSpot, playSpot } from '../brain/fixtures.ts';
import { bet, call, check, raise } from '../engine/play.ts';

const CALL: PlayerAction = { type: 'call' };
const FOLD: PlayerAction = { type: 'fold' };
const money = (x: number): string => String(x);

/** A summary row: the hero called, the coach would fold, graded a Mistake. */
const row = (over: Partial<SummaryRow>): SummaryRow => ({
  decisionId: 0,
  street: 'turn',
  taken: CALL,
  rec: FOLD,
  grade: 'mistake',
  eRandom: 0.45,
  need: 0.3,
  eRange: null,
  R: null,
  undone: false,
  ...over,
});

describe('the summary numbers tell the grade’s story (§12.9, QA-1)', () => {
  it('the QA spots: the grade’s likely-hands number, labelled beside the HUD’s', () => {
    // Hand 6's turn (seed 5eed0003): a call graded Slightly off, the coach folds.
    expect(rowNotes(row({ grade: 'inaccuracy', eRange: 0.2, R: 0.92 }), money)).toBe(
      'Coach: Fold · Any cards: 45%. Their likely hands: about 20%, needed 30%.',
    );
    // Hand 3's river: "<1% against their likely hands" on the feedback card.
    expect(
      rowNotes(row({ street: 'river', eRandom: 0.38, need: 0.29, eRange: 0.004, R: 1 }), money),
    ).toBe('Coach: Fold · Any cards: 38%. Their likely hands: about <1%, needed 29%.');
  });

  it('close numbers keep today’s line; later bets explain a fold the price would pay', () => {
    // 45% and 46% with a 25% price: one story, the HUD's words.
    expect(rowNotes(row({ rec: CALL, taken: FOLD, eRange: 0.46, R: 1, need: 0.25 }), money)).toBe(
      'Coach: Call · You had 45%, needed 25%.',
    );
    // 33% (32% likely) beats 30%, but out of position later bets leave 27%: the coach folds.
    expect(rowNumbers(row({ eRandom: 0.33, eRange: 0.32, R: 0.85 }))).toMatchObject({
      kind: 'price',
      later: 0.32 * 0.85,
    });
    expect(rowNotes(row({ eRandom: 0.33, eRange: 0.32, R: 0.85 }), money)).toBe(
      'Coach: Fold · You had 33%, needed 30%. Counting later bets: about 27%.',
    );
  });

  it('a comparison that would argue against the coach’s move is left out', () => {
    // The coach calls a draw for its implied odds at 22% against a 25% price: no "needed".
    expect(
      rowNotes(
        row({ rec: CALL, taken: FOLD, eRandom: 0.22, eRange: 0.21, R: 1, need: 0.25 }),
        money,
      ),
    ).toBe('Coach: Call · You had 22%.');
    // A fold the numbers would pay even after later bets (the coach's ranges decided): no price.
    expect(rowNumbers(row({ eRandom: 0.5, eRange: 0.48, R: 0.95 }))).toEqual({
      kind: 'win',
      win: 0.5,
    });
    // An older record without the grade's numbers: the HUD's line when it agrees, else no price.
    expect(rowNotes(row({ rec: CALL, taken: FOLD, need: 0.25 }), money)).toBe(
      'Coach: Call · You had 45%, needed 25%.',
    );
    expect(rowNotes(row({}), money)).toBe('Coach: Fold · You had 45%.');
    // Nothing to call, or no HUD number: as before.
    expect(
      rowNotes(row({ need: null, rec: { type: 'check' }, taken: { type: 'check' } }), money),
    ).toBe('You had 45%.');
    expect(rowNotes(row({ eRandom: null }), money)).toBe('Coach: Fold');
  });

  it('property: a shown price never argues against the coach’s move', () => {
    const pct = (x: number): number => Math.round(100 * x);
    const moves: [PlayerAction, PlayerAction][] = [
      [CALL, FOLD],
      [FOLD, CALL],
    ];
    for (let a = 0; a <= 100; a += 3) {
      for (let b = 0; b <= 100; b += 7) {
        for (const need of [0.1, 0.25, 0.33, 0.5]) {
          for (const R of [0.72, 0.85, 1]) {
            for (const [rec, taken] of moves) {
              const n: RowNumbers = rowNumbers(
                row({
                  rec,
                  taken,
                  eRandom: a / 100,
                  eRange: b / 100,
                  R,
                  need,
                }),
              );
              if (n.kind !== 'price' && n.kind !== 'likely') continue;
              const shown = n.later ?? (n.kind === 'likely' ? n.likely : n.win);
              if (rec === FOLD) expect(pct(shown)).toBeLessThan(pct(need));
              else expect(pct(shown)).toBeGreaterThanOrEqual(pct(need));
            }
          }
        }
      }
    }
  });
});

describe('through the real grade (§8.9): the record keeps the grade’s numbers', () => {
  it('F19: K4o calls a river overbet; any cards say 20%+, the bettor’s likely hands far less', () => {
    // Heads-up, the button raises, the big blind calls and calls two barrels, then faces an
    // overbet on the river with top pair and a weak kicker (the audit's F19).
    const h = playSpot({
      stacks: [10_000, 10_000],
      button: 0,
      holes: { 1: 'Kc 4d', 0: 'Ac Qc' },
      board: 'Kh 9c 5s 2d 7h',
      inputs: [
        raise(0, 300),
        call(1),
        check(1),
        bet(0, 300),
        call(1),
        check(1),
        bet(0, 900),
        call(1),
        check(1),
        bet(0, 4000),
      ],
    });
    const obs = observeSpot(h, 1);
    const hud = hudEquity(obs);
    const result = grade(obs, CALL, hud, 3);
    expect(result.rec).toEqual(FOLD);
    expect(result.grade).not.toBe('best');
    expect(result.price).not.toBeNull();
    const price = result.price as NonNullable<typeof result.price>;
    const record = decisionRecord(
      {
        decisionId: 3,
        street: 'river',
        taken: CALL,
        eRandom: hud,
        need: price.need,
        hintSeen: true,
      },
      result,
    );
    expect(record).toMatchObject({ eRange: price.E, R: price.R });
    const r = row({
      street: 'river',
      grade: record.grade,
      rec: record.rec,
      eRandom: record.eRandom,
      need: record.need,
      eRange: record.eRange ?? null,
      R: record.R ?? null,
    });
    // The HUD's number beats the price; the grade's does not, and the row says the grade's.
    expect(Math.round(100 * hud)).toBeGreaterThanOrEqual(Math.round(100 * price.need));
    expect(rowNumbers(r).kind).toBe('likely');
    expect(rowNotes(r, money)).toMatch(
      /^Coach: Fold · Any cards: \d+%\. Their likely hands: about (<1|\d+)%, needed \d+%\.$/,
    );
  }, 20_000);
});
