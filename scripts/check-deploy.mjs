/**
 * Post-deploy check (PLAN §17.6 step 7): the deployed app sends the §17.2 headers and cache
 * rules, `/api/health` answers with the running commit, and no response sets a cookie.
 *
 * Usage (from the repository root, after `npm ci`):
 *   node scripts/check-deploy.mjs <url> [--commit <sha>] [--ws]
 *
 * <url>     where the app runs, e.g. https://poker.example.com or http://localhost:3000 (Docker)
 * --commit  also require `/api/health` to report this commit (full or short sha)
 * --ws      also open the multiplayer socket and require it to refuse a made-up login (§19.11):
 *           Telegram is on and the proxies pass WebSockets. Only with the bot token set; without
 *           this flag no socket is opened.
 *
 * Expects a production server (NODE_ENV=production, so HSTS is on): the Coolify deploy or
 * `docker compose up`. The expected values come from apps/server/src/security.ts, the single
 * source (§17.2), which Node 24 loads directly. Prints one line per URL; exits 1 if any fails.
 */
import { parseArgs } from 'node:util';
import {
  CACHE_CONTROL,
  SECURITY_HEADERS,
  STRICT_TRANSPORT_SECURITY,
} from '../apps/server/src/security.ts';

const USAGE = 'Usage: node scripts/check-deploy.mjs <url> [--commit <sha>] [--ws]';

/**
 * §19.4: the socket's path, the `v` of a `hello`, and the close code of a refused `initData`.
 * test/check-deploy.test.ts holds the first two equal to the PLAN.
 */
const MP_WS_PATH = '/api/mp/ws';
const MP_PROTOCOL_VERSION = 1;
const CLOSE_AUTH_FAILED = 4001;
const WS_TIMEOUT_MS = 15_000;

let args;
try {
  args = parseArgs({
    allowPositionals: true,
    options: { commit: { type: 'string' }, ws: { type: 'boolean' } },
  });
} catch (error) {
  console.error(`${error.message}\n${USAGE}`);
  process.exit(2);
}
const [base, ...extra] = args.positionals;
if (base === undefined || extra.length > 0 || !/^https?:\/\//.test(base)) {
  console.error(USAGE);
  process.exit(2);
}
const expectedCommit = args.values.commit?.trim().toLowerCase();

/** Headers every response must carry: helmet's and ours, plus HSTS (production only, §17.2). */
const EVERY_RESPONSE = {
  ...SECURITY_HEADERS,
  'strict-transport-security': STRICT_TRANSPORT_SECURITY,
};

let failed = 0;
function report(path, problems, note = '') {
  if (problems.length > 0) failed += 1;
  const line =
    problems.length === 0 ? `ok   ${path}${note}` : `FAIL ${path}: ${problems.join('; ')}`;
  console.log(line);
}

/**
 * GETs `path` and returns its body and the problems with the response, or null when nothing
 * answered. Redirects are not followed: they would hide the real response.
 */
async function check(path, { cacheControl, contentType }) {
  const url = new URL(path, base);
  let response;
  let body;
  try {
    response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15_000) });
    body = await response.text();
  } catch (error) {
    report(path, [`no answer (${error.cause?.code ?? error.message})`]);
    return null;
  }
  const header = (name) => response.headers.get(name);
  const problems = [];
  if (response.status !== 200) {
    const location = header('location');
    problems.push(`status ${response.status}${location ? ` (redirect to ${location})` : ''}`);
  }
  if (contentType !== undefined && !(header('content-type') ?? '').startsWith(contentType)) {
    problems.push(`Content-Type ${header('content-type')}, expected ${contentType}`);
  }
  for (const [name, value] of Object.entries(EVERY_RESPONSE)) {
    if (header(name) !== value) problems.push(`${name}: ${JSON.stringify(header(name))}`);
  }
  if (header('cache-control') !== cacheControl) {
    problems.push(
      `Cache-Control ${JSON.stringify(header('cache-control'))}, expected "${cacheControl}"`,
    );
  }
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) problems.push(`sets a cookie: ${cookies.join(', ')}`);
  if (header('x-powered-by') !== null) problems.push(`X-Powered-By: ${header('x-powered-by')}`);
  // The framing rule lives in the CSP alone; DENY here would block Telegram Web (§19.11).
  if (header('x-frame-options') !== null) {
    problems.push(`X-Frame-Options: ${header('x-frame-options')}`);
  }
  return { body, problems };
}

/**
 * Opens the multiplayer socket and sends a `hello` with made-up `initData`. The right answer is a
 * close with 4001: Telegram is on, the proxies pass WebSockets, and a login is really checked. No
 * `Origin` header is sent, so the gateway's same-origin rule (§19.4) lets the upgrade through.
 */
async function checkSocket() {
  const url = new URL(MP_WS_PATH, base);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const closedWith = await new Promise((resolve) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => {
      socket.close();
      resolve(null);
    }, WS_TIMEOUT_MS);
    socket.addEventListener('open', () => {
      socket.send(
        JSON.stringify({
          t: 'hello',
          v: MP_PROTOCOL_VERSION,
          initData: 'check-deploy=not-a-login',
        }),
      );
    });
    // A failed upgrade (Telegram is off, a proxy refuses it) comes here too, as 1006.
    socket.addEventListener('close', (event) => {
      clearTimeout(timer);
      resolve(event.code);
    });
  });
  if (closedWith === CLOSE_AUTH_FAILED) {
    report(MP_WS_PATH, [], ` (closed with ${closedWith})`);
  } else if (closedWith === null) {
    report(MP_WS_PATH, [
      `no close within ${WS_TIMEOUT_MS / 1000} s, expected ${CLOSE_AUTH_FAILED}`,
    ]);
  } else {
    report(MP_WS_PATH, [`closed with ${closedWith}, expected ${CLOSE_AUTH_FAILED}`]);
  }
}

console.log(`Checking ${base}`);

const index = await check('/', {
  cacheControl: CACHE_CONTROL.revalidate,
  contentType: 'text/html',
});
// One hashed file that index.html loads, e.g. <script type="module" src="./assets/index-….js">.
const asset = /\bsrc="\.?\/?(assets\/[^"]+\.js)"/.exec(index?.body ?? '')?.[1];
if (index !== null) {
  if (asset === undefined) index.problems.push('index.html loads no assets/*.js file');
  report('/', index.problems);
}

const FILES = [
  ['/sw.js', { cacheControl: CACHE_CONTROL.revalidate, contentType: 'text/javascript' }],
  [
    '/manifest.webmanifest',
    { cacheControl: CACHE_CONTROL.revalidate, contentType: 'application/manifest+json' },
  ],
  // The SPA fallback is index.html and must not be cached either (§17.2, pitfall 33).
  ['/table/42', { cacheControl: CACHE_CONTROL.revalidate, contentType: 'text/html' }],
];
if (asset !== undefined) FILES.push([`/${asset}`, { cacheControl: CACHE_CONTROL.hashed }]);
for (const [path, expected] of FILES) {
  const result = await check(path, expected);
  if (result !== null) report(path, result.problems);
}

const health = await check('/api/health', {
  cacheControl: CACHE_CONTROL.api,
  contentType: 'application/json',
});
if (health !== null) {
  let json = null;
  try {
    json = JSON.parse(health.body);
  } catch {
    // reported just below
  }
  if (json?.status !== 'ok') health.problems.push(`body ${health.body.slice(0, 100)}`);
  const commit = typeof json?.commit === 'string' ? json.commit.toLowerCase() : '';
  if (!/^[0-9a-f]{7,40}$/.test(commit)) {
    health.problems.push(`commit "${commit}": SOURCE_COMMIT is not set`);
  } else if (
    expectedCommit !== undefined &&
    !commit.startsWith(expectedCommit) &&
    !expectedCommit.startsWith(commit)
  ) {
    health.problems.push(`commit ${commit}, expected ${expectedCommit}`);
  }
  report('/api/health', health.problems, ` (commit ${commit})`);
}

if (args.values.ws === true) await checkSocket();

console.log(failed === 0 ? 'All checks passed.' : `${failed} URL(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
