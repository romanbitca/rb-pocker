import { Logger, Module, type OnModuleInit } from '@nestjs/common';
import { TelegramConfig } from './config.js';

/** Gives the rest of the server the Telegram settings (PLAN §19.3). */
@Module({
  providers: [{ provide: TelegramConfig, useFactory: () => new TelegramConfig(process.env) }],
  exports: [TelegramConfig],
})
export class TelegramModule implements OnModuleInit {
  constructor(private readonly config: TelegramConfig) {}

  onModuleInit(): void {
    new Logger('Telegram').log(this.config.statusLine());
  }
}
