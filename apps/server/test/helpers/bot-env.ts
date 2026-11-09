import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { vi } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { BotApi } from '../../src/bot/bot-api.js';
import { configureApp } from '../../src/setup.js';
import type { FakeBotApi } from './fake-bot-api.js';
import { TEST_BOT_TOKEN } from './sign-init-data.js';

export const TEST_BOT_USERNAME = 'rb_poker_test_bot';
export const TEST_APP_SHORT_NAME = 'play';
/** The direct link those values make. Written out, so the code under test cannot supply it. */
export const TEST_LINK = 'https://t.me/rb_poker_test_bot/play';

export const TELEGRAM_ON = {
  TELEGRAM_BOT_TOKEN: TEST_BOT_TOKEN,
  TELEGRAM_BOT_USERNAME: TEST_BOT_USERNAME,
  TELEGRAM_APP_SHORT_NAME: TEST_APP_SHORT_NAME,
};

/** Turns Telegram on, or off, for what boots next. Undo with `vi.unstubAllEnvs()`. */
export function stubTelegram(on: boolean): void {
  for (const [name, value] of Object.entries(TELEGRAM_ON)) {
    vi.stubEnv(name, on ? value : undefined);
  }
}

/**
 * The real app and the real `configureApp`, with a fake `BotApi`. `Test.createTestingModule` serves
 * no static files (pitfall 45), which these tests do not need.
 */
export async function startWithFakeBotApi(fake: FakeBotApi): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(BotApi)
    .useValue(fake)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app, 'development');
  await app.init();
  return app;
}
