import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests (PLAN "Testing strategy", §17.5): Chromium and WebKit at the six §17.5
 * viewports, against the production build served by Nest, so the §17.2 headers, the cache rules
 * and the service worker are the real ones. Run `npm run e2e` from the repository root: it builds
 * first when the build is missing or older than the sources, then runs `playwright test` here.
 * Specs import `test` and `expect` from `tests/e2e/fixtures.ts`, never from '@playwright/test'.
 */

/** `PORT=3100 npm run e2e` moves the server when port 3000 is taken (the Nest server reads PORT). */
const port = Number(process.env.PORT ?? 3000);
const baseURL = `http://localhost:${port}`;
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const CI = Boolean(process.env.CI);

type Kind = 'phone' | 'landscape' | 'tablet' | 'desktop';

/** PLAN §17.5: 375×667, 360×740, 390×844, 844×390, 768×1024, 1280×800. */
const VIEWPORTS: ReadonlyArray<{ kind: Kind; width: number; height: number }> = [
  { kind: 'phone', width: 375, height: 667 },
  { kind: 'phone', width: 360, height: 740 },
  { kind: 'phone', width: 390, height: 844 },
  { kind: 'landscape', width: 844, height: 390 },
  { kind: 'tablet', width: 768, height: 1024 },
  { kind: 'desktop', width: 1280, height: 800 },
];

/**
 * What each browser pretends to be at each size: user agent, pixel ratio, touch and mobile
 * viewport handling. Only the size comes from VIEWPORTS.
 */
const DEVICE = {
  chromium: {
    phone: devices['Pixel 7'],
    landscape: devices['Pixel 7'],
    tablet: devices['Galaxy Tab S4'],
    desktop: devices['Desktop Chrome'],
  },
  webkit: {
    phone: devices['iPhone 13'],
    landscape: devices['iPhone 13'],
    tablet: devices['iPad Mini'],
    desktop: devices['Desktop Safari'],
  },
} as const;

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI
    ? [['list'], ['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: (['chromium', 'webkit'] as const).flatMap((browserName) =>
    VIEWPORTS.map(({ kind, width, height }) => ({
      name: `${browserName}-${kind}-${width}x${height}`,
      use: {
        ...DEVICE[browserName][kind],
        browserName,
        viewport: { width, height },
        screen: { width, height },
      },
    })),
  ),
  // The root `npm start` (apps/web has no start script): the Nest server serving apps/web/dist.
  webServer: {
    command: 'npm start',
    cwd: repoRoot,
    url: `${baseURL}/api/health`,
    env: { PORT: String(port) },
    reuseExistingServer: !CI,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
