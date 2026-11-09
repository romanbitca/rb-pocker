import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { afterAll, describe, expect, it } from 'vitest';
import { legalActions } from '../src/game/engine/legal.js';
import { startHand } from '../src/game/engine/start.js';
import { step } from '../src/game/engine/step.js';
import { createTable } from '../src/game/engine/table.js';
import type { HandState, PlayerAction } from '../src/game/engine/types.js';
import { decodeClientMsg } from '../src/game/net/protocol.js';

/**
 * PLAN §19.3 and §18 Stage 10, acceptance 1: the server's generated copy of the game. It stays
 * current, stays out of git, is the only way the server reaches game code, and it runs.
 */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SCRIPT = join(ROOT, 'scripts/sync-game.mjs');
const SERVER_SRC = join(ROOT, 'apps/server/src');
const WEB = join(ROOT, 'apps/web');

function run(script: string, ...args: string[]): { status: number | null; output: string } {
  const { status, stdout, stderr } = spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
  });
  return { status, output: stdout + stderr };
}

function git(...args: string[]): string {
  const { status, stdout } = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  expect(status).toBe(0);
  return stdout;
}

/** Every `.ts` file under `dir`. */
function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

/** The specifiers of every import, export-from, dynamic import and require in a source text. */
function importsIn(code: string): string[] {
  const pattern = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;
  return [...code.matchAll(pattern)].map((match) => match[1] as string);
}

function pointsAtWeb(file: string, specifier: string): boolean {
  if (/^\.\.?\//.test(specifier)) {
    const target = resolve(dirname(file), specifier);
    return target === WEB || target.startsWith(`${WEB}/`);
  }
  return /^(@rb\/web|apps\/web|@?web)(\/|$)/.test(specifier);
}

describe('the generated copy in the repository (acceptance 1)', { timeout: 30_000 }, () => {
  it('scripts/sync-game.mjs --check passes', () => {
    const { status, output } = run(SCRIPT, '--check');
    expect(output).toBe('');
    expect(status).toBe(0);
  });

  it('no file under apps/server/src/game/ is tracked by git', () => {
    expect(git('ls-files', '--', 'apps/server/src/game')).toBe('');
    expect(tsFiles(join(SERVER_SRC, 'game')).length).toBeGreaterThan(0);
    expect(git('check-ignore', 'apps/server/src/game/engine/step.ts').trim()).toBe(
      'apps/server/src/game/engine/step.ts',
    );
  });

  it('no file of apps/server/src outside it imports from apps/web', () => {
    const files = tsFiles(SERVER_SRC).filter(
      (file) => !relative(SERVER_SRC, file).startsWith('game/'),
    );
    expect(files.length).toBeGreaterThan(0);
    const bad = files.flatMap((file) =>
      importsIn(readFileSync(file, 'utf8'))
        .filter((specifier) => pointsAtWeb(file, specifier))
        .map((specifier) => `${relative(ROOT, file)}: ${specifier}`),
    );
    expect(bad).toEqual([]);
    // The scan itself sees the forms that count.
    const sample = join(SERVER_SRC, 'mp/room.ts');
    for (const line of [
      "import { x } from '../../../web/src/core/rng.ts';",
      "import type { X } from '../../../web/src/core/rng.ts';",
      "export * from '@rb/web/src/core/rng.ts';",
      "const m = await import('apps/web/src/core/rng.ts');",
      "const m = require('../../../web/src/core/rng.ts');",
    ]) {
      expect(importsIn(line).filter((s) => pointsAtWeb(sample, s))).toHaveLength(1);
    }
    expect(importsIn("import { x } from '../game/engine/step.js';")).toEqual([
      '../game/engine/step.js',
    ]);
    expect(pointsAtWeb(sample, '../game/engine/step.js')).toBe(false);
  });

  it(
    'rb/server-no-web-imports passes on the whole server, and the copy is not linted',
    { timeout: 60_000 },
    async () => {
      const results = await new ESLint({ cwd: ROOT }).lintFiles(['apps/server/src/**/*.ts']);
      expect(results.length).toBeGreaterThan(0);
      expect(results.filter((r) => relative(SERVER_SRC, r.filePath).startsWith('game/'))).toEqual(
        [],
      );
      const broken = results.flatMap((r) =>
        r.messages.filter((m) => m.ruleId === 'rb/server-no-web-imports' || m.ruleId === null),
      );
      expect(broken).toEqual([]);
    },
  );
});

describe('the copy runs on the server (§19.3)', () => {
  it('a 4-player hand of remote seats, start to end, through the copied engine', () => {
    const seatCount = 4;
    const table = createTable(
      { seatCount, sb: 10, bb: 20, startingStack: 2000, botLevel: 'easy', seatLevels: [null, null, null, null] },
      Array.from({ length: seatCount }, (_, seat) => ({
        playerId: `s${seat}`,
        name: `s${seat}`,
        kind: 'remote' as const,
        personality: null,
        stack: 2000,
      })),
      '00112233445566778899aabbccddeeff',
    ); // prettier-ignore
    let h: HandState = startHand(table, '0123456789abcdef0123456789abcdef');
    for (let i = 0; i < 200 && h.phase !== 'complete'; i++) {
      const legal = legalActions(h);
      if (legal === null) {
        h = step(h, { kind: 'advance' });
        continue;
      }
      const action: PlayerAction = legal.canCheck ? { type: 'check' } : { type: 'call' };
      h = step(h, { kind: 'act', seat: legal.seat, action });
    }
    expect(h.phase).toBe('complete');
    expect(h.result?.net.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('the copied decoder works', () => {
    expect(decodeClientMsg({ t: 'join', code: 'ABCDEFGH', extra: 1 })).toEqual({
      t: 'join',
      code: 'ABCDEFGH',
    });
    expect(decodeClientMsg('nothing')).toBeNull();
  });
});

describe('scripts/sync-game.mjs', { timeout: 30_000 }, () => {
  const roots: string[] = [];
  afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });

  /** A small repository of its own: the script finds everything relative to itself. */
  function tree(): {
    root: string;
    sync: (...args: string[]) => { status: number | null; output: string };
    write: (file: string, text: string) => void;
    read: (file: string) => string;
    exists: (file: string) => boolean;
    time: (file: string) => number;
  } {
    const root = mkdtempSync(join(tmpdir(), 'rb-sync-game-'));
    roots.push(root);
    const at = (file: string): string => join(root, file);
    const write = (file: string, text: string): void => {
      mkdirSync(dirname(at(file)), { recursive: true });
      writeFileSync(at(file), text);
    };
    mkdirSync(at('scripts'));
    cpSync(SCRIPT, at('scripts/sync-game.mjs'));
    write('apps/web/src/core/a.ts', 'export const a = 1;\n');
    write('apps/web/src/eval/deep/b.ts', 'export const b = 2;\n');
    write('apps/web/src/engine/c.ts', 'export const c = 3;\n');
    write('apps/web/src/net/d.ts', 'export const d = 4;\n');
    write('apps/web/src/brain/not-copied.ts', 'export const e = 5;\n');
    return {
      root,
      sync: (...args) => run(at('scripts/sync-game.mjs'), ...args),
      write,
      read: (file) => readFileSync(at(file), 'utf8'),
      exists: (file) => existsSync(at(file)),
      time: (file) => statSync(at(file)).mtimeMs,
    };
  }
  const GAME = 'apps/server/src/game';

  it('copies the four folders, sub-folders too, and nothing else', () => {
    const t = tree();
    expect(t.sync().status).toBe(0);
    expect(t.read(`${GAME}/core/a.ts`)).toBe('export const a = 1;\n');
    expect(t.read(`${GAME}/eval/deep/b.ts`)).toBe('export const b = 2;\n');
    expect(t.read(`${GAME}/engine/c.ts`)).toBe('export const c = 3;\n');
    expect(t.read(`${GAME}/net/d.ts`)).toBe('export const d = 4;\n');
    expect(t.exists(`${GAME}/brain`)).toBe(false);
    expect(t.sync('--check').status).toBe(0);
  });

  it('with nothing to do it touches nothing and says nothing', () => {
    const t = tree();
    t.sync();
    const file = `${GAME}/engine/c.ts`;
    const old = new Date('2026-01-02T03:04:05Z');
    utimesSync(join(t.root, file), old, old);
    const again = t.sync();
    expect(again.status).toBe(0);
    expect(again.output).toBe('');
    expect(t.time(file)).toBe(old.getTime());
  });

  it('a copied file keeps the time of its source (scripts/build-if-needed.mjs reads times)', () => {
    const t = tree();
    const file = 'apps/web/src/core/a.ts';
    const old = new Date('2026-02-03T04:05:06Z');
    utimesSync(join(t.root, file), old, old);
    t.sync();
    expect(t.time(`${GAME}/core/a.ts`)).toBe(old.getTime());
  });

  it('--check reports a missing copy, a changed file and an extra file, and writes nothing', () => {
    const t = tree();
    const missing = t.sync('--check');
    expect(missing.status).toBe(1);
    expect(missing.output).toContain('core/a.ts');
    expect(t.exists(GAME)).toBe(false);

    t.sync();
    t.write('apps/web/src/engine/c.ts', 'export const c = 30;\n');
    const stale = t.sync('--check');
    expect(stale.status).toBe(1);
    expect(stale.output).toContain('engine/c.ts');
    expect(t.read(`${GAME}/engine/c.ts`)).toBe('export const c = 3;\n');

    t.sync();
    t.write(`${GAME}/core/a.ts`, 'export const a = "edited by hand";\n');
    const edited = t.sync('--check');
    expect(edited.status).toBe(1);
    expect(edited.output).toContain('core/a.ts');

    t.sync();
    t.write(`${GAME}/gone/old.ts`, 'export {};\n');
    const extra = t.sync('--check');
    expect(extra.status).toBe(1);
    expect(extra.output).toContain('old.ts');
    expect(t.exists(`${GAME}/gone/old.ts`)).toBe(true);
  });

  it('a sync repairs changes, and removes extra files and the folders left empty', () => {
    const t = tree();
    t.sync();
    t.write('apps/web/src/engine/c.ts', 'export const c = 30;\n');
    t.write(`${GAME}/core/a.ts`, 'edited');
    t.write(`${GAME}/gone/deep/old.ts`, 'export {};\n');
    t.write('apps/web/src/net/new.ts', 'export const n = 1;\n');
    expect(t.sync().status).toBe(0);
    expect(t.read(`${GAME}/engine/c.ts`)).toBe('export const c = 30;\n');
    expect(t.read(`${GAME}/core/a.ts`)).toBe('export const a = 1;\n');
    expect(t.read(`${GAME}/net/new.ts`)).toBe('export const n = 1;\n');
    expect(t.exists(`${GAME}/gone`)).toBe(false);
    expect(t.sync('--check').status).toBe(0);
  });

  it('a missing source folder is an error, and the copy stays as it was', () => {
    const t = tree();
    t.sync();
    rmSync(join(t.root, 'apps/web/src/net'), { recursive: true });
    for (const args of [[], ['--check']]) {
      const { status, output } = t.sync(...args);
      expect(status).toBe(2);
      expect(output).toContain('net');
    }
    expect(t.read(`${GAME}/net/d.ts`)).toBe('export const d = 4;\n');
  });

  it('an unknown option is an error', () => {
    expect(tree().sync('--chek').status).toBe(2);
  });
});
