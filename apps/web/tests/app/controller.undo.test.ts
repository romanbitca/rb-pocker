/**
 * Grading, the feedback card and Undo in the TableController (PLAN §11, §10.2, §2.3, §12.14;
 * chunk 6.2): the §11.5 tests that need the controller, Stage 6 acceptance 3 and 4 at the
 * controller level, the pause before any new card or bot action, and the session (§11.3 r7). The
 * pure parts and the 10,000-undo chi-square test are in `undo.test.ts`. Grades come from stub
 * graders (`graders.ts`): the real grader is chunk 6.1's. Fake timers throughout.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HERO, TIMING } from '../../src/app/controller.ts';
import { brainGrader, GRADE_PAUSE_MS, GRADE_TIMEOUT_MS } from '../../src/app/grading.ts';
import { selectUndoButton, type AppState } from '../../src/app/store.ts';
import {
  createBrainClient,
  type BrainClient,
  type SpawnWorker,
} from '../../src/app/workerClient.ts';
import { EngineError } from '../../src/core/assert.ts';
import { observe } from '../../src/engine/observe.ts';
import { replay } from '../../src/engine/replay.ts';
import { startHand } from '../../src/engine/start.ts';
import { step } from '../../src/engine/step.ts';
import type {
  CoachLevel,
  EngineInput,
  HandState,
  LegalActions,
  Observation,
  ObserveExtras,
  PlayerAction,
  ReplayRecord,
} from '../../src/engine/types.ts';
import type { SessionState } from '../../src/persist/schema.ts';
import { createSafeStorage, STORAGE_KEYS } from '../../src/persist/storage.ts';
import type { BrainReply, BrainRequest } from '../../src/workers/protocol.ts';
import { FakeStorage } from '../persist/fakeStorage.ts';
import { simpleDecide } from '../helpers/simpleDecide.ts';
import { fakeBrainWorker } from '../workers/fakeBrainWorker.ts';
import { stubGrader, type StubGrader } from './graders.ts';
import {
  elapse,
  flush,
  heroPolicy,
  makeHarness,
  scriptedBrain,
  tick,
  type BotDecisionMsg,
  type Harness,
} from './harness.ts';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const passive = (legal: LegalActions): PlayerAction =>
  legal.canCheck ? { type: 'check' } : { type: 'call' };

/** Bots that check or call, with a fixed think time; `requests` gets every bot decision asked. */
function passiveBots(thinkMs = 300, requests?: BotDecisionMsg[]): BrainClient {
  return scriptedBrain({
    thinkMs,
    choose: (obs) => passive(obs.legal),
    ...(requests !== undefined && { onRequest: (r: BotDecisionMsg) => requests.push(r) }),
  });
}

interface GameOptions {
  grader?: StubGrader | ReturnType<typeof brainGrader>;
  level?: CoachLevel;
  players?: number;
  brain?: BrainClient;
}

/** A table in play (Play pressed), at Normal speed. */
function game(options: GameOptions = {}): Harness {
  const h = makeHarness({
    brain: options.brain ?? passiveBots(),
    ...(options.grader !== undefined && { grader: options.grader }),
    settings: {
      players: options.players ?? 3,
      coachLevel: options.level ?? 'beginner',
      speed: 'normal',
    },
  });
  h.dispatch({ type: 'play' });
  return h;
}

const inputsOf = (h: Harness): EngineInput[] => h.controller.snapshot().inputs;
const handOf = (h: Harness): HandState => h.state().game.hand as HandState;
const legalOf = (h: Harness): LegalActions => h.state().game.legal as LegalActions;

/** Runs the clock until it is the hero's turn. */
async function toHeroTurn(h: Harness): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (h.state().game.mode === 'heroTurn') return;
    await tick();
  }
  throw new Error('no hero turn');
}

/** The street of the hero's last act in this hand, or null. */
function heroLastStreet(hand: HandState): string | null {
  let street: string | null = null;
  for (const e of hand.log) if (e.e === 'act' && e.seat === HERO) street = e.street;
  return street;
}

/**
 * Plays until `until` holds: the hero acts with `hero` (default passive), the feedback card is
 * answered with Keep my move, a bust with Reload; otherwise the clock runs.
 */
async function playUntil(
  h: Harness,
  until: (s: AppState) => boolean,
  hero: (legal: LegalActions, s: AppState) => PlayerAction = (legal) => passive(legal),
): Promise<void> {
  for (let i = 0; i < 4000; i++) {
    const s = h.state();
    if (until(s)) return;
    if (s.game.mode === 'heroTurn' && s.game.legal !== null) {
      h.dispatch({ type: 'act', action: hero(s.game.legal, s) });
    } else if (s.game.mode === 'feedback') {
      h.dispatch({ type: 'keepMove' });
    } else if (s.ui.overlays.includes('outOfChips')) {
      h.dispatch({ type: 'reload' });
    } else {
      await tick();
    }
  }
  throw new Error('playUntil: never');
}

/** The hero checked or called on the flop, the turn is shown, and a bot is asked to act. */
const turnShownAfterFlopDecision = (s: AppState): boolean => {
  const hand = s.game.hand;
  return (
    hand !== null &&
    hand.street === 'turn' &&
    s.game.mode === 'botTurn' &&
    heroLastStreet(hand) === 'flop' &&
    s.game.canUndo
  );
};

/** The game slice's view of the state that every §11.5 comparison ignores. */
const rest = (h: HandState) => ({
  ...h,
  deck: h.deck.slice(0, h.deckPos),
  log: [],
  undoneDecisions: [],
});

describe('the grading gate (§2.3, §11.3 r5): nothing moves until the grade', () => {
  it('after the act: mode grading, no bot request, no advance, Undo disabled; the grade releases the hand', async () => {
    const requests: BotDecisionMsg[] = [];
    const grader = stubGrader({ delayMs: 1000 });
    const h = game({ grader, brain: passiveBots(300, requests) });
    await toHeroTurn(h);
    const before = inputsOf(h).length;
    h.dispatch({ type: 'act', action: passive(legalOf(h)) });
    const asked = requests.length;
    expect(h.state().game.mode).toBe('grading');
    expect(h.state().game.canUndo).toBe(false);
    h.dispatch({ type: 'undo' }); // refused: the grade has not arrived (r5)
    await elapse(999);
    expect(requests.length).toBe(asked);
    expect(inputsOf(h)).toHaveLength(before + 1); // only the hero's act
    expect(h.state().game.mode).toBe('grading');
    expect(grader.asks).toHaveLength(1);
    // The grade job carries the hero's observation at the decision, never the hand state.
    expect(Object.keys(grader.asks[0] as object).sort()).toEqual(
      ['decisionId', 'eRandom', 'obs', 'taken'].sort(),
    );
    expect(grader.asks[0]?.obs).not.toHaveProperty('deck');
    await elapse(1);
    expect(h.state().game.mode).not.toBe('grading');
    expect(h.state().game.canUndo).toBe(true);
    expect(h.state().game.decisions).toEqual([
      expect.objectContaining({ decisionId: 0, grade: 'best', undone: false }),
    ]);
  });

  it('without a grader (tests): recorded at once with grade null, nothing waits', async () => {
    const h = game();
    await toHeroTurn(h);
    h.dispatch({ type: 'act', action: passive(legalOf(h)) });
    expect(h.state().game.mode).not.toBe('grading');
    expect(h.state().game.decisions).toEqual([
      expect.objectContaining({ decisionId: 0, grade: null }),
    ]);
    expect(h.state().game.canUndo).toBe(true);
  });
});

describe('the feedback card: the pause before any new card or bot action (§11.1, §12.6)', () => {
  it('a blunder at Beginner opens it at once; 60 s later nothing has moved; Keep my move goes on', async () => {
    const requests: BotDecisionMsg[] = [];
    const grader = stubGrader({ answer: (ask) => (ask.decisionId === 0 ? 'blunder' : 'best') });
    const h = game({ grader, brain: passiveBots(300, requests) });
    await toHeroTurn(h);
    h.dispatch({ type: 'act', action: passive(legalOf(h)) });
    await flush();
    const s = h.state();
    expect(s.game.mode).toBe('feedback');
    expect(s.ui.overlays).toContain('feedback');
    expect(s.ui.gates).toContain('feedback');
    expect(s.game.legal).toBeNull(); // the action bar is disabled
    expect(s.game.feedback).toMatchObject({ decisionId: 0, grade: 'blunder', canUndo: true });
    // The hand log ends with the hero's act: no bot action and no card after it.
    const log = handOf(h).log;
    expect(log[log.length - 1]).toMatchObject({ e: 'act', seat: HERO });
    const asked = requests.length;
    const inputs = inputsOf(h).length;
    await elapse(60_000);
    expect(requests.length).toBe(asked);
    expect(inputsOf(h)).toHaveLength(inputs);
    expect(h.state().game.mode).toBe('feedback');

    h.dispatch({ type: 'keepMove' });
    expect(h.state().ui.overlays).not.toContain('feedback');
    expect(h.state().game.feedback).toBeNull();
    expect(h.state().game.mode).not.toBe('feedback');
    await elapse(5_000);
    expect(inputsOf(h).length).toBeGreaterThan(inputs); // the hand goes on
  });

  it('Back on the card keeps the move; leaving the Table keeps the card for later', async () => {
    const grader = stubGrader({ answer: () => 'mistake' });
    const h = game({ grader });
    await toHeroTurn(h);
    h.dispatch({ type: 'act', action: passive(legalOf(h)) });
    await flush();
    expect(h.state().game.mode).toBe('feedback');
    const inputs = inputsOf(h).length;
    // Menu → Leave table: Home. The card waits; nothing moves.
    h.dispatch({ type: 'leaveTable' });
    expect(h.state().ui.screen).toBe('home');
    await elapse(30_000);
    expect(h.state().game.mode).toBe('feedback');
    expect(inputsOf(h)).toHaveLength(inputs);
    // Play: the Table again, with the card.
    h.dispatch({ type: 'play' });
    expect(h.state().ui.screen).toBe('table');
    expect(h.state().ui.overlays).toContain('feedback');
    // Android Back closes it: the move stands, the hand goes on.
    h.dispatch({ type: 'back' });
    expect(h.state().ui.overlays).not.toContain('feedback');
    expect(h.state().game.mode).not.toBe('feedback');
    await elapse(5_000);
    expect(inputsOf(h).length).toBeGreaterThan(inputs);
  });

  it('Beginner pauses from Inaccuracy, Intermediate from Mistake (§10.2)', async () => {
    const at = async (level: CoachLevel, answer: 'inaccuracy' | 'mistake') => {
      const h = game({ level, grader: stubGrader({ answer: () => answer }) });
      await toHeroTurn(h);
      h.dispatch({ type: 'act', action: passive(legalOf(h)) });
      await flush();
      return h.state().game.mode;
    };
    expect(await at('beginner', 'inaccuracy')).toBe('feedback');
    expect(await at('intermediate', 'inaccuracy')).not.toBe('feedback');
    expect(await at('intermediate', 'mistake')).toBe('feedback');
    expect(await at('advanced', 'mistake')).toBe('feedback');
  });
});

describe('Undo (§11.3, §11.5)', () => {
  it('from the card: the decision back, the toast, practice; a second Undo is refused everywhere', async () => {
    const grader = stubGrader({ answer: () => 'blunder' });
    const h = game({ grader });
    await toHeroTurn(h);
    const atDecision = handOf(h);
    const snap = h.controller.snapshot().undoSnapshot;
    expect(snap?.state).toBe(atDecision); // taken when the turn began (r1)
    const inputsAtDecision = inputsOf(h);
    const legal = legalOf(h);
    h.dispatch({ type: 'act', action: passive(legal) });
    await flush();
    expect(h.state().game.mode).toBe('feedback');

    h.dispatch({ type: 'undo' });
    const s = h.state();
    expect(s.game.mode).toBe('heroTurn');
    expect(s.ui.overlays).not.toContain('feedback');
    expect(s.ui.toasts.map((t) => t.kind)).toContain('undone');
    const restored = handOf(h);
    expect(rest(restored)).toEqual(rest(atDecision));
    expect(restored.log).toEqual([
      ...atDecision.log,
      { e: 'reshuffle', decisionId: 0, undoIndex: 0 },
    ]);
    expect(inputsOf(h)).toEqual([
      ...inputsAtDecision,
      { kind: 'reshuffle', decisionId: 0, undoIndex: 0 },
    ]);
    const after = h.controller.snapshot();
    expect(after.assisted).toBe(true);
    expect(after.meta.undoCount).toBe(1);
    expect(after.meta.decisions).toEqual([
      expect.objectContaining({ decisionId: 0, grade: 'blunder', undone: true }),
    ]);
    // A second Undo before acting: nothing to take back.
    expect(s.game.canUndo).toBe(false);
    h.dispatch({ type: 'undo' });
    expect(inputsOf(h)).toHaveLength(inputsAtDecision.length + 1);

    // The same mistake again: the card comes back, its Undo disabled (one undo per decision).
    h.dispatch({ type: 'act', action: passive(legalOf(h)) });
    await flush();
    expect(h.state().game.mode).toBe('feedback');
    expect(h.state().game.feedback?.canUndo).toBe(false);
    expect(h.state().game.canUndo).toBe(false);
    const inputs = inputsOf(h);
    h.dispatch({ type: 'undo' }); // the button's tap or the U key: ignored
    expect(inputsOf(h)).toEqual(inputs);
    expect(h.controller.logs().events.filter((e) => e.what === 'undo refused')).not.toHaveLength(0);
    // The engine refuses it too.
    const again = h.controller.snapshot().undoSnapshot;
    let thrown: unknown = null;
    try {
      step(again?.state as HandState, { kind: 'reshuffle', decisionId: 0, undoIndex: 0 });
    } catch (e) {
      thrown = e;
    }
    expect((thrown as EngineError).code).toBe('UNDO_USED');
    h.dispatch({ type: 'keepMove' });
    // §11.4: both decisions count; the new one is graded too.
    expect(h.controller.snapshot().meta.decisions).toEqual([
      expect.objectContaining({ decisionId: 0, grade: 'blunder', undone: true }),
      expect.objectContaining({ decisionId: 0, grade: 'blunder', undone: false }),
    ]);
  });

  it('the toolbar Undo after the turn was shown: the snapshot back but the stub; bots and board unchanged', async () => {
    const h = game({ grader: stubGrader() });
    await playUntil(h, turnShownAfterFlopDecision);
    const before = h.controller.snapshot();
    const snap = before.undoSnapshot;
    if (snap === null || before.hand === null) throw new Error('no snapshot');
    expect(snap.state.street).toBe('flop');
    h.dispatch({ type: 'undo' });
    const restored = handOf(h);
    expect(h.state().game.mode).toBe('heroTurn');
    // §11.5: deep-equal except deck[deckPos..], the log (one reshuffle) and undoneDecisions.
    expect(rest(restored)).toEqual(rest(snap.state));
    const stub = (x: HandState) => x.deck.slice(x.deckPos).sort((a, b) => a - b);
    expect(stub(restored)).toEqual(stub(snap.state));
    expect(restored.log).toEqual([
      ...snap.state.log,
      { e: 'reshuffle', decisionId: snap.decisionId, undoIndex: 0 },
    ]);
    expect(restored.undoneDecisions).toEqual([...snap.state.undoneDecisions, snap.decisionId]);
    // r4: the bots' hole cards and the board (as at the decision) never change.
    expect(restored.seats.map((x) => x.hole)).toEqual(before.hand.seats.map((x) => x.hole));
    expect(restored.board).toEqual(before.hand.board.slice(0, 3));
  });

  it('a timer scheduled before the Undo never fires an action after it', async () => {
    const h = game({ grader: stubGrader() });
    await playUntil(h, (s) => s.game.mode === 'botTurn' && s.game.canUndo);
    await flush(); // the bot's decision is in: its think timer runs
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    h.dispatch({ type: 'undo' });
    const after = inputsOf(h);
    expect(after[after.length - 1]).toMatchObject({ kind: 'reshuffle' });
    await elapse(20_000);
    expect(h.state().game.mode).toBe('heroTurn');
    expect(inputsOf(h)).toEqual(after);
    expect(h.controller.logs().errors).toEqual([]);
  });

  it('200 random Undo taps during bot turns never give a double bot action', async () => {
    // Bots whose action depends on the observation: a stale decision would differ from the one
    // their observation gives, and the check below would see it.
    const policy = (obs: Observation): PlayerAction => {
      const n = obs.history.length;
      if (obs.legal.raise !== null && n % 7 === 3)
        return { type: 'raise', to: obs.legal.raise.min };
      if (obs.legal.bet !== null && n % 5 === 2) return { type: 'bet', to: obs.legal.bet.min };
      return passive(obs.legal);
    };
    const h = makeHarness({
      brain: scriptedBrain({ thinkMs: 250, choose: policy }),
      grader: stubGrader(),
      settings: { players: 4, coachLevel: 'beginner', speed: 'normal' },
    });
    h.dispatch({ type: 'play' });
    const hero = heroPolicy('5eed0000000000000000000000000062');
    let random = 0x2545f491;
    const roll = (): number => {
      random = (Math.imul(random, 1103515245) + 12345) >>> 0;
      return random / 2 ** 32;
    };
    const records: { hand: HandState; record: ReplayRecord }[] = [];
    const seen = new Set<number>();
    const unsubscribe = h.store.subscribe((s) => {
      const hand = s.game.hand;
      if (hand === null || hand.phase !== 'complete' || seen.has(hand.handSeq)) return;
      seen.add(hand.handSeq);
      const snap = h.controller.snapshot();
      records.push({
        hand,
        record: {
          engineVersion: hand.engineVersion,
          seed: hand.seed,
          commit: null,
          table: snap.table as NonNullable<typeof snap.table>,
          inputs: snap.inputs,
        },
      });
    });
    let taps = 0;
    let undos = 0;
    try {
      for (let i = 0; taps < 200 || records.length < 3; i++) {
        if (i > 40_000) throw new Error('stuck');
        const s = h.state();
        if (s.game.mode === 'heroTurn' && s.game.legal !== null) {
          h.dispatch({ type: 'act', action: hero(s.game.legal) });
          continue;
        }
        if (s.ui.overlays.includes('outOfChips')) {
          h.dispatch({ type: 'reload' });
          continue;
        }
        if ((s.game.mode === 'botTurn' || s.game.mode === 'advancing') && roll() < 0.3) {
          const count = h.controller.snapshot().meta.undoCount;
          h.dispatch({ type: 'undo' });
          taps++;
          if (h.controller.snapshot().meta.undoCount > count) undos++;
        }
        await flush();
        vi.advanceTimersByTime(Math.floor(roll() * 400));
        await flush();
      }
    } finally {
      unsubscribe();
    }
    expect(undos).toBeGreaterThan(10);
    expect(h.controller.logs().errors).toEqual([]);
    expect(h.state().game.diag).toEqual({ engineErrors: 0, botFallbacks: 0, voidedHands: 0 });
    const extras = (n: number): ObserveExtras => ({
      seatStats: new Array(n).fill(null),
      visiblePersonality: new Array(n).fill(null),
      seatLevels: new Array(n).fill('easy'),
    });
    for (const { hand, record } of records) {
      // §4.7: the record replays to exactly its final state.
      expect(replay(record)).toEqual(hand);
      // Every bot action is the one its observation gives: none came from a stale decision.
      let state = startHand(record.table, record.seed);
      for (const input of record.inputs) {
        if (input.kind === 'act' && input.seat !== HERO) {
          expect(input.action).toEqual(
            policy(observe(state, input.seat, extras(state.seats.length))),
          );
        }
        state = step(state, input);
      }
    }
  });

  it('the record of a hand with an Undo replays to its final state: undone inputs gone, reshuffle in', async () => {
    const h = game({ grader: stubGrader() });
    await playUntil(h, turnShownAfterFlopDecision);
    const before = inputsOf(h);
    const snap = h.controller.snapshot().undoSnapshot as NonNullable<
      ReturnType<Harness['controller']['snapshot']>['undoSnapshot']
    >;
    h.dispatch({ type: 'undo' });
    await playUntil(h, (s) => s.game.hand?.phase === 'complete');
    const end = h.controller.snapshot();
    const final = end.hand as HandState;
    const inputs = end.inputs;
    expect(inputs.slice(0, snap.inputCount)).toEqual(before.slice(0, snap.inputCount));
    expect(inputs[snap.inputCount]).toEqual({
      kind: 'reshuffle',
      decisionId: snap.decisionId,
      undoIndex: 0,
    });
    expect(inputs.filter((x) => x.kind === 'reshuffle')).toHaveLength(1);
    const record: ReplayRecord = {
      engineVersion: final.engineVersion,
      seed: final.seed,
      commit: null,
      table: end.table as NonNullable<typeof end.table>,
      inputs,
    };
    expect(replay(record)).toEqual(final);
    expect(end.assisted).toBe(true);
  });
});

describe('Stage 6 acceptance 3: no Undo after a reveal, at showdown; hidden at Advanced; none at Exam', () => {
  it('disabled after a run-out reveal', async () => {
    const h = game({ grader: stubGrader(), players: 2 });
    await toHeroTurn(h);
    const legal = legalOf(h);
    const max = legal.raise?.max ?? legal.bet?.max ?? 0;
    h.dispatch({
      type: 'act',
      action: legal.raise !== null ? { type: 'raise', to: max } : { type: 'bet', to: max },
    });
    await playUntil(h, (s) => s.game.mode === 'advancing');
    expect(handOf(h).revealed).toEqual([]);
    expect(h.state().game.canUndo).toBe(true); // all-in and called, nothing turned yet
    await playUntil(h, (s) => (s.game.hand?.revealed.length ?? 0) > 0);
    expect(handOf(h).runout).toBe(true);
    expect(h.state().game.canUndo).toBe(false);
    const inputs = inputsOf(h);
    h.dispatch({ type: 'undo' });
    expect(inputsOf(h)).toEqual(inputs);
  });

  it('disabled at showdown and after the hand', async () => {
    const h = game({ grader: stubGrader(), players: 2 });
    await playUntil(
      h,
      (s) =>
        s.game.hand?.street === 'river' &&
        s.game.hand.phase === 'roundComplete' &&
        s.game.mode === 'advancing',
    );
    expect(h.state().game.canUndo).toBe(true);
    await playUntil(h, (s) => s.game.hand?.phase === 'showdown');
    expect(handOf(h).revealed.length).toBe(2);
    expect(h.state().game.canUndo).toBe(false);
    await playUntil(h, (s) => s.game.mode === 'handEnd');
    expect(h.state().game.canUndo).toBe(false);
  });

  it('Advanced: no toolbar Undo; inside the feedback card it works', async () => {
    const grader = stubGrader({ answer: (ask) => (ask.decisionId === 0 ? 'best' : 'mistake') });
    const h = game({ level: 'advanced', grader });
    expect(selectUndoButton(h.state())).toBe('hidden');
    await toHeroTurn(h);
    h.dispatch({ type: 'act', action: passive(legalOf(h)) });
    await flush();
    expect(h.state().game.mode).not.toBe('feedback');
    expect(h.state().game.canUndo).toBe(false); // Advanced: only inside the card
    expect(selectUndoButton(h.state())).toBe('hidden');
    await playUntil(
      h,
      (s) => s.game.mode === 'feedback',
      (legal) => passive(legal),
    );
    expect(h.state().game.feedback?.canUndo).toBe(true);
    expect(h.state().game.canUndo).toBe(true);
    h.dispatch({ type: 'undo' });
    expect(h.state().game.mode).toBe('heroTurn');
    expect(h.controller.snapshot().meta.undoCount).toBe(1);
  });

  it('Exam: no pause, no card, no Undo at all', async () => {
    const grader = stubGrader({ answer: () => 'blunder' });
    const h = game({ level: 'exam', grader });
    expect(selectUndoButton(h.state())).toBe('hidden');
    await toHeroTurn(h);
    h.dispatch({ type: 'act', action: passive(legalOf(h)) });
    await flush();
    expect(h.state().game.mode).not.toBe('feedback');
    expect(h.state().ui.overlays).not.toContain('feedback');
    expect(h.state().game.canUndo).toBe(false);
    const inputs = inputsOf(h);
    h.dispatch({ type: 'undo' });
    expect(inputsOf(h)).toEqual(inputs);
    expect(h.state().game.decisions).toEqual([
      expect.objectContaining({ decisionId: 0, grade: 'blunder', undone: false }),
    ]);
  });

  it('Beginner and Intermediate show the toolbar Undo, disabled until it can be used', async () => {
    const h = game({ grader: stubGrader({ delayMs: 200 }) });
    expect(selectUndoButton(h.state())).toBe('disabled');
    await toHeroTurn(h);
    h.dispatch({ type: 'act', action: passive(legalOf(h)) });
    expect(selectUndoButton(h.state())).toBe('disabled'); // grading
    await elapse(200);
    expect(selectUndoButton(h.state())).toBe('enabled');
    h.dispatch({ type: 'settings', patch: { coachLevel: 'intermediate' } });
    expect(selectUndoButton(h.state())).toBe('enabled');
  });
});

describe('Stage 6 acceptance 4: slow, failed and killed grades', () => {
  it('a grade later than 1,500 ms does not block the game; Undo waits for it; no card', async () => {
    const requests: BotDecisionMsg[] = [];
    const grader = stubGrader({ answer: () => 'blunder', delayMs: 3000 });
    const h = game({ grader, brain: passiveBots(2500, requests) });
    await toHeroTurn(h);
    h.dispatch({ type: 'act', action: passive(legalOf(h)) });
    const asked = requests.length;
    await elapse(GRADE_PAUSE_MS - 1);
    expect(h.state().game.mode).toBe('grading');
    expect(requests.length).toBe(asked);
    await elapse(1);
    expect(h.state().game.mode).not.toBe('grading');
    expect(requests.length + inputsOf(h).length).toBeGreaterThan(asked); // the hand goes on
    expect(h.controller.logs().events.map((e) => e.what)).toContain('grade late');
    expect(h.state().game.canUndo).toBe(false);
    await elapse(3000 - GRADE_PAUSE_MS - 1);
    expect(h.state().game.canUndo).toBe(false);
    await elapse(1);
    expect(h.state().game.decisions).toEqual([
      expect.objectContaining({ decisionId: 0, grade: 'blunder' }),
    ]);
    expect(h.state().game.mode).not.toBe('feedback'); // a late grade never pauses
    expect(h.state().game.canUndo).toBe(true);
  });

  it('a grade job that errors twice records grade null and enables Undo', async () => {
    const grader = stubGrader({ answer: () => 'error' });
    const h = game({ grader });
    await toHeroTurn(h);
    h.dispatch({ type: 'act', action: passive(legalOf(h)) });
    await flush();
    expect(grader.asks).toHaveLength(2); // retried once, with the same inputs
    expect(grader.asks[1]).toEqual(grader.asks[0]);
    expect(h.state().game.decisions).toEqual([
      expect.objectContaining({ decisionId: 0, grade: null }),
    ]);
    expect(h.state().game.mode).not.toBe('grading');
    expect(h.state().game.mode).not.toBe('feedback');
    expect(h.state().game.canUndo).toBe(true);
  });

  it('a grade job with no reply: 5 s, once more, then grade null (brain.worker)', async () => {
    // brain.worker answers bot decisions (bots think 20 s, so the hero is not asked again before
    // the second timeout) and never a grade.
    const grades: BrainRequest[] = [];
    const inner = fakeBrainWorker({
      service: { decide: simpleDecide, thinkMs: () => 20_000 },
    });
    const spawn: SpawnWorker<BrainRequest, BrainReply> = (events) => {
      const port = inner.spawn(events);
      return {
        postMessage(msg) {
          if (msg.kind === 'grade') grades.push(msg);
          else port.postMessage(msg);
        },
        terminate: () => port.terminate(),
      };
    };
    const brain = createBrainClient(spawn, {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      now: () => Date.now(),
    });
    const h = game({ brain, grader: brainGrader(brain) });
    await toHeroTurn(h);
    const action = passive(legalOf(h));
    h.dispatch({ type: 'act', action });
    expect(grades).toHaveLength(1);
    expect(grades[0]).toMatchObject({ kind: 'grade', decisionId: 0, taken: action });
    await elapse(GRADE_TIMEOUT_MS);
    expect(grades).toHaveLength(2); // the retry, the same inputs
    expect({ ...grades[1], jobId: 0 }).toEqual({ ...grades[0], jobId: 0 });
    expect(h.state().game.canUndo).toBe(false);
    await elapse(GRADE_TIMEOUT_MS);
    expect(h.state().game.decisions).toEqual([
      expect.objectContaining({ decisionId: 0, grade: null }),
    ]);
    expect(h.state().game.canUndo).toBe(true);
  });

  it('killing brain.worker mid-hand still finishes the hand; the grades are null', async () => {
    const fake = fakeBrainWorker({ service: { decide: simpleDecide } });
    const brain = createBrainClient(fake.spawn, {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      now: () => Date.now(),
    });
    const h = game({ brain, grader: brainGrader(brain) });
    await toHeroTurn(h);
    const handSeq = handOf(h).handSeq;
    h.dispatch({ type: 'act', action: passive(legalOf(h)) });
    await flush();
    // Killed, restarted, killed again: the client gives up (§12.14).
    fake.current().crash('killed');
    fake.current().crash('killed again');
    expect(brain.status).toBe('failed');
    await playUntil(h, (s) => s.game.hand?.handSeq === handSeq && s.game.hand.phase === 'complete');
    expect(h.state().game.diag.botFallbacks).toBeGreaterThan(0);
    const decisions = h.state().game.decisions;
    expect(decisions.length).toBeGreaterThan(0);
    expect(decisions.every((d) => d.grade === null)).toBe(true);
  });
});

describe('the session (§11.3 r7)', () => {
  const stored = (backend: FakeStorage): SessionState =>
    JSON.parse(backend.data.get(STORAGE_KEYS.session) as string) as SessionState;

  function launch(backend: FakeStorage, grader: StubGrader): Harness {
    return makeHarness({
      storage: createSafeStorage(() => backend),
      brain: passiveBots(),
      grader,
      settings: { players: 3, coachLevel: 'beginner', speed: 'normal' },
    });
  }

  it('after a reload the snapshot and the records come back, and Undo still works', async () => {
    const backend = new FakeStorage();
    const first = launch(backend, stubGrader());
    first.dispatch({ type: 'play' });
    await toHeroTurn(first);
    const atDecision = handOf(first);
    first.dispatch({ type: 'act', action: passive(legalOf(first)) });
    await flush();
    const session = stored(backend);
    expect(session.undoSnapshot?.state).toEqual(atDecision);
    expect(session.meta.decisions).toEqual([
      expect.objectContaining({ decisionId: 0, grade: 'best' }),
    ]);
    first.controller.dispose();

    const second = launch(backend, stubGrader());
    second.dispatch({ type: 'play' });
    expect(second.state().game.canUndo).toBe(true);
    second.dispatch({ type: 'undo' });
    expect(second.state().game.mode).toBe('heroTurn');
    expect(rest(handOf(second))).toEqual(rest(atDecision));
    expect(second.controller.snapshot().meta.undoCount).toBe(1);
    expect(stored(backend).meta.undoCount).toBe(1);
  });

  it('a grade still on its way at the reload is asked again (late: no pause)', async () => {
    const backend = new FakeStorage();
    const first = launch(backend, stubGrader({ answer: () => 'never' }));
    first.dispatch({ type: 'play' });
    await toHeroTurn(first);
    first.dispatch({ type: 'act', action: passive(legalOf(first)) });
    expect(first.state().game.mode).toBe('grading');
    expect(stored(backend).meta.decisions).toEqual([]);
    first.controller.dispose();

    const grader = stubGrader({ answer: () => 'mistake' });
    const second = launch(backend, grader);
    expect(grader.asks).toHaveLength(1);
    expect(grader.asks[0]?.decisionId).toBe(0);
    await flush();
    expect(second.controller.snapshot().meta.decisions).toEqual([
      expect.objectContaining({ decisionId: 0, grade: 'mistake' }),
    ]);
    second.dispatch({ type: 'play' });
    expect(second.state().game.mode).not.toBe('feedback');
    expect(second.state().game.mode).not.toBe('grading');
    expect(second.state().game.canUndo).toBe(true);
  });
});

describe('timings', () => {
  it('TIMING names the grade pause', () => {
    expect(TIMING.gradePauseMs).toBe(1500);
  });
});
