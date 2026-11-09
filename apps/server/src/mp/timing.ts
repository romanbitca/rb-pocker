/**
 * Every number of the table machine (PLAN §19.5) and the server's limits (§19.4; the limits a
 * client also needs are in `net/protocol.ts`). The only place they are written.
 */

/** Added to the first decision of a hand. */
export const DEAL_GRACE_MS = 1_500;
/** At most this long for a player who is offline. The client's strip needs it too (§19.10). */
export { OFFLINE_TURN_MS } from '../game/net/protocol.js';
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

/** After the socket opens; no `hello` by then cuts it off (4004). */
export const HELLO_DEADLINE_MS = 3_000;
/** Sockets per client address that have not said `hello` yet; one more upgrade is refused with 503. */
export const MAX_ANONYMOUS_PER_IP = 16;
/** Good `hello`s per user in `HELLO_WINDOW_MS`; more is `rate_limited`, 4008. */
export const HELLO_LIMIT = 12;
export const HELLO_WINDOW_MS = 60_000;
/** No message in this long closes the socket 4009 (the client pings every 20 s). */
export const SILENT_SOCKET_MS = 45_000;
/** Messages per socket: a token bucket. */
export const TOKEN_BUCKET_SIZE = 20;
export const TOKEN_BUCKET_REFILL_PER_S = 5;
/** Messages dropped by the bucket that close the socket 4008. */
export const MAX_DROPS = 50;
/** Undecodable messages on one socket that close it 4005. */
export const MAX_BAD_MESSAGES = 3;
/** `ws.bufferedAmount` over this closes the socket 1008. */
export const MAX_OUTBOUND_BYTES = 262_144;
/** Open sockets; one more upgrade is refused with 503. */
export const MAX_SOCKETS = 1_000;
/** How long the clients get to answer the close of a shutdown before they are cut off. */
export const SHUTDOWN_GRACE_MS = 2_000;

/** Tables open at once; more is `server_full`. */
export const MAX_ROOMS = 200;
/** `create` per user in `CREATE_WINDOW_MS`; more is `rate_limited`. */
export const CREATE_LIMIT = 5;
export const CREATE_WINDOW_MS = 600_000;
/** Failed `join` (`not_found`) per user in `FAILED_JOIN_WINDOW_MS`; more is `rate_limited`. */
export const FAILED_JOIN_LIMIT = 10;
export const FAILED_JOIN_WINDOW_MS = 300_000;
