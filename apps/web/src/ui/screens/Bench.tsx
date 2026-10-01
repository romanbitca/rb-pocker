/**
 * The hidden `#bench` screen (PLAN §15.4): open the app at `…/#bench` and it measures how fast this
 * device runs the game maths, in `equity.worker` (`app/bench.ts` → `workers/bench.ts`): the hand
 * evaluator, the time to the final win chance in three spots, and the user agent. It starts by
 * itself, then shows each number against its §15.4 target, and the whole report as plain text to
 * copy (Stage 4 acceptance 6: numbers from a real Android phone go into the PR). On a plain-http
 * LAN address there is no clipboard API (§12.14), so the text is shown in a box that can be
 * selected by hand; the Copy button appears only where the API exists.
 *
 * main.tsx loads this screen with `import()` (a lazy chunk, still precached, §15.3) and renders it
 * instead of the game; no game starts on this page.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { BenchReport } from '../../app/bench.ts';
import { en } from '../../i18n/en.ts';
import { benchRows, benchText } from '../bench.ts';
import styles from './Bench.module.css';
import { ScreenBar } from './ScreenBar.tsx';
import screen from './Screen.module.css';

export interface BenchProps {
  /** Runs the measurements (`runBench` of app/bench.ts). */
  run: () => Promise<BenchReport>;
  /** Back to the game. */
  onBack: () => void;
}

type BenchState =
  | { status: 'running' }
  | { status: 'done'; report: BenchReport }
  | { status: 'failed'; reason: string };

const canCopy = (): boolean =>
  typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function';

export function Bench({ run, onBack }: BenchProps) {
  const [state, setState] = useState<BenchState>({ status: 'running' });
  const [copied, setCopied] = useState(false);
  const runs = useRef(0);
  const id = useId();

  const start = useCallback(() => {
    const n = ++runs.current;
    setState({ status: 'running' });
    setCopied(false);
    run().then(
      (report) => {
        if (runs.current === n) setState({ status: 'done', report });
      },
      (e: unknown) => {
        const reason = e instanceof Error ? e.message : String(e);
        if (runs.current === n) setState({ status: 'failed', reason });
      },
    );
  }, [run]);

  useEffect(() => {
    start();
    return () => {
      runs.current++; // a late answer after unmount changes nothing
    };
  }, [start]);

  const text = state.status === 'done' ? benchText(state.report) : '';
  const copy = () => {
    void navigator.clipboard.writeText(text).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };

  return (
    <main className={screen.page} data-bench={state.status}>
      <ScreenBar title={en.bench.title} onBack={onBack} />
      <div className={screen.content}>
        <p className={screen.hint}>{en.bench.intro}</p>
        <div aria-live="polite" className={styles.status}>
          {state.status === 'running' && <p className={styles.running}>{en.bench.running}</p>}
          {state.status === 'failed' && <p role="alert">{en.bench.failed(state.reason)}</p>}
        </div>
        {state.status === 'done' && (
          <>
            <dl className={styles.rows}>
              {benchRows(state.report).map((row) => (
                <div key={row.id} className={styles.row} data-bench-row={row.id}>
                  <dt className={styles.label}>{row.label}</dt>
                  <dd className={row.id === 'device' ? styles.device : styles.value}>
                    {row.value}
                  </dd>
                  {row.target !== null && (
                    <dd className={styles.target}>
                      {row.target}
                      {row.ok !== null && (
                        <span className={row.ok ? styles.ok : styles.slow}>
                          {' · '}
                          {row.ok ? en.bench.ok : en.bench.slow}
                        </span>
                      )}
                    </dd>
                  )}
                </div>
              ))}
            </dl>
            <label className={styles.textLabel} htmlFor={`${id}-text`}>
              {en.bench.textLabel}
            </label>
            <textarea
              id={`${id}-text`}
              className={styles.text}
              readOnly
              rows={8}
              value={text}
              onFocus={(e) => e.currentTarget.select()}
            />
          </>
        )}
        <div className={screen.actions}>
          <button
            type="button"
            className={screen.primary}
            disabled={state.status === 'running'}
            onClick={start}
          >
            {en.bench.again}
          </button>
          {state.status === 'done' && canCopy() && (
            <button type="button" className={screen.secondary} onClick={copy}>
              {copied ? en.bench.copied : en.bench.copy}
            </button>
          )}
          <button type="button" className={screen.link} onClick={() => onBack()}>
            {en.bench.back}
          </button>
        </div>
      </div>
    </main>
  );
}
