import { Inject, Injectable } from '@nestjs/common';
import { TelegramConfig } from '../telegram/config.js';
import { BotApi, type InlineArticle, type InlineKeyboard } from './bot-api.js';
import { WORDS } from './words.js';

/** Which table a user sits at, for inline mode (PLAN §19.8). `RoomRegistry` will implement it. */
export interface TableLookup {
  codeOfUser(userId: number): string | null;
}

export const TABLE_LOOKUP = Symbol('TABLE_LOOKUP');

/** The last 1,000 `update_id`s are remembered, so a repeat is dropped (§19.8). */
const REMEMBERED_UPDATES = 1_000;

/** A table code, as `TABLE_CODE_RE` of `net/protocol.ts` (§19.4). The only text put in a link. */
const TABLE_CODE_RE = /^[2-9A-HJKMNP-Z]{8}$/;

/** `/new`, `/new@our_bot`, `/start ABCD2345`. */
const COMMAND_RE = /^\/(\w{1,32})(?:@(\w+))?(?:\s+(.*))?$/s;

interface Reply {
  readonly text: string;
  readonly button: string;
  readonly url: string;
}

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;
const isSafeInteger = (x: unknown): x is number => Number.isSafeInteger(x);

/** One URL button: the only kind that works in groups and channels (§19.2). */
const keyboard = (text: string, url: string): InlineKeyboard => ({
  inline_keyboard: [[{ text, url }]],
});

/** Turns Telegram's updates into replies. Keeps no chat list and logs no user (§19.8). */
@Injectable()
export class BotService {
  private readonly seen = new Set<number>();
  private failureCount = 0;

  constructor(
    private readonly config: TelegramConfig,
    private readonly api: BotApi,
    @Inject(TABLE_LOOKUP) private readonly tables: TableLookup,
  ) {}

  /** Calls that failed since boot. */
  get failures(): number {
    return this.failureCount;
  }

  /** Never rejects: a failing Telegram is counted, and the webhook has answered 200 already. */
  async handleUpdate(update: unknown): Promise<void> {
    try {
      await this.process(update);
    } catch {
      this.failureCount += 1;
    }
  }

  private async process(update: unknown): Promise<void> {
    if (!isObject(update) || !isSafeInteger(update.update_id)) return;
    if (this.isRepeat(update.update_id)) return;
    if (isObject(update.message)) await this.answerMessage(update.message);
    else if (isObject(update.inline_query)) await this.answerInlineQuery(update.inline_query);
  }

  private isRepeat(updateId: number): boolean {
    if (this.seen.has(updateId)) return true;
    this.seen.add(updateId);
    if (this.seen.size > REMEMBERED_UPDATES) {
      // A Set iterates in insertion order: the first one is the oldest.
      for (const oldest of this.seen) {
        this.seen.delete(oldest);
        break;
      }
    }
    return false;
  }

  private async answerMessage(message: Record<string, unknown>): Promise<void> {
    const chatId = isObject(message.chat) ? message.chat.id : undefined;
    if (!isSafeInteger(chatId) || typeof message.text !== 'string') return;
    const reply = this.replyTo(message.text);
    if (reply === null) return;
    await this.api.sendMessage({
      chat_id: chatId,
      text: reply.text,
      reply_markup: keyboard(reply.button, reply.url),
    });
  }

  /** Null for plain text, an unknown command, or a command that names another bot. */
  private replyTo(text: string): Reply | null {
    const match = COMMAND_RE.exec(text);
    if (match === null) return null;
    const [, name = '', bot, rest = ''] = match;
    if (bot !== undefined && bot.toLowerCase() !== this.config.botUsername.toLowerCase()) {
      return null;
    }
    const play = (words: string): Reply => ({
      text: words,
      button: WORDS.buttons.play,
      url: this.config.invite(),
    });
    const newTable: Reply = {
      text: WORDS.newTable,
      button: WORDS.buttons.newTable,
      url: this.config.invite('new'),
    };

    switch (name.toLowerCase()) {
      case 'start': {
        const param = rest.trim();
        if (param === 'new') return newTable;
        if (!TABLE_CODE_RE.test(param)) return play(WORDS.start);
        return { text: WORDS.join, button: WORDS.buttons.join, url: this.config.invite(param) };
      }
      case 'new':
        return newTable;
      case 'help':
        return play(WORDS.help);
      case 'post':
        return play(WORDS.post(this.config.invite()));
      default:
        return null;
    }
  }

  private async answerInlineQuery(query: Record<string, unknown>): Promise<void> {
    const userId = isObject(query.from) ? query.from.id : undefined;
    if (typeof query.id !== 'string' || !isSafeInteger(userId)) return;
    await this.api.answerInlineQuery({
      inline_query_id: query.id,
      results: [this.inlineArticle(this.tables.codeOfUser(userId))],
      cache_time: 0,
      is_personal: true,
    });
  }

  private inlineArticle(code: string | null): InlineArticle {
    const words = code === null ? WORDS.inlineNoTable : WORDS.inlineAtTable;
    return {
      type: 'article',
      id: code === null ? 'play' : 'table',
      title: words.title,
      description: words.description,
      input_message_content: { message_text: words.message },
      reply_markup:
        code === null
          ? keyboard(WORDS.buttons.play, this.config.invite())
          : keyboard(WORDS.buttons.join, this.config.invite(code)),
    };
  }
}
