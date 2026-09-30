/**
 * The `#bench` screen's rows and plain-text report (PLAN §15.4), from `app/bench.ts`'s
 * `BenchReport`. Pure. Targets are §15.4's for a Galaxy A5x-class phone: the evaluator at 2 million
 * hands per second or more, the final 8-player win chance in 400 ms or less. The 1-player flop row
 * has no target of its own; hint latency arrives in Stage 5.
 */
import type { BenchReport } from '../app/bench.ts';
import { en } from '../i18n/en.ts';

const T = en.bench;

/** §15.4 targets. */
export const EVALS_TARGET = 2_000_000;
export const EQUITY8_TARGET_MS = 400;

export interface BenchRow {
  /** Stable key (tests, React). */
  id: 'evaluator' | 'eq8Preflop' | 'eq8Flop' | 'eq1Flop' | 'hint' | 'device';
  label: string;
  value: string;
  /** The target in words, or null when the row has none. */
  target: string | null;
  /** Met the target (true), missed it (false), or no target (null). */
  ok: boolean | null;
}

/** "< 0.1" (a table lookup), "8.4" below 10 ms, whole ms above. */
export function formatMs(ms: number): string {
  if (ms < 0.1) return '< 0.1';
  return ms < 10 ? ms.toFixed(1) : String(Math.round(ms));
}

/** "12.3" (million per second, one decimal). */
export function formatMillions(perSec: number): string {
  return (perSec / 1_000_000).toFixed(1);
}

export function benchRows(report: BenchReport): BenchRow[] {
  const { equity, hint } = report;
  const eq8 = (id: 'eq8Preflop' | 'eq8Flop', label: string, ms: number): BenchRow => ({
    id,
    label,
    value: T.ms(formatMs(ms)),
    target: T.targetEquity,
    ok: ms <= EQUITY8_TARGET_MS,
  });
  return [
    {
      id: 'evaluator',
      label: T.evaluator,
      value: T.evalsPerSec(formatMillions(equity.evalsPerSec)),
      target: T.targetEvaluator,
      ok: equity.evalsPerSec >= EVALS_TARGET,
    },
    eq8('eq8Preflop', T.eq8Preflop, equity.eq8PreflopMs),
    eq8('eq8Flop', T.eq8Flop, equity.eq8FlopMs),
    {
      id: 'eq1Flop',
      label: T.eq1Flop,
      value: T.ms(formatMs(equity.eq1FlopMs)),
      target: null,
      ok: null,
    },
    {
      id: 'hint',
      label: T.hint,
      value:
        hint === null
          ? T.hintValue
          : `p50 ${T.ms(formatMs(hint.p50Ms))} · p95 ${T.ms(formatMs(hint.p95Ms))}`,
      target: null,
      ok: null,
    },
    { id: 'device', label: T.device, value: equity.ua, target: null, ok: null },
  ];
}

/** The report as plain text, one row a line, for pasting into a pull request (§18 Stage 4, 6). */
export function benchText(report: BenchReport): string {
  const lines = benchRows(report).map((row) => {
    const target = row.target === null ? '' : ` (${row.target})`;
    const mark = row.ok === null ? '' : ` ${row.ok ? T.ok : T.slow}`;
    return `${row.label}: ${row.value}${target}${mark}`;
  });
  return [T.reportTitle, ...lines].join('\n');
}
