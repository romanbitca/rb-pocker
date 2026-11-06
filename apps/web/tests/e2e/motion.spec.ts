import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import {
  closeSummary,
  collectErrors,
  keepMove,
  newTable,
  nextFlowPoint,
  openApp,
  seedFor,
  sizeOf,
  slot,
  tapNextHand,
} from './game.ts';
import { feedbackCard, nextPoint, pauseClock, playTo, SCRIPT, SEED, tapAct } from './scripted.ts';

// PLAN §18 Stage 9, acceptance 3: "Under reduced motion no transform animation runs
// (computed-style check)" (§12.8: movement becomes short fades). Reduced motion is the system's
// choice (`prefers-reduced-motion: reduce`, Playwright's `emulateMedia`) unless the app's own
// setting says otherwise (`settings.reduceMotion`: 'on' = `data-motion="reduced"` on the root,
// 'off' = `data-motion="full"`, App.tsx).
//
// At each state of the flows below (every animated element on show: the deal, the board, the
// chips, the sheets and the drawer, the feedback card, a toast, the hand end, the switches, the
// hand drill's cards, the tips, an all-in run-out's bars), the whole page is read four ways:
//   reduced by the system (setting "Follow system") and reduced by the setting alone (no system
//   preference): no element, ::before or ::after has a CSS animation whose @keyframes move it
//   (transform, translate, rotate, scale) or a transition of those properties;
//   motion allowed (no preference), and the setting Off over a system that reduces: the same
//   check finds the motion, so the reduced reads are not empty by accident.
// Also §12.8's "default speed Fast": a first launch under the system's reduced motion plays at
// Fast, which Settings shows as the chosen speed, and a speed the player picks stays.
// One phone size per browser: the CSS is the same at every size.

type Variant = 'system reduces' | 'setting On' | 'motion allowed' | 'setting Off';

const VARIANTS: Readonly<
  Record<Variant, { media: 'reduce' | 'no-preference'; setting: 'system' | 'on' | 'off' }>
> = {
  'system reduces': { media: 'reduce', setting: 'system' },
  'setting On': { media: 'no-preference', setting: 'on' },
  'motion allowed': { media: 'no-preference', setting: 'system' },
  'setting Off': { media: 'reduce', setting: 'off' },
};
const REDUCED: readonly Variant[] = ['system reduces', 'setting On'];
const MOVING: readonly Variant[] = ['motion allowed', 'setting Off'];

/**
 * In the page: every element (and its ::before and ::after) whose computed style animates or
 * transitions a transform, as "<element>: animation <keyframes>" or "<element>: transition
 * <property>". An animation counts when its @keyframes set transform, translate, rotate or scale;
 * a transition when it names one of them (or `all`, with a duration). Durations do not matter:
 * at the Instant speed they are 0, and reduced motion must hold at every speed.
 */
function transformMotion(): string[] {
  const MOVES = ['transform', 'translate', 'rotate', 'scale'];
  const moving = new Set<string>();
  const visit = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSKeyframesRule) {
        const frames = Array.from(rule.cssRules) as CSSKeyframeRule[];
        if (frames.some((f) => MOVES.some((p) => f.style.getPropertyValue(p) !== ''))) {
          moving.add(rule.name);
        }
      } else if ('cssRules' in rule) {
        visit((rule as CSSGroupingRule).cssRules);
      }
    }
  };
  for (const sheet of Array.from(document.styleSheets)) visit(sheet.cssRules);

  const seconds = (list: string) =>
    list.split(',').map((t) => Number.parseFloat(t) * (t.trim().endsWith('ms') ? 0.001 : 1));
  const name = (el: Element) => {
    const data = Array.from(el.attributes)
      .filter((a) => a.name.startsWith('data-') || a.name === 'role' || a.name === 'aria-label')
      .map((a) => `[${a.name}${a.value === '' ? '' : `="${a.value.slice(0, 30)}"`}]`)
      .join('');
    const cls = typeof el.className === 'string' ? el.className.split(' ')[0] : '';
    return `${el.tagName.toLowerCase()}${cls === '' || cls === undefined ? '' : `.${cls}`}${data}`;
  };
  const found: string[] = [];
  for (const el of Array.from(document.querySelectorAll('*'))) {
    for (const pseudo of ['', '::before', '::after']) {
      const cs = getComputedStyle(el, pseudo === '' ? null : pseudo);
      for (const anim of cs.animationName.split(',').map((n) => n.trim())) {
        if (moving.has(anim)) found.push(`${name(el)}${pseudo}: animation ${anim}`);
      }
      const durations = seconds(cs.transitionDuration);
      cs.transitionProperty
        .split(',')
        .map((p) => p.trim())
        .forEach((prop, i) => {
          const duration = durations[i % durations.length] ?? 0;
          if (MOVES.includes(prop) || (prop === 'all' && duration > 0)) {
            found.push(`${name(el)}${pseudo}: transition ${prop}`);
          }
        });
    }
  }
  return found;
}

/** The motion setting and the system's preference of `variant`, once the root follows them. */
async function apply(page: Page, variant: Variant): Promise<void> {
  const { media, setting } = VARIANTS[variant];
  await page.emulateMedia({ reducedMotion: media });
  await page.evaluate((reduceMotion) => {
    const pc = window.__pc;
    // The controller refuses a patch that changes nothing (and logs it): only a change.
    if (pc !== undefined && pc.state().settings['reduceMotion'] !== reduceMotion) {
      pc.dispatch({ type: 'settings', patch: { reduceMotion } });
    }
  }, setting);
  const root = { system: 'none', on: 'reduced', off: 'full' }[setting];
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset['motion'] ?? 'none'))
    .toBe(root);
}

/** Reads each state four ways (see the header) and checks them all at the end. */
class MotionCheck {
  private readonly reduced: string[] = [];
  private readonly still: string[] = [];
  private readonly page: Page;
  readonly states: string[] = [];

  constructor(page: Page) {
    this.page = page;
  }

  async scan(state: string): Promise<void> {
    this.states.push(state);
    for (const variant of [...MOVING, ...REDUCED]) {
      await apply(this.page, variant);
      const found = await this.page.evaluate(transformMotion);
      if (REDUCED.includes(variant)) {
        this.reduced.push(...found.map((f) => `${state} (${variant}): ${f}`));
      } else if (found.length === 0) {
        this.still.push(`${state} (${variant})`);
      }
    }
  }

  done(): void {
    expect(this.reduced, 'under reduced motion no transform animation runs').toEqual([]);
    expect(this.still, 'with motion allowed, the same check finds the motion').toEqual([]);
  }
}

const button = (page: Page, name: string | RegExp): Locator =>
  page.getByRole('button', { name, exact: typeof name === 'string' });

test.describe('reduced motion', () => {
  // eslint-disable-next-line no-empty-pattern -- Playwright reads the fixtures from this pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(sizeOf(testInfo) !== '390x844', 'one phone size per browser');
  });

  test('the table, its sheets, a mistake, a toast, the hand end, Setup, Settings, the drill', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const errors = collectErrors(page);
    const motion = new MotionCheck(page);
    // The scripted table of scripted.ts (seed 46, `river-min-bet`, Beginner): the hero folds the
    // nut flush on the river (the feedback card), takes it back (a toast) and calls.
    await page.clock.install();
    await openApp(page, SEED, SCRIPT);
    await page.evaluate(() =>
      window.__pc?.dispatch({ type: 'settings', patch: { coachLevel: 'beginner' } }),
    );

    // Setup with More options open: the arrow turns.
    await button(page, 'Choose players, chips and levels').click();
    await button(page, 'More options').click();
    await expect(page.getByRole('group', { name: "Set each bot's level" })).toBeVisible();
    await motion.scan('Setup: More options');

    // The table: the hero's cards dealt, the chips (blinds) on the felt.
    await newTable(page, { players: 3, speed: 'instant' });
    expect(await nextPoint(page)).toBe('hero');
    await motion.scan("Table: the deal, the hero's turn");
    await page.locator('button[data-coach-advice]').click();
    await expect(page.locator('[data-coach-sheet]')).toBeVisible();
    await motion.scan('Table: the coach sheet');
    await page.keyboard.press('Escape');
    await page.locator('header').getByRole('button', { name: 'Show all poker hands' }).click();
    await expect(page.getByRole('dialog', { name: /Poker hands/ })).toBeVisible();
    await motion.scan('Table: the hands drawer');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: /Poker hands/ })).toHaveCount(0);
    await button(page, 'Menu').click();
    await expect(button(page, 'Leave table')).toBeVisible();
    await motion.scan('Table: the Menu');
    await page.keyboard.press('Escape');
    await slot(page, 'right').click();
    await expect(slot(page, 'right')).toHaveAttribute('aria-expanded', 'true');
    await motion.scan('Table: the sizing tray');
    await page.goBack();
    await expect(slot(page, 'right')).toHaveAttribute('aria-expanded', 'false');

    // The river: five board cards; the fold brings the feedback card, Undo a toast (the clock
    // paused: the card comes in time and the toast stays).
    await playTo(page, 'river');
    await motion.scan('Table: the board, the river');
    await pauseClock(page);
    await slot(page, 'fold').click();
    const card = await feedbackCard(page);
    await motion.scan('Table: the feedback card');
    await card.getByRole('button', { name: 'Undo: try again' }).click();
    await expect(
      page.getByText('Move taken back. The unseen cards were shuffled again.'),
    ).toBeVisible();
    await motion.scan('Table: a toast');
    await page.clock.resume();

    // The call: the showdown (the bots' cards turn up), the summary sheet, the banner.
    await tapAct(page, 'middle');
    for (let points = 0; points < 10; points++) {
      const point = await nextPoint(page);
      if (point === 'end') break;
      if (point === 'feedback') await keepMove(page);
      else await tapAct(page, 'middle');
    }
    await expect(page.locator('[data-summary-next]')).toBeVisible();
    await motion.scan('Table: the showdown and the hand summary');
    await closeSummary(page);
    await expect(page.locator('[data-hand-end]')).toBeVisible();
    await motion.scan('Table: the hand-end banner');

    // Settings (its switches) and the hand drill (its cards), from the Menu.
    await button(page, 'Menu').click();
    await button(page, 'Settings').click();
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
    await motion.scan('Settings');
    await button(page, 'Back').click();
    await button(page, 'Menu').click();
    await button(page, 'Hand drill').click();
    await expect(page.locator('[data-question]')).toHaveCount(1);
    await motion.scan('Drill: a question');
    // Name the hand: a name and a place in the ranking.
    await page.locator('[data-name]').nth(3).click();
    await page.locator('[data-position="5"]').click();
    await expect(page.locator('[data-feedback]')).toHaveAttribute(
      'data-feedback',
      /^(right|wrong)$/,
    );
    await motion.scan('Drill: answered');

    motion.done();
    expect(errors).toEqual([]);
  });
});

test.describe('reduced motion: the tips and an all-in run-out', () => {
  test.use({ firstTableTips: true });
  // eslint-disable-next-line no-empty-pattern -- Playwright reads the fixtures from this pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(sizeOf(testInfo) !== '390x844', 'one phone size per browser');
  });

  test('a first-table tip, then the run-out bars', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const errors = collectErrors(page);
    const motion = new MotionCheck(page);
    // The bots check and call (`?script=passive`): the hero's shove is called and the cards run
    // out with a win-chance bar for each hand. The fake clock runs until the run-out is read.
    await page.clock.install();
    await openApp(page, seedFor(testInfo, 'motion-tips'), '&script=passive');
    await newTable(page, { players: 3, speed: 'instant' });
    const tip = page.locator('[data-tip]');
    await expect(tip).toBeVisible({ timeout: 20_000 });
    await motion.scan('Table: a first-table tip');

    let runout = false;
    for (let steps = 0; steps < 40 && !runout; steps++) {
      const point = await page
        .waitForFunction(
          () => {
            const s = window.__pc?.state();
            if (s === undefined) return null;
            if (document.querySelector('[data-runout-seat]') !== null) return 'runout';
            if (s.ui.overlays.includes('tip') && document.querySelector('[data-tip]') !== null) {
              return 'tip';
            }
            if (s.game.mode === 'feedback' && document.querySelector('[data-feedback-keep]')) {
              return 'card';
            }
            if (s.game.mode === 'heroTurn') return 'hero';
            if (s.game.mode === 'handEnd' || s.ui.overlays.includes('outOfChips')) return 'end';
            return null;
          },
          undefined,
          { timeout: 30_000 },
        )
        .then((handle) => handle.jsonValue());
      if (point === 'runout') {
        runout = true;
      } else if (point === 'tip') {
        await tip.click();
      } else if (point === 'card') {
        await keepMove(page);
      } else if (point === 'end') {
        const next = await nextFlowPoint(page);
        if (next === 'bust') await page.getByRole('button', { name: /^Reload / }).click();
        else await tapNextHand(page);
      } else {
        // All in, at Normal speed so the run-out stays on screen.
        await page.evaluate(() => {
          const pc = window.__pc;
          if (pc !== undefined && pc.state().settings.speed !== 'normal') {
            pc.dispatch({ type: 'settings', patch: { speed: 'normal' } });
          }
        });
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
      }
    }
    expect(runout, 'an all-in run-out').toBe(true);
    // Hold the run-out on screen while it is read: no game timer runs while the clock is paused.
    await pauseClock(page);
    await expect(page.locator('[data-runout-seat]').first()).toBeVisible();
    await motion.scan('Table: the run-out bars');

    motion.done();
    expect(errors).toEqual([]);
  });
});

test.describe('reduced motion: the default speed is Fast (§12.8, §12.1 notes)', () => {
  // eslint-disable-next-line no-empty-pattern -- Playwright reads the fixtures from this pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(sizeOf(testInfo) !== '390x844', 'one phone size per browser');
  });

  /** The speed the game runs at: the store's setting and the root's `--speed` factor. */
  const speedOf = (page: Page): Promise<[string, string]> =>
    page.evaluate(() => [
      String(window.__pc?.state().settings.speed),
      getComputedStyle(document.documentElement).getPropertyValue('--speed').trim(),
    ]);

  test('a first launch under the system`s reduced motion plays at Fast; Settings shows it', async ({
    page,
  }, testInfo) => {
    test.setTimeout(60_000);
    const errors = collectErrors(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openApp(page, seedFor(testInfo, 'motion-speed'));
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible(); // Welcome
    expect(await speedOf(page)).toEqual(['fast', '0.5']);

    // Play (one tap), then Menu → Settings: the Speed row has Fast chosen, like any speed.
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page.locator('[data-hero-cards] [role="img"]')).toHaveCount(2);
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const speed = page.getByRole('group', { name: 'Speed', exact: true });
    await expect(speed.getByRole('radio', { name: 'Fast', exact: true })).toBeChecked();

    // The player's choice is theirs: Normal stays Normal at the next launch, under reduced motion.
    const normal = speed.getByRole('radio', { name: 'Normal', exact: true });
    await normal.click();
    await expect(normal).toBeChecked();
    await page.waitForFunction(() => {
      const raw = localStorage.getItem('pc.v1.profile');
      const stored = raw === null ? null : (JSON.parse(raw) as { settings: { speed: string } });
      return stored?.settings.speed === 'normal';
    });
    await openApp(page, seedFor(testInfo, 'motion-speed'));
    expect(await speedOf(page)).toEqual(['normal', '1']);
    expect(errors).toEqual([]);
  });

  test('without reduced motion a first launch plays at Normal', async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await openApp(page, seedFor(testInfo, 'motion-speed'));
    expect(await speedOf(page)).toEqual(['normal', '1']);
  });
});
