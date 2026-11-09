import { Module } from '@nestjs/common';
import { TelegramModule } from '../telegram/telegram.module.js';
import { BotApi } from './bot-api.js';
import { BotService, TABLE_LOOKUP, type TableLookup } from './bot.service.js';
import { BotRegistration } from './registration.js';
import { WebhookController } from './webhook.controller.js';

/** Stands in until `RoomRegistry` is here: nobody is at a table, so inline mode offers "Play" (§19.8). */
const NO_TABLES: TableLookup = { codeOfUser: () => null };

/** The Telegram bot (PLAN §19.8). Off, with a 404 webhook, without the Telegram config. */
@Module({
  imports: [TelegramModule],
  controllers: [WebhookController],
  providers: [BotApi, BotService, BotRegistration, { provide: TABLE_LOOKUP, useValue: NO_TABLES }],
})
export class BotModule {}
