import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Serves the HTTP tests a small fixture of the built game (test/fixtures/web-dist) instead of
 * apps/web/dist, so they need no web build (PLAN "Testing strategy", Server row).
 *
 * The fixture is copied to a temporary folder first: @nestjs/serve-static sends the SPA fallback
 * with `res.sendFile(<absolute path>)` and no options, and `send` then answers 404 when any folder
 * in that path starts with a dot, such as the agent worktrees in `.claude/worktrees/` (PLAN pitfall
 * 44). Runs once, before the test workers start; they inherit WEB_DIST_DIR, which app.module.ts reads.
 */
export default function setup(): () => void {
  const dir = mkdtempSync(join(tmpdir(), 'rb-web-dist-'));
  cpSync(fileURLToPath(new URL('./fixtures/web-dist', import.meta.url)), dir, { recursive: true });
  process.env.WEB_DIST_DIR = dir;
  return () => {
    rmSync(dir, { recursive: true, force: true });
  };
}
