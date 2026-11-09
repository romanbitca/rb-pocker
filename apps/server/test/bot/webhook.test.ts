import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { WEBHOOK_PATH, webhookSecret } from '../../src/bot/webhook.controller.js';
import { TEST_BOT_USERNAME, startWithFakeBotApi, stubTelegram } from '../helpers/bot-env.js';
import { FakeBotApi } from '../helpers/fake-bot-api.js';
import { TEST_BOT_TOKEN } from '../helpers/sign-init-data.js';
import { startApp } from '../start-app.js';

/** PLAN §19.8, Stage 10 acceptance 9 and the bot's half of acceptance 3. */

const HEADER = 'X-Telegram-Bot-Api-Secret-Token';
/** `printf %s 'webhook:<TEST_BOT_TOKEN>' | openssl dgst -sha256`, outside this code base. */
const SECRET = 'b7432831e8ca3be9f8c6f3d136f9b767be49b664ff64867a9fa862d381253212';

const update = (id: number, text = '/help') => ({
  update_id: id,
  message: { message_id: 1, chat: { id: 5, type: 'private' }, text },
});

/** Two event-loop turns: whatever `handleUpdate` would still do has been done. */
async function settle(): Promise<void> {
  await new Promise((done) => setImmediate(done));
  await new Promise((done) => setImmediate(done));
}

describe('POST /api/telegram/webhook', () => {
  it('has the path of §19.8 and the secret of §19.8', () => {
    expect(WEBHOOK_PATH).toBe('/api/telegram/webhook');
    expect(webhookSecret(TEST_BOT_TOKEN)).toBe(SECRET);
    expect(SECRET).toMatch(/^[0-9a-f]{64}$/);
  });

  describe('with Telegram on', () => {
    let app: NestExpressApplication;
    let api: FakeBotApi;

    const post = (path = WEBHOOK_PATH) => request(app.getHttpServer()).post(path);
    const postJson = (body: string) =>
      post().set(HEADER, SECRET).set('Content-Type', 'application/json').send(body);

    beforeAll(async () => {
      stubTelegram(true);
      api = new FakeBotApi();
      app = await startWithFakeBotApi(api);
      vi.unstubAllEnvs();
    });

    afterAll(async () => {
      await app.close();
    });

    beforeEach(() => {
      api.calls.length = 0;
      api.respond = () => Promise.resolve();
    });

    describe('without the right secret: 401, and nothing happens', () => {
      it.each<[string, string | undefined]>([
        ['no header', undefined],
        ['an empty header', ''],
        ['a wrong secret', 'f'.repeat(64)],
        ['the secret of another bot', webhookSecret('999:another-bot')],
        ['the secret cut short', SECRET.slice(0, 63)],
        ['the secret with one more character', `${SECRET}0`],
        ['the secret in capitals', SECRET.toUpperCase()],
        ['the token itself', TEST_BOT_TOKEN],
        ['non-ASCII of the same character count', 'ÿ'.repeat(64)],
      ])('%s', async (_name, secret) => {
        const req = post();
        const res = await (secret === undefined ? req : req.set(HEADER, secret)).send(update(1));
        await settle();

        expect(res.status).toBe(401);
        expect(api.calls).toEqual([]);
      });

      it.each([`${WEBHOOK_PATH}/`, `${WEBHOOK_PATH}?x=1`, '/API/TELEGRAM/WEBHOOK'])(
        'on every spelling of the route: %s',
        async (path) => {
          const res = await post(path).send(update(1));
          await settle();

          expect(res.status).toBe(401);
          expect(api.calls).toEqual([]);
        },
      );

      it('says nothing but that', async () => {
        const res = await post().send(update(1));

        expect(res.body).toEqual({ statusCode: 401, message: 'Unauthorized' });
        expect(res.text).not.toContain(TEST_BOT_TOKEN);
        expect(res.text).not.toContain(SECRET);
      });

      it('keeps the /api headers: never cached', async () => {
        const res = await post().send(update(1));

        expect(res.headers['cache-control']).toBe('no-store');
        expect(res.headers['x-content-type-options']).toBe('nosniff');
      });
    });

    describe('the body of a caller without the secret is not read', () => {
      const BROKEN_JSON = '{"update_id":';
      const OVER_THE_PARSER_LIMIT = JSON.stringify({ padding: 'x'.repeat(200_000) });

      it.each([
        ['broken JSON, which the parser would answer with 400', BROKEN_JSON],
        ['too much of it, which the parser would answer with 413', OVER_THE_PARSER_LIMIT],
      ])('%s', async (_name, body) => {
        const res = await post().set('Content-Type', 'application/json').send(body);

        expect(res.status).toBe(401);
      });

      it('the parser does stand behind the check: with the secret those are 400 and 413', async () => {
        expect((await postJson(BROKEN_JSON)).status).toBe(400);
        expect((await postJson(OVER_THE_PARSER_LIMIT)).status).toBe(413);
      });
    });

    describe('with the right secret', () => {
      it('answers 200 with no body and sends the reply', async () => {
        const res = await post().set(HEADER, SECRET).send(update(100));

        expect(res.status).toBe(200);
        expect(res.text).toBe('');
        await vi.waitFor(() => {
          expect(api.methods()).toEqual(['sendMessage']);
        });
      });

      it('handles a group command named for this bot', async () => {
        const res = await post()
          .set(HEADER, SECRET)
          .send(update(101, `/new@${TEST_BOT_USERNAME}`));

        expect(res.status).toBe(200);
        await vi.waitFor(() => {
          expect(api.methods()).toEqual(['sendMessage']);
        });
      });

      it('answers a repeated update_id once', async () => {
        const first = await post().set(HEADER, SECRET).send(update(102));
        const second = await post().set(HEADER, SECRET).send(update(102));
        await settle();

        expect([first.status, second.status]).toEqual([200, 200]);
        expect(api.calls).toHaveLength(1);
      });

      it('answers at once: the 200 does not wait for Telegram', async () => {
        api.respond = () => new Promise(() => undefined); // Never answers.

        const res = await post().set(HEADER, SECRET).send(update(103));

        expect(res.status).toBe(200);
        expect(api.calls).toHaveLength(1);
      });

      it('is 200 for an update it does not understand, so Telegram does not retry', async () => {
        const res = await post().set(HEADER, SECRET).send({ nothing: 'useful' });

        expect(res.status).toBe(200);
        expect(api.calls).toEqual([]);
      });

      it('is 200 for a body that is not JSON at all', async () => {
        const res = await post().set(HEADER, SECRET).set('Content-Type', 'text/plain').send('hi');

        expect(res.status).toBe(200);
        expect(api.calls).toEqual([]);
      });
    });

    describe('a failing Telegram API never takes the server down', () => {
      it.each<[string, number, () => Promise<void>]>([
        ['rejects', 200, () => Promise.reject(new Error('Telegram is down'))],
        [
          'throws',
          201,
          () => {
            throw new Error('boom');
          },
        ],
      ])('Telegram sees 200 when a call %s, and the server goes on', async (_name, id, respond) => {
        api.respond = respond;

        const res = await post().set(HEADER, SECRET).send(update(id));
        await settle();

        expect(res.status).toBe(200);
        expect(api.calls).toHaveLength(1);
        expect((await request(app.getHttpServer()).get('/api/health')).status).toBe(200);
      });

      it('and answers the next update', async () => {
        api.respond = () => Promise.reject(new Error('Telegram is down'));
        await post().set(HEADER, SECRET).send(update(300));
        await settle();

        api.respond = () => Promise.resolve();
        await post().set(HEADER, SECRET).send(update(301));

        await vi.waitFor(() => {
          expect(api.calls).toHaveLength(2);
        });
      });
    });
  });

  describe('with Telegram off (acceptance 3)', () => {
    let app: NestExpressApplication;
    const fetchSpy = vi.fn(() => Promise.reject(new Error('no network in tests')));

    const post = (path: string) => request(app.getHttpServer()).post(path);

    beforeAll(async () => {
      stubTelegram(false);
      vi.stubGlobal('fetch', fetchSpy);
      app = await startApp('development');
    });

    afterAll(async () => {
      await app.close();
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    });

    it('is the same 404 as a route that does not exist', async () => {
      const res = await post(WEBHOOK_PATH).set(HEADER, SECRET).send(update(1));
      const unknown = await post('/api/telegram/other').send(update(1));
      await settle();

      expect(res.status).toBe(404);
      expect(res.headers['content-type']).toMatch(/^application\/json/);
      expect(res.body).toEqual({
        statusCode: 404,
        error: 'Not Found',
        message: 'Cannot POST /api/telegram/webhook',
      });
      expect(unknown.status).toBe(404);
      expect(Object.keys(res.body as object).sort()).toEqual(
        Object.keys(unknown.body as object).sort(),
      );
    });

    it('is a 404 with no secret as well, not a 401', async () => {
      const res = await post(WEBHOOK_PATH).send(update(2));

      expect(res.status).toBe(404);
    });

    it('has never called the bot API, at boot or for any request above', async () => {
      await post(WEBHOOK_PATH).set(HEADER, SECRET).send(update(3));
      await settle();

      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
