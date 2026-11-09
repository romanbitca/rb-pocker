import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { connect, createServer, type AddressInfo, type Socket } from 'node:net';
import { fileURLToPath } from 'node:url';
import { TELEGRAM_SERVER_ENV } from './telegram.ts';

/**
 * A private copy of the Nest server (what the root `npm start` runs), for a test that must take
 * the server away: the offline test, or the update test that restarts it with another build
 * (chunk 9.5). The shared server of `playwright.config.ts` serves every other test in parallel, so
 * it must stay up.
 */
export interface OwnServer {
  /** `http://localhost:<port>`. */
  readonly origin: string;
  /** Kills the server: from now on every request that reaches the network fails. */
  stop(): Promise<void>;
  /** SIGTERM, as a redeploy: the server tells every table why and exits (PLAN §19.5, §17.3). */
  terminate(): Promise<void>;
}

export interface OwnServerOptions {
  /** The port (default: a free one). The update test restarts on the same origin. */
  port?: number;
  /** The built game to serve (`WEB_DIST_DIR`; default `apps/web/dist`). */
  webDist?: string;
  /** More environment: `TELEGRAM_SERVER_ENV` turns Telegram and multiplayer on (default: off). */
  env?: Readonly<Record<string, string>>;
}

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

/** A port nobody listens on right now. */
export async function freePort(): Promise<number> {
  const probe = createServer();
  probe.listen(0);
  await once(probe, 'listening');
  const { port } = probe.address() as AddressInfo;
  probe.close();
  await once(probe, 'close');
  return port;
}

export async function startOwnServer(options: OwnServerOptions = {}): Promise<OwnServer> {
  const port = options.port ?? (await freePort());
  const origin = `http://localhost:${port}`;
  const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(port) };
  for (const name of Object.keys(TELEGRAM_SERVER_ENV)) delete env[name];
  Object.assign(env, options.env);
  if (options.webDist === undefined) delete env['WEB_DIST_DIR'];
  else env['WEB_DIST_DIR'] = options.webDist;
  const server = spawn(process.execPath, ['apps/server/dist/main.js'], {
    cwd: REPO_ROOT,
    env,
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

  const end = async (signal: NodeJS.Signals): Promise<void> => {
    if (server.exitCode === null && server.signalCode === null) {
      server.kill(signal);
      await exited;
    }
  };
  return { origin, stop: () => end('SIGKILL'), terminate: () => end('SIGTERM') };
}

/**
 * A plug between a browser and a server (the real TCP stream, so the real WebSocket, the real
 * upgrade and the real `Origin` check): pulling it is a phone that lost its signal. WebKit and
 * Chromium agree on what a dead TCP connection is, and neither needs the app's help.
 */
export interface TcpPlug {
  /** `http://localhost:<port>`: open the app here, and everything goes through the plug. */
  readonly origin: string;
  /** Pulled: every open connection dies, and a new one is refused. */
  pull(): void;
  /** Back in: connections work again. */
  insert(): void;
  close(): Promise<void>;
}

export async function startTcpPlug(targetPort: number): Promise<TcpPlug> {
  const port = await freePort();
  const open = new Set<Socket>();
  let inserted = true;
  const relay = (from: Socket, to: Socket): void => {
    open.add(from);
    from.on('close', () => {
      open.delete(from);
      to.destroy();
    });
    from.on('error', () => from.destroy());
    from.pipe(to);
  };
  const server = createServer((browser) => {
    if (!inserted) {
      browser.destroy();
      return;
    }
    const upstream = connect(targetPort, 'localhost');
    relay(browser, upstream);
    relay(upstream, browser);
  });
  server.listen(port);
  await once(server, 'listening');
  const pull = (): void => {
    inserted = false;
    for (const socket of open) socket.destroy();
  };
  return {
    origin: `http://localhost:${port}`,
    pull,
    insert() {
      inserted = true;
    },
    async close() {
      pull();
      server.close();
      await once(server, 'close');
    },
  };
}
