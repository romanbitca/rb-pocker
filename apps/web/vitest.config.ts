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
 * Coverage (PLAN "Testing strategy", Rules): `npm run test:coverage` (the CI `check` job) runs the
 * unit project once with V8 coverage and fails below the thresholds: `src/engine/` ≥ 95% branches,
 * `src/eval/` ≥ 90% branches. `src/analysis/`, `src/persist/` (≥ 90%) and `src/brain/` (≥ 85%)
 * join `include` and `thresholds` in the stages that create them.
 *
 * On CI every core runs test files: Vitest's default (cores − 1) leaves one of the runner's two
 * cores idle, and the unit tests are CPU-bound property runs.
 */
const SLOW_TESTS = 'tests/**/*.slow.test.{ts,tsx}';

const slowRequested =
  process.env.SLOW === '1' ||
  process.argv.some(
    (arg, i, argv) => arg === '--project=slow' || (arg === '--project' && argv[i + 1] === 'slow'),
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
      projects: [
        slowRequested
          ? { extends: true, test: { name: 'slow', include: [SLOW_TESTS] } }
          : {
              extends: true,
              test: {
                name: 'unit',
                include: ['tests/**/*.test.{ts,tsx}'],
                exclude: [...configDefaults.exclude, SLOW_TESTS, 'tests/e2e/**'],
              },
            },
      ],
    },
  }),
);
