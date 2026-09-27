import { configDefaults, defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

/**
 * Two Vitest projects (PLAN "Testing strategy"):
 * - `unit` (the default): every `tests/**` test except `*.slow.test.*` and the Playwright specs.
 * - `slow`: only `*.slow.test.*`; selected with `SLOW=1` or `--project slow` (`npm run test:slow`).
 * Only the selected project is defined, so a bare `vitest` or a folder filter never runs the
 * slow tests by accident.
 *
 * Tests run in Node by default. Component tests opt into jsdom with a
 * `// @vitest-environment jsdom` comment on their first line.
 *
 * Coverage (PLAN "Testing strategy", Rules): `npm run test:coverage` (the CI `check` job, after
 * `npm test`) runs the unit project with V8 coverage and fails below the thresholds: `src/engine/`
 * ≥ 95% branches, `src/eval/` ≥ 90% branches. `src/analysis/`, `src/persist/` (≥ 90%) and
 * `src/brain/` (≥ 85%) join `include` and `thresholds` in the stages that create them.
 * The coverage run leaves out `VOLUME_TESTS`: they repeat code paths that the other tests already
 * reach (the coverage numbers are the same without them) or they measure speed, and V8 coverage
 * makes them several times slower (on the CI runner the 100,000-hand run took 273 s with coverage,
 * about 55 s without). `npm test` runs them at full strength.
 *
 * On CI, test files run on every vCPU (Vitest's default, cores − 1, is one worker on the 2-vCPU
 * runner). Measured on the runner: two workers were a little faster than one (unit step 175 s
 * against 185 s, coverage step 68 s against 78 s), although each test runs slower beside another.
 */
const SLOW_TESTS = 'tests/**/*.slow.test.{ts,tsx}';

const VOLUME_TESTS = [
  'tests/engine/random-play.test.ts', // 100,000 random hands (Stage 2 acceptance 2)
  'tests/engine/settle.differential.test.ts', // 100,000 all-in hands against the oracle
  'tests/engine/replay.test.ts', // 10,000 random hands replayed
  'tests/engine/benchmark.test.ts', // timing
  'tests/eval/benchmark.test.ts', // timing
];

const slowRequested =
  process.env.SLOW === '1' ||
  process.argv.some(
    (arg, i, argv) => arg === '--project=slow' || (arg === '--project' && argv[i + 1] === 'slow'),
  );

const coverageRequested = process.argv.some(
  (arg) => arg === '--coverage' || arg.startsWith('--coverage.') || arg.startsWith('--coverage='),
);

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      ...(process.env.CI === 'true' ? { maxWorkers: '100%' } : {}),
      coverage: {
        provider: 'v8',
        include: ['src/engine/**/*.ts', 'src/eval/**/*.ts'],
        reporter: [['text', { skipFull: false }], 'json-summary'],
        reportsDirectory: 'coverage',
        thresholds: {
          'src/engine/**/*.ts': { branches: 95 },
          'src/eval/**/*.ts': { branches: 90 },
        },
      },
      css: { include: [/\.css(?:\?.*)?$/] },
      projects: [
        slowRequested
          ? { extends: true, test: { name: 'slow', include: [SLOW_TESTS] } }
          : {
              extends: true,
              test: {
                name: 'unit',
                include: ['tests/**/*.test.{ts,tsx}'],
                exclude: [
                  ...configDefaults.exclude,
                  SLOW_TESTS,
                  'tests/e2e/**',
                  ...(coverageRequested ? VOLUME_TESTS : []),
                ],
              },
            },
      ],
    },
  }),
);
