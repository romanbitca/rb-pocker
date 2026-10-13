/**
 * PLAN "Testing strategy" → Rules: the test hooks (`?seed=`, `window.__pc`) exist only in
 * development and E2E builds, and a test asserts they are absent from the production bundle.
 *
 * This builds apps/web with its real config twice: `vite build` (production) and
 * `vite build --mode e2e` (the control, which must contain them), and searches every emitted file
 * for the hooks' marker string and for `__pc`.
 */
import { build, type Rolldown } from 'vite';
import { describe, expect, it } from 'vitest';
import { SCRIPT_HOOK_MARKER } from '../../src/app/botScripts.ts';
import { TEST_HOOKS_MARKER } from '../../src/app/testHooks.ts';

const ROOT = decodeURIComponent(new URL('../../', import.meta.url).pathname);

/** Every emitted file's text for a build in `mode` (NODE_ENV=production, as `vite build` sets it). */
async function builtFiles(mode: 'production' | 'e2e'): Promise<Map<string, string>> {
  const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process
    ?.env;
  const saved = env?.NODE_ENV;
  // Vitest sets NODE_ENV=test; `vite build` runs with production, whatever the mode.
  if (env) env.NODE_ENV = 'production';
  try {
    const result = await build({
      root: ROOT,
      configFile: `${ROOT}vite.config.ts`,
      mode,
      logLevel: 'silent',
      build: { outDir: `node_modules/.cache/test-hooks-bundle-${mode}`, emptyOutDir: true },
    });
    const outputs = (Array.isArray(result) ? result : [result]) as Rolldown.RolldownOutput[];
    const files = new Map<string, string>();
    for (const out of outputs) {
      for (const item of out.output) {
        files.set(item.fileName, item.type === 'chunk' ? item.code : String(item.source));
      }
    }
    return files;
  } finally {
    if (env) env.NODE_ENV = saved;
  }
}

const hits = (files: Map<string, string>, needle: string): string[] =>
  [...files].filter(([, text]) => text.includes(needle)).map(([name]) => name);

describe('test hooks and the production bundle', () => {
  it('a production build has no test hooks', async () => {
    const files = await builtFiles('production');
    expect([...files.keys()].some((name) => name.endsWith('.js'))).toBe(true);
    expect(hits(files, TEST_HOOKS_MARKER)).toEqual([]);
    expect(hits(files, '__pc')).toEqual([]);
    expect([...files.keys()].filter((name) => /testHooks/i.test(name))).toEqual([]);
    // The `?script=` hook and its scripts (Stage 6) are stripped too.
    expect(hits(files, SCRIPT_HOOK_MARKER)).toEqual([]);
    expect(hits(files, 'river-min-bet')).toEqual([]);
  }, 120_000);

  it('an E2E build (--mode e2e) has them (the control for the check above)', async () => {
    const files = await builtFiles('e2e');
    expect(hits(files, TEST_HOOKS_MARKER).length).toBeGreaterThan(0);
    expect(hits(files, '__pc').length).toBeGreaterThan(0);
    expect(hits(files, SCRIPT_HOOK_MARKER).length).toBeGreaterThan(0);
    expect(hits(files, 'river-min-bet').length).toBeGreaterThan(0);
  }, 120_000);
});
