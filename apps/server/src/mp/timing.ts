/**
 * Every number of the table machine (PLAN §19.5) and the server's limits (§19.4; the limits a
 * client also needs are in `net/protocol.ts`). The only place they are written.
 */

/** Added to the first decision of a hand. */
export const DEAL_GRACE_MS = 1_500;
/** At most this long for a player who is offline. */
export const OFFLINE_TURN_MS = 15_000;
/** A player whose `timeouts` already stands at `TIMEOUTS_TO_SIT_OUT` (the rest of this hand). */
export const AWAY_TURN_MS = 3_000;
/** Before an `advance`. */
export const STREET_PAUSE_MS = 1_000;
/** Before each `advance` of an all-in run-out. */
export const RUNOUT_PAUSE_MS = 1_500;
/** Per shown hand, before the `advance` that settles a showdown. */
export const REVEAL_MS = 500;
/** From a hand won by folds to the next deal. */
export const HAND_END_FOLD_MS = 4_000;
/** From a showdown to the next deal. */
export const HAND_END_SHOWDOWN_MS = 7_000;
/** From "two can play again" to the next deal (started tables only). */
export const RESUME_MS = 3_000;
/** In a row. */
export const TIMEOUTS_TO_SIT_OUT = 2;
/** Offline this long and the seat empties at the next deal. */
export const SEAT_LOST_MS = 600_000;
/** Nobody online this long: the table ends. */
export const IDLE_NOBODY_MS = 300_000;
/** Status `waiting` this long: the table ends. */
export const IDLE_WAITING_MS = 1_800_000;
/** Voided hands in a row that end the table. */
export const VOIDED_HANDS_TO_END = 2;

// The limits of §19.4.

/** Tables open at once; more is `server_full`. */
export const MAX_ROOMS = 200;
/** `create` per user in `CREATE_WINDOW_MS`; more is `rate_limited`. */
export const CREATE_LIMIT = 5;
export const CREATE_WINDOW_MS = 600_000;
/** Failed `join` (`not_found`) per user in `FAILED_JOIN_WINDOW_MS`; more is `rate_limited`. */
export const FAILED_JOIN_LIMIT = 10;
export const FAILED_JOIN_WINDOW_MS = 300_000;
