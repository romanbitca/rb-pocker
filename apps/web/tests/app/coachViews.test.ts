// The coach's selectors (chunk 5.9, `app/coachViews.ts`): the strip's state per hero decision,
// the narration of the last action, the `showHint` command, and stable objects (pitfall 37).
import { describe, expect, it } from 'vitest';
import {
  coachDataOf,
  coachKeyOf,
  createAppStore,
  initialCoach,
  initialEquity,
  initialGame,
  narrationOf,
  selectCoach,
  selectNarration,
  type AppStore,
  type CoachSlice,
} from '../../src/app/store.ts';
import type { Decision } from '../../src/brain/types.ts';
import { legalActions } from '../../src/engine/legal.ts';
import type { HandState } from '../../src/engine/types.ts';
import { playSpot } from '../brain/fixtures.ts';
import { tableWith } from '../engine/helpers.ts';
import { bet, call, check, fold, raise } from '../engine/play.ts';

const DECISION: Decision = {
  action: { type: 'fold' },
  kind: 'fold',
  ev: {},
  eRandom: 0.2,
  eRange: 0.2,
  need: 0.25,
  bucket: 'air',
  strength: 'weak',
  confidence: 'clear',
  alt: null,
  trace: [{ code: 'FOLD_PRICE', data: {} }],
};

/** Three-handed; seat 2 (the button) raises, the hero (seat 0, small blind) is to act preflop. */
function heroToAct(): HandState {
  return playSpot({ stacks: [10_000, 10_000, 10_000], button: 2, inputs: [raise(2, 300)] });
}

function storeAt(hand: HandState, mode: 'heroTurn' | 'botTurn', coach: CoachSlice): AppStore {
  const store = createAppStore();
  store.setState({
    game: {
      ...initialGame(),
      mode,
      hand,
      table: tableWith([10_000, 10_000, 10_000]),
      legal: mode === 'heroTurn' ? legalActions(hand) : null,
    },
    coach,
  });
  return store;
}

describe('coachDataOf (§12.6 states)', () => {
  it('off without a hand or after it, waiting while others act', () => {
    const hand = heroToAct();
    expect(coachDataOf('idle', null, null, initialCoach(), 'beginner').state).toBe('off');
    const done = { ...hand, phase: 'complete' } as HandState;
    expect(coachDataOf('handEnd', done, null, initialCoach(), 'beginner').state).toBe('off');
    expect(coachDataOf('botTurn', hand, null, initialCoach(), 'beginner').state).toBe('waiting');
  });

  it('pending, then ready or failed for the hero’s decision, by its key', () => {
    const hand = heroToAct();
    const legal = legalActions(hand);
    const key = coachKeyOf(hand);
    expect(coachDataOf('heroTurn', hand, legal, initialCoach(), 'beginner')).toMatchObject({
      state: 'pending',
      key,
      decision: null,
    });
    const ready: CoachSlice = { key, status: 'ready', decision: DECISION, opened: null };
    expect(coachDataOf('heroTurn', hand, legal, ready, 'intermediate')).toMatchObject({
      level: 'intermediate',
      state: 'ready',
      decision: DECISION,
      opened: false,
    });
    // A hint for another decision is not this one's.
    const stale = { ...ready, key: `${hand.handSeq}:1` };
    expect(coachDataOf('heroTurn', hand, legal, stale, 'beginner').state).toBe('pending');
    const failed: CoachSlice = { key, status: 'failed', decision: null, opened: key };
    expect(coachDataOf('heroTurn', hand, legal, failed, 'beginner')).toMatchObject({
      state: 'failed',
      opened: true,
    });
  });

  it('a new action or street is a new decision key', () => {
    const h = heroToAct();
    const after = playSpot({
      stacks: [10_000, 10_000, 10_000],
      button: 2,
      inputs: [raise(2, 300), call(0)],
    });
    expect(coachKeyOf(after)).not.toBe(coachKeyOf(h));
  });
});

describe('selectCoach', () => {
  it('returns the same object while nothing it shows changed (pitfall 37)', () => {
    const hand = heroToAct();
    const store = storeAt(hand, 'heroTurn', initialCoach());
    const a = selectCoach(store.getState());
    store.setState({ equity: { ...initialEquity(), status: 'computing' } });
    store.getState().dispatch({ type: 'layout', layout: 'wide' });
    expect(selectCoach(store.getState())).toBe(a);
  });

  it('showHint marks the hero’s decision as opened, and nothing else', () => {
    const hand = heroToAct();
    const store = storeAt(hand, 'heroTurn', initialCoach());
    store.getState().dispatch({ type: 'showHint' });
    expect(store.getState().coach.opened).toBe(coachKeyOf(hand));
    expect(selectCoach(store.getState()).opened).toBe(true);
    const before = store.getState().coach;
    store.getState().dispatch({ type: 'showHint' });
    expect(store.getState().coach).toBe(before);
    // Not the hero's turn: nothing to open.
    const waiting = storeAt(hand, 'botTurn', initialCoach());
    waiting.getState().dispatch({ type: 'showHint' });
    expect(waiting.getState().coach.opened).toBeNull();
  });
});

describe('narration (§12.6 "Ben raises to 60.")', () => {
  it('names the last action of the current street', () => {
    const table = tableWith([10_000, 10_000, 10_000]);
    const names = table.slots.map((s) => s.name);
    const h = heroToAct();
    expect(narrationOf(h, table, 'You')).toMatchObject({
      hero: false,
      name: names[2],
      type: 'raise',
      amount: 300,
      allIn: false,
    });
    const called = playSpot({
      stacks: [10_000, 10_000, 10_000],
      button: 2,
      inputs: [raise(2, 300), call(0)],
    });
    // The small blind's call puts 250 more in: what its Call button said (§12.7 "Call 250").
    expect(narrationOf(called, table, 'You')).toMatchObject({
      hero: true,
      name: 'You',
      type: 'call',
      amount: 250,
    });
    const folded = playSpot({
      stacks: [10_000, 10_000, 10_000],
      button: 2,
      inputs: [raise(2, 300), call(0), fold(1)],
    });
    // The flop is dealt: the preflop actions are old news.
    expect(folded.street).toBe('flop');
    expect(narrationOf(folded, table, 'You')).toBeNull();
    const checked = playSpot({
      stacks: [10_000, 10_000, 10_000],
      button: 2,
      inputs: [raise(2, 300), call(0), fold(1), check(0)],
    });
    expect(narrationOf(checked, table, 'You')).toMatchObject({
      hero: true,
      type: 'check',
      amount: 0,
    });
    const flopBet = playSpot({
      stacks: [10_000, 10_000, 10_000],
      button: 2,
      inputs: [raise(2, 300), call(0), fold(1), check(0), bet(2, 9_700)],
    });
    expect(narrationOf(flopBet, table, 'You')).toMatchObject({
      hero: false,
      type: 'bet',
      amount: 9_700,
      allIn: true,
    });
  });

  it('selectNarration keeps its object while the narration is the same', () => {
    const hand = heroToAct();
    const store = storeAt(hand, 'botTurn', initialCoach());
    const a = selectNarration(store.getState());
    expect(a?.type).toBe('raise');
    store.setState({ game: { ...store.getState().game, mode: 'heroTurn' } });
    expect(selectNarration(store.getState())).toBe(a);
  });
});
