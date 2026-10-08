// The coach's hint jobs (chunk 5.9, `app/coachJobs.ts`): one request per hero decision, answers
// only in the `coach` slice under their decision's key, the stand-in waits for the HUD's number,
// late answers are dropped, failures can be retried.
import { afterEach, describe, expect, it } from 'vitest';
import { CoachJobs, hudWinChance, standInHints, type HintSource } from '../../src/app/coachJobs.ts';
import {
  coachKeyOf,
  createAppStore,
  initialEquity,
  initialGame,
  selectCoach,
  type AppStore,
  type EquitySlice,
} from '../../src/app/store.ts';
import type { Decision } from '../../src/brain/types.ts';
import { legalActions } from '../../src/engine/legal.ts';
import type { HandState, Observation } from '../../src/engine/types.ts';
import { observeSpot, playSpot } from '../brain/fixtures.ts';
import { bet, call, check } from '../engine/play.ts';
import { flush } from './harness.ts';

/** Heads-up flop: the hero (seat 0) faces a 100 bet into 200. */
function heroFacingBet(): HandState {
  return playSpot({
    stacks: [10_000, 10_000],
    button: 0,
    holes: { 0: 'Ah Kd', 1: '7c 2d' },
    board: 'Ks 8h 3c',
    inputs: [call(0), check(1), bet(1, 100)],
  });
}

function heroTurn(store: AppStore, hand: HandState): void {
  store.setState({ game: { ...initialGame(), mode: 'heroTurn', hand, legal: legalActions(hand) } });
}

function botTurn(store: AppStore, hand: HandState): void {
  store.setState({ game: { ...initialGame(), mode: 'botTurn', hand, legal: null } });
}

/** The equity jobs' final answer for the hand's situation. */
function finalEquity(hand: HandState, equity: number): EquitySlice {
  return {
    ...initialEquity(),
    status: 'done',
    situation: {
      handSeq: hand.handSeq,
      hero: hand.seats[0]?.hole as [number, number],
      board: [...hand.board],
      nOpp: 1,
    },
    result: { n: 1, win: equity, split: 0, equity, exact: true, final: true, truncated: false },
  };
}

const DECISION: Decision = {
  action: { type: 'call' },
  kind: 'call',
  ev: {},
  eRandom: 0.5,
  eRange: 0.5,
  need: 0.25,
  bucket: 'medium',
  strength: 'decent',
  confidence: 'clear',
  alt: null,
  trace: [{ code: 'CALL_PROFITABLE', data: {} }],
};

interface ManualSource extends HintSource {
  asked: { obs: Observation; eRandom: number | null }[];
  answer(i: number, d: Decision | null): void;
}

function manualSource(waitsForWinChance: boolean): ManualSource {
  const pending: { resolve: (d: Decision) => void; reject: (e: unknown) => void }[] = [];
  const asked: ManualSource['asked'] = [];
  return {
    waitsForWinChance,
    asked,
    request(obs, eRandom) {
      asked.push({ obs, eRandom });
      return new Promise((resolve, reject) => pending.push({ resolve, reject }));
    },
    answer(i, d) {
      const p = pending[i];
      if (d === null) p?.reject(new Error('no'));
      else p?.resolve(d);
    },
  };
}

let jobs: CoachJobs | null = null;
afterEach(() => {
  jobs?.dispose();
  jobs = null;
});

const observeHero = (hand: HandState): Observation => observeSpot(hand, 0);

describe('CoachJobs', () => {
  it('asks once per hero decision, with the hero’s own observation, and writes the answer', async () => {
    const store = createAppStore();
    const source = manualSource(false);
    jobs = new CoachJobs(store, source, observeHero);
    const hand = heroFacingBet();
    botTurn(store, hand);
    expect(source.asked).toHaveLength(0);
    heroTurn(store, hand);
    expect(source.asked).toHaveLength(1);
    expect(source.asked[0]?.eRandom).toBeNull(); // the real hint computes it (§8.2)
    expect(source.asked[0]?.obs.seat).toBe(0);
    expect(source.asked[0]?.obs.hole).toEqual(hand.seats[0]?.hole);
    expect(selectCoach(store.getState()).state).toBe('pending');
    // Other writes (the HUD, the UI) ask nothing more.
    store.setState({ equity: finalEquity(hand, 0.5) });
    store.getState().dispatch({ type: 'layout', layout: 'wide' });
    expect(source.asked).toHaveLength(1);
    source.answer(0, DECISION);
    await flush();
    const coach = store.getState().coach;
    expect(coach).toMatchObject({ key: coachKeyOf(hand), status: 'ready', decision: DECISION });
    expect(selectCoach(store.getState())).toMatchObject({ state: 'ready', decision: DECISION });
  });

  it('passes the final HUD number when it already has it', () => {
    const store = createAppStore();
    const source = manualSource(false);
    jobs = new CoachJobs(store, source, observeHero);
    const hand = heroFacingBet();
    store.setState({ equity: finalEquity(hand, 0.42) });
    heroTurn(store, hand);
    expect(source.asked[0]?.eRandom).toBe(0.42);
  });

  it('the stand-in waits for the HUD’s number of this situation', async () => {
    const store = createAppStore();
    const source = manualSource(true);
    jobs = new CoachJobs(store, source, observeHero);
    const hand = heroFacingBet();
    heroTurn(store, hand);
    expect(source.asked).toHaveLength(0);
    // A number for another street does not count.
    const old = finalEquity(hand, 0.3);
    store.setState({ equity: { ...old, situation: { ...old.situation!, board: [] } } });
    expect(source.asked).toHaveLength(0);
    store.setState({ equity: finalEquity(hand, 0.55) });
    expect(source.asked).toHaveLength(1);
    expect(source.asked[0]?.eRandom).toBe(0.55);
  });

  it('a failure shows as failed; retry asks again', async () => {
    const store = createAppStore();
    const source = manualSource(false);
    jobs = new CoachJobs(store, source, observeHero);
    const hand = heroFacingBet();
    heroTurn(store, hand);
    source.answer(0, null);
    await flush();
    expect(selectCoach(store.getState()).state).toBe('failed');
    jobs.retry();
    expect(source.asked).toHaveLength(2);
    source.answer(1, DECISION);
    await flush();
    expect(selectCoach(store.getState()).state).toBe('ready');
  });

  it('fails at once when the HUD has no number to give the stand-in', async () => {
    const store = createAppStore();
    jobs = new CoachJobs(store, standInHints(), observeHero);
    const hand = heroFacingBet();
    store.setState({ equity: { ...initialEquity(), status: 'unavailable' } });
    heroTurn(store, hand);
    await flush();
    expect(selectCoach(store.getState()).state).toBe('failed');
  });

  it('drops an answer that comes after the decision is gone', async () => {
    const store = createAppStore();
    const source = manualSource(false);
    jobs = new CoachJobs(store, source, observeHero);
    const hand = heroFacingBet();
    heroTurn(store, hand);
    botTurn(store, hand); // the hero acted (or the hand moved on)
    source.answer(0, DECISION);
    await flush();
    expect(store.getState().coach.status).toBe('idle');
    expect(selectCoach(store.getState()).state).toBe('waiting');
  });

  it('the stand-in answers from the HUD number, end to end', async () => {
    const store = createAppStore();
    jobs = new CoachJobs(store, standInHints(), (h) => observeSpot(h, 0));
    const hand = heroFacingBet();
    heroTurn(store, hand);
    store.setState({ equity: finalEquity(hand, 0.5) });
    await flush();
    const data = selectCoach(store.getState());
    expect(data.state).toBe('ready');
    expect(data.decision?.action).toEqual({ type: 'call' });
    expect(data.decision?.eRandom).toBe(0.5);
  });

  it('stops after dispose', () => {
    const store = createAppStore();
    const source = manualSource(false);
    jobs = new CoachJobs(store, source, observeHero);
    jobs.dispose();
    heroTurn(store, heroFacingBet());
    expect(source.asked).toHaveLength(0);
  });
});

describe('hudWinChance', () => {
  it('reads only a final number for the current situation (or the estimate of a timeout)', () => {
    const hand = heroFacingBet();
    expect(hudWinChance(initialEquity(), hand)).toBeNull();
    expect(hudWinChance(finalEquity(hand, 0.4), hand)).toBe(0.4);
    const timedOut: EquitySlice = { ...finalEquity(hand, 0.4), status: 'timedOut' };
    expect(hudWinChance(timedOut, hand)).toBe(0.4);
    expect(hudWinChance({ ...timedOut, result: null }, hand)).toBe('unavailable');
    expect(hudWinChance({ ...initialEquity(), status: 'unavailable' }, hand)).toBe('unavailable');
    const computing: EquitySlice = { ...finalEquity(hand, 0.4), status: 'computing' };
    expect(hudWinChance(computing, hand)).toBeNull();
    // Another hand, another street or another number of opponents: not this situation.
    const other = finalEquity(hand, 0.4);
    expect(
      hudWinChance({ ...other, situation: { ...other.situation!, nOpp: 2 } }, hand),
    ).toBeNull();
    expect(
      hudWinChance({ ...other, situation: { ...other.situation!, handSeq: 99 } }, hand),
    ).toBeNull();
  });
});
