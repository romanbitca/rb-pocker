// @vitest-environment jsdom
/**
 * PLAN §12.14 and pitfall 43: a phone at `http://192.168.x.x:3000` is not a secure context. The
 * app detects each secure-context API (`app/secure.ts`), never calls `crypto.randomUUID`, and boots
 * and deals a hand with all of them missing; a storage that throws (private mode) only shows the
 * banner.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startApp } from '../../src/app/boot.ts';
import { detectFeatures, missingFeatures, secureFeatures } from '../../src/app/secure.ts';
import { appStore } from '../../src/app/store.ts';
import { en } from '../../src/i18n/en.ts';
import { createSafeStorage } from '../../src/persist/storage.ts';
import { App } from '../../src/ui/App.tsx';
import { FakeStorage, securityError } from '../persist/fakeStorage.ts';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [false, () => {}],
    offlineReady: [false, () => {}],
    updateServiceWorker: async () => {},
  }),
}));

const SOURCES = import.meta.glob<string>('../../src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('detectFeatures', () => {
  it('a plain-http LAN page: only crypto.getRandomValues', () => {
    const features = detectFeatures({
      isSecureContext: false,
      navigator: { storage: {} },
      crypto: { getRandomValues: () => undefined },
    });
    expect(features).toEqual({
      secureContext: false,
      serviceWorker: false,
      webLocks: false,
      cryptoSubtle: false,
      persistentStorage: false,
      wakeLock: false,
      webShare: false,
      randomValues: true,
    });
    expect(missingFeatures(features)).toEqual([
      'secureContext',
      'serviceWorker',
      'webLocks',
      'cryptoSubtle',
      'persistentStorage',
      'wakeLock',
      'webShare',
    ]);
  });

  it('an https page with everything', () => {
    const features = detectFeatures({
      isSecureContext: true,
      navigator: {
        serviceWorker: {},
        locks: {},
        storage: { persist: () => Promise.resolve(true) },
        wakeLock: {},
        share: () => Promise.resolve(),
      },
      crypto: { subtle: {}, getRandomValues: () => undefined },
    });
    expect(missingFeatures(features)).toEqual([]);
  });

  it('never throws: no window, or getters that throw', () => {
    expect(missingFeatures(detectFeatures(undefined))).toHaveLength(8);
    const hostile = {
      isSecureContext: true,
      get navigator(): unknown {
        throw securityError();
      },
      crypto: {
        get subtle(): unknown {
          throw new Error('blocked');
        },
        getRandomValues: () => undefined,
      },
    };
    const features = detectFeatures(hostile);
    expect(features.serviceWorker).toBe(false);
    expect(features.cryptoSubtle).toBe(false);
    expect(features.randomValues).toBe(true);
  });

  it('secureFeatures() reads this page once (jsdom: no service worker)', () => {
    const features = secureFeatures();
    expect(secureFeatures()).toBe(features);
    expect(features.serviceWorker).toBe(false);
    expect(features.randomValues).toBe(true);
  });
});

describe('never crypto.randomUUID', () => {
  it('no source file calls it (it throws or is missing on insecure pages)', () => {
    const files = Object.entries(SOURCES);
    expect(files.length).toBeGreaterThan(50);
    const callers = files.filter(([, text]) => /randomUUID\s*\(/.test(text)).map(([f]) => f);
    expect(callers).toEqual([]);
  });
});

describe('boot on an insecure page', () => {
  it('boots, shows Welcome and deals a hand with every secure-context API missing', () => {
    vi.useFakeTimers();
    const randomUUID = vi.fn(() => {
      throw new TypeError('crypto.randomUUID is not available on insecure pages');
    });
    vi.stubGlobal('isSecureContext', false);
    vi.stubGlobal('crypto', {
      getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto),
      subtle: undefined,
      randomUUID,
    });
    const storage = createSafeStorage(() => new FakeStorage());
    const controller = startApp({ heroName: en.app.hero, storage });
    try {
      render(<App />);
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(en.app.name);
      fireEvent.click(screen.getByRole('button', { name: en.welcome.play }));
      expect(appStore.getState().ui.screen).toBe('table');
      expect(document.querySelectorAll('[data-hero-cards] [role="img"]')).toHaveLength(2);
      expect(randomUUID).not.toHaveBeenCalled();
    } finally {
      controller.dispose();
    }
  });

  it('a storage that throws shows the banner once; [OK] hides it; play goes on', () => {
    vi.useFakeTimers();
    const storage = createSafeStorage(() => {
      throw securityError();
    });
    const controller = startApp({ heroName: en.app.hero, storage });
    try {
      render(<App />);
      act(() => appStore.getState().dispatch({ type: 'play' }));
      expect(appStore.getState().ui.storageBanner).toBe(true);
      expect(screen.getByRole('alert').textContent).toContain(en.storage.banner);
      fireEvent.click(screen.getByRole('button', { name: en.storage.ok }));
      expect(screen.queryByRole('alert')).toBeNull();
      expect(document.querySelectorAll('[data-hero-cards] [role="img"]')).toHaveLength(2);
    } finally {
      controller.dispose();
    }
  });
});
