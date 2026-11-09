/**
 * What the device does around a hand (PLAN §12.8, §12.13, chunk 9.1): sounds and vibration
 * (`cues.ts`) and keeping the screen on (`wakeLock.ts`).
 *
 * This file starts a lazy chunk (§15.3): nothing of it is needed before the first tap, so the
 * initial bundle does not carry it. `app/lifecycle.ts` asks for it at boot; it arrives long before
 * a person can tap Play. The synth itself is a second lazy chunk that `cues.ts` loads only while
 * sound is on.
 */
import { installCues, type HapticsPort } from './cues.ts';
import type { AppStore } from './store.ts';
import { installWakeLock } from './wakeLock.ts';

let hapticsPort: HapticsPort | null = null;

/**
 * Inside Telegram its haptic feedback replaces `navigator.vibrate`, which iOS lacks (§19.7);
 * null goes back to `navigator.vibrate`. May come before or after `installDevice`: two lazy chunks.
 */
export function setHapticsPort(port: HapticsPort | null): void {
  hapticsPort = port;
}

/** Sounds, vibration and the wake lock on `store`. Returns one uninstall. */
export function installDevice(win: Window, store: AppStore): () => void {
  const off = [
    installCues(win, store, { haptics: () => hapticsPort }),
    installWakeLock(win, store),
  ];
  return () => {
    for (const f of off) f();
  };
}
