/**
 * Runs `npm run build` only when the production build is missing or out of date. The root
 * `npm run e2e` calls it before Playwright, which tests the Nest-served build (PLAN §17.5).
 *
 * Out of date: a file of either app (tests excluded), the root package.json or the lockfile is
 * newer than the oldest build output. A deleted source file is not noticed: run `npm run build`.
 *
 * Usage (from the repository root): `node scripts/build-if-needed.mjs`
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const OUTPUTS = ['apps/web/dist/index.html', 'apps/web/dist/sw.js', 'apps/server/dist/main.js'];
const INPUTS = ['package.json', 'package-lock.json', 'apps/web', 'apps/server'];
/** Folders that never feed the build (by name, at any depth). */
const SKIP = new Set([
  'node_modules',
  'dist',
  'tests',
  'test',
  'coverage',
  'playwright-report',
  'test-results',
]);

/** The newest modification time of a file, or of the files under a folder. */
function newest(path) {
  const stats = statSync(path);
  if (!stats.isDirectory()) return stats.mtimeMs;
  let time = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (!SKIP.has(entry.name)) time = Math.max(time, newest(join(path, entry.name)));
  }
  return time;
}

/** Why a build is needed, or null. */
function reason() {
  const missing = OUTPUTS.find((file) => !existsSync(join(ROOT, file)));
  if (missing !== undefined) return `${missing} is missing`;
  const built = Math.min(...OUTPUTS.map((file) => statSync(join(ROOT, file)).mtimeMs));
  const changed = INPUTS.find((input) => newest(join(ROOT, input)) > built);
  return changed === undefined ? null : `${changed} changed after the last build`;
}

const why = reason();
if (why === null) {
  console.log('build-if-needed: the build is up to date.');
} else {
  console.log(`build-if-needed: ${why}; running npm run build.`);
  const result = spawnSync('npm', ['run', 'build'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32', // npm is npm.cmd there
  });
  if (result.error !== undefined) console.error(result.error);
  process.exit(result.status ?? 1);
}
