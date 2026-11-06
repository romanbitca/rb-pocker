/**
 * The service worker port (PLAN §15.1, chunk 9.5, `app/swUpdate.ts`) over a fake Service Worker
 * API: registration after the page's load, the first install (`offlineReady`), a new version
 * (`updateReady`, also when it was found before the app listened), `apply()` and `activated`, the
 * update check, and pages without service workers (§12.14: a plain-http LAN address,
 * `serviceWorkerOf` in `app/lifecycle.ts`). When the game lets a new version in is
 * `updateMayReload`'s (below, also `app/lifecycle.ts`) and the controller's
 * (`tests/app/controller.update.test.ts`).
 */
import { describe, expect, it, vi } from 'vitest';
import { serviceWorkerOf, updateMayReload, type UpdateMoment } from '../../src/app/lifecycle.ts';
import {
  browserUpdateEnv,
  createUpdatePort,
  SKIP_WAITING,
  SW_SCOPE,
  SW_URL,
  type ContainerLike,
  type RegistrationLike,
  type UpdateEnv,
  type UpdateEvent,
  type WorkerLike,
} from '../../src/app/swUpdate.ts';

class FakeWorker implements WorkerLike {
  state: string;
  readonly messages: unknown[] = [];
  private readonly listeners: (() => void)[] = [];
  constructor(state: string) {
    this.state = state;
  }
  postMessage(message: unknown): void {
    this.messages.push(message);
  }
  addEventListener(_type: 'statechange', listener: () => void): void {
    this.listeners.push(listener);
  }
  /** The browser moves the worker on and tells every page. */
  to(state: string): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}

class FakeRegistration implements RegistrationLike {
  installing: FakeWorker | null = null;
  waiting: FakeWorker | null = null;
  active: FakeWorker | null = null;
  checks = 0;
  checkResult: () => Promise<unknown> = () => Promise.resolve(this);
  private readonly found: (() => void)[] = [];
  update(): Promise<unknown> {
    this.checks++;
    return this.checkResult();
  }
  addEventListener(_type: 'updatefound', listener: () => void): void {
    this.found.push(listener);
  }
  /** The browser found a new script: it installs it. */
  find(sw: FakeWorker): void {
    this.installing = sw;
    for (const listener of this.found) listener();
  }
  /** It finished installing: it waits while another version is active. */
  install(sw: FakeWorker): void {
    this.installing = null;
    this.waiting = sw;
    sw.to('installed');
  }
  /** It takes over (no other version, `skipWaiting()`, or every old page closed). */
  activate(sw: FakeWorker): void {
    if (this.waiting === sw) this.waiting = null;
    if (this.installing === sw) this.installing = null;
    this.active = sw;
    sw.to('activating');
    sw.to('activated');
  }
}

interface Rig {
  env: UpdateEnv;
  reg: FakeRegistration;
  register: ReturnType<typeof vi.fn<ContainerLike['register']>>;
  events: UpdateEvent[];
  /** Fires the page's `load` (registration waits for it). */
  load(): void;
  reloads: number;
}

function rig(setup: (reg: FakeRegistration) => void = () => {}): Rig {
  const reg = new FakeRegistration();
  setup(reg);
  let onLoad: (() => void) | null = null;
  const register = vi.fn<ContainerLike['register']>(() => Promise.resolve(reg));
  const r: Rig = {
    reg,
    register,
    events: [],
    reloads: 0,
    load: () => onLoad?.(),
    env: {
      serviceWorker: { register } as ContainerLike,
      whenLoaded: (run) => {
        onLoad = run;
      },
      reload: () => {
        r.reloads++;
      },
    },
  };
  return r;
}

/** Starts the port and lets the registration land. */
async function started(r: Rig): Promise<ReturnType<typeof createUpdatePort>> {
  const port = createUpdatePort(r.env);
  port.start((event) => r.events.push(event));
  r.load();
  await Promise.resolve();
  await Promise.resolve();
  return port;
}

describe('registration (§15.1)', () => {
  it('registers ./sw.js with the scope ./ once the page has loaded, not before', async () => {
    const r = rig();
    const port = createUpdatePort(r.env);
    port.start((event) => r.events.push(event));
    expect(r.register).not.toHaveBeenCalled(); // the first paint goes first
    r.load();
    expect(r.register).toHaveBeenCalledWith(SW_URL, { scope: SW_SCOPE });
    expect([SW_URL, SW_SCOPE]).toEqual(['./sw.js', './']);
  });

  it('a page that refuses service workers plays on: no event, nothing thrown', async () => {
    const rejecting = rig();
    rejecting.register.mockImplementation(() => Promise.reject(new Error('SecurityError')));
    await started(rejecting);
    const throwing = rig();
    throwing.register.mockImplementation(() => {
      throw new Error('SecurityError');
    });
    await started(throwing);
    expect([...rejecting.events, ...throwing.events]).toEqual([]);
  });
});

describe('events', () => {
  it('first visit: the first version installs → offlineReady; its activation is no update', async () => {
    const r = rig();
    await started(r);
    const v1 = new FakeWorker('installing');
    r.reg.find(v1);
    r.reg.install(v1);
    r.reg.activate(v1);
    expect(r.events).toEqual(['offlineReady']);
  });

  it('a new version found while the page runs → updateReady; apply() lets it in → activated', async () => {
    const r = rig((reg) => (reg.active = new FakeWorker('activated')));
    const port = await started(r);
    const v2 = new FakeWorker('installing');
    r.reg.find(v2);
    expect(r.events).toEqual([]);
    r.reg.install(v2);
    expect(r.events).toEqual(['updateReady']);
    port.apply();
    expect(v2.messages).toEqual([SKIP_WAITING]);
    expect(SKIP_WAITING).toEqual({ type: 'SKIP_WAITING' }); // what generateSW's worker listens for
    r.reg.activate(v2);
    expect(r.events).toEqual(['updateReady', 'activated']);
    expect(r.reloads).toBe(0); // the port never reloads by itself
    port.reload();
    expect(r.reloads).toBe(1);
  });

  it('found by the browser before the app listened: waiting at registration → updateReady at once', async () => {
    const r = rig((reg) => {
      reg.active = new FakeWorker('activated');
      reg.waiting = new FakeWorker('installed');
    });
    await started(r);
    expect(r.events).toEqual(['updateReady']);
  });

  it('installing at registration → updateReady once installed', async () => {
    const v2 = new FakeWorker('installing');
    const r = rig((reg) => {
      reg.active = new FakeWorker('activated');
      reg.installing = v2;
    });
    await started(r);
    expect(r.events).toEqual([]);
    r.reg.install(v2);
    expect(r.events).toEqual(['updateReady']);
  });

  it('another tab lets the new version in → activated here too (each worker reported once)', async () => {
    const r = rig((reg) => (reg.active = new FakeWorker('activated')));
    await started(r);
    const v2 = new FakeWorker('installing');
    r.reg.find(v2);
    r.reg.find(v2); // seen twice: still one listener
    r.reg.install(v2);
    r.reg.activate(v2);
    expect(r.events).toEqual(['updateReady', 'activated']);
  });

  it('a newer version replaces the waiting one: updateReady again, and apply() lets in the newest', async () => {
    const r = rig((reg) => (reg.active = new FakeWorker('activated')));
    const port = await started(r);
    const v2 = new FakeWorker('installing');
    r.reg.find(v2);
    r.reg.install(v2);
    const v3 = new FakeWorker('installing');
    r.reg.find(v3);
    v2.to('redundant');
    r.reg.install(v3);
    port.apply();
    expect(v2.messages).toEqual([]);
    expect(v3.messages).toEqual([SKIP_WAITING]);
    expect(r.events).toEqual(['updateReady', 'updateReady']);
  });

  it('apply() with nothing waiting (another tab let it in already) → activated at once', async () => {
    const r = rig((reg) => (reg.active = new FakeWorker('activated')));
    const port = await started(r);
    port.apply();
    expect(r.events).toEqual(['activated']);
  });
});

describe('check() asks the server for a new version', () => {
  it('registration.update(), once per call; nothing before the registration', async () => {
    const r = rig((reg) => (reg.active = new FakeWorker('activated')));
    const port = createUpdatePort(r.env);
    port.start((event) => r.events.push(event));
    port.check(); // not registered yet
    expect(r.reg.checks).toBe(0);
    r.load();
    await Promise.resolve();
    port.check();
    port.check();
    expect(r.reg.checks).toBe(2);
  });

  it('offline (update() rejects or throws): quiet, no unhandled rejection', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const r = rig((reg) => (reg.active = new FakeWorker('activated')));
      const port = await started(r);
      r.reg.checkResult = () => Promise.reject(new TypeError('Failed to update a ServiceWorker'));
      port.check();
      r.reg.checkResult = () => {
        throw new Error('InvalidStateError');
      };
      expect(() => port.check()).not.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).not.toHaveBeenCalled();
      expect(r.events).toEqual([]);
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});

describe('pages without service workers (§12.14)', () => {
  const page = (navigator: unknown, readyState = 'complete') => {
    const listeners: Record<string, () => void> = {};
    const win = {
      navigator,
      document: { readyState },
      location: { reload: vi.fn() },
      addEventListener: (type: string, listener: () => void) => (listeners[type] = listener),
    };
    return { win: win as unknown as Window, listeners };
  };

  it('a plain-http LAN address (no navigator.serviceWorker) or a throwing getter: no port', () => {
    expect(serviceWorkerOf(page({}).win)).toBeNull();
    const hostile = {
      get serviceWorker(): unknown {
        throw new Error('SecurityError');
      },
    };
    expect(serviceWorkerOf(page(hostile).win)).toBeNull();
    expect(serviceWorkerOf(page({ serviceWorker: {} }).win)).toBeNull(); // no register()
    const container = { register: vi.fn() };
    expect(serviceWorkerOf(page({ serviceWorker: container }).win)).toBe(container);
  });

  it('a secure page: registration at once when loaded, else on `load`; reload() reloads', () => {
    const container = { register: vi.fn() } as unknown as ServiceWorkerContainer;
    const loaded = page({ serviceWorker: container });
    const env = browserUpdateEnv(loaded.win, container);
    expect(env.serviceWorker).toBe(container);
    const run = vi.fn();
    env.whenLoaded(run);
    expect(run).toHaveBeenCalledTimes(1);
    env.reload();
    expect((loaded.win.location.reload as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);

    const loading = page({ serviceWorker: container }, 'interactive');
    const later = vi.fn();
    browserUpdateEnv(loading.win, container).whenLoaded(later);
    expect(later).not.toHaveBeenCalled();
    loading.listeners['load']?.();
    expect(later).toHaveBeenCalledTimes(1);
  });
});

describe('updateMayReload: when a new version may reload the page (§15.1)', () => {
  const at = (moment: Partial<UpdateMoment>): boolean =>
    updateMayReload({
      tab: 'writer',
      busy: false,
      screen: 'home',
      overlays: [],
      toasts: 0,
      hidden: false,
      update: 'ready',
      ...moment,
    });

  it('Welcome or Home with nothing open and no hand unfinished: now', () => {
    expect(at({})).toBe(true);
    expect(at({ screen: 'welcome' })).toBe(true);
  });

  it('never mid-hand, while booting, or while a commit waits (busy)', () => {
    expect(at({ busy: true })).toBe(false);
    expect(at({ busy: true, update: 'activated' })).toBe(false);
  });

  it('not on another screen, nor under a sheet or dialog (the player is reading or choosing)', () => {
    for (const screen of ['table', 'setup', 'settings', 'review'] as const) {
      expect(at({ screen })).toBe(false);
    }
    expect(at({ overlays: ['menu'] })).toBe(false);
  });

  it('not while a toast is on show (Leave table’s session line): once it has closed', () => {
    expect(at({ toasts: 1 })).toBe(false);
    expect(at({ toasts: 2, update: 'activated' })).toBe(false);
    expect(at({ tab: 'readOnly', update: 'activated', toasts: 1 })).toBe(false);
  });

  it('only the tab with the game lets a waiting version in; any tab reloads once it is in', () => {
    expect(at({ tab: 'readOnly' })).toBe(false);
    expect(at({ tab: 'pending' })).toBe(false);
    expect(at({ tab: 'readOnly', update: 'activated' })).toBe(true);
    expect(at({ tab: 'pending', update: 'activated' })).toBe(false);
  });

  it('a tab without the game reloads only while in front (§14.7: no race for the game)', () => {
    expect(at({ tab: 'readOnly', update: 'activated', hidden: true })).toBe(false);
    // The tab with the game loses nothing on Home, in front or not.
    expect(at({ hidden: true })).toBe(true);
    expect(at({ hidden: true, update: 'activated' })).toBe(true);
  });
});
