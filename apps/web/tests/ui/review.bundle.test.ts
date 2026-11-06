/**
 * PLAN §15.3: what first paint does not need is lazy-loaded with a dynamic `import()` and still
 * precached, and the budgets hold. This builds apps/web once with its real config and checks the
 * built files:
 * - the Review screen (found by `REVIEW_MARKER`) is in a chunk of its own, and so is the Stats
 *   screen with its words, numbers and charts (chunk 8.2, `STATS_MARKER`);
 * - the screens after the first tap (`ui/screensEntry.tsx`: the Table, Setup, Settings, the Menu
 *   and the §3.1 dialogs) are not initial either, while Welcome and Home are (found through the
 *   bundle's own module list, so no marker is needed);
 * - each of them is not part of the initial JS (what `index.html` loads and imports statically),
 *   and the entry reaches it only through `import()`;
 * - the service worker precaches them (so they open offline);
 * - all CSS is one stylesheet that `index.html` loads (`build.cssCodeSplit: false`);
 * - the initial JS and the CSS are within the CI budgets (`scripts/size-budget.ts`).
 */
import { readFileSync } from 'node:fs';
import { build, type Plugin } from 'vite';
import { beforeAll, describe, expect, it } from 'vitest';
import { BUDGETS, measureBudgets, type Row } from '../../scripts/size-budget.ts';
import { REVIEW_MARKER } from '../../src/ui/screens/reviewMarker.ts';
import { STATS_MARKER } from '../../src/ui/screens/statsMarker.ts';

const ROOT = decodeURIComponent(new URL('../../', import.meta.url).pathname);
const OUT = `${ROOT}node_modules/.cache/review-bundle-check`;

/** Source file (relative to apps/web) → the chunk that holds it (relative to dist). */
const chunkOf = new Map<string, string>();

/** Records which chunk holds each source module. */
function chunkMap(): Plugin {
  return {
    name: 'test:chunk-map',
    generateBundle(_options, bundle) {
      for (const out of Object.values(bundle)) {
        if (out.type !== 'chunk') continue;
        for (const id of Object.keys(out.modules)) {
          if (id.startsWith(ROOT)) chunkOf.set(id.slice(ROOT.length), out.fileName);
        }
      }
    },
  };
}

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
      plugins: [chunkMap()],
      build: { outDir: OUT, emptyOutDir: true },
    });
  } finally {
    if (env) env.NODE_ENV = saved;
  }
}

let rows: Row[] = [];

beforeAll(async () => {
  await buildProduction();
  rows = measureBudgets(OUT);
}, 120_000);

const rowOf = (metric: string): Row => {
  const found = rows.find((r) => r.metric === metric);
  if (found === undefined) throw new Error(`no ${metric} row`);
  return found;
};
const text = (file: string): string => readFileSync(`${OUT}/${file}`, 'utf8');

/** `chunk` is reached from the initial files only through `import()`, never statically. */
function expectOnlyDynamicImports(chunk: string): void {
  const name = chunk.slice('assets/'.length);
  const importers = rowOf('Initial JS').files.filter((f) => text(f).includes(name));
  expect(importers.length, `who imports ${chunk}`).toBeGreaterThan(0);
  const escaped = name.replace('.', '\\.');
  for (const file of importers) {
    expect(text(file)).toMatch(new RegExp(`import\\(\\s*["'\`]\\./${escaped}["'\`]`));
    expect(text(file)).not.toMatch(new RegExp(`(?:from|import)\\s*["']\\./${escaped}["']`));
  }
}

const chunk = (source: string): string => {
  const file = chunkOf.get(source);
  if (file === undefined) throw new Error(`${source} is in no chunk`);
  return file;
};

describe('the Review screen in the production build', () => {
  it('is a lazy chunk: not initial, loaded by import(), precached, and the budget holds', () => {
    const initial = rowOf('Initial JS');
    const precache = rowOf('Total precache');

    const scripts = precache.files.filter((f) => f.endsWith('.js'));
    const withMarker = scripts.filter((f) => text(f).includes(REVIEW_MARKER));
    // One chunk holds the screen, and it is named after it.
    expect(withMarker).toHaveLength(1);
    const review = withMarker[0] as string;
    expect(review).toMatch(/^assets\/Review-[\w-]+\.js$/);

    // Not initial: not loaded by index.html, and no initial file holds the screen.
    expect(initial.files).not.toContain(review);
    for (const file of initial.files) expect(text(file)).not.toContain(REVIEW_MARKER);
    // The entry reaches it only through a dynamic import().
    expectOnlyDynamicImports(review);
    expect(precache.files).toContain(review);

    // The initial JS is within the CI budget (the 130 kB target only warns).
    expect(initial.gzipBytes).toBeLessThanOrEqual(BUDGETS.initialJs.max);
    expect(initial.status).not.toBe('fail');
    expect(precache.status).not.toBe('fail');
  });
});

describe('the Stats screen in the production build (chunk 8.2)', () => {
  it('is a lazy chunk with its words, numbers and charts: not initial, by import(), precached', () => {
    const initial = rowOf('Initial JS');
    const stats = chunk('src/ui/screens/Stats.tsx');
    expect(stats).toMatch(/^assets\/Stats-[\w-]+\.js$/);
    // Its words and its numbers travel with it, nowhere else.
    expect(chunk('src/i18n/stats.ts')).toBe(stats);
    expect(chunk('src/ui/stats.ts')).toBe(stats);
    expect(initial.files).not.toContain(stats);
    for (const word of [STATS_MARKER, 'Play 5 hands to see your first stats.', 'data-chart']) {
      for (const file of initial.files) expect(text(file), word).not.toContain(word);
      expect(text(stats), word).toContain(word);
    }
    expectOnlyDynamicImports(stats);
    expect(rowOf('Total precache').files).toContain(stats);
  });
});

describe('the screens after the first tap in the production build', () => {
  const LAZY = [
    'src/ui/screensEntry.tsx',
    'src/ui/screens/Table.tsx',
    'src/ui/screens/Setup.tsx',
    'src/ui/screens/Settings.tsx',
    'src/ui/screens/Menu.tsx',
    'src/ui/screens/Dialogs.tsx',
  ];
  const FIRST_PAINT = [
    'src/main.tsx',
    'src/ui/App.tsx',
    'src/ui/screens/Welcome.tsx',
    'src/ui/screens/Home.tsx',
  ];

  it('are lazy: not initial, loaded by import(), precached; Welcome and Home are initial', () => {
    const initial = rowOf('Initial JS');
    const precache = rowOf('Total precache');
    for (const source of LAZY) {
      expect(initial.files, source).not.toContain(chunk(source));
      expect(precache.files, source).toContain(chunk(source));
    }
    for (const source of FIRST_PAINT) expect(initial.files, source).toContain(chunk(source));
    expectOnlyDynamicImports(chunk('src/ui/screensEntry.tsx'));
  });

  it('take their styles from the one stylesheet, which index.html loads', () => {
    const css = rowOf('CSS');
    expect(css.files).toHaveLength(1);
    const [sheet] = css.files as [string];
    expect(text('index.html')).toContain(`href="./${sheet}"`);
    expect(rowOf('Total precache').files).toContain(sheet);
    expect(css.status).not.toBe('fail');
  });
});

describe('sounds, vibration and the wake lock in the production build (chunk 9.1)', () => {
  it('app/device.ts is a lazy chunk with the cues and the wake lock: not initial, by import(), precached', () => {
    const initial = rowOf('Initial JS');
    const device = chunk('src/app/device.ts');
    expect(device).toMatch(/^assets\/device-[\w-]+\.js$/);
    expect(chunk('src/app/cues.ts')).toBe(device);
    expect(chunk('src/app/wakeLock.ts')).toBe(device);
    expect(initial.files).not.toContain(device);
    expectOnlyDynamicImports(device);
    expect(rowOf('Total precache').files).toContain(device);
  });

  it('the synth is a chunk of its own that only the device chunk loads, by import(), never initial', () => {
    const initial = rowOf('Initial JS');
    const synth = chunk('src/sound/synth.ts');
    const device = chunk('src/app/device.ts');
    expect(synth).toMatch(/^assets\/synth-[\w-]+\.js$/);
    expect(synth).not.toBe(device);
    expect(initial.files).not.toContain(synth);
    const name = synth.slice('assets/'.length);
    for (const file of initial.files) expect(text(file), file).not.toContain(name);
    expect(text(device)).toMatch(new RegExp(`import\\(\\s*["'\`]\\./${name.replace('.', '\\.')}`));
    expect(text(device)).not.toMatch(new RegExp(`from\\s*["']\\./${name.replace('.', '\\.')}`));
    expect(rowOf('Total precache').files).toContain(synth);
  });

  it('their words load with the screens after the first tap, not with the first screen', () => {
    const initial = rowOf('Initial JS');
    expect(initial.files).not.toContain(chunk('src/i18n/device.ts'));
    for (const file of initial.files) {
      expect(text(file), file).not.toContain('Turn sound off');
      expect(text(file), file).not.toContain('Keep screen on');
    }
  });
});
