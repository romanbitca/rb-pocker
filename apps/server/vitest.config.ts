import swc from 'unplugin-swc';
import { configDefaults, defineConfig } from 'vitest/config';

/**
 * Same two projects as apps/web: `unit` (the default) and `slow` (only `*.slow.test.ts`,
 * selected with `SLOW=1` or `--project slow`). Only the selected project is defined.
 */
const SLOW_TESTS = 'test/**/*.slow.test.ts';

const slowRequested =
  process.env.SLOW === '1' ||
  process.argv.some(
    (arg, i, argv) => arg === '--project=slow' || (arg === '--project' && argv[i + 1] === 'slow'),
  );

export default defineConfig({
  // Nest's dependency injection reads the `design:paramtypes` decorator metadata. SWC emits it
  // (it reads experimentalDecorators/emitDecoratorMetadata from tsconfig.json) and replaces
  // Vite's own TypeScript transform (PLAN "Testing strategy", Server row).
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    // The server has no slow tests yet; `npm run test:slow` must still pass.
    passWithNoTests: slowRequested,
    projects: [
      slowRequested
        ? { extends: true, test: { name: 'slow', include: [SLOW_TESTS] } }
        : {
            extends: true,
            test: {
              name: 'unit',
              include: ['test/**/*.test.ts'],
              exclude: [...configDefaults.exclude, SLOW_TESTS],
            },
          },
    ],
  },
});
