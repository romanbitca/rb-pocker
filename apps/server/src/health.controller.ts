import { Controller, Get } from '@nestjs/common';
import { HealthService, type Health } from './health.service.js';

/**
 * GET /api/health, for the Docker and Coolify health checks only; the game never calls it (PLAN §2.6 d).
 * `Cache-Control: no-store` comes from configureApp(), like every other /api response.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  get(): Health {
    return this.health.check();
  }
}
