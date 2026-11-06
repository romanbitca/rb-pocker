/**
 * The About screen's licence list (`data/licences.ts`; PLAN §16.4, Appendix G.6; chunk 9.2c) is a
 * checked static list. These tests fail when it goes stale: when `apps/web/package.json`'s
 * dependencies change, when an installed package's version or licence differs from the list, or
 * when THIRD_PARTY_LICENSES.md ("In the game") says otherwise. That the built game holds no other
 * package's code is checked on the production build (`tests/ui/review.bundle.test.ts`).
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SHIPPED_PACKAGES } from '../../src/data/licences.ts';

const WEB = new URL('../../', import.meta.url);
const ROOT = new URL('../../../../', import.meta.url);

const readJson = (url: URL): Record<string, unknown> =>
  JSON.parse(readFileSync(url, 'utf8')) as Record<string, unknown>;

/** An installed package's own package.json, found as Node finds it from apps/web. */
function manifestOf(name: string): Record<string, unknown> {
  for (const base of [WEB, ROOT]) {
    const url = new URL(`node_modules/${name}/package.json`, base);
    if (existsSync(url)) return readJson(url);
  }
  throw new Error(`${name} is not installed`);
}

/** THIRD_PARTY_LICENSES.md's "In the game" table: package names → [version, licence, holder]. */
function inTheGame(): Map<string, string[]> {
  const doc = readFileSync(new URL('THIRD_PARTY_LICENSES.md', ROOT), 'utf8');
  const start = doc.indexOf('## In the game');
  const section = doc.slice(start, doc.indexOf('\n## ', start + 1));
  const rows = new Map<string, string[]>();
  for (const line of section.split('\n')) {
    const cells = line.split('|').map((c) => c.trim());
    // "| workbox-core, workbox-precaching (inside …) | 7.4.1 | MIT | Google LLC | https://… |"
    if (cells.length < 6 || !/^\d/.test(cells[2] ?? '')) continue;
    const names = (cells[1] ?? '').replace(/\s*\(.*\)$/, '').split(/,\s*/);
    for (const name of names) rows.set(name, cells.slice(2, 5));
  }
  return rows;
}

describe('the licence list', () => {
  it("names apps/web's dependencies exactly, at their exact versions", () => {
    const deps = readJson(new URL('package.json', WEB)).dependencies as Record<string, string>;
    const direct = SHIPPED_PACKAGES.filter((p) => p.via === undefined);
    expect(Object.fromEntries(direct.map((p) => [p.name, p.version]))).toEqual(deps);
  });

  it('matches each installed package: same version, same licence', () => {
    for (const p of SHIPPED_PACKAGES) {
      const manifest = manifestOf(p.name);
      expect([p.name, manifest.version, manifest.license]).toEqual([p.name, p.version, p.licence]);
    }
  });

  it('agrees with THIRD_PARTY_LICENSES.md, "In the game"', () => {
    const rows = inTheGame();
    for (const p of SHIPPED_PACKAGES) {
      expect(rows.get(p.name), p.name).toEqual([p.version, p.licence, p.copyright]);
    }
    expect([...rows.keys()].sort()).toEqual(SHIPPED_PACKAGES.map((p) => p.name).sort());
  });

  it('holds permissive licences only, each package once', () => {
    const names = SHIPPED_PACKAGES.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
    const permissive = ['MIT', 'ISC', 'BSD-3-Clause', 'Apache-2.0', '0BSD'];
    for (const p of SHIPPED_PACKAGES) expect(permissive, p.name).toContain(p.licence);
  });
});
