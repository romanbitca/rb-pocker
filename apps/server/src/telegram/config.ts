/** Used only for registering the bot (PLAN §19.3). */
const DEFAULT_PUBLIC_URL = 'https://poker.romanbitca.com';

/** The three values Telegram and multiplayer need; without all of them both are off (§19.3). */
const REQUIRED = [
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_BOT_USERNAME',
  'TELEGRAM_APP_SHORT_NAME',
] as const;

/**
 * Telegram's settings, from the environment, at run time only (§19.3).
 *
 * The token is a private field with a getter on the prototype: `JSON.stringify` and `util.inspect`
 * of this object, and so any log line that prints it, do not contain it.
 */
export class TelegramConfig {
  readonly #botToken: string;

  /** True only with all three values. Every Telegram and multiplayer endpoint hangs on this. */
  readonly enabled: boolean;
  /** Without a leading `@`; empty when off. */
  readonly botUsername: string;
  /** The Mini App's short name from BotFather; empty when off. */
  readonly appShortName: string;
  /** No trailing slash. */
  readonly publicUrl: string;
  /** `NODE_ENV` is `production`: the bot registers itself at boot only then (§19.8). */
  readonly production: boolean;
  /** The names of the values that are not set, so the log can say why Telegram is off. */
  readonly missing: readonly string[];

  constructor(env: Readonly<Record<string, string | undefined>>) {
    const value = (name: string): string => env[name]?.trim() ?? '';

    this.missing = REQUIRED.filter((name) => value(name) === '');
    this.enabled = this.missing.length === 0;
    this.#botToken = this.enabled ? value('TELEGRAM_BOT_TOKEN') : '';
    this.botUsername = this.enabled ? value('TELEGRAM_BOT_USERNAME').replace(/^@/, '') : '';
    this.appShortName = this.enabled ? value('TELEGRAM_APP_SHORT_NAME') : '';
    this.publicUrl = (value('PUBLIC_URL') || DEFAULT_PUBLIC_URL).replace(/\/+$/, '');
    this.production = value('NODE_ENV') === 'production';
  }

  /** The bot's secret. Empty when off. Never log it, put it in an error, or send it to a client. */
  get botToken(): string {
    return this.#botToken;
  }

  /** The direct link of the Mini App; `param` reaches it as `start_param` (§19.2, §19.8). */
  invite(param?: string): string {
    const link = `https://t.me/${this.botUsername}/${this.appShortName}`;
    return param === undefined ? link : `${link}?startapp=${encodeURIComponent(param)}`;
  }

  /** The one line the server logs at boot (§19.3). Names missing settings, never a value. */
  statusLine(): string {
    if (this.enabled) return 'Telegram is on.';
    if (this.missing.length === REQUIRED.length) return 'Telegram is off.';
    return `Telegram is off: ${this.missing.join(', ')} not set.`;
  }
}
