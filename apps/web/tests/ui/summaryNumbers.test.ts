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
import {
  rowDid,
  rowNotes,
  rowNumbers,
  type RowNumbers,
  type SummaryRow,
} from '../../src/ui/summary.ts';
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
    // Hand 3's river: "<1% against their likely hands" on the feedback card (a bound says no
    // "about", QA-2 item 8).
    expect(
      rowNotes(row({ street: 'river', eRandom: 0.38, need: 0.29, eRange: 0.004, R: 1 }), money),
    ).toBe('Coach: Fold · Any cards: 38%. Their likely hands: <1%, needed 29%.');
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

describe('QA-2 of 6 Nov 2026 (fix/coach-words-round-2)', () => {
  const RAISE_2100: PlayerAction = { type: 'raise', to: 2100 };

  it('item 1: a call where raising wins more says so (seed 5eed2301, hand 1)', () => {
    // "River · You called · Big mistake · Coach: Raise to 2,100 · You had >99%, needed 30%."
    const r = row({
      street: 'river',
      taken: CALL,
      rec: RAISE_2100,
      grade: 'inaccuracy',
      eRandom: 0.999,
      need: 0.3,
      eRange: 0.996,
      R: 1,
    });
    expect(rowNotes(r, money)).toBe('Raising to 2100 wins more here. · You had >99%, needed 30%.');
    // A check where the coach bets; Good keeps "Coach: …" (the coach's move wins only a little).
    const checked = row({ taken: { type: 'check' }, rec: { type: 'bet', to: 220 }, need: null });
    expect(rowNotes({ ...checked, grade: 'inaccuracy' }, money)).toBe(
      'Betting 220 wins more here. · You had 45%.',
    );
    expect(rowNotes({ ...checked, grade: 'good' }, money)).toBe('Coach: Bet 220 · You had 45%.');
  });

  it('item 3: the hint’s number with the hint’s words, from the record (seed 5eed2103)', () => {
    // The hint said "All 3 players: 34%. Raiser alone: about 56%."; the summary said "Their
    // likely hands: about 33%, needed 33%." (the grade's own number, against all three).
    const alone = row({
      taken: CALL,
      rec: CALL,
      grade: 'best',
      eRandom: 0.34,
      eRange: 0.56,
      R: 0.95,
      need: 0.33,
      callers: 0,
      players: 3,
    });
    expect(rowNotes(alone, money)).toBe('All 3 players: 34%. Raiser alone: about 56%, needed 33%.');
    // The raiser and a caller already in; a fold that later bets explain.
    const callers = row({
      taken: FOLD,
      rec: FOLD,
      grade: 'best',
      eRandom: 0.28,
      eRange: 0.34,
      R: 0.7,
      need: 0.25,
      callers: 1,
      players: 3,
    });
    expect(rowNotes(callers, money)).toBe(
      'All 3 players: 28%. Raiser + 1 caller: about 34%, needed 25%. Counting later bets: about 24%.',
    );
    // Heads-up: "Their likely hands", as the strip says it.
    expect(
      rowNotes({ ...alone, callers: null, players: 1, eRandom: 0.67, eRange: 0.54 }, money),
    ).toBe('Any cards: 67%. Their likely hands: about 54%, needed 33%.');
  });

  it('item 6: an all-in says all-in, as the action bar does (seed 5eed2102, hand 2)', () => {
    // "Coach: Raise to 200" when 200 was the hero's whole stack.
    const shove: PlayerAction = { type: 'raise', to: 200 };
    const r = row({
      street: 'preflop',
      taken: FOLD,
      rec: shove,
      grade: 'inaccuracy',
      eRandom: 0.55,
      need: 0.25,
      eRange: 0.5555,
      R: 0.95,
      allInTo: 200,
    });
    expect(rowNotes(r, money)).toBe('Coach: All-in 200 · You had 55%, needed 25%.');
    expect(rowDid({ ...r, taken: shove }, money)).toBe('You went all-in for 200');
    expect(rowDid({ ...r, taken: { type: 'raise', to: 150 } }, money)).toBe('You raised to 150');
    expect(rowNotes({ ...r, taken: shove, rec: FOLD, grade: 'best' }, money)).toMatch(
      /^Going all-in for 200 was as good as folding here\./,
    );
    // A call that puts the hero all-in.
    const allInCall = row({ taken: CALL, rec: FOLD, callAllIn: true, grade: 'mistake' });
    expect(rowDid(allInCall, money)).toBe('You called all-in');
    expect(rowNotes({ ...allInCall, taken: FOLD, rec: CALL }, money)).toMatch(
      /^Coach: Call all-in · /,
    );
    // Older records (no `allInTo`): as before.
    expect(rowNotes({ ...r, allInTo: null }, money)).toMatch(/^Coach: Raise to 200 · /);
  });

  it('item 8: a bound needs no "about": "Their likely hands: >99%"', () => {
    const r = row({ rec: CALL, taken: FOLD, eRandom: 0.9, eRange: 0.999, R: 1, need: 0.3 });
    expect(rowNotes(r, money)).toBe(
      'Coach: Call · Any cards: 90%. Their likely hands: >99%, needed 30%.',
    );
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
    expect(record).toMatchObject({
      eRange: price.E,
      R: price.R,
      callers: price.callers,
      players: price.players,
    });
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
