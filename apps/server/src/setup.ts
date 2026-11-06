import type { NestExpressApplication } from '@nestjs/platform-express';
import compression from 'compression';
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
  // Text responses of 1 KB or more go out compressed (gzip or brotli, as the browser asks), so a
  // first visit downloads the initial JS as about 135 KB, not 425 KB (§17.2, chunk 9.7). Behind
  // Cloudflare or Coolify's Traefik nothing changes: they pass an encoded response through.
  app.use(compression());
  app.use(...securityHeaders(nodeEnv));
  app.use('/api', apiNoStore);
  app.setGlobalPrefix('api');
}
