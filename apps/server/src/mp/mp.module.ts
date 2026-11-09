import { Module } from '@nestjs/common';
import { randomSeed } from '../game/core/rng.js';
import { TelegramConfig } from '../telegram/config.js';
import { TelegramModule } from '../telegram/telegram.module.js';
import { CLOCK, realClock, type Clock } from './clock.js';
import { MpGateway } from './gateway.js';
import { RoomRegistry } from './registry.js';

/** Playing with friends (PLAN §19.3, §19.5): the tables and their socket. Off without the config. */
@Module({
  imports: [TelegramModule],
  providers: [
    { provide: CLOCK, useValue: realClock },
    {
      provide: RoomRegistry,
      inject: [CLOCK, TelegramConfig],
      useFactory: (clock: Clock, config: TelegramConfig) =>
        new RoomRegistry({
          clock,
          newSeed: randomSeed,
          inviteUrl: (code) => config.invite(code),
        }),
    },
    MpGateway,
  ],
  exports: [RoomRegistry],
})
export class MpModule {}
