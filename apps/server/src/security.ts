import type { IncomingMessage, ServerResponse } from 'node:http';
import { relative, sep } from 'node:path';
import helmet, { type HelmetOptions } from 'helmet';

/**
 * The security and cache headers of PLAN §17.2, in one place. `configureApp()` (setup.ts) and the
 * static files (app.module.ts) apply them; the server tests compare every response against the
 * values exported here.
 */

type Middleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next: (err?: unknown) => void,
) => void;

/** Exactly the §17.2 directives. Nothing is loaded from another origin. */
const CSP_DIRECTIVES = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  // 'unsafe-inline' only for the `style="--x:…"` seat positions; scripts stay 'self'.
  styleSrc: ["'self'", "'unsafe-inline'"],
  imgSrc: ["'self'", 'data:'],
  fontSrc: ["'self'"],
  connectSrc: ["'self'"],
  workerSrc: ["'self'"],
  manifestSrc: ["'self'"],
  objectSrc: ["'none'"],
  baseUri: ["'none'"],
  formAction: ["'none'"],
  frameAncestors: ["'none'"],
};

/** What helmet sends for `CSP_DIRECTIVES` (joined with `;`, no space). No `upgrade-insecure-requests`. */
export const CONTENT_SECURITY_POLICY =
  "default-src 'self';script-src 'self';style-src 'self' 'unsafe-inline';img-src 'self' data:;" +
  "font-src 'self';connect-src 'self';worker-src 'self';manifest-src 'self';object-src 'none';" +
  "base-uri 'none';form-action 'none';frame-ancestors 'none'";

/** `screen-wake-lock` and `web-share` stay at their default (`self`). */
export const PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=(), payment=(), usb=()';

/** helmet's default HSTS value; sent only when NODE_ENV=production. */
export const STRICT_TRANSPORT_SECURITY = 'max-age=31536000; includeSubDomains';

/**
 * Sent on every response, whatever NODE_ENV is (names in lower case, as Node reports them).
 * HSTS and Cache-Control are the only §17.2 headers that vary; `X-Powered-By` and `Set-Cookie`
 * never appear.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'content-security-policy': CONTENT_SECURITY_POLICY,
  'permissions-policy': PERMISSIONS_POLICY,
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  // helmet's other defaults, kept on purpose (§17.2).
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'origin-agent-cluster': '?1',
  'x-dns-prefetch-control': 'off',
  'x-download-options': 'noopen',
  'x-permitted-cross-domain-policies': 'none',
  'x-xss-protection': '0',
};

/** Cache-Control values (§2.6 b). */
export const CACHE_CONTROL = {
  /** Hashed build files under `assets/`. */
  hashed: 'public, max-age=31536000, immutable',
  /** Every other file of the game: index.html (also as the SPA fallback), sw.js, the manifest, workbox-*.js, icons. */
  revalidate: 'no-cache',
  /** Every `/api` response, 404s included. */
  api: 'no-store',
} as const;

export function helmetOptions(nodeEnv: string | undefined): HelmetOptions {
  return {
    // useDefaults:false also drops helmet's default `upgrade-insecure-requests`, which breaks
    // http://localhost in Safari and every http://<LAN-IP> test (pitfall 41).
    contentSecurityPolicy: { useDefaults: false, directives: CSP_DIRECTIVES },
    xFrameOptions: { action: 'deny' },
    // `true` is helmet's default HSTS. Only in production, where the proxy terminates HTTPS.
    strictTransportSecurity: nodeEnv === 'production',
  };
}

/** helmet has no Permissions-Policy, so it is set by hand. */
const permissionsPolicy: Middleware = (_req, res, next) => {
  res.setHeader('Permissions-Policy', PERMISSIONS_POLICY);
  next();
};

/** The middleware that sends `SECURITY_HEADERS` (and HSTS in production) on every response. */
export function securityHeaders(nodeEnv: string | undefined): Middleware[] {
  return [helmet(helmetOptions(nodeEnv)), permissionsPolicy];
}

/** Mounted on `/api`: API responses, including their JSON 404s, are never cached. */
export const apiNoStore: Middleware = (_req, res, next) => {
  res.setHeader('Cache-Control', CACHE_CONTROL.api);
  next();
};

/**
 * Cache-Control for a file of the built game. The path is judged relative to the dist folder, so a
 * checkout that happens to sit inside a folder named `assets` does not make index.html immutable.
 */
export function cacheControlFor(rootPath: string, filePath: string): string {
  const parts = relative(rootPath, filePath).split(sep);
  return parts.length > 1 && parts[0] === 'assets'
    ? CACHE_CONTROL.hashed
    : CACHE_CONTROL.revalidate;
}

/**
 * serve-static's `setHeaders`. `@nestjs/serve-static` also calls it for the SPA-fallback
 * index.html, and `send` keeps a Cache-Control that is already set (§2.6 b, pitfall 42).
 */
export function staticCacheHeaders(
  rootPath: string,
): (res: ServerResponse, filePath: string) => void {
  return (res, filePath) => {
    res.setHeader('Cache-Control', cacheControlFor(rootPath, filePath));
  };
}
