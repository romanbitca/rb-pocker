// The lint rules of the root eslint.config.js, run through ESLint's Node API (PLAN §18 Stage 0,
// acceptance 5; the module map of PLAN §2.1; the Math.random ban of §5.6). Every fixture is a
// virtual file (`lintText` with a `filePath`): nothing is written to disk, and the modules the
// fixtures import do not have to exist yet.
import { ESLint, type Linter } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

// The repository root, ending in '/'. (No node:path here: apps/web's tsconfig has no Node types.)
const ROOT = decodeURIComponent(new URL('../../../../', import.meta.url).pathname);
const eslint = new ESLint({ cwd: ROOT });

const BOUNDARIES = 'rb/web-module-boundaries';
const SERVER = 'rb/server-no-web-imports';
const MATH_RANDOM = 'no-restricted-properties';
const GLOBAL_MATH_RANDOM = 'no-restricted-syntax';

async function lint(file: string, code: string): Promise<Linter.LintMessage[]> {
  const results = await eslint.lintText(code, { filePath: ROOT + file, warnIgnored: true });
  return results.flatMap((result) => result.messages);
}

/** Lint fails on `code` at `file`, with an error from `rule`. */
async function expectError(file: string, code: string, rule: string, message?: RegExp) {
  const expected = {
    ruleId: rule,
    severity: 2,
    ...(message && { message: expect.stringMatching(message) }),
  };
  expect(await lint(file, code)).toContainEqual(expect.objectContaining(expected));
}

/** Lint passes on `code` at `file`: no error, no parse error, and the file is not ignored. */
async function expectClean(file: string, code: string) {
  const problems = (await lint(file, code)).filter((m) => m.severity === 2 || m.ruleId === null);
  expect(problems).toEqual([]);
}

const valueImport = (specifier: string) =>
  `import { value } from '${specifier}';\nexport const used = value;\n`;
const typeImport = (specifier: string) =>
  `import type { Value } from '${specifier}';\nexport type Used = Value;\n`;

beforeAll(async () => {
  await lint('apps/web/src/core/warm-up.ts', 'export {};\n'); // loads the config and the parser
}, 60_000);

describe('PLAN §18 Stage 0, acceptance 5', () => {
  it('fails when brain/ imports engine/step', () =>
    expectError(
      'apps/web/src/brain/decide.ts',
      "import { step } from '../engine/step.ts';\nexport const run = step;\n",
      BOUNDARIES,
      /^src\/brain must not import src\/engine\/step\.ts\. PLAN §2\.1/,
    ));

  it('fails on Math.random() in src/core', () =>
    expectError(
      'apps/web/src/core/rng.ts',
      'export const roll = Math.random();\n',
      MATH_RANDOM,
      /use a seeded stream from core\/rng\.ts/,
    ));

  it('fails when an apps/server file imports apps/web/src', () =>
    expectError(
      'apps/server/src/app.module.ts',
      "import { en } from '../../web/src/i18n/en.ts';\nexport const name = en.app.name;\n",
      SERVER,
      /^apps\/server must not import apps\/web\/src\/i18n\/en\.ts/,
    ));

  it('passes when brain/ imports types from engine/types', () =>
    expectClean(
      'apps/web/src/brain/decide.ts',
      "import type { Observation } from '../engine/types.ts';\nexport type Seen = Observation;\n",
    ));

  it('passes when engine/ imports core and eval', () =>
    expectClean(
      'apps/web/src/engine/start.ts',
      "import { rngFromSeed } from '../core/rng.ts';\nimport { score7 } from '../eval/evaluate.ts';\n" +
        'export const deps = [rngFromSeed, score7];\n',
    ));

  it('passes when ui/ imports app/store, at any depth', async () => {
    await expectClean('apps/web/src/ui/App.tsx', valueImport('../app/store.ts'));
    await expectClean('apps/web/src/ui/screens/Table.tsx', valueImport('../../app/store.ts'));
  });
});

describe('module boundaries (PLAN §2.1)', () => {
  // Every way of writing "brain imports engine/step", including aliases nobody has configured yet.
  it.each([
    '../engine/step.ts',
    '../engine/step',
    './../engine/step.ts',
    '../brain/../engine/step.ts',
    '../../src/engine/step.ts',
    '../engine/step.ts?worker',
    '../engine',
    '@/engine/step',
    '~/engine/step.ts',
    '#/engine/step.ts',
    '#engine/step',
    'src/engine/step.ts',
    '/src/engine/step.ts',
    'engine/step',
    '@rb/web/src/engine/step.ts',
    'apps/web/src/engine/step.ts',
    `${ROOT}apps/web/src/engine/step.ts`,
  ])('brain importing %s fails', (specifier) =>
    expectError('apps/web/src/brain/decide.ts', valueImport(specifier), BOUNDARIES),
  );

  it.each([
    ['apps/web/src/brain/policy/preflop.ts', '../../engine/step.ts'],
    ['apps/web/src/brain/a/b/c.ts', '../../../engine/step.ts'],
  ])('%s importing %s fails', (file, specifier) =>
    expectError(file, valueImport(specifier), BOUNDARIES),
  );

  it.each([
    ['a re-export', "export { step } from '../engine/step.ts';\n"],
    ['export *', "export * from '../engine/observe.ts';\n"],
    ['a dynamic import()', "export const load = () => import('../engine/step.ts');\n"],
    ['a side-effect import', "import '../engine/step.ts';\n"],
    ['import type from an engine file other than engine/types', typeImport('../engine/step.ts')],
    [
      'an import() type from engine runtime',
      "export type Step = typeof import('../engine/step.ts');\n",
    ],
    [
      'an inline type import (it still loads the module)',
      "import { type Observation } from '../engine/observe.ts';\nexport type Seen = Observation;\n",
    ],
    [
      'a namespace import of engine/types',
      "import * as types from '../engine/types.ts';\nexport const t = types;\n",
    ],
    ['a value of engine/types other than observationKey', valueImport('../engine/types.ts')],
    ['import() with a computed path', 'export const load = (name: string) => import(name);\n'],
  ])('brain with %s fails', (_, code) =>
    expectError('apps/web/src/brain/decide.ts', code, BOUNDARIES),
  );

  it.each([
    ['core → eval', 'apps/web/src/core/cards.ts', valueImport('../eval/evaluate.ts')],
    ['core → types of engine', 'apps/web/src/core/cards.ts', typeImport('../engine/types.ts')],
    ['eval → engine', 'apps/web/src/eval/evaluate.ts', valueImport('../engine/step.ts')],
    ['engine → brain', 'apps/web/src/engine/step.ts', valueImport('../brain/decide.ts')],
    ['engine → analysis', 'apps/web/src/engine/step.ts', valueImport('../analysis/equity.ts')],
    ['engine → persist', 'apps/web/src/engine/step.ts', valueImport('../persist/storage.ts')],
    ['engine → app', 'apps/web/src/engine/step.ts', valueImport('../app/store.ts')],
    ['engine → ui', 'apps/web/src/engine/step.ts', valueImport('../ui/App.tsx')],
    [
      'analysis → engine runtime',
      'apps/web/src/analysis/equity.ts',
      valueImport('../engine/legal.ts'),
    ],
    [
      'analysis → an inline type import of engine/types',
      'apps/web/src/analysis/equity.ts',
      "import { type HandState } from '../engine/types.ts';\nexport type State = HandState;\n",
    ],
    ['analysis → brain', 'apps/web/src/analysis/equity.ts', valueImport('../brain/decide.ts')],
    [
      'workers → engine/observe',
      'apps/web/src/workers/brain.worker.ts',
      valueImport('../engine/observe.ts'),
    ],
    ['workers → app', 'apps/web/src/workers/equity.worker.ts', valueImport('../app/store.ts')],
    ['workers → ui', 'apps/web/src/workers/equity.worker.ts', valueImport('../ui/App.tsx')],
    [
      'workers/protocol → a brain value',
      'apps/web/src/workers/protocol.ts',
      valueImport('../brain/decide.ts'),
    ],
    [
      'workers/protocol → a worker',
      'apps/web/src/workers/protocol.ts',
      typeImport('./equity.worker.ts'),
    ],
    ['persist → ui', 'apps/web/src/persist/profile.ts', valueImport('../ui/App.tsx')],
    ['persist → types of app', 'apps/web/src/persist/profile.ts', typeImport('../app/store.ts')],
    [
      'persist → engine runtime',
      'apps/web/src/persist/session.ts',
      valueImport('../engine/step.ts'),
    ],
    ['app → ui', 'apps/web/src/app/controller.ts', valueImport('../ui/App.tsx')],
    ['app → types of ui', 'apps/web/src/app/store.ts', typeImport('../ui/components/Seat.tsx')],
    ['app → i18n values', 'apps/web/src/app/controller.ts', valueImport('../i18n/en.ts')],
    [
      'ui → the engine reducer',
      'apps/web/src/ui/screens/Table.tsx',
      valueImport('../../engine/step.ts'),
    ],
    [
      'ui → brain',
      'apps/web/src/ui/components/CoachStrip.tsx',
      valueImport('../../brain/decide.ts'),
    ],
    [
      'ui → the controller (only app/store)',
      'apps/web/src/ui/App.tsx',
      valueImport('../app/controller.ts'),
    ],
    ['ui → persist', 'apps/web/src/ui/App.tsx', valueImport('../persist/storage.ts')],
    ['data → engine', 'apps/web/src/data/rankings.ts', valueImport('../engine/step.ts')],
    ['data → core values', 'apps/web/src/data/lessons.ts', valueImport('../core/cards.ts')],
    ['i18n → brain values', 'apps/web/src/i18n/en.ts', valueImport('../brain/profiles.ts')],
    ['sound → app', 'apps/web/src/sound/synth.ts', valueImport('../app/store.ts')],
    ['main.tsx → engine', 'apps/web/src/main.tsx', valueImport('./engine/step.ts')],
    [
      'a module → a folder missing from the table',
      'apps/web/src/core/cards.ts',
      valueImport('../hooks/useSeat.ts'),
    ],
    [
      'a folder missing from the table',
      'apps/web/src/hooks/useSeat.ts',
      valueImport('../core/cards.ts'),
    ],
    [
      'src → apps/web outside src',
      'apps/web/src/ui/App.tsx',
      valueImport('../../tests/helpers.ts'),
    ],
    ['src → the web package root', 'apps/web/src/ui/App.tsx', valueImport('@rb/web')],
    ['src → the server', 'apps/web/src/app/controller.ts', valueImport('@rb/server/src/setup.ts')],
  ])('%s fails', (_, file, code) => expectError(file, code, BOUNDARIES));

  it.each([
    [
      'brain: observationKey and types from engine/types',
      'apps/web/src/brain/decide.ts',
      "import { observationKey, type Observation } from '../engine/types.ts';\n" +
        'export const key = (o: Observation): string => observationKey(o);\n',
    ],
    [
      'brain: core, eval, analysis, data',
      'apps/web/src/brain/ranges.ts',
      "import { randInt } from '../core/rng.ts';\nimport { score7 } from '../eval/evaluate.ts';\n" +
        "import { equity } from '../analysis/equity.ts';\nimport { RANGES } from '../data/generated/ranges.ts';\n" +
        'export const deps = [randInt, score7, equity, RANGES];\n',
    ],
    [
      'brain: a type re-export and an import() type from engine/types',
      'apps/web/src/brain/types.ts',
      "export type { Observation } from '../engine/types.ts';\n" +
        "export type Legal = import('../engine/types.ts').LegalActions;\n",
    ],
    [
      'analysis: types from engine/types, and data',
      'apps/web/src/analysis/preflop.ts',
      "import type { HandState } from '../engine/types.ts';\nimport { PREFLOP } from '../data/generated/preflop.ts';\n" +
        'export type State = HandState;\nexport const table = PREFLOP;\n',
    ],
    [
      'workers: brain, analysis, protocol, observationKey',
      'apps/web/src/workers/brain.worker.ts',
      "import { hint } from '../brain/decide.ts';\nimport { equity } from '../analysis/equity.ts';\n" +
        "import { observationKey } from '../engine/types.ts';\nimport type { BrainRequest } from './protocol.ts';\n" +
        'export const deps = [hint, equity, observationKey];\nexport type Request = BrainRequest;\n',
    ],
    [
      'workers/protocol: only types',
      'apps/web/src/workers/protocol.ts',
      "import type { Card } from '../core/cards.ts';\nimport type { Observation } from '../engine/types.ts';\n" +
        "import type { EquityResult } from '../analysis/types.ts';\nimport type { Decision } from '../brain/types.ts';\n" +
        'export type Parts = [Card, Observation, EquityResult, Decision];\n',
    ],
    [
      'persist: core, engine/invariants, and types',
      'apps/web/src/persist/session.ts',
      "import { ZERO_SEED } from '../core/rng.ts';\nimport { checkInvariants } from '../engine/invariants.ts';\n" +
        "import type { HandState } from '../engine/types.ts';\nimport type { Grade } from '../brain/types.ts';\n" +
        'export const deps = [ZERO_SEED, checkInvariants];\nexport type Parts = [HandState, Grade];\n',
    ],
    [
      'app: engine, brain, persist, workers, sound, and types of i18n',
      'apps/web/src/app/controller.ts',
      "import { step } from '../engine/step.ts';\nimport { observe } from '../engine/observe.ts';\n" +
        "import { hint } from '../brain/decide.ts';\nimport { loadProfile } from '../persist/profile.ts';\n" +
        "import { play } from '../sound/synth.ts';\nimport type { BrainRequest } from '../workers/protocol.ts';\n" +
        "import type { en } from '../i18n/en.ts';\n" +
        'export const deps = [step, observe, hint, loadProfile, play];\n' +
        'export type Parts = [BrainRequest, typeof en];\n',
    ],
    [
      'app: a module worker (a URL, not an import)',
      'apps/web/src/app/workerClient.ts',
      'export const start = (): Worker =>\n' +
        "  new Worker(new URL('../workers/equity.worker.ts', import.meta.url), { type: 'module' });\n",
    ],
    [
      'ui: store, core, i18n, data, sound, packages, CSS, lazy screens, types',
      'apps/web/src/ui/screens/Table.tsx',
      "import { memo } from 'react';\nimport { useShallow } from 'zustand/react/shallow';\n" +
        "import { useRegisterSW } from 'virtual:pwa-register/react';\nimport { useStore } from '../../app/store.ts';\n" +
        "import { parseCard } from '../../core/cards.ts';\nimport { en } from '../../i18n/en.ts';\n" +
        "import { RANKINGS } from '../../data/rankings.ts';\nimport { play } from '../../sound/synth.ts';\n" +
        "import styles from './Table.module.css';\nimport type { Decision } from '../../brain/types.ts';\n" +
        "import type { HandState } from '../../engine/types.ts';\n" +
        'export const deps = [memo, useShallow, useRegisterSW, useStore, parseCard, en, RANKINGS, play, styles];\n' +
        "export const Stats = () => import('./Stats.tsx');\nexport type Parts = [Decision, HandState];\n",
    ],
    [
      'ui: its own files at any depth',
      'apps/web/src/ui/components/chips/Chip.tsx',
      "import styles from '../Chip.module.css';\nimport { Seat } from '../../components/Seat.tsx';\n" +
        "import { seatXY } from '../../layout/seats.ts';\nexport const parts = [styles, Seat, seatXY];\n",
    ],
    [
      'data: types from core and eval',
      'apps/web/src/data/rankings.ts',
      "import type { Card } from '../core/cards.ts';\nimport type { HandCategory } from '../eval/evaluate.ts';\n" +
        'export type Row = { key: HandCategory; cards: Card[] };\n',
    ],
    [
      'i18n: types from any module',
      'apps/web/src/i18n/en.ts',
      "import type { ReasonCode } from '../brain/types.ts';\nimport type { DrawKind } from '../analysis/types.ts';\n" +
        'export type Keys = [ReasonCode, DrawKind];\n',
    ],
    [
      'main.tsx: app, ui, i18n',
      'apps/web/src/main.tsx',
      "import './ui/styles/tokens.css';\nimport { createRoot } from 'react-dom/client';\n" +
        "import { App } from './ui/App.tsx';\nimport { startWorkers } from './app/workerClient.ts';\n" +
        "import { en } from './i18n/en.ts';\nexport const boot = [createRoot, App, startWorkers, en];\n",
    ],
  ])('%s passes', (_, file, code) => expectClean(file, code));
});

describe('Math.random ban (PLAN §0.3, §5.6)', () => {
  it.each([
    [
      'Math.random()',
      'apps/web/src/core/rng.ts',
      'export const roll = Math.random();\n',
      MATH_RANDOM,
    ],
    [
      'a reference',
      'apps/web/src/brain/decide.ts',
      'export const pick = Math.random;\n',
      MATH_RANDOM,
    ],
    [
      "Math['random']()",
      'apps/web/src/engine/start.ts',
      "export const roll = Math['random']();\n",
      MATH_RANDOM,
    ],
    [
      'destructuring',
      'apps/web/src/ui/App.tsx',
      'const { random } = Math;\nexport const roll = random();\n',
      MATH_RANDOM,
    ],
    [
      'globalThis.Math.random()',
      'apps/web/src/workers/equity.worker.ts',
      'export const roll = globalThis.Math.random();\n',
      GLOBAL_MATH_RANDOM,
    ],
    [
      'window.Math.random()',
      'apps/web/src/app/controller.ts',
      'export const roll = window.Math.random();\n',
      GLOBAL_MATH_RANDOM,
    ],
  ])('%s in src fails', (_, file, code, rule) =>
    expectError(file, code, rule, /use a seeded stream from core\/rng\.ts/),
  );

  it('passes: a seed from crypto.getRandomValues, draws from an Rng, other .random properties', () =>
    expectClean(
      'apps/web/src/core/rng.ts',
      'export const seed = crypto.getRandomValues(new Uint32Array(4));\n' +
        'export const draw = (rng: { next(): number }): number => rng.next();\n' +
        'const dice = { random: (): number => 4 };\nexport const roll = dice.random();\n',
    ));
});

describe('the server must not import the web app (PLAN §2.1)', () => {
  it.each([
    ['a relative path', 'apps/server/src/setup.ts', valueImport('../../web/src/core/rng.ts')],
    ['a .js path', 'apps/server/src/setup.ts', valueImport('../../web/src/core/rng.js')],
    [
      'a deeper file',
      'apps/server/src/health/deep/x.ts',
      valueImport('../../../../web/src/core/rng.ts'),
    ],
    ['a test file', 'apps/server/test/health.test.ts', valueImport('../../web/src/engine/step.ts')],
    ['the package name', 'apps/server/src/setup.ts', valueImport('@rb/web')],
    ['a path in the package', 'apps/server/src/setup.ts', valueImport('@rb/web/src/core/rng.ts')],
    ['a root alias', 'apps/server/src/setup.ts', valueImport('apps/web/src/core/rng.ts')],
    ['a web alias', 'apps/server/src/setup.ts', valueImport('@web/src/core/rng.ts')],
    ['import type', 'apps/server/src/setup.ts', typeImport('../../web/src/core/cards.ts')],
    [
      'import()',
      'apps/server/src/setup.ts',
      "export const load = () => import('../../web/src/core/rng.ts');\n",
    ],
    ['export *', 'apps/server/src/setup.ts', "export * from '../../web/src/core/rng.ts';\n"],
    [
      'the built files',
      'apps/server/src/setup.ts',
      "import page from '../../web/dist/index.html?raw';\nexport const html = page;\n",
    ],
  ])('%s fails', (_, file, code) =>
    expectError(file, code, SERVER, /^apps\/server must not import apps\/web/),
  );

  it('passes: its own files, packages, and apps/web/dist as a path to serve', () =>
    expectClean(
      'apps/server/src/app.module.ts',
      "import { join } from 'node:path';\nimport { Module } from '@nestjs/common';\n" +
        "import { HealthModule } from './health.module.js';\n" +
        "export const webDist = join(import.meta.dirname, '..', '..', 'web', 'dist');\n" +
        'export const parts = [Module, HealthModule];\n',
    ));
});
