import { Injectable } from '@nestjs/common';
import { TelegramConfig } from '../telegram/config.js';

const API_BASE = 'https://api.telegram.org';
/** A hung Telegram must not pile up calls: every reply is fire-and-forget (§19.8). */
const REQUEST_TIMEOUT_MS = 10_000;

export interface InlineKeyboard {
  readonly inline_keyboard: ReadonlyArray<ReadonlyArray<{ text: string; url: string }>>;
}

export interface SendMessage {
  readonly chat_id: number;
  readonly text: string;
  readonly reply_markup: InlineKeyboard;
}

export interface InlineArticle {
  readonly type: 'article';
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly input_message_content: { readonly message_text: string };
  readonly reply_markup: InlineKeyboard;
}

export interface AnswerInlineQuery {
  readonly inline_query_id: string;
  readonly results: readonly InlineArticle[];
  readonly cache_time: number;
  readonly is_personal: boolean;
}

export interface SetWebhook {
  readonly url: string;
  readonly secret_token: string;
  readonly allowed_updates: readonly string[];
  readonly drop_pending_updates: boolean;
}

export interface SetMyCommands {
  readonly commands: ReadonlyArray<{ readonly command: string; readonly description: string }>;
}

export interface SetChatMenuButton {
  readonly menu_button: {
    readonly type: 'web_app';
    readonly text: string;
    readonly web_app: { readonly url: string };
  };
}

/**
 * A call that failed. Holds only the method and the HTTP status: the call's URL has the token in it,
 * so nothing of `fetch`'s own error (message, cause, stack) is kept.
 */
export class BotApiError extends Error {
  override readonly name = 'BotApiError';

  constructor(
    readonly method: string,
    /** Null when there was no HTTP answer. */
    readonly status: number | null,
  ) {
    super(`${method} failed (${status === null ? 'no answer' : `HTTP ${String(status)}`})`);
  }
}

/** A thin wrapper of the Bot API methods we use (PLAN §19.8). Tests replace `call`. */
@Injectable()
export class BotApi {
  constructor(private readonly config: TelegramConfig) {}

  sendMessage(params: SendMessage): Promise<void> {
    return this.call('sendMessage', params);
  }

  answerInlineQuery(params: AnswerInlineQuery): Promise<void> {
    return this.call('answerInlineQuery', params);
  }

  setWebhook(params: SetWebhook): Promise<void> {
    return this.call('setWebhook', params);
  }

  setMyCommands(params: SetMyCommands): Promise<void> {
    return this.call('setMyCommands', params);
  }

  setChatMenuButton(params: SetChatMenuButton): Promise<void> {
    return this.call('setChatMenuButton', params);
  }

  /** Resolves when Telegram answered 2xx; otherwise rejects with a `BotApiError`, nothing else. */
  protected async call(method: string, params: object): Promise<void> {
    let status: number | null = null;
    try {
      const response = await fetch(`${API_BASE}/bot${this.config.botToken}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      status = response.status;
      await response.arrayBuffer(); // Reading it frees the connection.
      if (response.ok) return;
    } catch {
      // Not rethrown: `fetch`'s errors can quote the URL, and with it the token.
    }
    throw new BotApiError(method, status);
  }
}
