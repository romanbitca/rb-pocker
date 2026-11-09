import { createHmac } from 'node:crypto';

/**
 * Signs `initData` the way Telegram does (PLAN §19.2), so tests need no backdoor (§19.1 decision 4).
 * Its own code on purpose: it imports nothing from `src/telegram`, so a mistake in the server's check
 * cannot hide behind the same mistake here.
 */

/** Not a real bot's token. The shape BotFather gives: digits, a colon, then the secret. */
export const TEST_BOT_TOKEN = '1234567890:TEST-only-not-a-real-bot-token_abcdef';

/** Sorted, `key=value`, joined with a line feed; every field goes in (the caller adds no `hash`). */
function hashOf(fields: Readonly<Record<string, string>>, token: string): string {
  const checkString = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key] ?? ''}`)
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(token).digest();
  return createHmac('sha256', secretKey).update(checkString).digest('hex');
}

/** Percent-encoded as Telegram sends it (`%20` for a space, not `+`). */
function serialize(fields: Readonly<Record<string, string>>): string {
  return Object.entries(fields)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
}

/** A correctly signed `initData` holding exactly `fields` and their `hash`. */
export function signFields(
  fields: Readonly<Record<string, string>>,
  token: string = TEST_BOT_TOKEN,
): string {
  return serialize({ ...fields, hash: hashOf(fields, token) });
}

export interface InitDataOptions {
  /** `user` as Telegram's JSON has it. Default: id 42, first name "Ann". `null` leaves the field out. */
  readonly user?: Readonly<Record<string, unknown>> | null;
  /** Seconds. */
  readonly authDate: number;
  /** More fields (`start_param`, …). */
  readonly extra?: Readonly<Record<string, string>>;
  readonly token?: string;
}

/** The `initData` of a normal launch: `auth_date`, `query_id`, `user`, `signature` and any `extra`. */
export function signInitData(options: InitDataOptions): string {
  const { user = { id: 42, first_name: 'Ann' }, authDate, extra, token } = options;
  return signFields(
    {
      query_id: 'AAHdF6IQAAAAAN0XohDhrOrc',
      auth_date: String(authDate),
      ...(user === null ? {} : { user: JSON.stringify(user) }),
      // Ed25519 for third parties: base64url, not checked here, but it is covered by the hash.
      signature: 'c2lnbmF0dXJlLWZvci10aGlyZC1wYXJ0aWVz',
      ...extra,
    },
    token,
  );
}
