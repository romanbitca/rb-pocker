/**
 * The dev-only preview (`?preview=ui`) must never ship: `main.tsx` loads it behind
 * `import.meta.env.DEV`, which is `false` in production builds, so Rolldown drops the branch and
 * the module. This builds the real config (vite.config.ts) and searches every output file for the
 * preview's marker. A development-mode build is the control: there the marker must be found.
 */
import { build, type Rolldown } from 'vite';
import { describe, expect, it } from 'vitest';
import { PREVIEW_MARKER } from '../../../src/ui/dev/Preview.tsx';

const ROOT = decodeURIComponent(new URL('../../../', import.meta.url).pathname);

type Output = Rolldown.RolldownOutput;

/** Builds apps/web in `mode` (in memory where possible) and returns every emitted file's text. */
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
        outDir: `node_modules/.cache/preview-bundle-check-${mode}`,
        emptyOutDir: true,
        minify: mode === 'production',
      },
    });
    const outputs = (Array.isArray(result) ? result : [result]) as Output[];
    const files = new Map<string, string>();
    for (const out of outputs) {
      for (const item of out.output) {
        const text = item.type === 'chunk' ? item.code : String(item.source);
        files.set(item.fileName, text);
      }
    }
    return files;
  } finally {
    if (env) env.NODE_ENV = saved;
  }
}

describe('the ?preview=ui dev preview', () => {
  it('is not in the production bundle', async () => {
    const files = await builtFiles('production');
    expect(files.size).toBeGreaterThan(1);
    const leaks = [...files].filter(([, text]) => text.includes(PREVIEW_MARKER));
    expect(leaks.map(([name]) => name)).toEqual([]);
    expect([...files.keys()].filter((name) => /preview/i.test(name))).toEqual([]);
  }, 60_000);

  it('is in a development build (the control for the check above)', async () => {
    const files = await builtFiles('development');
    const hits = [...files].filter(([, text]) => text.includes(PREVIEW_MARKER));
    expect(hits.length).toBeGreaterThan(0);
  }, 60_000);
});
