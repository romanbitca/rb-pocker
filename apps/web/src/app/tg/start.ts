/**
 * Telegram's lazy entry (PLAN §19.7): `boot.ts` loads this only when `parseLaunch` found Telegram.
 * Outside Telegram this chunk is never asked for.
 */
import type { Timers, TableController } from '../controller.ts';
import { setHapticsPort } from '../device.ts';
import { createMpDriver } from '../mp/driver.ts';
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
  /** The viewer's name at a table of the server's (F.10: "You", from `boot.ts`'s options). */
  heroName: string;
}

/** Connects the app to Telegram. The first render is done by now, so `ready` may be said. */
export function startTelegram({
  win,
  store,
  controller,
  launch,
  timers,
  heroName,
}: StartTelegramOptions): TgShell {
  const bridge = createBridge(win, launch.version);
  const shell = createShell({ win, store, bridge, timers });
  setHapticsPort(shell.haptics);
  // Opens nothing by itself: the socket waits for Play with friends, an invite or a table this
  // device remembers (§19.6).
  createMpDriver({
    store,
    controller,
    timers,
    heroName,
    launch,
    location: win.location,
    confirmClosing: (need) => shell.confirmClosing(need),
    shareInvite: (url, text) => shell.shareInvite(url, text),
  }).launch();
  return shell;
}
