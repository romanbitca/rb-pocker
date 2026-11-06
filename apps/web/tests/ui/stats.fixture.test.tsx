// @vitest-environment jsdom
/**
 * PLAN §18 Stage 8, acceptance 2: the 20 scripted hands of `fixtures/stats20.ts` (played by the
 * real engine, recorded as the controller records them, counted by `applyHand`) give exactly the
 * hand-computed numbers on every Stats card: the view model first, then the words on the screen.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { historyOf } from '../../src/app/history.ts';
import { profileProblem, defaultProfile, handRecordProblem } from '../../src/persist/schema.ts';
import { Stats, type StatsTab } from '../../src/ui/screens/Stats.tsx';
import { statsView } from '../../src/ui/stats.ts';
import { BB, EXPECTED, NOW, playFixture } from './fixtures/stats20.ts';

afterEach(cleanup);

const { records, stats } = playFixture();

function show(tab: StatsTab) {
  const onOpenHand = vi.fn();
  render(
    <Stats
      stats={stats}
      bb={BB}
      now={NOW}
      history={historyOf(records)}
      tab={tab}
      onTab={() => {}}
      onOpenHand={onOpenHand}
      onBack={() => {}}
    />,
  );
  return { onOpenHand };
}

/** The value of a `data-stat` row (or the text of a `data-stat` line). */
const stat = (key: string): string => {
  const el = document.querySelector(`[data-stat="${key}"]`);
  if (el === null) throw new Error(`no stat ${key}`);
  return (el.querySelector('dd') ?? el).textContent ?? '';
};

describe('the 20-hand fixture (Stage 8 acceptance 2)', () => {
  it('plays 20 valid records whose counted stats pass the profile guard', () => {
    expect(records).toHaveLength(20);
    for (const r of records) expect(handRecordProblem(r)).toBeNull();
    expect(profileProblem({ ...defaultProfile(NOW), stats })).toBeNull();
    // What the hands were (spot checks of the scripts against the engine).
    expect(records.map((r) => r.net[0])).toEqual([
      0, 10, 20, 30, -60, -10, -2000, 20, 20, 250, 120, -220, 0, 2010, -10, 30, -20, 60, 160, -160,
    ]);
    expect(records.map((r) => r.assisted)).toEqual(records.map((_, i) => i === 8 || i === 17));
    expect(stats.sessions).toBe(2);
    expect(stats.recentSessions.map((s) => s.hands)).toEqual([8, 7]);
    expect(stats.currentSession?.hands).toBe(5);
  }, 15_000);

  it('gives exactly the hand-computed numbers of every card', () => {
    expect(statsView(stats, BB, NOW)).toEqual(EXPECTED);
  }, 15_000);

  it('Progress shows them', () => {
    show('progress');
    expect(stat('scoreSession')).toBe('74');
    expect(stat('scoreWeek')).toBe('68 ↓ 12Down 12 from the 7 days before.');
    expect(stat('mistakesSession')).toBe('25');
    expect(stat('mistakesWeek')).toBe('32');
    expect(stat('own')).toBe('Without the hint, 62% of your decisions were Best or Good.');
    expect(stat('follow')).toBe('You did what the coach said 45% of the time.');
    expect(stat('streak')).toBe('Good decisions in a row: 0');
    expect(stat('streakBest')).toBe('Your best: 8');
    expect([...document.querySelectorAll('[data-leak]')].map((li) => li.textContent)).toEqual([
      'Not betting your strong hands7 times · about 256 chips lost',
      'Calling the big blind instead of raising4 times · about 28 chips lost',
    ]);
    expect(stat('undo')).toBe('Fixed with Undo: 2');
    expect(stat('quiz')).toBe('Quiz answers right: 3 of 6 (50%)');
    // The charts: the last sessions, with their data for screen readers.
    const score = screen.getByRole('img', { name: /^Decision score in your last sessions/ });
    expect(score.querySelectorAll('circle')).toHaveLength(3);
    const tables = screen.getAllByRole('table');
    expect(tables.map((t) => [...t.querySelectorAll('td')].map((td) => td.textContent))).toEqual([
      ['80', '62', '74'],
      ['21', '40', '25'],
    ]);
    expect(
      screen.getByRole('img', { name: /^Mistakes per 100/ }).querySelectorAll('rect'),
    ).toHaveLength(3);
  }, 15_000);

  it('Results shows them', () => {
    show('results');
    expect(stat('hands')).toBe('18');
    expect(stat('won')).toBe('9');
    expect(stat('net')).toBe('+170');
    expect(stat('bb100')).toBe('+47.2');
    expect(stat('style')).toBe('Plays 61% of hands, raises 33%.');
    expect(stat('showdown')).toBe('5 of 8 (63%)');
    expect(stat('biggest')).toBe('4,010');
    expect(stat('reloads')).toBe('1');
    expect(stat('luck')).toBe('Expected +2,887 · Actual +4,010');
    expect(screen.getByText('You were lucky by 1,123 chips.')).toBeTruthy();
    const easy = document.querySelector('[data-level="easy"]') as HTMLElement;
    expect([...easy.children].map((c) => c.textContent)).toEqual(['Easy', '17', '−23.5']);
    expect(document.querySelectorAll('[data-level]')).toHaveLength(1);
    expect(stat('practice')).toBe('Practice hands (used Undo): 2, not counted above.');
  }, 15_000);

  it('Hands shows the collection: what was made, and a lock on the rest', () => {
    show('hands');
    const made = Object.fromEntries(
      [...document.querySelectorAll('[data-category]')].map((li) => [
        li.getAttribute('data-category'),
        li.querySelector('[data-made]')?.getAttribute('data-made'),
      ]),
    );
    expect(made).toEqual({
      royalFlush: '0',
      straightFlush: '0',
      quads: '0',
      fullHouse: '0',
      flush: '2',
      straight: '0',
      trips: '2',
      twoPair: '0',
      pair: '3',
      highCard: '1',
    });
    const flush = document.querySelector('[data-category="flush"] [data-made]');
    expect(flush?.textContent).toMatch(/^Made 2 times · first 10 Oct 2026$/);
    const high = document.querySelector('[data-category="highCard"] [data-made]');
    expect(high?.textContent).toMatch(/^Made once · 1[89] Oct 2026$/);
    const royal = document.querySelector('[data-category="royalFlush"] [data-made]');
    expect(royal?.textContent).toBe('Not made yet · About 1 in 30,900 hands');
    expect(royal?.querySelector('svg')).not.toBeNull();
  }, 15_000);

  it('History lists the 20 hands, newest first, with their grades; a tap opens Review', () => {
    const { onOpenHand } = show('history');
    const rows = screen.getAllByRole('button', { name: /^Hand / });
    expect(rows).toHaveLength(20);
    const first = rows[0] as HTMLElement;
    // H20: your hand number at that table is 1 (each scripted hand has a table of its own).
    expect(first.textContent).toContain('−160');
    expect(first.textContent).toContain('One pair');
    expect(
      within(first).getByText('Grades: Best move, Best move, Best move, Mistake.'),
    ).toBeTruthy();
    expect(first.querySelectorAll('circle')).toHaveLength(3);
    expect(first.querySelectorAll('rect')).toHaveLength(1);
    // H18 is a practice hand; H15's grade failed.
    expect(rows[2]?.textContent).toContain('Practice');
    expect(rows[5]?.textContent).toContain('Grades: No grade.');
    fireEvent.click(rows[3] as HTMLElement);
    expect(onOpenHand).toHaveBeenCalledWith(17);
    expect(screen.getByText('Your stats are saved only on this device.')).toBeTruthy();
  }, 15_000);
});
