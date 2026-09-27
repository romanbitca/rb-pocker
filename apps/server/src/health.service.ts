import { readFileSync } from 'node:fs';
import { Injectable } from '@nestjs/common';

export interface Health {
  status: 'ok';
  version: string;
  commit: string;
}

/**
 * `version` from apps/server/package.json. The path is relative to this module, and `src/`
 * (Vitest) and `dist/` (node) both sit next to package.json, so it resolves from either.
 */
function readVersion(): string {
  const pkg: unknown = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  );
  if (typeof pkg === 'object' && pkg !== null && 'version' in pkg) {
    const { version } = pkg;
    if (typeof version === 'string') return version;
  }
  throw new Error('apps/server/package.json has no "version"');
}

@Injectable()
export class HealthService {
  private readonly version = readVersion();

  check(): Health {
    // Read at request time: Coolify sets SOURCE_COMMIT in the container's runtime environment
    // (PLAN §17.6). Unset or empty means a local build.
    const commit = process.env.SOURCE_COMMIT;
    return { status: 'ok', version: this.version, commit: commit ? commit : 'dev' };
  }
}
