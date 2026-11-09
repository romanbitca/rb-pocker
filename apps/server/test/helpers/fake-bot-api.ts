import { BotApi } from '../../src/bot/bot-api.js';
import { TelegramConfig } from '../../src/telegram/config.js';

export interface BotCall {
  readonly method: string;
  readonly params: Record<string, unknown>;
}

/**
 * Records every call and answers as `respond` says; nothing leaves the process. Only the one method
 * that talks to Telegram is replaced, so the types of the five public methods stay the real ones.
 */
export class FakeBotApi extends BotApi {
  readonly calls: BotCall[] = [];
  /** Default: Telegram says yes. Replace it to fail, to hang, or to throw. */
  respond: (method: string) => Promise<void> = () => Promise.resolve();

  constructor() {
    super(new TelegramConfig({}));
  }

  protected override call(method: string, params: object): Promise<void> {
    this.calls.push({ method, params: params as Record<string, unknown> });
    return this.respond(method);
  }

  methods(): string[] {
    return this.calls.map((call) => call.method);
  }
}
