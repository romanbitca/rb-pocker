import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { TelegramConfig } from '../telegram/config.js';
import { BotApi, BotApiError } from './bot-api.js';
import { WEBHOOK_PATH, webhookSecret } from './webhook.controller.js';
import { WORDS } from './words.js';

/** After a failure, the waits before the next tries (PLAN §19.8). */
const RETRY_DELAYS_MS = [5_000, 30_000, 120_000];

/**
 * Tells Telegram where the bot lives, at boot, only in production with the config (§19.3, §19.8).
 * It does not hold up the boot, and a failure never stops the server.
 */
@Injectable()
export class BotRegistration implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Telegram');
  /** In order. Steps that worked are not repeated: `setWebhook` drops the pending updates. */
  private readonly steps = [
    () =>
      this.api.setWebhook({
        url: this.config.publicUrl + WEBHOOK_PATH,
        secret_token: webhookSecret(this.config.botToken),
        allowed_updates: ['message', 'inline_query'],
        drop_pending_updates: true,
      }),
    () => this.api.setMyCommands({ commands: WORDS.commands }),
    () =>
      this.api.setChatMenuButton({
        menu_button: {
          type: 'web_app',
          text: WORDS.menuButton,
          web_app: { url: this.config.publicUrl },
        },
      }),
  ];
  private stepsDone = 0;
  private retry: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: TelegramConfig,
    private readonly api: BotApi,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.enabled && this.config.production) void this.run(0);
  }

  onModuleDestroy(): void {
    if (this.retry !== null) clearTimeout(this.retry);
    this.retry = null;
  }

  /** Never rejects. `retries`: how many of `RETRY_DELAYS_MS` have been used. */
  private async run(retries: number): Promise<void> {
    try {
      for (const step of this.steps.slice(this.stepsDone)) {
        await step();
        this.stepsDone += 1;
      }
    } catch (error) {
      this.failed(error, retries);
    }
  }

  private failed(error: unknown, retries: number): void {
    const delay = RETRY_DELAYS_MS[retries];
    // Only our own error's text: any other could hold the URL, and with it the token.
    const what = error instanceof BotApiError ? error.message : 'unexpected error';
    const next = delay === undefined ? 'giving up' : `next try in ${String(delay / 1000)} s`;
    this.logger.warn(`Telegram registration: ${what}; ${next}.`);
    if (delay === undefined) return;
    this.retry = setTimeout(() => void this.run(retries + 1), delay);
    this.retry.unref();
  }
}
