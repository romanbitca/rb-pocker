import type { Page } from '@playwright/test';
import { RANKINGS } from '../../src/data/rankings.ts';
import { expect, test } from './fixtures.ts';
import {
  collectErrors,
  newTable,
  openApp,
  pcState,
  playHands,
  sizeOf,
  slot,
  tapNextHand,
} from './game.ts';
import {
  feedbackCard,
  gameMode,
  type Level,
  pauseClock,
  playTo,
  scriptedTable,
  TAP_GUARD_MS,
} from './scripted.ts';

// PLAN §18 Stage 6, acceptance 5 (chunk 6.5; §10.2, §10.3): the level matrix. For each of the four
// coach levels the elements on the page match the §10.2 table, and the Advanced quiz fires on about
// 1 in 4 eligible decisions and hides the badge and the price chip while it asks.
//
// The matrix plays hand 1 of the scripted table of `scripted.ts` (`?seed=46&script=river-min-bet`,
// 3 players) once per level, the same moves at every level: check before the flop, check on the flop
// and the turn, fold the nut flush to the minimum bet on the river. The flop and the turn show a nut
// flush draw with a gutshot (draw chips), the river a bet to face (price chip). At each hero
// decision the expected page is written out below, level by level, from the §10.2 table (not read
// from `LEVEL_RULES`, which the unit test holds against the same table). A grade's own value is the
// coach's (the unit tests fix it); what the matrix checks is what each level makes of it: the
// chip from which grade, the card (the pause) from which grade, the toolbar Undo, the summary.
// One phone and one desktop size per browser (the rankings are a drawer and a column).

const GRADES = ['best', 'good', 'inaccuracy', 'mistake', 'blunder'] as const;
type Grade = (typeof GRADES)[number];

/** §10.2 "Grade chip after you act": from which grade the chip shows (null: none in the hand). */
const CHIP_FROM: Record<Level, Grade | null> = {
  beginner: 'best',
  intermediate: 'inaccuracy',
  advanced: 'mistake',
  exam: null,
};

/** §10.2 "Pause + Undo offer": from which grade the feedback card pauses the game. */
const PAUSE_FROM: Record<Level, Grade | null> = {
  beginner: 'inaccuracy',
  intermediate: 'mistake',
  advanced: 'mistake',
  exam: null,
};

const reaches = (grade: string | null, from: Grade | null): boolean =>
  from !== null && grade !== null && GRADES.indexOf(grade as Grade) >= GRADES.indexOf(from);

const CHIP_WORDS: Record<Grade, string> = {
  best: 'Best move',
  good: 'Good',
  inaccuracy: 'Slightly off',
  mistake: 'Mistake',
  blunder: 'Big mistake',
};

/** §14.4 decision score points. */
const POINTS: Record<Grade, number> = {
  best: 100,
  good: 90,
  inaccuracy: 60,
  mistake: 25,
  blunder: 0,
};

// ---------------------------------------------------------------------------------------------
// What is on the page

interface Hud {
  /** The coach strip's state: 'advice' (the hint on show), 'hint' (a Hint button), … */
  strip: string | null;
  /** The Hint button's words. */
  hintButton: string | null;
  /** A Row A button carries the accent ring and the "Coach" badge. */
  ring: boolean;
  badge: boolean;
  priceChip: boolean;
  handLabel: boolean;
  /** Draw chips: outs and % ('full'), the name only ('name'), or none. */
  draws: 'none' | 'full' | 'name';
  /** The toolbar Undo: not on the page ('hidden'), or disabled or enabled. */
  undo: 'hidden' | 'disabled' | 'enabled';
  chip: string | null;
  quiz: boolean;
}

/** In the page. */
function readHud(): Hud {
  const draws = document.querySelector('[data-draw-chips]');
  const undo = document.querySelector('[data-undo]');
  return {
    strip: document.querySelector('[data-coach-strip]')?.getAttribute('data-coach-strip') ?? null,
    hintButton: document.querySelector('[data-coach-hint]')?.textContent?.trim() ?? null,
    ring: document.querySelector('[data-slot][data-coach]') !== null,
    badge: document.querySelector('[data-win-badge]') !== null,
    priceChip: document.querySelector('[data-price-chip]') !== null,
    handLabel: (document.querySelector('[data-hero-label]')?.textContent ?? '').trim() !== '',
    draws: draws === null ? 'none' : /%/.test(draws.textContent ?? '') ? 'full' : 'name',
    undo: undo === null ? 'hidden' : (undo.getAttribute('data-undo') as 'disabled' | 'enabled'),
    chip: document.querySelector('[data-grade-chip]')?.getAttribute('data-grade-chip') ?? null,
    quiz: document.querySelector('[data-quiz]') !== null,
  };
}

async function expectHud(page: Page, expected: Hud, what: string): Promise<void> {
  await expect
    .poll(() => page.evaluate(readHud), { message: what, timeout: 10_000 })
    .toEqual(expected);
}

/** The base of every decision: what the level does not change. */
const NONE: Hud = {
  strip: null,
  hintButton: null,
  ring: false,
  badge: false,
  priceChip: false,
  handLabel: true,
  draws: 'none',
  undo: 'hidden',
  chip: null,
  quiz: false,
};

/** §10.2 rows "Hint before you act", "Win chance badge", "Draw chips", "Toolbar Undo". */
const FLOP: Record<Level, Hud> = {
  beginner: {
    ...NONE,
    strip: 'advice', // always open in the coach strip...
    ring: true, // ...and the recommended button has the ring and the "Coach" badge
    badge: true,
    draws: 'full',
    undo: 'disabled', // nothing to take back at a new decision
  },
  intermediate: {
    ...NONE,
    strip: 'hint',
    hintButton: 'Hint',
    badge: true,
    draws: 'full',
    undo: 'disabled',
  },
  advanced: {
    ...NONE,
    strip: 'hint',
    hintButton: 'Hint',
    badge: true,
    draws: 'full',
    undo: 'hidden', // offered only inside the feedback card
  },
  exam: {
    ...NONE,
    strip: 'hint',
    hintButton: 'Hint (counts as help)',
    badge: false, // hidden while you decide
    draws: 'name', // names only
    undo: 'hidden',
  },
};

/** The same decision after the Hint button was tapped (Intermediate, Advanced, Exam). */
const AFTER_HINT: Record<Level, Hud> = {
  beginner: FLOP.beginner,
  intermediate: { ...FLOP.intermediate, strip: 'advice', hintButton: null, ring: true },
  advanced: { ...FLOP.advanced, strip: 'advice', hintButton: null, ring: true },
  exam: { ...FLOP.exam, strip: 'advice', hintButton: null, ring: true },
};

/** The river: a bet to face (the price chip, where the level shows it), no draws left. */
const RIVER: Record<Level, Hud> = {
  beginner: { ...FLOP.beginner, priceChip: true, draws: 'none' },
  intermediate: { ...FLOP.intermediate, priceChip: true, draws: 'none' },
  advanced: { ...FLOP.advanced, draws: 'none' }, // "In Why? only"
  exam: { ...FLOP.exam, draws: 'none' }, // hidden
};

interface RankingsView {
  rows: number;
  /** How many of the ten one-line tips are on show. */
  tips: number;
  byRiver: number;
  whichWins: boolean;
}

/** §10.2 row "Rankings panel". */
const RANKINGS_AT: Record<Level, RankingsView> = {
  beginner: { rows: 10, tips: 10, byRiver: 10, whichWins: false },
  intermediate: { rows: 10, tips: 0, byRiver: 10, whichWins: false }, // tips collapsed
  advanced: { rows: 10, tips: 0, byRiver: 10, whichWins: true },
  exam: { rows: 10, tips: 0, byRiver: 0, whichWins: true }, // no By-river column
};

/** The rankings panel as the layout has it: the wide column, or the drawer (opened, read, closed). */
async function readRankings(page: Page): Promise<RankingsView> {
  const wide = (await page.locator('main[data-layout="wide"]').count()) > 0;
  const panel = wide
    ? page.getByRole('complementary', { name: /Poker hands/ })
    : page.getByRole('dialog', { name: /Poker hands/ });
  if (!wide) {
    await page.locator('header').getByRole('button', { name: 'Show all poker hands' }).click();
  }
  await expect(panel).toBeVisible();
  const view = await panel.evaluate(
    (el, tips) => ({
      rows: el.querySelectorAll('[data-category]').length,
      tips: tips.filter((tip) => (el.textContent ?? '').includes(tip)).length,
      byRiver: el.querySelectorAll('[data-by-river]').length,
      whichWins: el.querySelector('[data-which-wins-open]') !== null,
    }),
    RANKINGS.map((row) => row.tip),
  );
  if (view.whichWins) {
    // The button opens the quiz in place (a lazy chunk) with hands to choose from. A lazy chunk
    // shows on the paused clock only once it has moved (React's Suspense reveal waits on a timer).
    await panel.locator('[data-which-wins-open]').click();
    const quiz = panel.locator('[data-which-wins]');
    await expect
      .poll(
        async () => {
          if ((await quiz.count()) === 0) await page.clock.runFor(50);
          return quiz.count();
        },
        { timeout: 10_000 },
      )
      .toBe(1);
    expect(await panel.locator('[data-which-hand]').count()).toBeGreaterThanOrEqual(2);
  }
  if (!wide) {
    await panel.locator('button[aria-label="Close"]').click(); // the drawer's, not the quiz's
    await expect(panel).toHaveCount(0);
  }
  return view;
}

// ---------------------------------------------------------------------------------------------
// Playing the hand

const decisions = (page: Page) => pcState(page).then((s) => s.game.decisions);

/**
 * The hero acts with the clock paused (a tap on `name`), and the page is checked against the
 * level's rules for the grade that comes: the chip, the card, the toolbar Undo. Returns the grade.
 */
async function act(page: Page, level: Level, name: 'middle' | 'fold'): Promise<string | null> {
  const before = (await decisions(page)).length;
  await page.clock.runFor(TAP_GUARD_MS + 50);
  await slot(page, name).click();
  await expect
    .poll(async () => (await decisions(page)).length, { timeout: 15_000 })
    .toBe(before + 1);
  const grade = (await decisions(page)).at(-1)?.grade ?? null;
  expect(grade, 'the real coach grades every decision').not.toBeNull();

  // The pause (§10.2 "Pause + Undo offer"): the card from this grade on, at this level.
  const card = reaches(grade, PAUSE_FROM[level]);
  if (card) {
    const dialog = await feedbackCard(page);
    await expect(dialog).toHaveAttribute('data-feedback', grade as string);
    const undo = dialog.getByRole('button', { name: 'Undo: try again' });
    await expect(undo).not.toHaveAttribute('aria-disabled', 'true');
    // The chip (below) is the strip's, under the card.
    await expectChip(page, level, grade);
    await dialog.getByRole('button', { name: 'Keep my move' }).click();
    await expect(dialog).toHaveCount(0);
  } else {
    expect(await gameMode(page), 'no pause below the level’s grade').not.toBe('feedback');
    await expect(page.locator('[data-feedback]')).toHaveCount(0);
    await expectChip(page, level, grade);
  }
  // The toolbar Undo (§10.2): there at Beginner and Intermediate, nothing at Advanced and Exam.
  const undoState = level === 'beginner' || level === 'intermediate' ? 'enabled' : 'hidden';
  await expect.poll(async () => (await page.evaluate(readHud)).undo).toBe(undoState);
  return grade;
}

/** The grade chip (§10.2 "Grade chip after you act"): from the level's grade on, with its words. */
async function expectChip(page: Page, level: Level, grade: string | null): Promise<void> {
  const shown = reaches(grade, CHIP_FROM[level]);
  await expect
    .poll(async () => (await page.evaluate(readHud)).chip, { message: `the chip for ${grade}` })
    .toBe(shown ? grade : null);
  if (shown) {
    await expect(page.locator('[data-grade-chip]')).toHaveText(CHIP_WORDS[grade as Grade]);
  }
}

/** Resumes the clock, plays on to the hero's turn on `street`, and stops the clock again. */
async function toStreet(page: Page, street: 'turn' | 'river'): Promise<void> {
  await page.clock.resume();
  await playTo(page, street);
  await pauseClock(page);
}

const LEVELS: readonly Level[] = ['beginner', 'intermediate', 'advanced', 'exam'];

test.describe('Stage 6 acceptance 5: the level matrix (§10.2)', () => {
  for (const level of LEVELS) {
    test(`${level}: the hint, the badge, the price chip, the draw chips, the rankings, the chips, the cards, Undo and the summary`, async ({
      page,
    }, testInfo) => {
      test.skip(
        !['390x844', '1280x800'].includes(sizeOf(testInfo)),
        'one phone and one desktop size per browser',
      );
      test.setTimeout(120_000);
      const errors = collectErrors(page);
      await scriptedTable(page, level);
      await playTo(page, 'flop'); // before the flop: check
      await pauseClock(page);

      // The flop: the nut flush draw and the gutshot, no bet to face.
      await expectHud(page, FLOP[level], `${level}: the flop`);
      expect(await readRankings(page), `${level}: the rankings panel`).toEqual(RANKINGS_AT[level]);
      await expectHud(page, FLOP[level], `${level}: the flop, after the rankings`);
      const grades = [(await decisions(page)).at(-1)?.grade ?? null];
      grades.push(await act(page, level, 'middle'));

      // The turn: the hint, opened above Beginner (it counts as help there, §10.2).
      await toStreet(page, 'turn');
      await expectHud(page, FLOP[level], `${level}: the turn`);
      if (level !== 'beginner') {
        await page.locator('[data-coach-hint]').click();
        await expectHud(page, AFTER_HINT[level], `${level}: the turn, after Hint`);
      }
      grades.push(await act(page, level, 'middle'));

      // The river: a bet to face. Folding the nut flush is a Mistake or worse at every level.
      await toStreet(page, 'river');
      await expectHud(page, RIVER[level], `${level}: the river`);
      const fold = await act(page, level, 'fold');
      grades.push(fold);
      expect(['mistake', 'blunder']).toContain(fold);

      // §10.2 "Counts as on your own": never at Beginner (the hint was on show), else only where
      // the hint was opened (the turn).
      const seen = (await decisions(page)).map((d) => d.hintSeen);
      expect(seen).toEqual(
        level === 'beginner' ? [true, true, true, true] : [false, false, true, false],
      );

      // The hand ends: the summary (§10.2 "End-of-hand summary"): every level shows one here (the
      // river fold is a Mistake), Exam's is the "Exam result" with the score and the win chance.
      await page.clock.resume();
      await expect.poll(() => gameMode(page), { timeout: 30_000 }).toBe('handEnd');
      const summary = page.locator('[data-summary]');
      await expect(summary).toHaveAttribute('data-summary', level === 'exam' ? 'exam' : 'hand');
      const rows = summary.locator('[data-summary-row]');
      await expect(rows).toHaveCount(4);
      expect(
        await rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-summary-row'))),
      ).toEqual(grades);
      await expect(summary.getByRole('heading', { level: 2 })).toContainText(
        /^(Exam result)?Hand 1: /,
      );
      if (level === 'exam') {
        await expect(summary).toContainText('Exam result');
        const mean = grades.reduce((sum, g) => sum + POINTS[g as Grade], 0) / grades.length;
        await expect(summary).toContainText(`Your score: ${Math.round(mean)} of 100`);
        // The win chance appears here first: hidden while the hero decided.
        await expect(summary).toContainText(/You had \d+%/);
      } else {
        await expect(summary).not.toContainText('Exam result');
        await expect(summary).toContainText(/You had \d+%, needed \d+%/); // the river
      }
      await expect(summary.getByRole('button', { name: 'Review hand' })).toBeVisible();
      await tapNextHand(page);
      expect(errors).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------------------------
// The Advanced quiz (§10.3): which decisions roll one is `fnv1a32('quiz|' + observationKey) % 4 ===
// 0` where the pot is at least 10 big blinds, so it is a fixed function of the game. The spec plays
// real hands at Advanced against the real bots with a hero who checks and calls everything (the
// same game every run: the bots and the deck are seeded), reads at each hero decision whether the
// controller rolled a quiz (`coach.quiz`) and whether the pot was 10 bb or more, and checks the
// rate. The first decisions that roll one are also looked at on the page: the quiz is up, and the
// badge and the price chip are gone until it is answered or skipped (Skip is tapped by the flow
// helper). The exact rate over thousands of decisions is tests/app/quiz.test.ts (21.5-28.5%).

const QUIZ_SEED = '9f3a51c0de';
const QUIZ_HANDS = 40;

interface Sample {
  key: string;
  /** Σ of the seats' bets: `observe().pot`. */
  pot: number;
  bb: number;
  /** The controller rolled a quiz for this decision. */
  rolled: boolean;
}

/** In the page: the hero's decision, once its hint has landed (the quiz is rolled with the hint job). */
function readDecision(): Sample | null {
  const s = window.__pc?.state();
  const hand = s?.game.hand;
  if (s === undefined || hand === null || hand === undefined || s.game.mode !== 'heroTurn') {
    return null;
  }
  const key = `${hand.handSeq}:${hand.log.length}`;
  if (s.coach.key !== key || s.coach.status === 'idle') return null;
  return {
    key,
    pot: hand.seats.reduce((sum, seat) => sum + seat.totalBet, 0),
    bb: hand.bb,
    rolled: s.coach.quiz !== null && s.coach.quiz.key === key,
  };
}

test.describe('Stage 6 acceptance 5: the Advanced quiz (§10.3)', () => {
  test('fires on about 1 in 4 decisions with a pot of 10 bb or more, never under, and hides the badge and the price chip', async ({
    page,
  }, testInfo) => {
    test.skip(
      sizeOf(testInfo) !== '1280x800',
      'the game is the same at every size: one desktop size',
    );
    test.setTimeout(240_000);
    const errors = collectErrors(page);
    await page.clock.install();
    await openApp(page, QUIZ_SEED);
    await page.evaluate(() => {
      window.__pc?.dispatch({ type: 'settings', patch: { coachLevel: 'advanced' } });
    });
    await newTable(page, { players: 6 });

    const samples = new Map<string, Sample>();
    let looked = 0;
    const hands = await playHands(page, {
      hands: QUIZ_HANDS,
      random: () => 0.5, // always check or call
      fast: true,
      beforeHeroAct: async () => {
        const handle = await page.waitForFunction(readDecision, undefined, { timeout: 15_000 });
        const sample = (await handle.jsonValue()) as Sample;
        if (samples.has(sample.key)) return;
        samples.set(sample.key, sample);
        if (!sample.rolled || looked >= 3) return;
        // The quiz is on the page (its code is a lazy chunk): the badge and the price chip are not.
        looked++;
        await page.waitForSelector('[data-quiz]', { timeout: 15_000 });
        const hud = await page.evaluate(readHud);
        expect(hud, `a quiz at ${sample.key}`).toMatchObject({
          quiz: true,
          badge: false,
          priceChip: false,
          handLabel: true,
        });
      },
    });
    expect(hands).toHaveLength(QUIZ_HANDS);

    const all = [...samples.values()];
    const eligible = all.filter((s) => s.pot >= 10 * s.bb);
    const fired = eligible.filter((s) => s.rolled).length;
    // Never under 10 bb (§10.3).
    expect(all.filter((s) => s.pot < 10 * s.bb && s.rolled)).toEqual([]);
    console.info(`quiz: ${fired} of ${eligible.length} eligible decisions (${all.length} in all)`);
    testInfo.annotations.push({
      type: 'quiz rate',
      description: `${fired} of ${eligible.length} decisions with a pot of 10 bb or more`,
    });
    expect(eligible.length, 'enough decisions to tell a rate').toBeGreaterThanOrEqual(60);
    // 1 in 4: a binomial count of n at p = 1/4 has σ = √(n · 3/16); the band is ±3.5 σ.
    const n = eligible.length;
    const sigma = Math.sqrt(n * (3 / 16));
    expect(fired).toBeGreaterThan(n / 4 - 3.5 * sigma);
    expect(fired).toBeLessThan(n / 4 + 3.5 * sigma);
    expect(looked, 'the page showed a quiz').toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });
});
