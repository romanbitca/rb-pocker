/**
 * Shows the screen and overlays a `Nav` names (PLAN §12.1: no router library). The store's `ui`
 * slice holds the `Nav` and the controller changes it with `navigate` (app/navigation.ts); this
 * component only renders. One render function per screen and per overlay, so each screen gets its
 * props from the store where it is wired, and only the screen on show runs.
 *
 * Each screen is keyed by its name: leaving a screen drops its local state (Setup's form starts
 * again from the last-used values). On a screen change the page scrolls to the top and focus moves
 * to the new screen's `<h1>`, so a screen reader announces it (§12.12).
 */
import { Fragment, useEffect, useRef, type ReactNode } from 'react';
import type { Nav, Overlay, Screen } from '../../app/navigation.ts';

export interface ScreenSwitcherProps {
  nav: Nav;
  screens: { readonly [S in Screen]: () => ReactNode };
  /** The open ones render above the screen, in the order they opened. */
  overlays: { readonly [O in Overlay]: () => ReactNode };
}

export function ScreenSwitcher({ nav, screens, overlays }: ScreenSwitcherProps) {
  const screen = nav.screens[nav.screens.length - 1] ?? 'home';
  const holder = useRef<HTMLDivElement>(null);
  const shown = useRef(screen);

  useEffect(() => {
    // The first screen keeps the browser's own focus; later ones take it.
    if (shown.current === screen) return;
    shown.current = screen;
    // `??`: jsdom and very old engines have no scrollingElement.
    (document.scrollingElement ?? document.documentElement).scrollTop = 0;
    const heading = holder.current?.querySelector('h1');
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }, [screen]);

  return (
    <>
      <div ref={holder} key={screen} data-screen={screen}>
        {screens[screen]()}
      </div>
      {nav.overlays.map((overlay) => (
        <Fragment key={overlay}>{overlays[overlay]()}</Fragment>
      ))}
    </>
  );
}
