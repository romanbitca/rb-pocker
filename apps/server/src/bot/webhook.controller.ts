import { createHash, timingSafeEqual } from 'node:crypto';
import { Body, Controller, HttpCode, NotFoundException, Post } from '@nestjs/common';
import type { RequestHandler } from 'express';
import { TelegramConfig } from '../telegram/config.js';
import { BotService } from './bot.service.js';

const WEBHOOK_ROUTE = 'telegram/webhook';
/** With the global `/api` prefix. */
export const WEBHOOK_PATH = `/api/${WEBHOOK_ROUTE}`;

/** 64 hex characters, so a valid `secret_token` (§19.2). Telegram sends it back in a header. */
export function webhookSecret(token: string): string {
  return createHash('sha256').update(`webhook:${token}`).digest('hex');
}

/**
 * Answers 401 unless the request carries the secret (PLAN §19.8). An Express middleware, not a Nest
 * guard: `configureApp()` mounts it before `init()`, so it runs before Nest's body parser and a caller
 * without the secret has its body neither read nor parsed.
 */
export function webhookGate(token: string): RequestHandler {
  const expected = Buffer.from(webhookSecret(token));
  return (req, res, next) => {
    // Compared as bytes: `timingSafeEqual` throws on a different length, and a header's characters
    // need not be one byte each.
    const received = Buffer.from(req.get('X-Telegram-Bot-Api-Secret-Token') ?? '');
    if (received.length === expected.length && timingSafeEqual(received, expected)) {
      next();
      return;
    }
    res.status(401).json({ statusCode: 401, message: 'Unauthorized' });
  };
}

/** `POST /api/telegram/webhook`. Behind `webhookGate` whenever Telegram is on. */
@Controller(WEBHOOK_ROUTE)
export class WebhookController {
  constructor(
    private readonly config: TelegramConfig,
    private readonly bot: BotService,
  ) {}

  /** Answers 200 at once and works after it: Telegram never waits for our calls to Telegram. */
  @Post()
  @HttpCode(200)
  receive(@Body() update: unknown): void {
    // The same 404 as a route that does not exist: with Telegram off there is no webhook.
    if (!this.config.enabled) throw new NotFoundException(`Cannot POST ${WEBHOOK_PATH}`);
    void this.bot.handleUpdate(update);
  }
}
