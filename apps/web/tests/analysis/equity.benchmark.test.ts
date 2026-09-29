import { describe, expect, it } from 'vitest';
import { equity, runoutEquity } from '../../src/analysis/equity.ts';
import { parseCards, type Card } from '../../src/core/cards.ts';
import type { EquityOptions } from '../../src/analysis/equity.ts';
import { env } from '../helpers/seed.ts';

/**
 * Timings of the equity module (PLAN §7.7: ≥ 2M evaluations/s and a final 8-opponent result in
 * ≤ 400 ms on a Galaxy A5x-class phone). These are reports: a slow machine gets a warning, never a
 * failure. Numbers are the best of three runs after one warm-up run.
 */
const H = (s: string): Card[] => parseCards(s);

function best(run: () => unknown): number {
  run(); // warm-up (JIT)
  let ms = Number.POSITIVE_INFINITY;
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    run();
    ms = Math.min(ms, performance.now() - t);
  }
  return ms;
}

function report(line: string, warn = false): void {
  console.info(line);
  if (warn) {
    if (env('GITHUB_ACTIONS') === 'true') console.info(`::warning title=Equity speed::${line}`);
    console.warn(`WARNING: ${line}`);
  }
}

interface Row {
  label: string;
  /** Score evaluations one run makes (to turn the time into evaluations per second). */
  evals: number;
  run: () => unknown;
}

const spot =
  (hero: string, board: string, nOpp: number, opts: EquityOptions = {}) =>
  () =>
    equity({ hero: H(hero), board: H(board), nOpp }, opts);

const ROWS: Row[] = [
  { label: 'exact  HU river (990 deals)', evals: 990 + 1, run: spot('Ah Kh', 'Qh 7h 2c 3d 5s', 1) },
  {
    label: 'exact  HU turn (45,540 deals)',
    evals: 45 * 990 + 45 * 44,
    run: spot('Ah Kh', 'Qh 7h 2c 3d', 1),
  },
  {
    label: 'exact  2 opponents, river (446,985 deals)',
    evals: 990 + 1,
    run: spot('Ah Kh', 'Qh 7h 2c 3d 5s', 2),
  },
  {
    label: 'exact  HU flop (1,070,190 deals, forced)',
    evals: 1_081 * 990 + 1_081,
    run: spot('Ah Kh', 'Qh 7h 2c', 1, { mode: 'exact' }),
  },
  {
    label: 'MC     preflop, 1 opponent (40,000 trials)',
    evals: 40_000 * 2,
    run: spot('Ah Kh', '', 1),
  },
  {
    label: 'MC     flop, 3 opponents (40,000 trials)',
    evals: 40_000 * 4,
    run: spot('Ah Kh', 'Qh 7h 2c', 3),
  },
  {
    label: 'MC     preflop, 8 opponents (20,000 trials)',
    evals: 20_000 * 9,
    run: spot('Ah Kh', '', 8),
  },
  {
    label: 'MC     turn, 8 opponents (20,000 trials)',
    evals: 20_000 * 9,
    run: spot('Ah Kh', 'Qh 7h 2c 3d', 8),
  },
  {
    label: 'exact  run-out, AA vs KK preflop (1,712,304 boards)',
    evals: 1_712_304 * 2,
    run: () => runoutEquity({ hands: [H('As Ah'), H('Ks Kh')], board: [] }, { mode: 'exact' }),
  },
  {
    label: 'MC     run-out, AA vs KK preflop (20,000 trials)',
    evals: 20_000 * 2,
    run: () => runoutEquity({ hands: [H('As Ah'), H('Ks Kh')], board: [] }),
  },
];

describe('equity timings (a report, not a gate)', () => {
  it('reports the time and the evaluations per second of each method', { timeout: 120_000 }, () => {
    const lines: string[] = [];
    for (const row of ROWS) {
      const ms = best(row.run);
      const rate = row.evals / (ms / 1000);
      lines.push(
        `${row.label.padEnd(56)} ${ms.toFixed(1).padStart(8)} ms  ${(rate / 1e6).toFixed(1).padStart(6)}M evals/s`,
      );
    }
    report(`equity timings (best of 3, this machine):\n${lines.join('\n')}`);

    const eight = best(spot('Ah Kh', '', 8));
    report(
      `final 8-opponent result: ${eight.toFixed(1)} ms (target ≤ 400 ms on the reference phone)`,
      eight > 400,
    );
    expect(eight).toBeGreaterThan(0);
  });
});
