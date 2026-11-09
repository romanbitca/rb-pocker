import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { rawUpgrade, SOCKET_TEST_TIMEOUT_MS, startMpApp, type MpApp } from '../helpers/mp-app.js';
import { MP_WS_PATH } from '../../src/game/net/protocol.js';

vi.setConfig({ testTimeout: SOCKET_TEST_TIMEOUT_MS, hookTimeout: SOCKET_TEST_TIMEOUT_MS });

/** PLAN §19.3, Stage 10 acceptance 3 (the server's half). */
describe('with no TELEGRAM_BOT_TOKEN', () => {
  let mp: MpApp;

  beforeAll(async () => {
    mp = await startMpApp({ on: false });
  });

  afterAll(async () => {
    await mp.app.close();
  });

  it('the upgrade on the socket path is refused with a plain 404', async () => {
    const answer = await rawUpgrade(mp.port, MP_WS_PATH);
    expect(answer.status).toBe(404);
    expect(answer.socket).toBeUndefined();
    expect(answer.body).toContain('"statusCode":404');
  });

  it('a real WebSocket cannot connect', async () => {
    const ws = new WebSocket(mp.url);
    const failed = await new Promise<boolean>((resolve) => {
      ws.addEventListener('open', () => {
        resolve(false);
      });
      ws.addEventListener('error', () => {
        resolve(true);
      });
    });
    expect(failed).toBe(true);
    ws.close();
  });

  it('POST /api/telegram/webhook is a 404', async () => {
    const response = await fetch(`http://127.0.0.1:${mp.port}/api/telegram/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(404);
  });

  it('the bot API was never called', () => {
    expect(mp.bot.calls).toEqual([]);
  });

  it('no timer was started for a table that cannot exist', () => {
    expect(mp.clock.pending).toBe(0);
  });
});
