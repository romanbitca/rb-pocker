/**
 * Secure-context feature detection (PLAN §12.14, pitfall 43).
 *
 * A phone that opens the game at `http://192.168.x.x:3000` (the LAN, §17.4) is not a secure
 * context: the service worker, Web Locks, `crypto.subtle`, `crypto.randomUUID`,
 * `navigator.storage.persist()`, the Screen Wake Lock and Web Share are all missing there. Every
 * feature that needs one of them asks this module first and degrades when it is off; nothing may
 * crash the boot:
 * - no service worker → playable online, no "Ready to play offline" toast, no update toast, no
 *   Install tile (§15.1; `useRegisterSW` already does nothing without `navigator.serviceWorker`);
 * - no Web Locks → the `rev` + `storage`-event fallback (§14.7);
 * - no `crypto.subtle` → hand records store `commit: null` (§16.3);
 * - no `persist()` → skipped; Settings says "Protected from automatic clean-up: No" (§14.8);
 * - no Wake Lock → skipped (§12.13); no Web Share → the Export fallbacks (§14.8).
 *
 * ⚠️ Never call `crypto.randomUUID` anywhere (it throws or is missing on insecure pages): ids and
 * seeds come from `crypto.getRandomValues`, which works everywhere (§2.4).
 *
 * Detection only reads properties with `typeof` / `in` checks inside `try`, so a missing or
 * throwing getter (some browsers throw on `navigator.storage` in private modes) turns the feature
 * off instead of throwing. Diagnostics lists the features that are off (`missingFeatures`).
 */

/** The secure-context features the app uses, each `true` when this page can use it. */
export interface SecureFeatures {
  /** `window.isSecureContext` (https, or http://localhost). */
  readonly secureContext: boolean;
  /** `navigator.serviceWorker`: offline play, updates, install (§15.1). */
  readonly serviceWorker: boolean;
  /** `navigator.locks`: one writer at a time (§14.7). */
  readonly webLocks: boolean;
  /** `crypto.subtle`: the provable shuffle's commitments (§16.3). */
  readonly cryptoSubtle: boolean;
  /** `navigator.storage.persist`: protect the data from automatic clean-up (§14.8). */
  readonly persistentStorage: boolean;
  /** `navigator.wakeLock`: keep the screen on while a hand runs (§12.13). */
  readonly wakeLock: boolean;
  /** `navigator.share`: share an export file (§14.8). */
  readonly webShare: boolean;
  /** `crypto.getRandomValues`: needed by every page (§2.4, §12.14 "Unsupported browser"). */
  readonly randomValues: boolean;
}

/** What detection reads: a `window` (or a stand-in in tests). */
export interface FeatureEnv {
  readonly isSecureContext?: boolean;
  readonly navigator?: unknown;
  readonly crypto?: unknown;
}

/** `obj[key]` without throwing (a getter may throw). */
function read(obj: unknown, key: string): unknown {
  if (obj === null || (typeof obj !== 'object' && typeof obj !== 'function')) return undefined;
  try {
    return (obj as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

const isObject = (v: unknown): boolean =>
  v !== null && (typeof v === 'object' || typeof v === 'function');

const isFunction = (v: unknown): boolean => typeof v === 'function';

/** Detects each feature in `env`. Pure apart from reading `env`; never throws. */
export function detectFeatures(env: FeatureEnv | undefined): SecureFeatures {
  const nav = read(env, 'navigator');
  const crypto = read(env, 'crypto');
  const storage = read(nav, 'storage');
  return {
    secureContext: read(env, 'isSecureContext') === true,
    serviceWorker: isObject(read(nav, 'serviceWorker')),
    webLocks: isObject(read(nav, 'locks')),
    cryptoSubtle: isObject(read(crypto, 'subtle')),
    persistentStorage: isFunction(read(storage, 'persist')),
    wakeLock: isObject(read(nav, 'wakeLock')),
    webShare: isFunction(read(nav, 'share')),
    randomValues: isFunction(read(crypto, 'getRandomValues')),
  };
}

/** The names of the features that are off, for Diagnostics (§12.14). */
export function missingFeatures(features: SecureFeatures): (keyof SecureFeatures)[] {
  return (Object.keys(features) as (keyof SecureFeatures)[]).filter((key) => !features[key]);
}

let cached: SecureFeatures | null = null;

/** This page's features, detected once (the answer cannot change while the page lives). */
export function secureFeatures(): SecureFeatures {
  cached ??= detectFeatures(typeof window === 'undefined' ? undefined : window);
  return cached;
}
