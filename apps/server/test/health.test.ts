import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { HealthController } from '../src/health.controller.js';
import { HealthService } from '../src/health.service.js';
import { startApp } from './start-app.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

describe('AppModule', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await startApp();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('has decorator metadata, so Nest can inject constructor dependencies', () => {
    // Without emitDecoratorMetadata in the test transform this is undefined and DI silently breaks.
    expect(Reflect.getMetadata('design:paramtypes', HealthController)).toEqual([HealthService]);
  });

  describe('GET /api/health', () => {
    it('returns 200 JSON with status, the package.json version and commit "dev" by default', async () => {
      vi.stubEnv('SOURCE_COMMIT', undefined);

      const res = await request(app.getHttpServer()).get('/api/health');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/^application\/json/);
      expect(res.body).toEqual({ status: 'ok', version: pkg.version, commit: 'dev' });
    });

    it('reports SOURCE_COMMIT, read at request time', async () => {
      vi.stubEnv('SOURCE_COMMIT', '3f9c2ab');

      const res = await request(app.getHttpServer()).get('/api/health');

      expect(res.body).toEqual({ status: 'ok', version: pkg.version, commit: '3f9c2ab' });
    });

    it('treats an empty SOURCE_COMMIT as unset', async () => {
      vi.stubEnv('SOURCE_COMMIT', '');

      const res = await request(app.getHttpServer()).get('/api/health');

      expect(res.body).toMatchObject({ commit: 'dev' });
    });

    it('is never cached and does not name the framework', async () => {
      const res = await request(app.getHttpServer()).get('/api/health');

      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['x-powered-by']).toBeUndefined();
    });
  });

  it('serves routes only under the /api prefix: /health is the game page, not the health JSON', async () => {
    // Before the SPA fallback existed (chunk 0.3) this path was a 404.
    const res = await request(app.getHttpServer()).get('/health');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/html/);
    expect(res.text).not.toContain('"status"');
  });
});
