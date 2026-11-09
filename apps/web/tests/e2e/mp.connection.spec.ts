import type { Page } from '@playwright/test';
import { expect, test, type TelegramLauncher, type TelegramPlayer } from './fixtures.ts';
import { slot } from './game.ts';
import {
  createTable,
  fillCreateForm,
  mpHeading,
  mpState,
  ownCards,
  startGame,
  tapCheckOrCall,
  tapRaise,
  waitForHand,
  waitForTable,
  waitForTurn,
} from './mpPlay.ts';
import { freePort, startOwnServer, startTcpPlug, type OwnServer } from './own-server.ts';
import { newTelegramUser, TELEGRAM_SERVER_ENV } from './telegram.ts';

/**
 * PLAN §18 Stage 10, acceptance 13: a dropped connection and back, and "Table ended". The socket
 * really dies (a TCP plug in front of the server, or the server itself goes), so what is tested is
 * what a phone in a tunnel does: the real close, the real backoff, the real `welcome`.
 */

test.use({ multiplayer: true });

// eslint-disable-next-line no-empty-pattern -- Playwright reads the fixtures from this pattern
test.beforeEach(({}, testInfo) => {
  test.skip(!testInfo.project.name.endsWith('phone-390x844'), 'one phone size per browser');
});

const CONNECTION_LOST = 'Connection lost. Trying again…';

/** A dying socket is reported in the console by the browser itself: those lines are expected. */
function expectNoErrorsBut(players: readonly TelegramPlayer[], expected: RegExp): void {
  for (const player of players) {
    expect(
      player.errors.filter((line) => !expected.test(line)),
      player.user.first_name,
    ).toEqual([]);
  }
}
const SOCKET_NOISE = /WebSocket|Failed to load resource|websocket/i;

/** The Table of one player: whose pod is whose by its name. */
const pod = (page: Page, name: string) => page.locator('[data-seat]').filter({ hasText: name });

/** Until `player` is on turn; anybody else who is, does `act` (default: calls or checks). */
async function playUntilTurnOf(
  player: TelegramPlayer,
  others: readonly TelegramPlayer[],
  act: (page: Page) => Promise<void> = tapCheckOrCall,
): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if ((await mpState(player.page)).turn) return;
    for (const other of others) {
      if ((await mpState(other.page)).turn) {
        await waitForTurn(other.page);
        await act(other.page);
      }
    }
    await player.page.waitForTimeout(50);
  }
  throw new Error(`no turn for ${player.user.first_name}`);
}

test('a dropped connection and back: the seat, the cards and the turn are all still there', async ({
  telegram,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const plug = await startTcpPlug(Number(new URL(baseURL as string).port));
  try {
    const ann = await telegram.open(newTelegramUser('Ann'), { origin: plug.origin });
    const code = await createTable(ann, { seats: 2, stakes: 'quick', turnSeconds: 60 });
    const bob = await telegram.open(newTelegramUser('Bob'), { startParam: code });
    await expect(ann.page.getByRole('button', { name: 'Start game' })).toBeEnabled();
    await startGame(ann, [ann, bob]);
    await expect(ann.page.locator('[data-hero-cards] [role="img"]')).toHaveCount(2);
    await playUntilTurnOf(ann, [bob]);
    const cards = await ownCards(ann.page);

    // The signal goes, in the middle of Ann's own turn.
    plug.pull();
    await expect(ann.page.getByText(CONNECTION_LOST)).toBeVisible();
    await expect(slot(ann.page, 'middle')).toHaveAttribute('aria-disabled', 'true');
    await expect(pod(bob.page, 'Ann')).toContainText('Offline');
    expect((await mpState(bob.page)).turn).toBe(false);

    // It comes back before the deadline.
    plug.insert();
    await expect(ann.page.getByText(CONNECTION_LOST)).toHaveCount(0, { timeout: 20_000 });
    await expect(pod(bob.page, 'Ann')).not.toContainText('Offline');
    await waitForTurn(ann.page);
    expect(await ownCards(ann.page)).toEqual(cards);
    expect(ann.sockets.length).toBeGreaterThan(1);

    // And the turn is hers to play: the hand goes on.
    const before = await mpState(bob.page);
    await tapCheckOrCall(ann.page);
    await expect
      .poll(async () => (await mpState(bob.page)).seq, { timeout: 15_000 })
      .not.toBe(before.seq);
    expectNoErrorsBut([ann, bob], SOCKET_NOISE);
  } finally {
    await plug.close();
  }
});

test('gone for longer than the turn: the clock plays it, and the seat is still there', async ({
  telegram,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const plug = await startTcpPlug(Number(new URL(baseURL as string).port));
  try {
    const ann = await telegram.open(newTelegramUser('Ann'), { origin: plug.origin });
    const code = await createTable(ann, { seats: 2, stakes: 'quick', turnSeconds: 60 });
    const bob = await telegram.open(newTelegramUser('Bob'), { startParam: code });
    await expect(ann.page.getByRole('button', { name: 'Start game' })).toBeEnabled();
    await startGame(ann, [ann, bob]);
    await expect(ann.page.locator('[data-hero-cards] [role="img"]')).toHaveCount(2);
    // She faces a bet whichever blind she is: when her clock runs out it folds, and the hand ends.
    await playUntilTurnOf(ann, [bob], tapRaise);
    const { handSeq } = await mpState(ann.page);

    plug.pull();
    await expect(pod(bob.page, 'Ann')).toContainText('Offline');
    // A 60-second turn is cut to 15 for a player who is away (§19.5).
    await expect
      .poll(async () => (await bob.page.locator('[data-turn="other"]').textContent()) ?? '')
      .toMatch(/\D(1[0-5]|\d) s$/);
    await waitForHand(bob.page, handSeq as number); // the clock answered; the next hand is dealt

    plug.insert();
    await expect(ann.page.getByText(CONNECTION_LOST)).toHaveCount(0, { timeout: 20_000 });
    await waitForHand(ann.page, handSeq as number);
    await expect(ann.page.locator('[data-hero-cards] [role="img"]')).toHaveCount(2);
    expect((await mpState(ann.page)).handSeq).toBeGreaterThan(handSeq as number);
    expectNoErrorsBut([ann, bob], SOCKET_NOISE);
  } finally {
    await plug.close();
  }
});

test('two minutes without the server: "We can\'t reach the game.", then "Try again" or "Leave table"', async ({
  telegram,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const plug = await startTcpPlug(Number(new URL(baseURL as string).port));
  try {
    // A fake clock for this one player: her two minutes pass in a moment.
    const ann = await telegram.open(newTelegramUser('Ann'), {
      origin: plug.origin,
      prepare: (context) => context.clock.install(),
    });
    const code = await createTable(ann, { seats: 2, stakes: 'quick', turnSeconds: 60 });
    const bob = await telegram.open(newTelegramUser('Bob'), { startParam: code });
    await expect(ann.page.getByRole('button', { name: 'Start game' })).toBeEnabled();
    await startGame(ann, [ann, bob]);
    await expect(ann.page.locator('[data-hero-cards] [role="img"]')).toHaveCount(2);

    const giveUp = async (): Promise<void> => {
      plug.pull();
      await expect(ann.page.getByText(CONNECTION_LOST)).toBeVisible();
      await expect
        .poll(
          async () => {
            await ann.page.clock.fastForward(30_000);
            return ann.page.getByText("We can't reach the game.").count();
          },
          { timeout: 30_000, intervals: [200] },
        )
        .toBe(1);
    };

    await giveUp();
    plug.insert();
    await ann.page.getByRole('button', { name: 'Try again' }).click();
    await expect(ann.page.getByText("We can't reach the game.")).toHaveCount(0);
    await expect(ann.page.getByText(CONNECTION_LOST)).toHaveCount(0);
    await waitForTable(ann.page);
    await expect(ann.page.locator('[data-hero-cards] [role="img"]')).toHaveCount(2);

    await giveUp();
    await ann.page.getByRole('button', { name: 'Leave table' }).click();
    await expect(ann.page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    expect(await ann.page.evaluate(() => localStorage.getItem('pc.v1.mpTable'))).toBeNull();
    expectNoErrorsBut([ann, bob], SOCKET_NOISE);
  } finally {
    await plug.close();
  }
});

test('a drop in the waiting room: the line, "Offline" for the others, and back', async ({
  telegram,
  baseURL,
}) => {
  test.setTimeout(60_000);
  const plug = await startTcpPlug(Number(new URL(baseURL as string).port));
  try {
    const ann = await telegram.open(newTelegramUser('Ann'), { origin: plug.origin });
    const code = await createTable(ann, { seats: 2, stakes: 'quick', turnSeconds: 60 });
    const bob = await telegram.open(newTelegramUser('Bob'), { startParam: code });
    await expect(ann.page.getByRole('button', { name: 'Start game' })).toBeEnabled();

    plug.pull();
    await expect(ann.page.getByText(CONNECTION_LOST)).toBeVisible();
    await expect(bob.page.getByText('Host · Offline')).toBeVisible();

    plug.insert();
    await expect(ann.page.getByText(CONNECTION_LOST)).toHaveCount(0, { timeout: 20_000 });
    await expect(bob.page.getByText('Host · Offline')).toHaveCount(0);
    await startGame(ann, [ann, bob]);
    expectNoErrorsBut([ann, bob], SOCKET_NOISE);
  } finally {
    await plug.close();
  }
});

test('closing the app and opening it again brings each player back to the same seat', async ({
  telegram,
}) => {
  test.setTimeout(120_000);
  const ann = await telegram.open(newTelegramUser('Ann'));
  const code = await createTable(ann, { seats: 2, stakes: 'quick', turnSeconds: 60 });
  const bob = await telegram.open(newTelegramUser('Bob'), { startParam: code });
  await expect(ann.page.getByRole('button', { name: 'Start game' })).toBeEnabled();
  await startGame(ann, [ann, bob]);
  await expect(ann.page.locator('[data-hero-cards] [role="img"]')).toHaveCount(2);
  const cards = await ownCards(ann.page);

  // Ann launched with no code: only the table this device remembers can bring her back.
  await ann.page.reload();
  await waitForTable(ann.page);
  await expect(ann.page.locator('[data-hero-cards] [role="img"]')).toHaveCount(2);
  expect(await ownCards(ann.page)).toEqual(cards);
  expect(ann.sockets.length).toBe(2);
  await expect(pod(bob.page, 'Ann')).not.toContainText('Offline');

  // A new launch with Telegram's parameters gone from the URL: sessionStorage keeps them (§19.7).
  await ann.page.goto('/');
  await waitForTable(ann.page);
  expect(await ownCards(ann.page)).toEqual(cards);
  expectNoErrorsBut([ann, bob], SOCKET_NOISE);
});

test('opening the game somewhere else stops this window', async ({ telegram }) => {
  test.setTimeout(90_000);
  const user = newTelegramUser('Ann');
  const first = await telegram.open(user);
  const code = await createTable(first, { seats: 2, stakes: 'quick', turnSeconds: 60 });
  const second = await telegram.open(user, { startParam: code });
  await expect(mpHeading(second.page)).toHaveText(`Table ${code}`);
  const dialog = first.page.getByRole('alertdialog');
  await expect(dialog).toContainText(
    'You opened the game in another place. This window has stopped.',
  );
  await dialog.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(first.page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  // The second window still has the seat.
  await expect(mpHeading(second.page)).toHaveText(`Table ${code}`);
  expectNoErrorsBut([first, second], SOCKET_NOISE);
});

test.describe('a table that ends', () => {
  async function seatedOn(
    server: OwnServer,
    telegram: TelegramLauncher,
  ): Promise<TelegramPlayer[]> {
    const ann = await telegram.open(newTelegramUser('Ann'), { origin: server.origin });
    const code = await createTable(ann, { seats: 2, stakes: 'quick', turnSeconds: 60 });
    const bob = await telegram.open(newTelegramUser('Bob'), {
      origin: server.origin,
      startParam: code,
    });
    await expect(ann.page.getByRole('button', { name: 'Start game' })).toBeEnabled();
    await startGame(ann, [ann, bob]);
    return [ann, bob];
  }

  test('the server restarts: everybody is told, and OK goes Home', async ({ telegram }) => {
    test.setTimeout(120_000);
    const server = await startOwnServer({ env: TELEGRAM_SERVER_ENV });
    try {
      const players = await seatedOn(server, telegram);
      await server.terminate();
      for (const player of players) {
        const dialog = player.page.getByRole('alertdialog');
        await expect(dialog).toContainText(
          'The game was updated, so this table ended. Chips are not kept.',
        );
        await player.page.keyboard.press('Escape');
        await expect(dialog).toBeVisible();
        await dialog.getByRole('button', { name: 'OK', exact: true }).click();
        await expect(player.page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
        // A table that ended is not remembered: the next launch does not look for it.
        await expect
          .poll(() => player.page.evaluate(() => localStorage.getItem('pc.v1.mpTable')))
          .toBeNull();
      }
      expectNoErrorsBut(players, SOCKET_NOISE);
    } finally {
      await server.stop();
    }
  });

  test('a restart with no table on: nothing ended, and "Create table" works on the new server', async ({
    telegram,
  }) => {
    test.setTimeout(120_000);
    const port = await freePort();
    let server = await startOwnServer({ port, env: TELEGRAM_SERVER_ENV });
    try {
      const ann = await telegram.open(newTelegramUser('Ann'), { origin: server.origin });
      await ann.page.getByRole('button', { name: 'Play with friends', exact: true }).click();
      await expect(mpHeading(ann.page)).toHaveText('New table');
      await expect.poll(() => ann.sockets.length).toBe(1);

      await server.terminate();
      await expect(ann.page.getByText(CONNECTION_LOST)).toBeVisible();
      await expect(ann.page.getByRole('alertdialog')).toHaveCount(0);

      server = await startOwnServer({ port, env: TELEGRAM_SERVER_ENV });
      await expect(ann.page.getByText(CONNECTION_LOST)).toHaveCount(0, { timeout: 20_000 });
      const code = await fillCreateForm(ann.page, { seats: 2, stakes: 'quick', turnSeconds: 60 });
      expect(code).toHaveLength(8);
      expectNoErrorsBut([ann], SOCKET_NOISE);
    } finally {
      await server.stop();
    }
  });

  test('a table that died while you were away: "This table has ended."', async ({ telegram }) => {
    test.setTimeout(120_000);
    const port = await freePort();
    let server = await startOwnServer({ port, env: TELEGRAM_SERVER_ENV });
    try {
      const players = await seatedOn(server, telegram);
      await server.stop(); // gone without a word: the sockets just die
      for (const player of players) {
        await expect(player.page.getByText(CONNECTION_LOST)).toBeVisible();
      }
      server = await startOwnServer({ port, env: TELEGRAM_SERVER_ENV });
      for (const player of players) {
        const dialog = player.page.getByRole('alertdialog');
        await expect(dialog).toContainText('This table has ended.', { timeout: 30_000 });
        await dialog.getByRole('button', { name: 'OK', exact: true }).click();
        await expect(player.page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
      }
      expectNoErrorsBut(players, SOCKET_NOISE);
    } finally {
      await server.stop();
    }
  });

  test('a table that died while the app was closed: not a word, and the socket closes', async ({
    telegram,
  }) => {
    test.setTimeout(120_000);
    const port = await freePort();
    let server = await startOwnServer({ port, env: TELEGRAM_SERVER_ENV });
    try {
      const [ann] = (await seatedOn(server, telegram)) as [TelegramPlayer, TelegramPlayer];
      const remembered = await ann.page.evaluate(() => localStorage.getItem('pc.v1.mpTable'));
      expect(remembered).not.toBeNull();
      await ann.page.goto('about:blank');
      await server.stop();
      server = await startOwnServer({ port, env: TELEGRAM_SERVER_ENV });

      const before = ann.sockets.length;
      await ann.page.goto(ann.launch);
      await expect.poll(() => ann.sockets.length, { timeout: 15_000 }).toBe(before + 1);
      // Asked by nobody: the app looks, finds the table gone, forgets it and says nothing.
      await expect
        .poll(() => ann.page.evaluate(() => localStorage.getItem('pc.v1.mpTable')), {
          timeout: 15_000,
        })
        .toBeNull();
      await expect(ann.page.getByRole('alertdialog')).toHaveCount(0);
      await expect(ann.page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    } finally {
      await server.stop();
    }
  });
});
