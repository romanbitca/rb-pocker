import { execFile } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/setup.js';

/**
 * scripts/check-deploy.mjs (PLAN §17.6 step 7) against the real app, served on a free port from
 * the test fixture (WEB_DIST_DIR, test/global-setup.ts). The script runs as the owner runs it:
 * `node scripts/check-deploy.mjs <url>`, in its own process.
 */

const SCRIPT = fileURLToPath(new URL('../../../scripts/check-deploy.mjs', import.meta.url));
const COMMIT = '0123456789abcdef0123456789abcdef01234567';

async function checkDeploy(...args: string[]): Promise<{ code: number; output: string }> {
  try {
    const { stdout, stderr } = await promisify(execFile)(process.execPath, [SCRIPT, ...args]);
    return { code: 0, output: stdout + stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? -1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
  }
}

let app: NestExpressApplication | undefined;

/** Boots the app like main.ts; `before` adds middleware ahead of everything else. */
async function serve(
  nodeEnv: string | undefined,
  before?: (app: NestExpressApplication) => void,
): Promise<string> {
  app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: false,
    abortOnError: false,
  });
  before?.(app);
  configureApp(app, nodeEnv);
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

const savedCommit = process.env.SOURCE_COMMIT;
beforeEach(() => {
  process.env.SOURCE_COMMIT = COMMIT;
});
afterEach(async () => {
  await app?.close();
  app = undefined;
  if (savedCommit === undefined) delete process.env.SOURCE_COMMIT;
  else process.env.SOURCE_COMMIT = savedCommit;
});

describe('scripts/check-deploy.mjs', { timeout: 30_000 }, () => {
  it('passes a production server and prints one line per URL', async () => {
    const url = await serve('production');

    const { code, output } = await checkDeploy(url, '--commit', COMMIT.slice(0, 7));

    expect(output).toContain('All checks passed.');
    expect(code).toBe(0);
    for (const path of ['/', '/sw.js', '/manifest.webmanifest', '/table/42', '/api/health']) {
      expect(output).toMatch(new RegExp(`^ok   ${path.replaceAll('.', '\\.')}\\b`, 'm'));
    }
    expect(output).toMatch(/^ok {3}\/assets\/app-abc123\.js$/m);
  });

  it('fails without HSTS (NODE_ENV is not production)', async () => {
    const url = await serve(undefined);

    const { code, output } = await checkDeploy(url);

    expect(code).toBe(1);
    expect(output).toMatch(/^FAIL \/: strict-transport-security: null/m);
  });

  it('fails when a response sets a cookie', async () => {
    const url = await serve('production', (nest) => {
      nest.use('/sw.js', (_req: Request, res: Response, next: NextFunction) => {
        res.setHeader('Set-Cookie', 'visitor=1; Path=/');
        next();
      });
    });

    const { code, output } = await checkDeploy(url);

    expect(code).toBe(1);
    expect(output).toMatch(/^FAIL \/sw\.js: sets a cookie: visitor=1; Path=\/$/m);
    expect(output).toMatch(/^ok {3}\/manifest\.webmanifest$/m);
  });

  it('fails when the commit is missing or not the expected one', async () => {
    const url = await serve('production');

    expect((await checkDeploy(url, '--commit', 'deadbee')).output).toMatch(
      /^FAIL \/api\/health: commit 0123456789abcdef0123456789abcdef01234567, expected deadbee$/m,
    );
    delete process.env.SOURCE_COMMIT;
    const missing = await checkDeploy(url);
    expect(missing.code).toBe(1);
    expect(missing.output).toMatch(/^FAIL \/api\/health: commit "dev": SOURCE_COMMIT is not set$/m);
  });

  it('fails when nothing answers, and explains its usage', async () => {
    const url = await serve('production');
    await app?.close();
    app = undefined;

    const down = await checkDeploy(url);
    expect(down.code).toBe(1);
    expect(down.output).toMatch(/^FAIL \/: no answer \(ECONNREFUSED\)$/m);

    const usage = await checkDeploy();
    expect(usage.code).toBe(2);
    expect(usage.output).toContain('Usage: node scripts/check-deploy.mjs <url> [--commit <sha>]');
  });
});
