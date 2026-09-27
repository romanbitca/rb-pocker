import { Controller, Get, Header } from '@nestjs/common';
import { HealthService, type Health } from './health.service.js';

/** GET /api/health, for the Docker and Coolify health checks only; the game never calls it (PLAN §2.6 d). */
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  get(): Health {
    return this.health.check();
  }
}
