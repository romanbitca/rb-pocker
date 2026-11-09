/**
 * Telegram's lazy entry (PLAN §19.7): `boot.ts` loads this only when `parseLaunch` found Telegram.
 * Outside Telegram this chunk is never asked for.
 */
import type { Timers, TableController } from '../controller.ts';
import { setHapticsPort } from '../device.ts';
import type { AppStore } from '../store.ts';
import { createBridge } from './bridge.ts';
import type { TgLaunch } from './launch.ts';
import { createShell, type TgShell } from './shell.ts';

export interface StartTelegramOptions {
  win: Window;
  store: AppStore;
  /** For the multiplayer driver (§19.6), which starts here too. */
  controller: TableController;
  launch: TgLaunch;
  timers: Timers;
}

/** Connects the app to Telegram. The first render is done by now, so `ready` may be said. */
export function startTelegram({ win, store, launch, timers }: StartTelegramOptions): TgShell {
  const bridge = createBridge(win, launch.version);
  const shell = createShell({ win, store, bridge, timers });
  setHapticsPort(shell.haptics);
  return shell;
}
