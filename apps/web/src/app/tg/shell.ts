/**
 * The app as a Mini App (PLAN §19.7): what it asks of Telegram and what it does with the answers.
 * Ready and expand; Telegram's bars in the felt's colour; the BackButton follows the navigation;
 * no vertical swipes at the Table; the viewport and the safe area as CSS variables; haptics.
 *
 * No timers of its own (§0.3): a delayed haptic goes through the injected `Timers`. Every event
 * that not all clients know is gated (`SINCE`), so we never send one the client does not know.
 */
import type { Cue } from '../../sound/synth.ts';
import type { Timers } from '../controller.ts';
import type { HapticsPort } from '../cues.ts';
import { canGoBack } from '../lifecycle.ts';
import type { AppState, AppStore } from '../store.ts';
import type { TgBridge } from './bridge.ts';

/** The felt's page colour (`--bg`, §12.8): Telegram's bars match it. */
const BAR_COLOUR = '#0f1512';

/** The Bot API version that first knows an event (§19.2). Not listed: every version. */
const SINCE: Readonly<Record<string, string>> = {
  web_app_setup_back_button: '6.1',
  web_app_set_background_color: '6.1',
  web_app_trigger_haptic_feedback: '6.1',
  web_app_setup_closing_behavior: '6.2',
  // 6.1 knows only theme keys for the header; a colour of our own needs 6.9.
  web_app_set_header_color: '6.9',
  web_app_setup_swipe_behavior: '7.7',
  web_app_set_bottom_bar_color: '7.10',
  web_app_request_safe_area: '8.0',
  web_app_request_content_safe_area: '8.0',
};

/** What each cue with a haptic asks of the client (§19.7, in place of its vibration). */
const HAPTIC: Readonly<Partial<Record<Cue, object>>> = {
  turn: { type: 'impact', impact_style: 'light' },
  win: { type: 'notification', notification_type: 'success' },
};

const SIDES = ['top', 'bottom', 'left', 'right'] as const;
type Insets = Readonly<Record<(typeof SIDES)[number], number>>;
const NO_INSETS: Insets = { top: 0, bottom: 0, left: 0, right: 0 };

/** An inset from the client: a size, or 0 for anything else. */
const size = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;

export interface ShellOptions {
  win: Window;
  store: AppStore;
  bridge: TgBridge;
  timers: Timers;
}

export interface TgShell {
  /** Telegram's haptic feedback, or null on a client too old for it (`navigator.vibrate` stays). */
  readonly haptics: HapticsPort | null;
  /** Telegram asks before closing: only while a multiplayer table is on. */
  confirmClosing(need: boolean): void;
  /** Telegram's own share list, for an invite link. */
  shareInvite(url: string, text: string): void;
}

/** Tells Telegram the app is ready and keeps it in step with the store. */
export function createShell({ win, store, bridge, timers }: ShellOptions): TgShell {
  const send = (type: string, data?: unknown): void => {
    const since = SINCE[type];
    if (since === undefined || bridge.atLeast(since)) bridge.post(type, data);
  };
  const setVar = (name: string, value: string): void => {
    win.document.documentElement.style.setProperty(name, value);
  };

  // The safe area is the device's insets (a notch) plus Telegram's own (its header, fullscreen).
  let deviceInsets = NO_INSETS;
  let contentInsets = NO_INSETS;
  const publishInsets = (): void => {
    for (const side of SIDES) {
      setVar(`--tg-safe-${side}`, `${deviceInsets[side] + contentInsets[side]}px`);
    }
  };
  const insetsOf = (data: unknown, last: Insets): Insets => {
    if (typeof data !== 'object' || data === null) return last;
    const given = data as Partial<Record<(typeof SIDES)[number], unknown>>;
    return {
      top: size(given.top),
      bottom: size(given.bottom),
      left: size(given.left),
      right: size(given.right),
    };
  };

  // Listen before asking: an answer may come at once.
  bridge.on('back_button_pressed', () => store.getState().dispatch({ type: 'back' }));
  bridge.on('viewport_changed', (data) => {
    const { height, is_state_stable: stable } = (data ?? {}) as {
      height?: unknown;
      is_state_stable?: unknown;
    };
    if (stable === true && size(height) > 0) {
      setVar('--tg-viewport-stable-height', `${size(height)}px`);
    }
  });
  bridge.on('safe_area_changed', (data) => {
    deviceInsets = insetsOf(data, deviceInsets);
    publishInsets();
  });
  bridge.on('content_safe_area_changed', (data) => {
    contentInsets = insetsOf(data, contentInsets);
    publishInsets();
  });

  send('web_app_ready');
  send('web_app_expand');
  send('web_app_set_header_color', { color: BAR_COLOUR });
  send('web_app_set_background_color', { color: BAR_COLOUR });
  send('web_app_set_bottom_bar_color', { color: BAR_COLOUR });

  let backVisible: boolean | null = null;
  let swipeAllowed: boolean | null = null;
  const follow = (s: AppState): void => {
    const visible = canGoBack(s.ui.nav);
    if (visible !== backVisible) {
      backVisible = visible;
      send('web_app_setup_back_button', { is_visible: visible });
    }
    // The sizing slider must never drag the sheet down.
    const allow = s.ui.screen !== 'table';
    if (allow !== swipeAllowed) {
      swipeAllowed = allow;
      send('web_app_setup_swipe_behavior', { allow_vertical_swipe: allow });
    }
  };
  follow(store.getState());
  store.subscribe((s, prev) => {
    if (s.ui !== prev.ui) follow(s);
  });

  send('web_app_request_viewport');
  send('web_app_request_safe_area');
  send('web_app_request_content_safe_area');

  let closing = false;
  return {
    haptics: bridge.atLeast('6.1')
      ? {
          pulse(cue, delayMs) {
            const feedback = HAPTIC[cue];
            if (feedback === undefined) return;
            const fire = (): void => send('web_app_trigger_haptic_feedback', feedback);
            if (delayMs > 0) timers.setTimeout(fire, delayMs);
            else fire();
          },
        }
      : null,
    confirmClosing(need) {
      if (need === closing) return;
      closing = need;
      send('web_app_setup_closing_behavior', { need_confirmation: need });
    },
    shareInvite(url, text) {
      const path = `/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
      // The script's rule: a client too old for the event opens the link itself.
      if (bridge.inIframe || bridge.atLeast('6.1')) {
        bridge.post('web_app_open_tg_link', { path_full: path });
      } else {
        win.location.href = `https://t.me${path}`;
      }
    },
  };
}
