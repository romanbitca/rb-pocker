import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  binaryModule,
  CHECKSUMS_FILE,
  formatChecksums,
  parseChecksums,
  readBase64Export,
  readNumberExport,
  sha256,
  verifyChecksums,
  writeGenerated,
  type ChecksumEntry,
} from '../../scripts/generated.ts';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'generated-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const ENTRY = { generator: 'gen-test@1', seed: null, trials: null } as const;

describe('scripts/generated.ts: generated modules and checksums.json (PLAN §7.5)', () => {
  it('hashes with SHA-256', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256(new TextEncoder().encode('abc'))).toBe(sha256('abc'));
  });

  it('writes a module as comment header, numbers and one base64 line, and reads it back', () => {
    const bytes = Uint8Array.from([0, 1, 2, 250, 251, 255]);
    const text = binaryModule(['first line', '', 'third line'], { A_NUMBER: 42 }, 'A_B64', bytes);
    expect(text).toBe(
      "// first line\n//\n// third line\n\nexport const A_NUMBER = 42;\n\nexport const A_B64 =\n  'AAEC+vv/';\n",
    );
    expect(readBase64Export(text, 'A_B64')).toBe('AAEC+vv/');
    expect(readNumberExport(text, 'A_NUMBER')).toBe(42);
    expect(() => readBase64Export(text, 'OTHER')).toThrow(/OTHER/);
    expect(() => readNumberExport(text, 'OTHER')).toThrow(/OTHER/);
  });

  it('records each file in checksums.json: sorted, merged with the entries already there', () => {
    writeGenerated(dir, 'b.ts', 'export const b = 1;\n', ENTRY);
    writeGenerated(dir, 'a.ts', 'export const a = 1;\n', { ...ENTRY, trials: 7 });
    const text = readFileSync(join(dir, CHECKSUMS_FILE), 'utf8');
    const { files } = parseChecksums(text);
    expect(Object.keys(files)).toEqual(['a.ts', 'b.ts']);
    expect(files['a.ts']).toEqual({ sha256: sha256('export const a = 1;\n'), ...ENTRY, trials: 7 });
    expect(text.endsWith('}\n')).toBe(true);
    expect(formatChecksums({ files })).toBe(text);
    // A rewrite of one file changes only its own entry.
    writeGenerated(dir, 'a.ts', 'export const a = 2;\n', ENTRY);
    const after = parseChecksums(readFileSync(join(dir, CHECKSUMS_FILE), 'utf8')).files;
    expect(after['a.ts']?.sha256).toBe(sha256('export const a = 2;\n'));
    expect(after['b.ts']).toEqual(files['b.ts']);
    expect(verifyChecksums(dir)).toEqual([]);
  });

  it('rejects a checksums.json that is not well formed', () => {
    expect(() => parseChecksums('{')).toThrow(/not valid JSON/);
    expect(() => parseChecksums('null')).toThrow(/"files"/);
    expect(() => parseChecksums('{"files": []}')).toThrow(/"files"/);
    const entry = { sha256: 'a'.repeat(64), generator: 'g@1', seed: null, trials: null };
    const bad: Partial<Record<string, unknown>>[] = [
      { ...entry, sha256: 'xyz' },
      { ...entry, generator: '' },
      { ...entry, seed: 'short' },
      { ...entry, trials: 1.5 },
      { ...entry, trials: '5' },
      { generator: 'g@1', seed: null, trials: null },
    ];
    for (const e of bad) {
      expect(() => parseChecksums(JSON.stringify({ files: { 'x.ts': e } }))).toThrow(/x\.ts/);
    }
    const good: ChecksumEntry = { ...entry, seed: '0123456789abcdef0123456789abcdef', trials: 9 };
    expect(parseChecksums(JSON.stringify({ files: { 'x.ts': good } })).files['x.ts']).toEqual(good);
  });

  it('reports a changed, missing or unlisted file, and a missing or broken checksums.json', () => {
    expect(verifyChecksums(dir)).toEqual([`${CHECKSUMS_FILE} is missing from ${dir}`]);
    writeGenerated(dir, 'a.ts', 'export const a = 1;\n', ENTRY);
    writeGenerated(dir, 'b.ts', 'export const b = 1;\n', ENTRY);
    expect(verifyChecksums(dir)).toEqual([]);

    writeFileSync(join(dir, 'a.ts'), 'export const a = 2;\n'); // edited by hand
    expect(verifyChecksums(dir)).toEqual([
      'a.ts does not match its checksum: edited by hand, or not regenerated',
    ]);

    rmSync(join(dir, 'b.ts'));
    writeFileSync(join(dir, 'c.ts'), 'export const c = 1;\n'); // nobody recorded it
    expect(verifyChecksums(dir)).toEqual([
      'a.ts does not match its checksum: edited by hand, or not regenerated',
      `b.ts is listed in ${CHECKSUMS_FILE} but missing`,
      `c.ts is not listed in ${CHECKSUMS_FILE}`,
    ]);

    writeFileSync(join(dir, CHECKSUMS_FILE), '[not json');
    expect(verifyChecksums(dir)).toEqual([`${CHECKSUMS_FILE} is not valid JSON`]);
  });
});
