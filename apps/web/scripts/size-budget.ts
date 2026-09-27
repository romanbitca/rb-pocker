/**
 * Bundle-size budget (PLAN §15.3), run in CI after the build: `npm run size` (root) or
 * `node scripts/size-budget.ts [distDir]` (from apps/web; default `apps/web/dist`).
 * Prints a table and exits with code 1 when a budget is exceeded (or dist cannot be read).
 *
 * | Metric                                            | Fails above | Warns above   |
 * | ------------------------------------------------- | ----------- | ------------- |
 * | Initial JS                                        | 150 kB      | 130 kB target |
 * | CSS                                               | 20 kB       |               |
 * | Each worker chunk, with the chunks it imports     | 60 kB       |               |
 * | Total precache                                    | 500 kB      |               |
 *
 * How it measures:
 * - gzip with node:zlib at the default level (6); 1 kB = 1,000 bytes. Vite's build report uses the
 *   same level and unit but another gzip implementation (Rolldown's), so it prints about 1% more.
 * - Initial JS: the scripts `index.html` loads (`<script src>`, `<link rel="modulepreload">`) plus
 *   every chunk they import statically. Chunks loaded with `import()` are lazy, not initial.
 * - CSS: every `.css` file in dist.
 * - Worker chunk: every `*.worker-<hash>.js` file (Vite names a worker chunk after its source file,
 *   e.g. `equity.worker.ts` → `assets/equity.worker-<hash>.js`), plus the chunks it imports
 *   statically; data tables are bundled imports, so they count.
 * - Total precache: the files in the service worker's precache list (`sw.js`), each counted once.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { startTags, stripComments } from './html.ts';

/** 1 kB = 1,000 bytes, the unit of Vite's build report. */
export const KB = 1000;

export interface Budget {
  /** Fails above this many gzip bytes. */
  readonly max: number;
  /** Warns above this many gzip bytes. */
  readonly target?: number;
}

/** PLAN §15.3. */
export const BUDGETS = {
  initialJs: { max: 150 * KB, target: 130 * KB },
  css: { max: 20 * KB },
  worker: { max: 60 * KB },
  precache: { max: 500 * KB },
} as const satisfies Record<string, Budget>;

export type Status = 'ok' | 'warn' | 'fail';

export interface Row {
  readonly metric: string;
  /** Paths relative to dist, `/`-separated. */
  readonly files: readonly string[];
  readonly gzipBytes: number;
  readonly budget: Budget;
  readonly status: Status;
}

const WORKER_CHUNK = /(?:^|\/)([^/]+\.worker)-[^/]+\.js$/;
/**
 * Static imports of a local chunk: `import … from "./x.js"`, `import "./x.js"`,
 * `export … from "./x.js"`. Not `import("./x.js")`: that chunk is lazy.
 */
const STATIC_IMPORT =
  /(?:^|[\s;{}])(?:import|export)\s*(?:[\w$*{}\s,]+?\s*from\s*)?["'](\.\.?\/[^"'\s]+)["']/g;
/** Entries of Workbox's precache list: `{url:"assets/x.js",revision:null}`. */
const PRECACHE_URL = /["']?\burl["']?\s*:\s*["']([^"']+)["']/g;

function listFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort();
}

/** A dist-relative path for a URL found in `fromFile`, or undefined when it is not local. */
function localPath(url: string, fromFile: string): string | undefined {
  if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(url)) return undefined; // http:, data:, //host
  const path = decodeURIComponent(url.replace(/[?#].*$/, ''));
  const joined = path.startsWith('/') ? path.slice(1) : posix.join(posix.dirname(fromFile), path);
  return posix.normalize(joined);
}

function statusOf(bytes: number, budget: Budget): Status {
  if (bytes > budget.max) return 'fail';
  return budget.target !== undefined && bytes > budget.target ? 'warn' : 'ok';
}

/** Measures `distDir` against the budgets. Throws when dist is missing or inconsistent. */
export function measureBudgets(distDir: string): Row[] {
  if (!existsSync(join(distDir, 'index.html'))) {
    throw new Error(`no index.html in ${distDir}. Run the build first.`);
  }
  const files = listFiles(distDir);
  const present = new Set(files);
  const read = (file: string) => readFileSync(join(distDir, file));
  const gzipBytes = (list: readonly string[]) =>
    list.reduce((sum, file) => sum + gzipSync(read(file)).length, 0);
  /** `start` plus every chunk it reaches through static imports. */
  const withStaticImports = (start: readonly string[]) => {
    const seen = new Set(start);
    const queue = [...start];
    for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
      for (const [, specifier] of read(file).toString('utf8').matchAll(STATIC_IMPORT)) {
        const target = specifier === undefined ? undefined : localPath(specifier, file);
        if (target !== undefined && present.has(target) && !seen.has(target)) {
          seen.add(target);
          queue.push(target);
        }
      }
    }
    return [...seen].sort();
  };
  const row = (metric: string, list: readonly string[], budget: Budget): Row => {
    const bytes = gzipBytes(list);
    return { metric, files: list, gzipBytes: bytes, budget, status: statusOf(bytes, budget) };
  };

  // Initial JS: what index.html loads, and what that imports statically.
  const html = stripComments(read('index.html').toString('utf8'));
  const loaded = [
    ...startTags(html, 'script').map((tag) => tag.attributes.get('src')),
    ...startTags(html, 'link')
      .filter((tag) => tag.attributes.get('rel')?.toLowerCase() === 'modulepreload')
      .map((tag) => tag.attributes.get('href')),
  ].flatMap((url) => {
    const path = url === undefined || url === '' ? undefined : localPath(url, 'index.html');
    return path === undefined ? [] : [path];
  });
  const missing = loaded.filter((file) => !present.has(file));
  if (missing.length > 0) throw new Error(`index.html loads missing files: ${missing.join(', ')}`);
  if (loaded.length === 0) throw new Error('index.html loads no script from dist');
  const rows = [row('Initial JS', withStaticImports(loaded), BUDGETS.initialJs)];

  const css = files.filter((file) => file.endsWith('.css'));
  rows.push(row('CSS', css, BUDGETS.css));

  for (const file of files) {
    const worker = WORKER_CHUNK.exec(file)?.[1];
    if (worker === undefined) continue;
    rows.push(row(`Worker ${worker}`, withStaticImports([file]), BUDGETS.worker));
  }

  // Total precache: the service worker's precache list.
  if (!present.has('sw.js')) throw new Error(`no sw.js in ${distDir}: no service worker`);
  const precached = new Set<string>();
  for (const [, url] of read('sw.js').toString('utf8').matchAll(PRECACHE_URL)) {
    const path = url === undefined ? undefined : localPath(url, 'sw.js');
    if (path === undefined || !present.has(path)) {
      throw new Error(`sw.js precaches "${url}", which is not a file in dist`);
    }
    precached.add(path);
  }
  if (precached.size === 0) throw new Error('sw.js has no precache list');
  rows.push(row('Total precache', [...precached].sort(), BUDGETS.precache));

  return rows;
}

function kb(bytes: number): string {
  return `${(bytes / KB).toFixed(2)} kB`;
}

const RESULT: Record<Status, string> = { ok: 'ok', warn: 'WARN: over target', fail: 'FAIL' };
const HEADER = ['Metric', 'Files', 'Gzip', 'Budget', 'Result'];
/** Columns aligned right: Files, Gzip. */
const NUMERIC = [false, true, true, false, false];

/** The report: a Markdown table, then the files behind every row that is not ok. */
export function formatReport(rows: readonly Row[]): string {
  const body = rows.map((row) => [
    row.metric,
    String(row.files.length),
    kb(row.gzipBytes),
    row.budget.target === undefined
      ? kb(row.budget.max)
      : `${kb(row.budget.max)} (target ${kb(row.budget.target)})`,
    RESULT[row.status],
  ]);
  if (!rows.some((row) => row.metric.startsWith('Worker '))) {
    body.push(['Worker chunks', '0', '-', `${kb(BUDGETS.worker.max)} each`, 'none yet']);
  }
  const widths = HEADER.map((title, i) =>
    Math.max(title.length, ...body.map((cells) => cells[i]?.length ?? 0)),
  );
  const pad = (cell: string, i: number) =>
    NUMERIC[i] ? cell.padStart(widths[i] ?? 0) : cell.padEnd(widths[i] ?? 0);
  const line = (cells: readonly string[]) => `| ${cells.map(pad).join(' | ')} |`;
  const rule = widths.map((width, i) =>
    NUMERIC[i] ? `${'-'.repeat(width - 1)}:` : '-'.repeat(width),
  );

  const out = [
    'Bundle size budget (PLAN §15.3): gzip level 6 (node:zlib), 1 kB = 1,000 bytes.',
    '',
    line(HEADER),
    `| ${rule.join(' | ')} |`,
    ...body.map(line),
  ];
  for (const row of rows.filter((r) => r.status !== 'ok')) {
    out.push('', `${row.metric} (${RESULT[row.status]}):`, ...row.files.map((file) => `  ${file}`));
  }
  return out.join('\n');
}

if (import.meta.main) {
  const distDir = resolve(process.argv[2] ?? fileURLToPath(new URL('../dist', import.meta.url)));
  try {
    const rows = measureBudgets(distDir);
    console.log(formatReport(rows));
    const failed = rows.filter((row) => row.status === 'fail').length;
    if (failed > 0) {
      console.error(`\nsize-budget: ${failed} budget${failed === 1 ? '' : 's'} exceeded.`);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`size-budget: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
