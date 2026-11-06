// @vitest-environment jsdom
/**
 * The ways into About (PLAN §12.1, §12.2, §12.3; chunk 9.2c), wired through the store: Settings'
 * About and the Menu's About open it at the top; the Privacy links of Welcome and Setup open it at
 * its Privacy section. Back returns to the page that opened it. Its page is a lazy chunk of its own
 * (§15.3): the first opening shows the title and "Loading…" until it lands.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialReview } from '../../src/app/review.ts';
import { appStore, initialGame, initialUi } from '../../src/app/store.ts';
import { App } from '../../src/ui/App.tsx';
import { loadScreens } from '../../src/ui/screensModule.ts';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [false, () => {}],
    offlineReady: [false, () => {}],
    updateServiceWorker: async () => {},
  }),
}));

const dispatch = (cmd: Parameters<ReturnType<typeof appStore.getState>['dispatch']>[0]) =>
  act(() => appStore.getState().dispatch(cmd));
const click = (name: string) =>
  act(() => void fireEvent.click(screen.getByRole('button', { name })));
const ui = () => appStore.getState().ui;

/** The frame that About asks for when it mounts, and the chunk if it is still on its way. */
async function settle(): Promise<void> {
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

let scrolled: Element[] = [];

beforeAll(async () => {
  await loadScreens(); // the screens chunk, as App asks for it after the first paint
});

beforeEach(() => {
  scrolled = [];
  Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
    scrolled.push(this);
  };
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
});

const start = (firstLaunch: boolean) =>
  appStore.setState({ game: initialGame(), ui: initialUi(firstLaunch), review: initialReview() });

describe('the ways into About', () => {
  it("Welcome's Privacy: About at its Privacy section, after a short wait for its chunk", async () => {
    start(true);
    render(<App />);
    click('Privacy');
    expect(ui().nav.screens).toEqual(['welcome', 'privacy']);
    // The first opening: the page's title and the delayed "Loading…" line until the chunk lands.
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('About');
    expect(screen.getByText('Loading…')).toBeTruthy();

    await settle();
    expect(screen.queryByText('Loading…')).toBeNull();
    const privacy = screen.getByRole('heading', { level: 2, name: 'Privacy' });
    expect(scrolled).toEqual([privacy]);
    expect(document.activeElement).toBe(privacy);

    click('Back');
    expect(ui().nav.screens).toEqual(['welcome']);
  });

  it("Settings' About: About at the top; Back returns to Settings", async () => {
    start(false);
    render(<App />);
    dispatch({ type: 'go', screen: 'settings' });
    click('About');
    expect(ui().nav.screens).toEqual(['home', 'settings', 'about']);
    await settle();
    const title = screen.getByRole('heading', { level: 1 });
    expect(title.textContent).toBe('About');
    expect(document.activeElement).toBe(title);
    expect(scrolled).toEqual([]);
    expect(screen.getByRole('heading', { level: 2, name: 'How this app works' })).toBeTruthy();
    click('Back');
    expect(ui().nav.screens).toEqual(['home', 'settings']);
  });

  it("the Menu's About: the menu closes and About opens over the screen under it", async () => {
    start(false);
    render(<App />);
    dispatch({ type: 'open', overlay: 'menu' });
    expect(screen.getByRole('dialog', { name: 'Menu' })).toBeTruthy();
    click('About');
    expect(ui().nav).toEqual({ screens: ['home', 'about'], overlays: [] });
    await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Licences' })).toBeTruthy();
    click('Back');
    expect(ui().nav.screens).toEqual(['home']);
  });

  it("Setup's Privacy: About at its Privacy section; Back returns to Setup", async () => {
    start(false);
    render(<App />);
    dispatch({ type: 'go', screen: 'setup' });
    click('Privacy');
    expect(ui().nav.screens).toEqual(['home', 'setup', 'privacy']);
    await settle();
    const privacy = screen.getByRole('heading', { level: 2, name: 'Privacy' });
    expect(document.activeElement).toBe(privacy);
    click('Back');
    expect(ui().screen).toBe('setup');
  });
});
