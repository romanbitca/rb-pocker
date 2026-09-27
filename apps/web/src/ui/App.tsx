import { en } from '../i18n/en.ts';
import styles from './App.module.css';

export function App() {
  return (
    <main className={styles.shell}>
      <h1 className={styles.title}>{en.app.name}</h1>
      <p className={styles.tagline}>{en.app.tagline}</p>
    </main>
  );
}
