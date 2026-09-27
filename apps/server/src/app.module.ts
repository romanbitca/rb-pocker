import { join, resolve } from 'node:path';
import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { HealthModule } from './health.module.js';
import { staticCacheHeaders } from './security.js';

/**
 * Where the built game is: apps/web/dist (PLAN §2.6 a). `import.meta.dirname` is apps/server/dist
 * when compiled and apps/server/src under Vitest; both sit two levels below apps/. `WEB_DIST_DIR`
 * overrides it: the server tests serve a small fixture (test/global-setup.ts).
 */
export function webDistDir(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env.WEB_DIST_DIR || join(import.meta.dirname, '..', '..', 'web', 'dist'));
}

const rootPath = webDistDir();

@Module({
  imports: [
    HealthModule,
    ServeStaticModule.forRoot({
      rootPath,
      // Kept out of the SPA fallback: `/api`, `/api/` and `/api/x` stay JSON 404s, and a missing
      // chunk is a 404 instead of index.html with 200 (§2.6 a, pitfall 42).
      exclude: ['/api/{*splat}', '/assets/{*splat}'],
      serveStaticOptions: { setHeaders: staticCacheHeaders(rootPath) },
    }),
  ],
})
export class AppModule {}
