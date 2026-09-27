import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KB, formatReport, measureBudgets, type Row } from '../../scripts/size-budget.ts';

const SCRIPT = fileURLToPath(new URL('../../scripts/size-budget.ts', import.meta.url));

/** Deterministic bytes that gzip cannot shrink (SHA-256 in counter mode). */
function incompressible(bytes: number, seed: string): Buffer {
  const out = Buffer.alloc(bytes);
  for (let block = 0, filled = 0; filled < bytes; block++) {
    filled += createHash('sha256').update(`${seed}:${block}`).digest().copy(out, filled);
  }
  return out;
}

let dist: string;

function write(file: string, content: string | Buffer): void {
  const path = join(dist, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function precacheList(files: readonly string[]): string {
  const entries = files.map((url) => `{url:"${url}",revision:null}`).join(',');
  return `define(["./workbox-h8"],function(e){"use strict";e.precacheAndRoute([${entries}],{})});`;
}

/**
 * A small, healthy build shaped like Vite + vite-plugin-pwa output: an entry with a preloaded
 * vendor chunk, a statically imported chunk that is not preloaded, a lazy chunk, a worker that
 * imports a data-table chunk, CSS, an icon and the service worker's precache list.
 */
function writeHealthyDist(): void {
  write(
    'index.html',
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <script type="module" crossorigin src="./assets/index-a1.js"></script>
    <link rel="modulepreload" crossorigin href="./assets/vendor-b2.js">
    <link rel="stylesheet" crossorigin href="./assets/index-c3.css">
    <!-- <script src="./assets/commented-out.js"></script> -->
  </head>
  <body><div id="root"></div></body>
</html>
`,
  );
  write(
    'assets/index-a1.js',
    'import{r as e}from"./vendor-b2.js";import"./shared-d4.js";' +
      'const t=()=>import("./Stats-e5.js");' +
      'new Worker(new URL("equity.worker-f6.js",import.meta.url),{type:"module"});e(t);',
  );
  write('assets/vendor-b2.js', 'export const r=x=>x;');
  write('assets/shared-d4.js', 'export const s=1;');
  write('assets/Stats-e5.js', 'export default function Stats(){}');
  write('assets/index-c3.css', 'body{margin:0}');
  write('assets/equity.worker-f6.js', 'import{t}from"./tables-g7.js";self.onmessage=()=>t;');
  write('assets/tables-g7.js', 'export const t=[1,2,3];');
  write('icons/icon-192.png', incompressible(2_000, 'icon'));
  write('manifest.webmanifest', '{"name":"RB Poker Coach"}');
  write('workbox-h8.js', 'define([],function(){});');
  write(
    'sw.js',
    precacheList([
      'manifest.webmanifest',
      'index.html',
      'icons/icon-192.png',
      'assets/index-a1.js',
      'assets/vendor-b2.js',
      'assets/shared-d4.js',
      'assets/Stats-e5.js',
      'assets/index-c3.css',
      'assets/equity.worker-f6.js',
      'assets/tables-g7.js',
      'manifest.webmanifest', // vite-plugin-pwa lists the manifest twice: counted once
    ]),
  );
}

function rowOf(rows: readonly Row[], metric: string): Row {
  const row = rows.find((r) => r.metric === metric);
  if (row === undefined) throw new Error(`no "${metric}" row`);
  return row;
}

function runCli() {
  return spawnSync(process.execPath, [SCRIPT, dist], { encoding: 'utf8' });
}

beforeEach(() => {
  dist = mkdtempSync(join(tmpdir(), 'size-budget-'));
  writeHealthyDist();
});

afterEach(() => {
  rmSync(dist, { recursive: true, force: true });
});

describe('size budget on a healthy build', () => {
  it('passes every budget and counts the right files', () => {
    const rows = measureBudgets(dist);

    expect(rows.map((r) => [r.metric, r.status])).toEqual([
      ['Initial JS', 'ok'],
      ['CSS', 'ok'],
      ['Worker equity.worker', 'ok'],
      ['Total precache', 'ok'],
    ]);
    // Loaded by index.html, plus a static import that is not preloaded; not the lazy chunk,
    // not the worker, not the commented-out script.
    expect(rowOf(rows, 'Initial JS').files).toEqual([
      'assets/index-a1.js',
      'assets/shared-d4.js',
      'assets/vendor-b2.js',
    ]);
    expect(rowOf(rows, 'Worker equity.worker').files).toEqual([
      'assets/equity.worker-f6.js',
      'assets/tables-g7.js',
    ]);
    expect(rowOf(rows, 'Total precache').files).toHaveLength(10);
  });

  it('prints the table and exits 0', () => {
    const result = runCli();

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/\| Metric +\| Files \| +Gzip \| Budget +\| Result +\|/);
    for (const metric of ['Initial JS', 'CSS', 'Worker equity.worker', 'Total precache']) {
      expect(result.stdout).toMatch(
        new RegExp(`\\| ${metric} +\\| +\\d+ \\| +[\\d.]+ kB \\|.*\\| ok +\\|`),
      );
    }
    expect(result.stderr).toBe('');
  });
});

describe('size budget breaches', () => {
  it('fails on a fake oversized initial JS file (Stage 0 acceptance 6)', () => {
    write('assets/vendor-b2.js', incompressible(160 * KB, 'vendor'));

    const initial = rowOf(measureBudgets(dist), 'Initial JS');
    expect(initial.gzipBytes).toBeGreaterThan(150 * KB);
    expect(initial.status).toBe('fail');

    const result = runCli();
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/\| Initial JS +\| +3 \| +16\d\.\d\d kB \|.*\| FAIL +\|/);
    expect(result.stdout).toContain('Initial JS (FAIL):\n  assets/index-a1.js');
    expect(result.stderr).toContain('1 budget exceeded');
  });

  it('warns, but passes, between the 130 kB target and the 150 kB limit', () => {
    write('assets/vendor-b2.js', incompressible(140 * KB, 'vendor'));

    expect(rowOf(measureBudgets(dist), 'Initial JS').status).toBe('warn');
    const result = runCli();
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/\| Initial JS .*\| WARN: over target \|/);
  });

  it('does not count a lazy import() chunk as initial JS', () => {
    write('assets/Stats-e5.js', incompressible(200 * KB, 'stats'));

    const rows = measureBudgets(dist);
    expect(rowOf(rows, 'Initial JS').status).toBe('ok');
    expect(rowOf(rows, 'Total precache').gzipBytes).toBeGreaterThan(200 * KB);
  });

  it('fails on CSS over 20 kB', () => {
    write('assets/index-c3.css', incompressible(21 * KB, 'css'));

    expect(rowOf(measureBudgets(dist), 'CSS').status).toBe('fail');
    expect(runCli().status).toBe(1);
  });

  it('fails on a worker over 60 kB, counting the chunks it imports', () => {
    write('assets/tables-g7.js', incompressible(61 * KB, 'tables'));

    expect(rowOf(measureBudgets(dist), 'Worker equity.worker').status).toBe('fail');
    expect(runCli().status).toBe(1);
  });

  it('fails when the precache total is over 500 kB', () => {
    write('icons/icon-192.png', incompressible(510 * KB, 'icon'));

    const rows = measureBudgets(dist);
    expect(rowOf(rows, 'Total precache').status).toBe('fail');
    expect(rowOf(rows, 'Initial JS').status).toBe('ok');
    expect(runCli().status).toBe(1);
  });

  it('shows "none yet" when the build has no worker', () => {
    rmSync(join(dist, 'assets/equity.worker-f6.js'));
    write('sw.js', precacheList(['index.html', 'assets/index-a1.js']));

    expect(formatReport(measureBudgets(dist))).toMatch(
      /\| Worker chunks +\| +0 \| +- \|.*none yet/,
    );
  });
});

describe('size budget errors (exit 1)', () => {
  it('when dist has no index.html (build not run)', () => {
    rmSync(join(dist, 'index.html'));

    const result = runCli();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Run the build first');
  });

  it('when sw.js precaches a file that is not in dist', () => {
    write('sw.js', precacheList(['index.html', 'assets/gone-z9.js']));

    const result = runCli();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('sw.js precaches "assets/gone-z9.js"');
  });
});
