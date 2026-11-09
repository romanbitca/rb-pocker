import { inspect } from 'node:util';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TelegramConfig } from '../../src/telegram/config.js';
import { TelegramModule } from '../../src/telegram/telegram.module.js';
import { TEST_BOT_TOKEN } from '../helpers/sign-init-data.js';
import { startApp } from '../start-app.js';

/** PLAN §19.3: `enabled` only with all three values; the token never reaches a log. */

const ALL = {
  TELEGRAM_BOT_TOKEN: TEST_BOT_TOKEN,
  TELEGRAM_BOT_USERNAME: 'rb_poker_test_bot',
  TELEGRAM_APP_SHORT_NAME: 'play',
};

describe('TelegramConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('is on with all three values, and gives them back', () => {
    const config = new TelegramConfig(ALL);

    expect(config.enabled).toBe(true);
    expect(config.botToken).toBe(TEST_BOT_TOKEN);
    expect(config.botUsername).toBe('rb_poker_test_bot');
    expect(config.appShortName).toBe('play');
    expect(config.missing).toEqual([]);
  });

  it('is off with nothing set', () => {
    const config = new TelegramConfig({});

    expect(config.enabled).toBe(false);
    expect(config.botToken).toBe('');
    expect(config.botUsername).toBe('');
    expect(config.appShortName).toBe('');
  });

  it.each(Object.keys(ALL))('is off without %s, and then holds no value at all', (name) => {
    const config = new TelegramConfig({ ...ALL, [name]: undefined });

    expect(config.enabled).toBe(false);
    expect(config.missing).toEqual([name]);
    expect(config.botToken).toBe('');
    expect(config.botUsername).toBe('');
    expect(config.appShortName).toBe('');
  });

  it.each(['', '   ', '\n'])('treats a value of %j as not set', (blank) => {
    expect(new TelegramConfig({ ...ALL, TELEGRAM_BOT_TOKEN: blank }).enabled).toBe(false);
  });

  it('trims what was pasted, and drops the @ of a username', () => {
    const config = new TelegramConfig({
      TELEGRAM_BOT_TOKEN: ` ${TEST_BOT_TOKEN}\n`,
      TELEGRAM_BOT_USERNAME: '@rb_poker_test_bot ',
      TELEGRAM_APP_SHORT_NAME: ' play',
    });

    expect(config.botToken).toBe(TEST_BOT_TOKEN);
    expect(config.botUsername).toBe('rb_poker_test_bot');
    expect(config.appShortName).toBe('play');
  });

  it.each([
    [undefined, 'https://poker.romanbitca.com'],
    ['', 'https://poker.romanbitca.com'],
    ['https://example.test', 'https://example.test'],
    ['https://example.test/', 'https://example.test'],
  ])('PUBLIC_URL %j is %s', (PUBLIC_URL, expected) => {
    expect(new TelegramConfig({ ...ALL, PUBLIC_URL }).publicUrl).toBe(expected);
  });

  it.each([
    ['production', true],
    ['development', false],
    ['test', false],
    [undefined, false],
  ])('NODE_ENV %j: production is %s', (NODE_ENV, expected) => {
    expect(new TelegramConfig({ ...ALL, NODE_ENV }).production).toBe(expected);
  });

  describe('invite', () => {
    const config = new TelegramConfig(ALL);

    it('is the direct link, with no startapp when there is no parameter', () => {
      expect(config.invite()).toBe('https://t.me/rb_poker_test_bot/play');
    });

    it('carries the parameter as startapp', () => {
      expect(config.invite('ABCD2345')).toBe(
        'https://t.me/rb_poker_test_bot/play?startapp=ABCD2345',
      );
    });
  });

  describe('statusLine', () => {
    it('says on or off and names what is missing, never a value', () => {
      expect(new TelegramConfig(ALL).statusLine()).toBe('Telegram is on.');
      expect(new TelegramConfig({}).statusLine()).toBe('Telegram is off.');
      expect(new TelegramConfig({ ...ALL, TELEGRAM_BOT_USERNAME: '' }).statusLine()).toBe(
        'Telegram is off: TELEGRAM_BOT_USERNAME not set.',
      );
      expect(
        new TelegramConfig({
          TELEGRAM_BOT_TOKEN: TEST_BOT_TOKEN,
        }).statusLine(),
      ).toBe('Telegram is off: TELEGRAM_BOT_USERNAME, TELEGRAM_APP_SHORT_NAME not set.');
    });
  });

  it('never shows the token when the object is printed', () => {
    const config = new TelegramConfig(ALL);

    expect(JSON.stringify(config)).not.toContain(TEST_BOT_TOKEN);
    expect(inspect(config, { depth: null, showHidden: true })).not.toContain(TEST_BOT_TOKEN);
    expect(String(config)).not.toContain(TEST_BOT_TOKEN);
    expect(config.statusLine()).not.toContain(TEST_BOT_TOKEN);
  });

  describe('TelegramModule', () => {
    function stubAll(): void {
      for (const [name, value] of Object.entries(ALL)) vi.stubEnv(name, value);
    }

    async function boot() {
      const log = vi.spyOn(Logger.prototype, 'log');
      const moduleRef = await Test.createTestingModule({ imports: [TelegramModule] }).compile();
      await moduleRef.init();
      const lines = log.mock.calls.map(([message]) => String(message));
      await moduleRef.close();
      return { config: moduleRef.get(TelegramConfig), lines };
    }

    it('reads the environment and exports TelegramConfig', async () => {
      stubAll();

      const { config } = await boot();

      expect(config.enabled).toBe(true);
      expect(config.botToken).toBe(TEST_BOT_TOKEN);
    });

    it('logs one line at boot, without the token', async () => {
      stubAll();

      const { lines } = await boot();

      expect(lines.filter((line) => line.startsWith('Telegram is'))).toEqual(['Telegram is on.']);
      expect(lines.join('\n')).not.toContain(TEST_BOT_TOKEN);
    });

    it('says it is off when it is', async () => {
      vi.stubEnv('TELEGRAM_BOT_TOKEN', undefined);
      vi.stubEnv('TELEGRAM_BOT_USERNAME', undefined);
      vi.stubEnv('TELEGRAM_APP_SHORT_NAME', undefined);

      const { config, lines } = await boot();

      expect(config.enabled).toBe(false);
      expect(lines.filter((line) => line.startsWith('Telegram is'))).toEqual(['Telegram is off.']);
    });

    it('is part of the app, and the app starts with or without Telegram', async () => {
      stubAll();
      const on = await startApp('development');
      const enabledWithToken = on.get(TelegramConfig).enabled;
      await on.close();

      vi.unstubAllEnvs();
      const off = await startApp('development');
      const enabledWithout = off.get(TelegramConfig).enabled;
      await off.close();

      expect(enabledWithToken).toBe(true);
      expect(enabledWithout).toBe(false);
    });
  });
});
