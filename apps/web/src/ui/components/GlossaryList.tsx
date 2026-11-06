/**
 * The searchable glossary (PLAN §12.1, Appendix F.9; chunk 9.2): a search field over the F.9 rows,
 * each a term and its one-line definition, in F.9 order. Typing keeps the rows whose term holds the
 * words, then those whose definition does (`searchGlossary`); a status line says how many match,
 * or "No words match.", and screen readers hear it as it changes. Part of the lazy Learn chunk.
 */
import { useId, useMemo, useState } from 'react';
import { learnWords as W } from '../../i18n/learn.ts';
import { searchGlossary, type GlossaryRow } from '../learn.ts';
import styles from '../screens/Learn.module.css';
import screen from '../screens/Screen.module.css';

export function GlossaryList({ rows }: { rows: readonly GlossaryRow[] }) {
  const id = useId();
  const [query, setQuery] = useState('');
  const shown = useMemo(() => searchGlossary(rows, query), [rows, query]);
  const searching = query.trim() !== '';
  return (
    <>
      <div className={styles.search}>
        <label htmlFor={id} className={styles.searchLabel}>
          {W.search}
        </label>
        <input
          id={id}
          type="search"
          className={styles.searchInput}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="search"
        />
      </div>
      <p className={screen.hint} role="status">
        {searching ? (shown.length === 0 ? W.noMatch : W.matches(shown.length)) : ''}
      </p>
      {shown.length > 0 && (
        <dl className={styles.glossary}>
          {shown.map((row) => (
            <div key={row.term} data-term={row.term}>
              <dt>{row.term}</dt>
              <dd>{row.definition}</dd>
            </div>
          ))}
        </dl>
      )}
    </>
  );
}
