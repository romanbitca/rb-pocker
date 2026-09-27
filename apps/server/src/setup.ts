import type { NestExpressApplication } from '@nestjs/platform-express';

/**
 * App-wide HTTP settings, shared by main.ts and the HTTP tests so the tests exercise the real
 * setup (PLAN §2.6).
 */
export function configureApp(app: NestExpressApplication): void {
  app.disable('x-powered-by');
  app.setGlobalPrefix('api');
}
