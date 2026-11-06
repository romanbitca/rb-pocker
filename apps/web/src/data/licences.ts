/**
 * The open-source packages whose code ships to the browser (PLAN §16.4, §12.1 About, Appendix
 * G.6; chunk 9.2c). The About screen lists them; it loads this file with its lazy chunk.
 *
 * A checked static list, not generated at build time: `tests/data/licences.test.ts` fails when
 * `apps/web/package.json`'s dependencies change, when an installed package's version or licence
 * differs from this list, or when THIRD_PARTY_LICENSES.md ("In the game") says otherwise; and
 * `tests/ui/review.bundle.test.ts` fails when the built game holds code from a package that is not
 * here. The bundler's own helpers (Vite's preload helper, Rolldown's runtime) are not listed.
 */
export interface ShippedPackage {
  readonly name: string;
  /** The exact installed version (`package-lock.json`). */
  readonly version: string;
  /** The SPDX id in the package's own package.json. */
  readonly licence: string;
  readonly copyright: string;
  /**
   * How it ships when it is not one of apps/web's own `dependencies`: a dependency of one of them,
   * or the generated service worker (`sw.js`, `workbox-*.js`). The app registers that worker with
   * its own code (`app/swUpdate.ts`, chunk 9.5), so no registration package ships.
   */
  readonly via?: string;
}

const META = 'Meta Platforms, Inc. and affiliates';
const GOOGLE = 'Google LLC';

export const SHIPPED_PACKAGES: readonly ShippedPackage[] = [
  { name: 'react', version: '19.3.0', licence: 'MIT', copyright: META },
  { name: 'react-dom', version: '19.3.0', licence: 'MIT', copyright: META },
  { name: 'scheduler', version: '0.28.0', licence: 'MIT', copyright: META, via: 'react-dom' },
  { name: 'zustand', version: '5.0.15', licence: 'MIT', copyright: 'Paul Henschel' },
  { name: 'workbox-core', version: '7.4.1', licence: 'MIT', copyright: GOOGLE, via: 'sw.js' },
  {
    name: 'workbox-precaching',
    version: '7.4.1',
    licence: 'MIT',
    copyright: GOOGLE,
    via: 'sw.js',
  },
  { name: 'workbox-routing', version: '7.4.1', licence: 'MIT', copyright: GOOGLE, via: 'sw.js' },
  {
    name: 'workbox-strategies',
    version: '7.4.1',
    licence: 'MIT',
    copyright: GOOGLE,
    via: 'sw.js',
  },
];
