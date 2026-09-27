# Third-party licences

RB Poker Coach is built with the open-source software listed below. The game in the browser and
the server's npm packages use permissive licences only: MIT, ISC, BSD-3-Clause, Apache-2.0 or
0BSD. The only other licence among our npm packages is MPL-2.0, for axe-core, an accessibility
test tool that is never shipped.

Keep this file current (PLAN §16.4): update it in the same PR that adds, removes or upgrades a
dependency, or copies in any art. Versions below are the exact ones in `package-lock.json`.

Last checked: 28 September 2026.

## Art, icons, fonts and sounds

- **All art is drawn in code.** The app icons in `apps/web/public/icons/` are drawn by
  `apps/web/scripts/gen-icons.ts` (a light spade on felt). No third-party image is used.
- **Fonts:** the device's system fonts. No font files are shipped.
- **Sounds:** none yet. They will be synthesised with the Web Audio API (no audio files, PLAN
  §12.8).
- **Planned:** a handful of [Lucide](https://lucide.dev) icons (`lucide-static`, ISC), copied
  inline as SVG. Add a row here when the first one is copied. If face-card art is ever wanted,
  use only public-domain or CC0 decks (PLAN §16.4), never LGPL ones.

## In the game (shipped to the browser, `apps/web/dist`)

| Package | Version | Licence | Copyright | Source |
|---|---|---|---|---|
| react | 19.3.0 | MIT | Meta Platforms, Inc. and affiliates | https://github.com/react/react |
| react-dom | 19.3.0 | MIT | Meta Platforms, Inc. and affiliates | https://github.com/react/react |
| scheduler (used by react-dom) | 0.28.0 | MIT | Meta Platforms, Inc. and affiliates | https://github.com/react/react |
| workbox-window (service-worker registration) | 7.4.1 | MIT | Google LLC | https://github.com/GoogleChrome/workbox |
| workbox-core, workbox-precaching, workbox-routing, workbox-strategies (inside the generated `sw.js` and `workbox-*.js`) | 7.4.1 | MIT | Google LLC | https://github.com/GoogleChrome/workbox |
| zustand (a dependency now; in the bundle from the store, chunk 3.1) | 5.0.15 | MIT | Paul Henschel | https://github.com/pmndrs/zustand |

## In the server image (production dependencies of `apps/server`)

Direct dependencies:

| Package | Version | Licence | Copyright | Source |
|---|---|---|---|---|
| @nestjs/common, @nestjs/core, @nestjs/platform-express | 12.1.0 | MIT | Kamil Mysliwiec | https://github.com/nestjs/nest |
| @nestjs/serve-static | 12.0.0 | MIT | Kamil Mysliwiec | https://github.com/nestjs/serve-static |
| helmet | 8.3.0 | MIT | Evan Hahn, Adam Baldwin | https://github.com/helmetjs/helmet |
| reflect-metadata | 0.2.2 | Apache-2.0 | Ron Buckton (Microsoft) | https://github.com/rbuckton/reflect-metadata |
| rxjs | 7.8.2 | Apache-2.0 | Google, Inc., Netflix, Inc., Microsoft Corp. and contributors | https://github.com/ReactiveX/rxjs |

The packages they install (86 more; list them with `npm ls --omit=dev --all -w @rb/server`):

- **MIT:** @borewit/text-codec 0.2.2, @lukeed/csprng 1.1.0, @standard-schema/spec 1.1.0,
  @tokenizer/inflate 0.4.1, @tokenizer/token 0.3.0, accepts 2.0.0, append-field 1.0.0,
  body-parser 2.3.0, busboy 1.6.0, bytes 3.1.2, call-bind-apply-helpers 1.0.2, call-bound 1.0.4,
  content-disposition 1.1.0, content-type 1.0.5, cookie 0.7.2, cookie-signature 1.2.2, cors 2.8.6,
  debug 4.4.3, depd 2.0.0, dunder-proto 1.0.1, ee-first 1.1.1, encodeurl 2.0.0,
  es-define-property 1.0.1, es-errors 1.3.0, es-object-atoms 1.1.2, escape-html 1.0.3, etag 1.8.1,
  express 5.2.1, fast-safe-stringify 2.1.1, file-type 22.1.1, finalhandler 2.1.1, forwarded 0.2.0,
  fresh 2.0.0, function-bind 1.1.2, get-intrinsic 1.3.0, get-proto 1.0.1, gopd 1.2.0,
  has-symbols 1.1.0, hasown 2.0.4, http-errors 2.0.1, iconv-lite 0.7.3, ipaddr.js 1.9.1,
  is-promise 4.0.0, load-esm 1.0.3, math-intrinsics 1.1.0, media-typer 1.1.1,
  merge-descriptors 2.0.0, mime-db 1.54.0, mime-types 3.0.2, ms 2.1.3, multer 2.4.0,
  negotiator 1.1.0, object-assign 4.1.1, object-inspect 1.13.4, on-finished 2.4.1, parseurl 1.3.3,
  path-to-regexp 8.4.2, proxy-addr 2.0.8, range-parser 1.3.0, raw-body 3.0.2, router 2.2.0,
  safer-buffer 2.1.2, send 1.2.1, serve-static 2.2.1, side-channel 1.1.1, side-channel-list 1.0.1,
  side-channel-map 1.0.1, side-channel-weakmap 1.0.2, statuses 2.0.2, streamsearch 1.1.0,
  strtok3 10.3.5, toidentifier 1.0.1, token-types 6.1.2, type-is 2.1.0, uid 2.0.2,
  uint8array-extras 1.6.0, unpipe 1.0.0, vary 1.1.2
- **ISC:** inherits 2.0.4, iterare 1.2.1, once 1.4.0, setprototypeof 1.2.0, wrappy 1.0.2
- **BSD-3-Clause:** ieee754 1.2.1, qs 6.16.0
- **0BSD:** tslib 2.8.1

The image is built on the official `node:24-alpine` Docker image: Node.js (MIT) and Alpine Linux,
whose packages keep their own licences (for example BusyBox, GPL-2.0).

## Test oracles (development only, never shipped)

Independent evaluators that the tests compare our hand evaluator against (PLAN "Testing
strategy", Oracles).

| Package | Version | Licence | Copyright | Source |
|---|---|---|---|---|
| @poker-apprentice/hand-evaluator | 4.3.0 | MIT | Matt Huggins | https://github.com/poker-apprentice/hand-evaluator |
| pokersolver | 2.1.4 | MIT | James Simpson and GoldFire Studios, Inc. | https://github.com/goldfire/pokersolver |

## Build and test tools (development only, never shipped)

| Package | Version | Licence |
|---|---|---|
| @axe-core/playwright, axe-core | 4.13.0 | MPL-2.0 |
| @eslint/js | 10.0.1 | MIT |
| @nestjs/cli | 12.0.5 | MIT |
| @nestjs/testing | 12.1.0 | MIT |
| @playwright/test, playwright, playwright-core | 1.63.0 | Apache-2.0 |
| @swc/core | 1.16.2 | Apache-2.0 |
| @testing-library/dom | 10.4.2 | MIT |
| @testing-library/react | 16.3.3 | MIT |
| @types/express | 5.0.6 | MIT |
| @types/node | 24.19.0 | MIT |
| @types/react, @types/react-dom | 19.3.0 | MIT |
| @types/supertest | 7.2.1 | MIT |
| @vitejs/plugin-react | 6.1.1 | MIT |
| @vitest/coverage-v8 | 5.0.2 | MIT |
| eslint | 10.11.0 | MIT |
| fast-check | 4.10.2 | MIT |
| globals | 17.12.0 | MIT |
| jsdom | 30.1.1 | MIT |
| prettier | 3.9.9 | MIT |
| supertest | 7.3.0 | MIT |
| typescript | 6.0.3 | Apache-2.0 |
| typescript-eslint | 8.70.1 | MIT |
| unplugin-swc | 2.0.0 | MIT |
| vite | 8.3.0 | MIT |
| vite-plugin-pwa (with workbox-build 7.4.1, MIT) | 1.3.0 | MIT |
| vitest | 5.0.2 | MIT |

Their own dependencies are not listed: they are never shipped.

## Licence texts

The full licence text of every package is in its folder under `node_modules/` after `npm ci`
(the `LICENSE` file, or the `license` field of its `package.json` where the package has no
file), and the server image keeps them under `/app/node_modules/`.
