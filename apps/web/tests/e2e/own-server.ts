import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

/**
 * A private copy of the Nest server (what the root `npm start` runs), for a test that must take
 * the server away: the offline test. The shared server of `playwright.config.ts` serves every
 * other test in parallel, so it must stay up.
 */
export interface OwnServer {
  /** `http://localhost:<port>`. */
  readonly origin: string;
  /** Kills the server: from now on every request that reaches the network fails. */
  stop(): Promise<void>;
}

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

/** A port nobody listens on right now. */
async function freePort(): Promise<number> {
  const probe = createServer();
  probe.listen(0);
  await once(probe, 'listening');
  const { port } = probe.address() as AddressInfo;
  probe.close();
  await once(probe, 'close');
  return port;
}

export async function startOwnServer(): Promise<OwnServer> {
  const port = await freePort();
  const origin = `http://localhost:${port}`;
  const server = spawn(process.execPath, ['apps/server/dist/main.js'], {
    cwd: REPO_ROOT,
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore',
  });
  const exited = once(server, 'exit');

  const deadline = Date.now() + 20_000;
  for (;;) {
    if (server.exitCode !== null) throw new Error(`the server exited with ${server.exitCode}`);
    const healthy = await fetch(`${origin}/api/health`).then(
      (response) => response.ok,
      () => false,
    );
    if (healthy) break;
    if (Date.now() > deadline) {
      server.kill('SIGKILL');
      throw new Error(`the server did not answer on ${origin} within 20 s`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return {
    origin,
    async stop() {
      if (server.exitCode === null && server.signalCode === null) {
        server.kill('SIGKILL');
        await exited;
      }
    },
  };
}
