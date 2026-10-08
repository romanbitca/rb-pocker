/**
 * The coach's hint jobs (PLAN §8.2, §10.2, §12.6): when the controller asks for a hint, and where
 * the answer goes: ONLY the store's `coach` slice (pitfall 37), keyed by the hero decision it is
 * for (`coachKeyOf`). The hint is asked at the start of every hero decision, at every level: the
 * Beginner strip shows it at once, Intermediate's "Hint" waits for it (§12.6 "disabled until
 * ready").
 *
 * - The source is a `HintSource`: the chunk 5.9 stand-in (`standInHints`, a pot-odds coach on
 *   the main thread) until chunk 5.7 sends `hint` jobs to `brain.worker` (A.6) through the same
 *   interface. The stand-in computes no win chance, so it waits for the HUD's number of this
 *   situation (`waitsForWinChance`); the real hint gets the final HUD value when the controller
 *   already has it, else null, and computes it itself (§8.2 `eRandom`).
 * - A reply for a decision that is no longer the hero's (an action, a new hand) is dropped; every
 *   answer is written under the key of its decision, and the UI compares keys.
 * - No write happens inside a store listener: answers land from promise callbacks (a failure
 *   found while syncing, too), so the store's listeners never nest.
 * - `retry()` (the strip's "Tap to try again", §12.11) asks again for the current decision.
 */
import { standInHint } from '../brain/hintStandIn.ts';
import type { Decision } from '../brain/types.ts';
import type { HandState, Observation } from '../engine/types.ts';
import { heroDecisionKey } from './coachViews.ts';
import type { AppState, AppStore, EquitySlice } from './store.ts';

/** Where hints come from (A.5 `hint(obs, eRandom)`; chunk 5.7: `brain.worker`). */
export interface HintSource {
  /** The source needs the HUD's win chance for the situation before it can answer. */
  readonly waitsForWinChance: boolean;
  /** The advice for `obs` (the hero's own observation, §4.8); rejects when there is none. */
  request(obs: Observation, eRandom: number | null): Promise<Decision>;
}

/** The chunk 5.9 stand-in (`brain/hintStandIn.ts`): answers at once from the HUD's number. */
export function standInHints(): HintSource {
  return {
    waitsForWinChance: true,
    request(obs: Observation, eRandom: number | null): Promise<Decision> {
      return Promise.resolve().then(() => {
        if (eRandom === null) throw new Error('the stand-in coach needs the win chance');
        return standInHint(obs, eRandom);
      });
    },
  };
}

/** Live opponents of the hero: dealt in and not folded (the HUD's `nOpp`, §7.2). */
function liveOpponents(hand: HandState): number {
  return hand.seats.filter((s, seat) => seat !== 0 && s.dealtIn && !s.folded).length;
}

/**
 * The HUD's win chance for the hand's current situation (§7.4: hand, board, live opponents):
 * the final number, or the last estimate of a job that timed out (the badge's "~"); null while it
 * is on its way. `unavailable` when the HUD will not have one (the worker failed, or timed out
 * before its first estimate).
 */
export function hudWinChance(equity: EquitySlice, hand: HandState): number | null | 'unavailable' {
  if (equity.status === 'unavailable') return 'unavailable';
  const sit = equity.situation;
  if (
    sit === null ||
    sit.handSeq !== hand.handSeq ||
    sit.board.length !== hand.board.length ||
    sit.nOpp !== liveOpponents(hand)
  ) {
    return null;
  }
  if (equity.status === 'done' && equity.result?.final === true) return equity.result.equity;
  if (equity.status === 'timedOut') return equity.result?.equity ?? 'unavailable';
  return null;
}

export class CoachJobs {
  private readonly store: AppStore;
  private readonly source: HintSource;
  /** The hero's observation of a hand (the controller's `observe(hand, 0, extras)`). */
  private readonly observeHero: (hand: HandState) => Observation;
  /** The decision asked about last (its key), so each decision is asked once. */
  private asked: string | null = null;
  private disposed = false;
  private readonly unsubscribe: () => void;

  constructor(store: AppStore, source: HintSource, observeHero: (hand: HandState) => Observation) {
    this.store = store;
    this.source = source;
    this.observeHero = observeHero;
    this.unsubscribe = store.subscribe((s, prev) => {
      if (s.game !== prev.game || s.equity !== prev.equity) this.sync(s);
    });
  }

  /** Asks for the hero's current decision when it has not been asked yet (and can be). */
  sync(s: AppState = this.store.getState()): void {
    if (this.disposed) return;
    const hand = s.game.hand;
    const key = heroDecisionKey(s.game.mode, hand, s.game.legal);
    if (key === null || hand === null) {
      this.asked = null;
      return;
    }
    if (key === this.asked) return;
    const hud = hudWinChance(s.equity, hand);
    if (hud === 'unavailable' && this.source.waitsForWinChance) {
      this.asked = key;
      void Promise.resolve().then(() => this.land(key, null));
      return;
    }
    const eRandom = typeof hud === 'number' ? hud : null;
    if (eRandom === null && this.source.waitsForWinChance) return; // until the HUD has it
    this.asked = key;
    let obs: Observation;
    try {
      obs = this.observeHero(hand);
    } catch {
      void Promise.resolve().then(() => this.land(key, null));
      return;
    }
    this.source.request(obs, eRandom).then(
      (decision) => this.land(key, decision),
      () => this.land(key, null),
    );
  }

  /** "Tap to try again" (§12.11): forget the failure and ask again. */
  retry(): void {
    this.asked = null;
    this.sync();
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
  }

  /**
   * Writes an answer (or a failure, `null`) under the key of the decision it is for, while that is
   * still the hero's decision: a late answer is dropped, so it never replaces a newer one.
   */
  private land(key: string, decision: Decision | null): void {
    if (this.disposed) return;
    const s = this.store.getState();
    if (heroDecisionKey(s.game.mode, s.game.hand, s.game.legal) !== key) return;
    const coach = s.coach;
    this.store.setState({
      coach: {
        ...coach,
        key,
        status: decision === null ? 'failed' : 'ready',
        decision,
      },
    });
  }
}
