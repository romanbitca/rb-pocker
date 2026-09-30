/**
 * The win chance and hand-analysis jobs (PLAN §2.3, §6, §7.4, §12.14): what the controller asks
 * `equity.worker`, when, and where the answers go: ONLY the store's `equity` slice (pitfall 37).
 * The controller calls `sync` whenever it publishes, and `setHidden` on visibility changes.
 *
 * Triggers (§7.4). Each job has a key: the HUD equity (hand, hero cards, board, live opponents),
 * the hand analysis (hand, hero cards, board), the run-out equities (hand, face-up seats, board).
 * A request goes out exactly when its key changes: new hole cards, a new street, a fold that
 * changes the live-opponent count, an all-in reveal (known-hands mode replaces the HUD job), and a
 * resumed hand (the first sync after boot). A bet changes no key. A new job cancels the old one.
 *
 * All-in (§7.6 TV mode and luck line, chunk 4.7): the engine turns the hands face up in the same
 * `advance` that deals the next street, so the street's run-out equities (`known`, the TV-mode
 * bars) are for the new board. One more job, `allIn`, computes them for the board as it was when
 * the hands turned face up, when the chips were in: the hero's number of the luck line at the
 * hand end ("You had 62% when the chips went in"). It runs only when the hero is one of the
 * face-up hands, and it stays wanted after the hand is complete, so a fast hand end does not
 * cancel it. The two `equityKnown` jobs run side by side in their own slots.
 *
 * ⚠️ Non-cheating (§2.2, §7.1, pitfall 13): the requests carry the hero's hole cards, the board and
 * the number of live opponents; `equityKnown` carries only the hands of seats in `hand.revealed`
 * (an all-in run-out, where they are public by rule). A folded player's cards are never sent:
 * they stay unknown, in the worker's pool (pitfall 14).
 *
 * Hidden page (§15.3, Stage 4 acceptance 5): every job is cancelled at once; jobs that did not
 * finish are sent again when the page is visible. A timeout or a failed job waits for the next
 * trigger (§12.14). A new epoch cancels the old jobs (pitfall 22); an unfinished one is sent again.
 */
import type { EquityResult, HandAnalysis } from '../analysis/types.ts';
import type { Card } from '../core/cards.ts';
import type { HandState } from '../engine/types.ts';
import type { EquityReply, EquityRequest } from '../workers/protocol.ts';
import { faceUpSeats } from './runoutViews.ts';
import type { AppStore, EquitySituation, EquitySlice, EquityStatus, KnownEquity } from './store.ts';
import { EQUITY_TIMEOUT_MS, type EquityClient, type JobEvent } from './workerClient.ts';

/** The hero's seat (§0.3). */
const HERO = 0;

type TrackName = 'equity' | 'handInfo' | 'known' | 'allIn';
const TRACKS: readonly TrackName[] = ['equity', 'handInfo', 'known', 'allIn'];

/** A job the current state asks for. */
interface Want {
  key: string;
  build(jobId: number, epoch: number): EquityRequest;
  /** equity: the situation; known, allIn: the seats and board. */
  situation?: EquitySituation;
  seats?: number[];
  board: Card[];
}

/**
 * The board when the hands of a run-out turned face up (the `reveal` event), before the cards
 * dealt in that same `advance`; null when the hand has no run-out reveal (yet).
 */
export function boardAtReveal(hand: HandState): Card[] | null {
  const board: Card[] = [];
  for (const e of hand.log) {
    if (e.e === 'reveal') return e.reason === 'runout' ? board : null;
    if (e.e === 'street') board.push(...e.cards);
  }
  return null;
}

/** `equityKnown` for the face-up `seats` on `board`: only revealed hands ever leave. */
function knownWant(hand: HandState, seats: number[], board: Card[], key: string): Want {
  return {
    key,
    seats,
    board,
    build: (jobId, epoch) => ({
      kind: 'equityKnown',
      jobId,
      epoch,
      hands: seats.map((seat) => {
        const h = hand.seats[seat]?.hole as [Card, Card];
        return [h[0], h[1]];
      }),
      board,
    }),
  };
}

/** The all-in job: the hero is face up in a run-out; the board as it was at the reveal. */
function allInWant(hand: HandState, faceUp: number[]): Want | null {
  if (faceUp.length < 2 || !faceUp.includes(HERO)) return null;
  const board = boardAtReveal(hand);
  if (board === null) return null;
  return knownWant(hand, faceUp, board, `${hand.handSeq}|${faceUp.join(',')}|${board.join(',')}`);
}

interface Track {
  want: Want | null;
  jobId: number | null;
  /**
   * idle: nothing wanted · waiting: wanted, not sent (hidden page, or its job was cancelled) ·
   * running · done: its final reply came · failed: timed out or failed; waits for a new key.
   */
  state: 'idle' | 'waiting' | 'running' | 'done' | 'failed';
}

const idle = (): Track => ({ want: null, jobId: null, state: 'idle' });

/** The jobs the hand asks for; null = none of that kind. */
function wants(hand: HandState | null): Record<TrackName, Want | null> {
  const none = { equity: null, handInfo: null, known: null, allIn: null };
  if (hand === null) return none;
  const hero = hand.seats[HERO];
  const hole = hero?.hole ?? null;
  if (hero === undefined || !hero.dealtIn || hole === null) return none;
  // Face-up hands exist only in a run-out; every seat taken here is in `hand.revealed`.
  const faceUp = faceUpSeats(hand);
  // The luck line needs the all-in number at the hand end: it outlives the hand's other jobs.
  const allIn = allInWant(hand, faceUp);
  if (hand.phase === 'complete') return { ...none, allIn };
  const heroCards: [Card, Card] = [hole[0], hole[1]];
  const board = [...hand.board];
  const nOpp = hand.seats.filter((s, i) => i !== HERO && s.dealtIn && !s.folded).length;
  const knownMode = faceUp.length >= 2;
  const cards = `${hand.handSeq}|${heroCards.join(',')}|${board.join(',')}`;
  const situation: EquitySituation = { handSeq: hand.handSeq, hero: heroCards, board, nOpp };
  return {
    equity:
      hero.folded || knownMode || nOpp < 1
        ? null
        : {
            key: `${cards}|${nOpp}`,
            situation,
            board,
            build: (jobId, epoch) => ({
              kind: 'equity',
              jobId,
              epoch,
              hero: heroCards,
              board,
              nOpp,
            }),
          },
    handInfo: hero.folded
      ? null
      : {
          key: cards,
          board,
          build: (jobId, epoch) => ({ kind: 'handInfo', jobId, epoch, hero: heroCards, board }),
        },
    known: !knownMode
      ? null
      : knownWant(hand, faceUp, board, `${hand.handSeq}|${faceUp.join(',')}|${board.join(',')}`),
    allIn,
  };
}

export class EquityJobs {
  private readonly store: AppStore;
  private readonly client: EquityClient;
  private epoch = 0;
  private hidden = false;
  private hand: HandState | null = null;
  private handSeq: number | null = null;
  private readonly tracks: Record<TrackName, Track> = {
    equity: idle(),
    handInfo: idle(),
    known: idle(),
    allIn: idle(),
  };
  private situation: EquitySituation | null = null;
  private result: EquityResult | null = null;
  private previous: EquitySlice['previous'] = null;
  private analysis: HandAnalysis | null = null;
  private known: KnownEquity | null = null;
  private allIn: KnownEquity | null = null;

  constructor(store: AppStore, client: EquityClient) {
    this.store = store;
    this.client = client;
  }

  /** The controller's state changed (called from its `publish`); null = no hand to compute. */
  sync(hand: HandState | null, epoch: number): void {
    if (epoch !== this.epoch) {
      this.epoch = epoch;
      this.client.setEpoch(epoch); // cancels the old epoch's jobs
      for (const t of Object.values(this.tracks)) {
        if (t.state === 'running') {
          t.state = 'waiting';
          t.jobId = null;
        }
      }
    }
    this.hand = hand;
    const handSeq = hand?.handSeq ?? null;
    if (handSeq !== this.handSeq) {
      this.handSeq = handSeq;
      this.previous = null;
      this.known = null;
      this.allIn = null;
    }
    const w = wants(hand);
    for (const name of TRACKS) this.apply(name, w[name]);
    this.write();
  }

  /** §12.13, §15.3: hidden cancels every job; visible sends the unfinished ones again. */
  setHidden(hidden: boolean): void {
    if (hidden === this.hidden) return;
    this.hidden = hidden;
    if (hidden) {
      this.client.cancelAll();
      for (const t of Object.values(this.tracks)) {
        if (t.state === 'running') {
          t.state = 'waiting';
          t.jobId = null;
        }
      }
    } else {
      for (const name of TRACKS) this.send(name);
    }
    this.write();
  }

  /** Cancels every job (the controller is disposed). */
  dispose(): void {
    for (const name of TRACKS) this.drop(name);
  }

  // -------------------------------------------------------------------------------------------

  private apply(name: TrackName, want: Want | null): void {
    const t = this.tracks[name];
    if (want === null) {
      if (t.want !== null) this.drop(name);
      return;
    }
    if (t.want?.key !== want.key) {
      this.drop(name);
      this.begin(name, want);
      t.want = want;
      t.state = 'waiting';
    }
    this.send(name);
  }

  /** A new key: the slice forgets what belonged to the old one. */
  private begin(name: TrackName, want: Want): void {
    if (name === 'equity') {
      const old = this.situation;
      const result = this.result;
      if (old !== null && result?.final === true && old.handSeq === want.situation?.handSeq) {
        this.previous = { equity: result.equity, nOpp: old.nOpp, board: old.board };
      }
      this.situation = want.situation ?? null;
      this.result = null;
    } else if (name === 'handInfo') {
      this.analysis = null;
    }
    // known: the previous street's equities stay until the new ones come (TV mode bars).
  }

  /** No job of this kind is wanted any more. */
  private drop(name: TrackName): void {
    const t = this.tracks[name];
    if (t.jobId !== null) this.client.cancel(t.jobId);
    t.want = null;
    t.jobId = null;
    t.state = 'idle';
    if (name === 'equity') {
      this.situation = null;
      this.result = null;
    } else if (name === 'handInfo') {
      this.analysis = null;
    }
  }

  private send(name: TrackName): void {
    const t = this.tracks[name];
    const want = t.want;
    if (want === null || t.state !== 'waiting' || this.hidden) return;
    let jobId: number | null = null;
    jobId = this.client.request({
      slot: name,
      epoch: this.epoch,
      timeoutMs: EQUITY_TIMEOUT_MS,
      build: (id) => want.build(id, this.epoch),
      onEvent: (event) => this.onEvent(name, jobId, want, event),
    });
    if (jobId === null) {
      t.state = 'failed'; // the worker is gone (§12.14)
      return;
    }
    t.jobId = jobId;
    t.state = 'running';
  }

  private onEvent(
    name: TrackName,
    jobId: number | null,
    want: Want,
    event: JobEvent<EquityReply>,
  ): void {
    const t = this.tracks[name];
    if (jobId === null || t.jobId !== jobId || t.want !== want) return;
    if (event.type !== 'reply' || event.reply.kind === 'error') {
      t.state = 'failed';
      t.jobId = null;
      this.write();
      return;
    }
    const reply = event.reply;
    if (reply.kind === 'equity') {
      this.result = reply.result;
    } else if (reply.kind === 'handInfo') {
      this.analysis = reply.analysis;
    } else if (reply.kind === 'equityKnown') {
      const known: KnownEquity = {
        handSeq: this.handSeq ?? 0,
        seats: want.seats ?? [],
        board: want.board,
        perPlayer: reply.perPlayer,
        exact: reply.exact,
        final: reply.final,
      };
      if (name === 'allIn') this.allIn = known;
      else this.known = known;
    }
    if (event.final) {
      t.state = 'done';
      t.jobId = null;
    }
    this.write();
  }

  private status(): EquityStatus {
    const hand = this.hand;
    const hero = hand?.seats[HERO];
    if (hand === null || hand.phase === 'complete' || hero === undefined) return 'off';
    if (!hero.dealtIn || hero.hole === null) return 'off';
    if (hero.folded) return 'folded';
    const t = this.tracks.known.want !== null ? this.tracks.known : this.tracks.equity;
    switch (t.state) {
      case 'idle':
        return 'off';
      case 'done':
        return 'done';
      case 'failed':
        return this.client.status === 'failed' ? 'unavailable' : 'timedOut';
      default:
        return 'computing';
    }
  }

  /** Writes the `equity` slice, and nothing else, when a field changed. */
  private write(): void {
    const next: EquitySlice = {
      status: this.status(),
      mode: this.tracks.known.want !== null ? 'known' : 'random',
      situation: this.situation,
      result: this.result,
      previous: this.previous,
      analysis: this.analysis,
      known: this.known,
      allIn: this.allIn,
    };
    const cur = this.store.getState().equity;
    const same = (Object.keys(next) as (keyof EquitySlice)[]).every((k) => cur[k] === next[k]);
    if (!same) this.store.setState({ equity: next });
  }
}
