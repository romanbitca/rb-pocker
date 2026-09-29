import './ui/styles/tokens.css';
import './ui/styles/global.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App.tsx';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('index.html has no #root element');
}
const root = createRoot(container);

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
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
