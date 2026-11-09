import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { type MockInstance, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BotApi, BotApiError } from '../../src/bot/bot-api.js';
import { BotModule } from '../../src/bot/bot.module.js';
import { BotRegistration } from '../../src/bot/registration.js';
import { TelegramConfig } from '../../src/telegram/config.js';
import { TELEGRAM_ON, startWithFakeBotApi, stubTelegram } from '../helpers/bot-env.js';
import { FakeBotApi } from '../helpers/fake-bot-api.js';
import { TEST_BOT_TOKEN } from '../helpers/sign-init-data.js';
import { startApp } from '../start-app.js';

/** PLAN §19.8, Stage 10 acceptance 9: at boot in production, and not otherwise. */

/** `printf %s 'webhook:<TEST_BOT_TOKEN>' | openssl dgst -sha256`, outside this code base. */
const SECRET = 'b7432831e8ca3be9f8c6f3d136f9b767be49b664ff64867a9fa862d381253212';

const THREE_CALLS = ['setWebhook', 'setMyCommands', 'setChatMenuButton'];

function expectedCalls(publicUrl: string) {
  return [
    {
      method: 'setWebhook',
      params: {
        url: `${publicUrl}/api/telegram/webhook`,
        secret_token: SECRET,
        allowed_updates: ['message', 'inline_query'],
        drop_pending_updates: true,
      },
    },
    {
      method: 'setMyCommands',
      params: {
        commands: [
          { command: 'start', description: 'Open the game' },
          { command: 'new', description: 'Make a table for friends' },
          { command: 'help', description: 'How it works' },
          { command: 'post', description: 'A message for your channel' },
        ],
      },
    },
    {
      method: 'setChatMenuButton',
      params: { menu_button: { type: 'web_app', text: 'Play', web_app: { url: publicUrl } } },
    },
  ];
}

describe('bot registration', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('at boot, through Nest', () => {
    let moduleRef: TestingModule | undefined;

    async function boot(api: FakeBotApi): Promise<void> {
      moduleRef = await Test.createTestingModule({ imports: [BotModule] })
        .overrideProvider(BotApi)
        .useValue(api)
        .compile();
      await moduleRef.init();
    }

    afterEach(async () => {
      await moduleRef?.close();
      moduleRef = undefined;
    });

    it('runs in production with the config: the three calls of §19.8, exactly', async () => {
      stubTelegram(true);
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('PUBLIC_URL', undefined);
      const api = new FakeBotApi();

      await boot(api);

      await vi.waitFor(() => {
        expect(api.calls).toEqual(expectedCalls('https://poker.romanbitca.com'));
      });
    });

    it('uses PUBLIC_URL when it is set', async () => {
      stubTelegram(true);
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('PUBLIC_URL', 'https://example.test/');
      const api = new FakeBotApi();

      await boot(api);

      await vi.waitFor(() => {
        expect(api.calls).toEqual(expectedCalls('https://example.test'));
      });
    });

    it.each([['development'], ['test'], [undefined]])(
      'does not run when NODE_ENV is %s',
      async (nodeEnv) => {
        stubTelegram(true);
        vi.stubEnv('NODE_ENV', nodeEnv);
        const api = new FakeBotApi();

        await boot(api);

        await new Promise((done) => setImmediate(done));
        expect(api.calls).toEqual([]);
      },
    );

    it('does not run in production without the config', async () => {
      stubTelegram(false);
      vi.stubEnv('NODE_ENV', 'production');
      const api = new FakeBotApi();

      await boot(api);

      await new Promise((done) => setImmediate(done));
      expect(api.calls).toEqual([]);
    });
  });

  describe('the whole app', () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('no network in tests')));

    beforeEach(() => {
      fetchSpy.mockClear();
      vi.stubGlobal('fetch', fetchSpy);
    });

    it('`npm start` with a token (no NODE_ENV) never calls Telegram', async () => {
      stubTelegram(true);
      vi.stubEnv('NODE_ENV', undefined);

      const app = await startApp('development');
      await new Promise((done) => setImmediate(done));
      await app.close();

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('in production without a token never calls Telegram', async () => {
      stubTelegram(false);
      vi.stubEnv('NODE_ENV', 'production');

      const app = await startApp('production');
      await new Promise((done) => setImmediate(done));
      await app.close();

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('a failing Telegram at boot does not stop the server', async () => {
      stubTelegram(true);
      vi.stubEnv('NODE_ENV', 'production');
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const api = new FakeBotApi();
      api.respond = () => Promise.reject(new BotApiError('setWebhook', 500));

      const app = await startWithFakeBotApi(api);
      await vi.waitFor(() => {
        expect(warn.mock.calls.flat().join()).toContain('Telegram registration');
      });
      const health = await request(app.getHttpServer()).get('/api/health');
      await app.close(); // Clears the waiting retry: nothing keeps the process alive.

      expect(health.status).toBe(200);
    });
  });

  describe('retries', () => {
    const production = new TelegramConfig({ ...TELEGRAM_ON, NODE_ENV: 'production' });
    let api: FakeBotApi;
    let registration: BotRegistration;
    let warn: MockInstance<Logger['warn']>;

    const lines = (): string[] => warn.mock.calls.map(([message]) => String(message));

    beforeEach(() => {
      vi.useFakeTimers();
      warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      api = new FakeBotApi();
      registration = new BotRegistration(production, api);
    });

    async function start(): Promise<void> {
      registration.onApplicationBootstrap();
      await vi.advanceTimersByTimeAsync(0);
    }

    it('tries again after 5 s, 30 s and 120 s, then gives up', async () => {
      api.respond = () => Promise.reject(new BotApiError('setWebhook', 502));

      await start();
      expect(api.calls).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(4_999);
      expect(api.calls).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(api.calls).toHaveLength(2);

      await vi.advanceTimersByTimeAsync(29_999);
      expect(api.calls).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(api.calls).toHaveLength(3);

      await vi.advanceTimersByTimeAsync(119_999);
      expect(api.calls).toHaveLength(3);
      await vi.advanceTimersByTimeAsync(1);
      expect(api.calls).toHaveLength(4);

      await vi.advanceTimersByTimeAsync(3_600_000);
      expect(api.calls).toHaveLength(4);
    });

    it('logs each failure in one line, without the token', async () => {
      api.respond = () => Promise.reject(new BotApiError('setWebhook', 502));

      await start();
      await vi.advanceTimersByTimeAsync(3_600_000);

      expect(lines()).toEqual([
        'Telegram registration: setWebhook failed (HTTP 502); next try in 5 s.',
        'Telegram registration: setWebhook failed (HTTP 502); next try in 30 s.',
        'Telegram registration: setWebhook failed (HTTP 502); next try in 120 s.',
        'Telegram registration: setWebhook failed (HTTP 502); giving up.',
      ]);
      expect(lines().join('\n')).not.toContain(TEST_BOT_TOKEN);
    });

    it('never logs the text of an error it did not make: it could hold the token', async () => {
      const url = `https://api.telegram.org/bot${TEST_BOT_TOKEN}/setWebhook`;
      api.respond = () => Promise.reject(new TypeError(`Failed to parse URL from ${url}`));

      await start();

      expect(lines()).toEqual(['Telegram registration: unexpected error; next try in 5 s.']);
    });

    it('goes on from the step that failed: setWebhook would drop updates again', async () => {
      let setMyCommandsFailures = 1;
      api.respond = (method) => {
        if (method !== 'setMyCommands' || setMyCommandsFailures === 0) return Promise.resolve();
        setMyCommandsFailures -= 1;
        return Promise.reject(new BotApiError(method, null));
      };

      await start();
      expect(api.methods()).toEqual(['setWebhook', 'setMyCommands']);

      await vi.advanceTimersByTimeAsync(5_000);
      expect(api.methods()).toEqual([
        'setWebhook',
        'setMyCommands',
        'setMyCommands',
        'setChatMenuButton',
      ]);
    });

    it('stops once all three worked: no retry is left waiting', async () => {
      await start();
      expect(api.methods()).toEqual(THREE_CALLS);

      await vi.advanceTimersByTimeAsync(3_600_000);

      expect(api.methods()).toEqual(THREE_CALLS);
      expect(lines()).toEqual([]);
    });

    it('survives a call that throws at once', async () => {
      api.respond = () => {
        throw new Error('boom');
      };

      await expect(start()).resolves.toBeUndefined();

      expect(lines()).toEqual(['Telegram registration: unexpected error; next try in 5 s.']);
    });

    it('stops when the server shuts down', async () => {
      api.respond = () => Promise.reject(new BotApiError('setWebhook', null));
      await start();
      expect(api.calls).toHaveLength(1);

      registration.onModuleDestroy();
      await vi.advanceTimersByTimeAsync(3_600_000);

      expect(api.calls).toHaveLength(1);
    });

    it('does not hold up the boot', async () => {
      api.respond = () => new Promise(() => undefined); // Telegram never answers.

      expect(() => {
        registration.onApplicationBootstrap();
      }).not.toThrow();
      await vi.advanceTimersByTimeAsync(0);

      expect(api.methods()).toEqual(['setWebhook']);
    });

    it('is a no-op when Telegram is off, even in production', async () => {
      registration = new BotRegistration(new TelegramConfig({ NODE_ENV: 'production' }), api);

      await start();

      expect(api.calls).toEqual([]);
    });
  });
});
