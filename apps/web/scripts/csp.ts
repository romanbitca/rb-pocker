/**
 * The Content-Security-Policy for the `<meta http-equiv>` in the built `index.html` (PLAN §15.2).
 *
 * It is the server's CSP header (PLAN §17.2, `apps/server/src/security.ts`) minus
 * `frame-ancestors`, which browsers ignore in a meta tag. The meta copy is defence in depth: a page
 * served from the service-worker cache still carries it. Written like helmet writes the header:
 * directives joined with `;` and no space.
 *
 * Used by the build-only plugin in `vite.config.ts` (the dev server gets no CSP: HMR needs inline
 * scripts and websockets) and by `scripts/check-html.ts`, which asserts the built file carries it.
 */
export const META_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join(';');
