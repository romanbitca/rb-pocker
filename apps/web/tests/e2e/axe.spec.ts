import { AxeBuilder } from '@axe-core/playwright';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import {
  closeSummary,
  collectErrors,
  keepMove,
  newTable,
  nextFlowPoint,
  openApp,
  openSummary,
  pcState,
  playHands,
  prng,
  seedFor,
  sizeOf,
  slot,
  tapNextHand,
} from './game.ts';
import { feedbackCard, nextPoint, pauseClock, playTo, scriptedTable, tapAct } from './scripted.ts';

// PLAN §18 Stage 9, acceptance 1 (the axe part; chunk 9.6): "zero serious or critical violations
// on every screen and sheet". axe-core (`@axe-core/playwright`, the WCAG 2.1 A and AA rules) runs on
// every screen and on every sheet, dialog and overlay, at one phone size and one desktop size, in
// Chromium and WebKit. A serious or critical violation fails the test; moderate and minor ones are
// printed (and attached to the report), so they stay visible without blocking.

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const SIZES = ['390x844', '1280x800'];

interface Finding {
  state: string;
  rule: string;
  impact: string;
  help: string;
  nodes: string[];
}

/**
 * Runs axe on each state the test reaches (`check`), keeps every violation, and at the end (`done`)
 * prints the moderate and minor ones and fails on any serious or critical one, all states at once.
 */
class Audit {
  readonly findings: Finding[] = [];
  readonly states: string[] = [];
  private readonly page: Page;
  private readonly testInfo: TestInfo;

  constructor(page: Page, testInfo: TestInfo) {
    this.page = page;
    this.testInfo = testInfo;
  }

  /**
   * axe on the page as it is now. Finite animations end first (a sheet that still fades in would
   * fail the contrast rule). `clockPaused`: the test paused the page's fake clock
   * (`page.clock.pauseAt`), and axe waits for a 0 ms timer after each rule, so the clock is moved
   * on 1 ms at a time while axe runs (nothing else is due that soon).
   */
  async check(state: string, options: { clockPaused?: boolean } = {}): Promise<void> {
    await settle(this.page);
    // Legacy mode runs axe in the page itself (there are no frames), not in an extra blank page.
    const run = new AxeBuilder({ page: this.page }).withTags(TAGS).setLegacyMode().analyze();
    if (options.clockPaused === true) {
      let finished = false;
      const ended = run.finally(() => {
        finished = true;
      });
      while (!finished) await this.page.clock.runFor(1);
      await ended;
    }
    const results = await run;
    this.states.push(state);
    for (const v of results.violations) {
      this.findings.push({
        state,
        rule: v.id,
        impact: v.impact ?? 'minor',
        help: v.help,
        nodes: v.nodes.map((n) => `${n.target.join(' ')}: ${n.failureSummary ?? ''}`),
      });
    }
  }

  /** Prints the moderate and minor findings; fails on the serious and critical ones. */
  async done(): Promise<void> {
    const line = (f: Finding) =>
      `[${f.impact}] ${f.state}: ${f.rule} (${f.help})\n${f.nodes.map((n) => `    ${n}`).join('\n')}`;
    const blocking = this.findings.filter((f) => f.impact === 'serious' || f.impact === 'critical');
    const other = this.findings.filter((f) => !blocking.includes(f));
    if (other.length > 0) console.log(`axe, not blocking:\n${other.map(line).join('\n')}`);
    await this.testInfo.attach('axe-findings.json', {
      body: JSON.stringify({ states: this.states, findings: this.findings }, null, 2),
      contentType: 'application/json',
    });
    expect(blocking.map(line), 'axe: serious or critical violations').toEqual([]);
  }
}

/**
 * Waits until every finite CSS animation and transition on the page has finished (at most 3 s, on
 * the test's own clock: the page's may be a paused fake one).
 */
async function settle(page: Page): Promise<void> {
  const finished = page
    .evaluate(async () => {
      const finite = document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().endTime !== Infinity);
      await Promise.all(finite.map((a) => a.finished.catch(() => undefined)));
    })
    .catch(() => undefined); // a page closed while it waited: nothing left to settle
  await Promise.race([finished, new Promise((resolve) => setTimeout(resolve, 3_000))]);
}

const heading = (page: Page): Locator => page.getByRole('heading', { level: 1 });
const button = (page: Page, name: string | RegExp): Locator =>
  page.getByRole('button', { name, exact: typeof name === 'string' });

/** Answers the drill's question on show (any answer): the feedback shows. */
async function answerDrill(page: Page): Promise<void> {
  const options = page.locator('[data-option]');
  if ((await options.count()) > 0) {
    await options.first().click();
  } else {
    const names = page.locator('[data-name]');
    if ((await names.count()) > 0) await names.nth(3).click();
    const positions = page.locator('[data-position="5"]');
    if ((await positions.count()) > 0) await positions.click();
  }
  await expect(page.locator('[data-feedback]')).toHaveAttribute('data-feedback', /^(right|wrong)$/);
}

test.describe('axe', () => {
  // eslint-disable-next-line no-empty-pattern -- Playwright reads the fixtures from this pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(!SIZES.includes(sizeOf(testInfo)), 'one phone and one desktop size per browser');
  });

  test('the pages: Welcome, Setup, Home, Settings, About, Learn and the hand drill', async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    const errors = collectErrors(page);
    const audit = new Audit(page, testInfo);
    await openApp(page, seedFor(testInfo, 'axe-pages'));

    // The audit is not blind: a button without a name is a critical violation (button-name).
    await expect(button(page, 'Play')).toBeVisible();
    await page.evaluate(() => {
      const canary = document.createElement('button');
      canary.id = 'axe-canary';
      document.body.append(canary);
    });
    const canary = new Audit(page, testInfo);
    await canary.check('Welcome with a nameless button');
    expect(canary.findings.map((f) => `${f.rule} ${f.impact}`)).toContain('button-name critical');
    await page.evaluate(() => document.getElementById('axe-canary')?.remove());

    // Welcome (the first launch), and its 1-minute guide (Learn's lesson 1).
    await audit.check('Welcome');
    await button(page, 'New to poker? 1-minute guide').click();
    await expect(heading(page)).toHaveText('The goal');
    await audit.check('Learn: lesson 1, from Welcome');
    await button(page, 'Back').click();

    // Setup, with More options open and a custom amount out of range.
    await button(page, 'Choose players, chips and levels').click();
    await expect(heading(page)).toHaveText('Set up your table');
    await audit.check('Setup');
    await button(page, 'More options').click();
    await expect(button(page, 'More options')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('group', { name: "Set each bot's level" })).toBeVisible();
    await audit.check('Setup: More options');
    const chips = page.getByRole('group', { name: 'Starting chips' });
    await chips.locator('label', { hasText: 'Custom' }).click();
    await chips.getByRole('textbox', { name: 'Starting chips' }).fill('50');
    await audit.check('Setup: a custom amount out of range');
    await chips.getByRole('textbox', { name: 'Starting chips' }).fill('2000');

    // Play once (a profile is stored), then a later launch: Home with the session line.
    await button(page, 'Start game').click();
    await page.waitForFunction(() => window.__pc?.state().ui.screen === 'table');
    await page.waitForFunction(() => localStorage.getItem('pc.v1.profile') !== null);
    await page.goto('/');
    await page.waitForFunction(() => window.__pc?.state().ui.screen === 'home');
    await expect(button(page, 'Play')).toBeVisible();
    await audit.check('Home');

    // Settings: one page with every section (Game, Display, Sound, Data, Diagnostics), and its
    // last row, About (chunk 9.2c: its own lazy page).
    await button(page, 'Settings').click();
    await expect(heading(page)).toHaveText('Settings');
    await expect(page.getByRole('heading', { name: 'Data', level: 2 })).toBeVisible();
    await audit.check('Settings');
    await button(page, 'About').click();
    await expect(heading(page)).toHaveText('About');
    await expect(page.getByRole('heading', { name: 'Privacy', level: 2 })).toBeVisible();
    await audit.check('About');
    await button(page, 'Back').click();
    await expect(heading(page)).toHaveText('Settings');
    await button(page, 'Back').click();

    // Learn: the list, a lesson, the poker hands (a row open, "Which hand wins?"), the glossary.
    await button(page, 'Learn').click();
    await expect(heading(page)).toHaveText('Learn');
    await audit.check('Learn: the list');
    await button(page, 'Lesson 4: Which hand wins').click();
    await expect(heading(page)).toHaveText('Which hand wins');
    await audit.check('Learn: lesson 4');
    await button(page, 'See all poker hands').click();
    await expect(heading(page)).toHaveText('Poker hands');
    await page.locator('li[data-category]').nth(3).getByRole('button').click();
    await audit.check('Learn: poker hands, a row open');
    await button(page, 'Which hand wins?').click();
    const quiz = page.getByRole('region', { name: 'Which hand wins?' });
    await quiz
      .getByRole('button', { name: /^(First|Second) hand:/ })
      .first()
      .click();
    await expect(quiz.getByRole('status')).not.toHaveText('');
    await audit.check('Learn: which hand wins, answered');
    await button(page, 'Back').click();
    await button(page, 'Back').click();
    await expect(heading(page)).toHaveText('Learn');
    await button(page, /^Glossary/).click();
    await expect(heading(page)).toHaveText('Glossary');
    await audit.check('Learn: glossary');
    await page.getByRole('searchbox', { name: 'Find a word' }).fill('kicker');
    await expect(page.locator('main').getByRole('status')).toHaveText('1 word');
    await audit.check('Learn: glossary, a search');
    await button(page, 'Back').click();
    await button(page, 'Back').click();

    // The hand drill: a question, its answer, the game sheet, the other game, the stats sheet and
    // its "All hands" drawer.
    await button(page, 'Hand drill').click();
    await expect(heading(page)).toHaveText('Hand drill');
    await expect(page.locator('[data-question]')).toHaveCount(1);
    await audit.check('Drill: a question');
    await answerDrill(page);
    await audit.check('Drill: answered');
    await page.locator('[data-drill-games]').click();
    await expect(page.getByRole('dialog', { name: 'Choose a game' })).toBeVisible();
    await audit.check('Drill: choose a game');
    await page.locator('[data-game="versus"]').click();
    await expect(page.locator('[data-question="versus"]')).toHaveCount(1);
    await audit.check('Drill: which wins');
    await page.locator('[data-drill-stats]').click();
    await expect(page.getByRole('dialog', { name: 'Your stats' })).toBeVisible();
    await audit.check('Drill: your stats');
    await page.keyboard.press('Escape');
    await page.locator('[data-drill-hands]').click();
    await expect(page.getByRole('dialog', { name: /Poker hands/ })).toBeVisible();
    await audit.check('Drill: all hands');
    await page.keyboard.press('Escape');

    await audit.done();
    expect(errors).toEqual([]);
  });

  test("the table: the hero's turn, its sheets and dialogs, a mistake, the hand end, Review", async ({
    page,
  }, testInfo) => {
    test.setTimeout(240_000);
    const errors = collectErrors(page);
    const audit = new Audit(page, testInfo);
    // `?seed=46&script=river-min-bet` at Beginner (scripted.ts): the hero folds the nut flush on the
    // river (a mistake: the feedback card), takes it back (a toast) and calls.
    await scriptedTable(page, 'beginner');
    const wide = (await pcState(page)).ui.layout === 'wide';
    expect(await nextPoint(page)).toBe('hero');
    await audit.check("Table: the hero's turn");

    // The coach: its sheet on a phone (the wide screen shows it inline, audited above).
    if (!wide) {
      await page.locator('button[data-coach-advice]').click();
      await expect(page.locator('[data-coach-sheet]')).toBeVisible();
      await audit.check('Table: the coach sheet');
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-coach-sheet]')).toHaveCount(0);
    }

    // The sizing tray.
    await slot(page, 'right').click();
    await expect(slot(page, 'right')).toHaveAttribute('aria-expanded', 'true');
    await audit.check('Table: the sizing tray');
    await page.goBack(); // Android Back closes the tray
    await expect(slot(page, 'right')).toHaveAttribute('aria-expanded', 'false');

    // The poker hands: the drawer on a phone; on a wide screen the column (audited above) folds
    // into its rail.
    if (wide) {
      await button(page, 'Hide the poker hands').first().click();
      const rail = page
        .getByRole('complementary', { name: /Poker hands/ })
        .getByRole('button', { name: 'Show all poker hands' });
      await expect(rail).toBeVisible();
      await audit.check('Table: the poker hands rail');
      await rail.click();
      await expect(button(page, 'Hide the poker hands').first()).toBeVisible();
    } else {
      await page.locator('header').getByRole('button', { name: 'Show all poker hands' }).click();
      await expect(page.getByRole('dialog', { name: /Poker hands/ })).toBeVisible();
      await audit.check('Table: the poker hands drawer');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name: /Poker hands/ })).toHaveCount(0);
    }

    // A bot's card, the Menu, the keyboard shortcuts.
    await page.locator('[data-seat="1"] > button').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await audit.check("Table: a bot's card");
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await button(page, 'Menu').click();
    await expect(button(page, 'Leave table')).toBeVisible();
    await audit.check('Table: the Menu');
    await page.keyboard.press('Escape');
    await expect(button(page, 'Leave table')).toHaveCount(0);
    await page.keyboard.press('?');
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
    await audit.check('Table: the keyboard shortcuts');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toHaveCount(0);

    // The river: the fold of the nut flush brings the feedback card; Undo brings a toast. The clock
    // is paused (scripted.ts), so the card comes in time and the toast stays.
    await playTo(page, 'river');
    await pauseClock(page);
    await slot(page, 'fold').click();
    const card = await feedbackCard(page);
    await audit.check('Table: the feedback card', { clockPaused: true });
    await card.getByRole('button', { name: 'Undo: try again' }).click();
    await expect(
      page.getByText('Move taken back. The unseen cards were shuffled again.'),
    ).toBeVisible();
    await audit.check('Table: a toast', { clockPaused: true });
    await page.clock.resume();

    // Call: the hand end. Beginner has a summary every hand, which the banner's "Hand summary"
    // opens (1.3.92: never by itself); then the banner, with that button.
    await tapAct(page, 'middle');
    for (let points = 0; points < 10; points++) {
      const point = await nextPoint(page);
      if (point === 'end') break;
      if (point === 'feedback') await keepMove(page);
      else await tapAct(page, 'middle');
    }
    await openSummary(page);
    await expect(page.locator('[data-summary-next]')).toBeVisible();
    await audit.check('Table: the hand summary');
    await closeSummary(page);
    await expect(page.locator('[data-hand-end]')).toBeVisible();
    await expect(page.locator('[data-hand-summary]')).toBeVisible();
    await audit.check('Table: the hand-end banner');

    // Review, and its shuffle check.
    await button(page, 'Review this hand').click();
    await expect(heading(page)).toHaveText(/^Hand \d+$/);
    await audit.check('Review');
    const row = page.getByRole('region', { name: 'Fair shuffle' });
    await row.getByRole('button', { name: 'Check the shuffle' }).click();
    await expect(
      row.getByText('The cards came from this shuffle. Nobody changed them.'),
    ).toBeVisible();
    await audit.check('Review: the shuffle checked');
    await button(page, 'Back').first().click();
    await expect(page.locator('[data-hand-end]')).toBeVisible();

    // The next hand; a new table while it runs asks first.
    await tapNextHand(page);
    expect(await nextPoint(page)).toBe('hero');
    await button(page, 'Menu').click();
    await button(page, 'New table').click();
    await button(page, 'Start game').click();
    const question = page.getByRole('alertdialog');
    await expect(question).toBeVisible();
    await audit.check('Dialog: start a new table?');
    await question.getByRole('button', { name: 'Cancel' }).click();
    await expect(question).toHaveCount(0);
    await button(page, 'Back').first().click();
    await expect(page.locator('main[data-layout]')).toBeVisible();

    // Leave table: Home, with the session's toast (the clock paused, so it stays).
    await button(page, 'Menu').click();
    await pauseClock(page);
    await button(page, 'Leave table').click();
    await expect(button(page, 'Play')).toBeVisible();
    await expect(page.getByText(/^This session: /)).toBeVisible();
    await audit.check('Home: the session toast', { clockPaused: true });
    await page.clock.resume();

    await audit.done();
    expect(errors).toEqual([]);
  });

  test('stats, the hand history and Review, and the data dialogs', async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    const errors = collectErrors(page);
    const audit = new Audit(page, testInfo);
    // A browser that cannot share files: Export falls back to a download (§14.8).
    await page.addInitScript(() => {
      delete (Navigator.prototype as { share?: unknown }).share;
      delete (Navigator.prototype as { canShare?: unknown }).canShare;
    });
    const seed = seedFor(testInfo, 'axe-stats');
    await openApp(page, seed);
    await newTable(page, { players: 4 });
    await playHands(page, { hands: 6, random: prng(seed) });
    await expect
      .poll(() =>
        pcState(page).then((s) =>
          s.stats === null ? 0 : s.stats.results.clean.hands + s.stats.results.practice.hands,
        ),
      )
      .toBeGreaterThanOrEqual(5);

    // Stats from the Menu: each of its four pages.
    if ((await pcState(page)).ui.overlays.includes('outOfChips')) {
      await page.getByRole('button', { name: /^Reload / }).click();
    }
    await button(page, 'Menu').click();
    await button(page, 'Stats').click();
    await expect(heading(page)).toHaveText('Stats');
    for (const tab of ['Progress', 'Results', 'Hands', 'History']) {
      const radio = page.getByRole('radio', { name: tab, exact: true });
      await radio.click();
      await expect(radio).toBeChecked();
      if (tab === 'History')
        await expect(page.locator('[data-history-hand]').first()).toBeVisible();
      else await expect(page.locator('[data-stats-empty]')).toHaveCount(0);
      await audit.check(`Stats: ${tab}`);
    }

    // History → a stored hand in Review.
    await page.locator('[data-history-hand]').last().click();
    await expect(page.locator('[data-review]')).toBeVisible();
    await audit.check('Review: a hand from History');
    await button(page, 'Back').first().click();
    await expect(page.locator('[data-stats]')).toBeVisible();
    await button(page, 'Back').first().click();

    // Settings → Data: Export (a download), Reset's question, Import's preview.
    await button(page, 'Menu').click();
    await button(page, 'Settings').click();
    await expect(heading(page)).toHaveText('Settings');
    await page.getByRole('heading', { name: 'Data', level: 2 }).scrollIntoViewIfNeeded();
    await page.waitForFunction(() =>
      performance.getEntriesByType('resource').some((r) => r.name.includes('/dataTools-')),
    );
    const downloading = page.waitForEvent('download');
    await button(page, 'Export').click();
    const download = await downloading;
    const file = testInfo.outputPath(download.suggestedFilename());
    await download.saveAs(file);
    await button(page, 'Reset stats').click();
    const reset = page.getByRole('alertdialog', { name: 'Delete your stats?' });
    await expect(reset).toBeVisible();
    await audit.check('Dialog: delete your stats?');
    await reset.getByRole('button', { name: 'Cancel' }).click();
    await expect(reset).toHaveCount(0);
    const choosing = page.waitForEvent('filechooser');
    await page
      .locator('label')
      .filter({ hasText: /^Import$/ })
      .click();
    await (await choosing).setFiles(file);
    const preview = page.getByRole('alertdialog', { name: 'Import stats' });
    await expect(preview.getByRole('button', { name: 'Replace' })).toBeVisible();
    await audit.check('Dialog: import stats');
    await preview.getByRole('button', { name: 'Cancel' }).click();
    await expect(preview).toHaveCount(0);

    await audit.done();
    expect(errors).toEqual([]);
  });

  test('all in: the run-out with its win chances, and the out-of-chips dialog', async ({
    page,
  }, testInfo) => {
    test.setTimeout(240_000);
    const errors = collectErrors(page);
    const audit = new Audit(page, testInfo);
    // The bots check and call (`?script=passive`): every shove is called and the cards run out.
    await openApp(page, seedFor(testInfo, 'axe-all-in'), '&script=passive');
    await newTable(page, { players: 3, speed: 'instant' });
    const speed = (value: string) =>
      page.evaluate((s) => window.__pc?.dispatch({ type: 'settings', patch: { speed: s } }), value);
    let runout = false;
    let bust = false;
    for (let hands = 0; hands < 20 && !bust; hands++) {
      const point = await nextFlowPoint(page);
      if (point === 'bust') {
        bust = true;
        break;
      }
      if (point === 'end') {
        await tapNextHand(page);
        continue;
      }
      // All in: the right button, its "All your chips" chip (or a one-tap All-in), then confirm,
      // at Normal speed so the run-out stays on screen.
      await speed('normal');
      const right = slot(page, 'right');
      await right.click();
      const trayId = await right.getAttribute('aria-controls');
      if (trayId !== null) {
        await page
          .locator(`[id="${trayId}"]`)
          .getByRole('button', { name: /^All your chips/ })
          .click();
        await right.click();
      }
      // The bars come with the run-out; a shove graded a mistake first shows its feedback card.
      for (let cards = 0; !runout && cards < 5; cards++) {
        const shown = await page
          .waitForFunction(
            () => {
              const g = window.__pc?.state().game;
              if (g === undefined) return null;
              if (g.mode === 'handEnd' || g.mode === 'heroTurn') return 'stop';
              if (g.mode === 'feedback') {
                return document.querySelector('[data-feedback-keep]') === null ? null : 'card';
              }
              return document.querySelector('[data-runout-seat]') === null ? null : 'runout';
            },
            undefined,
            { timeout: 30_000 },
          )
          .then((handle) => handle.jsonValue());
        if (shown === 'card') {
          await keepMove(page);
          continue;
        }
        if (shown === 'runout') {
          runout = true;
          await audit.check('Table: an all-in run-out');
        }
        break;
      }
      await speed('instant');
    }
    expect(runout, 'a run-out with its bars').toBe(true);
    expect(bust, 'the hero ran out of chips').toBe(true);
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await audit.check('Dialog: out of chips');

    await audit.done();
    expect(errors).toEqual([]);
  });

  test("the Advanced quiz, the level suggestion card, a read-only tab's banner", async ({
    page,
    context,
  }, testInfo) => {
    test.setTimeout(180_000);
    const errors = collectErrors(page);
    const audit = new Audit(page, testInfo);
    const seed = seedFor(testInfo, 'axe-quiz');
    // The Advanced quiz (§10.3) asks at about one hero decision in four once the pot is 10 big
    // blinds: the hero bets or raises the tray's third size and the bots call (`?script=passive`).
    await openApp(page, seed, '&script=passive');
    await page.evaluate(() =>
      window.__pc?.dispatch({ type: 'settings', patch: { coachLevel: 'advanced' } }),
    );
    await newTable(page, { players: 3, speed: 'instant' });
    let asked = false;
    for (let steps = 0; steps < 120 && !asked; steps++) {
      const point = await page
        .waitForFunction(
          () => {
            const s = window.__pc?.state();
            if (s === undefined) return null;
            if (document.querySelector('[data-quiz]:not([data-quiz="done"])') !== null) {
              return 'quiz';
            }
            if (s.ui.overlays.includes('outOfChips')) return 'bust';
            if (s.game.mode === 'feedback' && document.querySelector('[data-feedback-keep]')) {
              return 'card';
            }
            const hand = s.game.hand;
            const key = hand === null ? '' : `${hand.handSeq}:${hand.log.length}`;
            if (s.game.mode === 'heroTurn' && s.coach.status === 'ready' && s.coach.key === key) {
              // A quiz rolled for this decision shows once its chunk has drawn it.
              const quiz = s.coach.quiz;
              return quiz !== null && quiz.key === key && !quiz.skipped ? null : 'hero';
            }
            if (s.game.mode === 'handEnd') {
              const summary = s.ui.overlays.includes('summary');
              const tap = summary ? '[data-summary-next]' : '[data-hand-end]';
              return document.querySelector(tap) === null ? null : 'end';
            }
            return null;
          },
          undefined,
          { timeout: 20_000 },
        )
        .then((handle) => handle.jsonValue());
      if (point === 'quiz') asked = true;
      else if (point === 'card') await keepMove(page);
      else if (point === 'end') await tapNextHand(page);
      else if (point === 'bust') await page.getByRole('button', { name: /^Reload / }).click();
      else {
        const right = slot(page, 'right');
        const tray =
          (await right.count()) > 0 &&
          (await right.getAttribute('aria-disabled')) !== 'true' &&
          (await right.getAttribute('aria-expanded')) !== null;
        if (!tray) {
          await tapAct(page, 'middle');
          continue;
        }
        // A tap the bar ignores (its 250 ms guard) leaves the decision on: the loop comes back.
        await right.click();
        const trayId = await right.getAttribute('aria-controls');
        if (trayId === null) continue;
        const sizes = page.locator(`[id="${trayId}"] button[aria-pressed]:enabled`);
        const count = await sizes.count();
        if (count > 0) await sizes.nth(Math.min(2, count - 1)).click();
        await right.click();
      }
    }
    expect(asked, 'a quiz asked').toBe(true);
    await audit.check('Table: the Advanced quiz, a question');
    await page.locator('[data-quiz-choice]').first().click();
    await audit.check('Table: the Advanced quiz, an answer');

    // The level suggestion card (§10.4) on Stats → Progress, from a stored fixture (as
    // settingsData.spec.ts): 300 clean hands against Easy bots at +50 bb/100, score 90.
    await page.evaluate(() => {
      const profile = JSON.parse(localStorage.getItem('pc.v1.profile') as string) as {
        stats: { recentHands: unknown[]; results: { clean: { hands: number } } };
      };
      profile.stats.results.clean.hands = 300;
      profile.stats.recentHands = Array.from({ length: 300 }, () => ({
        botLevel: 'easy',
        coachLevel: 'beginner',
        assisted: false,
        netMilliBB: 500,
        scorePoints: 90,
        graded: 1,
      }));
      localStorage.setItem('pc.v1.profile', JSON.stringify(profile));
    });
    await openApp(page, seed);
    await button(page, 'Stats').click();
    await expect(
      page.getByRole('region', { name: 'You beat Easy bots. Try Medium?' }),
    ).toBeVisible();
    await audit.check('Stats: the level suggestion card');
    await button(page, 'Back').click();

    // A second tab: read-only, Home with its banner and "Play here" (§14.7).
    const other = await context.newPage();
    const otherAudit = new Audit(other, testInfo);
    await openApp(other, seed);
    await expect(other.getByRole('button', { name: 'Play here' })).toBeVisible();
    await otherAudit.check('Home: another tab has the game');

    await audit.done();
    await otherAudit.done();
    expect(errors).toEqual([]);
  });

  test('the storage banner, when the browser keeps nothing', async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const audit = new Audit(page, testInfo);
    // Every write fails, as in some private modes (§14.6): the banner comes with the first save.
    await page.addInitScript(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      };
    });
    await openApp(page, seedFor(testInfo, 'axe-storage'));
    await button(page, 'Play').click();
    await expect(
      page.getByRole('alert').filter({ hasText: /^Stats can't be saved/ }),
    ).toBeVisible();
    await audit.check('Table: the storage banner');

    await audit.done();
  });
});

test.describe('axe: the first-table tips', () => {
  test.use({ firstTableTips: true });
  // eslint-disable-next-line no-empty-pattern -- Playwright reads the fixtures from this pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(!SIZES.includes(sizeOf(testInfo)), 'one phone and one desktop size per browser');
  });

  test('the five tips, each where it shows', async ({ page }, testInfo) => {
    test.setTimeout(150_000);
    const errors = collectErrors(page);
    const audit = new Audit(page, testInfo);
    // As tips.spec.ts: the bots check and call, so a hand sees a flop (the gold edge's and the Hands
    // tab's tips), at the Normal speed (a tip waits until its moment has lasted 400 ms, §12.11).
    await openApp(page, seedFor(testInfo, 'axe-tips'), '&script=passive');
    await page.evaluate(() =>
      window.__pc?.dispatch({
        type: 'settings',
        patch: { players: 3, seatLevels: [null, null, null] },
      }),
    );
    await button(page, 'Play').click();
    const seen = new Set<string>();
    for (let steps = 0; seen.size < 5 && steps < 200; steps++) {
      const point = await page
        .waitForFunction(
          () => {
            const s = window.__pc?.state();
            if (s === undefined) return null;
            const tip = document.querySelector('[data-tip]');
            if (s.ui.overlays.includes('tip') && tip !== null) return tip.getAttribute('data-tip');
            if (s.ui.overlays.includes('outOfChips')) return 'bust';
            if (s.game.mode === 'feedback' && document.querySelector('[data-feedback-keep]')) {
              return 'card';
            }
            if (s.game.mode === 'handEnd') {
              const summary = s.ui.overlays.includes('summary');
              const tap = summary ? '[data-summary-next]' : '[data-hand-end]';
              return document.querySelector(tap) === null ? null : 'end';
            }
            if (s.game.mode === 'heroTurn') {
              // A reader waits for the hero turn's two tips before acting, and for the Hands tab's
              // when it is due at this turn (as tips.spec.ts): a tap on Row A just after a tip
              // showed closes it unseen, and the loop then waits for a tip that never comes.
              const tips = s.data.tips ?? {};
              const handsTabDue =
                tips['handsTab'] !== true && (s.game.hand?.board.length ?? 0) >= 3;
              return tips['heroStrip'] === true && tips['coachStrip'] === true && !handsTabDue
                ? 'hero'
                : null;
            }
            return null;
          },
          undefined,
          { timeout: 20_000 },
        )
        .then((handle) => handle.jsonValue());
      if (point === 'card') await keepMove(page);
      else if (point === 'end') await tapNextHand(page);
      else if (point === 'bust') await page.getByRole('button', { name: /^Reload / }).click();
      else if (point === 'hero') await tapAct(page, 'middle');
      else if (point !== null) {
        if (!seen.has(point)) {
          seen.add(point);
          await audit.check(`Table: the ${point} tip`);
        }
        await page.locator('[data-tip]').click();
        await page.waitForFunction(() => window.__pc?.state().ui.overlays.includes('tip') !== true);
      }
    }
    expect([...seen].sort()).toEqual(['bestFive', 'coachStrip', 'handsTab', 'heroStrip', 'undo']);

    await audit.done();
    expect(errors).toEqual([]);
  });
});
