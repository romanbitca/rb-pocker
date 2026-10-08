/**
 * The coach's hint jobs (PLAN §8.2 `eRandom`, §8.11, §10.2, §12.6, Appendix A.6; chunk 5.7): at
 * the start of every hero decision the controller asks `brain.worker` for `hint(obs, eRandom)`,
 * whatever the coach level (the level changes only what is shown, C4), and the answer goes to ONLY
 * the store's `coach` slice (pitfall 37), under the key of the decision it is for.
 *
 * - One job at a time, in the brain client's slot `hint`, with the controller's epoch and a 4 s
 *   timeout (`HINT_TIMEOUT_MS`). A new decision, an action of the hero and a new epoch (new hand,
 *   voided hand, new table, an undo in Stage 6) cancel the job in flight; a reply for a decision
 *   that is no longer asked about is dropped, so a late hint never shows on another decision.
 * - `eRandom` is the HUD's final win chance for the hero's situation when the equity slice already
 *   has it, else null: the worker then computes it with the identical deterministic function, so
 *   the coach's numbers and the HUD agree (C9).
 * - A timeout, an `error` reply, a crashed worker or a brain client that has failed for good mark
 *   the decision 'failed' (§12.11 "Coach is not available. Tap to try again."; `retry()` asks
 *   again). Hints never count toward the bots' fallbacks.
 * - ⚠️ Non-cheating (§9.6, pitfall 13): the request carries the hero's own observation (built by
 *   `observe()`), never a `HandState` or another seat's hidden cards.
 */
import type { CoachHint } from '../brain/decide.ts';
import type { HandState, Observation } from '../engine/types.ts';
import type { BrainReply, BrainRequest } from '../workers/protocol.ts';
import type { AppStore, EquitySlice } from './store.ts';
import type { BrainClient, JobEvent } from './workerClient.ts';

/** A hint that has not come back in 4 s fails (the strip offers "Tap to try again", §12.11). */
export const HINT_TIMEOUT_MS = 4000;

/** The hero's seat (§0.3). */
const HERO = 0;

/** One hero decision: the hand, and how far its log has gone (an action or a street moves it). */
export function coachKeyOf(hand: HandState): string {
  return `${hand.handSeq}:${hand.log.length}`;
}

/** Live opponents of the hero: dealt in and not folded (the HUD's `nOpp`, §7.2). */
function liveOpponents(hand: HandState): number {
  return hand.seats.filter((s, seat) => seat !== HERO && s.dealtIn && !s.folded).length;
}

/**
 * The HUD's final win chance for the hand's current situation (hand, board, live opponents), or
 * null while it is on its way (or when the HUD has only an estimate): §8.2 passes only a final
 * value the main thread already has.
 */
export function finalHudEquity(equity: EquitySlice, hand: HandState): number | null {
  const sit = equity.situation;
  if (
    equity.status !== 'done' ||
    equity.result?.final !== true ||
    equity.mode !== 'random' ||
    sit === null ||
    sit.handSeq !== hand.handSeq ||
    sit.board.length !== hand.board.length ||
    sit.nOpp !== liveOpponents(hand)
  ) {
    return null;
  }
  return equity.result.equity;
}

/** What the controller hands over for one hero decision. */
export interface HintAsk {
  key: string;
  epoch: number;
  /** The hero's observation and the HUD's final number (or null), built only when asked. */
  build(): { obs: Observation; eRandom: number | null };
}

export class HintJobs {
  private readonly store: AppStore;
  private readonly brain: BrainClient;
  /** The decision asked about last (its key); null when it is not the hero's turn. */
  private asked: HintAsk | null = null;
  private jobId: number | null = null;

  constructor(store: AppStore, brain: BrainClient) {
    this.store = store;
    this.brain = brain;
  }

  /**
   * The hero's current decision (`null`: it is not the hero's turn). A new decision cancels the
   * job in flight and asks for its hint; the same decision again does nothing.
   */
  sync(ask: HintAsk | null): void {
    if (ask !== null && this.asked !== null && ask.key === this.asked.key) {
      if (ask.epoch === this.asked.epoch) return;
    }
    this.cancel();
    if (ask === null) return;
    this.asked = ask;
    this.send(ask);
  }

  /** "Tap to try again" (§12.11): asks again for the current decision. */
  retry(): void {
    const ask = this.asked;
    if (ask === null) return;
    this.cancelJob();
    this.send(ask);
  }

  /** Cancels the job in flight and forgets the decision (a new epoch, the hero acted). */
  cancel(): void {
    this.cancelJob();
    this.asked = null;
  }

  private cancelJob(): void {
    if (this.jobId !== null) this.brain.cancel(this.jobId);
    this.jobId = null;
  }

  private send(ask: HintAsk): void {
    let request: { obs: Observation; eRandom: number | null };
    try {
      request = ask.build();
    } catch {
      this.land(ask, null);
      return;
    }
    const { obs, eRandom } = request;
    const jobId = this.brain.request({
      slot: 'hint',
      epoch: ask.epoch,
      timeoutMs: HINT_TIMEOUT_MS,
      build: (id): BrainRequest => ({ kind: 'hint', jobId: id, epoch: ask.epoch, obs, eRandom }),
      onEvent: (event) => this.onEvent(ask, jobId, event),
    });
    this.jobId = jobId;
    // The brain client has failed for good (or refused an old epoch): no coach for now.
    if (jobId === null) this.land(ask, null);
  }

  private onEvent(ask: HintAsk, jobId: number | null, event: JobEvent<BrainReply>): void {
    if (this.jobId === jobId) this.jobId = null;
    const answer =
      event.type === 'reply' && event.reply.kind === 'hint'
        ? { decision: event.reply.decision, explanation: event.reply.explanation }
        : null;
    this.land(ask, answer);
  }

  /** Writes the answer (null: failed) while its decision is still the one asked about. */
  private land(ask: HintAsk, answer: CoachHint | null): void {
    if (this.asked !== ask) return;
    const coach = this.store.getState().coach;
    this.store.setState({
      coach: {
        ...coach,
        key: ask.key,
        status: answer === null ? 'failed' : 'ready',
        decision: answer?.decision ?? null,
        explanation: answer?.explanation ?? null,
      },
    });
  }
}
