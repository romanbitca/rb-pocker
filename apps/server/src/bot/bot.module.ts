import { Module } from '@nestjs/common';
import { MpModule } from '../mp/mp.module.js';
import { RoomRegistry } from '../mp/registry.js';
import { TelegramModule } from '../telegram/telegram.module.js';
import { BotApi } from './bot-api.js';
import { BotService, TABLE_LOOKUP } from './bot.service.js';
import { BotRegistration } from './registration.js';
import { WebhookController } from './webhook.controller.js';

/** The Telegram bot (PLAN §19.8). Off, with a 404 webhook, without the Telegram config. */
@Module({
  imports: [TelegramModule, MpModule],
  controllers: [WebhookController],
  providers: [
    BotApi,
    BotService,
    BotRegistration,
    { provide: TABLE_LOOKUP, useExisting: RoomRegistry },
  ],
})
export class BotModule {}
