// PLAN §13.5: one drill session: questions, picks, the counters (streak, score, best), the stored
// stats after every answer, the game and difficulty, Reset stats, and a page that opens again
// after a Reset elsewhere.
import { describe, expect, it } from 'vitest';
import { deriveSeed, rngFromSeed, ZERO_SEED } from '../../src/core/rng.ts';
import { emptyDrillData, type DrillData } from '../../src/drill/data.ts';
import { categoryAt, type Position } from '../../src/drill/ladder.ts';
import {
  counted,
  optionsOf,
  rightName,
  rightOption,
  rightPosition,
  type GameId,
  type Question,
} from '../../src/drill/questions.ts';
import {
  createDrillSession,
  type DrillSession,
  type DrillStorage,
} from '../../src/drill/session.ts';
import { testSeed } from '../helpers/seed.ts';

/** A storage that keeps one value, as the session wrote it. */
function memory(
  initial: DrillData | null = null,
): DrillStorage & { saved: DrillData | null; saves: number } {
  const store = {
    saved: initial,
    saves: 0,
    load: () => store.saved,
    save(data: DrillData) {
      store.saved = data;
      store.saves++;
    },
  };
  return store;
}

const sessionOf = (storage: DrillStorage, label = 'session'): DrillSession =>
  createDrillSession({
    rng: rngFromSeed(testSeed(deriveSeed(ZERO_SEED, `test|drill|${label}`))),
    storage,
  });

/** Answers the question on show, right or wrong. */
function answer(s: DrillSession, right: boolean): void {
  const q = s.view().question;
  const name = rightName(q);
  const position = rightPosition(q);
  const option = rightOption(q);
  const other = (p: Position): Position => ((p % 10) + 1) as Position;
  if (option !== null) {
    const wrong = optionsOf(q).find((id) => id !== option) as string;
    s.pickOption(right ? option : wrong);
    return;
  }
  if (name !== null) s.pickName(right ? name : other(name));
  if (position !== null) s.pickPosition(position);
}

const withGame = (game: GameId): DrillData => ({ ...emptyDrillData(), game });

describe('hand drill session', () => {
  it('starts on Name the hand at Normal, with no stats, and a question on show', () => {
    const storage = memory();
    const s = sessionOf(storage);
    const v = s.view();
    expect(v.data).toEqual(emptyDrillData());
    expect(v.question.type).toBe('cards');
    expect([v.streak, v.right, v.total, v.seq, v.result]).toEqual([0, 0, 0, 1, null]);
    expect(s.view()).toBe(v); // the same object until something changes
    expect(storage.saves).toBe(0);
  });

  it('judges a question once every needed pick is made, and counts it', () => {
    const storage = memory();
    const s = sessionOf(storage);
    const q = s.view().question;
    const pos = rightPosition(q) as Position;
    const calls: number[] = [];
    const off = s.subscribe(() => calls.push(s.view().seq));
    s.pickName(rightName(q) as Position);
    expect(s.view().result).toBeNull(); // the position is still missing
    s.pickPosition(pos);
    const v = s.view();
    expect(v.result).toBe(true);
    expect([v.streak, v.right, v.total, v.data.best, v.data.answered]).toEqual([1, 1, 1, 1, 1]);
    expect(v.data.hands[categoryAt(pos)]).toEqual({ seen: 1, missed: 0 });
    expect(storage.saved).toEqual(v.data);
    expect(calls).toEqual([1, 1]);
    // Picks after the answer change nothing.
    s.pickName(((pos % 10) + 1) as Position);
    expect(s.view()).toBe(v);
    off();
  });

  it('a wrong answer ends the streak and counts as missed for every hand shown', () => {
    const storage = memory(withGame('versus'));
    const s = sessionOf(storage, 'wrong');
    answer(s, true);
    expect(s.view().streak).toBe(1);
    s.next();
    const q: Question = s.view().question;
    answer(s, false);
    const v = s.view();
    expect([v.result, v.streak, v.right, v.total, v.data.best]).toEqual([false, 0, 1, 2, 1]);
    const missed = counted(q).map((p) => categoryAt(p));
    for (const c of missed) expect(v.data.hands[c].missed).toBeGreaterThan(0);
  });

  it('counts streak milestones at 3, then every 5 (the chip burst)', () => {
    const s = sessionOf(memory(withGame('pos2name')), 'bursts');
    const bursts: number[] = [];
    for (let i = 1; i <= 10; i++) {
      answer(s, true);
      bursts.push(s.view().bursts);
      s.next();
    }
    expect(bursts).toEqual([0, 0, 1, 1, 2, 2, 2, 2, 2, 3]);
  });

  it('ignores picks the question does not ask for', () => {
    const s = sessionOf(memory(withGame('name2pos')), 'ignore');
    const v = s.view();
    s.pickName(1); // a position question has no name picker
    s.pickOption('you');
    expect(s.view()).toBe(v);
    s.setGame('showdown');
    const w = s.view();
    s.pickOption('nonsense');
    s.pickPosition(3);
    expect(s.view()).toBe(w);
  });

  it('Next deals a new question; the game and difficulty are saved and deal one too', () => {
    const storage = memory();
    const s = sessionOf(storage, 'settings');
    s.next();
    expect(s.view().seq).toBe(2);
    s.setGame('showdown');
    expect(s.view().question.type).toBe('showdown');
    expect(s.view().seq).toBe(3);
    expect(storage.saved?.game).toBe('showdown');
    s.setDifficulty('hard');
    expect(storage.saved?.difficulty).toBe('hard');
    expect(s.view().seq).toBe(4);
    const before = s.view();
    s.setDifficulty('hard'); // no change: nothing happens
    s.setGame('showdown');
    expect(s.view()).toBe(before);
  });

  it('Reset stats empties the stats and the best streak, and keeps the game', () => {
    const storage = memory(withGame('pos2name'));
    const s = sessionOf(storage, 'reset');
    answer(s, true);
    s.next();
    answer(s, true);
    s.resetStats();
    const v = s.view();
    expect(v.data).toEqual(withGame('pos2name'));
    expect(storage.saved).toEqual(withGame('pos2name'));
    expect(v.streak).toBe(2); // this visit's counters stay, as in the standalone drill
  });

  it('reads the stored data again when the page opens (a Reset in Settings removed it)', () => {
    const storage = memory(withGame('versus'));
    const s = sessionOf(storage, 'open');
    answer(s, false);
    expect(storage.saved?.answered).toBe(1);
    const shown = s.view();
    s.open(); // nothing changed elsewhere: the same view
    expect(s.view()).toBe(shown);
    storage.saved = null; // Settings → Reset removed pc.v1.drill
    s.open();
    expect(s.view().data).toEqual(emptyDrillData());
    expect(s.view().question.type).toBe('cards'); // the stored game went back to the default
  });

  it('does not ask the same position question again within five', () => {
    const s = sessionOf(memory(withGame('pos2name')), 'recent');
    const keys: number[] = [];
    for (let i = 0; i < 300; i++) {
      const q = s.view().question;
      if (q.type === 'pos2name') keys.push(q.pos);
      s.next();
    }
    let repeats = 0;
    keys.forEach((k, i) => {
      if (keys.slice(Math.max(0, i - 5), i).includes(k)) repeats++;
    });
    // 12 redraws make a repeat rare (not impossible); the standalone drill did the same.
    expect(repeats).toBeLessThan(3);
  });
});
