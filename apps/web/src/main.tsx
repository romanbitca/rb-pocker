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

// Dev-only component preview: `/?preview=ui`. `import.meta.env.DEV` is the constant `false` in
// production builds, so this branch and the preview module are dropped from the bundle
// (tests/ui/dev/bundle.test.ts checks the built files).
if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('preview') === 'ui') {
  void import('./ui/dev/Preview.tsx').then(({ Preview }) => {
    root.render(
      <StrictMode>
        <Preview />
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
