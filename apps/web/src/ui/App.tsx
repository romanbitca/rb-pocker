import { useRegisterSW } from 'virtual:pwa-register/react';
import { en } from '../i18n/en.ts';
import styles from './App.module.css';

export function App() {
  // Registers the service worker (PLAN §15.1). Always called: React's rules of hooks forbid an
  // `if`, and it already does nothing where service workers are unavailable (insecure origins,
  // §12.14). The update and offline-ready toasts come later (chunk 9.5).
  useRegisterSW();

  return (
    <main className={styles.shell}>
      <h1 className={styles.title}>{en.app.name}</h1>
      <p className={styles.tagline}>{en.app.tagline}</p>
    </main>
  );
}
