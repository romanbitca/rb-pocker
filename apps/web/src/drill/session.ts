/**
 * One drill session (PLAN §13.5): the question on show, the player's picks, the counters (streak,
 * score, best) and the stored stats. A small external store (`subscribe` + `view`, for React's
 * `useSyncExternalStore`) over the pure question logic; the random stream and the storage are
 * passed in, so a test fixes the seed and fakes the storage. The app keeps one per launch
 * (`app/drill.ts`): leaving the page and coming back finds the same question and counters.
 *
 * The streak and the score are this launch's; the best streak and the per-hand stats are stored
 * after every answer (`pc.v1.drill`).
 */
import type { Rng } from '../core/rng.ts';
import { emptyDrillData, emptyHands, type DrillData } from './data.ts';
import { categoryAt, type Position } from './ladder.ts';
import {
  askedPosition,
  buildQuestion,
  complete,
  counted,
  gameFor,
  isRight,
  keyOf,
  needsName,
  needsPosition,
  NO_PICKS,
  optionsOf,
  type BuildContext,
  type Difficulty,
  type GameId,
  type Picks,
  type Question,
} from './questions.ts';

/** Where the session keeps its data (`app/drill.ts`: `pc.v1.drill`; tests: a fake). */
export interface DrillStorage {
  /** The stored data, or null when there is none or it cannot be used. */
  load(): DrillData | null;
  save(data: DrillData): void;
}

/** Everything the page shows. A new object after every change, the same one in between. */
export interface DrillView {
  readonly data: DrillData;
  readonly streak: number;
  /** Right answers and answers this launch: "Score 7/9". */
  readonly right: number;
  readonly total: number;
  readonly question: Question;
  /** Counts the questions dealt: the page deals the cards again when it changes. */
  readonly seq: number;
  readonly picks: Picks;
  /** Null until the question is answered, then whether the answer was right. */
  readonly result: boolean | null;
  /** Counts the streak milestones (3, then every multiple of 5): the page's chip burst. */
  readonly bursts: number;
}

export interface DrillSession {
  view(): DrillView;
  subscribe(listener: () => void): () => void;
  /** The page opened: read the stored data again (a Reset elsewhere may have cleared it). */
  open(): void;
  pickName(p: Position): void;
  pickPosition(p: Position): void;
  pickOption(id: string): void;
  /** The next question (also when this one is not answered). */
  next(): void;
  setGame(game: GameId): void;
  setDifficulty(difficulty: Difficulty): void;
  /** The Stats sheet's "Reset stats": the per-hand stats, best streak and count start again. */
  resetStats(): void;
}

/** How many order and position questions are remembered, so they do not repeat at once. */
const RECENT = 5;
/** How many times a remembered one is drawn again before it is accepted. */
const REDRAWS = 12;

const same = (a: DrillData, b: DrillData): boolean => JSON.stringify(a) === JSON.stringify(b);

export function createDrillSession(options: { rng: Rng; storage: DrillStorage }): DrillSession {
  const { rng, storage } = options;
  let data: DrillData = storage.load() ?? emptyDrillData();
  let last: Position | null = null;
  let lastTrap: BuildContext['lastTrap'] = { five: null, seven: null };
  const recent: string[] = [];
  let streak = 0;
  let right = 0;
  let total = 0;
  let seq = 0;
  let bursts = 0;
  let question: Question;
  let picks: Picks = NO_PICKS;
  let result: boolean | null = null;
  const listeners = new Set<() => void>();

  const context = (): BuildContext => ({
    difficulty: data.difficulty,
    hands: data.hands,
    last,
    lastTrap,
  });

  function deal(): void {
    const game = gameFor(rng, data.game);
    let built = buildQuestion(rng, game, context());
    for (let i = 0; i < REDRAWS; i++) {
      const key = keyOf(built.question);
      if (key === null || !recent.includes(key)) break;
      built = buildQuestion(rng, game, context());
    }
    const key = keyOf(built.question);
    if (key !== null) {
      recent.push(key);
      if (recent.length > RECENT) recent.shift();
    }
    if (built.trap !== null) lastTrap = { ...lastTrap, [built.trap.list]: built.trap.index };
    question = built.question;
    last = askedPosition(question) ?? last;
    picks = NO_PICKS;
    result = null;
    seq++;
  }

  function judge(): void {
    const ok = isRight(question, picks);
    result = ok;
    total++;
    if (ok) {
      right++;
      streak++;
    } else {
      streak = 0;
    }
    const hands = { ...data.hands };
    for (const p of counted(question)) {
      const category = categoryAt(p);
      const s = hands[category];
      hands[category] = { seen: s.seen + 1, missed: s.missed + (ok ? 0 : 1) };
    }
    data = { ...data, hands, best: Math.max(data.best, streak), answered: data.answered + 1 };
    storage.save(data);
    if (ok && (streak === 3 || streak % 5 === 0)) bursts++;
  }

  deal();
  let snapshot = makeView();

  function makeView(): DrillView {
    return { data, streak, right, total, question, seq, picks, result, bursts };
  }

  function publish(): void {
    snapshot = makeView();
    for (const listener of [...listeners]) listener();
  }

  function choose(change: Partial<Picks>): void {
    picks = { ...picks, ...change };
    if (complete(question, picks)) judge();
    publish();
  }

  function settings(change: Partial<Pick<DrillData, 'game' | 'difficulty'>>): void {
    data = { ...data, ...change };
    storage.save(data);
    deal();
    publish();
  }

  return {
    view: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    open() {
      const stored = storage.load() ?? emptyDrillData();
      if (same(stored, data)) return;
      const changedGame = stored.game !== data.game || stored.difficulty !== data.difficulty;
      data = stored;
      if (changedGame) deal();
      publish();
    },
    pickName(p) {
      if (result !== null || !needsName(question)) return;
      choose({ name: p });
    },
    pickPosition(p) {
      if (result !== null || !needsPosition(question)) return;
      choose({ position: p });
    },
    pickOption(id) {
      if (result !== null || !optionsOf(question).includes(id)) return;
      choose({ option: id });
    },
    next() {
      deal();
      publish();
    },
    setGame(game) {
      if (game === data.game) return;
      settings({ game });
    },
    setDifficulty(difficulty) {
      if (difficulty === data.difficulty) return;
      settings({ difficulty });
    },
    resetStats() {
      data = { ...data, hands: emptyHands(), best: 0, answered: 0 };
      storage.save(data);
      publish();
    },
  };
}
