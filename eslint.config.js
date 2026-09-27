// @ts-check
import path from 'node:path';
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * @typedef {object} ModuleRow
 * @property {string} rule Shown in every error from this row.
 * @property {string[]} [imports] May be imported in any way.
 * @property {string[]} [types] May be imported only with `import type` / `export type`.
 * @property {Record<string, string[]>} [values] The only run-time names allowed from a `types` entry.
 * @property {string[]} [never] Wins over everything else (carves exceptions out of '*').
 */

/**
 * PLAN §2.1: what each module of apps/web/src may import. Keep this table and the one in
 * docs/PLAN.md equal. apps/web/tests/lint/boundaries.test.ts checks it through ESLint's API.
 *
 * A module is a top-level folder of apps/web/src; a top-level file is its own module, named without
 * its extension (`main` = main.tsx). A row named `module/name` (`workers/protocol`) rules that file
 * or folder instead of its module's row. Every module may import its own files. An entry is a
 * module (`core`), one file or folder of a module (`app/store` = app/store.ts or app/store/…), or
 * '*' (every module). ⚠️ Only `import type` / `export type` / `import('…')` types are type-only: an
 * inline `import { type X } from '…'` compiles to `import {} from '…'` under verbatimModuleSyntax
 * and still loads the module, so it counts as a run-time import. Anything not listed is forbidden,
 * including any file outside apps/web/src. npm packages are not checked here.
 *
 * @type {Record<string, ModuleRow>}
 */
const WEB_MODULES = {
  core: { rule: 'core imports nothing' },
  eval: { rule: 'eval imports only core', imports: ['core'] },
  engine: { rule: 'the engine imports only core and eval', imports: ['core', 'eval'] },
  analysis: {
    rule: 'analysis imports core, eval, data, and only types from engine/types',
    imports: ['core', 'eval', 'data'],
    types: ['engine/types'],
  },
  brain: {
    rule: 'the brain only ever sees an Observation: it imports core, eval, analysis, data, and from engine/types only types and observationKey',
    imports: ['core', 'eval', 'analysis', 'data'],
    types: ['engine/types'],
    values: { 'engine/types': ['observationKey'] },
  },
  workers: {
    rule: 'workers import core, eval, analysis, brain, data, workers/protocol, and from engine/types only types and observationKey',
    imports: ['core', 'eval', 'analysis', 'brain', 'data', 'workers/protocol'],
    types: ['engine/types'],
    values: { 'engine/types': ['observationKey'] },
  },
  'workers/protocol': {
    rule: 'workers/protocol holds message types: it imports only types, from core, engine/types, analysis and brain',
    types: ['core', 'engine/types', 'analysis', 'brain'],
  },
  persist: {
    rule: 'persist imports core, engine/invariants, and types from any module except app and ui',
    imports: ['core', 'engine/invariants'],
    types: ['*'],
    never: ['app', 'ui'],
  },
  app: {
    rule: 'app imports core, eval, engine, analysis, brain, workers, persist, sound, types from any module, and nothing from ui',
    imports: ['core', 'eval', 'engine', 'analysis', 'brain', 'workers', 'persist', 'sound'],
    types: ['*'],
    never: ['ui'],
  },
  ui: {
    rule: 'the UI dispatches through the controller: it imports app/store, core, i18n, data, sound, and types from any module',
    imports: ['app/store', 'core', 'i18n', 'data', 'sound'],
    types: ['*'],
  },
  data: { rule: 'data imports only types, from core and eval', types: ['core', 'eval'] },
  i18n: { rule: 'i18n imports only types', types: ['*'] },
  sound: { rule: 'sound imports nothing' },
  main: { rule: 'main.tsx imports app, ui and i18n', imports: ['app', 'ui', 'i18n'] },
};

/** The module folders of apps/web/src (what '*' means). */
const MODULE_FOLDERS = new Set(
  Object.keys(WEB_MODULES).filter((key) => !key.includes('/') && key !== 'main'),
);

/** @param {string} p */
const toPosix = (p) => p.split(path.sep).join('/');
/** @param {string[]} parts */
const join = (...parts) => path.posix.normalize(path.posix.join(...parts));
/** @param {string} file @param {string} dir */
const isInside = (file, dir) => file === dir || file.startsWith(`${dir}/`);
/** @param {string} name */
const stripExtension = (name) => name.replace(/\.(d\.)?[cm]?[jt]sx?$/, '');

const ROOT = toPosix(import.meta.dirname);

/**
 * @typedef {{ file: string, repo: string, app: string }} Where
 * @typedef {{ module: string, file: string | null }} Target
 */

/**
 * Finds the repository and the `apps/<app>` folder around an absolute file path.
 * @param {string} filename @param {string} app @returns {Where | null}
 */
function locate(filename, app) {
  const file = toPosix(filename);
  const marker = `/apps/${app}/`;
  // Normally the file is under this config's folder; the fallback covers symlinked paths.
  const at = file.startsWith(`${ROOT}${marker}`) ? ROOT.length : file.lastIndexOf(marker);
  if (at < 0) return null;
  return { file, repo: file.slice(0, at), app: file.slice(0, at + marker.length - 1) };
}

/**
 * Where an import points: an absolute path, or null for an npm package. Covers relative paths at
 * any depth, absolute paths, Vite's root-relative `/src/…`, the workspace names `@rb/<app>/…` and
 * the usual alias spellings (`@/`, `~/`, `#/`, `#name/`, `src/`, `apps/…`), so adding a tsconfig or
 * Vite alias later cannot open a hole. `bare` maps the remaining forms.
 * @param {string} specifier @param {Where} where @param {(s: string) => string | null} bare
 * @returns {string | null}
 */
function resolveImport(specifier, where, bare) {
  const s = specifier.replace(/\?.*$/, ''); // Vite queries: ?worker, ?url, ?raw
  if (/^\.\.?(\/|$)/.test(s)) return join(path.posix.dirname(where.file), s);
  if (s.startsWith('/')) return isInside(s, where.repo) ? join(s) : join(where.app, s);
  const workspace = /^@rb\/([^/]+)(.*)$/.exec(s);
  if (workspace) return join(where.repo, 'apps', workspace[1] ?? '', workspace[2] ?? '');
  if (/^[@~#]\//.test(s)) return join(where.app, 'src', s.slice(2));
  if (s.startsWith('#')) return join(where.app, 'src', s.slice(1));
  if (s.startsWith('apps/')) return join(where.repo, s);
  if (s.startsWith('src/')) return join(where.app, s);
  return bare(s);
}

/**
 * The module (first folder) and file (`module/name`) of a path inside apps/web/src.
 * @param {string} src @param {string} file @returns {Target}
 */
function classify(src, file) {
  const [first = '', second] = file.slice(src.length + 1).split('/');
  const module = stripExtension(first);
  return { module, file: second === undefined ? null : `${module}/${stripExtension(second)}` };
}

/** @param {string[] | undefined} entries @param {Target} to */
const matches = (entries, to) =>
  (entries ?? []).some((entry) =>
    entry === '*' ? MODULE_FOLDERS.has(to.module) : entry === to.module || entry === to.file,
  );

/** The run-time names `row` may take from `to`, or null. @param {ModuleRow} row @param {Target} to */
function valuesFor(row, to) {
  const values = row.values ?? {};
  const key = [to.file, to.module].find((k) => k !== null && Object.hasOwn(values, k));
  return typeof key === 'string' ? (values[key] ?? null) : null;
}

/**
 * Why `fromKey` may not import `to` (a message id), or null when it may.
 * @param {string} fromKey @param {ModuleRow} row @param {Target} to
 * @param {boolean} typeOnly @param {string[] | null} names
 */
function judge(fromKey, row, to, typeOnly, names) {
  if (fromKey.includes('/') ? to.file === fromKey : to.module === fromKey) return null; // own files
  if (matches(row.never, to)) return 'forbidden';
  if (matches(row.imports, to)) return null;
  const values = valuesFor(row, to);
  if (typeOnly) return values !== null || matches(row.types, to) ? null : 'forbidden';
  if (values !== null) return names?.every((n) => values.includes(n)) ? null : 'values';
  return matches(row.types, to) ? 'typeOnly' : 'forbidden';
}

/**
 * Calls `check` for every import of a file: static imports, `export … from`, dynamic import(),
 * type-level `import('…')` and `import x = require('…')`. typeOnly: erased at build time. names:
 * the run-time names taken from the module ([] = loaded for its side effects), or null = all of it.
 * @param {import('eslint').Rule.RuleContext} context
 * @param {(node: any, specifier: string, typeOnly: boolean, names: string[] | null) => void} check
 * @returns {import('eslint').Rule.RuleListener}
 */
function importVisitors(context, check) {
  /** @param {any} node @param {any} source @param {boolean} typeOnly @param {string[] | null} names */
  const visit = (node, source, typeOnly, names) => {
    /** @type {string | null} */
    let specifier = null;
    if (source?.type === 'Literal' && typeof source.value === 'string') specifier = source.value;
    else if (source?.type === 'TemplateLiteral' && source.expressions.length === 0) {
      specifier = source.quasis[0].value.cooked;
    }
    if (specifier === null) context.report({ node, messageId: 'computed' });
    else check(node, specifier, typeOnly, names);
  };
  /** @param {any} id @returns {string} */
  const nameOf = (id) => (id.type === 'Identifier' ? id.name : String(id.value));
  /** @type {Record<string, (node: any) => void>} */
  const listener = {
    ImportDeclaration(node) {
      /** @type {string[]} */
      const names = node.specifiers.flatMap((/** @type {any} */ s) => {
        if (s.type === 'ImportDefaultSpecifier') return ['default'];
        if (s.type === 'ImportNamespaceSpecifier') return ['*'];
        return s.importKind === 'type' ? [] : [nameOf(s.imported)];
      });
      visit(node, node.source, node.importKind === 'type', names.includes('*') ? null : names);
    },
    'ExportNamedDeclaration[source]'(node) {
      const names = node.specifiers.flatMap((/** @type {any} */ s) =>
        s.exportKind === 'type' ? [] : [nameOf(s.local)],
      );
      visit(node, node.source, node.exportKind === 'type', names);
    },
    ExportAllDeclaration(node) {
      visit(node, node.source, node.exportKind === 'type', null);
    },
    ImportExpression(node) {
      visit(node, node.source, false, null);
    },
    TSImportType(node) {
      visit(node, node.source ?? node.argument?.literal, true, null);
    },
    TSImportEqualsDeclaration(node) {
      if (node.moduleReference.type !== 'TSExternalModuleReference') return;
      visit(node, node.moduleReference.expression, node.importKind === 'type', null);
    },
  };
  return listener;
}

/** @type {import('eslint').Rule.RuleModule} */
const webModuleBoundaries = {
  meta: {
    type: 'problem',
    docs: { description: 'Enforce the PLAN §2.1 module map of apps/web/src.' },
    schema: [],
    messages: {
      forbidden: '{{from}} must not import {{target}}. PLAN §2.1: {{rule}}.',
      typeOnly:
        '{{from}} may import only types from {{target}}: use `import type` (an inline `import { type X }` still loads the module). PLAN §2.1: {{rule}}.',
      values: '{{from}} may import from {{target}} only types and {{names}}. PLAN §2.1: {{rule}}.',
      outside:
        '{{from}} must not import {{target}}: apps/web/src imports only its own modules and npm packages (PLAN §2.1).',
      unknown:
        '{{from}} is not a module in the PLAN §2.1 table: add its row to docs/PLAN.md and to WEB_MODULES in eslint.config.js.',
      computed:
        'Give import() a string literal, so the module boundaries can be checked (PLAN §2.1).',
    },
  },
  create(context) {
    const where = locate(context.filename, 'web');
    if (where === null) return {};
    const src = `${where.app}/src`;
    if (!isInside(where.file, src)) return {};
    const self = classify(src, where.file);
    const fromKey =
      self.file !== null && Object.hasOwn(WEB_MODULES, self.file) ? self.file : self.module;
    const row = Object.hasOwn(WEB_MODULES, fromKey) ? WEB_MODULES[fromKey] : undefined;
    const from = `src/${fromKey === 'main' ? 'main.tsx' : fromKey}`;
    return importVisitors(context, (node, specifier, typeOnly, names) => {
      if (row === undefined) return context.report({ node, messageId: 'unknown', data: { from } });
      const target = resolveImport(specifier, where, (s) =>
        MODULE_FOLDERS.has(s.split('/')[0] ?? '') ? join(where.app, 'src', s) : null,
      );
      if (target === null) return; // an npm package
      if (!isInside(target, src)) {
        const shown = path.posix.relative(where.repo, target);
        return context.report({ node, messageId: 'outside', data: { from, target: shown } });
      }
      const to = classify(src, target);
      const messageId = judge(fromKey, row, to, typeOnly, names);
      if (messageId === null) return;
      const shown = path.posix.relative(where.app, target);
      const allowed = (valuesFor(row, to) ?? []).join(', ');
      context.report({
        node,
        messageId,
        data: { from, target: shown, rule: row.rule, names: allowed },
      });
    });
  },
};

/** @type {import('eslint').Rule.RuleModule} */
const serverNoWebImports = {
  meta: {
    type: 'problem',
    docs: { description: 'apps/server must not import anything from apps/web (PLAN §2.1).' },
    schema: [],
    messages: {
      web: 'apps/server must not import {{target}}: the server only serves the built files in apps/web/dist (PLAN §2.1, §2.6).',
      computed:
        'Give import() a string literal, so the server-must-not-import-web rule can check it (PLAN §2.1).',
    },
  },
  create(context) {
    const where = locate(context.filename, 'server');
    if (where === null) return {};
    const web = `${where.repo}/apps/web`;
    return importVisitors(context, (node, specifier) => {
      const target = resolveImport(specifier, where, (s) =>
        /^@?web(\/|$)/.test(s) ? join(where.repo, 'apps', s.replace(/^@/, '')) : null,
      );
      if (target === null || !isInside(target, web)) return;
      const shown = path.posix.relative(where.repo, target);
      context.report({ node, messageId: 'web', data: { target: shown } });
    });
  },
};

const MATH_RANDOM =
  'Math.random is banned in apps/web/src: use a seeded stream from core/rng.ts (PLAN §0.3, §5.6).';

export default defineConfig(
  globalIgnores([
    '**/dist/',
    '**/node_modules/',
    '**/coverage/',
    '**/playwright-report/',
    '**/test-results/',
    '.claude/',
    '.loop/',
  ]),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    // The game: runs in the browser.
    files: ['apps/web/src/**', 'apps/web/tests/**'],
    languageOptions: { globals: globals.browser },
  },
  {
    // The server, config files and scripts: run in Node.
    files: ['apps/server/**', '**/*.config.{js,ts}', 'eslint.config.js'],
    languageOptions: { globals: globals.node },
  },
  {
    plugins: {
      rb: {
        meta: { name: 'rb' },
        rules: {
          'web-module-boundaries': webModuleBoundaries,
          'server-no-web-imports': serverNoWebImports,
        },
      },
    },
  },
  {
    // PLAN §2.1 module map; PLAN §0.3 and §5.6: randomness only through core/rng.ts.
    files: ['apps/web/src/**'],
    rules: {
      'rb/web-module-boundaries': 'error',
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: MATH_RANDOM },
      ],
      'no-restricted-syntax': [
        'error',
        {
          // globalThis.Math.random, window.Math.random, self.Math.random
          selector: "MemberExpression[object.property.name='Math'][property.name='random']",
          message: MATH_RANDOM,
        },
      ],
    },
  },
  {
    // PLAN §2.1: the server only serves apps/web/dist; it never imports the game.
    files: ['apps/server/**'],
    rules: { 'rb/server-no-web-imports': 'error' },
  },
);
