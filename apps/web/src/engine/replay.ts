/**
 * `replay(record)` — PLAN §4.7: rebuilds a hand from nothing but its seed, its starting table and
 * the inputs it received: `replay(r) = r.inputs.reduce(step, startHand(r.table, r.seed))`. Bot
 * actions are recorded as ordinary inputs (§2.2), so a replay never depends on bot code, and never
 * on anything hidden: everything it needs is already public in `r` (the table and the inputs) or
 * reconstructed deterministically from `r.seed` (the deck, §2.4).
 *
 * `record.engineVersion` and `record.commit` are metadata for the caller (Review, §12.10: a stored
 * record whose `engineVersion` major differs from the running engine shows its stored summary
 * instead of replaying); `replay` itself does not need them.
 */
import { startHand } from './start.ts';
import { step } from './step.ts';
import type { HandState, ReplayRecord } from './types.ts';

export function replay(record: ReplayRecord): HandState {
  return record.inputs.reduce<HandState>(
    (h, input) => step(h, input),
    startHand(record.table, record.seed),
  );
}

/**
 * Every state of the hand, for Review (PLAN §12.10): `states[0]` is the deal (hole cards dealt,
 * blinds posted), `states[i]` the state after input `i - 1`, so there are `inputs.length + 1` of
 * them, and the last one is `replay(record)`. It is `replay` of every prefix of the inputs, in one
 * pass. Like `replay`, it throws `EngineError` for an input the engine refuses. ⚠️ The states hold
 * the deck and every hole card: they are for building views (`app/reviewViews.ts`), never for the UI.
 */
export function replayStates(record: ReplayRecord): HandState[] {
  const states = [startHand(record.table, record.seed)];
  for (const input of record.inputs) {
    states.push(step(states[states.length - 1] as HandState, input));
  }
  return states;
}
