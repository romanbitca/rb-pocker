/**
 * Copies the game's platform-free folders (core, eval, engine, net of apps/web/src) to
 * apps/server/src/game/ (PLAN §19.3). The server compiles that copy with its own tsc, so its build
 * keeps one rootDir and dist/main.js stays where it is. The folder is generated and gitignored:
 * never edit a file there, edit the source in apps/web/src.
 *
 * Runs from apps/server/package.json (`sync:game`: prebuild, predev, pretypecheck) and from
 * apps/server/test/global-setup.ts.
 *
 * Usage (from any folder): node scripts/sync-game.mjs [--check]
 *   (none)   make the copy equal to the sources. Only what differs is touched: with nothing to do
 *            no file changes, not even its modification time.
 *   --check  compare only. Exit 1 and list the differences when the copy is out of date.
 * Exit 2: an unknown option, or a source folder that does not exist.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  rmdirSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const WEB_SRC = join(ROOT, 'apps/web/src');
const GAME = join(ROOT, 'apps/server/src/game');
const FOLDERS = ['core', 'eval', 'engine', 'net'];
/** A file being written lives under this name in GAME until its rename. Never part of the copy. */
const TEMP_PREFIX = '.sync-tmp-';

function fail(message) {
  console.error(`sync-game: ${message}`);
  process.exit(2);
}

/** Every file under `dir`, as paths relative to it. */
function filesUnder(dir, prefix = '') {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(TEMP_PREFIX)) return [];
    const path = join(prefix, entry.name);
    return entry.isDirectory() ? filesUnder(join(dir, entry.name), path) : [path];
  });
}

/** Deletes every folder under `dir` that holds no file. */
function removeEmptyFolders(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const folder = join(dir, entry.name);
    removeEmptyFolders(folder);
    if (readdirSync(folder).length === 0) rmdirSync(folder);
  }
}

/**
 * Copies one file so that nobody ever reads half of it: a test run and a typecheck can sync at the
 * same moment. The copy keeps the source's modification time, so scripts/build-if-needed.mjs never
 * takes a sync for a change: the source is one of its inputs already.
 */
function copyFile(from, to, n) {
  const temp = join(GAME, `${TEMP_PREFIX}${process.pid}-${n}`);
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, temp, { preserveTimestamps: true });
  renameSync(temp, to);
}

const args = process.argv.slice(2);
const unknown = args.find((arg) => arg !== '--check');
if (unknown !== undefined) fail(`unknown option ${unknown} (only --check)`);
const check = args.length > 0;

/** Path inside the copy → absolute path of its source. */
const sources = new Map();
for (const folder of FOLDERS) {
  const dir = join(WEB_SRC, folder);
  if (!existsSync(dir)) fail(`${dir} does not exist`);
  for (const file of filesUnder(dir)) sources.set(join(folder, file), join(dir, file));
}

const copy = existsSync(GAME) ? filesUnder(GAME) : [];
const changed = [...sources].filter(([file, from]) => {
  const to = join(GAME, file);
  return !existsSync(to) || !readFileSync(to).equals(readFileSync(from));
});
const extra = copy.filter((file) => !sources.has(file));

if (check) {
  if (changed.length > 0 || extra.length > 0) {
    console.error('sync-game: apps/server/src/game/ is out of date:');
    for (const [file] of changed) console.error(`  differs: ${file}`);
    for (const file of extra) console.error(`  not in the sources: ${file}`);
    console.error('Run: npm run sync:game -w @rb/server (never edit that folder by hand).');
    process.exit(1);
  }
} else if (changed.length > 0 || extra.length > 0) {
  changed.forEach(([file, from], n) => copyFile(from, join(GAME, file), n));
  for (const file of extra) rmSync(join(GAME, file), { force: true });
  removeEmptyFolders(GAME);
  console.log(`sync-game: ${changed.length} copied, ${extra.length} removed`);
}
