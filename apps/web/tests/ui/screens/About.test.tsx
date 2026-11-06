// @vitest-environment jsdom
/**
 * The About screen (PLAN §12.1, Appendix G; chunk 9.2c): every section in the §12.1 order with the
 * PLAN's words, the help lines as phone links, the licences of the code that ships, the version,
 * Back, and where the page opens (the top, or its Privacy section for the Privacy links).
 */
import '../../../src/ui/styles/tokens.css';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SHIPPED_PACKAGES } from '../../../src/data/licences.ts';
import { aboutWords as W } from '../../../src/i18n/about.ts';
import { About } from '../../../src/ui/screens/About.tsx';
import { controlCount, smallTargets } from './targets.ts';

const BUILD = { version: '0.1.0', commit: 'abc1234' };

/** apps/web/package.json, whose version the build defines (vite.config.ts `buildInfo`). */
const PACKAGE_JSON = Object.values(
  import.meta.glob<string>('../../../package.json', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
)[0] as string;

/** Runs the frame that About asked for when it mounted (frames run in the order they were asked). */
const nextFrame = () =>
  act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

/** The section under the `<h2>` named `title`. */
function section(title: string): HTMLElement {
  const heading = screen.getByRole('heading', { level: 2, name: title });
  const found = heading.closest('section');
  if (found === null) throw new Error(`no section for ${title}`);
  return found;
}

/** The text of each list item of a section, spaces collapsed. */
const items = (title: string): string[] =>
  within(section(title))
    .getAllByRole('listitem')
    .map((li) => (li.textContent ?? '').replace(/\s+/g, ' ').trim());

let scrolled: HTMLElement[] = [];

beforeEach(() => {
  scrolled = [];
  // jsdom has no layout, so no scrollIntoView: record which element asked for it.
  Element.prototype.scrollIntoView = function scrollIntoView(this: HTMLElement) {
    scrolled.push(this);
  };
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
});

describe('About', () => {
  it('has a title, Back, and the sections in the §12.1 order', () => {
    const onBack = vi.fn();
    render(<About at="top" onBack={onBack} build={BUILD} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('About');
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'How this app works',
      'How the coach works',
      'Privacy',
      'Play money only',
      'Help with gambling',
      'Licences',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('shows how the app works (G.5) and how the coach works (G.6), each line named', () => {
    render(<About at="top" onBack={() => {}} build={BUILD} />);
    expect(items('How this app works')).toEqual(
      W.howItWorks.terms.map((t) => `${t.name} ${t.text}`),
    );
    expect(items('How the coach works')).toEqual(W.coach.terms.map((t) => `${t.name} ${t.text}`));
    // The names are bold, so the lines can be scanned.
    const names = within(section('How this app works')).getAllByText(/:$/, { selector: 'strong' });
    expect(names.map((n) => n.textContent)).toEqual([
      'The game:',
      'Undo:',
      'Levels:',
      'Win chance:',
      'Your data:',
      'The coach:',
      'Fair cards:',
    ]);
  });

  it('shows Privacy (G.2), the full disclaimer (G.1) and the help lines (G.3)', () => {
    render(<About at="top" onBack={() => {}} build={BUILD} />);
    expect(items('Privacy').map((line) => line.split(':')[0])).toEqual([
      'What we store',
      'Where',
      'Why',
      'How to delete it',
      'Hosting',
    ]);
    expect(within(section('Play money only')).getByText(/^This is a free poker/).textContent).toBe(
      'This is a free poker learning game. You play against computer bots with virtual chips that have no value. They cannot be bought, sold, won as prizes, or exchanged for money. Success here does not mean you will win at real-money poker. Intended for adults.',
    );

    const help = section('Help with gambling');
    expect(within(help).getByText(/^If gambling is causing problems/)).toBeTruthy();
    const links = within(help).getAllByRole('link');
    expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['0808 8020 133', 'tel:+448088020133'],
      ['1-800-MY-RESET (1-800-697-3738)', 'tel:+18006973738'],
    ]);
    expect(items('Help with gambling')).toEqual([
      'the UK National Gambling Helpline (GamCare), 0808 8020 133',
      'the US National Problem Gambling Helpline, call or text 1-800-MY-RESET (1-800-697-3738)',
    ]);
  });

  it('every control is at least 44×44 px (§12.12): Back and the two phone numbers', () => {
    const { container } = render(<About at="top" onBack={() => {}} build={BUILD} />);
    expect(controlCount(container)).toBe(3);
    expect(smallTargets(container, () => false)).toEqual([]);
  });

  it('lists every package whose code ships, with its version and licence', () => {
    render(<About at="top" onBack={() => {}} build={BUILD} />);
    const lines = items('Licences');
    expect(lines).toHaveLength(SHIPPED_PACKAGES.length);
    SHIPPED_PACKAGES.forEach((p, i) => {
      expect(lines[i]).toBe(`${p.name} ${p.version} · ${p.licence} · © ${p.copyright}`);
    });
    expect(lines.some((line) => line.startsWith('react 19.3.0 · MIT'))).toBe(true);
  });

  it('ends with the version and the short commit, or the version alone', () => {
    const { unmount } = render(<About at="top" onBack={() => {}} build={BUILD} />);
    expect(screen.getByText('Version 0.1.0 (abc1234)')).toBeTruthy();
    unmount();
    render(<About at="top" onBack={() => {}} build={{ version: '0.1.0', commit: null }} />);
    expect(screen.getByText('Version 0.1.0')).toBeTruthy();
  });

  it("shows the build's own version by default (vite.config.ts, apps/web/package.json)", () => {
    const pkg = JSON.parse(PACKAGE_JSON) as { version: string };
    render(<About at="top" onBack={() => {}} />);
    const line = screen.getByText(/^Version /).textContent ?? '';
    expect(line).toMatch(
      new RegExp(`^Version ${pkg.version.replaceAll('.', '\\.')}( \\([0-9a-f]{4,40}\\))?$`),
    );
  });

  it('opened at Privacy: that heading is scrolled to the top and takes the focus', async () => {
    render(<About at="privacy" onBack={() => {}} build={BUILD} />);
    // The screen change focuses the page title first (ScreenSwitcher), in the same commit.
    screen.getByRole('heading', { level: 1 }).focus();
    await nextFrame();
    const privacy = screen.getByRole('heading', { level: 2, name: 'Privacy' });
    expect(scrolled).toEqual([privacy]);
    expect(document.activeElement).toBe(privacy);
  });

  it('opened at the top: keeps the focus it was given, or takes it when it had none', async () => {
    const { unmount } = render(<About at="top" onBack={() => {}} build={BUILD} />);
    const back = screen.getByRole('button', { name: 'Back' });
    back.focus();
    await nextFrame();
    expect(document.activeElement).toBe(back);
    unmount();

    // The chunk arrived after the screen change: its "Loading…" page held the focus and is gone.
    (document.activeElement as HTMLElement | null)?.blur();
    render(<About at="top" onBack={() => {}} build={BUILD} />);
    await nextFrame();
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
    expect(scrolled).toEqual([]);
  });
});
