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
