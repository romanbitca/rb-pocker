import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Checks the `initData` string a Mini App sends (PLAN §19.2, §19.9). Identity comes only from here.
 *
 * Pure: it never throws, never logs, and what it returns holds neither the token nor the string it
 * was given. A refusal says only which rule failed.
 */

/** How far `auth_date` may be behind the server's clock (§19.9). */
export const INIT_DATA_MAX_AGE_SECONDS = 24 * 60 * 60;
/** How far `auth_date` may be ahead of the server's clock (§19.9). */
export const INIT_DATA_MAX_AHEAD_SECONDS = 5 * 60;

/** What a good `initData` says about who is playing. Nothing else in it is read (§19.9, Names). */
export interface InitDataUser {
  readonly id: number;
  readonly firstName: string;
}

export type InitDataRefusal =
  /** Not a string Telegram would send: a duplicate key, no `hash`, no usable `auth_date`. */
  | 'malformed'
  /** The signature does not match: a wrong token or a changed field. */
  | 'bad_hash'
  /** `auth_date` is more than 24 hours old. */
  | 'expired'
  /** `auth_date` is more than 5 minutes ahead of the server's clock. */
  | 'ahead'
  /** No `user`, or one without a safe-integer `id` and a string `first_name`. */
  | 'no_user';

export type InitDataResult =
  | { readonly ok: true; readonly user: InitDataUser }
  | { readonly ok: false; readonly reason: InitDataRefusal };

/** A SHA-256 digest as Telegram writes it. `Buffer.from(x, 'hex')` would silently cut anything else short. */
const HASH_RE = /^[0-9a-f]{64}$/;
/** Whole seconds; 15 digits is always a safe integer and is 31 million years from 1970. */
const AUTH_DATE_RE = /^\d{1,15}$/;

const refused = (reason: InitDataRefusal): InitDataResult => ({ ok: false, reason });

/** Every field as received, or null when a key comes twice. */
function parseFields(raw: string): Map<string, string> | null {
  const fields = new Map<string, string>();
  for (const [key, value] of new URLSearchParams(raw)) {
    if (fields.has(key)) return null;
    fields.set(key, value);
  }
  return fields;
}

/**
 * Every received field except `hash`, sorted by key, `key=value`, joined with a line feed. `signature`
 * (Ed25519, for third parties) is a received field, so it stays in (§19.2).
 */
function checkString(fields: ReadonlyMap<string, string>): string {
  return [...fields]
    .filter(([key]) => key !== 'hash')
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

function signatureMatches(fields: ReadonlyMap<string, string>, hash: string, token: string) {
  const secretKey = createHmac('sha256', 'WebAppData').update(token).digest();
  const expected = createHmac('sha256', secretKey).update(checkString(fields)).digest();
  return timingSafeEqual(Buffer.from(hash, 'hex'), expected);
}

function parseUser(value: string | undefined): InitDataUser | null {
  if (value === undefined) return null;
  let user: unknown;
  try {
    user = JSON.parse(value);
  } catch {
    return null; // Not rethrown: JSON.parse's message quotes the text it could not read.
  }
  if (typeof user !== 'object' || user === null) return null;
  const { id, first_name: firstName } = user as { id?: unknown; first_name?: unknown };
  if (typeof id !== 'number' || !Number.isSafeInteger(id)) return null;
  if (typeof firstName !== 'string') return null;
  return { id, firstName };
}

/**
 * Whether `raw` is an `initData` Telegram signed for this bot, recently, for a user. The signature is
 * checked first: nothing in the string is believed before it passes. `token` is empty only when
 * Telegram is off, and then nothing passes: an empty key would let anyone sign.
 */
export function checkInitData(raw: string, token: string, nowSeconds: number): InitDataResult {
  if (token.length === 0) return refused('bad_hash');

  const fields = parseFields(raw);
  if (fields === null) return refused('malformed');
  const hash = fields.get('hash');
  if (hash === undefined || !HASH_RE.test(hash)) return refused('malformed');
  if (!signatureMatches(fields, hash, token)) return refused('bad_hash');

  const authDate = fields.get('auth_date');
  if (authDate === undefined || !AUTH_DATE_RE.test(authDate)) return refused('malformed');
  const age = nowSeconds - Number(authDate);
  if (age > INIT_DATA_MAX_AGE_SECONDS) return refused('expired');
  if (-age > INIT_DATA_MAX_AHEAD_SECONDS) return refused('ahead');

  const user = parseUser(fields.get('user'));
  return user === null ? refused('no_user') : { ok: true, user };
}
