import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/setup.js';

/**
 * Boots the app the way main.ts does, minus `listen()` (supertest takes the HTTP server).
 *
 * Not `Test.createTestingModule()`: it creates the providers before any HTTP adapter exists, so
 * @nestjs/serve-static silently picks its no-op loader and serves no files (PLAN pitfall 45).
 * `nodeEnv` undefined: configureApp() reads NODE_ENV itself, as in main.ts.
 */
export async function startApp(nodeEnv?: string): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: false,
    abortOnError: false,
  });
  configureApp(app, nodeEnv);
  await app.init();
  return app;
}
