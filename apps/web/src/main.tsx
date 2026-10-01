import './ui/styles/tokens.css';
import './ui/styles/global.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { startApp } from './app/boot.ts';
import { en } from './i18n/en.ts';
import { App } from './ui/App.tsx';

/**
 * Build constant (vite.config.ts `rb:test-hooks`): true in development, Vitest and E2E builds
 * (`vite build --mode e2e`), false in production builds.
 */
declare const __PC_TEST_HOOKS__: boolean;

const container = document.getElementById('root');
if (container === null) {
  throw new Error('index.html has no #root element');
}
const root = createRoot(container);

function renderApp(): void {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

/**
 * The hidden speed test (PLAN §15.4): the page opened at `#bench` shows it instead of the game,
 * and starts no game. Both modules are `import()`ed, so they stay out of the initial bundle (the
 * service worker still precaches them, §15.3). Typing `#bench` into the address bar, or leaving
 * it, changes only the hash: the page reloads, so each side starts clean.
 */
const BENCH_HASH = '#bench';
const benchPage = window.location.hash === BENCH_HASH;
window.addEventListener('hashchange', () => {
  if ((window.location.hash === BENCH_HASH) !== benchPage) window.location.reload();
});

function renderBench(): void {
  void Promise.all([import('./app/bench.ts'), import('./ui/screens/Bench.tsx')]).then(
    ([{ runBench }, { Bench }]) => {
      const run = () => runBench();
      const back = () => {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
        window.location.reload();
      };
      // No StrictMode: its second mount in development would start a second run.
      root.render(<Bench run={run} onBack={back} />);
    },
  );
}

// Dev-only previews, one `if` each. `import.meta.env.DEV` is the constant `false` in production
// builds, so every preview branch and the modules it loads are dropped from the bundle:
// - `/?preview=ui`: the cards, seats and rankings panel (tests/ui/dev/bundle.test.ts checks the
//   built files).
// - `/?preview=screens`: the screens (tests/ui/dev/screensPreview.test.ts checks the built files).
//   The navigation reducer is passed in because ui/ may not load app/ at run time (PLAN §2.1).
// - `/?preview=actions`: the action bar and sizing tray (tests/ui/dev/actionsBundle.test.ts checks
//   the built files).
if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('preview') === 'ui') {
  void import('./ui/dev/Preview.tsx').then(({ Preview }) => {
    root.render(
      <StrictMode>
        <Preview />
      </StrictMode>,
    );
  });
} else if (
  import.meta.env.DEV &&
  new URLSearchParams(window.location.search).get('preview') === 'screens'
) {
  void Promise.all([import('./ui/dev/ScreensPreview.tsx'), import('./app/navigation.ts')]).then(
    ([{ ScreensPreview }, navigation]) => {
      root.render(
        <StrictMode>
          <ScreensPreview navigation={navigation} />
        </StrictMode>,
      );
    },
  );
} else if (
  import.meta.env.DEV &&
  new URLSearchParams(window.location.search).get('preview') === 'actions'
) {
  void import('./ui/dev/ActionsPreview.tsx').then(({ ActionsPreview }) => {
    root.render(
      <StrictMode>
        <ActionsPreview />
      </StrictMode>,
    );
  });
} else if (benchPage) {
  renderBench();
} else if (__PC_TEST_HOOKS__) {
  // The test hooks (`?seed=`, `window.__pc`) exist only in development and E2E builds. In a
  // production build `__PC_TEST_HOOKS__` is the constant `false`, so this branch and
  // app/testHooks.ts are left out of the bundle (tests/app/testHooks.bundle.test.ts checks it).
  void import('./app/testHooks.ts').then((hooks) => {
    startApp({ heroName: en.app.hero, hooks });
    renderApp();
  });
} else {
  startApp({ heroName: en.app.hero });
  renderApp();
}
