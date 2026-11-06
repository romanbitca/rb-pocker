import type { Page } from '@playwright/test';
import { coachWords } from '../../src/i18n/coachUi.ts';
import { SHELL } from '../../src/ui/layout/seats.ts';
import { expect, test } from './fixtures.ts';
import { collectErrors, sizeOf } from './game.ts';
import { type Level, pauseClock, playTo, scriptedTable } from './scripted.ts';

// PLAN §12.3, §12.6 (change log 1.3.78): the portrait coach strip on a narrow phone. Since the win
// chances say whom they count (§8.10, 1.3.61) the strip's line can read "All 5 players: 17%. Raiser
// alone: about 38%.", and one line cut it off on phones narrower than about 400 px. Now the line
// wraps to two lines in a 56 px strip (the head, two lines, and 6 px for the action bar's "Coach"
// badge, which reaches 5 px up). At the scripted table's first hero decision (Beginner: the strip
// is one button with "›"; Intermediate after "Hint": the words beside "Why?") the strip is given
// the longest lines the two numbers can make (one sentence a line, as CoachStrip renders a line of
// two sentences), and each is read in full: no word cut or hidden, inside the strip, clear of Undo,
// "Why?" and the "Coach" badge; the strip clear of the hero strip and the action bar. The table,
// the hero strip and the action bar do not move when the line's length changes: the strip's height
// never follows its words. A line too long for two lines ends in "…" and stays in its place too.

/** The longest line of the two win numbers: 8 opponents, 6 callers, three-character numbers. */
const LONGEST = coachWords.pairCallers(8, '>99', 6, '>99');
/** The other two-number lines (§12.6), as long as they get. */
const PAIRS = [
  LONGEST,
  coachWords.pairCallers(8, '100', 1, '100'),
  coachWords.pairRaiser(8, '>99', '>99'),
  coachWords.pair('>99', '>99'),
];
const TOO_LONG = `${LONGEST} ${LONGEST}`;

/** A line as CoachStrip renders it: its sentences (`sentences()`, ui/coachText.ts) one a line. */
const asShown = (line: string): string => line.split(/(?<=[.!?])\s+/).join('\n');

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface StripMeasure {
  /** The words on show (the line, after `text` replaced them). */
  text: string;
  strip: Box;
  /** The line's content box: its lines (its padding below only widens the clip). */
  line: Box;
  /** The line boxes of the line's words, in viewport pixels (hidden ones too). */
  words: Box[];
  /** The head's content box: "Coach: Call 40". */
  head: Box;
  /** The line's scroll and client sizes: more to scroll than to see is a cut or hidden word. */
  lineSize: { sw: number; cw: number; sh: number; ch: number };
  headSize: { sw: number; cw: number };
  undo: Box | null;
  why: Box | null;
  /** The "Coach" badge on the recommended button of the action bar (§12.7). */
  badge: Box | null;
  table: Box;
  hero: Box;
  bar: Box;
}

/**
 * The strip's parts, after replacing the line's words with `line` as the strip shows it (null: the
 * coach's own). The game clock is paused and the reading is in the same task as the change, so
 * nothing renders the strip again in between.
 */
function measure(page: Page, line: string | null): Promise<StripMeasure> {
  return page.evaluate(
    (text) => {
      const box = (el: Element): Box => {
        const r = el.getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height };
      };
      const content = (el: Element): Box => {
        const b = box(el);
        const cs = getComputedStyle(el);
        const [top, right, bottom, left] = [
          cs.paddingTop,
          cs.paddingRight,
          cs.paddingBottom,
          cs.paddingLeft,
        ].map((v) => parseFloat(v)) as [number, number, number, number];
        return { x: b.x + left, y: b.y + top, w: b.w - left - right, h: b.h - top - bottom };
      };
      const one = (selector: string): Element => {
        const el = document.querySelector(selector);
        if (el === null) throw new Error(`no ${selector}`);
        return el;
      };
      const advice = one('[data-coach-advice]');
      const strip = one('[data-coach-strip="advice"]');
      const [head, line] = [...advice.children];
      if (head === undefined || line === undefined) throw new Error('the advice has no line');
      if (text !== null) line.textContent = text;
      const range = document.createRange();
      range.selectNodeContents(line);
      const why = strip.querySelector(':scope > button:not([data-coach-advice])');
      const undo = document.querySelector('[data-undo]');
      const badge = document.querySelector('[data-slot][data-coach] > span:last-child');
      const bar = one('[data-slot="fold"]').closest('[role="group"]');
      if (bar === null) throw new Error('no action bar');
      return {
        text: line.textContent ?? '',
        strip: box(strip),
        line: content(line),
        words: [...range.getClientRects()].map((r) => ({
          x: r.left,
          y: r.top,
          w: r.width,
          h: r.height,
        })),
        lineSize: {
          sw: line.scrollWidth,
          cw: line.clientWidth,
          sh: line.scrollHeight,
          ch: line.clientHeight,
        },
        head: content(head),
        headSize: { sw: head.scrollWidth, cw: head.clientWidth },
        undo: undo === null ? null : box(undo),
        why: why === null ? null : box(why),
        badge: badge === null ? null : box(badge),
        table: box(one('[data-table-box]')),
        hero: box(one('section[aria-label="Your hand"]')),
        bar: box(bar),
      };
    },
    line === null ? null : asShown(line),
  );
}

const fmt = (b: Box): string =>
  `(${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}×${Math.round(b.h)})`;

/** Overlap by more than half a pixel both ways (sub-pixel rounding is not an overlap). */
const overlaps = (a: Box, b: Box): boolean =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.5 &&
  Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0.5;

const inside = (a: Box, b: Box): boolean =>
  a.x >= b.x - 0.5 &&
  a.y >= b.y - 0.5 &&
  a.x + a.w <= b.x + b.w + 0.5 &&
  a.y + a.h <= b.y + b.h + 0.5;

/** The words' line boxes that show (a clamped line's later lines are laid out below the box). */
const shown = (m: StripMeasure): Box[] => m.words.filter((w) => w.y < m.line.y + m.line.h - 1);

/** How many lines show. */
const rows = (m: StripMeasure): number => new Set(shown(m).map((w) => Math.round(w.y))).size;

/**
 * Every way the strip fails to show its line in full (or, `clamped`, to keep a too long one in two
 * lines), or moves the rest of the page; empty when there is none.
 */
function problems(m: StripMeasure, before: StripMeasure, clamped = false): string[] {
  const out: string[] = [];
  const say = (text: string) => out.push(`"${m.text}": ${text}`);
  const { sw, cw, sh, ch } = m.lineSize;
  const tall = SHELL.coachStrip;
  if (Math.abs(m.strip.h - tall) > 0.5) say(`the strip is ${fmt(m.strip)}, not ${tall} px tall`);
  if (sw > cw) say(`the line is ${sw} px wide in ${cw} px`);
  if (!clamped && sh > ch) say(`a line is hidden: ${sh} px of lines in ${ch} px`);
  if (clamped && sh <= ch) say('it fits: the test wants a line longer than two lines');
  if (rows(m) > 2) say(`${rows(m)} lines show`);
  if (m.headSize.sw > m.headSize.cw)
    say(`the head is cut: ${m.headSize.sw} px in ${m.headSize.cw}`);
  if (!inside(m.head, m.strip)) say(`the head ${fmt(m.head)} leaves the strip ${fmt(m.strip)}`);
  if (!inside(m.line, m.strip)) say(`the line ${fmt(m.line)} leaves the strip ${fmt(m.strip)}`);
  // The badge can sit under any part of the line (the coach's button decides): no line reaches it.
  if (m.badge !== null && m.line.y + m.line.h > m.badge.y + 0.5) {
    say(`the line ${fmt(m.line)} runs into the "Coach" badge ${fmt(m.badge)}`);
  }
  // Each line of words: inside the line's box from side to side, clear of the buttons beside it.
  for (const w of shown(m)) {
    if (w.x < m.line.x - 0.5 || w.x + w.w > m.line.x + m.line.w + 0.5) {
      say(`words ${fmt(w)} run out of the line ${fmt(m.line)}`);
    }
    if (m.undo !== null && overlaps(w, m.undo)) say(`words ${fmt(w)} run under Undo`);
    if (m.why !== null && overlaps(w, m.why)) say(`words ${fmt(w)} run under "Why?"`);
  }
  if (overlaps(m.strip, m.bar))
    say(`the strip ${fmt(m.strip)} overlaps the action bar ${fmt(m.bar)}`);
  if (overlaps(m.strip, m.hero))
    say(`the strip ${fmt(m.strip)} overlaps the hero strip ${fmt(m.hero)}`);
  for (const part of ['table', 'hero', 'bar', 'strip'] as const) {
    if (fmt(m[part]) !== fmt(before[part])) {
      say(`the ${part} moved to ${fmt(m[part])} from ${fmt(before[part])}`);
    }
  }
  return out;
}

const LEVELS: readonly Level[] = ['beginner', 'intermediate'];

test.describe('the coach strip on a narrow phone (§12.3, §12.6)', () => {
  for (const level of LEVELS) {
    test(`${level}: the longest line of the two win numbers shows in full, and nothing moves`, async ({
      page,
    }, testInfo) => {
      test.skip(
        !['360x740', '375x667', '390x844'].includes(sizeOf(testInfo)),
        'the portrait strip, on phones (§12.3)',
      );
      test.setTimeout(60_000);
      const errors = collectErrors(page);
      await scriptedTable(page, level);
      await playTo(page, 'preflop');
      if (level !== 'beginner') await page.locator('[data-coach-hint]').click();
      await expect(page.locator('[data-coach-advice]')).toBeVisible();
      await pauseClock(page);

      // The coach's own line, then the longest ones (315–336 px of words; a 360–390 px phone gives
      // the line 210–294 px): one sentence a line, two lines.
      const before = await measure(page, null);
      expect(before.badge, 'the "Coach" badge on the coach\'s button').not.toBeNull();
      expect(problems(before, before)).toEqual([]);
      for (const text of PAIRS) {
        const m = await measure(page, text);
        expect(problems(m, before)).toEqual([]);
      }
      expect(rows(await measure(page, LONGEST)), 'the longest line').toBe(2);
      // For a reader: the page with the longest line (test-results and the HTML report).
      const shot = testInfo.outputPath(`coach-strip-${level}.png`);
      await page.screenshot({ path: shot });
      await testInfo.attach(`coach strip, ${level}`, { path: shot, contentType: 'image/png' });

      // Too long for two lines: the second ends in "…", inside the strip; nothing moves.
      expect(problems(await measure(page, TOO_LONG), before, true)).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
});
