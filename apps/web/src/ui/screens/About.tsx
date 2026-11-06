/**
 * About (PLAN §12.1, Appendix G; chunk 9.2c): how this app works (G.5), how the coach works (G.6),
 * Privacy (G.2), the full play-money disclaimer (G.1), the help lines (G.3), the licences of the
 * code that ships (§16.4) and the version. A lazy chunk of its own (§15.3): `ui/aboutModule.ts`
 * loads it with `import()` from the screens chunk, and the service worker precaches it, so it opens
 * offline. It writes nothing and makes no request (§15.2): the version is the build's
 * (`__PC_BUILD__`, vite.config.ts), never `/api/health` (§2.6).
 *
 * `at` is where it opens: at the top (Settings, the Menu; ScreenSwitcher focuses the `<h1>`), or at
 * its Privacy section (the Privacy links of Welcome and Setup): that heading is scrolled to the top
 * and takes the focus, so a screen reader starts there.
 */
import { useEffect, useRef } from 'react';
import { SHIPPED_PACKAGES } from '../../data/licences.ts';
import { aboutWords as W, type AboutTerm } from '../../i18n/about.ts';
import { en } from '../../i18n/en.ts';
import a from './About.module.css';
import { ScreenBar } from './ScreenBar.tsx';
import styles from './Screen.module.css';

/** The build's version and short commit (vite.config.ts `buildInfo`); null when it was unknown. */
export interface BuildInfo {
  readonly version: string;
  readonly commit: string | null;
}

declare const __PC_BUILD__: BuildInfo;

export interface AboutProps {
  /** Where the page opens: at the top, or at its Privacy section. */
  at: 'top' | 'privacy';
  onBack: () => void;
  /** The build's own by default (`__PC_BUILD__`). */
  build?: BuildInfo | undefined;
}

/** Lines that start with their name in bold (G.2, G.5, G.6). */
function Terms({ terms }: { terms: readonly AboutTerm[] }) {
  return (
    <ul className={a.list}>
      {terms.map((term) => (
        <li key={term.name}>
          <strong>{term.name}</strong> {term.text}
        </li>
      ))}
    </ul>
  );
}

export function About({ at, onBack, build = __PC_BUILD__ }: AboutProps) {
  const page = useRef<HTMLElement>(null);
  const privacy = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    // In the next frame, so after ScreenSwitcher's effect of the same commit (a parent's effects
    // run after its children's), which scrolls to the top and focuses the <h1>.
    const frame = requestAnimationFrame(() => {
      let target: HTMLElement | null | undefined = privacy.current;
      if (at === 'top') {
        // Only when this chunk came after the screen change: its "Loading…" page had the focus.
        const focused = document.activeElement;
        if (focused !== null && focused !== document.body) return;
        target = page.current?.querySelector('h1');
      }
      if (!target) return;
      if (at === 'privacy') target.scrollIntoView({ block: 'start' });
      target.tabIndex = -1;
      target.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [at]);

  return (
    <main ref={page} className={styles.page}>
      <ScreenBar title={en.about} onBack={onBack} />
      <div className={styles.content}>
        <section className={a.section}>
          <h2 className={a.heading}>{W.howItWorks.title}</h2>
          <Terms terms={W.howItWorks.terms} />
        </section>

        <section className={a.section}>
          <h2 className={a.heading}>{W.coach.title}</h2>
          <Terms terms={W.coach.terms} />
        </section>

        <section className={a.section}>
          <h2 ref={privacy} className={a.heading}>
            {W.privacy.title}
          </h2>
          <Terms terms={W.privacy.terms} />
        </section>

        <section className={a.section}>
          <h2 className={a.heading}>{W.playMoney.title}</h2>
          <p className={a.text}>{W.playMoney.text}</p>
        </section>

        <section className={a.section}>
          <h2 className={a.heading}>{W.help.title}</h2>
          <p className={a.text}>{W.help.text}</p>
          <ul className={a.list}>
            {W.help.lines.map((line) => (
              <li key={line.tel}>
                {line.name}{' '}
                <a className={a.phone} href={`tel:${line.tel}`}>
                  {line.number}
                </a>
              </li>
            ))}
          </ul>
        </section>

        <section className={a.section}>
          <h2 className={a.heading}>{W.licences.title}</h2>
          <p className={a.text}>{W.licences.intro}</p>
          <ul className={a.list}>
            {SHIPPED_PACKAGES.map((p) => (
              <li key={p.name}>
                <strong>{p.name}</strong> {p.version} · {p.licence}{' '}
                <span className={a.muted}>· © {p.copyright}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <footer className={styles.footer}>
        <p>{W.version(build.version, build.commit)}</p>
      </footer>
    </main>
  );
}
