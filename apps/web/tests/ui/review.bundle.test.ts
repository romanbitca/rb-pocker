/**
 * PLAN §15.3: Review is lazy-loaded with a dynamic `import()` and still precached, and the initial
 * JS budget holds. This builds apps/web with its real config and checks the built files:
 * - the Review screen (found by `REVIEW_MARKER`) is in a chunk of its own, with its own CSS;
 * - that chunk is not part of the initial JS (what `index.html` loads and imports statically), and
 *   its marker is in no initial file; the entry reaches it only through `import()`;
 * - the service worker precaches it (so Review opens offline);
 * - the initial JS is within the CI budget (`scripts/size-budget.ts`).
 */
import { readFileSync } from 'node:fs';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import { BUDGETS, measureBudgets } from '../../scripts/size-budget.ts';
import { REVIEW_MARKER } from '../../src/ui/screens/reviewMarker.ts';

const ROOT = decodeURIComponent(new URL('../../', import.meta.url).pathname);
const OUT = `${ROOT}node_modules/.cache/review-bundle-check`;

/** Builds production into its own folder (NODE_ENV=production, as `vite build` sets it). */
async function buildProduction(): Promise<void> {
  const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process
    ?.env;
  const saved = env?.NODE_ENV;
  if (env) env.NODE_ENV = 'production';
  try {
    await build({
      root: ROOT,
      configFile: `${ROOT}vite.config.ts`,
      mode: 'production',
      logLevel: 'silent',
      build: { outDir: OUT, emptyOutDir: true },
    });
  } finally {
    if (env) env.NODE_ENV = saved;
  }
}

describe('the Review screen in the production build', () => {
  it('is a lazy chunk: not initial, loaded by import(), precached, and the budget holds', async () => {
    await buildProduction();
    const rows = measureBudgets(OUT);
    const initial = rows.find((r) => r.metric === 'Initial JS');
    const precache = rows.find((r) => r.metric === 'Total precache');
    if (initial === undefined || precache === undefined) throw new Error('missing size rows');

    const text = (file: string): string => readFileSync(`${OUT}/${file}`, 'utf8');
    const scripts = precache.files.filter((f) => f.endsWith('.js'));
    const withMarker = scripts.filter((f) => text(f).includes(REVIEW_MARKER));
    // One chunk holds the screen, and it is named after it.
    expect(withMarker).toHaveLength(1);
    const chunk = withMarker[0] as string;
    expect(chunk).toMatch(/^assets\/Review-[\w-]+\.js$/);

    // Not initial: not loaded by index.html, and no initial file holds the screen.
    expect(initial.files).not.toContain(chunk);
    for (const file of initial.files) expect(text(file)).not.toContain(REVIEW_MARKER);
    // The entry reaches it only through a dynamic import().
    const name = chunk.slice('assets/'.length);
    const importers = initial.files.filter((f) => text(f).includes(name));
    expect(importers.length).toBeGreaterThan(0);
    for (const file of importers) {
      expect(text(file)).toMatch(
        new RegExp(`import\\(\\s*["'\`]\\./${name.replace('.', '\\.')}["'\`]`),
      );
      expect(text(file)).not.toMatch(
        new RegExp(`(?:from|import)\\s*["']\\./${name.replace('.', '\\.')}["']`),
      );
    }

    // Its styles are lazy too, and everything is precached (offline).
    const css = precache.files.filter((f) => /^assets\/Review-[\w-]+\.css$/.test(f));
    expect(css).toHaveLength(1);
    expect(precache.files).toContain(chunk);
    expect(rows.find((r) => r.metric === 'CSS')?.files).toContain(css[0]);

    // The initial JS is within the CI budget (the 130 kB target only warns).
    expect(initial.gzipBytes).toBeLessThanOrEqual(BUDGETS.initialJs.max);
    expect(initial.status).not.toBe('fail');
    expect(precache.status).not.toBe('fail');
  }, 120_000);
});
