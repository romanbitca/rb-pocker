import type { Locator, Page } from '@playwright/test';
import type { StakesId, TableView, TurnSeconds } from '../../src/net/protocol.ts';
import { expect, type TelegramPlayer } from './fixtures.ts';
import { slot, TAP_GUARD_MS } from './game.ts';
import {
  launchFragment,
  signInitData,
  TEST_APP_SHORT_NAME,
  TEST_BOT_USERNAME,
  type LaunchOptions,
} from './telegram.ts';

/**
 * Playing at a table of the server's, through the app's own buttons (PLAN §19.10, chunk 10.10).
 * `window.__pc` is only read. The server's clock is real here, so every wait is on what the server
 * has said, never a sleep.
 */

/** The longest a server step can take: a 60 s turn, the longest the tests leave alone. */
const SERVER_STEP_MS = 75_000;

const button = (page: Page, name: string | RegExp): Locator =>
  page.getByRole('button', { name, exact: typeof name === 'string' });

export const mpHeading = (page: Page): Locator => page.getByRole('heading', { level: 1 });

export const pcView = (page: Page): Promise<TableView | null> =>
  page.evaluate(() => window.__pc?.state().mp.view ?? null);

export interface NewTable {
  seats: number;
  stakes: StakesId;
  turnSeconds: TurnSeconds;
}

/** One chip of the Create screen: radios under a group's legend. */
async function pick(page: Page, group: string, text: string | RegExp): Promise<void> {
  await page.getByRole('group', { name: group }).locator('label', { hasText: text }).click();
}

const GAME_NAME: Readonly<Record<StakesId, string>> = {
  quick: 'Quick game',
  normal: 'Normal game',
  long: 'Long game',
};

/** Fills the Create screen ("New table", which is on show) and returns the table's code. */
export async function fillCreateForm(page: Page, table: NewTable): Promise<string> {
  await expect(mpHeading(page)).toHaveText('New table');
  await pick(page, 'Players', new RegExp(`^${table.seats}$`));
  await pick(page, 'Game', GAME_NAME[table.stakes]);
  await pick(page, 'Time to act', `${table.turnSeconds} seconds`);
  await button(page, 'Create table').click();
  await expect(mpHeading(page)).toHaveText(/^Table [2-9A-HJKMNP-Z]{8}$/);
  return ((await mpHeading(page).textContent()) ?? '').replace('Table ', '');
}

/** "Play with friends" from Welcome or Home, then the Create screen. */
export async function createTable(player: TelegramPlayer, table: NewTable): Promise<string> {
  await button(player.page, 'Play with friends').click();
  return fillCreateForm(player.page, table);
}

/** "Invite friends": what the stand-in for Telegram was asked to share, as a host's friend gets it. */
export async function shareInvite(player: TelegramPlayer): Promise<{ link: string; code: string }> {
  await button(player.page, 'Invite friends').click();
  await expect
    .poll(async () => (await player.events()).some((e) => e.type === 'web_app_open_tg_link'))
    .toBe(true);
  const share = (await player.events()).findLast((e) => e.type === 'web_app_open_tg_link');
  const { path_full: path } = share?.data as { path_full: string };
  const url = new URL(path, 'https://t.me');
  expect(url.pathname).toBe('/share/url');
  expect(url.searchParams.get('text')).toBe('Join my poker table! Play money only.');
  const link = new URL(url.searchParams.get('url') ?? '');
  expect(link.origin + link.pathname).toBe(
    `https://t.me/${TEST_BOT_USERNAME}/${TEST_APP_SHORT_NAME}`,
  );
  return { link: link.href, code: link.searchParams.get('startapp') ?? '' };
}

/** This toast has come on screen, now or a moment ago (`toastWatch`). */
export async function expectToast(page: Page, text: string): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => window.__toastLog ?? []), { timeout: SERVER_STEP_MS })
    .toContain(text);
}

/** The Table of the server's is on show. */
export async function waitForTable(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const s = window.__pc?.state();
      return s?.ui.screen === 'table' && s.mp.view?.status === 'playing';
    },
    undefined,
    { timeout: SERVER_STEP_MS },
  );
}

/** The waiting room is on show: a table of the server's with too few players. */
export async function waitForRoom(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const s = window.__pc?.state();
      return s?.ui.screen === 'mpRoom' && s.mp.view?.status === 'waiting';
    },
    undefined,
    { timeout: SERVER_STEP_MS },
  );
}

/** Hand number `seq` has ended on this player's screen (a later hand: it ended a while ago). */
export async function waitForHandEnd(page: Page, seq: number): Promise<void> {
  await page.waitForFunction(
    (seq) => {
      const s = window.__pc?.state();
      const hand = s?.game.hand?.handSeq ?? 0;
      return (s?.game.mode === 'handEnd' && hand === seq) || hand > seq;
    },
    seq,
    { timeout: SERVER_STEP_MS },
  );
}

/** "Start game", then everybody's Table. */
export async function startGame(
  host: TelegramPlayer,
  all: readonly TelegramPlayer[],
): Promise<void> {
  await button(host.page, 'Start game').click();
  await Promise.all(all.map((player) => waitForTable(player.page)));
}

export interface MpState {
  /** This player's seat is on the clock and the bar is unlocked. */
  turn: boolean;
  handSeq: number | null;
  phase: string | null;
  seq: number | null;
}

/** What this player's client shows right now, in one round trip. */
export const mpState = (page: Page): Promise<MpState> =>
  page.evaluate(() => {
    const s = window.__pc?.state();
    const hand = s?.mp.view?.hand ?? null;
    return {
      turn: s?.game.mode === 'heroTurn' && s.game.legal !== null,
      handSeq: hand?.handSeq ?? null,
      phase: hand?.phase ?? null,
      seq: s?.mp.view?.decision?.seq ?? null,
    };
  });

/** Waits until it is this player's turn, the bar is unlocked and its double-tap guard has passed. */
export async function waitForTurn(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const s = window.__pc?.state();
      return s?.game.mode === 'heroTurn' && s.game.legal !== null;
    },
    undefined,
    { timeout: SERVER_STEP_MS },
  );
  await page.waitForTimeout(TAP_GUARD_MS + 30);
}

/**
 * One tap on a slot of Row A, made again until the app took it (the 250 ms guard, §12.7, ignores a
 * first tap): the driver then locks the bar, or the server's next view has moved the decision on.
 */
async function tapSlot(page: Page, name: 'fold' | 'middle' | 'right'): Promise<void> {
  const { seq } = await mpState(page);
  const took = (): Promise<boolean> =>
    page.evaluate((before) => {
      const s = window.__pc?.state();
      return s?.game.legal === null || s?.mp.view?.decision?.seq !== before;
    }, seq);
  await expect(async () => {
    if (!(await took())) await slot(page, name).click({ timeout: 2_000 });
    expect(await took(), `the ${name} button took the tap`).toBe(true);
  }).toPass({ timeout: 10_000, intervals: [50, 150, 300] });
}

/** Check or call. */
export const tapCheckOrCall = (page: Page): Promise<void> => tapSlot(page, 'middle');

/** Fold: the app asks nothing at this level; a free check has no Fold button (§3.5). */
export const tapFold = (page: Page): Promise<void> => tapSlot(page, 'fold');

/** All in, through the sizing tray ("All your chips") or a one-tap All-in. */
export async function tapAllIn(page: Page): Promise<void> {
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
  await page.waitForFunction(() => window.__pc?.state().game.legal === null);
}

/** A raise through the sizing tray: its first size, then the same button confirms. */
export async function tapRaise(page: Page): Promise<void> {
  const right = slot(page, 'right');
  await right.click();
  const trayId = await right.getAttribute('aria-controls');
  if (trayId === null) throw new Error('the right button did not open the tray');
  await page.locator(`[id="${trayId}"] button[aria-pressed]:enabled`).first().click();
  await right.click();
  await page.waitForFunction(() => window.__pc?.state().game.legal === null);
}

export type Choice = 'checkOrCall' | 'fold' | 'allIn' | 'raise' | 'none';

/**
 * Plays the running hand to its end: whoever is on turn does what `choose` says. Returns the
 * hand's number. `none`: that player's turn is left alone (the server's clock answers it).
 */
export async function playHand(
  players: readonly TelegramPlayer[],
  choose: (player: TelegramPlayer, index: number) => Choice,
): Promise<number> {
  const first = await mpState((players[0] as TelegramPlayer).page);
  const handSeq = first.handSeq;
  if (handSeq === null) throw new Error('playHand: no hand is on');
  const deadline = Date.now() + 3 * SERVER_STEP_MS;
  while (Date.now() < deadline) {
    const states = await Promise.all(players.map((p) => mpState(p.page)));
    if (states.some((s) => s.handSeq === handSeq && s.phase === 'complete')) return handSeq;
    if (states.some((s) => s.handSeq !== null && s.handSeq > handSeq)) return handSeq;
    const index = states.findIndex((s) => s.turn);
    const player = players[index];
    if (player === undefined) {
      await (players[0] as TelegramPlayer).page.waitForTimeout(50);
      continue;
    }
    const choice = choose(player, index);
    if (choice === 'none') {
      await player.page.waitForTimeout(100);
      continue;
    }
    await player.page.waitForTimeout(TAP_GUARD_MS + 30);
    if (choice === 'checkOrCall') await tapCheckOrCall(player.page);
    else if (choice === 'fold') await tapFold(player.page);
    else if (choice === 'raise') await tapRaise(player.page);
    else await tapAllIn(player.page);
  }
  throw new Error(`playHand: hand ${handSeq} did not end`);
}

/** Waits for the next hand's cards: `after` is the hand that ended. */
export async function waitForHand(page: Page, after: number): Promise<number> {
  const handle = await page.waitForFunction(
    (after) => {
      const hand = window.__pc?.state().mp.view?.hand;
      return hand !== null &&
        hand !== undefined &&
        hand.handSeq > after &&
        hand.phase !== 'complete'
        ? hand.handSeq
        : null;
    },
    after,
    { timeout: SERVER_STEP_MS },
  );
  return (await handle.jsonValue()) as number;
}

/** The two cards of the viewer's own strip: their names. */
export const ownCards = (page: Page): Promise<(string | null)[]> =>
  page
    .locator('[data-hero-cards] [role="img"]')
    .evaluateAll((cards) => cards.map((card) => card.getAttribute('aria-label')));

/** Each other seat's two cards, by the name a screen reader gets. */
export const seatCards = (page: Page, seat: number): Promise<(string | null)[]> =>
  page
    .locator(`[data-seat="${seat}"] [role="img"]`)
    .evaluateAll((cards) => cards.map((card) => card.getAttribute('aria-label')));

/**
 * A new launch of the Mini App in this player's browser: Telegram opens it again, for an invite or
 * from the menu, with a freshly signed `initData`. The same document would keep its old state, so
 * the URL changes and the page loads again.
 */
export async function relaunch(player: TelegramPlayer, options: LaunchOptions = {}): Promise<void> {
  await player.page.goto(`/${launchFragment(signInitData(player.user, options))}`);
  await player.page.reload();
  await player.page.waitForFunction(() => {
    const pc = window.__pc;
    return pc !== undefined && pc.state().game.mode !== 'booting';
  });
}

/** "Leave table": the Menu, then the dialog's confirm. */
export async function leaveTableFromMenu(page: Page): Promise<void> {
  await button(page, 'Menu').click();
  await button(page, 'Leave table').click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Leave this table?');
  await dialog.getByRole('button', { name: 'Leave table', exact: true }).click();
  await expect(button(page, 'Play')).toBeVisible();
}
