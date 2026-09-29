/**
 * The dev-only screens preview (`?preview=screens`) must never ship: `main.tsx` loads it behind
 * `import.meta.env.DEV`, which is the constant `false` in production builds, so the bundler drops
 * the branch and the module. This builds the real config (vite.config.ts) and searches every
 * output file for the preview's marker. A development build is the control: the marker is there.
 */
import { build, type Rolldown } from 'vite';
import { describe, expect, it } from 'vitest';
import { SCREENS_PREVIEW_MARKER } from '../../../src/ui/dev/ScreensPreview.tsx';

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
        // Its own folder: other bundle tests may build at the same time.
        outDir: `node_modules/.cache/screens-preview-check-${mode}`,
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

describe('the ?preview=screens dev preview', () => {
  it('is not in the production bundle', async () => {
    const files = await builtFiles('production');
    expect(files.size).toBeGreaterThan(1);
    const leaks = [...files].filter(([, text]) => text.includes(SCREENS_PREVIEW_MARKER));
    expect(leaks.map(([name]) => name)).toEqual([]);
    expect([...files.keys()].filter((name) => /screenspreview/i.test(name))).toEqual([]);
  }, 60_000);

  it('is in a development build (the control for the check above)', async () => {
    const files = await builtFiles('development');
    const hits = [...files].filter(([, text]) => text.includes(SCREENS_PREVIEW_MARKER));
    expect(hits.length).toBeGreaterThan(0);
  }, 60_000);
});
