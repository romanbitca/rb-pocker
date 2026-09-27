import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request, { type Response } from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { webDistDir } from '../src/app.module.js';
import {
  CONTENT_SECURITY_POLICY,
  SECURITY_HEADERS,
  STRICT_TRANSPORT_SECURITY,
  cacheControlFor,
} from '../src/security.js';
import { startApp } from './start-app.js';

/**
 * The Nest server as the browser sees it (PLAN §2.6, §17.2, "Testing strategy" Server row), over
 * a copy of test/fixtures/web-dist (WEB_DIST_DIR, set by test/global-setup.ts).
 */

const INDEX_HTML = readFileSync(new URL('./fixtures/web-dist/index.html', import.meta.url), 'utf8');

/** PLAN §17.2 "Resulting CSP", copied by hand so a change to security.ts cannot pass silently. */
const PLAN_CSP =
  "default-src 'self';script-src 'self';style-src 'self' 'unsafe-inline';img-src 'self' data:;" +
  "font-src 'self';connect-src 'self';worker-src 'self';manifest-src 'self';object-src 'none';" +
  "base-uri 'none';form-action 'none';frame-ancestors 'none'";

const IMMUTABLE = 'public, max-age=31536000, immutable';

/**
 * One request of every kind the server answers through Nest: files, the SPA fallback, the API and
 * its JSON 404s. A missing /assets file is Express's own 404 page (tested on its own below).
 */
const EVERY_KIND_OF_RESPONSE = [
  '/',
  '/index.html',
  '/table/42',
  '/sw.js',
  '/manifest.webmanifest',
  '/workbox-abc.js',
  '/icons/icon-192.png',
  '/assets/app-abc123.js',
  '/api/health',
  '/api',
  '/api/',
  '/api/nope',
];

/** The response's values for the headers SECURITY_HEADERS names, compared as one object. */
function securityHeadersOf(res: Response): Record<string, unknown> {
  return Object.fromEntries(Object.keys(SECURITY_HEADERS).map((name) => [name, res.headers[name]]));
}

describe('HTTP server (PLAN §2.6, §17.2)', () => {
  let app: NestExpressApplication;
  const get = (path: string) => request(app.getHttpServer()).get(path);

  beforeAll(async () => {
    app = await startApp('development');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('security headers', () => {
    it('security.ts has exactly the §17.2 CSP, without upgrade-insecure-requests', () => {
      expect(CONTENT_SECURITY_POLICY).toBe(PLAN_CSP);
      expect(CONTENT_SECURITY_POLICY).not.toContain('upgrade-insecure-requests');
    });

    it.each([
      ['/', 'index.html'],
      ['/table/42', 'the SPA fallback'],
      ['/sw.js', 'the service worker'],
    ])('%s (%s) sends every §17.2 header, exactly as security.ts has it', async (path) => {
      const res = await get(path);

      expect(res.status).toBe(200);
      expect(securityHeadersOf(res)).toEqual(SECURITY_HEADERS);
      expect(res.headers['content-security-policy']).toBe(PLAN_CSP);
      expect(res.headers['permissions-policy']).toBe(
        'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
      );
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    it.each(EVERY_KIND_OF_RESPONSE)(
      '%s: every security header, no X-Powered-By, no HSTS outside production, no Set-Cookie',
      async (path) => {
        const res = await get(path);

        expect(securityHeadersOf(res)).toEqual(SECURITY_HEADERS);
        expect(res.headers['x-powered-by']).toBeUndefined();
        expect(res.headers['strict-transport-security']).toBeUndefined();
        expect(res.headers['set-cookie']).toBeUndefined();
      },
    );

    it('answers HEAD / (what `curl -I` sends) with the same headers', async () => {
      const res = await request(app.getHttpServer()).head('/');

      expect(res.status).toBe(200);
      expect(securityHeadersOf(res)).toEqual(SECURITY_HEADERS);
      expect(res.headers['cache-control']).toBe('no-cache');
      expect(res.headers['set-cookie']).toBeUndefined();
    });
  });

  describe('Cache-Control per path (§2.6 b)', () => {
    it.each([
      ['/', 'no-cache'],
      ['/index.html', 'no-cache'],
      ['/table/42', 'no-cache'],
      ['/sw.js', 'no-cache'],
      ['/manifest.webmanifest', 'no-cache'],
      ['/workbox-abc.js', 'no-cache'],
      ['/icons/icon-192.png', 'no-cache'],
      ['/assets/app-abc123.js', IMMUTABLE],
      ['/api/health', 'no-store'],
      ['/api/nope', 'no-store'],
    ])('%s → %s', async (path, cacheControl) => {
      const res = await get(path);

      expect(res.headers['cache-control']).toBe(cacheControl);
    });

    it('judges a file by its path inside the dist folder, not by the folders above it', () => {
      // A checkout that sits in a folder named "assets" must not make index.html immutable.
      const root = join('/srv', 'assets', 'web', 'dist');

      expect(cacheControlFor(root, join(root, 'index.html'))).toBe('no-cache');
      expect(cacheControlFor(root, join(root, 'sw.js'))).toBe('no-cache');
      expect(cacheControlFor(root, join(root, 'icons', 'icon-192.png'))).toBe('no-cache');
      expect(cacheControlFor(root, join(root, 'assets', 'index-abc123.js'))).toBe(IMMUTABLE);
      expect(cacheControlFor(root, join(root, 'assets', 'workers', 'equity-abc.js'))).toBe(
        IMMUTABLE,
      );
    });
  });

  describe('static files, SPA fallback and 404s (§2.6 a)', () => {
    it('serves the built files', async () => {
      const [index, sw, chunk, manifest, icon] = await Promise.all(
        [
          '/',
          '/sw.js',
          '/assets/app-abc123.js',
          '/manifest.webmanifest',
          '/icons/icon-192.png',
        ].map((path) => get(path)),
      );

      expect(index?.status).toBe(200);
      expect(index?.headers['content-type']).toMatch(/^text\/html/);
      expect(index?.text).toBe(INDEX_HTML);
      expect(sw?.status).toBe(200);
      expect(sw?.headers['content-type']).toMatch(/^text\/javascript/);
      expect(chunk?.status).toBe(200);
      expect(manifest?.status).toBe(200);
      expect(manifest?.headers['content-type']).toMatch(/^application\/manifest\+json/);
      expect(icon?.status).toBe(200);
      expect(icon?.headers['content-type']).toBe('image/png');
    });

    it('/table/42 falls back to index.html', async () => {
      const res = await get('/table/42');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/^text\/html/);
      expect(res.text).toBe(INDEX_HTML);
    });

    it.each(['/api', '/api/', '/api/nope'])('%s is a JSON 404, not index.html', async (path) => {
      const res = await get(path);

      expect(res.status).toBe(404);
      expect(res.headers['content-type']).toMatch(/^application\/json/);
      expect(res.body).toMatchObject({ statusCode: 404, error: 'Not Found' });
      expect(res.text).not.toContain('<html');
    });

    it('a missing /assets/x.js is a 404, not index.html', async () => {
      const res = await get('/assets/x.js');

      expect(res.status).toBe(404);
      expect(res.text).not.toBe(INDEX_HTML);
      expect(res.text).not.toContain('id="root"');
      // Nest 12 mounts its JSON 404 handler under the global prefix only, so this is Express's own
      // "Cannot GET" page. Express sets a stricter CSP on it; every other header is unchanged.
      expect(res.text).toContain('Cannot GET /assets/x.js');
      expect(securityHeadersOf(res)).toEqual({
        ...SECURITY_HEADERS,
        'content-security-policy': "default-src 'none'",
      });
      expect(res.headers['x-powered-by']).toBeUndefined();
      expect(res.headers['strict-transport-security']).toBeUndefined();
      expect(res.headers['set-cookie']).toBeUndefined();
    });
  });
});

describe('HSTS: only when NODE_ENV=production (§17.2, pitfall 41)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([undefined, 'development', 'test'])(
    'is not sent when NODE_ENV is %s',
    async (nodeEnv) => {
      vi.stubEnv('NODE_ENV', nodeEnv);
      const app = await startApp();

      try {
        const res = await request(app.getHttpServer()).get('/');

        expect(res.headers['strict-transport-security']).toBeUndefined();
      } finally {
        await app.close();
      }
    },
  );

  it('is sent on every response when NODE_ENV=production, and nothing else changes', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const app = await startApp();

    try {
      for (const path of ['/', '/table/42', '/sw.js', '/assets/app-abc123.js', '/api/health']) {
        const res = await request(app.getHttpServer()).get(path);

        expect(res.headers['strict-transport-security'], path).toBe(STRICT_TRANSPORT_SECURITY);
        expect(securityHeadersOf(res), path).toEqual(SECURITY_HEADERS);
        expect(res.headers['set-cookie'], path).toBeUndefined();
      }
      expect(STRICT_TRANSPORT_SECURITY).toBe('max-age=31536000; includeSubDomains');
    } finally {
      await app.close();
    }
  });
});

describe('webDistDir (§2.6 a)', () => {
  it('is apps/web/dist, found from the server source folder', () => {
    expect(webDistDir({})).toBe(fileURLToPath(new URL('../../web/dist', import.meta.url)));
  });

  it('WEB_DIST_DIR overrides it', () => {
    expect(webDistDir({ WEB_DIST_DIR: 'some/dir' })).toBe(resolve('some/dir'));
  });
});
