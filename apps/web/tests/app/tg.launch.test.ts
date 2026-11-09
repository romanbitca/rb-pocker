// @vitest-environment jsdom
/**
 * Telegram's launch parameters (PLAN §19.2, §19.7; Stage 10 acceptance 12): from the URL fragment,
 * kept in sessionStorage for a reload that loses it; null, and nothing else, outside Telegram. The
 * last block runs `startApp`: the Telegram chunk is asked for only when `parseLaunch` found
 * Telegram.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startApp } from '../../src/app/boot.ts';
import { realTimers } from '../../src/app/controller.ts';
import { appStore } from '../../src/app/store.ts';
import { LAUNCH_KEY, parseLaunch } from '../../src/app/tg/launch.ts';
import { startTelegram } from '../../src/app/tg/start.ts';

vi.mock('../../src/app/tg/start.ts', () => ({ startTelegram: vi.fn() }));

/** A real `initData`'s shape: its values are percent-encoded once. */
const INIT_DATA =
  'user=%7B%22id%22%3A42%2C%22first_name%22%3A%22Ann%22%7D&auth_date=1700000000&signature=abc&hash=def';

/** The fragment Telegram opens the app with. */
function fragment(initData: string, version = '8.0', platform = 'android'): string {
  return `#tgWebAppData=${encodeURIComponent(initData)}&tgWebAppVersion=${version}&tgWebAppPlatform=${platform}&tgWebAppThemeParams=%7B%7D`;
}

type Session = Pick<Storage, 'getItem' | 'setItem'>;

function memorySession(): Session & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

function page(hash: string, session: Session = memorySession()): Window {
  return { location: { hash }, sessionStorage: session } as unknown as Window;
}

describe('parseLaunch (§19.7)', () => {
  it('takes initData, the version and the platform from the fragment, decoded once', () => {
    expect(parseLaunch(page(fragment(INIT_DATA, '7.10', 'ios')))).toEqual({
      initData: INIT_DATA, // still percent-encoded inside: this exact string is what gets signed
      version: '7.10',
      platform: 'ios',
      startParam: null,
    });
  });

  it('reads start_param from initData', () => {
    const initData = `${INIT_DATA}&start_param=Ab3_x-9Z`;
    expect(parseLaunch(page(fragment(initData)))?.startParam).toBe('Ab3_x-9Z');
    expect(parseLaunch(page(fragment(`start_param=new&${INIT_DATA}`)))?.startParam).toBe('new');
  });

  it('a missing or empty version or platform takes the defaults of Telegram`s script', () => {
    const data = `tgWebAppData=${encodeURIComponent(INIT_DATA)}`;
    expect(parseLaunch(page(`#${data}`))).toMatchObject({ version: '6.0', platform: 'unknown' });
    expect(parseLaunch(page(`#${data}&tgWebAppVersion=&tgWebAppPlatform=`))).toMatchObject({
      version: '6.0',
      platform: 'unknown',
    });
  });

  it('outside Telegram it is null and stores nothing', () => {
    for (const hash of ['', '#', '#bench', '#tgWebAppVersion=8.0', '#x=1']) {
      const session = memorySession();
      expect(parseLaunch(page(hash, session)), hash).toBeNull();
      expect(session.data.size, hash).toBe(0);
    }
  });

  it('an empty tgWebAppData (a keyboard button, inline mode: §19.2) is no Telegram', () => {
    expect(parseLaunch(page('#tgWebAppData=&tgWebAppVersion=8.0'))).toBeNull();
  });

  it('keeps the parameters under pc.tg.launch, and a reload that lost the fragment finds them', () => {
    expect(LAUNCH_KEY).toBe('pc.tg.launch');
    const session = memorySession();
    const launched = parseLaunch(page(fragment(`${INIT_DATA}&start_param=abc`), session));
    expect(JSON.parse(session.data.get(LAUNCH_KEY) ?? '')).toEqual({
      initData: `${INIT_DATA}&start_param=abc`,
      version: '8.0',
      platform: 'android',
    });
    expect(parseLaunch(page('', session))).toEqual(launched);
  });

  it('a new fragment wins over what is kept', () => {
    const session = memorySession();
    parseLaunch(page(fragment('a=1'), session));
    expect(parseLaunch(page(fragment('b=2', '9.0'), session))).toMatchObject({
      initData: 'b=2',
      version: '9.0',
    });
    expect(parseLaunch(page('', session))).toMatchObject({ initData: 'b=2' });
  });

  it('a new fragment with an empty tgWebAppData ends the kept launch too', () => {
    const session = memorySession();
    parseLaunch(page(fragment(INIT_DATA), session));
    expect(parseLaunch(page('#tgWebAppData=', session))).toBeNull();
    expect(parseLaunch(page('', session))).toBeNull();
  });

  it('sessionStorage that throws: the fragment still works; without one, no Telegram', () => {
    const throwing: Session = {
      getItem: () => {
        throw new DOMException('denied', 'SecurityError');
      },
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
    };
    expect(parseLaunch(page(fragment(INIT_DATA), throwing))).toMatchObject({
      initData: INIT_DATA,
    });
    expect(parseLaunch(page('', throwing))).toBeNull();
    const noStorage = {
      location: { hash: fragment(INIT_DATA) },
      get sessionStorage(): Storage {
        throw new DOMException('denied', 'SecurityError');
      },
    } as unknown as Window;
    expect(parseLaunch(noStorage)).toMatchObject({ initData: INIT_DATA });
  });

  it('what is kept but makes no sense is no Telegram', () => {
    for (const kept of [
      'not json',
      'null',
      '7',
      '{}',
      '{"initData":1,"version":"8.0","platform":"ios"}',
      '{"initData":"a=1","version":8,"platform":"ios"}',
      '{"initData":"a=1","version":"8.0"}',
      '{"initData":"","version":"8.0","platform":"ios"}',
    ]) {
      const session = memorySession();
      session.data.set(LAUNCH_KEY, kept);
      expect(parseLaunch(page('', session)), kept).toBeNull();
    }
  });

  it('never throws: a page without a usable location is no Telegram', () => {
    expect(parseLaunch({} as Window)).toBeNull();
    const throwing = {
      get location(): Location {
        throw new DOMException('denied', 'SecurityError');
      },
    } as unknown as Window;
    expect(parseLaunch(throwing)).toBeNull();
  });
});

describe('startApp and Telegram (§19.7)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(startTelegram).mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
    sessionStorage.clear();
    window.history.replaceState(null, '', '/');
    appStore.setState({ tg: { inside: false } });
  });

  it('outside Telegram: not inside, and the Telegram chunk is not asked for', async () => {
    const controller = startApp({ heroName: 'You', updates: null });
    try {
      await vi.dynamicImportSettled();
      expect(appStore.getState().tg).toEqual({ inside: false });
      expect(startTelegram).not.toHaveBeenCalled();
    } finally {
      controller.dispose();
    }
  });

  it('inside Telegram: the store says so before the first render, and the shell starts', async () => {
    window.location.hash = fragment(`${INIT_DATA}&start_param=abc`, '8.0', 'ios');
    const controller = startApp({ heroName: 'You', updates: null });
    try {
      expect(appStore.getState().tg).toEqual({ inside: true });
      await vi.dynamicImportSettled();
      expect(startTelegram).toHaveBeenCalledTimes(1);
      expect(startTelegram).toHaveBeenCalledWith({
        win: window,
        store: appStore,
        controller,
        launch: {
          initData: `${INIT_DATA}&start_param=abc`,
          version: '8.0',
          platform: 'ios',
          startParam: 'abc',
        },
        timers: realTimers,
      });
    } finally {
      controller.dispose();
    }
  });
});
