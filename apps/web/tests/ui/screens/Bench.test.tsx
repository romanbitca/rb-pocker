// @vitest-environment jsdom
/**
 * The hidden `#bench` screen (PLAN §15.4; chunk 4.7): it runs by itself, shows every number with
 * its §15.4 target, says the hint latency comes in Stage 5, and gives the report as plain text to
 * copy. `runBench` (app/bench.ts) is tested with a fake worker in tests/app/bench.test.ts.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BenchReport } from '../../../src/app/bench.ts';
import { benchRows, benchText, formatMillions, formatMs } from '../../../src/ui/bench.ts';
import { Bench } from '../../../src/ui/screens/Bench.tsx';

afterEach(cleanup);

const REPORT: BenchReport = {
  equity: {
    evalsPerSec: 12_345_678,
    eq8PreflopMs: 1.24,
    eq8FlopMs: 412.6,
    eq1FlopMs: 8.04,
    ua: 'Mozilla/5.0 (Linux; Android 14; SM-A546B) Chrome/140',
  },
  hint: null,
};

describe('bench rows and text', () => {
  it('formats the numbers', () => {
    expect(formatMillions(12_345_678)).toBe('12.3');
    expect(formatMs(8.04)).toBe('8.0');
    expect(formatMs(412.6)).toBe('413');
  });

  it('compares with the §15.4 targets; the 1-player row and the hint have none', () => {
    expect(benchRows(REPORT).map((r) => [r.id, r.value, r.ok])).toEqual([
      ['evaluator', '12.3 million hands per second', true],
      ['eq8Preflop', '1.2 ms', true],
      ['eq8Flop', '413 ms', false],
      ['eq1Flop', '8.0 ms', null],
      ['hint', 'Coming in Stage 5', null],
      ['device', REPORT.equity.ua, null],
    ]);
    const slow = { ...REPORT, equity: { ...REPORT.equity, evalsPerSec: 1_999_999 } };
    expect(benchRows(slow)[0]?.ok).toBe(false);
  });

  it('the text report has one line per row, under a title', () => {
    expect(benchText(REPORT).split('\n')).toEqual([
      'RB Poker Coach speed test',
      'Hand evaluator: 12.3 million hands per second (Target: 2 million or more) OK',
      'Win chance against 8 players, before the flop: 1.2 ms (Target: 400 ms or less) OK',
      'Win chance against 8 players, on the flop: 413 ms (Target: 400 ms or less) Too slow',
      'Win chance against 1 player, on the flop: 8.0 ms',
      'Coach hint: Coming in Stage 5',
      `Device: ${REPORT.equity.ua}`,
    ]);
  });
});

describe('the Bench screen', () => {
  it('runs by itself, then shows the rows and the text', async () => {
    let finish: (r: BenchReport) => void = () => {};
    const run = vi.fn(() => new Promise<BenchReport>((resolve) => (finish = resolve)));
    render(<Bench run={run} onBack={() => {}} />);
    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Speed test');
    expect(screen.getByText('Measuring…')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Run again' }).hasAttribute('disabled')).toBe(true);
    await act(async () => finish(REPORT));
    expect(screen.queryByText('Measuring…')).toBeNull();
    expect(document.querySelectorAll('[data-bench-row]')).toHaveLength(6);
    expect(screen.getByText('Coming in Stage 5')).toBeTruthy();
    const text = screen.getByLabelText('The results as text') as HTMLTextAreaElement;
    expect(text.value).toBe(benchText(REPORT));
    expect(text.readOnly).toBe(true);
    // Run again starts a new measurement.
    fireEvent.click(screen.getByRole('button', { name: 'Run again' }));
    expect(run).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Measuring…')).toBeTruthy();
  });

  it('says why when the test cannot finish', async () => {
    const run = vi.fn(() => Promise.reject(new Error('this browser cannot start the game worker')));
    render(<Bench run={run} onBack={() => {}} />);
    await act(async () => {});
    expect(screen.getByRole('alert').textContent).toBe(
      'The test did not finish: this browser cannot start the game worker',
    );
  });

  it('copies the text where the clipboard API exists; Back returns to the game', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const onBack = vi.fn();
    render(<Bench run={() => Promise.resolve(REPORT)} onBack={onBack} />);
    await act(async () => {});
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Copy the results' })),
    );
    expect(writeText).toHaveBeenCalledWith(benchText(REPORT));
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to the game' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledTimes(2);
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  });

  it('no Copy button without the clipboard API (plain http on the LAN)', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    render(<Bench run={() => Promise.resolve(REPORT)} onBack={() => {}} />);
    await act(async () => {});
    expect(screen.queryByRole('button', { name: 'Copy the results' })).toBeNull();
    expect(screen.getByLabelText('The results as text')).toBeTruthy();
  });
});
