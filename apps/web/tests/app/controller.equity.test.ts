/**
 * The controller's equity jobs (PLAN §7.4, §2.2, §12.14, §15.3; Stage 4 acceptance 2, 4, 5):
 * what goes to `equity.worker` and when, what comes back into the store's `equity` slice, and
 * nothing else. A fake worker runs the real job runner (`equityService.ts`) with fast fake maths
 * (the real maths is tested in tests/analysis and tests/workers).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EquityResult, HandAnalysis } from '../../src/analysis/types.ts';
import { HERO, realTimers } from '../../src/app/controller.ts';
import type { AppState } from '../../src/app/store.ts';
import {
  createEquityClient,
  EQUITY_TIMEOUT_MS,
  type EquityClient,
} from '../../src/app/workerClient.ts';
import type { Card } from '../../src/core/cards.ts';
import { deriveSeed } from '../../src/core/rng.ts';
import type { HandState, LegalActions, PlayerAction } from '../../src/engine/types.ts';
import type { EquityMath } from '../../src/workers/equityService.ts';
import type { EquityRequest } from '../../src/workers/protocol.ts';
import { fakeWorker, type FakeWorker } from '../workers/fakeWorker.ts';
import {
  drive,
  elapse,
  flush,
  heroPolicy,
  makeHarness,
  SEED,
  tick,
  type Harness,
} from './harness.ts';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const ANALYSIS: HandAnalysis = {
  draws: [],
  outs: [],
  nextCardPct: null,
  byRiverPct: null,
  chances: null,
  beaters: null,
  nuts: false,
};

const res = (n: number, equity: number, final: boolean): EquityResult => ({
  n,
  win: equity,
  split: 0,
  equity,
  exact: false,
  final,
  truncated: false,
});

/** Fast, deterministic stand-in maths: a checkpoint, the 2,500 mark, the final. */
const fastMath: EquityMath = {
  *equitySteps(hero, board, nOpp) {
    const e = ((hero[0] ?? 0) + (hero[1] ?? 0) + 7 * board.length + 13 * nOpp) / 200;
    yield null;
    yield res(2_500, e, false);
    yield res(20_000, e, true);
  },
  *runoutSteps(hands) {
    yield hands.map(() => res(990, 1 / hands.length, true));
  },
  handInfo: () => ANALYSIS,
};

interface Rig {
  h: Harness;
  fake: FakeWorker;
  client: EquityClient;
}

/** A harness whose equity client talks to a fake worker (service mode unless `manual`). */
function rig(
  options: {
    manual?: boolean;
    players?: number;
    seed?: string;
    onReceive?: (msg: EquityRequest, h: Harness) => void;
  } = {},
): Rig {
  let harness: Harness | null = null;
  const fake = fakeWorker({
    ...(options.manual !== true && { math: fastMath, service: { now: () => 0 } }),
    onReceive: (msg) => {
      if (harness !== null) options.onReceive?.(msg, harness);
    },
  });
  const client = createEquityClient(fake.spawn, realTimers);
  harness = makeHarness({
    equity: client,
    ...(options.seed !== undefined && { seed: options.seed }),
    ...(options.players !== undefined && { settings: { players: options.players } }),
  });
  return { h: harness, fake, client };
}

const passive = (legal: LegalActions): PlayerAction =>
  legal.canCheck ? { type: 'check' } : { type: 'call' };

/** Jams every decision: the all-in reveals (known hands) come often. */
const jam = (legal: LegalActions): PlayerAction => {
  if (legal.raise !== null) return { type: 'raise', to: legal.raise.max };
  if (legal.bet !== null) return { type: 'bet', to: legal.bet.max };
  return passive(legal);
};

async function toHeroTurn(h: Harness): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (h.state().game.mode === 'heroTurn') return;
    await tick();
  }
  throw new Error('no hero turn');
}

const liveOpponents = (hand: HandState): number =>
  hand.seats.filter((s, i) => i !== HERO && s.dealtIn && !s.folded).length;

const requestsOf = <K extends EquityRequest['kind']>(
  fake: FakeWorker,
  kind: K,
): Extract<EquityRequest, { kind: K }>[] =>
  fake.received.filter((m): m is Extract<EquityRequest, { kind: K }> => m.kind === kind);

describe('what goes to equity.worker (§7.4)', () => {
  it('a new hand asks for the win chance and the hand analysis; the slice fills in', async () => {
    const { h, fake } = rig();
    const statuses: string[] = [];
    h.store.subscribe((s, prev) => {
      if (s.equity !== prev.equity)
        statuses.push(`${s.equity.status}:${s.equity.result?.n ?? '-'}`);
    });
    h.dispatch({ type: 'play' });
    const hand = h.state().game.hand as HandState;
    const hole = hand.seats[HERO]?.hole as [Card, Card];
    const epoch = h.controller.snapshot().epoch;
    expect(fake.received.slice(0, 2)).toEqual([
      { kind: 'equity', jobId: 1, epoch, hero: hole, board: [], nOpp: 5 },
      { kind: 'handInfo', jobId: 2, epoch, hero: hole, board: [] },
    ]);
    await flush();
    const eq = h.state().equity;
    expect(eq.status).toBe('done');
    expect(eq.mode).toBe('random');
    expect(eq.situation).toEqual({ handSeq: hand.handSeq, hero: hole, board: [], nOpp: 5 });
    expect(eq.result).toMatchObject({ n: 20_000, final: true });
    expect(eq.analysis).toEqual(ANALYSIS);
    // The skeleton first, then "~" progress, then the final number.
    expect(statuses.slice(0, 3)).toEqual(['computing:-', 'computing:2500', 'done:20000']);
  });

  it('asks again exactly when the cards or the live-opponent count change; a bet changes nothing', async () => {
    const asked: string[] = [];
    const { h, fake } = rig({
      onReceive: (msg, harness) => {
        if (msg.kind !== 'equity') return;
        // The request matches the hand the controller holds at that moment.
        const hand = harness.controller.snapshot().hand as HandState;
        expect(msg.nOpp).toBe(liveOpponents(hand));
        expect(msg.board).toEqual(hand.board);
        expect(msg.hero).toEqual(hand.seats[HERO]?.hole);
        asked.push(`${hand.handSeq}|${msg.board.join(',')}|${msg.nOpp}`);
      },
    });
    // Every situation the controller published while the hero was in the hand.
    const wanted = new Set<string>();
    let states = 0;
    h.store.subscribe((s, prev) => {
      const hand = s.game.hand;
      if (hand === prev.game.hand || hand === null) return;
      states++;
      const hero = hand.seats[HERO];
      if (hero === undefined || hand.phase === 'complete' || hero.folded) return;
      if (hand.runout && hand.revealed.length >= 2) return; // known-hands mode
      if (liveOpponents(hand) === 0) return; // won by folds: nobody to beat
      wanted.add(`${hand.handSeq}|${hand.board.join(',')}|${liveOpponents(hand)}`);
    });
    h.dispatch({ type: 'play' });
    await drive(h, { hands: 15, hero: heroPolicy(SEED) });
    // Each situation is asked once (bets and checks ask nothing), and every one is asked.
    expect(new Set(asked).size).toBe(asked.length);
    expect(new Set(asked)).toEqual(wanted);
    expect(states).toBeGreaterThan(3 * asked.length);
    // Folds changed the count while the hero was still in.
    expect(requestsOf(fake, 'equity').some((m) => m.nOpp < 5)).toBe(true);
    expect(requestsOf(fake, 'equity').some((m) => m.board.length > 0)).toBe(true);
  });
});

describe('the non-cheating rule (§2.2, pitfall 13; acceptance 4)', () => {
  it('no request ever contains an unrevealed bot card; folded cards are never sent', async () => {
    let checked = 0;
    let knownRequests = 0;
    const onReceive = (msg: EquityRequest, h: Harness): void => {
      const hand = h.controller.snapshot().hand as HandState;
      const cards: Card[] =
        msg.kind === 'equity' || msg.kind === 'handInfo'
          ? [...msg.hero, ...msg.board]
          : msg.kind === 'equityKnown'
            ? [...msg.hands.flat(), ...msg.board]
            : [];
      const visible = new Set<Card>([...(hand.seats[HERO]?.hole ?? []), ...hand.board]);
      for (const seat of hand.revealed)
        for (const c of hand.seats[seat]?.hole ?? []) visible.add(c);
      for (const c of cards) expect(visible.has(c)).toBe(true);
      hand.seats.forEach((s, seat) => {
        if (seat === HERO || hand.revealed.includes(seat)) return;
        for (const c of s.hole ?? []) expect(cards).not.toContain(c);
      });
      // Only these fields: nothing else (no dead or folded cards) ever reaches the worker.
      if (msg.kind === 'equity') {
        expect(Object.keys(msg).sort()).toEqual([
          'board',
          'epoch',
          'hero',
          'jobId',
          'kind',
          'nOpp',
        ]);
      }
      if (msg.kind === 'equityKnown') {
        knownRequests++;
        const faceUp = hand.revealed.filter((seat) => hand.seats[seat]?.folded === false);
        expect(msg.hands).toEqual(faceUp.map((seat) => hand.seats[seat]?.hole));
      }
      checked++;
    };
    for (const [players, policy, n] of [
      [2, 'jam', 12],
      [6, 'random', 15],
      [9, 'jam', 10],
      [4, 'random', 15],
    ] as const) {
      const seed = deriveSeed(SEED, `equity-spy-${players}-${policy}`);
      const { h } = rig({ players, seed, onReceive });
      h.dispatch({ type: 'play' });
      await drive(h, { hands: n, hero: policy === 'jam' ? jam : heroPolicy(seed) });
    }
    expect(checked).toBeGreaterThan(200);
    expect(knownRequests).toBeGreaterThan(0);
  }, 30_000);

  it('an all-in reveal switches to the face-up hands (known-hands mode)', async () => {
    const seen: AppState['equity'][] = [];
    const { h, fake } = rig({ players: 2, seed: deriveSeed(SEED, 'known') });
    h.store.subscribe((s) => {
      if (s.equity.mode === 'known') seen.push(s.equity);
    });
    h.dispatch({ type: 'play' });
    await drive(h, { hands: 10, hero: jam });
    const known = requestsOf(fake, 'equityKnown');
    expect(known.length).toBeGreaterThan(0);
    const done = seen.filter((e) => e.known?.final === true);
    expect(done.length).toBeGreaterThan(0);
    for (const e of done) {
      expect(e.known?.seats).toHaveLength(2);
      expect(e.known?.perPlayer).toEqual([0.5, 0.5]);
    }
  }, 20_000);
});

describe('the store (pitfall 37)', () => {
  it('equity progress writes only the equity slice', async () => {
    const { h } = rig();
    let equityWrites = 0;
    let progress = 0;
    h.store.subscribe((s, prev) => {
      if (s.equity === prev.equity) return;
      equityWrites++;
      if (s.equity.result !== null && !s.equity.result.final) progress++;
      expect(s.game).toBe(prev.game);
      expect(s.ui).toBe(prev.ui);
      expect(s.coach).toBe(prev.coach);
      expect(s.settings).toBe(prev.settings);
      expect(s.dispatch).toBe(prev.dispatch);
    });
    h.dispatch({ type: 'play' });
    await drive(h, { hands: 5, hero: passive });
    expect(equityWrites).toBeGreaterThan(20);
    expect(progress).toBeGreaterThan(5);
  });

  it('nothing is written when nothing changed', async () => {
    const { h } = rig();
    h.dispatch({ type: 'play' });
    await toHeroTurn(h);
    const before = h.state().equity;
    h.dispatch({ type: 'go', screen: 'home' });
    h.dispatch({ type: 'go', screen: 'table' });
    expect(h.state().equity).toBe(before);
  });
});

describe('hidden page (§15.3, acceptance 5)', () => {
  it('cancels every job at once (message log) and sends the unfinished ones again when visible', async () => {
    const { h, fake, client } = rig({ manual: true });
    h.dispatch({ type: 'play' });
    await toHeroTurn(h);
    const pending = client.pending();
    expect(pending.length).toBe(2); // equity + handInfo, no replies in manual mode
    const sent = fake.received.length;
    h.dispatch({ type: 'visibility', hidden: true });
    expect(client.pending()).toEqual([]);
    const cancels = fake.received.slice(sent);
    expect(cancels).toEqual(pending.map((jobId) => ({ kind: 'cancel', jobId })));
    const log = h.controller.logs().equity;
    for (const jobId of pending) {
      expect(log).toContainEqual(expect.objectContaining({ what: 'out', kind: 'cancel', jobId }));
    }
    expect(h.state().equity.status).toBe('computing');

    // The hero acts while hidden: nothing is sent.
    h.dispatch({ type: 'act', action: passive(h.state().game.legal as LegalActions) });
    await flush();
    expect(fake.received.length).toBe(sent + pending.length);
    // No timeout fires for cancelled jobs.
    vi.advanceTimersByTime(EQUITY_TIMEOUT_MS * 2);
    expect(h.controller.logs().equity.some((e) => e.what === 'timeout')).toBe(false);

    h.dispatch({ type: 'visibility', hidden: false });
    await elapse(300);
    const again = fake.received.slice(sent + pending.length);
    expect(again.length).toBeGreaterThan(0);
    expect(again.every((m) => m.kind !== 'cancel')).toBe(true);
  });
});

describe('failures (§12.14, acceptance 2)', () => {
  it('a timeout keeps "—" (no estimate) and waits for the next trigger; the worker fails for good after its restart', async () => {
    const { h, fake, client } = rig({ manual: true });
    h.dispatch({ type: 'play' });
    await toHeroTurn(h);
    const sent = fake.received.length;
    await elapse(EQUITY_TIMEOUT_MS);
    expect(h.state().equity.status).toBe('timedOut');
    expect(h.state().equity.result).toBeNull();
    // equity + handInfo timed out together: 2 in a row, so the worker was restarted once.
    expect(client.restartCount).toBe(1);
    expect(fake.instances).toHaveLength(2);
    // No retry of the same situation (§12.14: recompute on the next trigger).
    await elapse(EQUITY_TIMEOUT_MS);
    expect(fake.received.filter((m) => m.kind !== 'cancel').length).toBe(
      fake.received.slice(0, sent).filter((m) => m.kind !== 'cancel').length,
    );
    // The next hand is a new trigger; its jobs time out too: the worker is given up.
    const legal = h.state().game.legal as LegalActions;
    h.dispatch({ type: 'act', action: legal.canCheck ? { type: 'check' } : { type: 'fold' } });
    for (let i = 0; i < 400 && client.status !== 'failed'; i++) await tick();
    expect(client.status).toBe('failed');
    for (let i = 0; i < 400 && h.state().game.mode !== 'heroTurn'; i++) await tick();
    expect(h.state().game.mode).toBe('heroTurn');
    expect(h.state().equity.status).toBe('unavailable');
  }, 20_000);

  it('a stale reply after a new hand (epoch change) is never shown', async () => {
    const { h, fake } = rig({ manual: true });
    h.dispatch({ type: 'play' });
    await toHeroTurn(h);
    const old = requestsOf(fake, 'equity').at(-1) as Extract<EquityRequest, { kind: 'equity' }>;
    const legal = h.state().game.legal as LegalActions;
    h.dispatch({ type: 'act', action: legal.canCheck ? { type: 'check' } : { type: 'fold' } });
    const firstHand = h.state().game.hand?.handSeq;
    for (let i = 0; i < 400 && h.state().game.hand?.handSeq === firstHand; i++) await tick();
    expect(h.controller.snapshot().epoch).toBeGreaterThan(old.epoch);
    const before = h.state().equity;
    fake.current().reply({
      kind: 'equity',
      jobId: old.jobId,
      epoch: old.epoch,
      result: res(40_000, 0.99, true),
    });
    await flush();
    expect(h.state().equity).toBe(before);
    expect(h.controller.logs().equity.at(-1)).toMatchObject({ what: 'drop', jobId: old.jobId });
  }, 20_000);
});
