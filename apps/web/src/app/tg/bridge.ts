/**
 * Telegram's event bridge (PLAN §19.7): our own, in a lazy chunk, because the official script is
 * not allowed (`script-src 'self'`). The transports, the ways in and the version rule are the
 * script's (§19.2). No timers, no store: `app/tg/shell.ts` decides what is said and when.
 */

/** A listener gets the event's data as the client sent it: check it before use. */
export type TgListener = (data: unknown) => void;

export interface TgBridge {
  /** In an iframe: Telegram Web. */
  readonly inIframe: boolean;
  /** Sends an event to the client; a no-op where none of the three transports exists. */
  post(type: string, data?: unknown): void;
  on(type: string, listener: TgListener): void;
  off(type: string, listener: TgListener): void;
  /** The client knows this Bot API version: `7.10` is after `7.9`, a missing part is 0. */
  atLeast(version: string): boolean;
}

type Receive = (type: string, data?: unknown) => void;

/** What the bridge reads and writes on the page (§19.2). */
interface TgPage {
  TelegramWebviewProxy?: { postEvent(type: string, data: string): void };
  external?: { notify?(message: string): void } | null;
  Telegram?: { WebView?: object };
  TelegramGameProxy?: object;
  TelegramGameProxy_receiveEvent?: Receive;
}

/** The script's order: > 0 when `a` is the later version. */
function compareVersions(a: string, b: string): number {
  const left = a.trim().split('.');
  const right = b.trim().split('.');
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (parseInt(left[i] ?? '', 10) || 0) - (parseInt(right[i] ?? '', 10) || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function isIframe(win: Window): boolean {
  try {
    return win.parent != null && win.parent !== win;
  } catch {
    return false;
  }
}

/** Connects to the client for `version` and, in an iframe, tells the parent we are ready. */
export function createBridge(win: Window, version: string): TgBridge {
  const page = win as unknown as TgPage;
  const inIframe = isIframe(win);
  const listeners = new Map<string, Set<TgListener>>();

  const receive: Receive = (type, data) => {
    for (const listener of [...(listeners.get(type) ?? [])]) {
      try {
        listener(data);
      } catch {
        // One listener's failure is not the others'.
      }
    }
  };
  page.Telegram = {
    ...page.Telegram,
    WebView: { ...page.Telegram?.WebView, receiveEvent: receive },
  };
  page.TelegramGameProxy = { ...page.TelegramGameProxy, receiveEvent: receive };
  page.TelegramGameProxy_receiveEvent = receive;

  const toParent = (message: { eventType: string; eventData?: unknown }): void => {
    try {
      win.parent.postMessage(JSON.stringify(message), '*');
    } catch {
      // The parent has gone.
    }
  };

  if (inIframe) {
    win.addEventListener('message', (event: MessageEvent<unknown>) => {
      if (event.source !== win.parent || typeof event.data !== 'string') return;
      let message: { eventType?: unknown; eventData?: unknown } | null;
      try {
        message = JSON.parse(event.data) as typeof message;
      } catch {
        return;
      }
      if (typeof message?.eventType !== 'string') return;
      if (message.eventType === 'reload_iframe') {
        toParent({ eventType: 'iframe_will_reload' });
        win.location.reload();
      } else {
        receive(message.eventType, message.eventData);
      }
    });
    toParent({ eventType: 'iframe_ready', eventData: { reload_supported: true } });
  }

  return {
    inIframe,
    // The script sends '' for an event without data.
    post(type, data = '') {
      try {
        const external = page.external;
        if (page.TelegramWebviewProxy !== undefined) {
          page.TelegramWebviewProxy.postEvent(type, JSON.stringify(data));
        } else if (external != null && 'notify' in external) {
          // `window.external` exists in every browser: `notify` is what tells this transport.
          external.notify?.(JSON.stringify({ eventType: type, eventData: data }));
        } else if (inIframe) {
          toParent({ eventType: type, eventData: data });
        }
      } catch {
        // A client that refuses an event must not stop the game.
      }
    },
    on(type, listener) {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    off(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    atLeast: (wanted) => compareVersions(version, wanted) >= 0,
  };
}
