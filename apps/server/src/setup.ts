import type { NestExpressApplication } from '@nestjs/platform-express';
import { apiNoStore, securityHeaders } from './security.js';

/**
 * App-wide HTTP settings, shared by main.ts and the HTTP tests so the tests exercise the real
 * setup (PLAN §2.6). `nodeEnv` only decides HSTS (production only, §17.2); main.ts leaves it to
 * the environment and the tests pass it.
 */
export function configureApp(app: NestExpressApplication, nodeEnv = process.env.NODE_ENV): void {
  app.disable('x-powered-by');
  // Registered before init(), so they run first for every request: API routes, static files,
  // the SPA fallback and the 404s.
  app.use(...securityHeaders(nodeEnv));
  app.use('/api', apiNoStore);
  app.setGlobalPrefix('api');
}
