import { Module } from '@nestjs/common';
import { HealthModule } from './health.module.js';

@Module({
  imports: [HealthModule],
})
export class AppModule {}
