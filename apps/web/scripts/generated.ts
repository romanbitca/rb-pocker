/**
 * The committed outputs of the `gen-*.ts` scripts and their `checksums.json` (PLAN §0.1, §7.5),
 * shared by `gen-preflop.ts` (and the later generators) and `check-tables.ts`.
 *
 * `src/data/generated/` holds TypeScript modules that workers import directly (binary as base64,
 * no runtime fetches) and `checksums.json`: the SHA-256 of every module, the generator version and
 * the seed it used. ⚠️ Nobody edits these files by hand: `npm run gen` rewrites them and
 * `npm run gen:check` fails when a file no longer matches its checksum.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** `src/data/generated/`, with a trailing slash. */
export const GENERATED_DIR = fileURLToPath(new URL('../src/data/generated/', import.meta.url));

export const CHECKSUMS_FILE = 'checksums.json';

/** What `checksums.json` records about one generated module. */
export interface ChecksumEntry {
  /** SHA-256 (hex) of the module file exactly as committed. */
  readonly sha256: string;
  /** Generator id and version, e.g. `gen-preflop@1`: bumped whenever the method changes. */
  readonly generator: string;
  /** Seed of the sampling (32 hex), or null when the table is exact. */
  readonly seed: string | null;
  /** Monte Carlo trials per cell, or null when the table is exact. */
  readonly trials: number | null;
}

export interface Checksums {
  readonly files: Readonly<Record<string, ChecksumEntry>>;
}

export function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

const SHA_TEXT = /^[0-9a-f]{64}$/;
const SEED_TEXT = /^[0-9a-f]{32}$/;

function isEntry(value: unknown): value is ChecksumEntry {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.sha256 === 'string' &&
    SHA_TEXT.test(e.sha256) &&
    typeof e.generator === 'string' &&
    e.generator !== '' &&
    (e.seed === null || (typeof e.seed === 'string' && SEED_TEXT.test(e.seed))) &&
    (e.trials === null || (typeof e.trials === 'number' && Number.isSafeInteger(e.trials)))
  );
}

/** Parses `checksums.json` text. Throws an `Error` that says what is wrong. */
export function parseChecksums(text: string): Checksums {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${CHECKSUMS_FILE} is not valid JSON`);
  }
  const files = (json as { files?: unknown } | null)?.files;
  if (typeof files !== 'object' || files === null || Array.isArray(files)) {
    throw new Error(`${CHECKSUMS_FILE} has no "files" object`);
  }
  for (const [name, entry] of Object.entries(files)) {
    if (!isEntry(entry)) {
      throw new Error(`${CHECKSUMS_FILE}: the entry for ${name} is malformed`);
    }
  }
  return { files: files as Checksums['files'] };
}

/** `checksums.json` as written: keys sorted, two-space indent, trailing newline. */
export function formatChecksums(checksums: Checksums): string {
  const files = Object.fromEntries(
    Object.entries(checksums.files)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([name, e]) => [
        name,
        { sha256: e.sha256, generator: e.generator, seed: e.seed, trials: e.trials },
      ]),
  );
  return `${JSON.stringify({ files }, null, 2)}\n`;
}

/** Writes a generated module and records it in `checksums.json` (other entries stay as they are). */
export function writeGenerated(
  dir: string,
  file: string,
  text: string,
  entry: Omit<ChecksumEntry, 'sha256'>,
): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, file), text);
  const path = join(dir, CHECKSUMS_FILE);
  const files: Record<string, ChecksumEntry> = existsSync(path)
    ? { ...parseChecksums(readFileSync(path, 'utf8')).files }
    : {};
  files[file] = { sha256: sha256(text), ...entry };
  writeFileSync(path, formatChecksums({ files }));
}

/**
 * Checks every module in `dir` against `checksums.json`. Returns one sentence per problem ([] when
 * all is well): a file that changed, one that is missing, a generated module nobody recorded, or
 * an unreadable `checksums.json`.
 */
export function verifyChecksums(dir: string): string[] {
  const path = join(dir, CHECKSUMS_FILE);
  if (!existsSync(path)) return [`${CHECKSUMS_FILE} is missing from ${dir}`];
  let checksums: Checksums;
  try {
    checksums = parseChecksums(readFileSync(path, 'utf8'));
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
  const problems: string[] = [];
  for (const [file, entry] of Object.entries(checksums.files)) {
    if (!existsSync(join(dir, file))) {
      problems.push(`${file} is listed in ${CHECKSUMS_FILE} but missing`);
    } else if (sha256(readFileSync(join(dir, file))) !== entry.sha256) {
      problems.push(`${file} does not match its checksum: edited by hand, or not regenerated`);
    }
  }
  for (const file of readdirSync(dir).sort()) {
    if (file.endsWith('.ts') && !Object.hasOwn(checksums.files, file)) {
      problems.push(`${file} is not listed in ${CHECKSUMS_FILE}`);
    }
  }
  return problems;
}

/**
 * The text of a generated module: `//` header lines, `export const NAME = <number>;` lines, then
 * `export const <name> = '<base64>';` for the bytes (PLAN §7.5: "binary as base64").
 */
export function binaryModule(
  header: readonly string[],
  numbers: Readonly<Record<string, number>>,
  name: string,
  bytes: Uint8Array,
): string {
  return [
    ...header.map((line) => (line === '' ? '//' : `// ${line}`)),
    '',
    ...Object.entries(numbers).map(([key, value]) => `export const ${key} = ${value};`),
    '',
    `export const ${name} =`,
    `  '${Buffer.from(bytes).toString('base64')}';`,
    '',
  ].join('\n');
}

/** The base64 text of `export const <name> = '<base64>';` in a module written by `binaryModule`. */
export function readBase64Export(text: string, name: string): string {
  const found = new RegExp(`^export const ${name} =\\s*'([A-Za-z0-9+/=]*)';$`, 'm').exec(text);
  if (found === null) throw new Error(`no "export const ${name} = '<base64>';" in the module`);
  return found[1] ?? '';
}

/** The value of `export const <name> = <number>;` in a module written by `binaryModule`. */
export function readNumberExport(text: string, name: string): number {
  const found = new RegExp(`^export const ${name} = (\\d+);$`, 'm').exec(text);
  if (found === null) throw new Error(`no "export const ${name} = <number>;" in the module`);
  return Number(found[1]);
}
