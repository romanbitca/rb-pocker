import { createHmac, randomBytes, randomInt } from 'node:crypto';

/**
 * Telegram in the end-to-end tests (PLAN §19.10, chunk 10.10). There is no backdoor in the server
 * (§19.1 decision 4): a test signs a real `initData` with the test token of `playwright.config.ts`
 * and opens the app with Telegram's launch parameters in the URL fragment (§19.2). Its own code, on
 * purpose: nothing here comes from the server's check or the app's parser, so a mistake in either
 * cannot hide behind the same mistake here.
 *
 * Also the stand-in for the Telegram client: what the app says to Telegram is written down, so a
 * spec can read the invite the host would have shared.
 */

/** Not a real bot's token. The shape BotFather gives: digits, a colon, then the secret. */
export const TEST_BOT_TOKEN = '1234567890:E2E-only-not-a-real-bot-token_abcdef';
export const TEST_BOT_USERNAME = 'rb_poker_e2e_bot';
export const TEST_APP_SHORT_NAME = 'play';

/**
 * What turns Telegram and multiplayer on in a server (§19.3). No `NODE_ENV`: no registration, so a
 * test never calls Telegram. An app without launch parameters in its URL is still the plain web app.
 */
export const TELEGRAM_SERVER_ENV: Readonly<Record<string, string>> = {
  TELEGRAM_BOT_TOKEN: TEST_BOT_TOKEN,
  TELEGRAM_BOT_USERNAME: TEST_BOT_USERNAME,
  TELEGRAM_APP_SHORT_NAME: TEST_APP_SHORT_NAME,
};

/** As Telegram's JSON has it. */
export interface TelegramUser {
  readonly id: number;
  readonly first_name: string;
  readonly last_name?: string;
  readonly username?: string;
  readonly photo_url?: string;
  readonly language_code?: string;
}

/**
 * A Telegram user nobody else in this test run is: every table, seat and limit of the server is
 * keyed by this id, and all the specs share one server. The profile has the fields a real one has,
 * so the leak spec can look for them.
 */
export function newTelegramUser(firstName: string): TelegramUser {
  const id = randomInt(100_000_000, 999_999_999);
  return {
    id,
    first_name: firstName,
    last_name: `Last${id}`,
    username: `user_${id}`,
    photo_url: `https://t.me/i/userpic/320/${id}.jpg`,
    language_code: 'en',
  };
}

export interface LaunchOptions {
  /** `start_param`: a table code, or `new` (§19.6). */
  readonly startParam?: string;
  /** Default: now. */
  readonly authDate?: number;
  readonly token?: string;
}

/** The §19.2 rule: every field but `hash`, sorted, `key=value`, joined with a line feed. */
function hashOf(fields: Readonly<Record<string, string>>, token: string): string {
  const checkString = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key] ?? ''}`)
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(token).digest();
  return createHmac('sha256', secretKey).update(checkString).digest('hex');
}

/** The `initData` of a launch: percent-encoded as Telegram sends it (`%20`, not `+`). */
export function signInitData(user: TelegramUser, options: LaunchOptions = {}): string {
  const fields: Record<string, string> = {
    // New for every launch, as Telegram's: `auth_date` alone can repeat within a second.
    query_id: `AAH${randomBytes(12).toString('base64url')}`,
    auth_date: String(options.authDate ?? Math.floor(Date.now() / 1000)),
    user: JSON.stringify(user),
    // Ed25519 for third parties: not checked by us, but covered by the hash (§19.2).
    signature: 'c2lnbmF0dXJlLWZvci10aGlyZC1wYXJ0aWVz',
    ...(options.startParam === undefined ? {} : { start_param: options.startParam }),
  };
  const hash = hashOf(fields, options.token ?? TEST_BOT_TOKEN);
  return Object.entries({ ...fields, hash })
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
}

/** The URL fragment Telegram opens a Mini App with (§19.2, §19.10). */
export function launchFragment(initData: string): string {
  return `#tgWebAppData=${encodeURIComponent(initData)}&tgWebAppVersion=9.1&tgWebAppPlatform=tdesktop`;
}

/** One event the app sent the Telegram client; `data` as it was sent (`''` for none). */
export interface TelegramEvent {
  readonly type: string;
  readonly data: unknown;
}

declare global {
  interface Window {
    /** The stand-in's record (`telegramStandIn`). */
    __tgEvents?: TelegramEvent[];
    /** Every toast that came on screen, in order (`toastWatch`). */
    __toastLog?: string[];
  }
}

/**
 * An init script: the client's `TelegramWebviewProxy` transport (§19.2), keeping what it is told.
 * It answers nothing: the app must not wait for Telegram to say anything before it plays.
 */
export function telegramStandIn(): void {
  const events: TelegramEvent[] = [];
  Object.defineProperty(window, '__tgEvents', { value: events });
  Object.defineProperty(window, 'TelegramWebviewProxy', {
    value: {
      postEvent(type: string, data: string) {
        events.push({ type, data: JSON.parse(data) as unknown });
      },
    },
  });
}

/**
 * An init script: writes down every toast that comes on screen. A toast lasts 4 seconds and the
 * table does not wait, so a spec on a busy machine can look a moment too late (or too early).
 */
export function toastWatch(): void {
  const log: string[] = [];
  Object.defineProperty(window, '__toastLog', { value: log });
  new MutationObserver((records) => {
    for (const { addedNodes } of records) {
      for (const node of addedNodes) {
        if (node instanceof HTMLElement && node.matches('[aria-live="polite"] > button')) {
          log.push(node.textContent ?? '');
        }
      }
    }
  }).observe(document, { subtree: true, childList: true });
}
