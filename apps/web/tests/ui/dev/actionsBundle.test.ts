/**
 * The dev-only preview (`?preview=actions`) must never ship: `main.tsx` loads it behind
 * `import.meta.env.DEV`, which is `false` in production builds, so Rolldown drops the branch and
 * the module. This builds the real config (vite.config.ts) and searches every output file for the
 * preview's marker and its spot names. A development-mode build is the control: there the marker
 * must be found, so the check cannot pass by searching for the wrong string.
 */
import { build, type Rolldown } from 'vite';
import { describe, expect, it } from 'vitest';
import { ACTIONS_PREVIEW_MARKER } from '../../../src/ui/dev/ActionsPreview.tsx';

const ROOT = decodeURIComponent(new URL('../../../', import.meta.url).pathname);

/** Builds apps/web in `mode` and returns every emitted file's text, by file name. */
async function builtFiles(mode: 'production' | 'development'): Promise<Map<string, string>> {
  const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process
    ?.env;
  const saved = env?.NODE_ENV;
  // Vitest sets NODE_ENV=test; Vite derives import.meta.env.DEV from NODE_ENV when it is set.
  if (env) env.NODE_ENV = mode;
  try {
    const result = await build({
      root: ROOT,
      configFile: `${ROOT}vite.config.ts`,
      mode,
      logLevel: 'silent',
      build: {
        outDir: `node_modules/.cache/actions-preview-bundle-check-${mode}`,
        emptyOutDir: true,
        minify: mode === 'production',
      },
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

describe('the ?preview=actions dev preview', () => {
  it('is not in the production bundle', async () => {
    const files = await builtFiles('production');
    expect(files.size).toBeGreaterThan(1);
    const leaks = [...files].filter(
      ([, text]) => text.includes(ACTIONS_PREVIEW_MARKER) || text.includes('shortCall'),
    );
    expect(leaks.map(([name]) => name)).toEqual([]);
    expect([...files.keys()].filter((name) => /preview/i.test(name))).toEqual([]);
  }, 60_000);

  it('is in a development build (the control for the check above)', async () => {
    const files = await builtFiles('development');
    const hits = [...files].filter(([, text]) => text.includes(ACTIONS_PREVIEW_MARKER));
    expect(hits.length).toBeGreaterThan(0);
  }, 60_000);
});
