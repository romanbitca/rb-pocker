import type { Locator, Page, TestInfo } from '@playwright/test';
import { cardAriaLabel } from '../../src/core/cards.ts';
import type { HandState, LegalActions, TableState } from '../../src/engine/types.ts';
import { expect } from './fixtures.ts';

/**
 * Helpers for the Stage 3 acceptance suite (PLAN §18 Stage 3, chunk 3.8). They need the E2E build
 * (`npm run build:e2e -w @rb/web`, what the root `npm run e2e` serves): `?seed=<hex>` fixes the
 * table and hand seeds, and `window.__pc` (app/testHooks.ts) exposes the store state, `dispatch`
 * and the controller's logs. The hero always plays through the visible buttons; `__pc` is only
 * read, except to set up a table (speed, players) the way the Setup and Settings screens would.
 */

/** What the specs read through `window.__pc`. */
interface PcState {
  game: {
    mode: string;
    table: TableState | null;
    hand: HandState | null;
    next: TableState | null;
    heroBust: boolean;
    legal: LegalActions | null;
    /** Stage 6 (§11.3): Undo can be taken now; the open feedback card; this hand's decisions. */
    canUndo: boolean;
    feedback: { grade: string; canUndo: boolean } | null;
    decisions: readonly {
      decisionId: number;
      street: string;
      grade: string | null;
      undone: boolean;
    }[];
  };
  ui: { screen: string; overlays: readonly string[]; gates: readonly string[]; layout: string };
  settings: { players: number; speed: string; autoNext: boolean } & Record<string, unknown>;
  /** The coach's answer for the hero decision `key` (`CoachSlice`, app/store.ts). */
  coach: { key: string | null; status: 'idle' | 'ready' | 'failed' };
}

interface PcHooks {
  seed: string | null;
  state(): PcState;
  dispatch(cmd: { type: string } & Record<string, unknown>): void;
  logs(): {
    events: { what: string; detail?: unknown }[];
    errors: { what: string; detail?: unknown }[];
    /** Brain requests and replies as the controller saw them ('request' = a bot's decision). */
    brain: { what: string; detail?: unknown }[];
  };
  snapshot(): {
    mode: string;
    table: TableState | null;
    hand: HandState | null;
    next: TableState | null;
    inputs: unknown[];
    meta: { undoCount: number };
  };
}

declare global {
  interface Window {
    __pc?: PcHooks;
    /** The bot-card watch (installLeakWatch): what it found. */
    __leaks?: string[];
    /** The long-task observer (installLongTaskObserver). */
    __longTasks?: { start: number; duration: number }[];
  }
}

/** The five Stage 3 acceptance viewports (criteria 1 and 2): every project but the tablet. */
export const ACCEPTANCE_SIZES = ['375x667', '360x740', '390x844', '844x390', '1280x800'] as const;

/** The project's viewport, "375x667". */
export const sizeOf = (testInfo: TestInfo): string => testInfo.project.name.replace(/^.*-/, '');

/** A fixed seed per test and project, so a failing run can be repeated with `?seed=`. */
export function seedFor(testInfo: TestInfo, salt = ''): string {
  let h = 0x811c9dc5;
  for (const ch of `${testInfo.titlePath.join('/')}|${testInfo.project.name}|${salt}`) {
    h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** A small seeded PRNG (mulberry32) for the hero's choices: the same run every time. */
export function prng(seedHex: string): () => number {
  let a = Number.parseInt(seedHex.slice(-8), 16) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Console errors and uncaught exceptions, collected from now on. */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`uncaught: ${error.message}`));
  return errors;
}

/**
 * Loads the app with `?seed=` (and `extra` query parameters, e.g. `&script=river-min-bet`, the
 * Stage 6 bot scripts) and waits until it has booted.
 */
export async function openApp(page: Page, seed: string, extra = ''): Promise<void> {
  await page.goto(`/?seed=${seed}${extra}`);
  await page.waitForFunction(() => {
    const pc = window.__pc;
    return pc !== undefined && pc.state().game.mode !== 'booting';
  });
}

export interface TableOptions {
  players: number;
  /** Default 'instant' (§12.8), so a hand takes about a second. */
  speed?: 'normal' | 'fast' | 'instant';
  /** Default false: the test taps the banner, so the next hand never starts under its tap. */
  autoNext?: boolean;
}

/**
 * Sets the game speed (Settings) and starts a new table with `players` seats (Setup's Start
 * game), then waits for the first hand: the Table screen with the hero's cards dealt.
 */
export async function newTable(page: Page, options: TableOptions): Promise<void> {
  const { players, speed = 'instant', autoNext = false } = options;
  await page.evaluate(
    ({ players, speed, autoNext }) => {
      const pc = window.__pc;
      if (pc === undefined) throw new Error('no window.__pc: is this the E2E build?');
      pc.dispatch({ type: 'settings', patch: { speed, autoNext } });
      pc.dispatch({ type: 'newTable', setup: { players }, confirmed: true });
    },
    { players, speed, autoNext },
  );
  await page.waitForFunction((players) => {
    const s = window.__pc?.state();
    return (
      s !== undefined &&
      s.ui.screen === 'table' &&
      s.game.hand !== null &&
      s.game.hand.seats.length === players &&
      s.game.hand.phase !== 'complete'
    );
  }, players);
  await expect(page.locator('[data-hero-cards] [role="img"]')).toHaveCount(2);
}

/** Opens the app with `?seed=` and starts a table (see newTable). */
export async function startTable(page: Page, seed: string, options: TableOptions): Promise<void> {
  await openApp(page, seed);
  await newTable(page, options);
}

export const pcState = (page: Page): Promise<PcState> =>
  page.evaluate(() => {
    const pc = window.__pc;
    if (pc === undefined) throw new Error('no window.__pc');
    return pc.state();
  });

/** What the hand flow waits for next. */
export type FlowPoint = 'hero' | 'end' | 'bust';

/**
 * The flow points, and two waits of Stage 6:
 * - the mistake feedback card (§11.1): after a hero decision graded at the coach level's
 *   threshold (Beginner: Inaccuracy or worse, §10.2) the game waits for [Undo: try again] or
 *   [Keep my move]. The helpers keep the move, as a player who reads the card and goes on; specs
 *   about the card itself use `tests/e2e/undo.spec.ts`'s own steps;
 * - the Advanced quiz (§10.3, chunk 6.4): Row A waits for its answers; the helpers tap "Skip".
 * At a hand end the summary sheet (§12.9, chunk 6.4) may be open, over the banner: the hand-end
 * point then waits for its "Next hand ›" (the tap `tapNextHand` and `playHands` make).
 */
type Waypoint = FlowPoint | 'feedback' | 'quiz';

/**
 * In the page: the point the game is at, or null while bots act or cards move. The card counts
 * once its Keep my move button is on the page (its code is a lazy chunk); the quiz once its Skip
 * is; a hand end once what to tap is (the summary's "Next hand ›" while it is open, else the
 * banner).
 */
function readFlowPoint(): Waypoint | null {
  const s = window.__pc?.state();
  if (s === undefined) return null;
  if (s.ui.overlays.includes('outOfChips')) return 'bust';
  if (s.game.mode === 'heroTurn') {
    return document.querySelector('[data-quiz-skip]') !== null ? 'quiz' : 'hero';
  }
  if (s.game.mode === 'handEnd') {
    const summary = s.ui.overlays.includes('summary');
    const tap = document.querySelector(summary ? '[data-summary-next]' : '[data-hand-end]');
    return tap === null ? null : 'end';
  }
  if (s.game.mode === 'feedback' && document.querySelector('[data-feedback-keep]') !== null) {
    return 'feedback';
  }
  return null;
}

/** The feedback card's [Keep my move]: the hand goes on (§11.1). */
export async function keepMove(page: Page): Promise<void> {
  await page.locator('[data-feedback-keep]').click();
  await page.waitForFunction(() => window.__pc?.state().game.mode !== 'feedback');
}

/** The Advanced quiz's "Skip" (§10.3): Row A works again. */
export async function skipQuiz(page: Page): Promise<void> {
  await page.locator('[data-quiz-skip]').click();
}

/**
 * At a hand end (`nextFlowPoint` said 'end'): the next hand, by "Next hand ›" on the summary
 * sheet when it is open (§12.9: the next hand waits for it), else by a tap on the banner.
 */
export async function tapNextHand(page: Page): Promise<void> {
  // The sheet is a lazy chunk (prefetched with the Table): tap it once it is on the page.
  const summary = await page.evaluate(
    () => window.__pc?.state().ui.overlays.includes('summary') === true,
  );
  await page.locator(summary ? '[data-summary-next]' : '[data-hand-end]').click();
}

/**
 * Closes the hand summary when it is open (Esc, as ✕ or the scrim would), so the banner under it
 * can be read and tapped; the next hand then comes after its 3 s, or on the banner's tap.
 */
export async function closeSummary(page: Page): Promise<void> {
  const open = await page.evaluate(
    () => window.__pc?.state().ui.overlays.includes('summary') === true,
  );
  if (!open) return;
  await page.keyboard.press('Escape');
  await expect
    .poll(() => page.evaluate(() => window.__pc?.state().ui.overlays.includes('summary')))
    .toBe(false);
}

/**
 * Waits until it is the hero's turn, the hand has ended, or the hero is out of chips. A feedback
 * card on the way is answered with Keep my move (see `Waypoint`).
 *
 * `fast` (the page has a fake clock, `page.clock.install()`): instead of waiting out the bots'
 * think time in real time, it moves the page's clock on (`clock.runFor`), which fires every timer
 * that falls due, in order, each in its own task with the page rendering between them. The game
 * plays exactly as it would, only without the waits. No timer runs while the hero decides (nor,
 * with `autoNext` off, while the banner is up), so a jump never skips past a decision. (A jump can
 * outrun the 1,500 ms the hand waits for a grade, §11.3 r5: the grade then comes late, without a
 * card, as it may in real play.)
 */
export async function nextFlowPoint(page: Page, fast = false): Promise<FlowPoint> {
  for (let jumps = 0, cards = 0; jumps < 120;) {
    let point: Waypoint | null;
    if (fast) {
      point = await page.evaluate(readFlowPoint);
    } else {
      const handle = await page.waitForFunction(readFlowPoint, undefined, {
        polling: 'raf',
        timeout: 20_000,
      });
      point = (await handle.jsonValue()) as Waypoint;
    }
    if (point === 'feedback') {
      if (++cards > 40) throw new Error('nextFlowPoint: a feedback card that does not go');
      await keepMove(page);
      continue;
    }
    if (point === 'quiz') {
      if (++cards > 40) throw new Error('nextFlowPoint: a quiz that does not go');
      await skipQuiz(page);
      continue;
    }
    if (point !== null) return point;
    if (fast) await page.clock.runFor(1000);
    jumps++;
  }
  throw new Error('no hero turn, hand end or out-of-chips dialog within 120 s of game time');
}

/**
 * The out-of-chips dialog's "Reload …" (§3.1): the hero gets the starting stack back and the next
 * hand starts. A hero who checks and calls everything busts now and then against the real bots
 * (chunk 5.7), so the loops that play on to a kind of decision reload and go on.
 */
export async function reloadAfterBust(page: Page): Promise<void> {
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: /^Reload / })
    .click();
}

/** Row A (§12.7): the enabled slots, from the DOM. */
async function enabledSlots(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-slot]')]
      .filter((b) => b.getAttribute('aria-disabled') !== 'true')
      .map((b) => b.dataset['slot'] ?? ''),
  );
}

export const slot = (page: Page, name: 'fold' | 'middle' | 'right'): Locator =>
  page.locator(`[data-slot="${name}"]`);

/**
 * One hero decision through the visible buttons: mostly check or call, sometimes fold, sometimes
 * a bet or raise through the sizing tray (a random preset, then the confirm button). A tap the
 * action bar ignores (its 250 ms double-tap guard) is simply retried by the caller's loop.
 */
export async function heroAct(page: Page, random: () => number): Promise<void> {
  const enabled = await enabledSlots(page);
  const roll = random();
  let choice: string;
  if (enabled.includes('fold') && roll < 0.12) choice = 'fold';
  else if (enabled.includes('right') && roll > 0.78) choice = 'right';
  else choice = enabled.includes('middle') ? 'middle' : (enabled[0] ?? 'middle');

  const button = slot(page, choice as 'fold' | 'middle' | 'right');
  if (choice !== 'right' || (await button.getAttribute('aria-expanded')) === null) {
    await button.click();
    return;
  }
  // The right button opens the sizing tray; pick a preset, then confirm with the same button.
  await button.click();
  const trayId = await button.getAttribute('aria-controls');
  if (trayId === null) return; // the tap was ignored (double-tap guard); the loop tries again
  const presets = page.locator(`[id="${trayId}"] button[aria-pressed]:enabled`);
  const count = await presets.count();
  if (count > 0) await presets.nth(Math.floor(random() * count)).click();
  await button.click();
}

export interface HandRecord {
  handSeq: number;
  players: number;
  hand: HandState;
}

export interface PlayOptions {
  hands: number;
  random: () => number;
  /** Move a fake clock on instead of waiting (see nextFlowPoint); needs `page.clock.install()`. */
  fast?: boolean;
  /**
   * Called at every hand end, before the banner (or the summary's "Next hand ›") is tapped. It
   * may close the summary (`closeSummary`) to read the banner.
   */
  onHandEnd?: (record: HandRecord) => Promise<void>;
  /** Called at every hero turn, before the tap (e.g. to wait for the final win chance). */
  beforeHeroAct?: () => Promise<void>;
}

interface Spot {
  x: number;
  y: number;
}

/** Where the flow stands, and where to tap: read in one round trip (see playHands). */
interface FlowView {
  point: Waypoint | null;
  hand: HandState | null;
  /** Row A's enabled buttons; `tray` = the button opens the sizing tray. */
  slots: { slot: string; tray: boolean; at: Spot }[];
  /**
   * The hand-end banner (the summary's "Next hand ›" while it is open), the out-of-chips
   * dialog's Reload button, the card's Keep my move, or the quiz's Skip.
   */
  tap: Spot | null;
}

/** In the page: FlowView (the full hand only at a hand end). */
function readFlowView(): FlowView {
  // The middle of the part a finger can see: clipped by every ancestor that clips or scrolls
  // (in landscape a long hand-end banner scrolls in its column, under Row A) and the viewport,
  // and not covered by another element (a tall hand-end banner in the wide layout reaches up
  // under the top bar: the middle of its clipped box would be a tap on the bar). When the middle
  // is covered, the nearest point of that part that does hit the element.
  const centre = (el: Element): Spot => {
    const r = el.getBoundingClientRect();
    let [left, top, right, bottom] = [r.left, r.top, r.right, r.bottom];
    for (let a = el.parentElement; a !== null; a = a.parentElement) {
      const style = getComputedStyle(a);
      if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
      const b = a.getBoundingClientRect();
      [left, top] = [Math.max(left, b.left), Math.max(top, b.top)];
      [right, bottom] = [Math.min(right, b.right), Math.min(bottom, b.bottom)];
    }
    [left, top] = [Math.max(left, 0), Math.max(top, 0)];
    [right, bottom] = [Math.min(right, innerWidth), Math.min(bottom, innerHeight)];
    const middle: Spot = { x: (left + right) / 2, y: (top + bottom) / 2 };
    const hits = (x: number, y: number): boolean => {
      const on = document.elementFromPoint(x, y);
      return on !== null && el.contains(on);
    };
    if (hits(middle.x, middle.y)) return middle;
    let best: Spot | null = null;
    let nearest = Infinity;
    for (let y = Math.ceil(top) + 2; y < bottom - 1; y += 4) {
      for (let x = Math.ceil(left) + 2; x < right - 1; x += 8) {
        const away = (x - middle.x) ** 2 + (y - middle.y) ** 2;
        if (away < nearest && hits(x, y)) [best, nearest] = [{ x, y }, away];
      }
    }
    return best ?? middle;
  };
  const s = window.__pc?.state();
  const keep = document.querySelector('[data-feedback-keep]');
  const skip = document.querySelector('[data-quiz-skip]');
  const summary = s?.ui.overlays.includes('summary') === true;
  const banner = document.querySelector(summary ? '[data-summary-next]' : '[data-hand-end]');
  let point: Waypoint | null = null;
  if (s?.ui.overlays.includes('outOfChips') === true) point = 'bust';
  else if (s?.game.mode === 'heroTurn') point = skip !== null ? 'quiz' : 'hero';
  else if (s?.game.mode === 'handEnd' && banner !== null) point = 'end';
  else if (s?.game.mode === 'feedback' && keep !== null) point = 'feedback';
  const slots = [...document.querySelectorAll('[data-slot]')]
    .filter((b) => b.getAttribute('aria-disabled') !== 'true')
    .map((b) => ({
      slot: b.getAttribute('data-slot') ?? '',
      tray: b.hasAttribute('aria-expanded'),
      at: centre(b),
    }));
  const dialogButtons = '[role="dialog"] button, [role="alertdialog"] button';
  const reload = [...document.querySelectorAll(dialogButtons)].find((b) =>
    (b.textContent ?? '').startsWith('Reload '),
  );
  const tap =
    point === 'bust'
      ? reload
      : point === 'end'
        ? banner
        : point === 'feedback'
          ? keep
          : point === 'quiz'
            ? skip
            : null;
  return {
    point,
    hand: point === 'end' ? (s?.game.hand ?? null) : null,
    slots: point === 'hero' ? slots : [],
    tap: tap === null || tap === undefined ? null : centre(tap),
  };
}

/** The hero's choice (see heroAct), tapped at the buttons' measured centres. */
async function heroTap(page: Page, view: FlowView, random: () => number): Promise<void> {
  const enabled = new Map(view.slots.map((s) => [s.slot, s]));
  const roll = random();
  const pick =
    (roll < 0.12 ? enabled.get('fold') : roll > 0.78 ? enabled.get('right') : undefined) ??
    enabled.get('middle') ??
    view.slots[0];
  if (pick === undefined) return;
  await page.mouse.click(pick.at.x, pick.at.y);
  if (!pick.tray) return;
  // The tray is open (or the tap was ignored): a random preset, then the same button confirms.
  const presets = await page.evaluate(() => {
    const id = document.querySelector('[data-slot="right"]')?.getAttribute('aria-controls');
    const tray = id === null || id === undefined ? null : document.getElementById(id);
    return [...(tray?.querySelectorAll('button[aria-pressed]:enabled') ?? [])].map((b) => {
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
  });
  if (presets.length === 0) return; // the tap was ignored (double-tap guard): the loop goes on
  const preset = presets[Math.floor(random() * presets.length)];
  if (preset !== undefined) await page.mouse.click(preset.x, preset.y);
  await page.mouse.click(pick.at.x, pick.at.y);
}

/**
 * Plays `hands` full hands through the UI: the hero taps Row A (as heroAct chooses), the
 * hand-end banner is tapped to deal the next hand (the summary's "Next hand ›" while it is open,
 * Stage 6), "Reload" when the hero is out of chips, Keep my move on a feedback card and Skip on
 * the Advanced quiz (Stage 6).
 * For speed each step reads the state and the buttons' places in one round trip and taps there
 * with real mouse clicks (Playwright's locator checks cost several round trips per tap, which
 * made 50 hands take minutes in WebKit on the CI runner). A tap that misses shows up as no
 * progress: the loop fails after `hands × 200` steps.
 */
export async function playHands(page: Page, options: PlayOptions): Promise<HandRecord[]> {
  const records: HandRecord[] = [];
  for (let steps = 0; records.length < options.hands; steps++) {
    if (steps > options.hands * 200) throw new Error('playHands: no progress');
    let view = await page.evaluate(readFlowView);
    for (let waits = 0; view.point === null; waits++) {
      if (waits > 400) throw new Error('playHands: no hero turn, hand end or dialog');
      if (options.fast === true) await page.clock.runFor(1000);
      else await page.waitForFunction(readFlowPoint, undefined, { polling: 'raf' });
      view = await page.evaluate(readFlowView);
    }
    if (view.point === 'hero') {
      if (options.beforeHeroAct !== undefined) {
        await options.beforeHeroAct();
        view = await page.evaluate(readFlowView); // the same turn; read the buttons again
        if (view.point !== 'hero') continue;
      }
      await heroTap(page, view, options.random);
    } else if (view.point === 'bust') {
      if (view.tap === null) throw new Error('out of chips, but no Reload button');
      await page.mouse.click(view.tap.x, view.tap.y);
    } else if (view.point === 'feedback' || view.point === 'quiz') {
      if (view.tap === null) throw new Error(`a ${view.point} without its button`);
      await page.mouse.click(view.tap.x, view.tap.y);
    } else {
      const hand = view.hand;
      if (hand === null || view.tap === null) throw new Error('hand end without a banner');
      expect(hand.phase, 'the hand ran to its end').toBe('complete');
      if (records.at(-1)?.handSeq !== hand.handSeq) {
        const record = {
          handSeq: hand.handSeq,
          players: hand.seats.filter((s) => s.dealtIn).length,
          hand,
        };
        records.push(record);
        await options.onHandEnd?.(record);
        // `onHandEnd` may have closed the summary: tap what is there now.
        view = await page.evaluate(readFlowView);
        if (view.point !== 'end' || view.tap === null) continue;
      }
      await page.mouse.click(view.tap.x, view.tap.y);
    }
  }
  return records;
}

/** Scroll overflow of the page, and the number of DOM nodes (§15.3: ≤ 600 on the Table). */
export async function pageMetrics(
  page: Page,
): Promise<{ scrollX: number; scrollY: number; nodes: number }> {
  return page.evaluate(() => ({
    scrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    scrollY: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    nodes: document.querySelectorAll('*').length,
  }));
}

/** Every card's screen-reader name ("King of hearts"), index = card. */
export const CARD_NAMES: readonly string[] = Array.from({ length: 52 }, (_, c) => cardAriaLabel(c));

/**
 * Criterion 7: a watch inside the page that checks the DOM after every change (a
 * MutationObserver, so every step of every hand, bots included). For each bot seat whose hole
 * cards the engine has not made public (`hand.revealed`), it records a violation when:
 * - its pod shows a card face up (any card image not named "Hidden card"), or
 * - either of its hole cards is named anywhere on the page (text, `aria-label`, `title`, `alt`,
 *   `aria-valuetext`), except in the hand-rankings list (`data-examples`), whose example hands name random cards.
 * Read the result with `leakViolations`.
 */
export async function installLeakWatch(page: Page): Promise<void> {
  await page.evaluate((names) => {
    if (window.__leaks !== undefined) return;
    const leaks: string[] = [];
    window.__leaks = leaks;
    const ATTRS = ['aria-label', 'title', 'alt', 'aria-valuetext'];

    const pageText = (): string => {
      const parts: string[] = [];
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
        {
          acceptNode: (node) =>
            node instanceof Element && node.hasAttribute('data-examples')
              ? NodeFilter.FILTER_REJECT
              : NodeFilter.FILTER_ACCEPT,
        },
      );
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        if (node instanceof Element) {
          for (const attr of ATTRS) {
            const value = node.getAttribute(attr);
            if (value !== null) parts.push(value);
          }
        } else if (node.nodeValue !== null) {
          parts.push(node.nodeValue);
        }
      }
      return parts.join('\n');
    };

    const check = (): void => {
      const s = window.__pc?.state();
      const hand = s?.game.hand;
      if (s === undefined || hand === null || hand === undefined || s.ui.screen !== 'table') return;
      const hidden = hand.seats.flatMap((seat, i) =>
        i === 0 || seat.hole === null || hand.revealed.includes(i) ? [] : [{ i, hole: seat.hole }],
      );
      if (hidden.length === 0) return;
      let text: string | null = null;
      for (const { i, hole } of hidden) {
        const pod = document.querySelector(`[data-seat="${i}"]`);
        for (const img of pod?.querySelectorAll('[role="img"]') ?? []) {
          const label = img.getAttribute('aria-label');
          if (label !== 'Hidden card') {
            leaks.push(`hand ${hand.handSeq} ${hand.street}: seat ${i} shows "${label}" face up`);
          }
        }
        text ??= pageText();
        for (const card of hole) {
          const name = names[card] ?? '?';
          if (text.includes(name)) {
            leaks.push(`hand ${hand.handSeq} ${hand.street}: seat ${i}'s ${name} is named`);
          }
        }
      }
    };

    new MutationObserver(check).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    check();
  }, CARD_NAMES);
}

export const leakViolations = (page: Page): Promise<string[]> =>
  page.evaluate(() => window.__leaks ?? ['the leak watch is not installed']);

/**
 * §15.3 "no main-thread long task > 50 ms during play": a `longtask` PerformanceObserver.
 * Chromium only (WebKit has no Long Tasks API); returns false when unsupported.
 */
export async function installLongTaskObserver(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    if (!PerformanceObserver.supportedEntryTypes.includes('longtask')) return false;
    const tasks: { start: number; duration: number }[] = [];
    window.__longTasks = tasks;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        tasks.push({ start: Math.round(entry.startTime), duration: Math.round(entry.duration) });
      }
    }).observe({ type: 'longtask' });
    return true;
  });
}

export const longTasks = (page: Page): Promise<{ start: number; duration: number }[]> =>
  page.evaluate(() => window.__longTasks ?? []);
