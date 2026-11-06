/**
 * PLAN §15.3: what first paint does not need is lazy-loaded with a dynamic `import()` and still
 * precached, and the budgets hold. This builds apps/web once with its real config and checks the
 * built files:
 * - the Review screen (found by `REVIEW_MARKER`) is in a chunk of its own, and so are the Stats
 *   screen with its words, numbers and charts (chunk 8.2, `STATS_MARKER`) and Learn's four screens
 *   with their words and lessons (chunk 9.2, `LEARN_MARKER`);
 * - the screens after the first tap (`ui/screensEntry.tsx`: the Table, Setup, Settings, the Menu
 *   and the §3.1 dialogs) are not initial either, while Welcome and Home are (found through the
 *   bundle's own module list, so no marker is needed);
 * - each of them is not part of the initial JS (what `index.html` loads and imports statically),
 *   and the entry reaches it only through `import()`;
 * - the service worker precaches them (so they open offline);
 * - all CSS is one stylesheet that `index.html` loads (`build.cssCodeSplit: false`);
 * - the initial JS and the CSS are within the CI budgets (`scripts/size-budget.ts`);
 * - About (chunk 9.2c) is a chunk of its own, asked for by the screens chunk only, and the built
 *   game holds code from no npm package that About's licence list (`data/licences.ts`) leaves out.
 */
import { readFileSync } from 'node:fs';
import { build, type Plugin } from 'vite';
import { beforeAll, describe, expect, it } from 'vitest';
import { BUDGETS, measureBudgets, type Row } from '../../scripts/size-budget.ts';
import { SHIPPED_PACKAGES } from '../../src/data/licences.ts';
import { LEARN_MARKER } from '../../src/ui/screens/learnMarker.ts';
import { REVIEW_MARKER } from '../../src/ui/screens/reviewMarker.ts';
import { STATS_MARKER } from '../../src/ui/screens/statsMarker.ts';

const ROOT = decodeURIComponent(new URL('../../', import.meta.url).pathname);
const OUT = `${ROOT}node_modules/.cache/review-bundle-check`;

/** Source file (relative to apps/web) → the chunk that holds it (relative to dist). */
const chunkOf = new Map<string, string>();

/** The npm packages whose code is in the built game's chunks (About's licence list, chunk 9.2c). */
const packagesInBundle = new Set<string>();

/**
 * The npm package a module comes from, or null for our own files and the bundler's helpers
 * (Vite's preload helper, Rolldown's runtime). vite-plugin-pwa's register hook is a virtual module.
 */
function packageOf(id: string): string | null {
  if (id.includes('virtual:pwa-register')) return 'vite-plugin-pwa';
  return /\/node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(id)?.[1] ?? null;
}

/** Records which chunk holds each source module, and which packages the chunks hold. */
function chunkMap(): Plugin {
  return {
    name: 'test:chunk-map',
    generateBundle(_options, bundle) {
      for (const out of Object.values(bundle)) {
        if (out.type !== 'chunk') continue;
        for (const id of Object.keys(out.modules)) {
          const pkg = packageOf(id);
          if (pkg !== null) packagesInBundle.add(pkg);
          else if (id.startsWith(ROOT)) chunkOf.set(id.slice(ROOT.length), out.fileName);
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

describe('Learn in the production build (chunk 9.2)', () => {
  it('is a lazy chunk with its words and lessons: not initial, by import(), precached', () => {
    const initial = rowOf('Initial JS');
    const learn = chunk('src/ui/screens/Learn.tsx');
    expect(learn).toMatch(/^assets\/Learn-[\w-]+\.js$/);
    // Its words, its lessons and its pieces travel with it, nowhere else.
    for (const source of [
      'src/i18n/learn.ts',
      'src/data/lessons.ts',
      'src/ui/learn.ts',
      'src/ui/components/Lesson.tsx',
      'src/ui/components/GlossaryList.tsx',
    ]) {
      expect(chunk(source), source).toBe(learn);
    }
    expect(initial.files).not.toContain(learn);
    for (const word of [LEARN_MARKER, 'Practise the 10 hands', 'A hand, step by step']) {
      for (const file of initial.files) expect(text(file), word).not.toContain(word);
      expect(text(learn), word).toContain(word);
    }
    // The rankings and the glossary it shows are lazy too (shared with the Table and the coach).
    for (const source of ['src/ui/components/RankingsList.tsx', 'src/i18n/enCoach.ts']) {
      expect(initial.files, source).not.toContain(chunk(source));
    }
    expectOnlyDynamicImports(learn);
    expect(rowOf('Total precache').files).toContain(learn);
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

describe('the hand drill in the production build (PLAN §13.5)', () => {
  const PAGE = 'src/ui/screens/Drill.tsx';
  const LOGIC = 'src/app/drill.ts';
  /** Modules only the drill uses: never in the initial JS. */
  const DRILL_ONLY = [
    PAGE,
    'src/ui/screens/DrillSheets.tsx',
    'src/ui/screens/drillStyles.ts',
    'src/ui/drillText.ts',
    'src/i18n/drill.ts',
    LOGIC,
    'src/drill/questions.ts',
    'src/drill/deal.ts',
    'src/drill/session.ts',
    'src/persist/drill.ts',
  ];

  it('is two lazy chunks, precached: the page from the screens chunk, the logic from boot', () => {
    const initial = rowOf('Initial JS');
    const precache = rowOf('Total precache');
    for (const source of DRILL_ONLY) {
      expect(initial.files, source).not.toContain(chunk(source));
      expect(precache.files, source).toContain(chunk(source));
    }
    expect(chunk(PAGE)).not.toBe(chunk(LOGIC));
    // The frame (Back and the title) is in the screens chunk, which loads the page with import().
    const screens = chunk('src/ui/screensEntry.tsx');
    expect(chunk('src/ui/drillModule.ts')).toBe(screens);
    const page = chunk(PAGE).slice('assets/'.length);
    expect(text(screens)).toMatch(
      new RegExp(`import\\(\\s*["'\`]\\./${page.replace('.', '\\.')}["'\`]`),
    );
    for (const file of initial.files) expect(text(file)).not.toContain(page);
    // Boot's loader reaches the logic only through import().
    expectOnlyDynamicImports(chunk(LOGIC));
  });
});

describe('the service worker code in the production build (§15.1, chunk 9.5)', () => {
  it('is a lazy chunk with no imports: not initial, loaded by import(), precached', () => {
    const port = chunk('src/app/swUpdate.ts');
    expect(rowOf('Initial JS').files).not.toContain(port);
    expect(rowOf('Total precache').files).toContain(port);
    expectOnlyDynamicImports(port);
    // Nothing of the entry chunk moves into a chunk shared with it (pitfall 47).
    expect(text(port)).not.toMatch(/\bimport\b/);
    // The plugin's own registration code (`virtual:pwa-register`, workbox-window) is gone.
    expect(rowOf('Total precache').files.some((f) => f.includes('workbox-window'))).toBe(false);
  });
});

describe('About in the production build (chunk 9.2c)', () => {
  it('is a chunk of its own with its words and licences: not initial, by import(), precached', () => {
    const initial = rowOf('Initial JS');
    const about = chunk('src/ui/screens/About.tsx');
    expect(about).toMatch(/^assets\/About-[\w-]+\.js$/);
    // Its words and its licence list travel with it, nowhere else.
    for (const source of ['src/i18n/about.ts', 'src/data/licences.ts']) {
      expect(chunk(source), source).toBe(about);
    }
    expect(initial.files).not.toContain(about);
    for (const word of ['How the coach works', '1-800-MY-RESET', 'workbox-precaching']) {
      for (const file of initial.files) expect(text(file), word).not.toContain(word);
      expect(text(about), word).toContain(word);
    }
    // Only the screens chunk asks for it (aboutModule.ts), and only through import().
    const screens = chunk('src/ui/screensEntry.tsx');
    expect(chunk('src/ui/aboutModule.ts')).toBe(screens);
    const name = about.slice('assets/'.length).replace('.', '\\.');
    expect(text(screens)).toMatch(new RegExp(`import\\(\\s*["'\`]\\./${name}["'\`]`));
    expect(text(screens)).not.toMatch(new RegExp(`(?:from|import)\\s*["']\\./${name}["']`));
    expect(rowOf('Total precache').files).toContain(about);
  });

  it('holds code from no npm package that its licence list leaves out', () => {
    // The game's own chunks; the service worker's workbox files are built apart (workbox-build).
    const listed = new Set(SHIPPED_PACKAGES.map((p) => p.name));
    expect([...packagesInBundle].filter((p) => !listed.has(p)).sort()).toEqual([]);
    // Since chunk 9.5 the app registers its service worker itself: vite-plugin-pwa's register
    // code and workbox-window are not in the game any more.
    for (const p of ['react', 'react-dom', 'scheduler', 'zustand']) {
      expect(packagesInBundle, p).toContain(p);
    }
    for (const p of ['vite-plugin-pwa', 'workbox-window']) {
      expect(packagesInBundle, p).not.toContain(p);
    }
  });
});
