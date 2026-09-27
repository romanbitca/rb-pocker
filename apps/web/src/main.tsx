import './ui/styles/tokens.css';
import './ui/styles/global.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App.tsx';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('index.html has no #root element');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
