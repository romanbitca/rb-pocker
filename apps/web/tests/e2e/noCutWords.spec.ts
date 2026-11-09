import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { collectErrors, keepMove, pcState, sizeOf, slot } from './game.ts';
import { nextPoint, playTo, scriptedTable, tapAct, type Level } from './scripted.ts';

// PLAN §12.3, §12.6, §12.8 notes (1.3.100, the product review of 8–9 Nov 2026: "Coach: Raise to 90
// (4.…", "…17% nex…", "…everyone ha…", the winner's gold ring through "2.7k"): on the Table no coach,
// hand-name or stack text is cut. The texts pick a form that fits (`useFit`, ui/hooks.ts) before
// the paint, and never end in "…". Scripted hands with the long words, found with the real deal
// (`deckFromSeed`, hand 1, 3 players, bots that check and call):
// - seed 1: the coach raises at once (the head beside "Why?" in the landscape column), then the pair
//   on the board ("The pair is on the board: everyone has it") on the flop and the turn, and "Both
//   pairs are on the board: your kicker decides" on the river;
// - seed 23: an open-ended straight draw (the chip of the review);
// - seed 1a: an open-ended straight draw and another draw ("+1" beside the chip);
// - seed 36: a Full House on the river ("Full House, Queens full of Sevens" and such);
// - seed 5: the hero folds, the bots show down: a winner's pod with the gold ring.
// At each decision (Beginner: the advice on show; Intermediate: after "Hint"), at 360×740,
// 390×844, 844×390 and 1280×800 with Normal and Large text, both browsers.

/** Everything the review found cut, and the coach, hand-name and stack texts around it. */
const WATCHED = [
  '[data-coach-advice] > span:not([data-coach-why])',
  '[data-coach-strip="narration"] p',
  '[data-coach-strip="thinking"] p',
  '[data-hero-name]',
  '[data-hero-sub]',
  '[data-hero-stack]',
  '[data-draw-chips] > *',
  '[data-seat-name]',
  '[data-seat-stack]',
  '[data-bar-title]',
].join(', ');

/** Every text that is cut now: wider than its box, more lines than its box, or "…". */
const cutTexts = (page: Page, where: string): Promise<string[]> =>
  page.evaluate(
    ({ selector, label }) => {
      const out: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>(selector)) {
        if (el.getClientRects().length === 0) continue; // not on screen (a closed layout)
        const cs = getComputedStyle(el);
        const text = (el.textContent ?? '').trim();
        const say = (why: string) => out.push(`${label}: "${text}" ${why}`);
        if (cs.textOverflow === 'ellipsis') say('has text-overflow: ellipsis');
        if (el.scrollWidth > el.clientWidth + 1) {
          say(`is ${el.scrollWidth} px wide in ${el.clientWidth} px`);
        }
        const clamp = cs.getPropertyValue('-webkit-line-clamp');
        if (clamp !== 'none' && el.scrollHeight > el.clientHeight + 1) {
          say(`has hidden lines: ${el.scrollHeight} px in ${el.clientHeight} px`);
        }
      }
      // The hand's name and sub-label stay in their row of the hero strip (they ran into the coach
      // strip, or under the draw chip, at Large text).
      const hero = document.querySelector('[data-hero-label]');
      const strip = document.querySelector('section[aria-label="Your hand"]');
      const draws = document.querySelector('[data-draw-chips]');
      if (hero !== null && strip !== null && strip.contains(hero)) {
        const bottom = hero.getBoundingClientRect().bottom;
        const limit = strip.getBoundingClientRect().bottom;
        if (bottom > limit + 1) out.push(`${label}: the hand's words end at ${bottom}, ${limit}`);
        if (draws !== null && strip.contains(draws)) {
          const top = draws.getBoundingClientRect().top;
          if (bottom > top + 1) out.push(`${label}: the hand's words reach the chips: ${bottom}`);
        }
      }
      return out;
    },
    { selector: WATCHED, label: where },
  );

/**
 * Hand 1 to the river (or its last decision), the texts checked at each hero decision. `level`:
 * Intermediate taps "Hint" first, so the advice is on show.
 */
async function playChecking(page: Page, level: Level, seed: string, where: string): Promise<void> {
  const streets = ['preflop', 'flop', 'turn', 'river'] as const;
  for (const street of streets) {
    await playTo(page, street);
    if (level !== 'beginner') {
      const hint = page.locator('[data-coach-hint]');
      if ((await hint.count()) > 0) await hint.click();
    }
    await expect(page.locator('[data-coach-advice]')).toBeVisible();
    expect(await cutTexts(page, `${where}, seed ${seed}, ${street}`)).toEqual([]);
  }
}

test.describe('no cut words on the Table (§12.3, §12.6; 1.3.100)', () => {
  // eslint-disable-next-line no-empty-pattern -- Playwright reads the fixtures from this pattern
  test.beforeEach(({}, testInfo) => {
    test.skip(
      !['360x740', '390x844', '844x390', '1280x800'].includes(sizeOf(testInfo)),
      'the four sizes of the review',
    );
  });

  for (const textSize of ['normal', 'large'] as const) {
    test(`coach, hand-name and stack texts all fit (${textSize} text)`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(120_000);
      const errors = collectErrors(page);
      const where = `${sizeOf(testInfo)} ${textSize}`;

      for (const [seed, level] of [
        ['1', 'beginner'],
        ['23', 'intermediate'],
        ['1a', 'beginner'],
        ['36', 'intermediate'],
      ] as const) {
        await scriptedTable(page, level, { seed, textSize });
        await playChecking(page, level, seed, where);
      }

      // The hero folds at once; the bots show down: a winner's pod with the gold ring.
      await scriptedTable(page, 'beginner', { seed: '5', textSize });
      expect(await nextPoint(page)).toBe('hero');
      await tapAct(page, 'fold');
      for (let points = 0; points < 12; points++) {
        const point = await nextPoint(page);
        if (point === 'end') break;
        if (point === 'feedback') await keepMove(page);
        else await tapAct(page, 'fold');
      }
      expect((await pcState(page)).game.mode).toBe('handEnd');
      await expect(page.locator('[data-seat-winner]').first()).toBeVisible();
      expect(await cutTexts(page, `${where}, the showdown`)).toEqual([]);
      // The numbers end above the plate's bottom edge (the gold ring of the seat that wins).
      const rings = await page.evaluate(() =>
        [...document.querySelectorAll('[data-seat-stack]')].map((stack) => {
          const pod = stack.closest('[data-seat]') as HTMLElement;
          const plate = pod.querySelector('[data-seat-plate]') as HTMLElement;
          const edge = parseFloat(getComputedStyle(plate).borderBottomWidth);
          return {
            text: stack.textContent,
            bottom: stack.getBoundingClientRect().bottom,
            ring: plate.getBoundingClientRect().bottom - edge,
          };
        }),
      );
      expect(rings.length).toBeGreaterThan(1);
      for (const r of rings) {
        expect(r.bottom, `the stack "${r.text}" clears the ring`).toBeLessThanOrEqual(r.ring + 0.5);
      }
      expect(errors).toEqual([]);
    });
  }

  test('the words give way to shorter forms, never "…" (the review’s three cases)', async ({
    page,
  }, testInfo) => {
    test.skip(sizeOf(testInfo) !== '360x740', 'the narrowest phone of the review');
    test.setTimeout(90_000);
    // An open-ended straight draw on a 360 px phone (the review's "…17% nex…"): the chip's face.
    await scriptedTable(page, 'beginner', { seed: '23' });
    await playTo(page, 'flop');
    const chip = page.locator('[data-draw-chips] > *').first();
    await expect(chip).toHaveAttribute('aria-label', /^Open-ended straight draw · \d+ outs/);
    await expect(chip).toContainText(/\d+% (by river|next card)/);
    expect((await chip.textContent())?.includes('…')).toBe(false);
    // The pair on the board (the review's "…everyone ha…"): whole, or its short form.
    await scriptedTable(page, 'beginner', { seed: '1' });
    await playTo(page, 'flop');
    await expect(page.locator('[data-hero-sub]')).toHaveText(
      /^(The pair is on the board: everyone has it|Everyone has it)$/,
    );
  });

  test('Beginner’s "Why?" is a word, 44 px tall, in the place and size of Intermediate’s button', async ({
    page,
  }, testInfo) => {
    test.skip(
      !['390x844', '844x390'].includes(sizeOf(testInfo)),
      'a phone upright and on its side',
    );
    test.setTimeout(60_000);
    const box = (selector: string) =>
      page.evaluate((s) => {
        const r = (document.querySelector(s) as HTMLElement).getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height };
      }, selector);
    await scriptedTable(page, 'beginner', { seed: '5' });
    await playTo(page, 'preflop');
    const word = page.locator('[data-coach-why]');
    await expect(word).toHaveText('Why?');
    const beginner = await box('[data-coach-why]');
    expect(beginner.h).toBeGreaterThanOrEqual(44);
    const strip = await box('[data-coach-strip="advice"]');

    // Another seed: the same one would keep the saved table's id, and `newTable` waits for a new one.
    await scriptedTable(page, 'intermediate', { seed: 'c' });
    await playTo(page, 'preflop');
    await page.locator('[data-coach-hint]').click();
    await expect(slot(page, 'fold')).toBeVisible();
    const button = page.locator('[data-coach-strip="advice"] > button:not([data-coach-advice])');
    await expect(button).toHaveText('Why?');
    await expect(button).toBeVisible();
    const intermediate = await box('[data-coach-strip="advice"] > button:not([data-coach-advice])');
    // The same place and size, so "Why?" does not jump between the levels.
    expect(intermediate.w).toBeCloseTo(beginner.w, 0);
    expect(intermediate.h).toBeCloseTo(beginner.h, 0);
    expect(intermediate.x).toBeCloseTo(beginner.x, 0);
    expect(intermediate.y).toBeCloseTo(beginner.y, 0);
    expect(await box('[data-coach-strip="advice"]')).toMatchObject({ w: strip.w, h: strip.h });
  });

  test('no card is faded anywhere: the drawer’s rows and the "You" line carry the gold edge', async ({
    page,
  }, testInfo) => {
    test.skip(sizeOf(testInfo) !== '390x844', 'one phone per browser');
    test.setTimeout(60_000);
    await scriptedTable(page, 'beginner', { seed: '36' });
    await playTo(page, 'river');
    await page.locator('header button').last().click();
    await expect(page.locator('[data-examples] [data-category]').first()).toBeVisible();
    const cards = await page.evaluate(() =>
      [...document.querySelectorAll('[data-examples] [role="img"]')].map((c) => {
        let opacity = 1;
        for (let e: Element | null = c; e !== null; e = e.parentElement) {
          opacity *= parseFloat(getComputedStyle(e).opacity);
        }
        return { name: c.getAttribute('aria-label'), opacity };
      }),
    );
    expect(cards.length).toBeGreaterThanOrEqual(50);
    for (const c of cards) expect(c.opacity, `${c.name} is fully opaque`).toBe(1);
  });
});
