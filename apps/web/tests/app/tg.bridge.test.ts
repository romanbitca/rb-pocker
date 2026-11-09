/**
 * Telegram's event bridge on a stand-in window (PLAN §19.2, §19.7; Stage 10 acceptance 12): the
 * three transports in their order, the ways in for events, the iframe's handshake and the version
 * rule. A real window's quirk is kept: `window.external` exists everywhere, without `notify`.
 */
import { describe, expect, it, vi } from 'vitest';
import { createBridge } from '../../src/app/tg/bridge.ts';

type Receive = (type: string, data?: unknown) => void;

interface PageFields {
  parent: unknown;
  external?: object;
  TelegramWebviewProxy?: { postEvent: (type: string, data: string) => void };
  Telegram?: { WebView?: { receiveEvent?: Receive; other?: number }; kept?: number };
  TelegramGameProxy?: { receiveEvent?: Receive };
  TelegramGameProxy_receiveEvent?: Receive;
}

interface Fake extends PageFields {
  location: { reload: ReturnType<typeof vi.fn> };
  addEventListener: (type: string, fn: (e: unknown) => void) => void;
}

function fakePage(options: { iframe?: boolean } = {}) {
  const parent = { postMessage: vi.fn() };
  const handlers: ((e: unknown) => void)[] = [];
  const fake: Fake = {
    parent: null,
    external: {},
    location: { reload: vi.fn() },
    addEventListener: (type, fn) => {
      if (type === 'message') handlers.push(fn);
    },
  };
  fake.parent = options.iframe === true ? parent : fake;
  return {
    fake,
    win: fake as unknown as Window,
    parent,
    handlers,
    /** A `message` event on the window. */
    message: (source: unknown, data: unknown): void => {
      for (const fn of handlers) fn({ source, data });
    },
  };
}

const TYPE = 'web_app_setup_back_button';
const DATA = { is_visible: true };
/** The two JSON shapes of §19.2's second and third transports. */
const JSON_DATA = JSON.stringify({ eventType: TYPE, eventData: DATA });

describe('post: the three transports, in order (§19.2)', () => {
  it('TelegramWebviewProxy first: the type and the JSON of the data', () => {
    const { fake, win } = fakePage();
    const postEvent = vi.fn();
    fake.TelegramWebviewProxy = { postEvent };
    createBridge(win, '8.0').post(TYPE, DATA);
    expect(postEvent.mock.calls).toEqual([[TYPE, '{"is_visible":true}']]);
  });

  it('an event without data sends "" as the script does', () => {
    const { fake, win } = fakePage();
    const postEvent = vi.fn();
    fake.TelegramWebviewProxy = { postEvent };
    createBridge(win, '8.0').post('web_app_ready');
    expect(postEvent.mock.calls).toEqual([['web_app_ready', '""']]);
  });

  it('the proxy is the only transport used when there is one', () => {
    const { fake, win, parent } = fakePage({ iframe: true });
    const notify = vi.fn();
    fake.external = { notify };
    const postEvent = vi.fn();
    fake.TelegramWebviewProxy = { postEvent };
    createBridge(win, '8.0').post(TYPE, DATA);
    expect(postEvent).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
    expect(parent.postMessage.mock.calls).not.toContainEqual([JSON_DATA, '*']);
  });

  it('window.external.notify second: one JSON string, called as a method', () => {
    const { fake, win, parent } = fakePage({ iframe: true });
    const external = {
      seen: [] as unknown[],
      notify(this: unknown, message: string) {
        external.seen.push(this, message);
      },
    };
    fake.external = external;
    createBridge(win, '8.0').post(TYPE, DATA);
    expect(external.seen).toEqual([external, JSON_DATA]);
    expect(parent.postMessage.mock.calls).not.toContainEqual([JSON_DATA, '*']);
  });

  it('the parent last, in an iframe: JSON, to any origin', () => {
    const { win, parent } = fakePage({ iframe: true });
    const bridge = createBridge(win, '8.0');
    parent.postMessage.mockClear(); // iframe_ready
    bridge.post(TYPE, DATA);
    expect(parent.postMessage.mock.calls).toEqual([[JSON_DATA, '*']]);
  });

  it('a browser`s window.external (no notify) is passed over', () => {
    const { win, parent } = fakePage({ iframe: true });
    const bridge = createBridge(win, '8.0');
    parent.postMessage.mockClear();
    bridge.post(TYPE, DATA);
    expect(parent.postMessage).toHaveBeenCalledTimes(1);
  });

  it('outside the three it is a no-op, and a missing window.external is fine', () => {
    const { fake, win } = fakePage();
    delete fake.external;
    expect(() => createBridge(win, '8.0').post(TYPE, DATA)).not.toThrow();
  });

  it('a transport that throws does not reach the game', () => {
    const { fake, win } = fakePage();
    fake.TelegramWebviewProxy = {
      postEvent: () => {
        throw new Error('refused');
      },
    };
    expect(() => createBridge(win, '8.0').post(TYPE, DATA)).not.toThrow();
  });
});

describe('events from the client (§19.2)', () => {
  it.each<[string, (fake: Fake) => Receive | undefined]>([
    ['window.Telegram.WebView.receiveEvent', (f) => f.Telegram?.WebView?.receiveEvent],
    ['window.TelegramGameProxy.receiveEvent', (f) => f.TelegramGameProxy?.receiveEvent],
    ['window.TelegramGameProxy_receiveEvent', (f) => f.TelegramGameProxy_receiveEvent],
  ])('%s reaches the listeners with the data', (_name, way) => {
    const { fake, win } = fakePage();
    const bridge = createBridge(win, '8.0');
    const listener = vi.fn();
    bridge.on('back_button_pressed', listener);
    way(fake)?.('back_button_pressed', { a: 1 });
    expect(listener.mock.calls).toEqual([[{ a: 1 }]]);
  });

  it('keeps what else is on window.Telegram', () => {
    const { fake, win } = fakePage();
    fake.Telegram = { kept: 1, WebView: { other: 2 } };
    createBridge(win, '8.0');
    expect(fake.Telegram).toMatchObject({ kept: 1, WebView: { other: 2 } });
    expect(typeof fake.Telegram.WebView?.receiveEvent).toBe('function');
  });

  it('on and off: only the type`s listeners, only while subscribed', () => {
    const { fake, win } = fakePage();
    const bridge = createBridge(win, '8.0');
    const a = vi.fn();
    const b = vi.fn();
    bridge.on('x', a);
    bridge.on('y', b);
    fake.TelegramGameProxy_receiveEvent?.('x');
    bridge.off('x', a);
    bridge.off('never', a);
    fake.TelegramGameProxy_receiveEvent?.('x');
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
  });

  it('a listener that throws does not stop the others, nor the client`s call', () => {
    const { fake, win } = fakePage();
    const bridge = createBridge(win, '8.0');
    const after = vi.fn();
    bridge.on('x', () => {
      throw new Error('boom');
    });
    bridge.on('x', after);
    expect(() => fake.TelegramGameProxy_receiveEvent?.('x', 1)).not.toThrow();
    expect(after).toHaveBeenCalledWith(1);
  });

  it('a listener may unsubscribe while it runs', () => {
    const { fake, win } = fakePage();
    const bridge = createBridge(win, '8.0');
    const after = vi.fn();
    const once = (): void => bridge.off('x', once);
    bridge.on('x', once);
    bridge.on('x', after);
    fake.TelegramGameProxy_receiveEvent?.('x');
    expect(after).toHaveBeenCalledTimes(1);
  });

  it('outside an iframe no message listener is added', () => {
    const { win, handlers } = fakePage();
    createBridge(win, '8.0');
    expect(handlers).toHaveLength(0);
  });
});

describe('in an iframe: Telegram Web (§19.2, §19.7)', () => {
  it('says iframe_ready once at start; outside an iframe nothing', () => {
    const frame = fakePage({ iframe: true });
    expect(createBridge(frame.win, '8.0').inIframe).toBe(true);
    expect(frame.parent.postMessage.mock.calls).toEqual([
      ['{"eventType":"iframe_ready","eventData":{"reload_supported":true}}', '*'],
    ]);
    const top = fakePage();
    expect(createBridge(top.win, '8.0').inIframe).toBe(false);
    expect(top.parent.postMessage).not.toHaveBeenCalled();
  });

  it('an event from the parent reaches the listeners', () => {
    const { win, parent, message } = fakePage({ iframe: true });
    const listener = vi.fn();
    createBridge(win, '8.0').on('viewport_changed', listener);
    message(parent, JSON.stringify({ eventType: 'viewport_changed', eventData: { height: 700 } }));
    expect(listener.mock.calls).toEqual([[{ height: 700 }]]);
  });

  it('only the parent is heard, and only JSON with an eventType', () => {
    const { win, parent, message } = fakePage({ iframe: true });
    const listener = vi.fn();
    const bridge = createBridge(win, '8.0');
    bridge.on('x', listener);
    message({ other: true }, JSON.stringify({ eventType: 'x' }));
    message(win, JSON.stringify({ eventType: 'x' }));
    for (const data of ['not json', 'null', '7', '{}', '{"eventType":3}', { eventType: 'x' }, 5]) {
      expect(() => message(parent, data)).not.toThrow();
    }
    expect(listener).not.toHaveBeenCalled();
  });

  it('reload_iframe: iframe_will_reload, then a reload; no listener sees it', () => {
    const { fake, win, parent, message } = fakePage({ iframe: true });
    const listener = vi.fn();
    const bridge = createBridge(win, '8.0');
    bridge.on('reload_iframe', listener);
    parent.postMessage.mockClear();
    message(parent, JSON.stringify({ eventType: 'reload_iframe' }));
    expect(parent.postMessage.mock.calls).toEqual([['{"eventType":"iframe_will_reload"}', '*']]);
    expect(fake.location.reload).toHaveBeenCalledTimes(1);
    expect(listener).not.toHaveBeenCalled();
  });

  it('a parent that cannot be reached stops nothing', () => {
    const { win, parent } = fakePage({ iframe: true });
    parent.postMessage.mockImplementation(() => {
      throw new DOMException('gone', 'SecurityError');
    });
    expect(() => createBridge(win, '8.0').post(TYPE, DATA)).not.toThrow();
  });

  it('a window whose parent cannot be read is not an iframe', () => {
    const win = {
      get parent(): Window {
        throw new DOMException('denied', 'SecurityError');
      },
    } as unknown as Window;
    expect(createBridge(win, '8.0').inIframe).toBe(false);
  });
});

describe('atLeast: the script`s version rule (§19.7)', () => {
  const { win } = fakePage();
  it.each([
    ['6.0', '6.0', true],
    ['6.0', '6.1', false],
    ['6.10', '6.9', true], // numbers, not text
    ['7.9', '7.10', false],
    ['7.10', '7.10', true],
    ['8', '8.0', true], // a missing part is 0
    ['8.0', '8', true],
    ['8.0.1', '8.0', true],
    ['8.0', '8.0.1', false],
    [' 7.7 ', '7.7', true],
    ['', '6.1', false],
    ['nonsense', '6.1', false],
    ['10.3', '8.0', true],
  ])('client %s, asked %s: %s', (client, wanted, answer) => {
    expect(createBridge(win, client).atLeast(wanted)).toBe(answer);
  });
});
