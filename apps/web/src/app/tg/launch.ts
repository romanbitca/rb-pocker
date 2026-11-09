/**
 * Was the app launched as a Telegram Mini App (PLAN §19.7)? Telegram puts the launch parameters
 * in the URL fragment (§19.2). This file is in the entry chunk and imports nothing: outside
 * Telegram it is all of §19 that runs, and no other chunk of it loads.
 *
 * A reload may lose the fragment, so its parameters are kept in `sessionStorage`, as Telegram's
 * own script does. A fragment with `tgWebAppData` always wins, empty too: a keyboard button or
 * inline mode opened the app, with no `initData` (§19.2), and that is no Telegram session for us.
 */
export interface TgLaunch {
  /** The raw `initData`, decoded once: what the server checks (§19.9). */
  readonly initData: string;
  /** The client's Bot API version (`bridge.atLeast`). */
  readonly version: string;
  readonly platform: string;
  /** `start_param` of `initData` (a table code or `new`, §19.6), or null. */
  readonly startParam: string | null;
}

/** sessionStorage: the fragment's parameters, for a reload that loses it. */
export const LAUNCH_KEY = 'pc.tg.launch';

type LaunchParams = Omit<TgLaunch, 'startParam'>;

function remembered(win: Window): LaunchParams | null {
  try {
    const p = JSON.parse(win.sessionStorage.getItem(LAUNCH_KEY) ?? 'null') as LaunchParams | null;
    return typeof p?.initData === 'string' &&
      typeof p.version === 'string' &&
      typeof p.platform === 'string'
      ? p
      : null;
  } catch {
    return null;
  }
}

function remember(win: Window, params: LaunchParams): void {
  try {
    win.sessionStorage.setItem(LAUNCH_KEY, JSON.stringify(params));
  } catch {
    // No sessionStorage: a reload that loses the fragment is then a plain page.
  }
}

/** The launch parameters, or null: no Telegram (and nothing else of §19 runs). Never throws. */
export function parseLaunch(win: Window): TgLaunch | null {
  try {
    const fragment = new URLSearchParams(win.location.hash.slice(1));
    const initData = fragment.get('tgWebAppData');
    let params: LaunchParams | null;
    if (initData === null) {
      params = remembered(win);
    } else {
      // The defaults of Telegram's script for a missing parameter.
      params = {
        initData,
        version: fragment.get('tgWebAppVersion') || '6.0',
        platform: fragment.get('tgWebAppPlatform') || 'unknown',
      };
      remember(win, params);
    }
    if (params === null || params.initData === '') return null;
    return { ...params, startParam: new URLSearchParams(params.initData).get('start_param') };
  } catch {
    return null;
  }
}
