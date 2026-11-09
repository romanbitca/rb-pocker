import { inspect } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BotApi, BotApiError } from '../../src/bot/bot-api.js';
import { TelegramConfig } from '../../src/telegram/config.js';
import { TELEGRAM_ON } from '../helpers/bot-env.js';
import { TEST_BOT_TOKEN } from '../helpers/sign-init-data.js';

/** The one place the token goes into a URL (PLAN §19.8, §19.9). `fetch` is a stub: no network. */

const answer = (status: number): Response => new Response('{"ok":true}', { status });

function stubFetch(impl: () => Promise<Response>) {
  const fetchSpy = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(impl);
  vi.stubGlobal('fetch', fetchSpy);
  return fetchSpy;
}

/** Everything an error shows when printed, its cause and stack included. */
const printed = (error: unknown): string =>
  `${String(error)}\n${inspect(error, { depth: null, showHidden: true })}`;

describe('BotApi', () => {
  const api = new BotApi(new TelegramConfig(TELEGRAM_ON));
  const keyboard = { inline_keyboard: [[{ text: 'Play', url: 'https://t.me/x/y' }]] };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each<[string, () => Promise<void>, object]>([
    [
      'sendMessage',
      () => api.sendMessage({ chat_id: 1, text: 'hi', reply_markup: keyboard }),
      { chat_id: 1, text: 'hi', reply_markup: keyboard },
    ],
    [
      'answerInlineQuery',
      () =>
        api.answerInlineQuery({
          inline_query_id: 'q',
          results: [],
          cache_time: 0,
          is_personal: true,
        }),
      { inline_query_id: 'q', results: [], cache_time: 0, is_personal: true },
    ],
    [
      'setWebhook',
      () =>
        api.setWebhook({
          url: 'https://x.test/hook',
          secret_token: 's',
          allowed_updates: ['message'],
          drop_pending_updates: true,
        }),
      {
        url: 'https://x.test/hook',
        secret_token: 's',
        allowed_updates: ['message'],
        drop_pending_updates: true,
      },
    ],
    [
      'setMyCommands',
      () => api.setMyCommands({ commands: [{ command: 'new', description: 'd' }] }),
      { commands: [{ command: 'new', description: 'd' }] },
    ],
    [
      'setChatMenuButton',
      () =>
        api.setChatMenuButton({
          menu_button: { type: 'web_app', text: 'Play', web_app: { url: 'https://x.test' } },
        }),
      { menu_button: { type: 'web_app', text: 'Play', web_app: { url: 'https://x.test' } } },
    ],
  ])('%s posts JSON to its method', async (method, call, params) => {
    const fetchSpy = stubFetch(() => Promise.resolve(answer(200)));

    await expect(call()).resolves.toBeUndefined();

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe(`https://api.telegram.org/bot${TEST_BOT_TOKEN}/${method}`);
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({ 'content-type': 'application/json' });
    expect(JSON.parse(String(init?.body))).toEqual(params);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  const failingCall = () => api.setMyCommands({ commands: [] });

  async function errorOf(): Promise<unknown> {
    return failingCall().then(
      () => {
        throw new Error('it should have failed');
      },
      (error: unknown) => error,
    );
  }

  it.each([400, 401, 404, 429, 500, 502])(
    'an HTTP %i answer is a BotApiError with that status',
    async (status) => {
      stubFetch(() => Promise.resolve(answer(status)));

      const error = await errorOf();

      expect(error).toBeInstanceOf(BotApiError);
      expect(error).toMatchObject({ method: 'setMyCommands', status });
      expect((error as Error).message).toBe(`setMyCommands failed (HTTP ${String(status)})`);
      expect(printed(error)).not.toContain(TEST_BOT_TOKEN);
    },
  );

  it('a network failure is a BotApiError with no status and nothing of the URL', async () => {
    const url = `https://api.telegram.org/bot${TEST_BOT_TOKEN}/setMyCommands`;
    stubFetch(() =>
      Promise.reject(
        new TypeError(`Failed to parse URL from ${url}`, { cause: new Error(`bad ${url}`) }),
      ),
    );

    const error = await errorOf();

    expect(error).toBeInstanceOf(BotApiError);
    expect(error).toMatchObject({ method: 'setMyCommands', status: null });
    expect((error as Error).message).toBe('setMyCommands failed (no answer)');
    expect((error as Error).cause).toBeUndefined();
    expect(printed(error)).not.toContain(TEST_BOT_TOKEN);
  });

  it('an answer that breaks while being read fails too, and keeps the status', async () => {
    stubFetch(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        arrayBuffer: () => Promise.reject(new Error('connection reset')),
      } as Response),
    );

    await expect(errorOf()).resolves.toMatchObject({ status: 200 });
  });
});
