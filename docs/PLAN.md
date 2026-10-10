# RB Poker Coach - Complete Build Plan

**Document version:** 1.3 · **Date:** 23 September 2026
**Audience:** an AI coding agent that builds the product from an empty repository, and the human who commissioned it. The human will test every stage on their own phone and is not a native English speaker.

> Read the whole document before you write any code. It is self-contained and it is the single source of truth: rules, maths, architecture, UX, copy and build order are all here. If you find something wrong, missing or contradictory, fix this document in the same commit as the code, and write down why in "Open questions and risk register". The document and the code must never disagree.

### Contents

| § | Section | Why you care |
|---|---|---|
| 0 | How to use this document | Stage order, MUST/SHOULD, repo layout, first commits, decisions at a glance |
| 1 | Product definition | What we build, for whom, the assumptions we made, what we do not build |
| 2 | Architecture | Modules, threads, one hand end to end, random streams, stack choices, the small NestJS server |
| 3 | Game rules (No-Limit Hold'em) | The exact rules the engine enforces. Most poker bugs start here |
| 4 | Engine | Pure deterministic state machine: phases, API, invariants, replay, the non-cheating boundary |
| 5 | Evaluator and randomness | Own 7-card evaluator, score packing, best five, seeded RNG and shuffle |
| 6 | Hand-strength indicator | "Full House, Kings full of Fours", highlights, draws, outs, chance by the river |
| 7 | Win chance (equity) | What the % means, exact vs Monte Carlo, update triggers, display rules |
| 8 | Coach | Inputs, policy, sizing, guardrails, grading, explanations, what it must never do |
| 9 | Bots | Personalities × difficulty, mixing, think time, calibration, no cheating |
| 10 | Levels | Bot levels (Easy → Expert) and coach levels (Beginner → Exam), chosen separately |
| 11 | Undo and mistake feedback | Take-backs that teach without allowing "undo until I win" |
| 12 | Screens and mobile UX | Every screen, portrait/landscape/wide layouts, action bar, accessibility, loading/failure states |
| 13 | Hand-rankings panel | All 10 hands "on the right", mini cards, live highlight, phone drawer |
| 14 | Persistence and stats | localStorage (not cookies, and why), atomic commits, resume, export/import |
| 15 | Offline PWA and performance | Service worker, no-network rule, budgets, `#bench` |
| 16 | Privacy, legal and fairness | No consent banner, play-money rules, provable shuffle |
| 17 | Local run, Docker and Coolify deployment | Run it locally first (dev server, `npm start`, Docker), then deploy to the owner's Coolify server; headers; secure context; CI |
| 18 | Staged build plan | Stages 0–9, each shippable, each with acceptance criteria |
| — | Known pitfalls | Mistakes that are easy to make here. Check each one |
| — | Testing strategy | Oracles, property tests, statistical tests, self-play, E2E, devices |
| — | Open questions and risk register | The few questions for the human (with defaults), risks, unverified items |
| A | TypeScript types | The shared type set |
| B | Rules edge-case test vectors | 44 engine vectors with expected results |
| C | Evaluator, equity and RNG oracles | Reference numbers, including golden RNG values |
| D | Hand-information vectors | Names, sub-labels, outs, risky outs, chances |
| E | Coach golden spots | Spots where the advice MUST be a given action |
| F | UI copy, coach templates, glossary | Plain-English strings for non-native readers |
| G | Legal and disclaimer text | Play-money, privacy, help lines |
| H | Storage schema and migration rules | Keys, shapes, commit protocol details |

---

## 0. How to use this document

1. Build the stages in §18 **in order**. Each stage ends with acceptance criteria. A stage is done only when every criterion passes in CI (or on the named device, for device checks) **and** the shared Definition of Done (§18.0) holds. Do not start the next stage with a red build.
2. **MUST** = hard requirement. **SHOULD** = strong default; deviate only with a reason written into this document. **MAY** = optional.
3. **HEURISTIC** marks a strategy starting value. Tune it only through self-play (§9.7) and the golden spots (Appendix E), never by feel, and write the tuned value back here.
4. **UNVERIFIED** marks a fact research could not confirm from a primary source. Each one has a test or a measurement that confirms or replaces it.
5. The engine, evaluator, equity and settlement code is where one bug destroys trust ("this app is rigged", "it paid the wrong player"). Treat it like financial code: invariants on, property tests, independent oracles.
6. ⚠️ marks items where a wrong choice breaks fairness, privacy or trust.
7. The product's personality: a patient teacher sitting next to a beginner at a friendly home game. When this document does not decide something, choose clarity over completeness and a calm table over a flashy one.

### 0.1 Suggested repository layout

An npm-workspaces monorepo: `apps/web` is the game (everything the player runs), `apps/server` is the small NestJS server that serves it (§2.6). **Paths in this document such as `src/…`, `scripts/…`, `tests/…` are relative to `apps/web/`** unless they start with `apps/server/` or name a root file (`package.json`, `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `eslint.config.js`, `scripts/check-deploy.mjs`, `.github/`, `docs/`).

```
rb-poker-coach/
├── package.json                  # "workspaces": ["apps/*"]; scripts: dev, dev:server, build, start, test, test:slow, e2e,
│                                 #   typecheck, size, gen, gen:check, gen:ranges, gen:pushfold, selfplay, docker:up (each delegates with -w); lint, format,
│                                 #   format:check (run at the root); allowScripts (dependency install scripts stay off)
├── package-lock.json             # one lockfile for both apps
├── .npmrc                        # save-exact=true: every dependency is pinned exactly
├── .gitattributes                # src/data/generated is marked generated (collapsed in GitHub diffs) and kept LF, so its checksums hold on every checkout
├── .prettierrc.json              # Prettier: single quotes, width 100; .prettierignore skips Markdown and the lockfile
├── Dockerfile                    # multi-stage, non-root, EXPOSE 3000, HEALTHCHECK on /api/health (§17.3)
├── docker-compose.yml            # one service, port 3000:3000, NODE_ENV=production, SOURCE_COMMIT passed through: the image Coolify runs
├── .dockerignore                 # **/node_modules, **/dist, .git, .claude, .loop, docs, .env* … (§17.3)
├── eslint.config.js              # module-boundary rules (§2.1), the Math.random ban, server-must-not-import-web; MUST fail CI
├── scripts/check-deploy.mjs      # post-deploy header/health/no-cookie check against a URL (§17.6)
├── scripts/build-if-needed.mjs   # `npm run e2e` runs it first: `npm run build` when the build is missing or older than the sources
├── apps/
│   ├── web/                      # package "@rb/web": the game (React + Vite PWA); builds to apps/web/dist
│   │   ├── index.html            # app shell: viewport meta, #root, apple-touch-icon, <noscript>; no inline scripts (meta CSP injected at build, §15.2)
│   │   ├── package.json          # deps: react, react-dom, zustand; scripts: dev, build, test, test:slow, e2e, gen, gen:check, gen:icons, check:html, size, selfplay
│   │   ├── tsconfig.json         # strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes; types: vite-plugin-pwa/react
│   │   ├── tsconfig.node.json    # the same flags with Node types, for vite.config.ts, vitest.config.ts, scripts/ and tests/scripts/
│   │   ├── tsconfig.e2e.json     # the same flags with DOM and Node types, for playwright.config.ts and tests/e2e/
│   │   ├── vite.config.ts        # @vitejs/plugin-react + vite-plugin-pwa (generateSW), worker format 'es', /api proxy to :3000 in dev
│   │   ├── vitest.config.ts      # projects: unit (default) and slow (only *.slow.test.*; SLOW=1 or --project slow)
│   │   ├── playwright.config.ts  # phone, landscape, tablet, desktop projects; Chromium + WebKit; webServer = the Nest-served build (PORT moves it)
│   │   ├── public/
│   │   │   └── icons/            # 192, 512, 512-maskable PNG, apple-touch 180; drawn by scripts/gen-icons.ts
│   │   ├── scripts/
│   │   │   ├── gen-icons.ts      # draws public/icons/*.png in code (a light spade on felt, §16.4); committed output
│   │   │   ├── csp.ts            # META_CSP: the §17.2 CSP minus frame-ancestors, for the build-only meta tag (§15.2)
│   │   │   ├── check-html.ts     # CI: built index.html has no inline script or event handler and carries the meta CSP
│   │   │   ├── gen-preflop.ts    # 169×8 win/tie table + 169×10 final-category table (`npm run gen`, worker_threads)
│   │   │   ├── gen-ranges.ts     # rankPct[169] + eqVsRange[169][13] (`npm run gen:ranges`, worker_threads)
│   │   │   ├── gen-pushfold.ts   # pushPct[k][S], callPct[S] by fictitious play (`npm run gen:pushfold`, worker_threads)
│   │   │   ├── check-tables.ts   # CI (`npm run gen:check`): verify checksums, re-sample 20 random cells, compare
│   │   │   ├── generated.ts      # shared by the gen-* scripts and check-tables: checksums.json, SHA-256, the module text of a table
│   │   │   ├── table-jobs.ts     # the work units of gen-preflop / check-tables and their worker_threads pool (table-worker.ts is the worker entry)
│   │   │   ├── pool.ts           # the generic worker_threads pool of the range scripts (runPool)
│   │   │   ├── range-jobs.ts     # the Monte Carlo work units of gen-ranges / gen-pushfold / check-range-tables (random, range, pair jobs) and their pool (range-worker.ts is the worker entry)
│   │   │   ├── pushfold-solver.ts # the §8.4 game solved by fictitious play for one (k, S), pure arithmetic over a class-against-class matrix
│   │   │   ├── check-range-tables.ts # the range tables' part of `npm run gen:check`: parameters, soundness, §8.3 / §8.4 acceptance, 20 cells re-sampled (called by check-tables.ts)
│   │   │   ├── size-budget.ts    # gzip sizes of dist/ against §15.3 (`npm run size`): a table, exit 1 on a breach
│   │   │   ├── html.ts           # tiny index.html readers shared by check-html.ts and size-budget.ts
│   │   │   ├── check-copy.ts     # CI: coach sentences ≤ 15 words, no missing {placeholders}, glossary keys exist; 1,000 situations generated with the engine
│   │   │   ├── copy-rules.ts     # the rules of check-copy (pure: the tests use them too)
│   │   │   ├── selfplay.ts       # headless bot/coach calibration (§9.7): CLI, statistics, report, gates; `npm run selfplay`
│   │   │   ├── selfplay-jobs.ts  # self-play hands: the real engine + observe + decide/hint, one job per run of hands (no Node imports)
│   │   │   ├── selfplay-worker.ts # worker thread of selfplay.ts
│   │   │   └── bots/             # scripted self-play baselines: simple, raiseAlways, callAlways, potBettor
│   │   ├── src/
│   │   │   ├── main.tsx          # feature check, createRoot(#root).render(<App/>), SW registration hook, starts both workers
│   │   │   ├── core/             # zero dependencies
│   │   │   │   ├── cards.ts      # Card encoding, parse/format, names, aria labels, classOf (169 classes)
│   │   │   │   ├── rng.ts        # sfc32, splitmix32, fnv1a32, deriveSeed, randInt, shuffleRange
│   │   │   │   └── assert.ts     # invariant(), EngineError, InvariantError
│   │   │   ├── eval/
│   │   │   │   ├── tables.ts     # POPCOUNT, STRAIGHT_HIGH, TOP5 (built at module load)
│   │   │   │   ├── evaluate.ts   # score7 / score6 / score5, categoryOf
│   │   │   │   └── describe.ts   # HandInfo: best5, core, kickers, name, subLabel, playsTheBoard
│   │   │   ├── engine/           # pure reducer; imports core + eval only
│   │   │   │   ├── types.ts      # Appendix A.3–A.4
│   │   │   │   ├── table.ts      # createTable, initialSlots, nextTable (button, bot replacement, 3→2 rule), topUp, withLevels
│   │   │   │   ├── start.ts      # startHand: shuffle, deal, post blinds
│   │   │   │   ├── rules.ts      # shared §3 helpers for start/step/settle: live, active, next seat, deal order, blinds, round end, put
│   │   │   │   ├── legal.ts      # legalActions
│   │   │   │   ├── step.ts       # step(state, input): the reducer
│   │   │   │   ├── settle.ts     # uncalled refunds, side pots, odd chips, payouts
│   │   │   │   ├── invariants.ts # checkInvariants(state)
│   │   │   │   ├── observe.ts    # observe(state, seat): the ONLY reader of hidden cards
│   │   │   │   └── replay.ts     # replay(record)
│   │   │   ├── analysis/         # hero-facing maths, pure
│   │   │   │   ├── handinfo.ts   # draws, outs, risky outs, nuts/beaters
│   │   │   │   ├── chances.ts    # chance to finish with each category
│   │   │   │   ├── equity.ts     # exact + Monte Carlo + weighted sampling
│   │   │   │   └── preflop.ts    # typed accessors over src/data tables
│   │   │   ├── brain/            # decisions; never imports engine runtime
│   │   │   │   ├── features.ts  ranges.ts  preflopPolicy.ts  pushfold.ts  postflopPolicy.ts  sizing.ts
│   │   │   │   ├── rangesData.ts  pushFoldData.ts  # typed accessors over the generated range and push/fold tables (§8.3, §8.4); they reach the bundle only through brain.worker (§15.3)
│   │   │   │   ├── guardrails.ts  ev.ts  grade.ts  explain.ts  profiles.ts  opponentStats.ts
│   │   │   │   ├── tunables.ts   # every HEURISTIC constant, nowhere else
│   │   │   │   ├── think.ts      # §9.8 think time (thinkMs), isAllInAction
│   │   │   │   └── decide.ts     # decide(obs, profile, seed), hint(obs, eRandom), grade(...)
│   │   │   ├── workers/
│   │   │   │   ├── protocol.ts   # message types (Appendix A.6)
│   │   │   │   ├── equity.worker.ts # HUD equity, hand analysis, all-in equities; progressive, cancellable
│   │   │   │   ├── brainService.ts  # brain.worker's job runner (no worker globals: tests run it in Node)
│   │   │   │   └── brain.worker.ts  # bot decisions, hints, grades
│   │   │   ├── app/
│   │   │   │   ├── controller.ts # TableController: scheduling, gates, grading/feedback, undo snapshot, epoch
│   │   │   │   ├── workerClient.ts # jobIds, epochs, cancel, stale-reply drop, timeouts
│   │   │   │   ├── store.ts      # the Zustand store: slices game, equity, coach, ui, settings (§2.5)
│   │   │   │   ├── hintJobs.ts   # brain.worker's hint of each hero decision → the coach slice only (§12.6, chunk 5.7)
│   │   │   │   ├── coachViews.ts # coachKeyOf, selectCoach, selectNarration (re-exported by store.ts)
│   │   │   │   ├── botLevels.ts  # the bot level of each seat from the next hand on: levelsOf, nextLevels, sameSeatLevels (§9.3, chunk 7.2)
│   │   │   │   ├── navigation.ts # screens and overlays: the pure navigate() reducer; the ui slice holds its Nav (§12.1)
│   │   │   │   ├── secure.ts     # feature detection for secure-context APIs (§12.14)
│   │   │   │   └── lifecycle.ts  # visibility, wake lock, SW update gating, history/back handling
│   │   │   ├── persist/
│   │   │   │   ├── storage.ts    # safe localStorage wrapper (never throws)
│   │   │   │   ├── schema.ts     # persisted types + hand-written type guards
│   │   │   │   ├── migrations.ts  profile.ts  session.ts  stats.ts  lock.ts  exportImport.ts
│   │   │   ├── ui/
│   │   │   │   ├── components/   # Card, Seat (React.memo), Board, Pot, HeroStrip, WinBadge, DrawChips, CoachStrip,
│   │   │   │   │                 # CoachSheet, ActionBar, SizingTray, FeedbackCard, GradeChip, RankingsPanel,
│   │   │   │   │                 # Modal (the sheet and dialog layer: aria-modal, focus trap, Esc)
│   │   │   │   ├── screens/      # Welcome, Home, Setup, Table, Stats, Settings, Learn, About, Review, Bench; the Menu
│   │   │   │   │                 # sheet and the §3.1 dialogs; ScreenSwitcher (renders the Nav, §12.1)
│   │   │   │   ├── layout/seats.ts # seat coordinate tables and the ellipse formula (§12.4)
│   │   │   │   ├── coachAdvice.ts # the ring and the tray's coach amount (initial bundle, no words)
│   │   │   │   ├── coachModule.ts # loads the coach's lazy chunk (coachEntry.ts: coach.ts, coachText.ts, glossary.ts,
│   │   │   │   │                 # CoachStrip, CoachSheet, i18n/coachUi.ts, i18n/coach.ts + enCoach.ts) and
│   │   │   │   │                 # shares one CoachView (§12.6, §15.3)
│   │   │   │   └── styles/       # tokens.css, global.css, *.module.css
│   │   │   ├── sound/synth.ts    # Web Audio synthesised sounds (no audio files)
│   │   │   ├── data/
│   │   │   │   ├── rankings.ts   # the 10 hand-ranking rows (§13.2)
│   │   │   │   ├── lessons.ts    # 7 short lessons (Appendix F.8)
│   │   │   │   ├── preflopLayout.ts # sizes and decoders of the generated preflop tables (§7.5), no generated imports
│   │   │   │   ├── rangesLayout.ts # sizes, decoders and the §8.3 / §8.4 acceptance checks of the range and push/fold tables, no generated imports
│   │   │   │   └── generated/    # committed outputs of scripts/gen-*.ts + checksums.json; never hand-edited
│   │   │   └── i18n/en.ts        # EVERY user-visible string (Appendix F) but the coach's own (below)
│   │   │       i18n/coach.ts     # renders the coach's lines (template + values → text and glossary links), §8.10
│   │   │       i18n/enCoach.ts   # the coach's F.1 templates and the F.9 glossary (chunk 5.6; lazy chunk since 5.7)
│   │   │       i18n/coachUi.ts   # chunk 5.9: the strip's and the sheet's own words (lazy chunk)
│   │   └── tests/                # mirrors src/; *.slow.test.ts only run in the slow project
│   │       ├── lint/             # eslint.config.js through ESLint's API (§2.1, Stage 0 acceptance 5)
│   │       └── e2e/              # Playwright specs (run against the Nest-served production build); fixtures.ts: the
│   │                             #   `test` every spec uses, with the §15.2 network guard; own-server.ts: a private server to kill
│   └── server/                   # package "@rb/server": NestJS 12, ESM; builds to apps/server/dist (§2.6)
│       ├── package.json          # deps: @nestjs/core, @nestjs/common, @nestjs/platform-express, @nestjs/serve-static, helmet
│       ├── tsconfig.json         # module/moduleResolution nodenext, target ES2023, experimentalDecorators, emitDecoratorMetadata
│       ├── tsconfig.build.json   # what `nest build` compiles: src → dist (dist/main.js)
│       ├── nest-cli.json
│       ├── vitest.config.ts      # unplugin-swc (decorator metadata for DI); projects unit and slow, as in apps/web
│       ├── src/
│       │   ├── main.ts           # configureApp, enableShutdownHooks, listen 0.0.0.0:PORT
│       │   ├── setup.ts          # configureApp(app, nodeEnv?): setGlobalPrefix('api'), X-Powered-By off, helmet +
│       │   │                     #   Permissions-Policy, no-store on /api (§17.2); shared by main.ts and the HTTP tests
│       │   ├── app.module.ts     # ServeStaticModule (apps/web/dist or WEB_DIST_DIR, SPA fallback, cache headers) + HealthModule
│       │   ├── security.ts       # helmet options, CSP string, expected header values, static cache rule (single source, §17.2)
│       │   ├── health.module.ts  # HealthController + HealthService
│       │   ├── health.service.ts # version from package.json, commit from SOURCE_COMMIT (unset or empty → 'dev')
│       │   └── health.controller.ts # GET /api/health → { status, version, commit }
│       └── test/                 # Vitest unit + HTTP e2e (supertest) against fixtures/web-dist, a small apps/web/dist
├── .github/workflows/            # check, e2e, docker, slow (§17.5); no deploy job: Coolify deploys on push
├── docs/PLAN.md                  # this document
└── THIRD_PARTY_LICENSES.md
```

### 0.2 First commits

1. `chore: scaffold monorepo` – npm workspaces (`apps/web`, `apps/server`); web: Vite 8, React 19, Zustand 5, strict TypeScript, CSS Modules, `tokens.css`, Vitest (+ fast-check, @testing-library/react), Playwright; server: NestJS 12 (ESM) with `/api/health`; ESLint with the boundary rules (§2.1), the `Math.random` ban and the server-must-not-import-web rule; Prettier. `npm test` passes in both workspaces with one trivial test each.
2. `ci: pipeline` – GitHub Actions: typecheck, lint, unit tests, build, size budget, server tests, Playwright (Chromium + WebKit) against the Nest-served build. **No deploy job** (Coolify deploys on push once connected, §17.6). A weekly job (§17.5) runs `test:slow` and `selfplay`.
3. `feat: pwa shell served by nest` – manifest, icons, vite-plugin-pwa, build-time meta CSP, a green felt page reading "RB Poker Coach"; the Nest server serves `apps/web/dist` with the §17.2 headers; `Dockerfile`, `docker-compose.yml`, `.dockerignore`; the offline E2E test and the header test. `npm run build && npm start` serves it at `http://localhost:3000`, so the pipeline and the offline guarantee work from day one.
4. `docs: add PLAN.md` – copy this document to `docs/PLAN.md`.
5. `feat(core): cards + rng` – with the golden values of Appendix C.4.
6. `feat(eval): evaluator + describe` – with Appendix C/D tests and the exhaustive count test in the slow project.
7. `feat(engine): types + invariants` – Appendix A types and `checkInvariants` before any reducer logic, so every later commit runs against the invariants.

### 0.3 Conventions

- **Cards:** `Card = rank * 4 + suit`; rank 0..12 = 2..A; suit 0..3 = clubs, diamonds, hearts, spades. Text form `"Ah"`, `"Tc"`. The UI always shows "10", never "T".
- **Chips:** integers only (`Number.isSafeInteger`). Fractions (½ pot) are computed in the brain or UI and rounded to a multiple of the small blind before they reach the engine.
- **Amounts:** always **"raise to"** (the seat's total for the street), never "raise by".
- **Seats:** index 0..n−1, clockwise. The hero is always seat 0 and is drawn at the bottom centre.
- **Pot:** `pot` = every chip in the middle including current street bets (Σ `totalBet`). `need = toCall / (pot + toCall)`.
- ⚠️ **Pot you can win (short calls):** when the hero cannot cover the bet, the part of the bet they cannot match is not theirs to win. For `need`, `EV(call)`, the price chip and coach text use `winPot = hero.totalBet + Σ over other dealt-in seats of min(s.totalBet, T)`, where `T = hero.totalBet + toCall` is the hero's total after calling (`toCall` already capped at the stack). Then `need = toCall / (winPot + toCall)`; when the hero covers the bet, `winPot == pot` and nothing changes. Example: hero and villain have 50 each in (pot 100), villain bets 500 more (pot 600), hero has 50 left → `T = 100`, `winPot = 50 + 100 = 150`, `need = 50 / 200 = 25%`, not `50 / 650 = 8%`. When `winPot < pot`, the numbers line says "Pot you can win {winPot}". Unit test with exactly these numbers.
- **Time:** engine logic is time-free. Only `app/controller.ts` uses timers for game flow. (A component may keep a local input timer that never touches the game, such as the sizing tray's press-and-hold repeat, §12.7, or a display timer such as the big-move line's 4 s, §7.6. The worker clients' job timeouts, Appendix A.6, run on the controller's timers; a worker, on its own thread, only pauses between chunks with `setTimeout(0)`, §7.3.)
- **Randomness:** only through `core/rng.ts`. ESLint bans `Math.random` in `src/`.
- **Strings:** every user-visible string lives in `src/i18n/en.ts`. The brain produces reason codes, never English. The coach's own words live next to it and load with the coach's lazy chunk (§15.3): the Appendix F.1 templates, their placeholder words and the F.9 glossary in `src/i18n/enCoach.ts` (chunk 5.6, rendered by `i18n/coach.ts`; chunk 5.7 moved them out of `en.ts`), the strip's and the sheet's words in `src/i18n/coachUi.ts` (chunk 5.9); the initial bundle carries only the coach words the action bar and the tray need (`en.coachUi`). Exceptions, forced by §2.1 (`core` and `eval` import nothing outside themselves) or by where the data naturally lives: the card words (`RANK_NAMES`, `RANK_PLURALS`, `SUIT_NAMES` in `core/cards.ts`, used by `cardAriaLabel` and the hand names) and the hand names and sub-labels that `describe()` returns (`HAND_TEXT` in `eval/describe.ts`, Appendix F.2–F.3), each kept together in one table so a translation replaces them as well. The 24 bot names (§9.3) are proper names, not translated, and `nextTable` picks them, so they live in `engine/table.ts` (`BOT_NAMES`); the hero's name ("You") comes from `en.ts` through `initialSlots`. The Review screen's words live in `i18n/review.ts` and load with the screen (chunk 6.3, §15.3: the initial bundle does not pay for them); the app's own loading and failure lines for it stay in `en.review`.
- **Imports:** relative imports name the real file. `apps/web` writes `.ts`/`.tsx` (`allowImportingTsExtensions`, as in Vite's own template); `erasableSyntaxOnly` (no enums, namespaces or parameter properties) keeps every web file loadable by Node 24's built-in type stripping, so `scripts/*.ts` can import `src/` without a build step. `apps/server` writes `.js` (`module: nodenext`; `tsc` emits Node ESM).
- **Name:** the product is **RB Poker Coach** (home-screen short name "RB Poker"); every user-visible string uses it. Internal identifiers keep the short `pc` / `poker-coach` form and MUST NOT be renamed (storage keys `pc.v1.*`, the `pc-writer` lock, `window.__pc`, the export file's `app: 'poker-coach'` field), so saved data never needs a migration for the name (§14.2).

### 0.4 Decisions at a glance

| Area | Decision | Short reason |
|---|---|---|
| Game | No-Limit Texas Hold'em cash table, 2–9 seats (you + 1–8 bots), fixed blinds, play chips. Busted bots are replaced | Matches "I select the number of players and the money on the table" |
| Front end | React 19 + Zustand 5 (one store, sliced) + TypeScript + Vite 8 + CSS Modules, in `apps/web` | The human chose React; the most familiar stack for agents |
| Server | NestJS 12 in `apps/server`: serves the built game with security and cache headers, plus `/api/health`. No database, accounts, cookies or game endpoints (§2.6) | The human chose Nest.js; the game itself never needs it after the first load |
| Engine | Pure, seeded, JSON-serialisable reducer on the main thread; new cards appear only on an explicit `advance` input | Undo, replay, resume and "pause before any new card" become simple |
| Heavy maths | Two module workers: `equity.worker` (HUD numbers) and `brain.worker` (bots, hints, grades) | A bot decision never queues behind a long equity job |
| Evaluator | Own bitmask 7-card evaluator; libraries only as test oracles | The UI needs best five, kickers and masks; prototype ran 15.8M evals/s |
| Win % (HUD) | Equity vs the live opponents' **unknown cards dealt at random**, exact or fixed-n Monte Carlo, seeded. Decided (the human left Q2 to us) | Exact, reproducible, testable; changes only when cards appear or players fold |
| Coach number | Equity vs **estimated ranges**; shown next to the HUD number, labelled, whenever they differ by ≥ 5 points or the price needed falls between them (§8.10) | The nuance lives in the coach, where it is explained |
| One brain | `decide(observation, profile, seed)` powers the coach (deterministic TAG profile) and every bot | One code path, tested once |
| Levels | Bots: Easy / Medium / Hard / Expert. Coach: Beginner / Intermediate / Advanced / Exam. Chosen separately | The user asked for levels "for both" |
| Undo | Once per decision point; pause before any new card after a mistake; the unseen stub is **always** reshuffled on undo | No "undo until I win", one code path |
| Storage | localStorage, versioned JSON, atomic single-key commit + backup, export/import. No cookies | Durable enough, synchronous, tiny data |
| Offline | vite-plugin-pwa `generateSW` precaches everything; CSP blocks all remote calls | Works with no internet after the first load |
| Start | One tap: open the app, tap **Play**, a hand is dealt. No sign-up, login or nickname; Setup is optional (§12.1) | "You just open the game, click Play and you start playing" |
| Hosting | Local first (`npm run dev`, `npm start`, `docker compose up`); then one Docker container on the owner's Coolify server, HTTPS from the Coolify proxy, auto-deploy on push to `main` (§17) | The human's own server; no third party sees the traffic |

**Where the drafts and research disagreed, this plan decided:**

| Question | Decision | One-line reason |
|---|---|---|
| HUD win % vs random hands or vs likely hands? | Random hands on the HUD; range equity in the coach, labelled | The HUD number must be verifiable against oracles; a range is a guess and is labelled as one |
| Monte Carlo stop rule | Fixed trial counts, seeded from the situation; 3 s safety cap only | A time cap makes the number depend on the phone |
| One worker or two | Two | No priority scheduler needed; hints stay fast during equity jobs |
| Bot randomness | Stateless per-decision seed from `(tableSeed, handSeq, seat, log length)`, never from the hand (deck) seed | Nothing to snapshot; undo and replay stay deterministic; the seed carries no deck information |
| Undo reshuffle | Always reshuffle the undealt stub | One code path; the player never gets deterministic foresight |
| Undone decision in stats | Still counted in decision stats (flag `undone`); hand results go to the practice bucket | The mistake really happened; results with a take-back are not clean |
| Outs rule | An out must raise the category, use a hole card, and not be a board-pair "improvement" to two pair or less | Verified on the prototype (Appendix D.2) |
| Risky ("dirty") outs | Structural rules R1–R5, not a % threshold | Against one random hand the % that beats you is almost always tiny |
| Coach levels | Four, mirroring the four bot levels | Symmetric "easy → hard for both"; Exam measures progress |
| Rankings drawer on phones | Tap-open right sheet that pauses bots while open | It is modal; a learner must not miss actions behind the scrim |
| Fold when checking is free | Button disabled with an explanatory tooltip | Engine forbids it; keeps muscle memory and teaches the rule |
| Exact enumeration limit | (opponent combos × runouts) ≤ 500,000 | Keeps every exact job under ~150 ms on a mid-range phone |
| Busted bots | Always replaced by a new bot with the starting stack | Table size stays what the user chose; simpler engine paths |

---

## 1. Product definition

### 1.1 The problem

A beginner who wants to learn Texas Hold'em has poor options. Real-money apps bring risk and do not teach. Free social apps bring ads and sign-up and never explain *why*. Trainers are expensive, full of jargon, or limit free hands (one well-known trainer allows about 10 free hands a day). None of them sits next to you and says, in plain words: "You have a pair of Kings. You win about 62%. Bet 2/3 of the pot so worse hands pay you." None of them says, when you get it wrong: "That fold was a mistake. You needed 25% and you had 45%. Undo?" And a learner cannot tell whether a loss was bad luck or a bad decision.

### 1.2 What we are building

**RB Poker Coach**: a free, installable web app (PWA) where one human plays No-Limit Texas Hold'em against 1–8 bots with play chips. At every moment the player can see:

1. **What they have.** "Two Pair, Kings and Sevens", with the five cards that make it highlighted, a plain sub-label ("Top pair, Queen kicker"), and draws ("Flush draw · 9 outs · 35% by the river").
2. **Their chance to win.** A live "Win chance 62%", updated on every street and whenever someone folds.
3. **What to do and why.** A coach hint with action, size and a short reason, plus "Why not raise?".
4. **Their mistakes, and a way back.** A grade after each decision; on a mistake the game pauses before any new card and offers **Undo**. A toolbar Undo takes back the last decision.
5. **All ten poker hands, on the right.** Royal flush to High card with example mini cards; the player's current hand is highlighted live, with their chance to finish with each hand.
6. **Levels for both.** Bot difficulty (Easy → Expert) and coach help (Beginner → Exam).
7. **Stats on this device.** No registration: open the app, tap **Play**, and a hand is dealt. Works fully offline after the first visit.

### 1.3 Who uses it

| User | Needs | Design consequence |
|---|---|---|
| The commissioner: a complete beginner, non-native English reader | Learn hand rankings, when to call or fold, pot odds | Beginner coach by default, rankings always one tap away, sentences ≤ 15 words, glossary |
| Casual player on a phone | Short sessions, one hand, sometimes offline | Portrait layout, big buttons, no timers, resume after any interruption |
| Improving player | Honest feedback, harder opponents | Grading, Advanced/Exam coach, Hard/Expert bots, leaks, stats by level |
| Desktop/tablet user | Same game, bigger screen | Persistent right-hand rankings panel, keyboard shortcuts |

### 1.4 Hard constraints

| # | Constraint | Consequence |
|---|---|---|
| H1 | Free to play, play money only | No purchases, prizes, chip transfers or ads (§16) |
| H2 | Self-hosted, minimal server | One small NestJS container on the owner's Coolify server (§2.6, §17). No database; no per-user data on the server; it only serves the game's files and a health check |
| H3 | No registration | No accounts, identifiers or login |
| H4 | Private | No analytics, no third-party requests, no cookies, no request logging on our server. The CSP blocks third-party requests (§17.2) |
| H5 | Offline after first load | Every asset precached; zero network calls during play, including to our own server (§15) |
| H6 | Mobile-first | Portrait phone 360–430 px wide is the design target; iOS Safari 16.4+ and Android Chrome (last two years); desktop also works |
| H7 | Correct | The engine never breaks the rules in §3; chips are never created or lost (§4.4) |
| H8 | ⚠️ Honest | Bots, coach and HUD never see hidden cards (§4.8, §9.6) |

### 1.5 Assumptions (how we read the brief)

The brief arrived as three short messages from a non-native English speaker. These readings are deliberate. The About screen repeats them in plain words ("How this app works", Appendix G.5), and the human SHOULD confirm them after Stage 3. On 23 Sep 2026 the human re-confirmed the no-account reading in their own words: open the game, click Play, play (§12.1).

- **"Poker"** = **No-Limit Texas Hold'em**, cash-game style (blinds never rise), 2–9 players. **Play money only**: chips cannot be bought, sold, won as prizes or exchanged.
- **"What I should undo if I want"** = two things, both built: (a) an **Undo** button that takes back your own last decision; (b) the coach **flags mistakes right after you act** ("Mistake: you needed 25% and had 45%. Undo?"). Every hint also says what **not** to do ("Why not call?").
- **"Full house, doubles and similar"** = an always-visible hand label ("doubles" = pairs) with the used cards highlighted, plus draws and outs.
- **"% of winning"** = your equity: your share of the pot if the rest of the hand were played out many times, counting split pots as partial wins.
- **"Number of players and the amount of money on the table"** = you choose 2–9 players (you + 1–8 bots), the starting chips for everyone, and the blinds. The screen shows "= 100 big blinds".
- **"Stored in my cookies"** = stored **only on your device, in this browser, with no account**. We use the browser's `localStorage`, not cookies. Cookies are the wrong tool: browsers need to keep only about 4 KB per cookie, cookies are sent over the internet with every request to our site (bad for privacy), and in Safari a cookie written by a web page expires at most 7 days after it was written, so it lasts even less than other storage. localStorage holds 5 MB, never leaves the device, and is just as private. Honest limits: clearing browser data or private mode deletes it, and Safari may delete it after 7 days without a visit unless the game is added to the Home Screen; so we add **Export/Import** of a backup file.
- **"All poker hands on the right, with example cards"** = a persistent right-hand panel on wide screens; on phones a right-edge "Hands" tab that opens a right-side drawer with one tap, without covering the action buttons (§13).
- **"Levels like hard, easy … for both"** = two independent level settings: **bot difficulty** (Easy, Medium, Hard, Expert) and **coach help** (Beginner, Intermediate, Advanced, Exam). "Both" means the opponents and the hints.
- **"Learn … while offline"** = the whole app (game, bots, coach, win %, rankings panel, lessons, stats) works with no connection after the first visit, and installs to the home screen.
- **Language:** English UI with every string in one file, so a translation can be added later.

### 1.6 Non-goals (explicitly out of scope for v1)

- Real money, purchasable chips, prizes, leaderboards with rewards, chip gifting.
- Playing against other humans, chat, accounts, cloud sync or backup, push notifications, any game or data endpoint on the server (§2.6).
- Tournaments (rising blinds, payouts), antes, straddles, run-it-twice, rabbit hunting; other games (Omaha, Stud, Short Deck, Limit).
- Solver-grade (GTO) advice, range editors, hand-history import from poker sites. The coach is a rules-plus-maths teacher and says so.
- Languages other than English (structure ready, translations not).
- Empty seats after a bot busts, custom avatars, themes, native app-store builds.

### 1.7 Prior art and what we take from it

| Product | Users like | Users dislike | What we take |
|---|---|---|---|
| PokerSnowie | EV per action; advice modes Always On / On Demand / Errors / Blunders Only | Paid; a button overlaps the numbers in full screen | Our coach levels mirror its modes; feedback never covers the buttons |
| GTO Wizard Trainer | Clear move grades | About 10 free hands a day | Unlimited free grading is our opening |
| Advanced Poker Training | "Show the working" button | Advisor told a player to fold K-Q on the river getting 6.77-to-1 | Guardrails (§8.8); always show the maths |
| Poker Trainer (mobile) | Offline play, real-time equity | Setup takes too long; the simulator shows opponents' cards | One-tap Play with defaults, Setup optional with ≤ 4 questions; bot cards never shown before showdown |
| Offline Poker (App Store) | Plays offline | Bots fold to re-raises, "reward bad habits"; "the AI knew how the hand would go" | MDF-based defence (§9.4); provable shuffle (§16.3) |
| chess.com vs bots | Hints and take-backs allowed | — | Allow help, but record it honestly (practice vs clean stats) |
| partypoker / PokerStars / GGPoker mobile | Portrait one-handed tables; preset bet buttons | — | Hero at bottom centre; presets before sliders |
| Open-source browser poker (ctbot000/poker-game, mdp/JsPoker) | Monte Carlo bots vs pot odds; `play(state) → wager` | — | The simple Stage 3 bot and the `decide(observation)` shape |

---

## 2. Architecture

### 2.1 Module map and dependency rules

```
core ◄── eval ◄── engine ◄──────────── app ◄── ui
  ▲        ▲        (types only)         ▲
  │        └──── analysis ◄── brain ◄── workers
  └──────────────────────────── persist ─┘
```

| Module | May import | MUST NOT import | Reason |
|---|---|---|---|
| `core` | nothing | anything | Leaf utilities |
| `eval` | `core` | everything else | Pure maths |
| `engine` | `core`, `eval` | `analysis`, `brain`, `app`, `ui`, `persist` | Rules never depend on strategy or UI |
| `analysis` | `core`, `eval`, `data`, `import type` from `engine/types` | `engine` runtime | Hero maths works on cards, not state |
| `brain` | `core`, `eval`, `analysis`, `data`, `import type` from `engine/types`, and its one function `observationKey` | `engine` runtime (`observe`, `start`, `step`) | ⚠️ The brain only ever sees an `Observation` |
| `workers` | `brain`, `analysis`, `eval`, `core`, `data`, `workers/protocol`, `import type` from `engine/types`, and `observationKey` | `engine` runtime, `app`, `ui` | Workers receive observations and hero cards only |
| `workers/protocol` | only `import type`, from `core`, `engine/types`, `analysis`, `brain` | any run-time import | Message types only (Appendix A.6) |
| `persist` | `core`, `engine/invariants`, types | `ui`, `app` | Storage testable without a DOM |
| `app` | all of the above, `sound`; types from any module | `ui` (even its types); `i18n` and `data` at run time | Orchestration |
| `ui` | `app/store`, `core`, `i18n`, `data`, `sound`, types | `engine` reducer, `brain` | The UI dispatches through the controller |
| `data` | only `import type`, from `core` and `eval` | everything else | Static rows and generated tables (§7.5, F.7, F.8) |
| `i18n` | only `import type` | any run-time import | Strings only (§0.3) |
| `sound` | nothing | anything | Web Audio only (§12.8) |
| `main.tsx` | `app`, `ui`, `i18n` | everything else | Entry point: boot and render |

How to read the table (the lint rule reads it the same way):
- A module is a top-level folder of `apps/web/src`; every module may import its own files. `app/store` means `app/store.ts` (or an `app/store/` folder). `workers/protocol` has its own row: the worker files may import it, and it imports only types.
- "Types" means `import type` / `export type` (or an `import('…')` type). With `verbatimModuleSyntax`, an inline `import { type X } from '…'` compiles to `import {} from '…'` and still loads the module, so it counts as a run-time import.
- `observationKey` (A.4) lives in `engine/types.ts`, and the brain (the coach seed, §2.4) and `brain.worker` (the hint cache, §8.11) call it. It reads only an `Observation`, so it is the one run-time name they may take from `engine/types`.
- Anything not in a module's row is forbidden, including files outside `apps/web/src` and folders missing from this table (a new folder needs its row here and in `eslint.config.js` first). npm packages are outside this table.

A small local ESLint rule, `rb/web-module-boundaries` in `eslint.config.js` (its table `WEB_MODULES` mirrors this one), enforces this and MUST fail CI on a violation. It resolves every import to a path (static imports, `export … from`, dynamic `import()`, `import('…')` types), so relative imports at any depth and aliases (`@/`, `~/`, `#`, `src/`, `/src/`, `@rb/web/…`) are all caught; `import()` needs a string literal. The table covers `apps/web/src` and is unchanged by the monorepo. `apps/server` MUST NOT import anything from `apps/web` (it only serves the built files in `apps/web/dist`); the rule `rb/server-no-web-imports` enforces this. `apps/web/tests/lint/boundaries.test.ts` checks both rules and the `Math.random` ban through ESLint's API (Stage 0, acceptance 5). If the server ever needs game code, move `core`, `eval` and `engine` into `packages/game`: the boundary rules already make that a move, not a rewrite (future, not v1).

### 2.2 Threads

| Thread | Runs | Receives | Never receives |
|---|---|---|---|
| Main | UI, `TableController`, engine reducer, `describe()` (label + highlight), persistence | Full `HandState` | — |
| `equity.worker` | HUD win % (progressive, cancellable); hand analysis (draws, outs, risky outs, chances, nuts); all-in run-out equities | Hero hole cards, board, number of live opponents; face-up hands only during a run-out | Any unrevealed bot card |
| `brain.worker` | Bot decisions, coach hints, grades | `Observation` built by `observe(state, seat)` | `HandState`, the deck, other seats' hidden cards |

- The engine stays on the main thread: one `step()` costs microseconds, and keeping the only copy of hidden information there makes the non-cheating boundary physical.
- Two workers, not one: HUD equity jobs can take ~400 ms on slow phones; a bot decision or a grade must not wait behind them. Each worker builds its evaluator tables at start-up (3 × 8,192 entries, < 5 ms).
- Workers are module workers, created literally as `new Worker(new URL('./equity.worker.ts', import.meta.url), { type: 'module' })` (Safari/iOS 15+, Chrome 80+, Firefox 114+). No Comlink: we need cancellation and progressive replies; the hand-written protocol (Appendix A.6) is about 60 lines.
- Implementation (chunk 4.5): `workers/spawn.ts` holds that literal constructor (pitfall 38); `workers/equity.worker.ts` connects `self` to `workers/equityService.ts`, the job runner, which reaches the maths only through its `EquityMath` interface (`workers/equityMath.ts`: `equitySteps`, `runoutSteps`, `analyzeHand` + `chancesByRiver`). On the main thread `app/workerClient.ts` is the protocol client (job ids, epochs, cancel, stale drops, timeouts, restarts, a message log) and `app/equityJobs.ts`, owned by the controller, decides which jobs to send (§7.4) and writes the `equity` slice (A.8). `boot.ts` starts the worker at launch and never waits for it.
- Implementation (chunk 5.8): `workers/brain.worker.ts` connects `self` to `workers/brainService.ts`, the job runner, which reaches the bot brain through one function, `decide(obs, profile, seed): Decision` (Appendix A.5), and computes the think time with `brain/think.ts` (§9.8) in the same reply. Until chunk 5.7 adds the real `brain/decide.ts`, that function is `brain/standIn.ts`, SimpleBot's rules returning a full `Decision`; 5.7 changes the one import in `brain.worker.ts` and deletes the stand-in. `hint`, `grade` and `bench` answer `error` ("not available yet") until chunks 5.7, 6.1 and the `#bench` hint row; since 6.1 `brainService` takes one `coach` function (`brain/grade.ts` `coachAnswer`) for the hint and grade jobs. A job runs to its end inside its own message, so `cancel` has nothing to stop in the worker: the main thread forgets the job and drops any reply (`app/workerClient.ts`, §A.6). `workers/spawn.ts` has the second literal constructor, `app/workerClient.ts` the brain client (`createBrainClient`, `startBrainWorker`, `BOT_TIMEOUT_MS`), and the controller sends each bot decision itself (`sendBot`: slot `bot:<seat>`, epoch, the 2 s timeout owned by the client). `boot.ts` starts both workers at launch. SimpleBot itself is now the self-play baseline `scripts/bots/simple.ts`.

### 2.3 One hand, end to end

```
controller.startNextHand()
  └─ engine.startHand(table, seed) → HandState(phase 'betting')
loop (each await checks the controller epoch):
  if any gate closed (Appendix A.8 `Gate`: hidden tab, off the Table screen, menu, any modal sheet, dialog, feedback card, quiz, tip): wait
  if phase == 'betting' and toAct is a bot:
      obs = observe(state, seat) → brain.worker 'botDecision'
      wait max(decision, think time) → step(act)
  if phase == 'betting' and toAct is the hero:
      save undo snapshot → equity job + analysis job + hint job → enable action bar → wait for tap → step(act)
      → 'grading': grade job (≤ 1,500 ms) → if grade ≥ level threshold: 'feedback' (Undo / Keep my move)
  if phase == 'roundComplete' or 'showdown':
      animation pause → step({kind:'advance'})
  if phase == 'complete':
      commit hand (persist) → result banner → next-hand pause → nextTable() → startNextHand()
save session after every step
```

Key rule: **dealing a new street is a separate engine input** (`advance`). The controller calls it only after grading and feedback are resolved. This is what makes "pause before any new card" possible without hiding data that is already in the state.

### 2.4 Determinism and random streams

| Stream | Seed | Used for |
|---|---|---|
| Table seed | `crypto.getRandomValues(new Uint32Array(4))` → 32-hex `Seed128` | First button, bot names, personalities |
| Hand seed | same, per hand | Root of the hand; stored in the hand record |
| Deck | `deriveSeed(handSeed, 'deck')` | Fisher–Yates of 52 cards at hand start |
| Undo reshuffle | `deriveSeed(handSeed, 'undo', decisionId, undoIndex)` | Reshuffle of the undealt stub (§11) |
| Bot decision | `deriveSeed(deriveSeed(tableSeed, 'bots'), 'bot', handSeq, seat, log.length)` | Noise, mixing and think-time jitter in `decide()`. ⚠️ Never derived from `handSeed`: `deriveSeed` XORs the parent with a keystream from a 32-bit hash, so a child seed reveals its parent after ~2^32 guesses, and the hand seed IS the deck. The bot stream shares no root with the deck |
| Coach/grade Monte Carlo | `deriveSeed(ZERO_SEED, 'coach\|' + observationKey)` | Range-weighted equity |
| HUD equity | `deriveSeed(ZERO_SEED, 'eq\|' + sortedHeroCards + '\|' + board + '\|' + nOpp)` | Win % |
| All-in run-out (known hands) | `deriveSeed(ZERO_SEED, 'run\|' + sortedHands + '\|' + board)`: each hand highest card first, the hands sorted as text and joined by `/` | Equities of the face-up players when the run-out is too big to enumerate (§7.2, preflop) |

Consequences:
- Asking for a hint twice gives exactly the same advice and numbers. The coach never "flickers".
- A bot's decision is a pure function of its observation and seed; there is no bot RNG state to snapshot, so undo cannot desynchronise it.
- The same situation shows the same win % on every device.
- A finished hand replays exactly from `{seed, table, inputs}`. `HandState` has no typed arrays, class instances or `undefined`; `JSON.parse(JSON.stringify(s))` deep-equals `s` (tested).

### 2.5 Technology choices

| Area | Choice (pin exact versions at scaffold) | Reason | Rejected |
|---|---|---|---|
| UI | **React 19.3.0** + **react-dom 19.3.0** (`createRoot`), @types/react and @types/react-dom 19.3.0 | The human chose React; the model agents know best. Costs ~69 KB gzip for React + ReactDOM (measured with Vite 8.3), covered by the §15.3 budget | Preact (the human chose React), Svelte 5 (runes differ from most examples → agent error risk), vanilla (hand-written DOM diffing) |
| Build | **Vite 8.3.0** (Rolldown; needs Node ≥ 22.12), **@vitejs/plugin-react 6.1.1** | Stable, module workers built in | — |
| (all rows) | If a pinned version cannot be installed, use the newest stable release of the same major, pin it exactly, and write it into this table | Versions were current when the plan was written | — |
| PWA | **vite-plugin-pwa 1.3.0** (Workbox 7.4), `generateSW` | Precache manifest from the build | Hand-written SW (cache bugs) |
| Language | **TypeScript ~6.0.3** in both workspaces; `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` | Index bugs are the commonest engine bug class. 6.0, not 7.0: the Nest CLI pins `typescript ~6.0` and TS 7.0 (the Go compiler) ships no compiler API yet | TypeScript 7.0 (until the Nest CLI supports it) |
| State | Pure engine reducer (§4, unchanged) + **one Zustand 5.0.15 store** (`app/store.ts`) with slices `game`, `equity`, `coach`, `ui`, `settings`. The store only holds the reducer's output and UI state; it never runs game logic. Components subscribe with narrow selectors (`useShallow` from `zustand/react/shallow` when selecting several fields); equity progress writes only the `equity` slice; seat components are wrapped in `React.memo`. No router library (§12.1) | Replay, undo, resume and tests are trivial; ~0.9 KB gzip; narrow selectors keep worker progress from re-rendering the table | XState (+12 KB), Redux Toolkit (boilerplate), React context as the store (re-renders every consumer) |
| Styling | CSS Modules + `tokens.css` custom properties | Seat geometry is computed at runtime | Tailwind |
| Evaluator | Own (§5) | Needs best five, kickers, masks | `phe` (rank only, 2018), `poker-evaluator` (130 MB), `@pokertools/evaluator` (no best five). `@poker-apprentice/hand-evaluator` 4.3.0 and `pokersolver` 2.1.4 are **dev-only oracles** |
| Tests | **Vitest 5.0.2** (+ @vitest/coverage-v8 5.0.2; jsdom 30.1.1 for component tests), **fast-check 4.10.2**, **Playwright 1.63.0**, @axe-core/playwright 4.13.0, **@testing-library/react 16.3.3** + @testing-library/dom 10.4.2 (installed explicitly); server: supertest 7.3.0, unplugin-swc 2.0.0 + @swc/core 1.16.2 | Property tests are the main engine defence | — |
| Lint and format | **ESLint 10.11.0** (flat config) + @eslint/js 10.0.1 + **typescript-eslint 8.70.1** `recommended`, globals 17.12.0; **Prettier 3.9.9** | Standard, fast; ESLint also carries the §2.1 boundary rules | — |
| Storage | `localStorage` (§14) | Small data, synchronous, atomic per key | Cookies, IndexedDB in v1 |
| Server | **NestJS 12.1.0** (`@nestjs/core`, `common`, `platform-express`; ESM-only, Express 5), **@nestjs/serve-static 12.0.0**, **helmet 8.3.0**, @nestjs/cli 12.0.5 (§2.6) | The human chose Nest.js; serve-static + helmet cover the whole v1 role | A database, an ORM, auth modules (nothing to store); Nest 12.1's new `app.useSecurityHeaders()` (released 23 Sep 2026; MAY replace helmet later once proven) |
| Hosting | Local first; then the owner's **Coolify v4** server (Dockerfile build pack, Traefik proxy with Let's Encrypt) (§17) | The human's own server; same container locally and in production | Cloudflare / static hosts (the human chose Coolify) |
| Sound | Synthesised with Web Audio | No files, no licences | Audio files |
| Art | Cards drawn in code: rank text + inline SVG suit paths; a few Lucide SVG icons (ISC) copied inline | No licences; legible at 24 px | Bitmap decks, Unicode suits |
| Node | **Node 24 LTS** locally, in CI and in the Docker image (`node:24-alpine`) | Nest 12's CLI needs Node 22.22.3+ or 24.15+; Vite 8 needs 22.12+. Prototypes were measured on Node 22; numbers carry over | Node 20 (end of life) |

Runtime dependencies: `react`, `react-dom`, `zustand` (web); `@nestjs/core`, `@nestjs/common`, `@nestjs/platform-express`, `@nestjs/serve-static`, `helmet` and their peers `reflect-metadata`, `rxjs` (server). Nothing else ships. No web fonts: system font stack.

### 2.6 Server (NestJS)

The server's whole v1 job is to hand the built game to the browser, safely. It lives in `apps/server` and never contains game logic.

| # | Role | Rule |
|---|---|---|
| a | Serve the game | `ServeStaticModule.forRoot({ rootPath: join(import.meta.dirname, '..', '..', 'web', 'dist'), exclude: ['/api/{*splat}', '/assets/{*splat}'], serveStaticOptions: { setHeaders } })`. Unknown paths fall back to `index.html` (SPA). `'/api/{*splat}'` keeps `/api`, `/api/` and `/api/x` out of the fallback (the forms `'/api/*splat'` and `'/api*'` are wrong: the first misses bare `/api`, the second throws). `/assets/{*splat}` is excluded from the fallback so a missing chunk returns **404**, not `index.html` with 200 (which breaks dynamic imports confusingly). `/api` misses get Nest's JSON 404; other misses (a missing `/assets/*` file, a non-GET request) get Express's own 404 page, because Nest 12 mounts its JSON 404 handler under the global prefix only; that page keeps every §17.2 header except the CSP, which Express replaces with its stricter `default-src 'none'` (tested). `WEB_DIST_DIR` overrides `rootPath` (the server tests serve a fixture). ⚠️ The fallback breaks when a folder above `rootPath` starts with a dot (pitfall 44) |
| b | Cache headers | In `setHeaders` (it also runs for the fallback `index.html`): files under `assets/` (judged relative to `rootPath`, so a checkout inside a folder named `assets` changes nothing) → `public, max-age=31536000, immutable`; everything else (`index.html`, `sw.js`, `manifest.webmanifest`, `workbox-*.js`, icons) → `no-cache`. Every `/api` response, its JSON 404s included: `Cache-Control: no-store` (one middleware on `/api` in `configureApp()`) |
| c | Security headers | `helmet` with exactly the §17.2 CSP (`useDefaults: false`), `X-Frame-Options: DENY`, Referrer-Policy `no-referrer`, `X-Content-Type-Options: nosniff`; `Permissions-Policy` set manually (helmet has none). ⚠️ No `upgrade-insecure-requests` (it is a helmet default and breaks `http://localhost` in Safari and every `http://<LAN-IP>` test); HSTS only when `NODE_ENV=production` (and the Coolify proxy terminates HTTPS) |
| d | Health | `GET /api/health` → `200 { status: 'ok', version, commit }` (`version` from `package.json`, `commit` from `SOURCE_COMMIT` at runtime, else `'dev'`). For Docker and Coolify health checks only |
| e | Listen | `app.setGlobalPrefix('api')`, `app.enableShutdownHooks()`, `app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0')`. Started as `node dist/main.js` (PID 1 handles SIGTERM), never through `npm start` inside the container |

**It has none of:** a database, accounts or sessions, game or stats endpoints, cookies (`Set-Cookie` never appears; tested), request logging (so no IP addresses are written anywhere), CORS (everything is same-origin), rate limiting or CSRF middleware (nothing to protect; revisit if an endpoint that changes state is ever added).

⚠️ **Offline rule:** the game MUST work with the server unreachable after the first load (§15), and the client MUST NOT call `/api` during play: `/api/health` is for the orchestrator only (an E2E test fails on any request to `/api`, §15.2). Future server features (optional cloud backup, multiplayer, accounts) are v1 non-goals (§1.6) and may never become required for play.

---

## 3. Game rules (No-Limit Hold'em)

This section is normative: the engine MUST implement exactly these rules, and Appendix B turns each one into a test. Rule references are to the TDA 2024 rules and Robert's Rules of Poker.

### 3.1 Table and seat lifecycle

- A table has a fixed `seatCount` from 2 to 9 for its whole life. Seat 0 is the hero; seats 1..n−1 are bots.
- A seat is **dealt in** for a hand if and only if its stack is > 0 when the hand starts.
- **Busted bots are replaced** before the next hand by a new bot (new name, the seat's level, the next personality from the level's list, §9.3) with the full starting stack. Toast: "Nora sits down." The newcomer posts no missed blind.
- **Busted hero:** the next hand does not start. After the hand-end banner and summary (if any), dialog: "You're out of chips. That's okay: chips are free here." [Reload {startingStack} chips] [Change table]. Reload = `topUp(table, 0, startingStack)` and counts in `reloads`. Change table → Setup; the old table's session ends. The dialog cannot be dismissed any other way (Back returns to Home; Home's Play re-opens the dialog).
- **Several bots bust in one hand** (including "all bots bust"): every one is replaced; one combined toast "Nora, Ben and Sam sit down." The table never runs out of opponents. Between hands the Menu also offers "Top up to starting chips" when the hero is below it (also a reload). Reloads never count as winnings.
- Consequence: in v1 every seat is dealt every hand, so the 3→2 button rule cannot happen in play. The engine still implements it (§3.3) with a test, so future modes are safe.
- Leaving mid-hand does not fold: the session is saved and the hand resumes next time (§14.5). Starting a **new** table while a hand is unfinished asks "Your unfinished hand will be folded. Start a new table?". On yes the controller folds the hero at their next turn (if the hero is already folded or all-in, nothing to fold; when checking is free the hero checks, since folding then is illegal, B32), finishes the hand headlessly (bots at Instant speed, no animation, no UI), commits it, and closes the table. That forced fold is not graded and creates no `DecisionRecord`; the hand counts as a normal hand.

### 3.2 Stakes

- `bb` is an even integer from 2 to 100,000 and `sb = bb / 2`. No antes, no straddles. Blinds never change during a table.
- `startingStack` is an integer from 200 to 1,000,000 **and** between 10 × bb and 500 × bb (Setup enforces this; `createTable` throws `EngineError('BAD_AMOUNT')` otherwise). Depth in big blinds for labels = `floor(startingStack / bb)`.
- `seatCount` 2–9. Defaults: 6 players, 2,000 chips, blinds 10/20.

### 3.3 Button and blinds

- **First hand:** button = `randInt(seatCount)` from the table seed (engine mode: if that seat is not dealt in, the next dealt-in seat clockwise). **Next hands:** the button moves to the next dealt-in seat clockwise (simplified moving button, not a dead button: someone may occasionally skip or repeat a blind in future modes; acceptable for play money). `TableState.button` keeps the last hand's button; `startHand` moves it (`buttonForHand`).
- **3+ players:** SB = first dealt-in seat left of the button; BB = the next dealt-in seat.
- **Heads-up:** the button posts the SB; the other seat is the BB. The general rules below then give the correct order automatically: preflop the button acts first; after the flop the BB acts first (TDA r.34).
- **3 → 2 transition (engine only):** if the previous hand's BB is still dealt in, that player gets the button/SB, so nobody posts the BB twice in a row (TDA r.34). The engine applies this to every hand with two seats dealt in (`prevBB` is a seat): in a steady heads-up game it is the usual alternation.
- **Short blinds:** a player who cannot cover a blind posts the whole stack and is all-in. Even if the BB is short, `currentBet` starts at the full `bb`; callers must put in the full `bb`, and any excess is returned as uncalled (§3.8). A common room convention (UNVERIFIED as a TDA rule; our decision).
- Posting a blind is **not** an action (it does not set `lastActedAtBet`). This is how the BB gets its option.

### 3.4 Dealing

- At hand start the full 52-card deck is shuffled once (Fisher–Yates, §5.6). The order is then fixed, except for an undo reshuffle of the undealt part (§11).
- Hole cards: one card at a time, starting with the first dealt-in seat left of the button, two rounds. Heads-up this gives the BB the first card and the button the last.
- Deck positions, with `k` = number of dealt-in seats:

| Deck positions | Use |
|---|---|
| `0 .. 2k−1` | Hole cards, round-robin as above |
| `2k` | Burn |
| `2k+1 .. 2k+3` | Flop |
| `2k+4` | Burn |
| `2k+5` | Turn |
| `2k+6` | Burn |
| `2k+7` | River |

`deckPos` is the index of the next card to use. Burns do not change odds; they keep replays faithful to a physical deal.

### 3.5 Legal actions

For the seat to act, `toCall = currentBet − streetBet`. "A responder exists" means at least one **other** dealt-in seat is not folded and not all-in.

| Action | Legal when | Amount (street total, "to") |
|---|---|---|
| fold | `toCall > 0` | — |
| check | `toCall == 0` | — |
| call | `toCall > 0` | puts in `min(toCall, stack)`; less than `toCall` means all-in |
| bet | `currentBet == 0` (postflop only) and a responder exists | `to ∈ [min(bb, stack), stack]` |
| raise | `currentBet > 0`, `stack > toCall`, `raiseReopened(p)`, and a responder exists | `to ∈ [min(currentBet + minRaiseInc, streetBet + stack), streetBet + stack]` |

- `raiseReopened(p) = p.lastActedAtBet === null || (currentBet − p.lastActedAtBet) ≥ minRaiseInc`, where `lastActedAtBet` is `currentBet` right after the player's last voluntary action this street.
- ⚠️ Folding when a check is free is **illegal** in the engine. The UI disables the Fold button in that case (§12.7).
- There is no time bank and no auto-fold for the human.

### 3.6 Raise sizes and reopening

- `minRaiseInc` starts every street at `bb`. For a bet or raise to `to`: `inc = to − currentBet`.
  - `inc ≥ minRaiseInc` → **full raise**: `minRaiseInc = inc`, `currentBet = to`, `lastAggressor = seat`.
  - `inc < minRaiseInc` (only possible all-in) → **incomplete raise**: `currentBet = to`, `minRaiseInc` unchanged, `lastAggressor = seat`.
- An incomplete raise, or several that together are less than a full raise, does **not** reopen betting for players who already acted (TDA r.47). `raiseReopened` measures from the level where the player last acted, so cumulative short all-ins that add up to a full raise do reopen it (vector B8).
- A postflop all-in opening bet below `bb` is incomplete; the next minimum raise-to is `currentBet + bb` (our decision, UNVERIFIED as a universal room rule; vector B37). Players who **checked** earlier on that street have already acted and do not face a full bet, so `raiseReopened` is false for them: call or fold only. Players who have not acted yet may raise.
- An all-in raise exactly equal to the minimum raise is a full raise and reopens betting.
- String raises and the "50% rule" are live-dealer rules; they do not apply because the UI only submits legal "raise to" amounts.

### 3.7 End of a round, next street, run-out, fold win

Let `L` = dealt-in, non-folded seats ("live") and `A` = seats in `L` that are not all-in ("active").

- **Won by folds:** as soon as `|L| == 1`, betting stops, uncalled chips are refunded (§3.8), and the hand settles on the next `advance`. No cards are shown.
- **Betting round complete** when: `|A| == 0`; or `|A| == 1` and that seat faces no bet (`streetBet ≥ currentBet`; as `currentBet` is the largest street bet, it then has at least as much in as every other live seat); or `|A| ≥ 2` and every seat in `A` has `lastActedAtBet !== null` and `streetBet == currentBet`. The `|A| == 1` rule matters preflop against a short all-in BB: `currentBet` is still the full `bb` (§3.3), so a small blind with more in than the BB must still call or fold (B34), heads-up too.
- On round completion: refund uncalled chips, `phase = 'roundComplete'`, `toAct = null`.
- **Next street** (on `advance`): reset every `streetBet = 0` and `lastActedAtBet = null`; `currentBet = 0`, `minRaiseInc = bb`, `lastAggressor = null`; burn and deal. If `|A| ≥ 2`, first to act = first seat of `A` clockwise **strictly after** the button, wrapping (so the button, if active, acts last); otherwise no betting (run-out).
- **Preflop first to act:** the first seat of `A` clockwise strictly after the BB, wrapping (heads-up this is the button/SB).
- **All-in run-out:** when a round completes with `|L| ≥ 2` and `|A| ≤ 1`, remaining streets are dealt with no betting, one street per `advance` so the UI can animate. At the first `advance` of the run-out, **all live hands turn face up** (TDA r.16). The app shows everyone's live equity during the run-out ("TV mode", §7.6).

### 3.8 Uncalled chips, side pots, odd chips

**Uncalled refund** (whenever a round completes and when the hand is won by folds): `top` = the largest `streetBet` of any dealt-in seat (folded included), `second` = the largest among all other seats. If `top > second`, move `top − second` from that seat's `streetBet` and `totalBet` back to its stack (TDA r.15-B). It goes to that seat even if it folded (only possible with forced blinds, vector B34). Idempotent.

**Side pots** (at settlement):

```
live   = dealt-in seats with !folded
levels = sorted unique values of live.map(s => s.totalBet), ascending
prev = 0; pots = []
for L of levels:
  amount   = Σ over ALL dealt-in seats of (min(s.totalBet, L) − min(s.totalBet, prev))   // folded money included
  eligible = live seats with totalBet ≥ L
  if amount > 0:
     if pots.last exists and pots.last.eligible equals eligible: pots.last.amount += amount
     else pots.push({ amount, eligible })
  prev = L
invariant: Σ pots.amount == Σ totalBet
```

- With the levels taken from live seats only, two consecutive levels never have the same eligible seats (each level leaves out the live seat(s) whose total was the level below), so the merge line never applies; `settle.ts` leaves it out and a property test checks that the eligible seats strictly shrink from the main pot up. The independent oracle, which cuts at every seat's total (folded seats included), needs the merge.
- Each pot is settled separately (TDA r.21). A pot with one eligible seat is awarded without comparing hands. Side pots are animated before the main pot, and the log awards them in that order: one `award` event per pot, the last side pot first and the main pot last (`award.pot` is the index into `result.pots`, main pot = 0).
- **Odd chips:** for a pot split `k` ways, `share = floor(amount / k)`, `rem = amount % k`; order the winners clockwise starting from the first seat left of the button; the first `rem` winners get one extra chip (TDA r.20), per pot independently.

### 3.9 Showdown

- Cards speak: the evaluator decides (`score7` of the two hole cards and the five board cards; equal scores split).
- `result.shown` lists the live hands in the reveal order with their score, category and best five cards, chosen by the §5.4 rule (the same cards `describe().best5` gives).
- **Order:** if there was a bet or raise on the river, the river's last aggressor shows first; otherwise the first live seat left of the button; then clockwise (TDA r.17). In a run-out all live hands are already face up.
- **Learning decision:** every hand that reaches showdown is revealed, animated in that order. Bots never muck.
- **Folded hands are never revealed**, not even at hand end or in review. A hand won by folds shows no cards.

---

## 4. Engine: pure deterministic state machine

### 4.1 Phases

```
            startHand()
                │
                ▼
   ┌──────► betting ──act──► betting (next seat)
   │            │
   │          act (round complete, or only one live seat)
   │            ▼
   │      roundComplete ──advance──► betting (next street, ≥ 2 active)
   │            │                       └─► roundComplete (run-out street, ≤ 1 active)
   │            ├──advance (river done, ≥ 2 live)──► showdown ──advance──► complete
   │            └──advance (1 live)────────────────────────────────────► complete
```

| Phase | `toAct` | Accepted inputs |
|---|---|---|
| `betting` | seat index | `act` for that seat only; `reshuffle` (undo only) |
| `roundComplete` | `null` | `advance`; `reshuffle` (undo only) |
| `showdown` | `null` | `advance` |
| `complete` | `null` | none (use `nextTable` + `startHand`) |

Every card that becomes visible (a new street, face-up hands in a run-out, showdown hands) becomes visible only through `advance`. The controller decides when `advance` happens.

### 4.2 API

```ts
// engine/table.ts
initialSlots(cfg: TableConfig, tableSeed: Seed128, heroName: string): PlayerSlot[];  // the hero + seeded bots (§9.3), all at startingStack
createTable(cfg: TableConfig, slots: PlayerSlot[], tableSeed: Seed128): TableState;  // button −1; needs two players with chips
nextTable(table: TableState, done: HandState): TableState;       // stacks, button, bot replacement (deterministic from tableSeed);
                                                                 //   done must be complete, pass checkInvariants and come from this table
topUp(table: TableState, seat: number, toStack: number): TableState;  // hero reload / top-up between hands only; reloads += 1; seat 0, stack < toStack ≤ startingStack
withLevels(table: TableState, botLevel: BotLevel, seatLevels: (BotLevel | null)[]): TableState;  // level change, between hands only
buttonForHand(table: TableState): number;                        // §3.3: the button startHand will use
validateTable(table: TableState): void;                          // throws EngineError for a corrupt table (every function above checks it)
BOT_NAMES; PERSONALITY_LISTS; nameOrder(tableSeed): string[];    // §9.3 data and the table's name order
// engine/start.ts
deckFromSeed(handSeed: Seed128): Card[];                         // §2.4: Fisher–Yates of 0..51 with deriveSeed(handSeed, 'deck')
startHand(table: TableState, handSeed: Seed128): HandState;       // shuffle, deal, post blinds → 'betting', or 'roundComplete' when the blinds already end the round (§3.7: heads-up with an all-in small blind, B36)
// engine/legal.ts
legalActions(h: HandState): LegalActions | null;                  // null unless phase === 'betting'
// engine/step.ts
step(h: HandState, input: EngineInput): HandState;                // pure; throws EngineError on illegal input
// engine/observe.ts
observe(h: HandState, seat: number, extras: ObserveExtras): Observation;
// engine/replay.ts
replay(rec: ReplayRecord): HandState;
// engine/invariants.ts
checkInvariants(h: HandState, options?: { replayLog?: boolean }): void; // throws InvariantError listing every broken invariant; replayLog adds I12 (tests)
```

`step` MUST NOT mutate its input: deep-clone (the state is small plain JSON), change the clone, run `checkInvariants`, return the clone. In development builds, deep-freeze returned states so accidental mutation throws ("development" = `import.meta.env.DEV`: the Vite dev server and Vitest; production builds and plain-Node scripts, where `import.meta.env` does not exist, skip it). An input `step` refuses throws `EngineError` and changes nothing: `BAD_PHASE` when it does not fit the phase (an action outside `betting`, `advance` outside `roundComplete`/`showdown`, a reshuffle outside `betting`/`roundComplete` or after a reveal), `NOT_YOUR_TURN` for an action by a seat other than `toAct`, `ILLEGAL_ACTION` for a malformed input or an action the seat may not take now (§3.5, B32), `BAD_AMOUNT` for a bet or raise outside the `legalActions` bounds (or not a whole number) and for a negative or fractional undo counter, `UNDO_USED` for a second reshuffle of the same decision (§11.3).

Bad input to the table and start functions throws `EngineError`: `BAD_AMOUNT` for a number out of range (seat count, blinds, stacks, seats, counters), `ILLEGAL_ACTION` for an invalid choice (slot kind, personality, level, name, seed), `BAD_PHASE` when the call does not fit the state (`nextTable` with a hand that is not over or not from this table, `startHand` with fewer than two players with chips). `startHand` returns a state that passes `checkInvariants`.

### 4.3 Reducer algorithm

```
applyAct(h, seat, action):
  require h.phase == 'betting' and h.toAct == seat
  require action is inside legalActions(h)                    // exact bounds, else EngineError
  p = h.seats[seat]
  fold  → p.folded = true
  check → (nothing)
  call  → put(p, min(h.currentBet − p.streetBet, p.stack))
  bet/raise(to):
      before = h.currentBet; put(p, to − p.streetBet); inc = to − before
      if inc ≥ h.minRaiseInc: h.minRaiseInc = inc; if street == 'preflop': h.preflopAggressor = seat
      h.currentBet = to; h.lastAggressor = seat
  if action != fold: p.lastActedAtBet = h.currentBet
  append log {e:'act', …}
  if |live| == 1 or roundComplete(h): refundUncalled(h); h.phase = 'roundComplete'; h.toAct = null
  else: h.toAct = next seat clockwise after `seat` that is live, not all-in,
                  and NOT (lastActedAtBet !== null and streetBet == currentBet)

put(p, x): x = min(x, p.stack); p.stack −= x; p.streetBet += x; p.totalBet += x; if p.stack == 0: p.allIn = true

advance(h):
  require h.phase in {'roundComplete', 'showdown'}
  if h.phase == 'showdown' or |live| == 1: settle(h); h.phase = 'complete'; return
  if |active| ≤ 1 and not h.runout: h.runout = true; h.revealed = live seats in §3.9 order; append log {e:'reveal', reason:'runout'}
  if h.street == 'river':
      h.phase = 'showdown'
      if not h.runout: { h.revealed = live seats in §3.9 order; append log {e:'reveal', reason:'showdown'} }
      return
  // a run-out that starts on the river (all-in called on the river) sets runout, reveals, and goes straight to 'showdown' in this same advance
  reset street fields; burn; deal next street; append log {e:'street'}
  if |active| ≥ 2: h.phase = 'betting'; h.toAct = first active clockwise from the button
  else:            h.phase = 'roundComplete'                  // run-out continues on the next advance

reshuffle(h, decisionId, undoIndex):                         // only from the controller's undo (§11)
  require h.phase in {'betting','roundComplete'} and h.revealed is empty and decisionId ∉ h.undoneDecisions
  Fisher–Yates on h.deck[h.deckPos .. 51] with rngFromSeed(deriveSeed(h.seed, 'undo', decisionId, undoIndex))
  h.undoneDecisions.push(decisionId); append log {e:'reshuffle', decisionId, undoIndex}
```

### 4.4 Invariants

`checkInvariants(h)` MUST check all of these after every step, in development, tests **and production** (cost < 0.1 ms). "Also:" parts are the checks `engine/invariants.ts` adds to a row; I0 and I15 are its own rows. It reports every broken invariant, each message starting with its id ("I7 all-in flag: seat 1: …"), and it is written independently of `start.ts`, `step.ts` and `settle.ts` (it re-derives the deal order, the blind seats and the §3.7 round end itself), so a slip there is caught instead of copied.

| # | Invariant |
|---|---|
| I0 | The state is well-formed: `schema: 1`, 2–9 seats and per-seat arrays of that length, seat indices in range, a known street, phase and log events, `bb` even ≥ 2 and `sb = bb / 2`. If this fails, nothing else is checked |
| I1 | **Chip conservation.** If `phase != 'complete'`: `Σ (stack + totalBet) == h.startTotal`. If `complete`: `Σ stack == h.startTotal` and `Σ result.payouts == Σ totalBet`. Also: `startTotal == Σ startStacks`; before `complete`, per seat `stack + totalBet == startStacks[i]` (chips move between seats only at settlement; a refund goes back to the seat that bet it); at `complete`, `Σ pots == Σ totalBet`, `net[i] == payouts[i] − totalBet[i]` and `stack == startStacks[i] + net[i]` |
| I2 | Every amount is a safe, non-negative integer (stacks, bets, blinds, pots, payouts and the amounts in the log; `net` is a safe integer of either sign) |
| I3 | For every seat `0 ≤ streetBet ≤ totalBet` |
| I4 | While betting, `currentBet == max(max streetBet, street == 'preflop' ? bb : 0)`; `currentBet` never decreases within a street (one state cannot show that: the I12 log replay checks it) |
| I5 | `minRaiseInc ≥ bb` |
| I6 | After any refund, max `totalBet` over all seats == max `totalBet` over live seats (checked in every phase but `betting`: a round's refund happens as it ends) |
| I7 | `allIn ⇔ (dealtIn ∧ ¬folded ∧ stack == 0)`, also after a refund and after settlement (a seat that gets chips back is no longer all-in) |
| I8 | `h.deck` is a permutation of 0..51; hole cards and board equal the §3.4 deck positions; no card appears twice. Also: `deckPos == 2k + 0 / 4 / 6 / 8` on the preflop / flop / turn / river (`k` = seats dealt in) |
| I9 | Board length: preflop 0, flop 3, turn 4, river 5 |
| I10 | `phase == 'betting' ⇔ toAct !== null`; `toAct` is live and not all-in; `legalActions(h)` is non-empty (true exactly when `toCall ≥ 0` for that seat). Also: that seat still has to act (`lastActedAtBet === null` or `streetBet < currentBet`), at least two seats are live, and the §3.7 betting round is not over |
| I11 | A folded seat is never in any pot's `eligible` nor in `revealed`. Also: pot winners are eligible for that pot, only pot winners are paid, shown hands are live, nothing is revealed while betting, and in a run-out every live hand is revealed |
| I12 | `log` replays to `h` (tests only: `checkInvariants(h, { replayLog: true })` rebuilds bets, folds, stacks, the street, board, aggressors, reveals, reshuffles and payouts from `h.log` alone and compares; the input replay of whole hands is §4.7) |
| I13 | Seats not dealt in have `hole == null`, `totalBet == 0`, and never act. Also: `dealtIn ⇔ startStacks[i] > 0`, and a dealt-in seat has hole cards |
| I14 | `result` is null before `complete` and non-null, never changed, after it. Also: `endedBy == 'fold'` exactly when one seat is live, and then no cards are shown or revealed; a showdown happens on the river and shows and reveals exactly the live seats |
| I15 | Button and blinds sit on dealt-in seats as §3.3 places them: heads-up `sbSeat == button` and `bbSeat` is the other seat; otherwise `sbSeat` is the first dealt-in seat after the button and `bbSeat` the next one (Known pitfall 3) |

### 4.5 Errors in production

- An **illegal input** (`EngineError`) is a UI or bot bug. The controller logs it to an in-memory ring buffer and ignores it; for a bot it substitutes the safest legal action (check if legal, else fold). A counter shows in Settings → Diagnostics.
- ⚠️ An **invariant violation** MUST NOT be ignored. The controller **voids the hand**: it restores every seat's hand-start stack (kept in the session), shows "This hand was cancelled because of an internal error. Your chips were returned.", stores the replay record under `pc.v1.diag` (last 5), and starts the next hand. Settings → Diagnostics → "Export debug report" lets the user send it by their own choice. Nothing is sent automatically.

### 4.6 Serialisation and versioning

- `HandState` and `TableState` are plain JSON: no `Uint32Array`, `Map`, `Set`, `Date`, class instances or `undefined` (use `null`).
- Each carries `schema: 1` and `engineVersion` (semver from `package.json`). A test asserts the JSON round trip for random states.

### 4.7 Replay

`replay(r) = r.inputs.reduce(step, startHand(r.table, r.seed))`. Bot actions are recorded as inputs, so a replay does not depend on bot code. A test replays 10,000 random hands and asserts identical final state. If a stored record's `engineVersion` major differs from the running engine, Review shows the stored summary only. `replayStates(r)` returns every state of the hand for Review (the deal, then the state after each input); its last state is `replay(r)`, and a test checks every prefix against `replay`.

### 4.8 Observation: the non-cheating boundary

⚠️ `observe(h, seat, extras)` builds the only object the brain ever sees (Appendix A.4): the seat's own hole cards; the board; pot; `toCall`; legal bounds; stacks, street bets, total bets, live/all-in flags; button, SB, BB; the public action history of this hand; hole cards of other seats **only** if they are in `h.revealed`; and `extras` (per-seat observed statistics, and personality labels only at Easy/Medium). It never contains the deck, `deckPos`, the seed, or unrevealed hole cards. The brain worker receives only this object. §9.6 proves it with a property test.

---

## 5. Evaluator and randomness

### 5.1 Decision

Write our own bitmask / rank-count 7-card evaluator (~150 lines, no dependencies, < 5 KB gzip). A research prototype of exactly this design enumerated all C(52,7) = 133,784,560 hands in 8.5 s on an Apple M1 Pro (~15.8M evaluations/s) and reproduced the published 7-card category counts exactly (Appendix C.1). `@poker-apprentice/hand-evaluator` (MIT, returns best five) and `pokersolver` (MIT) are `devDependencies` used only as test oracles and MUST NOT be imported by `src/`.

### 5.2 Score packing

`score = category << 20 | n0 << 16 | n1 << 12 | n2 << 8 | n3 << 4 | n4` (24-bit integer). Tiebreak ranks are **left-aligned** nibbles (unused = 0). Plain integer comparison decides; equal scores tie.

| Category | Code | Nibbles n0..n4 |
|---|---|---|
| High card | 0 | r1 r2 r3 r4 r5 (descending) |
| Pair | 1 | pair, k1, k2, k3 |
| Two pair | 2 | highPair, lowPair, kicker |
| Three of a kind | 3 | trips, k1, k2 |
| Straight | 4 | high card (wheel A-2-3-4-5 → 3, the rank index of the 5) |
| Flush | 5 | top five ranks of the flush suit |
| Full house | 6 | trips, pair |
| Four of a kind | 7 | quads, kicker |
| Straight flush | 8 | high card (royal = 12) |

Display uses 10 categories: "Royal flush" is category 8 with `n0 == 12`.

### 5.3 Algorithm (`score7`, also valid for 5 and 6 cards)

1. Build four 13-bit suit masks `s[0..3]`, `any = s0|s1|s2|s3`, and `cnt[13]`.
2. `flushMask` = the mask of a suit with `POPCOUNT ≥ 5` (at most one suit can have 5+ of 7 cards).
3. If `flushMask` and `STRAIGHT_HIGH[flushMask] ≥ 0` → straight flush. ⚠️ Test straights **inside the flush suit's mask only**, never on `any`.
4. Scan ranks from Ace down, collecting `quad`, up to two `trips`, up to three `pairs`.
5. Quads → `[q, highest other rank]`. Full house if trips and (second trips or a pair) → `[t1, max(t2, p1)]`. Flush → `TOP5[flushMask]`. Straight → `STRAIGHT_HIGH[any]` (wheel is `(mask & 0x100F) == 0x100F`; Q-K-A-2-3 is **not** a straight). Trips → `[t, top 2 others]`. Two pair → `[p1, p2, highest other rank]` (a third pair's rank can be the kicker). Pair → `[p, top 3 others]`. High card → `TOP5[any]`.
6. `POPCOUNT`, `STRAIGHT_HIGH`, `TOP5` are 8,192-entry typed arrays computed at module load (< 5 ms), not shipped as data.

Implementation notes (Stage 1): instead of `cnt[13]`, four more 13-bit masks hold the ranks seen at least 1, 2, 3 and 4 times (bit-parallel counting), so "scan from the Ace down" is `31 − Math.clz32(mask)` and nothing is allocated. `evaluate.ts` reads the tables through module-local constants: Vitest's module runner turns every use of an imported binding into a property lookup on the module namespace, which made the hot path about 4× slower under test (a production bundle is unaffected). Later hot paths (equity, §7) do the same. Measured on the owner's Mac (Node 24, inside Vitest): all 133,784,560 hands in 2.9 s (~47M evaluations/s); random hands copied into a 7-card buffer ~16M evaluations/s.

### 5.4 `describe(hole, board): HandInfo`

The UI and coach path; allocation is fine here.

- Works for 2 cards (preflop: Pair or High card) and 5–7 cards.
- ⚠️ `playsTheBoard` = board has 5 cards **and** `score7(board) == score7(hole + board)`. When true: `best5` = the five board cards, `holeUsed = 0`, `core` = the board cards forming the category. Never derive it from `holeUsed` (with board A-K-Q-J-10 and a 10 in hand, a naive picker would choose the hole 10).
- Otherwise `best5` is built from the score: flush / straight flush → cards of the flush suit with the scored ranks; everything else → for each scored rank, the needed cards of that rank, **preferring hole cards, then the higher suit (s > h > d > c)**, so the highlight shows the player's own contribution deterministically.
- Within one rank's cards in `best5`, the listed order is always by suit (s > h > d > c), never hole-cards-first: that ordering rule only decides which cards are *selected* when a rank has more candidates than are needed, not how the chosen ones are then listed (Appendix D.1 row 6).
- `core` = cards forming the category (the pair, both pairs, trips, all five for straight/flush/full house, the quads; for high card, the high card itself, as in F.7); `kickers` = `best5` minus `core`; `holeUsed` = hole cards in `best5`. `best5` lists the `core` cards first, then the kickers from high to low (a straight runs high to low, the wheel ends with the Ace).
- Preflop (2 cards): `score = 0`, `best5`, `core` and `kickers` are empty, `holeUsed = 0`, `preflopClass` = `className(classOf(...))`.
- `name` and `subLabel`: §6.1 and Appendix F.2–F.3.

### 5.5 Evaluator tests (MUST)

| Test | Project | Pass condition |
|---|---|---|
| Exhaustive: all 133,784,560 7-card hands | slow (nightly) | Category counts equal Appendix C.1 exactly |
| Differential: 1,000,000 random pairs of 7-card hands | unit (100k) / slow (1M) | Win/tie/lose agrees with `@poker-apprentice/hand-evaluator` every time |
| Naive oracle: our own 21-subset evaluator written from scratch in `tests/` | unit | 200,000 random hands: identical category and tiebreak ranks |
| Edge vectors B19–B24, Appendix D.1 | unit | Exact names, sub-labels, `best5`, `playsTheBoard` |
| `describe` consistency (property) | unit | `score5(best5) == score7(hole + board)` for 100,000 random hands |
| Suit relabelling (property) | unit | Permuting suits consistently leaves the score unchanged |

Sizes as built (Stage 1): half of each differential sample are showdown pairs (one shared board, 9 distinct cards), half are independent hands; each hand's category must also match the oracle's. Extra samples from **small decks** (1–4 suits × a window of 5–13 ranks that may wrap past the Ace) reach the rare shapes: straight flushes, wheels, Q-K-A-2-3, quads, two trips, three pairs. `pokersolver` (second oracle): 25,000 pairs in unit, 200,000 in slow. Naive oracle: 200,000 seven-card hands + 50,000 small-deck hands + 5- and 6-card hands in unit, 1,000,000 in slow. Also: `score7` equals the best `score5` over the 21 subsets (20,000 hands, unit). The micro-benchmark (`tests/eval/benchmark.test.ts`, unit) prints the rate and only warns below 5M/s (a `::warning::` annotation on GitHub Actions).

### 5.6 Randomness (`core/rng.ts`)

- ⚠️ **Never `Math.random`** for anything that affects a game (V8's xorshift128+ cannot be seeded). ESLint bans it in `src/`.
- Seeds are 128-bit, stored as 32 lowercase hex characters (`Seed128`), created with `crypto.getRandomValues(new Uint32Array(4))` (works in workers).
- Generator: **sfc32** (128-bit state; passes PractRand and BigCrush; add/shift/xor only). Discard the first 16 outputs; return raw `uint32` (`t >>> 0`).
- `deriveSeed(parent, label, ...ints)`: `h = fnv1a32(parent + '|' + label + '|' + ints.join(','))`; `g = splitmix32(h)`; output word `i` = `(g() ^ parentWord[i]) >>> 0` for i = 0..3. Seeds with no parent (coach, HUD) use `ZERO_SEED`. Appendix C.4 pins the exact implementation with golden values (verified).
- Unbiased integers:

```ts
function randInt(rng: Rng, n: number): number {           // 1 ≤ n ≤ 2^32
  const lim = 2 ** 32 - (2 ** 32 % n);
  let x: number;
  do { x = rng.next(); } while (x >= lim);
  return x % n;
}
```

- Fisher–Yates: `for i = hi down to lo+1: j = lo + randInt(i − lo + 1); swap(i, j)`. Full deck `lo = 0, hi = 51`; undo reshuffle `lo = deckPos`.
- 52! ≈ 2^226 > 2^128, so not every order is reachable from one seed; irrelevant for play.
- Tests: golden deck for a fixed seed; chi-square over 1,000,000 shuffles (each card's final position uniform, p > 0.001, fixed test seed); `randInt(3)` uniform over 3,000,000 draws. Implemented as: every deck shuffled from its own `deriveSeed(seed, 'deck', i)` stream, as a hand does; pass = the whole 52 × 52 card-by-position table has p > 0.001 **and** every card has p > 0.001 / 52 (Bonferroni: 52 tests together still false-alarm at most 0.1%); plus `randInt(3·2^30)` in 12 equal buckets, where plain `x % n` would make the first four buckets twice as likely. Unit runs 50,000 shuffles and 300,000 draws; slow runs the full sizes.

---

## 6. Hand-strength indicator

This covers "I should see if I have a full house, pairs and similar". The label and highlight are computed synchronously on the main thread with `describe()` (microseconds), so they appear in the same frame as a card. Draws, outs, risky outs, "best possible hand" and chances come from the `handInfo` job in `equity.worker` (typically < 20 ms). Preflop its `chances` stays null until the build-time `finals` table exists (chunk 4.4, §6.6): enumerating the boards there would take far longer.

### 6.1 Label, sub-label and highlight

- **Label** = `describe(hole, board).name`, e.g. "Pair of Kings", "Full House, Kings full of Fours". Preflop: "Pocket Kings" / "Ace-King suited" / "Seven-Two offsuit", plus (from Stage 5) "Top 3% of starting hands" from `rankPct` (§8.3).
- **Sub-label** (postflop only; first matching row wins; strings in Appendix F.3):

| Situation | Sub-label |
|---|---|
| `playsTheBoard` | "The board plays: everyone shares this hand" |
| Pair: pocket pair above every board card | "Overpair" |
| Pair: a hole card pairs the highest board rank | "Top pair, {kicker} kicker" |
| Pair: a hole card pairs the second-highest board rank | "Second pair" |
| Pair: a hole card pairs a lower board rank | "Weak pair" |
| Pair: pocket pair below the top board card | "Pocket pair under the board" |
| Pair on the board only, hero's cards are kickers | "The pair is on the board: everyone has it" |
| Two pair using both hole cards | "Both your cards make pairs" |
| Two pair, both pairs on the board (a hole card is only the kicker) | "Both pairs are on the board: your kicker decides" |
| Two pair where one pair is on the board | "One pair is on the board" |
| Trips from a pocket pair | "A set: well hidden and strong" |
| Trips from one hole card + a board pair | "Trips: others may share your card" |
| Trips all on the board (hole cards are only kickers) | "The three are on the board: everyone has them" |
| Straight / flush / full house / quads / straight flush | "Uses {n} of your cards" |
| `nuts` from the handInfo job (§6.5) | append " · Best possible hand" |

- **Highlight** (hero strip and board): `core` cards are raised 6 px with a 3 px accent outline; `kickers` get a 1 px outline; after the flop, board cards not in `best5` are dimmed to 60% opacity. Raise + outline make the cue readable without colour; the text label repeats it.
- When the category improves: the label pulses once (400 ms; none under reduced motion) and the live region announces "You now have Two Pair."

### 6.2 Draws (flop and turn only; the draw MUST use at least one hole card)

| Draw | Definition | Nominal outs |
|---|---|---|
| Flush draw | Exactly 4 cards of one suit among hero cards + board, ≥ 1 a hole card, no flush made | 9 |
| Nut flush draw | A flush draw where the hero holds the highest unseen card of that suit | 9 |
| Open-ended straight draw | Let `S` = ranks `r` such that adding `r` makes a straight that uses a hole card and is not already made. `\|S\| == 2` and the hero's ranks contain 4 consecutive ranks open at both ends | 8 |
| Double gutshot | `\|S\| == 2` otherwise (`\|S\| ≥ 3`: label "double-ended straight draw") | 8 |
| Gutshot | `\|S\| == 1`, including one-ended A-2-3-4 and J-Q-K-A | 4 |
| Two overcards | Both hole cards above every board card, hero has no pair | up to 6, always "weak" |
| Backdoor flush / straight (flop only) | 3 of a suit with ≥ 1 from the hand / 3 distinct ranks within one 5-rank window incl. a hole rank | shown only in the coach sheet |
| Combo draw | More than one of the above | outs = the **union** of out cards (§6.3), never the sum |

Implementation notes (chunk 4.1, `analysis/handinfo.ts`): a draw's `outs` counts the §6.3 outs that complete it (flush: the suit's cards; straight: the ranks of `S`; overcards: the hole cards' ranks), so one card can count for two draws while the hand's total stays the union. That is why overcards are "up to 6": a card that gives the board its own flush is no out. Backdoor draws complete only with two cards, so their `outs` is 0. "Uses a hole card" in `S` means the best straight after adding `r` is higher than the best straight of board + `r` alone (on the turn a board straight is not the hero's; the same as §6.3 rule 2). Before the river `|S| ≤ 2` (three completing ranks need 8 distinct ranks), so the "double-ended" label never shows. Open-ended = the two ranks of `S` are the open ends of 4 consecutive present ranks, with the Ace low and high (2-3-4-5 is open-ended; A-2-3-4 and J-Q-K-A are not). Two overcards also need the hero's category to be High card (a made straight or flush has no pair but gains nothing from pairing). The nut flush draw's "highest unseen card" is the highest card of the suit that is not on the board. A backdoor straight's hole rank must not be on the board (otherwise the straight would be the board's). The draw chips are the non-backdoor draws, flush first, then straight, then overcards. Their out cards (chunk 4.6, `app/equityViews.ts` `drawCards`) are picked from the job's `outs` on the main thread, with no evaluation: a flush draw's are the outs of its suit, a straight draw's the outs of every rank that has an out making exactly a straight (the ranks of `S`: with no straight made, every unseen card of such a rank is an out, and those off the flush suit make exactly a straight), two overcards' the outs that pair a hole card; the count must equal the draw's `outs`, else the analysis belongs to other cards and no chip shows.

### 6.3 Outs (exact rule, verified on the prototype)

An unseen card `x` (47 on the flop, 46 on the turn) is an **out** if and only if all three hold:

1. `category(hole + board + x) > category(hole + board)`;
2. the new `best5` contains at least one hole card (a board-only straight is not an out);
3. NOT (`rank(x)` matches a board rank, AND neither hole card has that rank, AND the new category ≤ Two pair). A board pair that "gives" everyone two pair is not a real improvement.

"Category" is one of the 10 display categories (§5.2), so a straight flush that becomes a royal flush is an out. Rule 2 needs no best-five search: on the flop the new best five always holds a hole card (4 board cards cannot fill it); on the turn it holds one unless board + x alone scores as high (the board plays, §5.4).

Outs are grouped by the category they make: "Flush: 9 outs · Pair: 6 outs (weak)". Tapping a draw chip shows the out cards as mini cards. Appendix D.2 has the verified vectors (e.g. A♥K♥ on Q♥7♥2♣ → 15 outs = 9 flush + 6 pair; 9♥9♦ on K♠7♣2♦ → 2 outs, board-pairing cards excluded).

### 6.4 Risky outs (HEURISTIC, deterministic)

An out is **risky** (a "dirty out"; the UI says "risky") if any rule holds on `board + x`:

| Rule | Condition |
|---|---|
| R1 flush possible | new category ≤ Straight and the board has ≥ 3 cards of one suit |
| R2 full house possible | new category is Straight or Flush and the board is paired |
| R3 better straight possible | new category ≤ Straight and some two unseen cards make a straight with the board that beats the hero's new hand |
| R4 higher flush possible | new category is Flush and an opponent holding the highest unseen cards of that suit (the top two) would have a higher flush (a straight flush of that suit counts) |
| R5 weak pair | new category is Pair |

Display: "9 outs (1 risky)"; risky out cards get a small "!" and the caption "may help them too". Structural rules are used instead of a "% of hands that beat you" threshold because against one random hand those percentages are almost always tiny, so a threshold would flag nothing. Equity (§7) remains the decision number.

### 6.5 "Best possible hand" and beaters

On every street from the flop, count the unseen 2-card combos that beat the hero's current hand ("beaters", 1,081 on the flop). Zero beaters → `nuts: true` → " · Best possible hand" suffix and the NUTS coach reason. The coach sheet shows "Hands that beat you right now: 3 of 1,081 possible (0.3%)". Label it "possible", never "likely".

### 6.6 Chance to finish with each hand

- Flop: exact enumeration of all 1,081 turn/river pairs. Turn: all 46 rivers. River: only the made hand (100%). Preflop: lookup in the build-time table `finals[169][10]` (exact over C(50,5) = 2,118,760 boards per class).
- Output per category: `exactly`, `atLeast`, and `boardShared` (category made by the board alone).
- Shown as the **"By river"** column of the rankings panel (§13) and in the coach sheet's "Your hand" section. The chip on a draw shows "35% by river" on the flop and "20% next card" on the turn.
- Always show the exact number. The coach MAY teach the rule of 2 and 4 as a mental shortcut but MUST say it overstates big draws (15 outs on the flop: rule of 4 says 60%, exact is 54.1%). Exact formulas: next card `k/47` (flop) or `k/46` (turn); flop to river `1 − C(47−k, 2) / C(47, 2)`.
- Reference values: Appendix D.3 (e.g. 9♠8♠ on J♦7♣2♥ → Straight 17.95%, above the 16.5% outs formula because runner-runner straights count).

Implementation notes (chunk 4.2, `analysis/chances.ts`): `finalCounts(hole, board)` counts the boards that finish with exactly each display category (royal flush above straight flush); `chancesByRiver(hole, board)` turns them into `HandAnalysis.chances` (exported type `Chances`), in percent (0–100) like `nextCardPct` and `byRiverPct`; `outsChances(outs, boardLength)` gives those two numbers from the out count with the exact formulas above (from the turn, "by river" is the next card, so both are `k/46`; `null` preflop and on the river). `boardShared` is true for the one category the board's own cards make, from a pair up (3–4 cards by rank counts, 5 cards by the evaluator); a board that makes nothing, and every preflop row, is `false`. Preflop, `chancesByRiver` enumerates all 2,118,760 boards (about 65 ms per hand on the owner's Mac, so the whole `finals` table takes about 11 s on one core); the app looks the table up instead. Measured means: flop 0.04 ms, turn 0.006 ms. All D.3 values and the C.5 table reproduce as written.

---

## 7. Win chance (equity)

### 7.1 What the number means (decision)

- **HUD "Win chance" = the hero's equity against the live opponents' unknown hands, dealt at random from the unseen cards.** `equity = P(win) + Σ P(tie among k players) / k`.
- Known cards = hero hole cards + board. Folded players' cards are **unknown**, not dead: they stay in the sampling pool.
- ⚠️ **Never** read a bot's real hole cards. The only exception is an all-in run-out or showdown, where cards are public by rule; then compute exact equities with the known hands, one number per player.
- Opponent hands are sampled **jointly without replacement**. Never approximate multiway equity as heads-up equity to the power N.
- Why random hands on the HUD: it is exact or tightly bounded, reproducible, testable against published oracles, and changes only when cards appear or players fold — exactly the user's "each street and as players fold". The coach separately estimates equity against "hands that act like this" (§8.6) and MUST show both, labelled, whenever they differ by 5 points or more (§8.10). The badge is neutral in colour: it never signals call or fold by itself.

### 7.2 Method by situation

| Situation | Method | Size |
|---|---|---|
| Preflop, no cards revealed | Table lookup `preflop-equity` (169 classes × 1–8 opponents) | instant, ±0.14% (95%) |
| Postflop, (opponent combos × runouts) ≤ 500,000 | **Exact enumeration**, hero score cached per runout | HU turn 45,540; HU river 990; 2 opponents river 446,985 |
| Everything else | **Monte Carlo** (§7.3) | — |
| Run-out with known hands, (boards × players) ≤ 500,000 | Exact | flop 990 boards, turn 44 |
| Run-out preflop with known hands | Monte Carlo 20,000 trials | ±0.7% |

The method depends only on `(street, nOpp, revealed)`, never on device speed.

### 7.3 Monte Carlo schedule and error

- One trial's equity lies in [0, 1], so standard error ≤ `0.5 / √n`. 95% margins: 2,500 → ±2%; 10,000 → ±1%; 40,000 → ±0.5%.
- Progress replies at n = 2,500 and 10,000; **final** at 40,000 (1–3 opponents) or 20,000 (4–8 opponents, ±0.7%).
- ⚠️ Stop at a **fixed n**, not a time limit. A 3 s safety cap exists only for broken devices; if hit, the result is marked `truncated` and shown with "~".
- Per trial: partial Fisher–Yates over the unseen-card array, drawing `2·nOpp + (5 − board.length)` cards (continuing from the previous permutation is fine).
- Seed: `deriveSeed(ZERO_SEED, 'eq|' + sortedHeroCards + '|' + board + '|' + nOpp)` with cards as text, e.g. `eq|AhKh|Qh7h2c|3`. Same situation → same number on every device.
- Work in chunks of 2,000 trials, then `await new Promise(r => setTimeout(r))` so a `cancel` or newer job is seen.

Implementation notes (chunk 4.3, `analysis/equity.ts`):
- **Shape.** `equitySteps(req, opts?)` is a generator, so the worker needs no timers of its own: it yields `null` at every checkpoint (every 2,000 trials, at 2,500 and 10,000, and about every 20,000 deals of an exact enumeration) and an `EquityResult` at the two progress marks and at the end (`final: true`). The worker posts the results, awaits `setTimeout(0)` at each step, checks its job id, and simply stops calling `next()` to cancel. `equity()` returns the last result. `truncated` is never set here: only the worker's 3 s safety cap sets it.
- **Units and `n`.** `win`, `split` and `equity` are fractions in [0, 1] (the tables in basis points and the badge in percent are conversions); `equity === win + split` exactly. `n` is the number of trials, or for an exact result the number of deals enumerated.
- **What "opponent combos × runouts" counts.** Unordered sets of `nOpp` disjoint hands times the runouts (`dealCount`): HU turn 45,540, HU river 990, two opponents on the river 446,985 (the values in §7.2). So exact enumeration is used for HU turn and river and for two opponents on the river only; every flop and every preflop request is Monte Carlo. A run-out with known hands uses boards × players (`runoutCost`); preflop it is 3.4 million for two players, so Monte Carlo with 20,000 trials.
- **Seeds.** In `eq|…` the hero cards and the board are both written highest card first (`Kh Ah` on `2c Qh 7h` gives `eq|AhKh|Qh7h2c|3`), so the same cards give the same number whatever order they came in or were dealt (§2.4 has the run-out seed). Ties are counted as integers per tie size and divided at the end, so a result has the same bits on every device.
- **Exact enumeration** takes the runouts one at a time, scores the hero once, scores each of the 990 possible opponent hands once, then combines disjoint hands; tests force it with `mode: 'exact'` where the app would sample (the flop rows of Appendix C.3, and all boards of Appendix C.2).

Implementation notes (chunk 4.5, `workers/equityService.ts`): the worker takes the generator's steps back to back and pauses with `setTimeout(0)` at a checkpoint once 8 ms of work have passed since the last pause (not after every 2,000 trials: the pauses cost up to 4 ms each once timers nest), so a `cancel` or a newer job is seen within one slice; results never depend on it. After each pause it checks that the job is still wanted; nothing can run between that check and its next post, so a cancelled job never posts again. A newer `equity` job stops the older one at its next checkpoint, even before the older one's `cancel` arrives; `equityKnown` jobs stop only at their own `cancel`, because during a run-out two run at once (the street's bars and the board at the all-in, §7.4, chunk 4.7). Every reply carries `timing` (A.6 `JobTiming`): the wall time since the request was taken, and how much of it the worker spent computing, on this job or any other that ran in between (§15.3). The 3 s cap posts the last estimate as the final reply with `truncated: true` (for a run-out: `final: true, exact: false`), or an `error` reply when there is none yet.

### 7.4 Recompute triggers

New hole cards; each new street; any fold that changes the live-opponent count; an all-in reveal (switch to known-hands mode); resume from storage. A new request cancels the old one. Nothing else (in particular, a bot bet does not change this number; the coach explains what a bet means).

Implementation (chunk 4.5, `app/equityJobs.ts`): the controller hands every state it publishes to the equity jobs, and each job kind has a key: HUD equity (hand, hero cards, board, live opponents), `handInfo` (hand, hero cards, board), run-out (hand, face-up seats, board). A request goes out exactly when its key changes, which is the list above. Known-hands mode starts when `hand.runout` is set and at least two live seats are in `hand.revealed`; the reveal comes in the same `advance` as the next street's cards, so its first equities are for that board. No job while the hero has folded (the badge says "Folded"), after all opponents folded, or once the hand is complete (the badge is off). The `hidden` gate cancels every job at once (§15.3); jobs that did not finish are sent again when it opens. A job cancelled by a new epoch (pitfall 22) is sent again at once; one that timed out or failed waits for the next trigger (§12.14).

All-in board (chunk 4.7): because the reveal and the next street arrive together, one more job, `allIn` (its own client slot), computes the run-out equities of the same face-up hands for the board as it was before that `advance` (the `street` events logged before the `reveal`, `boardAtReveal`): the hero's number "when the chips went in" for the luck line (§7.6), and later the All-in luck stat (§14.4). It runs only when the hero is one of the face-up hands, it stays wanted after the hand is complete (so a hand that ends at once, at Instant speed, does not cancel it), and it lands in the slice's `allIn` (A.8), which a new hand clears. Like every run-out job it carries face-up hands only.

### 7.5 Build-time preflop tables

| File (`src/data/generated/`) | Content | Generation |
|---|---|---|
| `preflop-equity` | 169 classes × nOpp 1..8: `win` and `split` in basis points (Uint16). Here and in `EquityResult`, `split` = the equity share from ties, Σ P(tie among k) / k, so `equity = win + split` always | `scripts/gen-preflop.ts`, Node `worker_threads`, fixed seed, 500,000 trials/cell (±0.14%), ~3 min on 8 cores (measured, see the notes) |
| `finals` | 169 × 10 final-category probabilities, stored as exact board counts | exact over C(50,5) boards per class, ~11 s of CPU |
| `ranges` | `rankPct[169]` (stored as the class order), `eqVsRange[169][13]` in basis points | `scripts/gen-ranges.ts` (§8.3), fixed seed, 200,000 trials/cell (±0.11%): 338 ranking cells + 2,197 range cells, ~35–50 s on 10 threads, 4.3 KB gzip |
| `pushfold` | `pushPct[8][15]`, `callPct[15]` in hundredths of a percent | `scripts/gen-pushfold.ts` (§8.4), 14,196 class pairs × 40,000 trials (~20 s on 10 threads), then 120 games × 3,000 rounds (~56 s on one thread), 0.9 KB gzip |

- Class index: a 13 × 13 grid, `row = 12 − highRank`, `col = 12 − lowRank`; suited above the diagonal, offsuit below, pairs on it. Combos per class: pair 6, suited 4, offsuit 12 (1,326 total).
- Each script also emits a TypeScript module (binary as base64, JSON as an object) that workers import directly: **no runtime fetches**. Outputs are committed with `checksums.json` (SHA-256, generator version, seed). `scripts/check-tables.ts` in CI re-samples 20 random cells at 200,000 trials with a fixed seed (fail if any differs by > 0.5 points: the difference of two Monte Carlo estimates has a standard deviation up to 0.13 points, so 0.3 would fail about one run in three by chance) and verifies checksums. Nobody edits generated files by hand.
- Implementation notes (chunk 4.4, `scripts/gen-preflop.ts`, `scripts/check-tables.ts`, `analysis/preflop.ts`): the equity cells come from `equity()` itself (`mode: 'montecarlo'`, 500,000 trials) for one hand per class (`classCards`: `A♠A♥`, `A♠K♠`, `A♠K♥`, …; suits are symmetric), so the table and the live estimate share one sampler. Seeds: the table seed is `deriveSeed(ZERO_SEED, 'gen-preflop')` and cell `(class, nOpp)` uses `deriveSeed(tableSeed, 'cell', class, nOpp)`, so a cell does not depend on the thread count or the order of the jobs; `check-tables` derives from its own `deriveSeed(ZERO_SEED, 'check-tables')`, so its re-samples are independent of the table. **Measured:** the 1,352 cells are about 24 CPU-minutes, **181 s on 8 threads** of an M1 Pro (the "~1 min on 8 cores" above was an estimate; the general `equity()` stays the only sampler), and the 169 exact rows about 11 CPU-seconds (`finalCounts`, ~65 ms a class). `finals` stores the exact **counts** (Uint32, every row adds up to 2,118,760) instead of rounded probabilities: lossless, `preflopChances` equals `chancesByRiver(hole, [])` to the last bit, and "rows sum to 100%" is an integer equality. `preflop-equity` is stored as two byte planes (all high bytes, then all low bytes) because the high bytes barely change, which gzips to ~4.4 KB instead of ~5.5 KB; with `finals` (~3.5 KB) the two modules are ~7.9 KB gzip, far inside the 60 KB worker budget (§15.3). `src/data/preflopLayout.ts` holds the sizes and decoders, apart from the generated modules, so the scripts can read damaged files without importing them. `check-tables` (`npm run gen:check`, about 1.4 s on 10 cores, in the CI `check` job) runs five checks and stops at the first failed checksum: the SHA-256 of every file in `checksums.json` (and no unlisted `.ts` file); the recorded generator id, seed and trials are the current ones (bump `GENERATOR` in `gen-preflop.ts` whenever the method or layout changes, and the check demands a regeneration); the finals against Appendix C.1 (each row adds up to C(50,5), and the 169 rows weighted 6 / 4 / 12 equal 21 × the C.1 counts, because every 7-card hand is a hole pair plus a board in C(7,2) = 21 ways); three finals rows counted again exactly (the totals cannot see two rows swapped); and the 20 re-sampled cells (each opponent count at least once; `win`, `split` and `equity` each within 0.5 points). The weekly `slow` workflow also regenerates both tables and fails on any difference from the committed files. `tests/analysis/preflop.test.ts` checks the table against the oracles: Appendix C.3's values against random hands (40 cells and A♥K♥ vs 1, within 0.5 points; C.2's values are hand against hand, so a hand-against-random table cannot reproduce them, and C.3 is this table's oracle), the exact identity that all players are interchangeable (the 169 cells of one opponent count, weighted by combos, average 1 / (nOpp + 1); limit 0.05 points, expected error 0.006), and Appendix D.3's preflop chances to two decimals. `workers/equityMath.ts` uses the tables: a preflop `equity` request is answered by `preflopEquity` (one final reply at once, `n` 500,000, no progress replies, no sampling in the worker) and a preflop `handInfo` carries `chances` from `preflopChances`, so the "By river" column has its numbers before the flop; `equity.worker` is 14.1 KB gzip with the tables (6.2 KB without), budget 60 KB.
- Implementation notes (chunk 5.1, `scripts/gen-ranges.ts`, `scripts/gen-pushfold.ts`, `scripts/check-range-tables.ts`, `brain/rangesData.ts`, `brain/pushFoldData.ts`): both tables follow the 4.4 conventions (`generated.ts`, fixed table seeds `deriveSeed(ZERO_SEED, 'gen-ranges')` and `'gen-pushfold'`, one seed per cell, the jobs dealt across `worker_threads` by the generic `pool.ts`), so the files are byte-identical on any thread count (tested; two full regenerations on different machine load matched byte for byte). `ranges.ts` is one base64 blob: 169 bytes (the class at each rank, best first; `rankPct` is derived from it, so nothing is rounded) and then 169 × 13 equities in basis points as two byte planes: 7.3 KB of text, **4.3 KB gzip**. `pushfold.ts` is 270 bytes (135 little-endian words in hundredths of a percent): **0.9 KB gzip**. Together 5.2 KB gzip (13 KB with the preflop tables), far inside the 60 KB of the brain worker chunk (§15.3). The accessors live in `brain/` and decode at the first lookup; nothing on the main thread imports them, so they reach a bundle only through the brain worker (chunk 5.8); `data/rangesLayout.ts` holds the sizes, decoders and acceptance checks apart from the generated modules, as `preflopLayout.ts` does. **Measured on 10 threads (M-series Mac):** `gen-ranges` 32–49 s (103 CPU-seconds for the 338 ranking cells, about 400 for all), `gen-pushfold` 18–23 s (131 CPU-seconds for the 14,196 pairs, 2.6 s for the 120 games; ~75 s since chunk 5.3: 3,000 rounds of a bigger game, §8.4). `check-tables` (`npm run gen:check`) now ends with `check-range-tables`: checksums and the recorded generator, seed and trials; the order is a ranking and passes the §8.3 acceptance; every equity row grows with the range (within 1 point); the small blind shoves everything with 1 bb; the module's rounds are `ITERATIONS`; the §8.4 acceptance; and 20 `eqVsRange` cells sampled again (200,000 trials, a seed of its own, each within 0.5 points; observed worst 0.43, mean difference about 0). The weekly `tables` job regenerates all three tables.

### 7.6 Presentation

- **Badge** (hero strip): "62%" large, "win chance" small; `~62%` while provisional; a shimmering `--%` skeleton (static under reduced motion) before the first estimate; never "0%" while computing. Whole numbers only. **Hysteresis:** while provisional, change the displayed integer only if the unrounded value is ≥ 1.0 point away from the displayed one (no flicker between 61 and 62); always show the final value.
- Tap → popover: "Wins 60% · splits 4% · vs 3 players (any cards) · 40,000 deals" and, when the coach level shows it and the numbers differ by ≥ 5, "Against their likely hands: about 35% (a guess from how they bet)". Link "How is this calculated?" → "We play out the rest of the hand thousands of times, dealing the other players random cards. You won in 62% of them. We never look at the bots' real cards."
- **Price chip** when facing a bet: "Call 40 · need 20%" (`need` from the capped `winPot`, §0.3, so a short all-in call shows the true price). Neutral colour (the coach, not the chip, compares).
- **Big-move line:** when the final value changes by ≥ 8 points between two finals, show one line under the badge for 4 s: EQ_FOLD "{name} folded. One fewer player to beat." · EQ_IMPROVED "The {card} helped you: now {handName}." · EQ_DANGER "The {card} is dangerous: {threat} is now possible." · EQ_BLANK_DROP "The {card} did not help you."
- **Folded:** the badge shows "Folded", no number.
- **All-in "TV mode":** every face-up player gets an equity bar that updates each street. At the end: hero lost with ≥ 60% → "You had {E}% when the chips went in. Good decision. Unlucky this time."; hero won with ≤ 35% → "You got lucky. You had {E}%." These run-outs also feed the "All-in luck" stat (§14.4).
  - Implementation (chunk 4.7, `app/runoutViews.ts`, `ui/components/Runout.tsx`): a bar shows for each face-up live seat (`hand.revealed`) that has a number in `equity.known` for this hand, from the reveal until the hand is complete (then the banner speaks, like the badge). A bot's bar sits in its pod's bet slot and the hero's in the hero's bet slot (`tableGeometry().bets`, `heroBetRect`): nobody bets during a run-out, and those slots already clear the pods, the board and the pot. Each bar is one 52×20 element (nine bars add nine DOM nodes, §15.3): "62%" on a dark pill, the track and the fill are its `::before` and `::after`, the fill scaled with `transform` (§12.8); neutral colours; screen-reader name "Ben: 62% win chance" / "You: 62% win chance". A street's numbers stay until the next street's arrive (exact from the flop on). The hero's bar repeats the badge's number, which shows the hero's run-out equity in known-hands mode.
  - Luck line: from `equity.allIn` (the board at the reveal, §7.4), only when final, for this hand, with the hero face up. "Lost" = the hero won no pot (payout 0); "won" = the hero alone won the main pot, the pot every face-up hand could win (the equity is against all of them); a split is neither. The thresholds apply to the whole percent the line prints (59.5% prints "60%", so it counts as 60). The line follows the banner's lines (§12.9).
- Setting "Show win chance" (default on) hides the badge for players who want to practise estimating. Exam level hides it while deciding (§10.2).
- Implementation notes (chunk 4.6; `app/equityViews.ts` builds the data, `ui/equity.ts` the words, `ui/components/WinBadge.tsx` and `DrawChips.tsx` draw them):
  - **Percentages** are whole numbers that never claim more than is known: a chance above 0 never reads "0%" and one below 100 never "100%" ("<1%", ">99%"). This applies to the badge, its popover, the draw chips and the "By river" cells.
  - **Skeleton and "~" per situation:** a new situation (hand, board or live-opponent count, §7.4) starts over: `--%` until its first estimate, then that estimate as it is, then the hysteresis. A truncated final (the 3 s cap) and a timed-out estimate keep the "~". The badge is off from the showdown on (the result banner speaks then), at Exam while the hand is played, and with "Show win chance" off; the big-move line with it. "vs 1 player" in the singular. Known hands (an all-in run-out) show the hero's run-out number with no random-deal popover (TV mode is chunk 4.7).
  - **Popover:** a disclosure, not a sheet: it closes no gate and never pauses the game; a second tap, Escape or a press outside closes it, and so does a new situation (the badge is keyed by it). "How is this calculated?" opens the explanation inside it; `{E}` is the number on show.
  - **Price chip:** two lines under the badge ("Call 40" over "need 20%"; `need` from the capped `winPot`, whole-number percent). "Pot you can win {winPot}" joins it on wide screens and in landscape; on phones it is already the Call button's second line (§12.7), right below.
  - **Big-move line:** between two finals of the same hand, `|Δ| ≥ 8` points. Same board and exactly one live opponent fewer, up → EQ_FOLD naming the last bot that folded. Exactly one new card (turn or river), same opponents: up and the hero's category improved → EQ_IMPROVED with `describe()`'s name; down and the card made a new threat (Appendix F.3; the strongest new one: a full house, then a flush, then a straight) → EQ_DANGER; down otherwise → EQ_BLANK_DROP. No line for the flop's three cards, two folds at once, a card and a fold together, or a rise without a better hand. The card is drawn as a small card (rank and suit shape) inside the sentence. The line is a callout by the badge (over the felt; down the column in landscape) for 4 s, a display timer.

### 7.7 Equity tests (MUST)

- Exact enumeration reproduces every exact value in Appendix C.2–C.3 to 0.01 points; Monte Carlo at 200,000 trials is within ±0.4 points of exact values (standard error ≤ 0.112 points, so ±0.4 is 3.5 σ and does not flake in the nightly random-seed runs) and ±0.5 of the multiway table.
- The same request twice returns bit-identical results. Run-out equities of all players sum to 1 (±1e-9).
- A spy on the sampler proves folded players' cards are never removed from the pool.
- A unit test proves the UI never sends another seat's hole cards to `equity.worker` unless those seats are in `revealed`.
- `#bench` on a Galaxy A5x-class phone: ≥ 2M evaluations/s and a final 8-opponent result in ≤ 400 ms.

---

## 8. Coach

### 8.1 Principles (MUST)

| # | Principle | How it is enforced |
|---|---|---|
| C1 | One decision engine for coach and bots: `decide(obs, profile, seed)`. The coach is the fixed profile `COACH` (TAG baseline, deterministic, no noise, full range model) | `brain/decide.ts`; coach and bots share every function |
| C2 | Advice is **always legal**, with a legal amount | Property test over random observations |
| C3 | Advice is **deterministic**: same observation → same action, size, numbers and text | Seeds from `observationKey`; property test |
| C4 | The **coach level never changes the advice**, only what is shown and when the game pauses | `hint(obs)` has no level parameter |
| C5 | ⚠️ The coach sees only the `Observation` — never hidden cards, never the deck | Module boundary + non-cheating test (§9.6) |
| C6 | Never fold when checking is free; the guardrails (§8.8) always apply | Property test |
| C7 | **Monotone:** with all else fixed, more equity never turns call → fold or raise → fold; a cheaper price never turns call → fold | Property test on `policy(features)` with synthetic features |
| C8 | Following the advice is always graded Best | Property test |
| C9 | Numbers in the text equal the numbers on screen (HUD equity, pot, need) | Snapshot tests of rendered text |
| C10 | For teaching clarity the coach never recommends limping or completing from the SB, preflop bluff 3-bets, or slow-playing | Policy code + golden spots |

### 8.2 Pipeline and features

```
hint(obs, eRandom) → Decision
  f     = features(obs, eRandom)
  act   = policy(f)                // preflop §8.3–8.4, postflop §8.5
  act   = sizing(f, act)           // §8.7, then snap to legal
  act   = guardrails(f, act)       // §8.8
  evs   = candidateEVs(f)          // §8.9
  conf  = confidence(evs)
  trace = explain(f, act, evs)     // reason codes, §8.10
```

| Feature | Definition |
|---|---|
| `pot`, `toCall`, `need` | §0.3; `toCall = min(currentBet − streetBet, stack)`; `need = toCall / (winPot + toCall)` with the §0.3 capped `winPot`; `need = 0` when `toCall == 0`. Every `EV(call)` formula in §8.3–8.9 uses `winPot` in place of `pot` |
| `effStack`, `effBB` | `min(hero chips, largest live opponent's chips)`, chips = stack + street bet (what the seat had when the street began, so a shove or a posted blind still counts); ÷ bb |
| `spr` | effective stack ÷ pot, both at the start of the current street (preflop: the posted blinds) |
| `k` | Preflop: dealt-in, unfolded players still to act after the hero, blinds included (all-in players cannot act and do not count); 0 after the flop |
| `position` | `IP` if the hero acts last among active players (not folded, not all-in) after the flop, else `OOP` |
| `nOpp` | Live opponents |
| `eRandom` | Coach only. HUD equity (§7): the controller sends the hint job at once (in parallel with the equity job) and passes the final HUD value only if it already has it (preflop table, cache after undo/resume); otherwise `null` and `brain.worker` computes it with the identical deterministic function, so the numbers match (C9). Grades always receive the final value. **Bots never compute it**: in `decide()` for a bot profile, `Decision.eRandom = eRange` (with `rangeModel: 'random'` they are the same number) |
| `eRange` | Equity vs estimated opponent ranges (§8.6): 4,000 weighted Monte Carlo trials; exact on the river heads-up |
| `p` | Per-opponent strength: the hero's chance to beat one average opponent, `p = n·eRange / (1 + (n − 1)·eRange)` with `n = nOpp` (1 with nobody left): its odds are `n` times `eRange`'s (the Bradley–Terry–Luce model, each hand winning in proportion to a strength). Heads-up `p = eRange`; the fair share `1/(n + 1)` gives 0.5, so the buckets, the `p` tests of §8.5 and §8.8 and the §8.10 meter behave the same in multiway pots. It replaced `eRange^(1/nOpp)`, which read high before the river (risk R18) |
| `bucket` | Monster `p ≥ 0.85`; Strong 0.65–0.85; Medium 0.45–0.65; Draw `p < 0.45` and ≥ 8 outs before the river; Air otherwise (Loki thresholds) |
| `texture` | `W = [2 of one suit: +1] + [≥ 3 of one suit: +2] + min(#adjacent sorted board ranks with gap ≤ 2, 2) − [board paired: 1]`. Dry `W ≤ 1`, Wet `W == 2`, Very wet `W ≥ 3` |
| `facing` | `none`, `limpers`, `open`, `3bet`, `4bet+`, `bet`, `raise`, `allin`: `allin` when the street's last bet or raise was all-in and there is something to call; else by the street's bets and raises (preflop 0 → `limpers` if anyone called, else `none`; 1 `open`, 2 `3bet`, 3+ `4bet+`; after the flop 0 `none`, 1 `bet`, 2+ `raise`) |
| `wasPreflopAggressor` | Hero made the last full preflop raise |
| `handInfo`, `draws`, `outs`, `rankPct` | §6, §8.3 |

### 8.3 Preflop policy

**Starting-hand ranking (build time, `scripts/gen-ranges.ts`).** For all 169 classes compute equity vs 1 random hand and equity share vs 4 random hands (200,000 trials each). `score = 0.5·z(eqVs1) + 0.5·z(shareVs4)`; sort; convert to a **combo-weighted percentile** `rankPct` (0 = AA; "top 15%" = 15% of the 1,326 combos). Also emit `eqVsRange[169][13]`: each class's equity vs the top X% for X ∈ {3, 5, 8, 12, 15, 20, 25, 30, 40, 50, 65, 80, 100}. Acceptance (tune the 0.5 weight if any fails): top 5% contains AA–JJ and AKs; top 15% contains 88+, ATs+, KQs, AJo+, KQo; 72o is in the bottom 1%; 76s ranks above K2o. (Chen formula rejected: fixed 6/10-handed thresholds and coarse ties.)

**Implementation notes (chunk 5.1, measured).** (1) *Two readings of "percentile".* `rankPct` is the share of the 1,326 combos that rank **at least as well** as the class, its own combos included: "in the top X%" is exactly `rankPct ≤ X`, "the bottom 1%" is `rankPct ≥ 99`, AA is 0.45 and 32o is 100. The literal "0 = AA" (the share ranking strictly better) makes the acceptance "72o is in the bottom 1%" impossible at any weight: 32o ranks below 72o from weight 0 to weight 1 (`node scripts/gen-ranges.ts --scan`, 200,000 trials), so 72o is at best second to last, at 98.19%. (2) *The weight.* At 0.5 every criterion passes except "72o is in the bottom 1%" (72o is third from the bottom, behind 42o and 32o); that one holds from 0 to 0.35 and fails from 0.4, and "76s above K2o" holds up to 0.5 and fails from 0.55. The plan's remedy, "tune the 0.5 weight", gives `RANK_WEIGHT = 0.25` (the weight of `z(eqVs1)`), the middle of the passing range: there 72o is at least 3 sampling standard deviations from trading places with the class above or below it (score gaps 0.031 and 0.055, noise about 0.01) and 76s beats K2o by 0.29. The ranking starts AA KK QQ JJ TT AKs 99 AQs AKo AJs KQs ATs and ends 52o 82o 42o 62o 72o 32o. (3) *`eqVsRange`.* "The top X%" is exactly X% of the 1,326 combos in this order: the class on the edge counts in part (its weight is the share that fits), so the columns are continuous in X. X = 100 is the equity against one random hand and reproduces Appendix C.3 (AA 85.3, KK 82.5, 72o 34.6 against 85.24, 82.35, 34.58). Each cell draws one rival from the range without the hero's cards (exact card removal) and a random board, 200,000 trials. Below 3% the accessor reads the 3% column (the 2.5% of the 4-bet range is off by half a point at most).

**Unopened pot:** raise if `rankPct ≤ openPct(k)`, else fold (check in the BB).

| `k` behind | 8 | 7 | 6 | 5 | 4 | 3 | 2 (BTN) | 1 (SB, 3+ handed) | Heads-up BTN/SB |
|---|---|---|---|---|---|---|---|---|---|
| `openPct` % (HEURISTIC) | 11 | 13 | 15 | 17 | 21 | 27 | 43 | 40 (raise or fold) | 80 |

Sources: 9-max RFI charts (UTG 9–12% … BTN 44–48%), 6-max RFI (UTG ~17% … BTN ~43%); heads-up SB opens are quoted at 80–84% (84% UNVERIFIED at its primary source; we use 80).

**Facing limpers only:** raise ("isolate") if `rankPct ≤ 0.7 × openPct(k)`; from the BB isolate only below 15% (heads-up 30%), else check. Otherwise fold (the coach never over-limps).

**Facing one raise:**
1. Villain range `V = clamp(openPct(kV) × loosenessEstimate(villain), 3, 100)` (%), `kV` = players behind the villain when they opened (§9.5).
2. `E = eqVsRange[class]` interpolated linearly at `V`. If callers are already in, run 1,500 weighted Monte Carlo trials against all ranges instead.
3. Realisation `R`: in position 0.95; out of position 0.80; × 0.9 for offsuit unpaired hands with a rank gap ≥ 3 (HEURISTIC).
4. Implied odds, pocket pairs only: `implied = 0.118 × 0.4 × effStackAfterCall` (set-mining; reproduces the 15–20× rule).
5. `EV(call) = E·R·(pot + toCall) − toCall + implied`.
6. **3-bet for value** if `E ≥ 0.58`. Else **call** if `EV(call) > 0` and (`rankPct ≤ min(50, 1.5·V)` or hero is the BB). Else **fold**.

**Facing a 3-bet:** villain range `max(3, 0.25 × heroOpenPct)`. 4-bet if `E ≥ 0.58`; call if `EV(call) > 0` and `rankPct ≤ 1.5 × V`; else fold. **Facing a 4-bet or more:** villain range 2.5%; all-in if `E ≥ 0.50`; call if `EV(call) > 0`; else fold.

**Sizes:** open 2.5 bb (3 bb from the SB) + 1 bb per limper. 3-bet = 3 × the open in position, 4 × out of position, + 1 × per caller. 4-bet = 2.3 × the 3-bet. **Shove instead** whenever the raise-to would be ≥ 35% of the hero's chips (stack + street bet).

**Implementation notes (chunk 5.3, `brain/preflopPolicy.ts`, `brain/pushfold.ts`).** `preflopPolicy(obs, features, { style, rangeModel, seed })` returns a `PreflopDecision` (`action`, always legal; `kind`; `trace`); the EV model and the guardrails come after it. Readings where the text is open: (1) *Position* is §8.2's `position` (players behind who have not acted count as active), for `R` and the 3-bet size. (2) *`kV`* = players after the raiser in preflop order who could still act (as §8.6); *looseness* = the seat statistics' estimate with `rangeModel: 'reweight+stats'` (the coach), else 1; with `'random'` (Easy) every range is 100%. (3) *Callers already in* = live opponents other than the raiser who called the raise or are all-in; `E` is then 1,500 weighted trials against their §8.6 ranges and the raiser's, seed `deriveSeed(coachSeed(obs), 'preflop')`. (4) *Facing a 3-bet,* `heroOpenPct` is the hero's own open threshold; when someone else opened (the hero cold-called) the opener's `V` is used. (5) *Facing an all-in* at any depth, the §8.4 rule decides (call if `E ≥ need`, `R = 1`, no implied odds, call or fold only), the shover read as in §8.6 (an all-in raise to ≤ 15 bb is `pushPct(kV, S)` × looseness, else by its raise level); E8 is a call against the open range of an unknown Medium seat (27%). (6) `EV(call)` uses `winPot` (§8.2); `effStackAfterCall = effStack − (street bet + toCall)`. (7) A value raise with no legal raise becomes a call (`CALL_PREFLOP`). (8) "3 bb from the SB" is the small blind 3+ handed; heads-up the button opens 2.5 bb. "Below 15%" for the big blind is `rankPct ≤ 15`, like every "top X%". (9) Amounts are rounded to the small blind with a half rounding up (2.3 × 750 = 1,725 → 1,750 whatever the float noise), then clamped to the legal bounds; the top of the bounds is `kind: 'allin'`. (10) `SET_MINING` names a call with a pocket pair from 22 to 99 (F.1 says "small pocket pair"); other calls are `CALL_PREFLOP`, a folded raise `FOLD_VS_RAISE`, a free check `CHECK_FREE`. *Reason data:* equities, `need` and `Pfold` as fractions, `rankPct`, `openPct`, `V` and `pushPct` in percent, `to` and `bb` in chips (`{size}`), `hand` the class name, `behind` = `k`. *Profiles (§9.2, §9.4):* `PreflopStyle` carries a bot's N(0, σ) draw (added to every equity the rules compare), `looseness × (1 + U)` (multiplies every "`rankPct ≤ X`" threshold: `openPct`, isolate, the big blind's isolate, the call caps, `pushPct`; capped at 100) and its position awareness (`openPct(k)` blended with `openPct(4)`); the coach's style is the identity. *Tests:* `tests/brain/preflopPolicy.test.ts`: E1–E8 and E18 on spots played through the engine, one test or more per rule, and legality (C2) and determinism (C3) at the preflop decision points of 150 random hands.

### 8.4 Short stacks: push or fold when `effBB ≤ 12`

- **Build time (`scripts/gen-pushfold.ts`):** fictitious play over 169 classes for every `k = 1..8` players behind and `S = 1..15` bb, no antes. **Positional callers:** with `k = 1` the pusher is the small blind and the big blind calls; with `k ≥ 2` the players behind are `k − 2` players with nothing posted, then the small blind (0.5 posted) and the big blind (1 posted). Each kind of caller best-responds with `eq(h vs pushRange) × finalPot − callCost > 0` (`callCost = S − posted`, `finalPot = 2S +` the blinds of the players not in the pot); the first caller plays the pusher heads-up (no overcalls). The pusher best-responds with `EV(push) = Pfold·1.5 + Σ_i P(i calls first)·(eq(h vs callRange_i)·finalPot_i − risk)`, each caller's chance to call counted with the pusher's two cards removed: `Pfold = Π (1 − c_i(h))`. Average over 3,000 iterations. Output `pushPct[k][S]`, `callPct[S]`.
- **Acceptance** (vs the published **no-ante** Nash chart for 9-handed play: Jonathan Little, PokerCoaching.com, "Push Fold Charts No Ante", https://pokercoaching.com/push-fold-charts/; each band is the chart's value ± 3 points): at 10 bb SB 55.4–61.4% (58.4), BTN 30–36% (33.0), CO 22.8–28.8% (25.8), 6-max UTG = 5 players behind 13.3–19.3% (16.3); at 12 bb 9-handed UTG 4.5–10.5% (7.5). (Sklansky-Chubukov rejected: assumes a face-up hand.) The first bands (SB 55–70%, BTN 35–45%, CO 28–38%, 6-max UTG 18–26%, 9-handed UTG at 12 bb 10–15%) were the values of charts **with antes**, which this game does not have (§1.6): risk R16, closed in chunk 5.3.
- **Runtime, unopened:** shove if `rankPct ≤ pushPct(k, S)`, else fold (check if free). Everywhere, `S = clamp(round(effBB), 1, 15)` and `k = clamp(k, 1, 8)`. With limpers: shove if `rankPct ≤ 0.8 × pushPct` (HEURISTIC).
- **Facing a raise:** only fold or all-in. `EV(shove) = Pfold·pot + (1 − Pfold)·(E_called·finalPot − risk)`; the raiser calls with `min(1, callPct(S) / V)` of their range. Shove if `EV(shove) > 0`. The explanation shows this formula in words.
- **Facing an all-in:** call if `E vs pushRange(villain) ≥ need` (R = 1). *Chunk 5.3:* with limpers `k` is still §8.2's (the big blind's `k = 0` reads as 1); facing a raise, `V` is the raiser's §8.3 range for its level, `risk` and `finalPot` count the chips the raiser can match (the callers of the raise are dead money), and only the raiser is modelled; the `PUSH_FOLD` text's `Pfold` and `E` for an unopened shove come from `pushOutcome` (each player behind calls with the classes whose equity against the top `pushPct`% beats its price, as in the build-time game, card removal left out), which explains the table and never decides.
- **Implementation notes (chunk 5.1, measured; `scripts/pushfold-solver.ts`).** *The model first written here.* Every stack is `S`; blinds 0.5 and 1. `k = 1` is the small blind against the big blind, exact: the pusher has posted 0.5 (risk `S − 0.5`, final pot `2S`, a fold gains 1.5 relative to folding), the caller has posted 1 (cost `S − 1`). For `k ≥ 2` the pusher is on no blind and every caller was generic: cost `S`, final pot `2S + 1.5` (the blinds are dead money), risk `S`, `Pfold = (1 − callFreq)^k` with `callFreq` from the callers' own best response (card removal ignored), and the equity when called against ONE caller's range. Fictitious play: the pusher answers the callers' average so far (round 1: nobody calls, so everything is pushed), then the callers answer the pushers' updated average; 300 rounds; `pushPct` is the average push frequency × combos / 1,326 (a class that mixes counts in part); `callPct[S]` is the big blind's calling share in the `k = 1` game, the heads-up reference for "how many hands call a shove of S bb". The class-against-class equities are sampled (14,196 pairs, 40,000 trials each, spread over the rival's free combos; AA against KK 81.95 and 22 against AKo 52.75, against the exact 81.95 and 52.65) and every game reads them with exact card removal. *Convergence:* the average of 300 rounds moves by at most 3.2 points over its second half; 3,000 rounds instead of 300 change the 10 bb spots by under 0.6 points (SB 58.5 → 58.7, BTN 38.5 → 38.2, CO 27.2 → 26.9, 6-max UTG 15.1 → 15.6) and 9-handed UTG at 12 bb from 8.8 to 7.7, so the 300-round answer is, if anything, a little wide there. *Acceptance of that first model:* SB 58.5%, BTN 38.5%, CO 27.2%, 6-max UTG 15.1%, 9-handed UTG at 12 bb 8.8%; three of the first (ante) bands missed (R16). Chunk 5.3 replaced the generic callers (next note).
- **Implementation notes (chunk 5.3, risk R16 closed).** *Evidence.* PokerCoaching.com publishes the same 9-handed Nash push/fold chart in four ante versions (0%, 10%, 12.5%, a big-blind ante), 1 to 15 bb. At 10 bb the no-ante chart has SB 58.4%, BTN 33.0%, CO 25.8%, lojack (5 behind, the 6-max UTG game) 16.3%, and 9-handed UTG at 12 bb 7.5%; the 12.5%-ante chart has 71.9%, 43.9%, 34.2%, 23.7% and 13.4%. The first bands contain the ante values at the BTN, CO, 6-max UTG and 9-handed UTG (also ICMIZER's 12.5%-ante chart at 12 bb: UTG 12.7%, 888poker.com, and the 6-max 0.125 bb-ante chart of pushfoldtrainer.com: UTG 22, CO 33, BTN 40, SB 65) and none of the no-ante values except the SB's. The chart's SB column is the heads-up game; HoldemResources' heads-up Nash chart without antes (https://www.holdemresources.net/hune, counted from its per-hand stack limits) gives 61.7 / 57.8 / 52.9 / 45.7% pushed and 45.4 / 37.3 / 33.0 / 28.8% called at 8 / 10 / 12 / 15 bb, against the chart's 61.7 / 58.4 / 53.2 / 45.7% pushed. (A page that labels the ante chart's numbers "no antes" exists, pokerskill.com: CO 34.2%, BTN 43.6% at 10 bb; it is not used.) *The first model against the no-ante chart:* SB 58.5 (+0.1), BTN 38.5 (+5.5), CO 27.2 (+1.4), 6-max UTG 15.1 (−1.2), UTG at 12 bb 8.8 (+1.3): too wide at the button, whose two callers are the blinds and call wider at their discount. *Fix:* positional callers and the pusher's card removal (the build-time bullet above), and 3,000 rounds instead of 300 (the 300-round average was still up to 6 points wide at 4 to 6 bb from early position). Same matrix (seed and trials unchanged), `gen-pushfold@2`. *Result:* SB 58.4, BTN 32.4, CO 24.8, 6-max UTG 15.4, 9-handed UTG at 12 bb 7.9 (all inside the bands); over all 88 cells from 5 to 15 bb the table is 0.5 points from the chart on average and 1.9 at most (300 rounds: 1.0 and 6.1; the first model: 2.0 and 12.6), `callPct(10)` = 37.3% = HoldemResources. The games take ~56 s on one thread (`gen-pushfold` ~75 s in all). *Limit:* below 4 bb a call is nearly free for the blinds and several players call (overcalls), which the model leaves out: at 3 bb it shoves 12–17 points wider than the chart from the button to UTG (1 bb: 98–100% against 44–47%), at 4 bb within 3.6 points; the small blind's column is right at every stack. *Checks:* `check-range-tables` checks that the small blind shoves every hand with 1 bb (the big blind's call is free; with 1 or 2 bb the table is not monotone in `k`, nor is the chart) and that the module's rounds equal `ITERATIONS`; `PUSH_FOLD_KNOWN_MISSES` and the `it.fails` tests are gone; `tests/brain/pushFoldData.test.ts` also holds the chart's 88 cells from 5 to 15 bb (each within 2.5 points, mean below 1) and the HoldemResources heads-up numbers (within 1 point). The Appendix E spots that read the table hold: E7 (A5o at 26.8%, the button shoves 32.4% with 10 bb) and E18 (94o at 88.2%, 9-handed UTG shoves 10.9% with 8 bb).

### 8.5 Postflop policy

1. Compute `eRange`, `p`, `bucket`, `need`, `R`, `spr`, `texture`.
2. **Realisation `R`** (HEURISTIC): river 1.0; in position 1.0; out of position flop 0.85, turn 0.92; −0.05 if multiway.
3. **Implied odds** only for draws to a non-dominated hand (flush draws; straight draws on unpaired boards without three of a suit): `implied = P_hit × 0.5 × min(stackBehind, pot + toCall)`, `P_hit` = exact next-card hit chance (§6.6).
4. **Facing a bet:** raise for value with Monster, or with Strong on a Wet or Very wet board. Else call if `EV(call) = E·R·(pot + toCall) − toCall + implied > 0`. Else fold.
5. **Checked to the hero / first to act:**
   - Monster or Strong → bet, sized by texture. The coach never slow-plays.
   - Medium → check. Exceptions: in position, heads-up, Dry board → bet 1/3 pot (thin value); river in position with `p ≥ 0.6` → bet 1/3.
   - Draw → semi-bluff (1/2 pot on a Dry board, 2/3 pot on Wet or Very wet) if heads-up **and** (in position **or** hero was the preflop aggressor); else check.
   - Air → check. Exception: flop continuation bet 1/3 pot as preflop aggressor, heads-up, Dry board.
6. **SPR commitment** (bands confirmed only via search snippets; HEURISTIC): `spr ≤ 3`: top pair or better (`p ≥ 0.6` heads-up) is committed → never fold, prefer all-in lines. `3 < spr ≤ 6`: commit with two pair+, or overpair / top pair top kicker on Dry boards. `spr > 6`: one pair = pot control, at most two value streets.

**Implementation notes (chunk 5.4, `brain/postflopPolicy.ts`).** Readings where the text is open, all consistent with E9–E17:
- *Inputs.* `E` = `eRange`; a bot passes its perceived `E'` through `withEquity` (§9.4), which recomputes `p` and the bucket. "Facing a bet" = something to call (`facing` bet, raise or all-in). `R`'s −0.05 for a multiway pot applies on every street, the river included (0.95). Everything the features lack comes from the observation through `postflopSpot(obs)`: the bet faced, the hero's street bet and stack, the out cards, whether the hand is the nuts (§6.5), and how many earlier streets the hero bet or raised.
- *Implied odds* (facing a bet only): `P_hit` = the next-card chance of the out cards that make the draw's hand (a flush or a straight; a straight flush counts for either), so a flush draw plus an open-ender counts their union (15 outs), and overcard or set outs never count. `stackBehind` = min(the hero's chips behind after calling, the deepest live opponent's chips behind); `pot` is `winPot` (§8.2).
- *Made hand* (step 6) is what the hero's own cards make: a pair, two pair or trips needs a hole card in it (two pair with one pair on the board reads as the hero's own pair; a pair, two pair or trips on the board is nothing), a straight or better a hole card in its core; when the board plays it is nothing. Top kicker = the other hole card is the highest rank that is neither the pair's rank nor on the board (A♠Q♦ on A♥K♣7♦ is top pair top kicker).
- *Commitment.* The band comes from the current street's `spr`. `spr ≤ 3`: heads-up the test is `p ≥ 0.6` (the parenthetical replaces the made-hand test there), multiway it is top pair, an overpair, or two pair or better. "Prefer all-in lines" = a raise goes all-in; a bet keeps its §8.7 size, whose all-in row already moves the chips in at a low SPR. `3 < spr ≤ 6`: "commit" = never fold (not all-in: E14 bets 3/4 pot with the nut flush at SPR 4). Never fold = a call where the price says fold. `spr > 6`, one pair: no raise (call or fold instead), and no value or thin-value bet once the hero has bet or raised on two earlier streets of the hand.
- *Thin value.* The first exception (in position, heads-up, Dry) holds on every street; the river one (in position, `p ≥ 0.6`) also multiway and on any texture.
- *Reason codes* (the main one first; `data` holds chips, fractions in [0, 1] and keys, never English): bet → `VALUE_BET` (`NUTS` when no two-card hand beats the hero and the board does not play), `THIN_VALUE`, `SEMI_BLUFF`, `CBET_DRY`; raise → `VALUE_RAISE` (Monster), `RAISE_PROTECT` (Strong on a Wet board), `NUTS`, plus `COMMITTED` when it is all-in for that reason; call → `COMMITTED` whenever the hand is committed (E13, even when the price alone pays), else `CALL_ALLIN` facing an all-in, `IMPLIED` when only the implied odds make it pay, else `CALL_PROFITABLE`; fold → `BOARD_PLAYS` when the board plays (E17), `FOLD_ALLIN` facing an all-in, else `FOLD_PRICE`; check → `POT_CONTROL` (Medium, or a capped value hand), `CHECK_WEAK` on the flop and turn and `CHECK_FREE` on the river (there is no next card), `CHECK_FREE` too when a bet is not legal (nobody left to call it). A raise that is not legal becomes a call.
- *Bot hooks (§9.4):* `withEquity` (step 1), the size set argument (§9.2), and step 4's defence: `mdfFacing(obs)` (§8.9's `pot / (pot + inv)` for the street's last bet or raise), `handPercentile(hole, board)` (`handPct`, every two-card hand that uses no seen card, ties half) and `mdfDefends`.
- *A call that ends the betting (chunk 5.7).* When a call puts the hero all-in, or every live opponent is all-in, nobody can bet the hero off its equity any more: `R = 1` and no implied odds, as §8.4 and the EV model (§8.9) do (`PostflopSpot.callEndsBetting`). A value raise (Monster, or Strong on a Wet board) is intended only when a raise is legal; otherwise the price decides (call if `EV(call) > 0` or committed, else fold). Before, a short stack's Strong hand that could not raise became an automatic call explained as `CALL_PROFITABLE` at 28% against a 33% price (found by chunk 5.6; `tests/brain/allInCall.test.ts`).

### 8.6 Opponent ranges

- Each live opponent has 1,326 combo weights (blocked combos 0). Ranges are **rebuilt from the public history on every call** (stateless, safe with undo; cost ≤ 4 streets × 1,081 evaluations).
- **Preflop prior** from that player's **last preflop raise** if it raised, else its first voluntary action (an opener who later 4-bets reads as a 4-bettor; a limper who re-raises as a 3-bettor), using the `rankPct` order × `loosenessEstimate` (cap 100%). Soft edge: weight 1 up to `X`, linearly down to 0.01 at `1.25·X`, and 0.01 beyond (the floor below: no hand is ever impossible).

| Last raise, else first voluntary action | Top X% |
|---|---|
| Open raise (the first raise, limpers or not) from a spot with `k` behind | `openPct(k) × looseness` |
| Limp or call a limp | 50 |
| Call a raise | 25, top 4% down-weighted to 0.3 (they would have 3-bet) |
| 3-bet | 6 |
| 4-bet or more | 2.5 |
| All-in raise to ≤ 15 bb (before the 3-bet/4-bet rows) | `pushPct(k, S)`, `S` = raise-to ÷ bb |
| BB checks its option / no action yet | 100 (BB check: top 15% down-weighted to 0.3) |

- **Postflop re-weighting** (Loki rule, verified from Billings et al. 1998): after each action, `w *= clamp((EHS − μ + σ) / (2σ), 0.01, 1)`. `EHS` proxy = `HS` (percentile of the combo's current hand value among all unblocked combos on this board) + draw bonus (flush draw +0.15, OESD +0.12, gutshot +0.06 on the flop; halved on the turn). The 0.01 floor means no hand ever becomes impossible.

| Observed action | μ | σ |
|---|---|---|
| Bet or raise of size B | `0.50 + 0.30 × min(B / pot, 1)` | 0.20 |
| Call | 0.40 | 0.20 |
| Check | no ramp; combos with EHS > 0.8 × 0.6 (occasional slow-play) | — |

  Observed aggression: AF > 3 → μ − 0.08; AF < 1 → μ + 0.08 (the bet/raise μ only).
- **Sampling:** per opponent, a `Float32Array(1326)` cumulative distribution; draw by binary search. If the combo collides with cards already drawn this trial, redraw; after 20 collisions fall back to a uniform draw among free cards. (Exact and faster than rejection sampling on narrow ranges.)
- **Implementation notes (chunk 5.2, `brain/ranges.ts`).** `k` = players after the raiser in preflop order who can still act (not folded, not all-in). Every "×" above is the seat's looseness (all rows, the push row included); the trap bands (top 4%, top 15%) are not scaled. Looseness and the AF shift need seat statistics, so only `rangeModel: 'reweight+stats'` uses them (the coach); `static` and `reweight` use looseness 1 and no shift (generic priors, §9.2). `B` = the chips the action puts in (`amountIn`), `pot` = the pot before it (`potBefore`). The HS population = every combo that uses no card of that street's board and none the observer knows (its hole cards, face-up hands): 1,081 on the flop; ties count half, `HS = (below + (equal − 1) / 2) / (N − 1)`. A double gutshot takes the OESD bonus (8 outs); bonuses add up (flush draw + OESD = 0.27); no flush-draw bonus with a made flush, no straight-draw bonus with a made straight, and a straight card must use a hole card (as §6.2). After every action the weights are scaled so the largest is 1, with a `1e-12` numerical floor so hundreds of 0.01 factors never underflow to 0. A face-up live hand (`revealedHoles`) is its range exactly. The tables arrive through a `RangeTables` interface (`rankPctOfClass`, `pushPct`; default `RANGE_TABLES` from chunk 5.1).

### 8.7 Bet sizing (coach defaults; bots use their level's size set, §9.2)

| Spot | Size |
|---|---|
| Flop/turn, Dry | 1/3 pot (turn value bet: 1/2) |
| Flop/turn, Wet | 2/3 pot |
| Very wet (monotone, or four to a straight) | 3/4 pot |
| River value, Monster | 3/4 pot (full pot if `spr ≤ 1.5`) |
| River thin value (Medium, `p` 0.6–0.75) | 1/3 pot |
| River bluff (bots only) | 2/3 pot |
| Raise vs a bet | 3 × the bet in position, 3.5 × out of position |
| Any bet leaving < 25% of the pot behind, or `spr ≤ 1` | All-in |

Formulas: bet fraction f → `to = f × pot`; raise fraction f → `to = currentBet + f × (pot + toCall)` (pot-size raise: f = 1). Round to a multiple of the small blind, then clamp to `legalActions` bounds. If the result is ≤ the call amount, the action becomes a call.

**Implementation notes (chunk 5.4, `brain/sizing.ts`).**
- *Rows.* A value bet is a Monster or Strong bet (§8.5 step 5); "turn value bet: 1/2" is its size on a Dry turn, and a bot's non-value flop or turn bet on a Dry board stays 1/3. The **Very wet** row is the §8.2 `veryWet` class plus the two boards it names, which §8.2's `W` can score lower: a monotone board (every card one suit; a disconnected monotone flop has `W = 2`, Wet) and four distinct board ranks inside one five-rank window. The §8.5 sizes (semi-bluff 1/2 Dry and 2/3 Wet or Very wet, thin value 1/3, continuation bet 1/3) use the §8.2 class.
- *River value without a row.* A Strong (not Monster) river value bet takes the texture rows, a Dry board getting the turn's value size: Dry 1/2, Wet 2/3, Very wet 3/4. The thin-value row is §8.5's Medium exception (1/3 on any street); its "`p` 0.6–0.75" is not a second test.
- *Raise vs a bet:* "the bet" = the street's highest bet (the amount a call matches), so facing a bet of 2 bb the raise is to 6 bb in position and 7 bb out of position.
- *All-in row:* "behind" = the effective stack after the bet (`effStack − to`); "the pot" = the pot after this bet and one call (`pot + (to − heroStreetBet) + (to − currentBet)`): 750 into 1,000 with 1,200 effective leaves 450 against 2,500 (18%), so all-in. `spr` is the street's (§8.2). The row applies to every bet and raise of the texture size sets; Easy's and Medium's fixed sizes skip it.
- *All-in* is the hero's legal maximum (the engine returns what nobody can call); `kind` is `'allin'` exactly at the legal maximum, and a call stays `'call'` even when it is all-in.
- *Order:* raw amount → all-in row → round to the small blind → at or below the call level ("to": the hero's street bet + the call amount; a check when nothing is to call), or no bet/raise legal → passive → clamp to `[min, max]`. So an amount is a multiple of the small blind unless it sits on a bound (an odd minimum raise or all-in).
- *Bot size sets (§9.2):* `half` bets 1/2 pot and raises `currentBet + ½ × (pot + toCall)`; `two` bets a pot where the texture table says 3/4 or more and 1/2 pot otherwise, and raises a pot (f = 1) with a Monster's value raise, 1/2 otherwise; `texture+exploit` sizes as `texture`, and the Expert exploits (§9.5, chunk 7.1) bet the c-bet and thin-value rows (1/3 pot). `snapRaiseTo(to, legal, sb, heroStreetBet)` is this snap for a raw "to" amount.

### 8.8 Guardrails (every profile, including the coach; they override everything)

1. Never fold when checking is free.
2. Never fold with `p ≥ 0.95`.
3. Never call a river bet with `eRange < 0.03`.
4. Facing an all-in: **always call** when `eRange ≥ need + 0.15`; **never call** when `eRange < need − 0.25`, whatever the noise.
5. Illegal or sub-minimum amounts are snapped to legal ones.

These exist because rule-based advisors fail loudly on obvious spots (the "fold K-Q at 6.77-to-1" case in §1.7).

**Implementation notes (chunk 5.5, `brain/guardrails.ts`).** (1) *One object per rule:* `checkFree` (1), `tooStrongToFold` (2), `riverNoChance` (3), `allInPriceGood` and `allInPriceBad` (the always-call and never-call halves of 4), `legalAmount` (5). `guardrails(spot, action, rules = GUARDRAILS)` takes the list as a parameter, so a test drops one rule and shows its spot going wrong (Stage 5 criterion 3). (2) *Order:* rule 5 first, then 1–4 in order. Rules 1–4 only turn a fold into a check (1) or a call (2, 4), or a call into a fold (3, 4), each only when the new action is legal, so the result is legal and a second pass changes nothing; snapping last would let a raise that cannot be made (and so becomes a call) slip past rules 3 and 4. (3) *What they touch:* folds and calls, as worded; rules 1–4 never change a bet or raise (rule 3 does not stop a river bluff-raise, nor rule 4 a re-raise over an all-in while a third player can act). Rules 2 and 4 replace a fold with a call, the smallest fix. They read the true `p`, `eRange` and `need` (§9.4's noise never reaches them). "Facing an all-in" is `facing === 'allin'` (§8.2). Boundaries as written (≥ holds, < does not) with 1e-9 of floating-point slack. (4) *Rule 5 (`snapToLegal`)* changes only an illegal action; a legal amount that is not a multiple of the small blind stays. A bet or raise that is not a whole number inside the bounds is rounded to a multiple of the small blind and clamped (a missing amount is the minimum); rounded to the call level or below, it is a call (a check with nothing to call), as §8.7 says. A bet facing a bet is that raise, a raise with nothing to raise is that bet, and with neither allowed it is the call or check; a check facing a bet is the call and a call with nothing to call is the check (one button on screen). A fold when checking is free is rule 1's. (5) *Reasons:* each fired rule 1–4 adds `{ code: 'GUARDRAIL', data: { rule, detail } }` with `detail` = the rule's id, which `en.ts` maps to the F.1 `{detail}` sentence (`allInPriceGood` = 4 always-call, `allInPriceBad` = 4 never-call); rule 5 explains nothing. (6) `isLegalAction` is the brain's copy of the engine's action check (the brain cannot run engine code); a property test compares the two on random actions, and the guardrail properties run 2,000 random decision points each (always legal, idempotent, the limits hold, a sound action stands).

### 8.9 EV model and grading

**Candidate actions** (snapped to legal, duplicates removed): fold (if legal); check or call; postflop bets 1/3, 1/2, 2/3, 3/4, 1 pot, all-in; raises: min, 2.5×, 3×, 4× the bet, all-in; preflop opens 2.5, 3, 4 bb (+1 per limper), all-in.

**EVs** (chips from now, relative to folding; money in the pot is sunk; HEURISTIC; `E` = `eRange`):
- `EV(fold) = 0`; `EV(check) = E·R·pot`; `EV(call)` as in §8.5 / §8.3.
- `EV(bet or raise to T)`: `inv = T − heroStreetBet`; if called, `pot' = pot + inv + (T − villainStreetBet)`; `EV = FE·pot + (1 − FE)·(E_called·R·pot' − inv)`.
  - Each opponent `i` continues with the top `c_i = clamp(MDF × stickiness_i, 0.15, 0.95)` of its weighted range, `MDF = pot / (pot + inv)`. Multiway `FE = Π (1 − c_i / √n)` (HEURISTIC).
  - `E_called` = 800 weighted trials against only the continuing part of each range.
- If the hero's own size is not a candidate, compute its EV exactly the same way (800 trials).
- **Implementation notes (chunk 5.5, `brain/ev.ts`).** The formulas are plain functions (`evFold`, `evCheck`, `evCall`, `mdf`, `continueFraction`, `foldEquity`, `evBetOrRaise`, `continuingWeights`); `evModel(spot)` gives `ev(action)` and `candidates()` for one decision (`candidateEVs`, `actionEV`, `confidence` around it). Readings where the text is open: (1) `R` and the implied odds are inputs from the policy (§8.3 steps 3–4, §8.5 steps 2–3), which owns those formulas. After an action that ends the hero's betting (the hero is all-in, calls the all-in of the last opponent who could bet, or bets what the only opponent who can act can match only all-in), `R = 1` and there are no implied odds, as §8.4 does. (2) "The villain" of `pot'` is the opponent who can still act with the most chips this street (street bet + stack; ties: the larger street bet, then the lower seat). A bet larger than it can match is valued at the matched amount, the rest coming back uncalled: `inv`, `MDF` and `pot'` use it (the §0.3 idea, for bets). (3) An opponent already all-in cannot fold: while one is live `FE = 0`, and it keeps its whole range in `E_called`; `n` counts the opponents who can act. (4) "The top `c_i`": combos ordered by the §8.6 EHS proxy after the flop and by `rankPct` before it, strongest first (ties by combo index); the cut keeps `c_i` of the range's total weight, the combo on the edge in part. (5) `stickiness_i` is the §9.1 value of the seat's visible personality, else the mean over its level's list (the §9.5 prior), never a hidden personality. (6) Candidates: a computed size is rounded to a multiple of the small blind (§8.7), then snapped (§8.8 rule 5); the minimum and all-in come from the legal bounds. Keys `fold`, `check`, `call`, `bet:{to}`, `raise:{to}`, and `allin` for a bet or raise to the maximum. (7) `E_called` of a size is seeded with `deriveSeed(seed, 'ev-called', T)`, so a size has one EV whether it is a candidate or the hero's own (hint and grade read the same number); an illegal action is refused. (8) Confidence (below): Close when the top two candidate EVs are at most 3% of the pot apart, Clear when more than 10%; a lone candidate is Clear.
- **Implementation notes (chunk 5.7, `brain/ev.ts`, `brain/decide.ts`).** (9) *`E_called` against one caller.* `pot'` counts one call, so `E_called` is the equity against the villain's continuing range (plus the whole range of every all-in opponent, who is in the pot and cannot fold), not against every continuing range at once: with five players behind, the latter rated A♠A♥'s open under the gun at break-even (equity against five callers, pot of one), and the bots (§9.4 step 3) folded or limped aces. When somebody calls, it is nearly always one player. (10) *A hint's alternatives* are the sensible ones (§8.10 "one line per other sensible action"): for each kind of legal action other than the recommendation's, the one the coach would take: fold when there is something to call, check, call (never a limp or a complete, C10, nor a short stack's flat call of a raise, §8.4), and a bet or raise of the coach's own size (§8.3 before the flop, the §8.7 value size after it, so all-in only where those sizes go all-in). The EV-best of the candidate sizes is never offered: the fold-equity heuristic can rate a deep all-in near a normal open ("Close call: All-in 21,800 is also fine", found by chunk 5.6). (11) *A hint's confidence* compares the recommendation with its best alternative: Close when they are within 3% of the pot (either way; that alternative is `alt`, "also fine"), Clear when the recommendation leads by more than 10%, else Normal, also when the model rates the alternative higher (the rule policy decides; a hint never calls a choice "clear" that its own EVs rate worse). A bot's `Decision.confidence` is the literal top-two rule over its candidates (§9.8 reads `Decision.ev`). `Decision.ev` holds every §8.9 candidate, the recommendation and the alternatives (the grade, Stage 6). (12) Each action's EV is computed once per decision.

**Grade** (recommendation from the rule policy; grade relative to it, so the coach never contradicts itself):
- Same action type as the recommendation (for bets/raises: raise-to amount within ±15% of the recommended raise-to amount) → **Best**.
- Otherwise `loss = max(0, EV(rec) − EV(taken))`, `lossPot = loss / pot` (pot before the action), `lossBB = loss / bb`.
- If the model rates the taken action above the recommendation (`EV(taken) > EV(rec)`) and the spot is not Close → exactly **Good**. This rule overrides the table below: the coach never calls a move it did not recommend "Best", and never grades it worse than Good.
- **Close** spot (top two candidate EVs within 3% of the pot): both count as Best, and the hint says "Close call: {alt} is also fine". **Clear** spot: gap > 10% of the pot.

| Grade (UI label) | Condition | Floors |
|---|---|---|
| Best ("Best move") | `lossPot ≤ 1%` or equals the recommendation | |
| Good ("Good") | `lossPot ≤ 5%` | `lossBB < 0.25` → at most Good |
| Inaccuracy ("Slightly off") | `lossPot ≤ 15%` | `lossBB < 1` → at most Inaccuracy |
| Mistake ("Mistake") | `lossPot ≤ 40%` | |
| Blunder ("Big mistake") | `lossPot > 40%` and `lossBB ≥ 5` (else Mistake) | Fold when checking was free = Blunder (UI prevents it; rule kept for completeness) |

Order: base grade from `lossPot` → price signal may raise severity (call with `E·R < need − 0.15` → at least Mistake, `< need − 0.30` → Blunder; fold with `E·R > need + 0.15` → at least Mistake, `> need + 0.30` → Blunder) → bb floors cap severity (and a Blunder from any path, price signal included, still needs `lossBB ≥ 5`, else Mistake). Why pot-relative: the user picks stakes and depth; fixed-bb thresholds (PokerSnowie's default blunder = 2 bb) are too harsh at 20 bb and too soft at 300 bb.

**Leak tags** (first matching row; top 3 by total loss are shown in Stats with a lesson link):

| Tag | Trigger | Stats wording |
|---|---|---|
| `open-loose` | preflop unopened; hero raised; rec = fold | "Playing too many hands before the flop" |
| `open-tight` | preflop unopened; hero folded; rec = raise | "Folding good hands before the flop" |
| `limp` | preflop unopened; hero called the BB; rec ≠ call | "Calling the big blind instead of raising" |
| `call-pre-wide` | preflop facing a raise; hero called; rec = fold | "Calling raises with weak hands" |
| `fold-pre-much` | preflop facing a raise; hero folded; rec ≠ fold | "Folding too much to raises" |
| `pushfold` | `effBB ≤ 12`; hero deviated | "Short-stack all-in decisions" |
| `missed-value` | postflop; hero checked/called; rec = bet/raise with Strong/Monster | "Not betting your strong hands" |
| `bluff-much` | postflop; hero bet/raised with Air; rec = check/fold | "Bluffing too often" |
| `overfold` | postflop facing a bet; hero folded; rec = call/raise | "Folding when the price was good" |
| `chase` | facing a bet; hero called with a Draw; rec = fold | "Chasing draws without the right price" |
| `river-call` | river facing a bet; hero called; rec = fold | "Calling river bets with weak hands" |
| `call-light` | flop/turn facing a bet; hero called; rec = fold | "Calling bets without enough chance to win" |
| `sizing` | same action type, graded Inaccuracy or worse | "Bet sizes too big or too small" |

**Implementation notes (chunk 6.1, `brain/grade.ts`).** `coachAnswer(obs, eRandom)` is one deliberation of the coach (`deliberate` with `COACH`): the hint, and `grade(taken, decisionId, eRandom)` from the same numbers (`Deliberation.model`: each action's EV once, a size that is not a candidate computed by the same model, 800 trials, §8.9 "the hero's own size"). A.5 `grade(obs, taken, eRandom, decisionId)` is that answer's grade; `gradeOf(request)` grades the A.6 request (or chunk 6.2's `GradeAsk`) as it is. The rules are plain functions (`gradeOfLoss`, `priceSignal`, `capByBB`, `scoreGrade`, `leakOf`, `feedbackRow`), constants in `tunables.ts`. Readings where the text is open:
1. *Order.* A fold when checking is free: Blunder (the engine refuses it, so it is graded without its EV). Then the recommendation (Best), the close alternative (Best), a move rated above the recommendation (exactly Good), and only then the table → price signal → bb floors.
2. *Close* is the hint's (chunk 5.7 note 11: the recommendation against its best sensible alternative, within 3% of the pot). "Both count as Best" = the recommendation and that alternative (`Decision.alt`), each matched as the recommendation is (same action type; a bet or raise within ±15% of its "to"). "And the spot is not Close" in the rated-above rule reads "the move is not the close alternative": any other move the model rates above the recommendation is exactly Good, in a Close spot too, so the coach calls Best only what it recommended or named "also fine" (or what loses at most 1% of the pot, the table's own Best row).
3. *Loss* is reported for every grade, Best included: `max(0, EV(rec) − EV(taken))` (a size within 15%, or the close alternative, may lose a little; the error rate of §14.4 counts it); 0 for a move rated above the recommendation. `lossMilliBB = round(1000 × loss / bb)`.
4. *Price signal:* `E = eRange`; `R` = the call's realisation as the EV model values the call (the policy's `R` of the street, §8.3 step 3 / §8.5 step 2, and 1 when the call ends the betting, `callEndsBetting`); a fold reads the `R` of the call it gave up. It acts only on the table's path (never on the recommendation, the close alternative or a move rated above it). Boundaries as written ("<", ">" strict, "≤" inclusive, 1e-9 of slack).
5. *Leak tags* only for Inaccuracy or worse (a leak is a mistake pattern; Best and Good get none, so `count` in §14.4 counts mistakes). Before the flop "unopened" = nobody raised (`facing` none or limpers) and "facing a raise" = any raise, all-in included; after it "facing a bet" = a bet, raise or all-in to call. `pushfold` is §8.4's spot (before the flop, `effBB ≤ 12`, `pushFoldApplies`): after the flop there is no push/fold rule, and "effBB ≤ 12" alone would tag every short-stack postflop mistake. The table's order stands, so a short stack's folded shove is `open-tight`, its shove of a fold hand `open-loose`, its call of a shove `call-pre-wide`; `pushfold` tags what rows 1–5 do not name (a min-raise where the coach shoves, a flat call or a re-raise where it shoves or folds).
6. *F.5 rows* (`GradeResult.feedback = feedbackLine(row)`, only for Inaccuracy or worse; null for the fallback row, which the feedback card says itself with the coach's move in the player's unit, chunk 6.2). "Push/fold deviation": §8.4 applies and the coach's move is an all-in (a bet or raise to the legal maximum, or a call that puts the hero all-in) or a fold, `{S}` = §8.4's `S`. "Opened too loose": a raise or a limp into an unopened pot that the coach folds. "Folded a strong preflop hand": a preflop fold of a hand the coach plays with `rankPct ≤ 50` (`FEEDBACK_STRONG_PCT`, the coach's call cap: "strong enough to play" is then plainly true; a big blind's price defence with a weaker hand gets the price row). "Size": a bet or raise of the recommendation's type outside ±15%, `{size}` the coach's. The price rows in whole percentages, as F.5's rounding rule asks: a fold when `E·R` shows above `{need}` (then `{E}` does too), a call when `{E}` shows below it (then `E·R` does too); none for a fold before anyone raised (the coach never just calls there, C10). "Checked a Monster/Strong hand" and "Air" by the §8.2 bucket; the heads-up Air row only when checking was possible ("Checking was cheaper" is false facing a bet). The RANGE_ADJUST wording ("against their likely hands") reads the grade job's HUD number, else the hint's.
7. *`trace`* = the recommendation's reasons: the policy's and the guardrails' part of the hint's trace, without its RANGE_ADJUST, CLOSE_SPOT, WHY_NOT_* and RULE_2_4 lines (they show the HUD number). The recommendation, its EVs, the alternative and the confidence never read `eRandom` (it is shown, never compared), so a grade is the same from a hint asked with any HUD number, and `brain.worker` grades from any cached answer of the observation (§8.11).
*Tests:* `tests/brain/grade.test.ts` (each grade's threshold, the floors, the price signal and their order; pot-relative bands with bb floors; ±15%, the close alternative, rated above; every leak row and every F.5 row in order, never contradicting its whole numbers; spots played by the engine, e.g. the nut flush folded to a 1 bb bet: heads-up 4.2 bb lost is a Mistake by the 5 bb floor, three-handed 6.1 bb a Blunder), `grade.property.test.ts` (C8 and the consistency rules over 2,000 decision points through the worker's job runner; every grade, leak tag and F.5 reason occurs in real play), `grade.benchmark.test.ts` (Stage 6 acceptance 6, §8.11).

### 8.10 Explanations and consistency

- Every `Decision` carries `trace: Reason[]` (`{code, data}`); `brain/explain.ts` turns them into template keys and values, which the UI renders with the Appendix F.1 templates (`i18n/enCoach.ts` through `i18n/coach.ts`; `ui/coachText.ts` puts the lines in their places). The brain never builds English sentences.
- Language rules (checked by `scripts/check-copy.ts` over 1,000 generated situations): sentences ≤ 15 words (a placeholder counts as one word); whole-number percentages; no idioms; no unresolved `{placeholders}`; every poker term wrapped as `{g:term}` and present in the glossary.
- **Hint structure:** (1) headline: action and size, e.g. "Raise to 60 (3 BB)"; (2) reason: 1–3 sentences from the main reason code; (3) numbers line: "Win {E}% · Need {need}% · Pot {pot} · To call {toCall}"; (4) "Why not …?" one line per other sensible action (WHY_NOT_* codes); (5) "Close call: {alt} is also fine" when close.
- ⚠️ **Number consistency:** "win chance" in coach text is the HUD's `eRandom`. When `|eRange − eRandom| ≥ 0.05`, **or** when `need` lies strictly between the two rounded values (otherwise the text could say "you win 27%, you need 25%: fold"), the coach MUST show both with labels (template RANGE_ADJUST; `{E}` rules in Appendix F.1): "Against any cards you win 62%. This player bets big only with good hands. Against those, you win about 35%." Never show a bare range number.
- **Strength meter** (5 labelled segments from `p`, aligned with the §8.2 buckets so the meter and the reason text never disagree): Weak < 0.35, Marginal 0.35–0.45, Decent 0.45–0.65, Strong 0.65–0.85, Monster ≥ 0.85. Lower bounds inclusive. ⚠️ **It never argues against the move** (pitfall 34): next to a fold it shows at most Decent (the price or the seat says fold, not the hand); next to a bet or raise at least Marginal, unless the main reason says why a weak hand bets (SEMI_BLUFF, CBET_DRY, PUSH_FOLD). `Decision.strength` is this label (`meterStrength` in `brain/decide.ts`). With the fair-share `p` (§8.2) the two limits are a safety net: they acted on none of the 2,000 engine-built hints of the property test, which allows 1% (risk R18).
- **Outcome framing:** grade the decision, not the result. Best/Good decision that lost: "Good decision. You were unlucky this time." Mistake that won: "You won, but it was risky. You had {E}% when you called."
- **Rule of 2 and 4** (coach sheet, draws only): "Quick trick: outs × 2 ≈ % for the next card. Outs × 4 ≈ % by the river. Exact: {exact}%." Above 8 outs add: "The trick guesses too high for big draws."
- **Implementation notes (chunk 5.6).** *Files.* `brain/explain.ts`: `explain(input)` turns the decision (final action, the policy's and the guardrails' reasons, confidence, alternative, `eRandom`, `eRange`, `need`) and a few facts of the spot (`explainInput(obs, f, decision)`: pot, `winPot`, to call, legal actions, street, position, opponents, `k`, `rankPct`, hand names, draws, outs, the villain's last action) into an `Explanation`: headline, reasons, numbers line, "Why not …?" lines, close call, rule of 2 and 4, each a template key with its values and glossary keys, plus the codes shown (`trace`, for `Decision.trace`) and the numbers shown (`shown`: for the badge's range line and the price bar, §12.6). No Monte Carlo and plain JSON, so it runs wherever the hint is made and travels to the UI as data (the UI cannot import the brain, §2.1). `feedbackLine` is the F.5 plumbing (Stage 6 picks the row). `i18n/en.ts` holds every template (`en.coach.templates`) and the glossary (`en.glossary`) (chunk 5.7 moved both to `i18n/enCoach.ts`, `enCoach.coach.templates` and `enCoach.glossary`, so they load with the coach's lazy chunk); `i18n/coach.ts` renders a line into segments (glossary links and values, for the popovers) with the HUD's percentage rounding. *Readings* (rules in Appendix F.1, "Variants, hint lines and rules"): a sentence is used only when the whole numbers it shows agree with it; RANGE_ADJUST is also shown when `eRandom` would contradict a price sentence that the range number supports, because the rule above compares an unrounded `need` with rounded equities (need 25.01% with 21% and 25.49% slips through: "You win about 21%. You need 25%. Calling wins"); the range number of a hint is the equity its range code compared (§8.3's E against the raiser, which leaves out the players behind), and RANGE_ADJUST's story sentence is kept for the decision's own `eRange`. *Data from the policies (chunks 5.3–5.5), read as they are written:* sizes from the final action (5.3 writes `to`/`bb`, 5.4 `size`/`sizeBB`), `{hand}` from the hole cards (5.3 writes the class, "AKs"; F.2 wants "Ace-King suited"), 5.4's `E` (always `eRange`) replaced by the F.1 `{E}` rule, fractions (`Pfold`, `hitNext`, `needImplied`) shown as whole percentages, 5.5's GUARDRAIL `detail` = the guardrail's id. *`check-copy`* (CI `check` job; the rules in `scripts/copy-rules.ts`): every template (one per key, placeholders and glossary links exactly the key's, ≤ 15 words a sentence, no decimal number, rendered once with sample values), the glossary (keys = `GLOSSARY_KEYS`, definitions ≤ 15 words a sentence), then 1,000 situations from random tables and random legal play with the real engine (only in the script): each hero decision observed, its features computed (600 range trials and a 2,000-trial HUD number: words need no precision), before the flop the coach's own `preflopPolicy` decision, and every reason the spot allows under its policy's own condition and with the policies' data shapes (plus a few proposals past a §8.8 limit), passed through the real guardrails and EV model (§8.8, §8.9 with 100 `E_called` trials: Close/Clear and the alternative), explained, rendered and checked (`checkHint`: values, glossary, length, the HUD's `eRandom` in the numbers line, RANGE_ADJUST first at 5+ points with both numbers, no false comparison, no unlabelled range number, the headline = the action). About 3,000 hints in about 5 s. Until `decide()` exists (chunk 5.7) these generated decisions stand in for the real ones after the flop (the 5.4 policy, run locally from its branch over 3,000 situations, gave no problem once FALLBACK covered its price-less call); 5.7 runs `hint()` through `checkHint` as well. Not checkable by a script: idioms, and poker words written without `{g:term}` (F.1 links only the terms a beginner meets first); both stay review rules.

### 8.11 Coach tests and performance

- Every Appendix E golden spot passes; a HEURISTIC change must keep all of them green.
- Properties C2, C3, C4, C6, C7, C8 with fast-check (≥ 2,000 runs each).
- Every reason code renders with no missing placeholder; `check-copy` passes.
- Self-play: the coach profile playing against an Easy table wins with a 95% CI above zero over 20,000 hands (§9.7).
- Hint and grade share one computation, cached in `brain.worker` by `observationKey` (LRU, 32). Grading after the action costs only the EV of the taken action. *Chunk 6.1:* the cache holds `coachAnswer`s (§8.9 notes); a hint is looked up by observation and HUD number (its words show the number), a grade by observation alone: it reads the newest answer of its observation, whatever HUD number the hint job brought (usually none: the HUD is final only after the hint is asked), because the recommendation and its EVs never read it. Measured in Node through the job runner over 841 decision points of 6-max hands at 100 bb (`grade.benchmark.test.ts`, two runs on a loaded laptop): EVs cached p50 0.06 ms, p95 0.13–0.16 ms; one exact-size EV p50 0.5 ms, p95 2.8–3.5 ms (Stage 6 acceptance 6: ≤ 50 ms and ≤ 150 ms; the maxima, 16–41 ms and 35–107 ms, were the machine's load: called directly, the slowest exact-size grade took 3.3 ms); no hint before it (a full deliberation) p95 45–91 ms. *In the browser (chunk 6.5, `tests/e2e/perf.spec.ts`; Chromium on the dev Mac, the real brain.worker, the `grade` job from the act to its reply in the worker message log, real time, after 2 untimed samples):* cached EVs p50 1 ms, max 3 ms; an exact-size EV (a bet or raise of a size off the hint's candidates and more than 15% from the coach's own) p50 1 ms, max 2 ms, against 50 and 150 ms. The same cached grade after a real tap reads 14–15 ms: React draws the tap's update before the page reads the worker's reply, so that stretch is the page's own render, not grading (reported, no budget). The check is report-only in CI like the other speed checks and enforced by `npm run e2e:perf` (§17.5, R17).
- Budget on a mid-range phone: hint p50 ≤ 100 ms, p95 ≤ 300 ms. If `#bench` misses it, lower `eRange` trials to 2,500 and `E_called` to 500 (constants in `brain/tunables.ts`).

---

## 9. Bots

### 9.1 Personalities

VPIP/PFR targets follow common player-type definitions (TAG ~22/18 with AF ~2.5; LAG 25–40/20–35; Maniac 50+/35+; Calling Station 35–50/5–10; Rock 8–15/5–12). Players see plain names and a shape icon (colour is never the only cue).

| Id | Display name | Icon (Lucide) | VPIP/PFR | AF | looseness | pfrRatio | stickiness | bluffFreq | bluff3betFreq | slowplayFreq |
|---|---|---|---|---|---|---|---|---|---|---|
| rock | Careful | `shield` | 12/9 | 1.5 | 0.35 | 0.75 | 0.8 | 0.03 | 0.00 | 0.10 |
| tag | Solid (= coach baseline) | `circle-check` | 22/18 | 2.5 | 1.0 | 0.82 | 1.0 | 0.10 | 0.03 | 0.10 |
| lag | Aggressive | `trending-up` | 32/26 | 3.5 | 1.45 | 1.00 | 1.1 | 0.18 | 0.08 | 0.05 |
| station | Calls a lot | `equal` | 45/7 | 0.7 | 3.4 | 0.15 | 1.4 | 0.02 | 0.00 | 0.30 |
| maniac | Wild | `zap` | 60/45 | 5.0 | 3.5 | 0.75 | 1.2 | 0.35 | 0.15 | 0.00 |

- `looseness` multiplies every range percentage (cap 100%). `pfrRatio` = share of a bot's opens (unopened or limped pots) that raise rather than limp (§9.4 step 2; the coach never limps). `aggressionBias = 2.1 × ln(AF / 2.5)`, in units of the level's temperature `T` like every §9.4 step 3 bias, added to bet/raise scores. `stickiness` scales the continue fraction `c` (§8.9); the coach uses the same value when it models that bot. Bluff 3-bets use A5s–A2s and suited connectors first.
- The VPIP/PFR/AF columns are the targets; `looseness`, `pfrRatio` and the §9.4 biases are calibrated against them by self-play (§9.7; chunk 5.11 changed Rock's, Station's and Maniac's looseness, from 0.55, 2.0 and 2.7, and LAG's pfrRatio, from 0.80). So `looseness` is a bot's own threshold factor, no longer the §9.5 read `VPIP / 0.22` (which stays the coach's model of a seat): a Station needs 3.4 for its 45% because its calls facing a raise are bound by `EV(call) > 0`. The TAG row is also the coach's profile (`COACH`), so it stays as written.

### 9.2 Difficulty → engine parameters

| Parameter | Easy | Medium | Hard | Expert |
|---|---|---|---|---|
| Monte Carlo trials | 200 | 500 | 1,500 | 3,000 |
| `equityNoiseSD` (Gaussian noise on perceived E) | 0.12 | 0.07 | 0.03 | 0.01 |
| Range model | vs random hands (a preflop raise's `V` still from the opening table, §9.4 notes) | static preflop ranges, no postflop narrowing | Loki re-weighting, generic priors | re-weighting + per-seat stats + exploits |
| Position awareness | off (`openPct(4)` everywhere) | 50% blend | on | on |
| Sizes | always 1/2 pot (a readable tell) | 1/2 and pot | texture table §8.7 | texture table + exploits |
| Softmax temperature `T` | 0.25 | 0.12 | 0.06 | 0.04 |
| `defenseFactor` (share of MDF defended vs bets) | 0.55 | 0.70 | 0.85 | 0.95 (1.0 vs a hero with AF > 3.5) |
| Bluffs | random 5% | personality base | balanced by size (river bluff share ≈ `B / (pot + 2B)`) | balanced + exploits |
| Preflop threshold jitter `U(−j, j)` | 0.4 | 0.2 | 0.1 | 0.05 |
| Personality label visible | yes | yes | no ("Read their stats") | no |

### 9.3 Table mix, per-seat override and names

- Bots get personalities from a fixed list per level, taking the first `seatCount − 1` entries; replacement bots continue down the list, cycling. (Bot `i`, in seat `i + 1`, takes entry `i` of its seat's level list, so with per-seat levels at setup each seat reads its own list; `createTable` leaves `personalityCursor = nameCursor = seatCount − 1`.)

| Level | Personality list |
|---|---|
| Easy | Station, Station, Maniac, Station, Rock, Station, LAG, Station |
| Medium | TAG, Station, LAG, Rock, Station, Maniac, TAG, Station |
| Hard | TAG, LAG, Rock, TAG, LAG, Station, TAG, Rock |
| Expert | TAG, LAG, TAG, LAG, TAG, Rock, LAG, TAG |

- **Per-seat override (optional):** Setup → More options → "Set each bot's level", or tap a seat → bot card → level picker (the card opens in the middle of a hand too; a pick starts with the next hand). Stored in `TableConfig.seatLevels`; a seat with an override uses that level's parameters and label visibility. The seated bot keeps its personality; when that seat's bot is later replaced, the newcomer takes entry `personalityCursor mod 8` of the **seat's** level list, and the single `personalityCursor` advances. Takes effect at the next hand.
- **Names:** 24 short neutral first names (≤ 8 characters, no real public figures). Order = Fisher–Yates of the list with `rngFromSeed(deriveSeed(tableSeed, 'names'))`; each new bot takes the next name at `nameCursor`, skipping names currently seated, wrapping after 24 (so a name may return later, never twice at once). "Currently seated" includes the bots being replaced and the newcomers already named in the same `nextTable`, so a busted bot's name never sits straight back down. `playerId = 'bot-' + nameCursor` before it advances; `nameCursor` itself never wraps (the name is entry `nameCursor mod 24`), so a `playerId` is never reused at a table. First button: `randInt(rngFromSeed(deriveSeed(tableSeed, 'button')), seatCount)`. `tableId` = first 8 hex characters of `deriveSeed(tableSeed, 'id')`. Names: Anna, Ben, Carla, Dev, Emeka, Fatima, Gus, Hana, Ivan, Jade, Kofi, Lena, Mateo, Nora, Omar, Priya, Quinn, Rosa, Sam, Tariq, Uma, Viktor, Wen, Yara.
- **Bot card** (tap a seat): Easy/Medium → name, personality icon and name, one-line description, "How to beat them" tip (Appendix F.6), stack. Hard/Expert → "Style: unknown. Here is what you have seen:" with observed stats in plain words ("Plays 34% of hands · Raises 20% · Bets often"). *Implementation (chunk 5.10):* every opponent's pod is a button (`aria-haspopup="dialog"`, the same box, so no extra DOM node) that sends `{ type: 'botCard', seat }`; the store keeps the seat in `ui.botCardSeat` and opens the `botCard` overlay, a modal bottom sheet (`Modal`, the Menu's layer) that closes the `sheet` gate, so no bot acts behind it. ✕, Esc, a tap on the scrim and Android Back close it (focus returns to the seat). `app/botCardViews.ts` builds its data (`seat`, `name`, `personality`, `stack`: never a hole card) with the same level rule as the pod (`labelVisible`: Easy and Medium only; a seat's own level counts). The sheet is mounted only while it is open and its code is a lazy chunk (`React.lazy`, still precached), guarded by `LoadBoundary`: a chunk that cannot load closes the overlay again instead of leaving the gate shut over an empty screen. *Chunk 7.1:* a Hard/Expert card says "Style: unknown.", then "Here is what you have seen:" with the line "Plays 34% of hands · Raises 20% · Bets often" (`seen` in `BotCardData`: whole percentages of the hands in which the bot made a preflop decision, the §9.5 VPIP and PFR counters, and the aggression word from its postflop AF, Appendix F.10) and "Hands seen: {n}"; before its first preflop decision "You have not seen them play yet.". The numbers are what the player saw, `x / n` of the table's seat statistics (§9.5; the controller publishes them as `GameSlice.seatStats`), not the shrunk estimates the brain reads. *Chunk 7.2:* the card also holds the level picker of the per-seat override (above), below "Stack: {x}" (notes below).
- **Implementation notes (chunk 7.2, `app/botLevels.ts`, the `seatLevel` command, `ui/components/BotCard.tsx`, `ui/screens/MoreOptions.tsx`).** Readings where the text is open:
  1. *Where a pick lives.* In the settings' `seatLevels` (A.7), the way the table level lives in `Settings.botLevel` (§10): `{ type: 'seatLevel', seat, level }` (`level: null` = "Same as table") keeps it there at once, saved 250 ms later like any setting, and the controller makes the table follow it when the next hand is dealt and when the bots for it sit down at the end of the hand (`nextLevels` and `withLevels`, `withSettingsLevels`). So a pick survives a restart, also one made in the middle of a hand. Like the table level it is also a last-used value: the next Setup opens with it (closed, "More options" says "{n} bots have their own level.") and Home's Play makes a table with it. The settings hold one entry per seat of the table in play (`Settings.players`, A.7): a pick made at a table with another seat count first sets `players` to it, and settings made for another seat count are not applied to the table, which keeps its own overrides (a profile that does not match the saved table).
  2. *The hand in play.* A pick never touches the table the hand was dealt from: the pods, the card's label and statistics, the bots' profiles and the observations all read that table (`game.table`), so the label changes with the next hand, not before, and the other seats keep theirs. The card shows the picker's value from the settings (`BotCardData.nextLevel`: the seat's own level, null for the table's, and the table level "Same as table" means) and everything else from the hand. Between hands the table prepared for the next one (`game.next`) gets the new levels when it is dealt; a bot that already sat down keeps the personality it was picked with, as for a new table level (§10).
  3. *The picker.* One radio group, "This bot's level": "Same as table ({level})", Easy, Medium, Hard, Expert, and the line "Changes start with the next hand."; a tap sends the pick at once, with no confirm button (as in Settings). It is part of the card's lazy chunk. The bots keep waiting while it is used: the card holds the `sheet` gate.
  4. *Setup, "More options".* A button, closed; its content (a lazy chunk, mounted when it is first opened) is Speed (the Settings words), "Set each bot's level" and "Four-colour cards" (a switch; the only place for that setting until Stage 9's Display section). The list has one `<select>` per bot, "Bot 1" to "Bot {n}", numbered clockwise from the hero's left (seat 1 is the pod at the bottom left, §12.4), whose first choice is "Same as table ({level})" with the level chosen above. The form keeps one entry per seat and follows the players stepper (a seat that comes back starts at the table's level). Start sends `seatLevels`, `speed` and `fourColour` with the other answers (`TableSetup`, A.8); a section that was never opened sends the values it opened with.
  5. *Settings.* Under the Bot level cards, while some bot has its own level, the hint adds "{n} bots have their own level. Tap a bot at the table to change it.", because the cards above it do not change those bots.
  6. *Levels in force.* The table a hand is dealt from is the one `withLevels` has given the levels it is played at, so its `config.botLevel` and `config.seatLevels` are the levels in force, per seat (`levelsOf`), in `game.table`, in the session, in a replay record and in a Stage 8 `HandRecord` alike; the log's "hand start" lists them. Nothing records the pending ones. Stats: see §14.4.

### 9.4 Mixing, noise and defence

1. Perceived equity `E' = clamp(E + N(0, σ), 0, 1)`, `σ = equityNoiseSD`.
2. Rule action `A*` from §8.3–8.5 using `E'`. Preflop jitter is relative: every percentage threshold `X` (e.g. `openPct`, `pushPct`) becomes `X × looseness × (1 + U(−j, j))`, capped at 100. Limping: in an unopened or limped pot (not a §8.4 push or fold) a profile with `neverLimp: false` is in *limp mode* with probability `1 − pfrRatio`; then an open raise, whether `A*` or the step 5 pick, becomes a call (the big blind's a check). Every draw in this list (N, U, limp, bluff, slow-play, softmax) comes from the bot's decision seed, in this fixed order.
3. Score each legal candidate: `EV/pot` (§8.9) + `T ×` biases, in units of the level's temperature `T` (step 5): bet/raise `+aggressionBias`; call `+3 × (stickiness − 1)`; Air bucket bet `+2.5` with probability `bluffFreq`; Monster on a Dry board check `+2.5` with probability `slowplayFreq`; and `A*` `+1` after the flop, `+3.5` before it, in units of `max(T, 0.12)`. A bias so weighs the same against the other candidates at every level; only the EVs count for more at a lower `T`. `A*`'s bonus is the exception below Medium's `T` (0.12; chunk 7.3, R20): it anchors the rule policy against the error of the §8.9 heuristic, which is a share of the pot at every level (before the flop it rates a re-raise with any two cards at break-even or better), so at Hard and Expert it keeps its Medium value in pots, 0.42 pot before the flop and 0.12 after it (7 and 2 `T` at Hard, 10.5 and 3 at Expert). (Calibrated by self-play, §9.7; until chunk 5.11 the biases were in pots: `+0.05 × (stickiness − 1)`, `A*` `+0.10`, `+0.30`, `+0.30`, and `aggressionBias = ln(AF / 2.5) × 0.1`; until chunk 7.3 `A*`'s bonus was in units of `T` at every level.)
4. **Defence:** facing a bet, the bot also continues if `(1 − handPct) ≤ MDF × defenseFactor`, where `handPct` is its hand-strength percentile among all combos on this board. This fixes "bots fold to any re-raise", a common complaint about offline poker apps.
5. Pick with `P(a) ∝ exp(score / T)` using the bot's decision seed (§2.4).
6. Guardrails (§8.8) override the pick. The coach uses `deterministic: true` (argmax, σ = 0).

**Implementation notes (chunk 5.7, `brain/decide.ts`, `brain/profiles.ts`).** Readings where the text is open: (1) *The coach* (`deterministic`) picks `A*` itself, after sizing and the guardrails: §8.9 makes the rule policy the recommendation, and "argmax" over the step 3 scores would let the EV heuristic override the golden spots. `hint(obs, eRandom)` is `decide(obs, COACH, coachSeed(obs))` with the HUD number (C1). (2) *Seeds.* The `eRange` Monte Carlo runs on the decision seed itself (the coach: `coachSeed`, §2.4), the preflop multiway trials on `deriveSeed(seed, 'preflop')`, each bet's `E_called` on `deriveSeed(seed, 'ev-called', T)`, the step 1–5 draws on `deriveSeed(seed, 'mix')` in the fixed order N (Box–Muller), U, limp, bluff, slow-play, softmax, all drawn whether used or not, and the think time on `deriveSeed(seed, 'think')` (§9.8): no stream feeds two consumers. (3) *Perception.* `E'` drives the postflop rules (`withEquity`: `p` and the bucket follow it), the preflop rules (`PreflopStyle.equityNoise`) and the step 3 EVs; the guardrails read the true numbers. (4) *Limping* turns an open raise into a call (the big blind's into a check), never a short-stack shove; since chunk 5.11 limp mode also limps an open raise the softmax picks (`limpMode`, `botPick`), because limping only `A*` let the EVs' fold equity raise most of a Maniac's limps at Medium and far fewer at Easy (§9.7). (5) *Candidates* (step 3) are the §8.9 ones filtered to the level's sizes (§9.2): fold when legal, check or call, after the flop 'half' 1/2 pot (raises to `currentBet + 1/2 × (pot + toCall)`), 'two' also the pot size, the texture sets the §8.7 value size; before the flop the §8.3 raise of the spot (`preflopRaiseSize`: open, 3-bet, 4-bet, all-in); and `A*` itself. `E_called` uses the profile's `mcTrials` (at most 800). (6) *Biases* (in units of `T`, × `T` in the score): "Air bucket bet" is literal, a bet after the flop (not a raise); the bluff draw also serves the §9.1 bluff 3-bet: before the flop, facing one open, a suited A5–A2 or 54–T9 raise gets +2.5 when the draw is below `bluff3betFreq`. Easy bluffs a flat 5% (§9.2 "random 5%"). (7) *Defence* (step 4) applies after the flop, facing a bet: fold leaves the candidates; before the flop it would push every tight personality's VPIP far above its target. (8) A bot's `trace` is `A*`'s reasons when it picked `A*`, else only the guardrails' (bot reasons are never shown); its `eRandom` is `eRange`. (9) *Easy's range model* (`'random'`, chunk 5.11): its equity is against random hands (`eRange`, the multiway preflop equity, the §8.9 `E_called`), but the §8.3 raise rules read a raiser's `V` from the opening table as the static model does (`villainRange`); read as "any two cards", a raise made every Easy personality, the Rock included, 3-bet about 20% of the opens it faced, 4-bet 30% of the 3-bets and call 85% of the all-ins (§9.7). *Measured* (`tests/brain/decide.benchmark.test.ts`, a laptop, 1,271 decision points of 6-max hands): a Medium decision p50 1.6 ms, p95 3.8 ms; Easy p95 3.0 ms; the hint p50 7.3 ms, p95 13 ms with the HUD number given, p50 27 ms, p95 47 ms computing it.

### 9.5 Opponent modelling (Hard, Expert, and the coach's view of bots)

- Track per seat: VPIP, PFR, 3-bet %, fold to 3-bet, c-bet %, fold to c-bet, AF, WTSD. Shrink toward a prior with `k = 20` opportunities: `est = (x + k·prior) / (n + k)`. Prior = the personality target if its label is visible, else the population average of the level's list.
- `loosenessEstimate(seat) = clamp(estVPIP / 0.22, 0.5, 3.0)`.
- Definitions (chunk 5.2, `brain/opponentStats.ts`): VPIP/PFR opportunities = hands with a preflop decision (no walk, no all-in by posting); 3-bet = first preflop action facing exactly one raise not its own; fold to 3-bet = the opener's next action facing the second raise; c-bet = the last full preflop raiser's first flop action when nobody has bet the flop; fold to c-bet = first action facing that c-bet with no raise after it; WTSD = revealed at the showdown or run-out, of hands where it saw the flop; AF = postflop (bets + raises) / calls. AF shrinks in frequency space: `f = (agg + k·AF0/(1 + AF0)) / (agg + passive + k)`, `AF = f / (1 − f)` (n = 0 gives `AF0`). The prior's VPIP, PFR and AF are the §9.1 targets (the level list's mean when the label is hidden).
- Seat statistics update only at hand end, so every observation inside a hand sees the same statistics (keeps `observationKey` and the coach's numbers stable during a hand). The controller owns them: `brain/opponentStats.ts` exports the pure `updateSeatStats(stats, log: LogEvent[], seat)`; the result is stored in `SessionState.seatStats` (so a resumed hand has the same `observationKey` and the same hint), seat 0 is also written to `profile.heroModel`, and a replaced bot's entry resets to `null`. A new table starts with `null` for every bot seat.
- The hero's own counters persist on the device (`profile.heroModel`), so Expert bots adapt across sessions.
- **Expert exploits** (active at n ≥ 30): hero fold-to-c-bet > 60% → c-bet heads-up flops at 1/3 with any two cards; hero VPIP > 40% → value-bet Medium hands and halve bluffs; hero AF > 3.5 → stickiness + 0.2 and `defenseFactor = 1.0`.

**Implementation notes (chunk 7.1, `brain/exploits.ts`, `brain/bluffs.ts`, `brain/decide.ts`, `app/controller.ts`).** Readings where the text is open:
1. *Seat statistics in the controller.* Kept by `playerId` (`GameSlice.seatStats`; the observation gets them by seat, `statsBySeat`), so a bot that replaces a busted one starts with none without a reset step (its `playerId` is new, §9.3), and the players who left go when the next hand is dealt. Updated once per finished hand (`finishHand`, every seat dealt in); a hand finished headless when the player starts a new table mid-hand (§3.1: the app folds the hero) and a voided hand add nothing. A new table keeps only the hero's entry. The session stores them by seat and boot restores them, so a resumed hand has the same observations and hints. **The hero model** is the hero's entry (`'hero'`): it starts from `profile.heroModel` when that holds a hand, carries over to every new table, and stays in memory until Stage 8 writes it to the profile (§14.3 commit). The coach reads the same statistics (`reweight+stats`), so from the second hand of a table its ranges use them.
2. *Hard and Expert range models* were already in `profileFor` (`'reweight'`, `'reweight+stats'`, chunk 5.7); with the controller filling the statistics, Expert's looseness and AF shift now read each seat (§8.6), Hard's stay generic.
3. *The exploits* read what the hero has shown, `x / n` of its own counters (AF: postflop bets and raises over calls, `n` both counted), once `n ≥ 30` for that statistic (`EXPLOIT_MIN_OBSERVATIONS`; thresholds strictly above 60%, 40% and 3.5): §9.1 has no fold-to-c-bet target to shrink toward, and the 30 observations are the evidence gate. The hero is seat 0 (§0.3); an Expert bot exploits only while the hero is in the hand and never when it sits in seat 0 itself (self-play). *Where each applies:* the c-bet on the flop when the bot made the last full preflop raise, nobody has bet the flop, heads-up against the hero: the bot bets 1/3 pot with any two cards (its pick, not only `A*`); Medium hands heads-up against the hero with nothing to call: a check of the rule becomes a 1/3-pot thin-value bet (`A*`, so the mix still decides); halved bluffs while the hero is in the hand: `bluffFreq`, `bluff3betFreq` and the balanced river chance × 0.5; stickiness + 0.2 and `defenseFactor` 1.0 facing a bet or raise the hero made (the street's last aggressor). Pure functions of the observation (§9.6).
4. *Balanced river bluffs (§9.2 Hard and Expert, `balancedBluffs` in the profile).* On the river, with a bet allowed and an Air hand (as perceived), the bot bluffs 2/3 pot (§8.7 river bluff) with chance `q = min(1, s / (1 − s) × V / A)`, `s = B / (pot + 2B)`, else checks; on the flop and turn its bluffs stay the personality's. `V` and `A` are the weights of the range the bot's own play shows (`publicRange`: the §8.6 model of its seat as the opponent reads it, blocked only by public cards) whose river share against the opponent's range is ≥ 0.65 (they bet for value) and < 0.45 (Air), so bluffs make up `s` of its river bets. Heads-up only: a multiway river Air hand checks. The share of each combo ignores card removal between the two hands (`riverShares`).
5. *Measured* (`tests/brain/decide.benchmark.test.ts`, a laptop, 1,271 decision points of 6-max hands; Expert with every seat's statistics seen and the exploits on): a Hard decision p50 2.8 ms, p95 5.3 ms; Expert p50 4.3 ms, p95 7.6 ms (budget 150 ms, Stage 7 acceptance 5); Medium p95 3.6 ms; the hint p95 12.3 ms with the HUD number, 44.9 ms computing it (unchanged).

### 9.6 Non-cheating proof (MUST)

1. Module boundary (§2.1): `brain/` cannot import engine runtime.
2. `brain.worker` is only ever sent `Observation` objects; `equity.worker` only hero cards, board, opponent count, and revealed hands.
3. **Property test:** for random hands and decision points, build the observation, then **permute every other seat's unrevealed hole cards and the undealt stub** (keeping the board and the observer's cards), build it again, and assert `decide()` returns an identical `Decision` for every profile and the coach. 1,000 runs per profile.
3b. The seed passed with `botDecision` is computed by the controller from `tableSeed` only (§2.4); a unit test asserts that changing `handSeed` (same table, same public history) leaves the bot seed unchanged. No value derived from `handSeed` ever crosses into `brain.worker`.
4. A DOM test asserts no bot hole card is rendered face up (or in any `aria-label`) before a run-out or showdown.
5. Hand review offers a provable shuffle (§16.3).

### 9.7 Calibration by headless self-play (`scripts/selfplay.ts`, nightly)

`npm run selfplay -- --level medium --players 6 --hands 20000 --seed 1`, using the real engine and brain in Node. Reports per seat VPIP, PFR, AF, WTSD, bb/100 with 95% CI, illegal-action count, p50/p95 decision time. Gates:
- Each personality's VPIP/PFR within ±4 points of target and AF within ±0.7 (Easy: VPIP within ±8).
- Zero illegal actions and zero invariant violations.
- Win rates (95% CI excluding 0): the coach profile beats an Easy table; Hard bots beat scripted "raise every hand" and "call everything" bots; a scripted "bet pot every street with any two cards" bot loses to a Hard table (anti-exploit); Expert beats Medium.

**Calibration results (chunk 5.11).** `npm run selfplay -- --level <medium|easy> --players 6 --hands 20000 --seed 1 --calibrate`: seats 0–5 hold the §9.3 Medium list (TAG, Station, LAG, Rock, Station, Maniac) at the run's level, every hand at 100 bb; 20,000 seat-hands per personality (Station 40,000). "Before" is `main` before this chunk (chunk 5.7's brain with the R18 `p`), "after" this chunk's; ✗ = outside the gate. 95% intervals: about ±0.7 points on VPIP/PFR, ±0.1–0.2 on AF.

| Personality | Target (gate) | Medium before | Medium after | Easy before | Easy after |
|---|---|---|---|---|---|
| Rock | VPIP 12 (±4, Easy ±8) | 27.5 ✗ | 14.0 | 51.7 ✗ | 13.4 |
| | PFR 9 (±4) | 21.8 ✗ | 7.2 | 42.2 ✗ | 7.1 |
| | AF 1.5 (±0.7) | 1.35 | 1.66 | 1.66 | 1.65 |
| TAG | VPIP 22 | 36.6 ✗ | 24.1 | 58.3 ✗ | 24.0 |
| | PFR 18 | 30.8 ✗ | 14.7 | 49.3 ✗ | 15.2 |
| | AF 2.5 | 1.95 | 2.15 | 1.77 ✗ | 2.03 |
| LAG | VPIP 32 | 48.7 ✗ | 33.8 | 62.6 ✗ | 33.5 |
| | PFR 26 | 43.8 ✗ | 26.6 | 54.2 ✗ | 25.6 |
| | AF 3.5 | 2.67 ✗ | 3.16 | 2.15 ✗ | 2.93 |
| Station | VPIP 45 | 33.6 ✗ | 46.2 | 53.3 ✗ | 49.2 |
| | PFR 7 | 25.2 ✗ | 7.0 | 40.9 ✗ | 6.2 |
| | AF 0.7 | 1.43 ✗ | 0.48 | 1.31 | 0.23 |
| Maniac | VPIP 60 | 58.2 | 61.8 | 67.5 | 60.7 |
| | PFR 45 | 53.1 ✗ | 46.5 | 59.4 ✗ | 43.9 |
| | AF 5.0 | 3.51 ✗ | 5.49 | 2.25 ✗ | 4.53 |

Before, 24 of the 30 gates failed (12 per level); after, none. What changed, each step measured with shorter runs first (the coach is untouched: it takes `A*` deterministically, so the golden spots E1–E22, C2–C7, the non-cheating test and the `COACH` profile test pass unchanged):
1. *Before the flop the EVs drowned the personalities.* The §8.9 fold-equity heuristic rates a raise with almost any two cards near break-even (folded to the button, 6-max: 7♣2♦'s open scores +0.064 pot, the fold 0), and `A*`'s +0.10 pot was only a factor 2.3 at Medium's `T`, so a TAG opened 7♣2♦ there about 40% of the time (now about 5%): every Medium personality raised 22–53% of its hands, the Station 25%. `A*` now gets +3.5 `T` before the flop (a factor 33 over an alternative of equal EV); after the flop +1 `T`, where `A*` is the TAG policy for everyone and the personality lives in the biases.
2. *The biases were in pots*, so Easy (`T` 0.25) kept half of each personality. Every §9.4 step 3 bias is now in units of `T`; at Medium the bluff and slow-play biases are unchanged (0.30 pot = 2.5 `T`).
3. *AF needed a wider spread.* Measured, `ln AF` moves about 0.5 per `T` of bias; `aggressionBias = 2.1 × ln(AF / 2.5)` (was 0.1 pot, 0.83 `T`, per unit of `ln`). 2.2 put Medium's Maniac at 5.69, too close to the edge.
4. *"Calls a lot" did nothing*: the call bias was 0.05 × 0.4 = 0.02 pot. Now `3 T × (stickiness − 1)`: Station +1.2 `T`, Maniac +0.6, LAG +0.3, Rock −0.6.
5. *Limp mode* (§9.4 step 2): limping only `A*`, the EVs raised most of the Maniac's limps at Medium (in unopened pots it limped 6% against `A*`'s 37%) but far fewer at Easy (22%), a 7-point PFR gap between the levels, almost the whole ±4 band. The limp draw now also limps an open raise the softmax picks, so `pfrRatio` holds at both levels; the Maniac keeps its §9.1 0.75.
6. *Easy's `'random'` model read every raiser as any two cards*: every Easy personality, the Rock included, 3-bet about 20% of the opens it faced, 4-bet 30% of the 3-bets and called 85% of the all-ins (WTSD 90–93%). A preflop raise's `V` now comes from the opening table (§9.4 note 9); Easy's equity is still against random hands.
7. *Four §9.1 numbers*: with 1–6 in place `A*`'s own ranges were off. Rock's looseness 0.55 → 0.35, Station's 2.0 → 3.4, Maniac's 2.7 → 3.5; LAG's `pfrRatio` 0.80 → 1.00 (with limp mode a 0.80 LAG raised 22–23% at Easy). TAG's row is the coach's and stays: its PFR sits low in the band (14.7 at Medium) because the §8.3 rules cold-call opens; the coach itself plays about 31/15/1.3 at this table.

Not chosen: the temperatures (a higher Medium `T` raised the Maniac's AF; §9.2's values stay), the aggression bias after the flop only (the Station's PFR rose to 21%), a lower `A*` bonus before the flop (3 `T`: LAG and Maniac too loose; 4 `T` left TAG's PFR at the edge), and the Maniac's bluffs (0.35 → 0.20 moved its AF by only 0.15). Tightest margins after: Easy's AFs (LAG 2.93, Maniac 4.53, TAG 2.03, Station 0.23: 0.13–0.23 inside the band; Easy's EVs weigh half as much, and they like aggression) and TAG's PFR at Medium (14.7). A brain change can tip one: rerun the calibration and retune these numbers, never widen a band.

Speed and legality (Node 24, Apple M1 Pro, 10 worker threads, the machine shared with other jobs): a Medium bot decision p50 1.5 ms, p95 3.7 ms (budget 100 ms, Stage 5 acceptance 6), an Easy one p50 0.9 ms, p95 2.6 ms; the hint (the coach seated at the Medium table, computing its HUD number as the game does when it has none) p50 9.8 ms, p95 46 ms, at full speed (the 600 ms budget at 6× throttle is checked on a phone through `#bench`, R17); 100,000 hands over 2–9 seats with random blinds and stacks, Easy and Medium mixed: 0 illegal actions, 0 invariant violations, 0 unfinished hands. The coach wins at both tables: +166 ± 67 bb/100 in TAG's seat at the Medium table (5,000 hands) and +288 ± 58 at an Easy table (10,000 hands, seats 1–5 from the §9.3 Easy list), so the first win-rate gate holds; the others need Hard and Expert (Stage 7).

### 9.8 Think time

`t = 450 ms + 900 ms × closeness + U(0, 400 ms)`, `closeness = 1 − min(1, EVgap / pot / 0.2)`; clamp 300–3,000 ms; all-in decisions ≥ 1,500 ms. Speed: Normal × 1, Fast × 0.5, Instant → 80 ms (enough for the announcement). `U` uses the bot's decision seed. The controller waits `max(t, compute time)`. Timers stop while any gate is closed.

Implementation (chunk 5.8): `brain.worker` computes `t` and sends it as `thinkMs` with the decision (`brain/think.ts`, `thinkMs(obs, decision, seed)`; whole milliseconds, Normal speed); the controller applies the speed factor. `EVgap` is the gap between the two best values of `Decision.ev` (§A.5, chips); a decision with fewer than two EVs counts as clear (`closeness` 0), as does a pot of 0. `U` is the first draw of `deriveSeed(seed, 'think')` (chunk 5.7: `decide()` draws its noise and mixing from the seed's other streams).

---

## 10. Levels (bots and coach)

The user asked for levels "like hard, easy and so on" for **both**. We ship two independent level controls, chosen on Setup and in Settings. First run defaults: **Easy bots + Beginner coach**. Coach level changes apply from the next hero decision; bot level changes from the next hand (seated bots keep their personality and get the new parameters). Every hand records the levels in force, so stats split by level (§14.4). The coach level never changes the advice itself (C4). *Implementation (chunk 5.10):* a level chosen in Setup becomes the table's and the last-used value in one step; a level chosen in Settings is saved with the settings (250 ms, §14.2). A new **bot level** reaches the table through `withLevels` when the next hand is dealt (and when the bots for it sit down at the end of the hand, so a newcomer comes from the new level's list, §9.3): seated bots keep their names, personalities and stacks, the table's own per-seat overrides stay, and the hand being played keeps the table it was dealt from (its pods and bot profiles read that table's level). The **coach level** is fixed per hero decision (chunk 6.4, the latch): when a hero decision starts, the controller takes the settings' level for it (`game.coachLevel`, the level in force), and a level chosen in Settings meanwhile applies from the next decision; an Undo returns to the decision at its own level. A decision started at Beginner had its hint on show, so it counts as helped (`hintSeen`, through `meta.hintShown`, kept in the session) even when the act comes after a change. Before the hero's first decision of a hand the settings' level is in force. After a reload the decision on screen takes the settings' level again (they cannot change across a reload). Setup and Settings offer all four bot levels (Hard and Expert since chunk 7.1) and all four coach levels (Advanced and Exam since chunk 6.4) (`AVAILABLE_LEVELS`); the stored settings and the engine accept all four of each. *Chunk 7.2:* the per-seat overrides travel the same way (§9.3 notes): `Settings.seatLevels` holds them, `withLevels` gives the next hand's table the settings' table level and overrides (before this chunk "the table's own per-seat overrides stay" meant the ones it was created with, which only Setup could set), and a bot's card, Setup's "More options" and Settings show them.

### 10.1 Bot levels

| Level | Setup text (what the player notices) | Engine |
|---|---|---|
| Easy | "Bots make many mistakes. They call too much and rarely bluff." | §9.2 Easy |
| Medium | "Bots play okay but are easy to read." | §9.2 Medium |
| Hard | "Bots play solid poker and read the board. Their style is hidden." | §9.2 Hard |
| Expert | "Bots study how you play and adapt." | §9.2 Expert |

### 10.2 Coach levels

A hint is **one tap away at every level**, honouring "I will always get a hint". Above Beginner, opening it marks the decision as *helped*.

| | **Beginner** "Full help" | **Intermediate** "Help on tap" | **Advanced** "Mistakes only" | **Exam** "Test yourself" |
|---|---|---|---|---|
| Hint before you act | Always open in the coach strip; recommended button has a 3 px accent ring + "Coach" badge | "Hint" button → action + 1 sentence; "Why?" opens the full sheet | "Hint" button (marks helped); a quiz on 1 in 4 decisions (§10.3) | "Hint (counts as help)" button |
| Win chance badge | Shown | Shown | Shown | **Hidden while you decide**; shown in the hand summary |
| Price chip "need X%" | Shown | Shown | In "Why?" only | Hidden |
| Hand label, sub-label, highlights | Shown | Shown | Shown | Shown |
| Draw chips: outs and % | Shown | Shown | Shown | Name only |
| Rankings panel | Tips + rarity + By-river columns; open by default on wide screens | Same, tips collapsed | Rarity + By-river; "Which hand wins?" quiz button | No By-river column; "Which hand wins?" button |
| Grade chip after you act | Every decision | Inaccuracy or worse | Mistake or worse | None during the hand |
| Pause + Undo offer | Inaccuracy or worse | Mistake or worse | Mistake or worse | Never |
| Toolbar Undo | Shown | Shown | Hidden (offered only inside feedback) | None |
| End-of-hand summary | Every hand | Only if Inaccuracy or worse | Only if Mistake or worse | Every hand: "Exam result" with all grades and the win % at each decision |
| Counts as "on your own" | Never (hint was visible) | Hint not opened | Hint not opened | Hint not opened |

The first three mirror PokerSnowie's advice modes (Always On / On Demand / Errors); Exam adds a clean way to measure progress.

**Implementation notes (chunk 6.4).** The table is data, `LEVEL_RULES` in `app/levels.ts` (one row per level, one field per §10.2 row; `tests/app/levels.test.ts` holds it against this table); `UNDO_POLICY` (chunk 6.2) is read from it. Every place reads the level in force (`selectCoachLevel`: the decision's, §10): the coach strip and sheet, Row A's ring, the HUD (badge, price chip, draw chips, big-move line), the rankings (tips, "By river", "Which hand wins?"), the toolbar Undo, the grade chips and the summary. Readings where the text is open:
- *Hint before you act:* Advanced and Exam show the hint as Intermediate does ("Hint", then the action and one sentence, "Why?" opens the sheet); Exam's button reads "Hint (counts as help)" (§12.6). After the tap the hint is the hint at every level, numbers included: at Exam opening it counts as help. The quiz is not the hint: answering it does not mark the decision helped (`hintSeen` stays false; its score is in `DecisionRecord.quiz`).
- *Win chance badge at Exam:* hidden for the whole hand, not only on the hero's turn (between the hero's turns the badge would show the same number); the big-move line goes with it (it explains the badge). The summary shows the number at each decision.
- *Rankings panel:* the tip line at Beginner only (Intermediate's "tips collapsed" and Advanced's "Rarity + By-river" both read as no tip line, chunk 5.9's reading; a tap on a row still opens its details, F.7); "Which hand wins?" at Advanced and Exam (§13.2 notes).
- *Grade chip after you act:* in the coach's place (the portrait strip, the landscape coach row, the wide panel's head, the compact pill's place) for 1.5 s after the grade arrives, a late one too (§11.3 r5), when the level shows that grade; the hero's next turn takes the place back at once. A decision taken back with Undo, or whose grading failed (`grade: null`), has no chip.
- *End-of-hand summary:* "every hand" = every hand with a hero decision (a hand the hero never acted in has nothing to sum up). Intermediate and Advanced look at every record of the hand, undone ones included (§11.4: they count). The level is the hand's latest decision's. The rows show the numbers at the decision ("You had 45%, needed 25%.") at every level; at Exam that is where the player first sees them, and the score of the hand is added. Built in `ui/components/HandSummary.tsx` (§12.9 notes).
- *Counts as "on your own":* `hintSeen` = the level's `hintAlwaysSeen` (Beginner) or the hint opened (`meta.hintShown`).
- *End to end (chunk 6.5, `tests/e2e/levels.spec.ts`; one phone and one desktop size per browser, since the rankings are a drawer and a column).* Hand 1 of the scripted table (`?seed=46&script=river-min-bet`) is played once per level with the same moves (check before the flop, check on the flop and the turn, fold the nut flush to the minimum bet on the river). At the flop, the turn and the river the page is compared with the expected page written out from the table above (not read from `LEVEL_RULES`): the coach strip's state (advice on show or a Hint button with its words), the ring on Row A, the badge, the price chip, the hand label, the draw chips (outs and % or the name only), the toolbar Undo, and the rankings panel (the ten tips, the By-river cells, "Which hand wins?", which opens its quiz). After each act the chip (from which grade, with its words), the card (from which grade; Advanced's offers Undo), the toolbar Undo and `hintSeen` per decision are checked against the grade the real coach gave, and at the hand end the summary (`hand` or `exam`, one row per decision with its grade, "Exam result", the score and "You had N%" at Exam). The coach's grades in that hand are Best, Slightly off, Best, Big mistake, so each level's threshold is met by a grade of the hand: Beginner pauses on the Slightly off, Intermediate shows its chip without a card, Advanced shows nothing until the Big mistake, Exam nothing at all.

### 10.3 Advanced quiz

On 1 in 4 hero decisions (`fnv1a32('quiz|' + observationKey(obs)) % 4 === 0`) where the pot ≥ 10 bb and the hint is ready (the quiz needs its numbers), before the hero acts, the coach strip becomes a three-tap quiz that hides the badge and price chip: (1) "Your win chance is about…" [Under 25%] [25–50%] [50–75%] [Over 75%]; (2) only when facing a bet: "You need about…" [Under 20%] [20–35%] [35–50%] [Over 50%]; (3) "Best move?" [Fold] [Check/Call] [Bet/Raise]. Right answers: the band holding the HUD `eRandom`, the band holding `need` (lower bounds inclusive: 25% is "25–50%"), and the recommendation's type (a call all-in is Check/Call; an all-in bet or raise is Bet/Raise; in a Close spot either type counts). Then "2 of 3 correct" with the right answers, and the action bar enables. A "Skip" link is always visible. Accuracy is stored in stats.

**Implementation notes (chunk 6.4, `app/quiz.ts`).** *When:* the controller rolls it with the hint job (`HintAsk.build`, from the same observation the hint is asked with, `obs` = the hero's `observe()`), only when the decision's level is Advanced and never again on a decision the player took back with Undo (its answers were on show); the hint jobs write it into the `coach` slice as they ask (`coach.quiz`, answers empty), so the badge (and the big-move line) hides from the start of the decision, before the hint lands; the quiz itself starts when the hint is ready, and a failed hint gives no quiz (the badge comes back). Seeded over 1,500 engine-played 6-handed hands, 592 of the hero's 2,424 decisions with a pot of 10 bb or more rolled one (24.4%; `tests/app/quiz.test.ts` allows 21.5–28.5%), and none under 10 bb. *Numbers:* the hint's `eRandom` and `need` (the HUD's number, C9; `need` with the capped `winPot`, §0.3), banded on the whole percentages the badge and the price chip show (`Math.round`), lower bounds inclusive. *Row A* stays on screen with its own labels but disabled while the quiz asks; a tap on it says "Answer the quiz first, or tap Skip." (`lockedView`; the tray cannot open). *Skip* ends it: the answers given so far count; none = no quiz. *Record:* at the act, `DecisionRecord.quiz = { correct, of }` over the questions answered (A.7); null without a quiz or with none answered. *Result:* "2 of 3 correct", then the right answers in one line ("Win chance: 25–50%. You need: 20–35%. Best move: Check/Call." — two moves in a Close spot, "Check/Call or Bet/Raise"), with "Hint" beside it; after "Hint" the strip shows the advice. *Places:* the portrait strip's row grows to fit it while it shows (the table gives the room back after, as the sizing tray pushes the rows, §12.7); compact mode: over the bottom of the table right above the hero's cards (the tray's place); landscape: the column's coach rows (choices two to a row; while it asks, the column's hand label gives way, as for the open tray, and the cards stay on the felt); wide: the inline panel. *Commands:* `quizAnswer { choice }` and `quizSkip`, applied by the store to the `coach` slice (A.8). It is a strip state, not an overlay: the `quiz` overlay and gate of A.8 stay unused (nothing runs during the hero's turn anyway). *Size:* the quiz and its words are a lazy chunk (`ui/quizEntry.ts`), loaded when the level in force is Advanced; a chunk that cannot load skips the quiz, so Row A never waits on it. *End to end (chunk 6.5, `tests/e2e/levels.spec.ts`, one desktop size per browser):* 40 real hands at Advanced against the real bots, the hero checking and calling everything. At each hero decision, once its hint has landed, the spec reads the pot (Σ of the seats' bets), the big blind and whether the controller rolled a quiz (`coach.quiz`): none under 10 bb, and the rate over the decisions of 10 bb or more must lie within 3.5 σ of 1 in 4 (σ = √(n · 3/16)); 20 to 22 of 80 to 95 such decisions in the runs of that day. The game is seeded, but a bot that answers too late under load takes the safest action (§12.14), so the count differs a little from run to run, which is why the band is statistical. A `MutationObserver` in the page records every moment a quiz asks (the flow helper skips a quiz as soon as it shows, so a spec cannot read the page in between): the badge and the price chip are never on the page then, and once a quiz is skipped the badge is back. The exact rate over thousands of decisions stays the unit test's.

### 10.4 Level suggestions (never automatic)

A card on the hand summary or Stats, at most once per 7 days after "Not now". Data sources: bot rules read `stats.recentHands` (ring of 500, A.7), filtered to the table's current bot level; the coach rule reads the `DecisionRecord`s in the `pc.v1.hands` ring, newest first. A rule is silent until it has the full sample. "Decision score" here = Σ `scorePoints` ÷ Σ `graded` over the same hands.
- **Bots up:** last 300 clean (not `assisted`) hands at this level net ≥ +10 bb/100 **and** decision score ≥ 80 → "You beat Easy bots. Try Medium?" [Try Medium] [Not now]. Not shown at Expert.
- **Bots down:** last 200 hands at this level (clean or practice) ≤ −30 bb/100 **and** decision score < 60 → "These bots are tough. Want easier bots for a while?" Not shown at Easy.
- **Coach down:** last 100 graded decisions with `hintSeen == false` (Beginner decisions excluded): Best+Good ≥ 75% and Mistake+Blunder ≤ 5% → "You rarely need help. Try less coach help?" Not shown at Exam.
- Accepting changes the level through the same path as Settings (§10 timing rules).

---

## 11. Undo and mistake feedback

### 11.1 What the player gets

1. **Feedback pause.** After a hero decision graded at or above the level's threshold (§10.2), the game pauses **before any bot acts and before any new card** and shows the feedback card: grade, one-sentence reason, the coach's move, **[Undo: try again]** and **[Keep my move]**.
2. **Toolbar Undo** takes back the hero's most recent decision (levels where it is shown).
3. After a hand ends, Undo becomes **Review hand** (read-only replay with grades, §12.10).

### 11.2 Design choice

| Option | Information leak | Verdict |
|---|---|---|
| A. No undo once any new card appears | none | Too strict alone: bots act and cards arrive within a second |
| **B. Restore the snapshot and reshuffle the undealt stub** | Removes board foresight; bots' public actions after your decision stay as weak information | **Chosen**, together with pause-before-cards |
| C. Restore as-is, mark as practice | Full foresight | Rejected: teaches "undo until you win" |

We **always** reshuffle on undo, not only when a card was revealed: one code path, and undo never gives deterministic knowledge of what comes next.

### 11.3 Rules (MUST)

1. **Snapshot** the full `HandState` plus controller meta at every hero decision point, before the hero acts. `decisionId` = number of hero `act` events already in this hand's log. Only the latest snapshot is kept; it is saved in the session.
2. **Toolbar Undo is enabled** only when all hold: the hero has acted at the latest snapshot and has not reached a newer decision point; the hand is not `complete`; `h.revealed` is empty (no run-out reveal, no showdown); this `decisionId` is not in `h.undoneDecisions` (**at most one undo per decision point**, which blocks re-rolling for a better turn card); the coach level allows it.
3. **Undo procedure:** (1) `controller.epoch++` (every timer and worker reply carries its epoch and is ignored if stale); (2) cancel equity and brain jobs; (3) `state = deepClone(snapshot.state)`; truncate `handInputs` to `snapshot.inputCount` (the undone act and every later input disappear from the replay log); `meta = snapshot.meta` plus the undone decision's `DecisionRecord` (with `undone: true`) appended; (4) `state = step(state, {kind:'reshuffle', decisionId, undoIndex: 0})` and append that input to `handInputs`; (5) mark the hand `assisted`, `undoCount += 1`; (6) the hero acts again; the hint is identical (determinism) and appears instantly from cache; toast "Move taken back. The unseen cards were shuffled again."
4. ⚠️ **Bots' hole cards and the current board never change**, so bots' earlier actions stay consistent.
5. **Grading gate:** after a hero `act`, the controller enters `grading` and does nothing else (no bot timer, no `advance`). If the grade arrives within 1,500 ms and meets the threshold → `feedback` (all timers paused, action bar disabled). A later grade shows as a chip without pausing; toolbar Undo still follows rule 2. Toolbar Undo stays disabled until the latest decision's grade has arrived (so the undone record always has a grade). A grade `error` reply or a missing reply after 5 s is retried once with the same inputs; if that also fails, the decision is recorded with `grade: null` (never counted, never punished) and Undo becomes available.
6. **Undo of a fold** is allowed under the same rules. After a fold without a pause, the hand continues at Fast speed so the player sees the board; Undo stays available (with reshuffle) until a reveal or hand end.
7. **After a reload** the snapshot is restored from the session, so Undo still works if rule 2 holds.
8. **Exam:** no undo at all.

**Implementation notes (chunk 6.2, `app/undo.ts`, `app/grading.ts`, the controller).** The pure parts are `app/undo.ts`: decision points (`heroDecisionsTaken`, `snapshotAt`), the §10.2 level rules (`UNDO_POLICY`: where Undo is offered, from which grade the game pauses), `undoBlock` (rule 2, r5, r8: which condition fails), `restoreForUndo` (r3 steps 3–5), the records, `hudEquityAt` and the feedback card's content (`feedbackView`). The grade port is `app/grading.ts`: a `Grader` runs one job; the app's is `brainGrader` (a `grade` job in brain.worker, slot `grade`), answered by chunk 6.1's `grade()` from the decision's cached hint (§8.9 notes, §8.11): one grading flow, the controller's. The controller holds the hand after a hero act (`hold`: `grading`, then maybe `feedback`); `pump` does nothing while it holds. Readings where the text is open:
- *The snapshot* (r1) is taken when a state with the hero to act becomes current (a `step`, a new hand, an Undo), once per state; its `meta` and `inputCount` are those of that moment.
- *Undo's meta* (r3 step 3) is the current meta with the undone decision's record marked `undone: true`, `undoCount + 1`: the snapshot's meta plus that record, and also a late grade of an earlier decision that arrived after the snapshot. `undoIndex` is always 0 (one undo per decision point). If `step` refuses the reshuffle (`UNDO_USED`), nothing changes.
- *Grading* (r5): the 1,500 ms is how long the hand waits (`GRADE_PAUSE_MS`); the job's own timeout is 5,000 ms (`GRADE_TIMEOUT_MS`), then one retry with the same inputs (`GRADE_ATTEMPTS` 2); a job that cannot be sent (brain.worker failed) counts as a failure. A new decision's grade replaces an older one still running, which is recorded with `grade: null`. Without a grader (unit tests of other features) every decision is recorded at once with `grade: null` and nothing waits. The grade job carries the HUD's final win chance only when the equity slice has it for exactly that situation (§8.2), else null. The grade chip (§12.6, and r5's late grade that "shows as a chip") came with chunk 6.4 (§10.2 notes): a late grade shows its chip when it arrives.
- *Levels:* the decision's level decides its pause and where its Undo is offered: since chunk 6.4 that is the level fixed when the decision started (§10, the latch; 6.2 read the setting at the act). The toolbar Undo's visibility follows the level in force, the latest decision's (the one Undo takes back), no longer the setting. At Advanced, Undo is possible only while the feedback card is open.
- *The feedback card:* Back and Esc mean Keep my move; leaving the Table (Menu → Leave table) keeps it, and it opens again with the Table (it never goes away by itself). When the decision was undone once already, a repeated mistake still shows the card, with [Undo: try again] disabled.
- *After a reload* (r7): the snapshot and the records come back from the session; a grade that was on its way is asked again, as a late one (no pause). The feedback card does not come back; the toolbar Undo still works where rule 2 holds.
- *Records* (A.7): `eRandom` is the HUD's number at the decision (final, else the latest estimate), null when there was none yet; `hintSeen` is true at Beginner (the hint is on show) or when `meta.hintShown` says the hint was opened: the controller writes it at the act when the `coach` slice's `opened` (chunk 5.9's `showHint`: "Hint", the sheet) names that decision, so it outlives an Undo and a reload.
- *Where the toolbar Undo sits* (§12.3, §12.5): portrait, in the coach strip's reserved 44 px slot on its left (the strip's own padding; the Undo is the row's first element, placed over it); landscape, at the left of the coach rows' first line (it keeps a 48 px row when the coach has nothing to say; the open sizing tray hides both); wide, at the left of the inline panel's head row, outside the panel's scrolling part; compact, in the top bar.
- *The `?script=<name>` hook* (Stage 6, `app/botScripts.ts`): it scripts the bots only (`botDecision` jobs answered on the main thread); hint, grade and bench jobs go on to the real brain.worker, so a scripted run is graded as the app grades. The E2E table is `?seed=46&script=river-min-bet` with 3 players: in hand 1 the hero is the big blind with A♣3♣, the board runs 8♣5♥2♣ J♦ T♣ and the small blind bets the minimum into the hero's nut flush on the river (on 6.1's tip: a fold there is a Blunder, F.5 "You folded with …"; checking the flop and the turn are Inaccuracies, "You checked a very strong hand"; the tests fix only what the flow owes a grade: the fold is at least a Mistake, a card shows exactly at the level's threshold, the level never changes a grade).
- *Tests:* `tests/app/undo.test.ts` (pure parts, the 10,000-undo chi-square), `controller.undo.test.ts` (the flow with stub graders: §11.5, acceptance 3 and 4), `controller.grade.test.ts` (the same flow with 6.1's real grade on the E2E table: following the hint is Best, the pause per level, Undo waits for the grade, a late grade, a failing job), `tests/ui/screens/Table.undo.test.tsx`, and the E2E spec `tests/e2e/undo.spec.ts` (acceptance 2; acceptance 3 at the reveal of a run-out and at showdown, the toolbar Undo hidden at Advanced and absent at Exam; both browsers, all six viewports). The spec pauses the page clock (`page.clock.pauseAt`) before the decision it watches: the 1,500 ms window cannot run out on a slow runner, and nothing on a timer moves until the spec moves the clock; brain replies still arrive. With real grades the default level (Beginner) pauses on every Inaccuracy, so the shared E2E helpers (`tests/e2e/game.ts`: `nextFlowPoint`, `playHands`, `keepMove`) answer a feedback card with Keep my move, as a player who reads it and goes on; the Stage 3–5 specs play on through them. The scripted-table helpers (`scriptedTable`, `playTo`, `pauseClock`, `feedbackCard`, …) are `tests/e2e/scripted.ts`, shared by `undo.spec.ts`, `grading.spec.ts` and `levels.spec.ts`.
- *End to end for acceptance 4 (chunk 6.5, `tests/e2e/grading.spec.ts`, one phone size per browser, the real brain.worker).* The faults are `window.__pc.faults` (`app/testFaults.ts`; E2E and development builds only, like `?seed=` and `?script=`, with its own marker in the bundle test): a layer between the brain client and its worker, the script's bots and the coach both behind it. `delay(kind, ms)` holds back the replies to jobs of a kind on the page clock; `fail(kind, n)` answers the next `n` jobs with an `error` reply that the worker never sees; `think(ms)` sets the think time of bot decisions (used at Normal and Fast speed: at Instant a bot takes 80 ms, §9.8); `kill()` terminates the worker and tells the client what `worker.onerror` would (§12.14). With nothing switched on it passes everything through, so the client, the controller and the worker are the app's own. The spec pauses the page clock before the hero's river fold and moves it with `runFor`, so 1,500 ms, 2,500 ms and 5,000 ms are exact on any runner. It shows: (1) a grade 2,500 ms late: the hand waits exactly 1,500 ms (`grade late`), the next bot is asked, no card comes for a Big mistake at Beginner, the toolbar Undo is disabled until the grade arrives (then its chip shows), and then it takes the move back; the same fold graded on time opens the card; (2) a grade job that errors twice (the same inputs twice, `grade request` attempts 1 and 2) or has no reply for 5 s (tried again once, two timeouts): `grade: null`, no pause, no card, Undo enabled, "No grade" in the summary; (3) brain.worker killed with a bot's decision on its way: recreated once, the bot takes the safest legal action, the hand ends; killed twice: no worker, every bot checks or folds, the hand ends, the grades are `null`, the coach strip says "Coach is not available", and [Try again] brings the worker back (§12.14).
- *The reason* (F.5): the grade carries it as a chunk 5.6 line (`GradeResult.feedback = feedbackLine(row)`, A.5), so the main thread renders it with `i18n/coach.ts` and never loads `brain/explain.ts`; with none, the card says the fallback row with the coach's move in the player's amount unit.
- *Size* (§15.3): the feedback card, its words and the coach-line renderer are a lazy chunk (`React.lazy`, like the bot card), precached for offline play; a chunk that cannot load keeps the move.

### 11.4 Stats treatment (honest, not punishing)

- A hand with `undoCount > 0` is `assisted`: chips carry on at the table, but its results go to the **Practice** bucket, not clean results (win rate, bb/100, VPIP/PFR).
- **The undone decision still counts in decision stats** (`undone: true`): decision score, mistakes per 100, streak. The new decision is graded too. Small print on the feedback card: "Undo lets you try again. The first move still counts in your stats." Stats show "Fixed with Undo: {n}" as a positive number.
- Storage is written only at hand end (plus the resume session), so undo never needs a storage rollback.

### 11.5 Tests (MUST)

- Restored state deep-equals the snapshot except `deck[deckPos..]`, `log` (one `reshuffle` event) and `undoneDecisions`.
- Over 10,000 seeded undos after the turn was shown, the new turn card is uniform over the stub (chi-square, p > 0.001).
- A second undo at the same `decisionId` is refused (UI disabled, keyboard shortcut ignored, engine throws `UNDO_USED`).
- Bots' hole cards and the board are unchanged across the undo; undo is unavailable once `revealed` is non-empty and after `complete`.
- A timer scheduled before the undo never fires an action after it (fake timers); 200 random undo taps during bot turns never produce a double bot action.
- The hand is flagged `assisted`; the undone decision is kept with `undone: true`.
- The `HandRecord` of a hand with an undo replays (§4.7) to exactly its final state: the undone inputs are gone and the `reshuffle` input is present.

---

## 12. Screens and mobile UX

All strings live in `src/i18n/en.ts` (Appendix F). Principles: one-handed portrait first; everything needed for a decision sits in the bottom 40% of the screen; no turn timer for the human; numbers are real text; colour is never the only cue; nothing important under a notch, the home indicator or an edge-swipe zone.

### 12.1 Screens and navigation

```
First launch ─► Welcome ─┬─► Play ─────────────────────► Table ◄─► (sheets: Coach, Hands, Bot card, Feedback, Menu)
                         └─► "Choose players, chips and levels" ─► Setup ─► Table
Later launches ─► Home ─┬─► Play (continue the saved hand, else a new table with last-used settings) ─► Table
                        ├─► New table… ─► Setup ─► Table
                        ├─► Learn (lessons, hand rankings, glossary)
                        ├─► Stats (Progress · Results · Hands · History ─► Review)
                        └─► Settings (… ─► About & Privacy)
Hidden: #bench
```

- ⚠️ **Playing is always one tap away.** From opening the app, one tap on **Play** reaches a dealt hand; no screen, dialog or tip may sit between Play and the first hand. There is no sign-up, login, nickname or email prompt anywhere; the hero is shown as "You".
- No router library: the store's `ui` slice holds a `Nav` (`app/navigation.ts`): the screen stack (the last one is on screen; the first is Welcome or Home) and the open overlays (Menu, the §3.1 dialogs), changed only by the pure `navigate(nav, action)` reducer and rendered by `ui/screens/ScreenSwitcher.tsx`. The Table always sits on Home, so Back from the Table goes Home; Setup's Start replaces Setup with the Table. Every screen change and every sheet/dialog opening calls `history.pushState`; on `popstate`, close the top-most overlay first, else go back one screen (the out-of-chips dialog cannot be closed by Back: it takes the Table with it, §3.1). Android's back gesture MUST close a sheet, never exit the app. The URL stays `/` (plus `#bench`).

| Screen | Contents |
|---|---|
| **Welcome** (first launch) | Wordmark "RB Poker Coach", "Learn poker by playing." Four short bullets (play against friendly bots · a coach tells you what to do, and why · see your hand, your chance to win, and all poker hands · free, no sign-up, works offline). **Play** (56 px, primary; also unlocks audio): starts a table **immediately** with the defaults (you + 5 bots = 6 players, 2,000 chips, blinds 10/20, Easy bots, Beginner coach), no Setup in between. Secondary link "Choose players, chips and levels" → Setup. Link "New to poker? 1-minute guide" → Learn lesson 1. Footer "Play money only · Privacy" |
| **Home** | **Play** (56 px, primary; also unlocks audio): continues the saved hand if a session exists, otherwise starts a new table with the last-used settings. Under it, when a session exists, one line "Hand 23 · 6 players · You have 2,340 chips · Easy bots · Beginner coach". Secondary **New table…** → Setup (players, chips, blinds, levels). Tiles Learn · Stats · Settings · Install app (when installable); teaser "Decision score this week: 81 (↑ 6)" after 20 decisions; "Play money only." |
| **Setup** | §12.2 |
| **Table** | §12.3–12.9 |
| **Stats** | §14.4 |
| **Settings** | Game: coach level, bot level, speed (Normal/Fast/Instant), auto next hand, show amounts as chips/BB, show win chance. Display: four-colour cards (on), text size (Normal/Large ×1.15), reduce motion (Follow system/On/Off), keep screen on. Sound: sound, vibration (Android only). Data: export, import, reset, "Protected from automatic clean-up: Yes/No". Diagnostics. About |
| **Learn** | 7 lessons (≤ 150 words each, one card diagram; Appendix F.8), the full-page hand rankings (same component as §13, with row details), searchable glossary. All bundled, offline |
| **About** | How this app works (the §1.5 assumptions, Appendix G.5), how the coach works, Privacy, disclaimer, help lines, licences, version |
| **Review** | §12.10 |
| **Bench** | `#bench`, debug only (§15.4) |

### 12.2 Setup ("Set up your table")

Setup is optional: **Play** never passes through it (§12.1). It opens from Welcome's "Choose players, chips and levels", Home's "New table…", Menu → New table and the out-of-chips "Change table". Four questions, then Start; everything else under "More options". Last-used values are remembered (and become what Home's Play uses); New table… → Start game is ≤ 2 taps.

1. **Players:** "How many players? (you + bots)" stepper [−] **6** [+], range 2–9, 44 px buttons, caption "You and 5 bots", a 120 px mini table preview.
2. **Chips:** starting chips 500 · 1,000 · **2,000** · 5,000 · 10,000 · Custom; blinds 5/10 · **10/20** · 25/50 · 50/100 · 100/200 · Custom. Live caption "Each player starts with 2,000 chips = 100 big blinds." + depth label: 10–24 bb "Short: many all-ins, fast games"; 25–59 "Medium"; 60–150 "Normal"; 151–500 "Deep: long hands, bigger decisions". Below 10 bb: "Too few chips for these blinds. Choose smaller blinds." Above 500 bb: "Very deep. Choose bigger blinds." Start disabled until valid. Custom: `inputmode="numeric"`, 16 px font, chips 200–1,000,000, BB 2–100,000 rounded up to even on blur, SB = BB/2 shown read-only; non-digits are stripped; an empty or out-of-range field shows its range under it ("200 to 1,000,000") and keeps Start disabled. Depth labels use `floor(chips / BB)`.
3. **Bots:** "How good are the bots?" four cards with the §10.1 text: **Easy** · Medium · Hard · Expert (2×2 below 380 px).
4. **Coach:** "How much help do you want?" four cards: **Beginner** "Full help" · Intermediate "Help on tap" · Advanced "Mistakes only" · Exam "Test yourself".
5. **More options** (collapsed): bot speed; "Set each bot's level" (per-seat override list); four-colour cards. Not in Stage 3 (its Setup has questions 1–4 only; speed is in Settings): it arrives with the per-seat levels (Stage 7, chunk 7.2; how it is built is in the §9.3 notes).
6. **Start game** (56 px, sticky above the safe area). Footer: "Play money only. Chips have no value. [Privacy]".

### 12.3 Table: portrait phone (360–430 px wide; the design target)

```
┌──────────────────────────────────────┐
│ ☰  Blinds 10/20 · Hand 12  Snd Hands │ top bar 44 px + safe-area-top
├──────────────────────────────────────┤
│         (Ben)        (Carla)         │
│  (Anna)                      (Dev)  ▐│
│               Pot 340               H│ ← "Hands" edge tab (28×88)
│      [Q♥][7♥][2♣][  ][  ]           a│
│  (Emeka)                            n│ table: 1fr, min 280 px
│                  ● 60               d│
├──────────────────────────────────────┤
│ [K♥][K♣]  Pair of Kings    ┌──────┐  │ hero strip ~112 px,
│           Overpair         │ 71%  │  │ overlaps felt by 24 px
│ You 2,340 [Flush draw · 9] │ win  │  │
├──────────────────────────────────────┤
│ ↶ Undo │ Coach: Bet 120. Worse … ›   │ coach strip 48 px (peek)
├──────────────────────────────────────┤
│ [  Fold  ] [ Check ] [  Bet ▲  ]     │ action bar 64 px + safe-area-bottom
└──────────────────────────────────────┘
```

- **Layout selection** (first match wins; one CSS media query each, mirrored by a `layout` field in the `ui` slice for JS):

| Layout | Condition | Used by |
|---|---|---|
| `wide` | `(min-width: 900px) and (min-height: 560px)` | desktop, tablet landscape (§12.5) |
| `landscape` | `(orientation: landscape) and (max-height: 559px)` | phone landscape, short desktop windows (§12.5) |
| `portrait` | everything else | phones, tablet portrait, foldables (this section) |

  Portrait wider than 430 px: the same layout, with the hero strip, coach strip and action bar capped at 600 px and centred; the table box grows (cards keep their maximum sizes).
- `#app`: CSS grid, `grid-template-rows: auto minmax(0, 1fr) auto auto auto`, `height: 100vh; height: 100dvh`. The page itself never scrolls (vertically or horizontally); only sheets and panels scroll internally. The table row's 280 px minimum is a design target, not a CSS minimum: below it, pods and cards scale down (compact mode).
- **Edge-tab gutter:** in `portrait` (and `landscape`, where the tab sits on the right edge of the table column: with 3 or 7 opponents an ellipse seat lands right on it) the seat and board coordinates (§12.4) are computed in the table box **minus a 28 px right gutter** that belongs to the Hands edge tab, so the tab never overlaps a pod at any player count.
- **Top bar:** menu (☰), "Blinds 10/20 · Hand 12", mute, **Hands** button (toggles the rankings sheet). All 44×44. (The ☰ and speaker in the sketch are drawn as SVG icons, never emoji.)
- **Table:** felt "stadium" inset 12% horizontally and 6% vertically (static radial gradient); seat pods (§12.4); bets; pot "Pot 340" and "Main 300 · Side 400" when side pots exist, centred right above the board (12 px gap, clear of a raised core card; a fixed (50,34) put it in the way of the upper side seats' bets); board centred at (50,50), card width `min(48px, (tableWidth × 0.6 − 16px) / 5, (tableWidth − 160px) / 5)` (36 px cap in compact mode; the last term keeps a 72 px column free on each side for the side pods: ~34×48 at 360 px, ~37×52 at 375 px; the column grows when a side pod beside the board sits further in, as with the sizing tray open on a 375×667 phone, and a top pod that comes down onto the pot moves the board and the pot down under it), empty slots as dashed outlines. The latest action appears for 1.2 s by the acting seat ("Raise to 60"). All of this geometry is computed in `ui/layout/seats.ts` (`tableGeometry()`), and unit tests check every player count at the Stage 3 viewports.
- **Hero strip:** hole cards 64×90 overlapping 30%, "You · 2,340" beneath; middle: label, sub-label, up to two draw chips (24 px tall, 44 px hit area; more collapse into "+1"); right: the win badge (76×60, number 28 px bold tabular) with the price chip beneath when facing a bet. Tapping the label opens the rankings panel at the highlighted row; tapping the badge opens its popover (§7.6). The draw chips sit on a 24 px row along the bottom of the strip, under the cards and the label (the badge column keeps the full height for the price chip): the Appendix F.3 chip text needs the width, so phones show one chip and "+N", wide screens two (landscape: under "You · 2,340" in the right column, one chip). On phones the chip reads "{name} · {pct}% {by river|next card}" with a "!" mark when some outs are risky; the full F.3 text (outs, "({n} risky)") is its accessible name and its popover's title, and wide screens show it on the chip. Any chip opens a popover with every draw and its out cards (§6.3). The strip sits above the Hands tab (z-index 7), so popovers over the felt cover it. (Chunk 5.9: hand names longer than 16 characters take a smaller size, the name keeps at most three lines and the sub-label two, and without draw chips the label may use their row, so a long label never runs into the coach strip; compact mode: two lines and one.)
- **Coach strip** (48 px peek): Undo (44×44, left; disabled, not hidden, at Beginner/Intermediate when unavailable; hidden at Advanced/Exam) and the level-dependent content (§12.6).
- **Compact mode** (`portrait` and `max-height: 640px`, e.g. iPhone SE in Safari; exact usable height UNVERIFIED): hole cards 52×74, board cards 36×50, the coach strip becomes a 44 px "Coach" pill in the hero strip, and Undo moves into the top bar in place of the mute button (mute moves to the Menu). The sizing tray **overlays** the bottom 104 px of the table area (no scrim) instead of pushing rows, so the table never shrinks below its content; it ends right above the hero's cards (the 20 px they reach into the felt stay visible, Stage 3 acceptance 2).
- **Menu** (☰, a modal sheet; closes the `menu` gate): Resume · Top up to {startingStack} chips (between hands, only when below it) · Hand rankings · Settings · Stats · Learn · Leave table (to Home; the unfinished hand stays saved) · New table (with the §3.1 confirmation mid-hand).

### 12.4 Seats

Portrait pod centres (x%, y%) of the table box, opponents clockwise from the hero's left (the next to act appears bottom-left, as in real clients):

| Opponents | Positions |
|---|---|
| 1 | (50,10) |
| 2 | (22,14) (78,14) |
| 3 | (10,42) (50,8) (90,42) |
| 4 | (10,58) (22,14) (78,14) (90,58) |
| 5 | (10,64) (12,30) (50,7) (88,30) (90,64) |
| 6 | (10,70) (10,42) (28,10) (72,10) (90,42) (90,70) |
| 7 | (10,74) (10,48) (18,20) (50,6) (82,20) (90,48) (90,74) |
| 8 | (10,78) (10,56) (12,32) (32,8) (68,8) (88,32) (90,56) (90,78) |

- Landscape phone and wide screens use an ellipse instead: for `m` opponents, `θ_j = 90° + j·360°/(m+1)` (j = 1..m; screen coordinates, y down; θ = 90° is the hero at the bottom), `x = 50 + 44·cos θ`, `y = 50 + 38·sin θ`.
- The 3- and 4-opponent side seats sit at x = 10 / 90 (not 12 / 88): at 12% a pod reaches over the board on 360–390 px phones.
- **Seat pod** 64×72: 36 px avatar circle with the initial (background from 8 fixed tokens by name hash; decoration only); name (≤ 8 characters), with the personality icon (11 px, Easy/Medium only) just before it; compact stack ("1.2k", always rounded **down**); status tag just under the avatar, so the initial stays visible ("Fold" with the pod at 45% opacity, "All-in", "Check", "Call", "Bet", "Raise", or thinking dots). Position clamp: `left: clamp(4px, calc(var(--x) - 32px), calc(100% - 68px))`, and the same vertically (`top` between 4 px and the hero strip's overlap: seats at y = 5–8% would poke out of short table boxes). A pod is a button that opens the bot card (§9.3). Dealer button: 20 px white "D" disc, or else a small "SB"/"BB" tag, in the pod's top corner on the side facing the centre, inside the 64×72 box (next to the board a disc beside the pod would touch the board). Everything is drawn inside the pod box except the bet chip.
- **Bot hole cards:** 16×22 backs tucked under the avatar in the pod's outer top corner; at run-out or showdown they flip to 36×50 faces across the top of the pod (the status tag, the dealer disc and the blind tag hide then: they would cover the ranks), with best-five highlights on the winner.
- **Bets:** chip icon + amount (exact up to 9,999, then "12.3k") 30% of the way from the seat to the centre when that spot is free; otherwise the nearest free slot beside the pod on the side facing the centre (it never covers a pod, the board, the pot or another bet); the hero's bet at (50,94).

### 12.5 Landscape phone and wide screens

- **Landscape phone** (`landscape` layout, §12.3 table): two columns: table (1fr, compact 36 px top bar, hero cards inset at the bottom of the felt) + a 280 px right column with hand label + win badge, then a coach header row (Undo 44×44 on its left, level content on its right), then coach text (scrolls), then Fold / Call / Raise **stacked vertically** as 56 px buttons under the right thumb; the sizing tray replaces the coach text when open (at 390 px tall the tray panel and the three 56 px buttons fill the column, so the label hides while the tray is open; the hero's cards stay on the felt). The top bar's 44×44 buttons reach 8 px below the 36 px bar, over the felt. The "Hands" tab sits on the right edge of the **table column** and its sheet covers the table column only. Never try to lock orientation (impossible for iOS web pages).
- **Wide screens** (`min-width: 900px and min-height: 560px`): `grid-template-columns: minmax(0, 1fr) clamp(260px, 24vw, 320px)`. Left: top bar, table (ellipse), hero strip, an **inline coach panel** (the coach sheet content, always expanded, scrolls; Undo sits at the left of its header row), and the action bar (max 720 px, centred). The panel's grid row has a **fixed height**, and the panel is drawn empty when the coach has nothing to say, so the table never changes size with the coach's words (§15.3: a row that followed the panel's content resized the table several times a hand, and the pods, placed in the measured box one render later, sat over the hero strip in between): `max(61px, min(30dvh, 100dvh − 540px − the top and bottom safe areas))`, i.e. 30% of the height, but the table box keeps 320 px (R14; 540 px = top bar 44 + hero strip 112 + action bar 64 + table 320) and the panel keeps its 61 px head row (`wideCoachPanel()` in `ui/layout/seats.ts`: 240 px at 1280×800, 228 px at 1024×768, 61 px on a window 601 px tall or less). Right: the persistent rankings panel (§13). When `settings.handsPanel == 'collapsed'` the right column becomes a 44 px rail with a vertical "Hands" button and the left column takes the space.
- **Keyboard shortcuts** (desktop): F fold · C check/call · B or R bet/raise · 1–5 presets · ↑/↓ one step · Enter confirm · Esc close · U undo · H hint · K toggle hands panel · ? list shortcuts. Never while a text input has focus.

### 12.6 Coach UI

| State | Beginner | Intermediate | Advanced | Exam |
|---|---|---|---|---|
| Hero's turn, pending | "Coach is thinking…" | "Hint" (disabled until ready) | "Hint" | "Hint (counts as help)" |
| Hero's turn, ready | "Coach: **Call 40**. You win about 45%. You need 25%. ›" | "Hint" → "Coach: **Call 40**. The price is good. ›" | "Hint" → same, decision marked helped; or the quiz | "Hint (counts as help)" → same |
| After the hero acts | grade chip 1.5 s ("✓✓ Best move", "✓ Good", "~ Slightly off"…) | chip for Inaccuracy+ | chip for Mistake+ | nothing |
| Bots acting | narration: "Ben raises to 60." | same | same | same |

- **Coach sheet** (tap the strip or ›): bottom sheet, max `45svh`, grows upward, **never covers the action bar**. Sections: (1) **Do this**: "Call 40" + "Clear choice" or "Close call: Fold is also fine"; (2) **Why**: 1–3 sentences (Intermediate shows the first + "More ›"); (3) **The numbers**: "Win chance 45% (any cards)", "Against their likely hands: about 38%" (when shown by §8.10), "Need 25%", pot, to call, and a **price bar** (0–100% bar, marker at Need, fill to the coach's win number, ✓/✗ text); link "How is this calculated?"; (4) **Your hand**: label, sub-label, draws with out cards as mini cards (risky ones marked "!"), "Next card: x% · By river: y%", "Hands that beat you right now: n of N possible"; (5) **Why not…**; (6) **Learn more**: lesson link; "Use coach size" fills the sizing tray. Strength meter at Beginner. Glossary terms are dotted-underlined; tap → one-line popover.
- **Feedback card** (the mistake pause): anchored above the action bar (max 50svh), 25% scrim over the table, action bar disabled, never auto-dismisses. Header: grade icon + label; reason (one sentence, Appendix F.5); "Coach's move: Call 40."; **[Undo: try again]** (primary, 56 px) and **[Keep my move]**; the small print of §11.4. `role="alertdialog"`, focus on Undo; keys U / Enter.
- Grade chips pair colour with an SVG icon and text: ✓✓ Best move, ✓ Good, ~ Slightly off, ✗ Mistake, ✗✗ Big mistake.
- **Implementation (chunk 6.4, Advanced and Exam).** Advanced and Exam show the hint as Intermediate (below); Exam's button reads "Hint (counts as help)" (the pill's accessible name too). The grade chip (`ui/components/GradeChip.tsx`, F.4: the grade's colour on a drawn mark and the border, the words in full contrast) takes the narration's place in the strip and the wide panel's head, and the compact pill's place, for 1.5 s from the grade's arrival (a display timer, `CHIP_MS` in `ui/screens/Table.tsx`; a strip mounted later shows only what is left of it), when the level shows that grade (§10.2 notes); the chip and the summary share one lazy CSS file with the quiz and "Which hand wins?" (`Levels.module.css`). The Advanced quiz takes the coach's place (§10.3 notes).
- **Implementation (chunk 5.9, Beginner and Intermediate; Advanced and Exam act as Intermediate, chunk 6.4).**
  - *Data* (`app/hintJobs.ts`, `app/coachViews.ts`): the hint of each hero decision (its key `coachKeyOf(hand)` = handSeq and log length) is asked once from `brain.worker` (`hint(obs, eRandom)` with the HUD's final number when the equity slice has it, else null, A.6), at every level (Intermediate's "Hint" waits for it); the reply carries the decision and `explain()` of it, and goes to the `coach` slice only (pitfall 37); the hero's action and a new epoch cancel it, and a late one is dropped; a 4 s timeout, an `error` reply or a failed worker show "Coach is not available. Tap to try again." (`retryCoach` asks again). (Chunk 5.9 built this on a main-thread pot-odds stand-in, `brain/hintStandIn.ts` behind a `HintSource`, in `app/coachJobs.ts`; chunk 5.7 replaced all three.) The `showHint` command (the "Hint" tap, opening the sheet) records the decision as opened: helped above Beginner (§10.2, read by Stage 6).
  - *Strip* (portrait, 48 px): the Undo slot is 44 px of padding on the strip's left; since chunk 6.2 the toolbar Undo sits in it (§11.3 notes). Beginner: "Coach: **Call 40**" over one line, the two numbers when facing a bet ("You win about 45%. You need 25%.") or else the reason's first sentence; the whole strip opens the sheet (the "›" is CSS). Intermediate: "Hint" (disabled until ready), then the action and the reason's first sentence, and "Why?" opens the sheet. ⚠️ When the hint shows RANGE_ADJUST the line is the labelled pair "Any cards: 62%. Their likely hands: about 35%." (pitfall 35): after RANGE_ADJUST the reason's `{E}` is `eRange` (F.1), labelled only by RANGE_ADJUST, so the reason shows only right after it (the sheet, the wide panel). "Why not …?" lines live there too: the 48 px peek has room for the action and one line. While others act the strip narrates the street's last action ("Ben raises to 60.", F.10) as plain text (the §12.12 live log is its own chunk). Glossary terms are plain text in the strip (it is one button).
  - *Compact*: the pill sits in the hero strip's draw-chip row (a 28 px face in a 44 px hit area, a draw chip ending before it); the label keeps the top row (two lines of name, one of sub-label). *Landscape*: the strip's content heads the column under the label (lines wrap) and "›" opens the sheet over the table column; the open tray takes the coach rows' place and scrolls inside when it is taller than the column. *Wide*: the inline panel is the strip's content as its head row (the action only, once the sections follow) and the sheet's sections, scrolling in the panel's fixed row (§12.5; an empty panel box when there is nothing to say); there is no sheet.
  - *Sheet*: a modal dialog in the host above the action bar (portrait and compact: everything above it; landscape: the table column), at most 45svh (landscape: the column), so the player can act with it open; ✕, Esc, the scrim and Back close it, and it closes when the decision goes. "Do this" shows the headline in the sheet only (the panels' head row has it). The numbers: the HUD number "(any cards)", the labelled range number (RANGE_ADJUST only), need, the pot the hero can win, to call; the price bar fills to the number the coach used and is named by its labelled line ("Against their likely hands: about 20%. Need 25%."), with a drawn ✓/✗ verdict; "How is this calculated?" opens the badge's text. "Your hand": label and sub-label, each draw with its out cards (risky ones "!", `data-examples` for the leak watch), next card and by-river chances, the beaters, the Rule of 2 and 4 when the trace has it. "Learn more" waits for the Learn screen; "Use coach size" shows when the coach bets or raises.
  - *Bundle* (§15.3): the strip, the sheet, the view builders (`ui/coach.ts`, `ui/coachText.ts`, `ui/glossary.ts`), `i18n/coachUi.ts` and 5.6's words (`i18n/coach.ts`, `i18n/enCoach.ts`) are one lazy chunk the Table asks for when it mounts (precached); the strip's row stays empty until it lands. The ring and the tray's amount come from `ui/coachAdvice.ts`, in the initial bundle.
  - *Text* (chunk 5.7 joined 5.6 and 5.9): `ui/coachText.ts` fills the seam, `HintText` (headline, RANGE_ADJUST, reason and its first sentence, further reasons, "Why not …?" lines, close call, rule of 2 and 4), from the hint's `Explanation`: each line rendered by `i18n/coach.ts` (`lineMarkup`: a glossary segment becomes a `{g:term}` mark, which `GlossaryText` turns into the dotted word, §12.6), RANGE_ADJUST when `shown.eRange` is set; the headline keeps the action bar's words (the amounts unit of the settings), and the numbers and the price bar read `shown` (C9). The glossary popovers read 5.6's glossary (`enCoach.glossary`). (Until then `ui/coachText.ts` rendered the trace with stand-in templates and a glossary in `i18n/coachUi.ts`; 5.7 deleted them.)

### 12.7 Action bar and sizing tray

Row A is always visible: three equal buttons, 56 px tall, 8 px gaps, most aggressive on the right (under the right thumb).

| Situation | Left | Middle | Right |
|---|---|---|---|
| No bet to face | "Fold" **disabled** | "Check" | "Bet ▲" |
| Facing a bet | "Fold" | "Call 40" | "Raise ▲" |
| Call puts the hero all-in | "Fold" | "Call all-in 380"; when `winPot < pot` (§0.3) a second line "Pot you can win {winPot}" | hidden; middle widens |
| Raise not allowed (not reopened) | "Fold" | "Call 40" | "Raise" disabled; tap → "You can't raise here: the all-in was too small to reopen the betting." |
| Nobody left to raise against (every other live seat is all-in) | "Fold" | "Call 40" | hidden; middle widens (the engine offers no raise without a responder, §3.5) |
| Not the hero's turn | all disabled at 40%; middle "Waiting…" | | |

- Disabled Fold, when tapped, shows "Checking is free. No need to fold." (keeps the slot for muscle memory and teaches the rule). The tip stays until the next tap anywhere or the next decision (no timer). Disabled Row A buttons use `aria-disabled` (still focusable, so focus never drops to the page when the turn passes); screen readers get the reason as the button's description.
- **Implementation (chunk 3.5):** `ui/actionBar.ts` `actionBarView()` builds the whole bar from `legalActions` (+ street, `currentBet`, blinds, per-seat `totalBet`, `Settings.amounts`); `ActionBar` and `SizingTray` are presentational. The view also carries the call's price (`toCall`, `pot`, `winPot`, `need`, §0.3) for the price chip (§7.6) and the coach; the bar itself shows only the "Pot you can win" line. Every amount the bar can send is legal (a property test runs random engine hands through it).
- **Only one legal amount** (`bet` or `raise` with `min == max`, i.e. all-in only): the right button reads "All-in {x}" and acts on one tap, no tray.
- **Tray starting amount:** the coach's size when the recommendation is visible at this level (Beginner, or after Hint); otherwise the middle preset (bet ½ pot, open 2.5 BB, raise 2.5×); always clamped to the legal bounds.
- Buttons ignore taps for 250 ms after an action. At Beginner (or after Hint) the recommended button has the accent ring and "Coach" badge. (Chunk 5.9: never on a disabled button; the badge describes the button to screen readers, `aria-describedby`; the coach chip below shows only while the recommendation is visible, since at Intermediate before "Hint" it would give the hint away, and when a preset has the coach's amount that preset is ringed instead of a sixth chip.)
- **Sizing tray** (104 px, opens **above** Row A, pushes the coach strip up). Preset chips 44 px tall, each showing its amount: postflop bet ⅓ · ½ · ⅔ · Pot · All-in; preflop open 2.5 BB · 3 BB · 4 BB · All-in; raise Min · 2.5× · 3× · Pot · All-in; plus a sixth "Coach: ¾ pot" chip when the coach's size differs (ringed when the level shows the recommendation). Out-of-range presets disabled; equal amounts merged. Slider row: [−] 44×44, native `<input type="range">` (step = SB, snaps to a preset within ±2%), [+], amount (tap → `inputmode="numeric"` ≥ 16 px; clamped on blur); long-press ± repeats at 8 steps/s. Row A's right button then reads "Bet 120" / "Raise to 120" / "All-in 2,340"; pressing it confirms. Tapping outside or ✕ closes. Slider `aria-valuetext="Raise to 120, 6 big blinds"`. All amounts are "raise to".
- **Amount rules (chunk 3.5):** preset targets use the §8.7 formulas (2.5× and 3× = that many times `currentBet`; Pot raise = `currentBet + pot + toCall`), are rounded to a multiple of the SB and then compared with the `legalActions` bounds (out of range → disabled; the Min and All-in chips are the bounds themselves, so they may be odd amounts). The slider's positions are the minimum, every multiple of the SB strictly between the bounds, and the maximum (so an odd minimum raise or all-in stays reachable); the ±2% preset snap applies while dragging only, never to arrow keys (it would trap them). A typed amount snaps to the nearest legal amount. The ▲ of "Bet ▲" / "Raise ▲" and the ✕ − + marks are drawn as SVG, never text glyphs. The ± press-and-hold repeat is a local input timer in the component (hold 400 ms, then every 125 ms); it never drives game flow (§0.3 "Time").
- **Tray placement:** `inline` (portrait: a 104 px row above Row A), `overlay` (compact mode: absolutely positioned over the bottom 104 px of the table area, no scrim) and `panel` (landscape: in the right column, in place of the coach text, chips on one row, the amount and ✕ under the slider). Its open state and amount live with the screen that places the tray and Row A (`useSizing`); the controller's Android Back handling closes it through the same `closeTray` as ✕ (§12.1).

### 12.8 Motion and look

| Event | Duration (Normal) |
|---|---|
| Deal one card | 180 ms, 60 ms stagger |
| Chips to pot at street end | 300 ms, then 400 ms pause |
| Board card flip | 250 ms |
| Showdown reveal | 500 ms per hand; banner 2.5 s or until tapped |
| Next hand | after 3 s or on tap (waits for a tap when a summary is shown) |
| Sheet open/close | 200 ms ease-out |
| Label / ladder pulse | 400 ms |

- Animate only `transform` and `opacity`; durations are CSS custom properties × `--speed` (Normal 1, Fast 0.5, Instant 0). Under `prefers-reduced-motion` (or the setting): movement becomes 120 ms fades, default speed Fast, no pulses or shimmer.
- The controller's pauses (`TIMING` in `app/controller.ts`) use the same factor: the first bot of a hand does not act before the hole cards have been dealt (180 ms + 60 ms per further card); every `advance` waits 700 ms (chips to the pot 300 ms, then the 400 ms pause), plus 500 ms per shown hand once, right after the reveal; the next hand starts 3 s after the hand ends, or on a tap, and never less than 1 s after it (so the result can be read at Instant too). Bots at Instant still take 80 ms (§9.8). These timers stop while any gate is closed and then run on with the time they had left.
- **Tokens** (single dark theme): `--bg #0f1512`, `--surface #18211c`, felt `#1f6b43`/`#154d30`, `--text #f2f5f3`, `--muted #a9b5ae`, `--accent #f5c542`; grades Best `#2fbf71`, Good `#8bd17c`, Slightly off `#f2c14e`, Mistake `#f08a24`, Big mistake `#e5484d`; card face `#fff`; four-colour suits spades `#111111`, hearts `#c8102e`, diamonds `#0b5bd3`, clubs `#177a36` (two-colour mode: ♠♣ `#111111`, ♥♦ `#c8102e`). Spacing 4/8/12/16/24/32; radius 4/8/14. System font; base 16 px; minimum 11 px captions. One cheap `box-shadow` on cards; no `backdrop-filter`, blur or animated shadows.
- **Sound** (`sound/synth.ts`, Web Audio, master gain 0.5): deal (30 ms noise, band-pass 3 kHz), chip (2.2 + 3.1 kHz sines, 60 ms decay), check (40 ms 180 Hz), fold (120 ms noise, low-pass sweep 4 kHz→800 Hz), your turn (660 then 880 Hz, 60 ms each), win (523/659/784 Hz arpeggio). No mistake sound: never shame the player. Default on; mute in the top bar.
- **Haptics** (Android only; feature-detect `navigator.vibrate`): 10 ms on your turn, 20 ms on a win.

### 12.9 Hand end

- Chips move to winners, side pots first. Banner at the table centre until the next hand starts (§12.8: 3 s, or a tap; with "Deal the next hand by itself" off it waits for the tap), one button ending in "[Next hand ›]"; under the board, clear of the side pods (when there is no room there, at the foot of the table just above the hero's cards, growing upward: it never reaches above the table box, where the top bar is), and in landscape in the right column above the buttons: "Ben wins 340 with Two Pair, Kings and Sevens." (winning five highlighted) · "You win 340!" · "Split pot: you and Ben each win 170." · "Everyone folded. You win 120." (no cards). Loser line at showdown: "Ben: Two Pair — loses to your Flush" (when the hero wins; at most two; with the same category both full names, "Ben: Pair of Kings — loses to your Pair of Aces"). Several winners with different amounts (side pots, an odd chip) get one line each. After a showdown a bot won, the board highlights its winning five. Plus the §7.6 luck line after an all-in, and the §8.10 outcome line.
- **Hand summary sheet** (when the level shows one): title "Hand 12: +160"; one row per hero decision: street, what you did, grade chip, coach's move if different, one-line lesson ("Turn · You folded · ✗ Mistake · Coach: Call · You had 45%, needed 25%"). Exam adds the win chance at each decision and the exam score. Buttons [Review hand] [Next hand ›].
  - *Chunk 6.4:* the sheet (`ui/components/HandSummary.tsx`, a `Modal` bottom sheet, its rows built by `ui/summary.ts`; a lazy chunk the Table asks for when it mounts, `ui/summaryEntry.ts`). The controller opens it (the `summary` overlay, which closes the `sheet` gate) once per hand at the hand end, when the level of the hand's latest decision shows one (§10.2 notes; `ControllerOptions.summaries`, on in the app); a grade that comes late can still open it during the hand end. With it open the next hand waits for "Next hand ›" (§12.8); ✕, Esc, the scrim and Back close it and leave the banner, whose 3 s wait then runs on. A row: "Turn · You folded", the grade chip ("Taken back with Undo" for an undone decision, "No grade" when grading failed), then "Coach: Call" when the coach's move was another (same type and amount = the same move) and the numbers at the decision ("You had 45%, needed 25%." facing a bet, else "You had 45%."; none without a HUD number). Exam: "Exam result" over the title and "Your score: 82 of 100" (the hand's decision score, §14.4). Amounts in the player's unit. "Review hand" opens Review on the hand (§12.10).
  - *Chunk 6.3:* the sheet and its per-decision rows need grades (chunk 6.1). Until they exist the hand-end banner carries the summary (who won what, with which hand, §12.9 above) and, under it, a link **"Review this hand"** that opens Review on that hand (§12.10). The link is a separate button: the banner itself stays one button that starts the next hand. On wide screens the link shares the "Next hand ›" row instead of taking a row of its own under the card: the table box there is only about 340 px tall (1280×800), and the old spot above the pot put a 112 px banner under the top bar, out of sight (`bannerStyle` in `ui/screens/Table.tsx`; `layout.spec.ts` checks it with nine players on phones and the wide screen).
- **Collection moment:** first time ever with a category → "New in your collection: Full House!" and a pulse on that ranking row.

### 12.10 Review (read-only replay)

Open from the hand summary or Stats → History (last 100 hands, each with its replay inputs). Same table layout; ⏮ ◀ ▶ ⏭ and auto-play; at each hero decision: grade, win chance at that moment, coach's move and reason. Bot cards shown only if they were shown at showdown; folded cards stay hidden. A "Check the shuffle" row (§16.3).

**Implementation notes (chunk 6.3, Review from memory).**
- **Hands kept:** the controller keeps the last 100 finished hands of the launch in the store's `review` slice (`app/review.ts`: the replay record, the hero's cards and the result the banner showed), newest first, until Stage 8 stores them (`pc.v1.hands`, §14.3). A hand finished without animation (a new table mid-hand, §3.1) or voided (§4.5) is not kept. The list the UI gets has no record and no seed.
- **Frames:** `buildReview` (`app/reviewViews.ts`) turns a hand into frames from `replayStates(record)` and the Table's own view builders (`seatView`, `boardViewOf`, `heroViewOf`, `potView`), so a bot's hole cards are face up from the step where the engine turned them over (run-out or showdown) and never before, and a folded hand is never shown, not even at the end. A record of another engine major version, or one that does not replay to a finished hand, shows its result only ("This hand cannot be replayed.", §4.7). The builder is small (0.8 KB gzip) and stays in the main chunk: loading it with its own `import()` made the bundler split the Table's view builders (or, when it imported them through the store, the store itself) into shared chunks that cost more initial JS (+1.4 to +3.2 KB) than the builder saves. The screen, its CSS and its words are lazy.
- **Steps:** the deal (cards dealt, blinds posted), then one step per input: an action, an `advance` (a new street, a reveal, the result) or an undo. A line under the table says what happened, with cards named in words (never with symbols, pitfall 31); the last step shows the result as the hand-end banner worded it (§12.9) and your net ("You won 160 chips."). The pods show nobody "thinking".
- **Controls:** first, back, forward, last, a slider, auto-play (one step every 1.5 s, stops at the last step; any step by hand pauses it). The arrow keys step, Home and End jump; the buttons use `aria-disabled` so the keyboard focus stays when one turns off; the line under the table is one atomic `aria-live` region that starts with "Step 7 of 23". Auto-play is a display timer: it never touches the game (§0.3). Leaving the table pauses the game (the `offTable` gate), so the 3 s hand-end wait stops while Review is open.
- **Screens:** the hand-end banner has "Review this hand" (§12.9) and the Menu "Recent hands" (once a hand is finished). Phones show the list or one replay ("All hands" switches); wide screens show the list in a column beside the replay (the newest hand when none is chosen); landscape phones put the line and the controls in the 280 px column. Back (and Android Back) leaves Review for the Table.
- **Still to come:** a hero decision's grade, win chance and the coach's move on its step (the decision records of Stage 6/8), and the "Check the shuffle" row (Stage 9, §16.3); both have their place marked in `ui/screens/Review.tsx`.

### 12.11 Dialogs, toasts and first-table tips

| Trigger | Copy | Actions |
|---|---|---|
| Hero has 0 chips | "You're out of chips. That's okay: chips are free here." | [Reload {startingStack} chips] [Change table] |
| A bot wins by folds | banner "{name} wins {x}. Everyone else folded." (no cards) | — |
| Worker failed (§12.14) | coach strip "Coach is not available. Tap to try again." | [Try again] |
| Unsupported browser (§12.14) | full page "This browser is too old for RB Poker Coach. Please update Safari or Chrome." | — |
| Bot replaced | toast "Nora sits down." | — |
| SW update ready | toast "Update ready. It installs after this hand." | — |
| First offline-ready | toast (once) "Ready to play offline." | — |
| Storage write failed | banner "Stats can't be saved in this browser mode (for example private browsing). Export before you close the tab." (the second sentence arrives with Export, Stage 8) | [OK] |
| Corrupt data recovered | toast "Your saved data was damaged. We started fresh and kept a copy." | — |
| Another tab has the game | banner "The game is open in another tab. Close it, or tap here to play here instead." | [Play here] |
| iOS, first finished session, not installed | "Tip: add RB Poker Coach to your Home Screen. Tap Share, then 'Add to Home Screen'. It works offline and keeps your stats safer." | [Got it] |
| First standalone launch, empty stats | "Played in Safari before? Export your stats there, then Import them here." | [Import] [Skip] |

First-table tips (once each, tap anywhere to dismiss, flags in `profile.flags`; none appears before the hero's cards are dealt, so Play still reaches a dealt hand in one tap): first hero turn on the hero strip "This is your hand. We show what you have and your chance to win."; on the coach strip "Your coach. It tells you what to do, and why."; after the first flop on the Hands tab "All poker hands, best to worst. Yours is highlighted."; after the first action on Undo "Changed your mind? Undo takes back your last move."

### 12.12 Accessibility (target WCAG 2.2 AA)

- **Touch targets:** primary buttons ≥ 56 px tall; every other control ≥ 44×44 CSS px with 8 px spacing (meets WCAG 2.5.5 AAA; Apple 44 pt; Material 48 dp). The one exception is a glossary term inside a coach sentence (chunk 5.9): it stays a word in the line, and its 44 px hit area is drawn around it by CSS (`::after`), as WCAG 2.5.8 allows for inline targets.
- **Colour never alone:** suits differ by SVG shape; four-colour deck on by default (hearts and clubs also differ by shape, for red/green colour blindness); grades have icons; highlighted cards are raised and outlined; personalities have icons. Text contrast ≥ 4.5:1; UI components ≥ 3:1; suit colours ≥ 4.5:1 on white.
- **Screen readers:** every card `aria-label="King of hearts"` (face-down "Hidden card"); each seat a button (it opens the bot card, §9.3; `aria-haspopup="dialog"`) labelled "Anna, bot, Careful, stack 1,250, bet 50, folded"; one visually hidden `aria-live="polite"` log ("Anna raises to 60"), at most one announcement per 800 ms, joined per bot turn; on each hero turn "Your turn. Pair of Kings. Win chance 71%. To call: 40." (re-announced only on final changes ≥ 5 points); buttons carry full text ("Call 40"); sheets `role="dialog"` + `aria-modal`, focus trap, Esc, focus returns to the opener; the hand label and win % are real text, never canvas.
- **Keyboard:** a full hand is playable with the keyboard (§12.5 shortcuts, Tab order action bar → coach strip → hero strip → table → top bar); visible 2 px accent focus ring.
- **Text size:** Large (×1.15); no clipping at 200% browser zoom on desktop. `<html lang="en">`. Never `user-scalable=no`, never lock orientation.

### 12.13 iOS Safari and Android Chrome rules

| Issue | Rule |
|---|---|
| Viewport | `width=device-width, initial-scale=1, viewport-fit=cover`; no `user-scalable=no` (ignored by iOS, hurts accessibility) |
| Height | `height: 100vh; height: 100dvh` on the shell; sheets use `svh` for max height (Safari 15.4+, Chrome 108+) |
| Safe areas | `env(safe-area-inset-*)` on top bar, action bar and landscape sides |
| Bounce / pull-to-refresh | `overscroll-behavior: none` on **both** `html` and `body`; `contain` on scroll panels |
| Double-tap zoom | `touch-action: manipulation` on the game surface; inputs ≥ 16 px font |
| Long-press callout | `-webkit-touch-callout: none; user-select: none; -webkit-tap-highlight-color: transparent` on game surfaces |
| Audio | Create and `resume()` the AudioContext inside the Play (or Setup's Start game) tap; the silent switch mutes it (accept); feature-detect `navigator.audioSession` and set `'ambient'` (version UNVERIFIED) |
| Vibration | Not on iOS; feature-detect; Android only |
| Background | `visibilitychange → hidden`: close the `hidden` gate, cancel worker jobs, flush storage; also flush on `pagehide`; resume 300 ms after visible. iOS may kill a backgrounded PWA: the session is saved after every step |
| Wake lock | Secure context only; skip when `navigator.wakeLock` is missing (§12.14). Request `screen` while a hand runs and the page is visible; re-request on visible; release on Home (home-screen apps only from iOS 18.4). Setting default on |
| Install | Needs HTTPS or `localhost` (never on a plain-http LAN address, §12.14). Android: catch `beforeinstallprompt`, show "Install app" tile/menu item; one-time card after the 2nd finished session. iOS: the one-time Share tip. Installed = `matchMedia('(display-mode: standalone)').matches \|\| navigator.standalone === true` |
| Installed-app storage | Home-screen apps have storage separate from Safari: the "Played in Safari before?" dialog |
| Edge swipes | ⚠️ Never open anything with an edge swipe: Safari edge swipes are back/forward (not disableable in installed PWAs); Android gesture navigation uses both edges for Back |

### 12.14 System states (loading, failure, unsupported)

| State | Behaviour |
|---|---|
| Boot | `index.html` paints the felt background with a centred "RB Poker Coach" wordmark (CSS only). Profile and session are read synchronously, then Welcome/Home renders. Workers start in the background; they are not awaited for Home. |
| Table opened before workers are ready | Dealing never waits for a worker: the hand is dealt at once and the hero's cards, label and highlight appear (main thread), so one tap on Play still shows a dealt hand within 2 s (§12.1, Stage 3). The win badge shows its skeleton until `equity.worker` answers; a bot's turn shows thinking dots until `brain.worker` is ready (max 3 s, then the worker-failure row below applies: the request is sent at once and the worker answers when it is up; the **first** decision of a session waits 3 s instead of 2, `TIMING.botFirstTimeoutMs`, until the worker has answered once). |
| Worker `error` event, or 2 consecutive timeouts of one worker | Terminate and recreate it once (new epoch). If it fails again: **equity** → badge shows "—" with the popover "Win chance is not available right now"; hand label and highlights still work (main thread). **brain** → bots take the safest legal action (check, else fold) so the hand always finishes; the coach strip shows the §12.11 "Coach is not available" row, whose [Try again] recreates the worker. Grades missing because of this are `null` (§11.3 r5). Counted in Diagnostics. |
| Equity timeout (4 s) | Keep the last provisional value with "~", or "—" if none; recompute on the next trigger (§7.4). |
| Unsupported browser | Feature check in `main.tsx` before mounting: module workers (try constructing a tiny `{ type: 'module' }` worker from a same-origin file) and `crypto.getRandomValues`. On failure render the §12.11 "too old" page (plain HTML, no workers). `<noscript>` shows the same text. |
| Storage unavailable / full | §14.6: playable in memory, banner once per launch. |
| First visit offline | Nothing to do (no service worker yet); the browser's own offline page appears. |
| ⚠️ Not a secure context (`window.isSecureContext === false`, e.g. a phone at `http://192.168.x.x:3000` on the LAN) | Service worker, PWA install, Web Locks, `navigator.storage.persist()`, `crypto.subtle`, `crypto.randomUUID`, Screen Wake Lock and Web Share need `https://` or `http://localhost`. `app/secure.ts` feature-detects each and the app degrades, never crashes: **no SW** → playable online, no "Ready to play offline" toast, no update toast, no Install tile; **no Web Locks** → the `rev` + `storage`-event fallback (§14.7); **no `crypto.subtle`** → hand records store `commit: null` and Review's shuffle row shows "Needs a secure connection (https)"; **no `persist()`** → skip, Settings shows "Protected from automatic clean-up: No"; **no wake lock** → skip; **no Web Share** → the Export fallbacks (§14.8). Never use `crypto.randomUUID` anywhere: IDs and seeds come from `crypto.getRandomValues` (works on insecure pages) and the seeded helpers (§2.4). Diagnostics lists which features are off. |

**Implementation (chunk 6.5).** [Try again] is the `retryCoach` command: `HintJobs.retry()` starts the brain client again (`WorkerClient.retry()`: a new worker and a fresh restart allowance) when it has `failed`, then asks for the decision's hint again, so the hint, the bots and the grades come back. Until chunk 6.5 it only asked again, which a failed client refuses, so the tap did nothing (found by the Stage 6 E2E that kills brain.worker twice, `tests/e2e/grading.spec.ts`; the unit test is in `tests/app/controller.hints.test.ts`). The E2E also shows the rest of the row in a real browser: a worker killed with a bot's decision on its way is recreated once and the bot takes the safest legal action; killed again, every bot checks or folds, the hand finishes and the grades after it are `null`.

---

## 13. Hand-rankings panel

This covers "on the screen, somewhere on the right, all poker hands with an example of cards, so I will know which one is higher".

### 13.1 Placement

- **Wide screens** (`(min-width: 900px) and (min-height: 560px)`: desktop, tablet landscape): a **persistent right column** `clamp(260px, 24vw, 320px)` wide, scrolling internally with `overscroll-behavior: contain`. It never pauses the game. It is open by default at **every** coach level; the top-bar Hands button (and K) collapses it to a 44 px rail and back, remembered in `settings.handsPanel`. (§10.2's "open by default on wide screens" means this default.)
- **Everything else** (phone portrait, phone landscape, tablet portrait):
  - **Edge tab:** always visible on the right edge of the table area, inside the reserved 28 px gutter (§12.3) so no seat pod can sit under it: 28×88 px, "Hands" written top to bottom, vertically centred on the table, well above the action bar; padding makes the hit area 44 px wide. An 8 px accent dot appears when the hero's category improves, until the sheet is next opened.
  - **Drawer:** one tap on the tab (or the top-bar Hands button, or the hand label) opens a **modal right-side sheet** `min(86vw, 340px)` wide, from the top safe area down to the **top edge of the action bar** (the action buttons stay visible), with a 40% scrim over the table. In landscape it covers the table column only.
  - **Closing:** scrim tap, ✕ (44 px), dragging right inside the sheet, Esc, or Android Back. Focus is trapped while open and returns to the opener. (`ui/components/RankingsDrawer.tsx` is controlled: `open` + `onOpenChange(false, reason)` with reason `scrim` · `close` · `escape` · `drag`, so the controller can pop the history entry it pushed; Android Back is the controller's `popstate` setting `open` to false. Safari does not focus a tapped button, so each opener focuses itself before opening: `HandsTab` does.)
  - **Game:** while the drawer is open, the controller's `sheet` gate pauses bot actions (a learner must not miss actions behind the scrim). On the hero's own turn nothing is waiting anyway.
  - ⚠️ Never opened by an edge swipe (§12.13). Nothing listens for swipes, and the tab ignores a click that ends more than 10 px from where its pointer went down (without this, a mouse drag across the tab would still count as a click).

### 13.2 Content

Header "Poker hands: best at the top". Ten rows, strongest first. Each row: rank number, name, 5 mini cards (kickers at 45% opacity, so the user sees which cards "count"), one-line tip, and two small right-aligned numbers: **how often** (7-card rarity) and **By river** (the hero's own chance, §6.6).

| # | Name | Example (kickers dimmed) | Tip | How often (7 cards) |
|---|---|---|---|---|
| 1 | Royal flush | A♠ K♠ Q♠ J♠ 10♠ | A-K-Q-J-10, all one suit. The best hand. | 0.003% (1 in 30,900) |
| 2 | Straight flush | 9♥ 8♥ 7♥ 6♥ 5♥ | Five in a row, all one suit. | 0.03% (1 in 3,600) |
| 3 | Four of a kind | Q♣ Q♦ Q♥ Q♠ *7♦* | Four cards of the same rank. | 0.17% (1 in 595) |
| 4 | Full house | K♠ K♥ K♦ 4♣ 4♥ | Three of one rank plus two of another. | 2.6% (1 in 39) |
| 5 | Flush | A♦ J♦ 8♦ 5♦ 2♦ | Any five cards of one suit. | 3.0% (1 in 33) |
| 6 | Straight | 10♣ 9♦ 8♠ 7♥ 6♣ | Five in a row, mixed suits. A can be low: A-2-3-4-5. | 4.6% (1 in 22) |
| 7 | Three of a kind | 7♠ 7♥ 7♣ *K♦ 2♠* | Three cards of the same rank. | 4.8% (1 in 21) |
| 8 | Two pair | J♥ J♣ 5♠ 5♦ *A♣* | Two different pairs. | 23.5% (1 in 4) |
| 9 | One pair | 10♥ 10♠ *K♣ 6♦ 3♥* | Two cards of the same rank. | 43.8% (1 in 2) |
| 10 | High card | A♣ *Q♦ 9♠ 6♥ 3♣* | No pair. Your highest card plays. | 17.4% (1 in 6) |

- **Tie-break footer (always visible):** "A higher row always beats a lower row." · "Same row? The higher cards win: the higher pair, then the kickers." · "Suits never break a tie. No suit beats another." · "Still equal? The pot is split." · "Why does a flush beat a straight? It is rarer." · "The order comes from 5-card hands. With 7 cards, high card is rarer than one pair, but it still ranks lowest." (The "How often" column is 7-card odds; this line stops a learner reading "rarer = higher" into the High card / One pair rows.)
- **Row details** (tap a row → 2–3 lines, Appendix F.7), e.g. Full house: "Three of one rank plus two of another. When two players have one, the higher three-of-a-kind wins. Kings full of Fours beats Queens full of Aces."
- The "By river" column shows the `exactly` probability ("12%", "—" for 0), from the preflop deal until the turn; on the river only the made hand shows 100%. Header info popover: "Your chance to finish with exactly this hand, if you stay to the end." Visibility per coach level: §10.2. (Chunk 4.6: the column shows while the hero plays a hand, in its betting rounds: not after a fold, not in an all-in run-out, not from the showdown on, not at Exam; its cells are empty until the hand analysis comes. The header row, "How often" over the 7-card odds and "By river" as the button that explains it, comes with the column: one column of numbers needs no header, and the Table stays within 600 DOM nodes, §15.3.)
- **"Which hand wins?"** (Advanced and Exam, and always in Learn): shows two random 5-card hands; the player taps the winner; instant feedback with the rule that decided it. Scores kept in memory only. *Chunk 6.4:* a "Which hand wins?" button above the rows (the drawer and the wide column) opens it in place, from a lazy chunk (`ui/components/WhichHandWins.tsx`); `app/whichWins.ts` deals ten cards of a deck shuffled with a random seed (`crypto.getRandomValues`, never `Math.random`), again until the two hands differ (a tie has no winner); the hands are buttons (named by their cards); the answer is "Right!" or "Not this time." and the rule: different rows "Flush beats straight." plus the footer's first line, the same row "Both are one pair." plus its second line; then "Next hands" and the visit's score ("3 of 4 right"). The cards are examples, inside the panel's `data-examples` subtree (the E2E card watch skips it). Learn's copy comes with Stage 9.
- Data is static in `src/data/rankings.ts` (Appendix F.7), so the panel and the Learn page work offline automatically.

### 13.3 Live highlight

- The row of the hero's current best category gets an accent background, a "You" badge, `aria-current="true"`, and a second line with the hero's **actual** best five (used hole cards outlined, kickers dimmed as in the examples; preflop, with no best five yet, the two hole cards); it scrolls into view when the drawer opens. The store maps `describe()` to the panel's `HeroHandView` with `heroHandView()` (`ui/rankings.ts`).
- Rows above get a muted "beats you" caption; rows below get "you beat".
- Preflop: pocket pairs highlight One pair; everything else highlights High card. After the hero folds: grey highlight, caption "You folded" (the other rows lose their captions). Between hands: no highlight.
- On improvement: the row pulses once (400 ms; not under reduced motion) and the phone edge tab shows its dot.

### 13.4 Mini cards

- Never face-card art at these sizes. **Index-only card:** rounded rectangle, 1 px border, bold system-font rank with `font-variant-numeric: tabular-nums`, suit as an **SVG path**: the sprite's suit path (`#s-h`) used as a CSS mask over the suit colour on the card's `::after` (chunk 5.9: a face-up card is one DOM node, the rank its text; `<svg><use>` cost two more nodes per card, five on the larger sizes, and the Table could not fit the coach in its 600 nodes, §15.3). A test keeps the CSS paths equal to the sprite's. ⚠️ Never Unicode suit characters (U+2660–2667 can render as emoji). "10" written in full with `letter-spacing: -1px`.
- Sizes: phone drawer 24×34 (rank 14 px, suit 10 px); wide panel 30×42 (16 / 12 px).
- One component, `<Card size card highlight? dim? used?>` (`ui/components/Card.tsx`), serves the panel, board, hero strip and seats. Sizes: `xs` 16×22 (bot backs), `sm` 24×34, `md` 30×42, `lg` 36×50 (bot faces), `xl` 52×74 (hero, compact), `xxl` 64×90 (hero), `board` (from the §12.3 formula). Small sizes are index-only (rank over suit); from `lg` up the rank and a small suit sit in the top-left corner (readable when cards overlap) with a big suit bottom-right (the big suit is the card's `::before`, the same mask). Face down = `card={null}`: the component is never given the card, so no rank or suit can reach the DOM. A face-up card carries `data-suit` ("c", "d", "h", "s") for tests.
- Screen-reader row label, e.g.: "Rank 4, Full house. Example: King, King, King, Four, Four. Three of one rank plus two of another. You have this hand." It ends with "How often: 2.6%, 1 in 39.", and rows above or below the hero's say "It beats your hand." / "Your hand beats it."

---

## 14. Persistence and stats

### 14.1 Cookies vs localStorage vs IndexedDB (decision: localStorage)

The user said "cookies"; the real need is "stored on my device, no account". Honest comparison:

| | Cookies | **localStorage** | IndexedDB |
|---|---|---|---|
| Size | Browsers must keep only 4,096 bytes per cookie, 50 per domain (RFC 6265) | 5 MiB per origin | Large (Safari 17+: up to 60% of disk) |
| Network | ⚠️ Sent with **every** request to our host (privacy cost, waste) | Never sent | Never sent |
| Lifetime | Chrome caps at 400 days | Until cleared | Until cleared |
| Safari 7-day rule (ITP) | Cookies written by script (`document.cookie`; our server never sets cookies, §2.6) have their expiry capped at 7 days | Deleted after 7 days of Safari use without a visit; **home-screen apps are exempt** | Same as localStorage |
| API | String parsing | Synchronous, atomic per key | Asynchronous, transactions |
| Verdict | Rejected: tiny, leaks over the network, no durability gain | **Chosen** | Not needed in v1 (move full histories there later with `idb-keyval`) |

**localStorage only; no cookies at all.** Our data is small (profile ~10 KB, 100 hand records ~120 KB, session ~15 KB). Synchronous reads mean stats render on the first paint and nothing races on `pagehide`. Durability comes from: atomic single-key commits, a backup copy, `navigator.storage.persist()`, the Add-to-Home-Screen nudge, and Export.

### 14.2 Keys

| Key | Content | Written |
|---|---|---|
| `pc.v1.profile` | `Profile`: settings, stats, hero model, flags, `rev`, `lastCommittedHandSeq` | Hand end (the commit point), settings change (debounced 250 ms) |
| `pc.v1.profile.bak` | Previous `pc.v1.profile` string | Just before each profile write |
| `pc.v1.hands` | Ring buffer of the last 100 `HandRecord`s (with replay inputs) | Hand end, before the profile |
| `pc.v1.session` | `SessionState`: table, current hand, inputs so far, hand meta, latest undo snapshot, hand-start stacks | After every engine step (synchronously) |
| `pc.v1.diag` | Last 5 failing replay records (§4.5) | On invariant violation only |
| `pc.v1.preimport` | Profile saved automatically before an import or reset | Before import/reset |

All keys share the prefix `pc.v1.`. The prefix (like the `pc-writer` lock name) is an internal identifier and stays `pc` after the rename to RB Poker Coach (§0.3). A future schema v2 writes new keys and migrates (Appendix H), never overwriting v1 keys until v2 is verified. Total < 300 KB, far below 5 MiB.

### 14.3 Commit protocol at hand end (atomic and idempotent)

Each hand has a monotonic `handSeq`. The profile's `lastCommittedHandSeq` is the single source of truth for "has this hand been counted".

⚠️ **handSeq rule:** `handSeq` is global across tables, not per table. Before every `startHand` the controller sets `table.nextHandSeq = max(table.nextHandSeq, profile.lastCommittedHandSeq + 1)`. Without this, a new table (or a profile imported with a higher `lastCommittedHandSeq`) would produce hands that step 1 of the load table below treats as "already counted", and they would never reach the stats. Reset never lowers `lastCommittedHandSeq`.

```
on phase == 'complete' (the session already holds the completed HandState):
 1. hands   ← ring.upsert(record by handSeq)                  // safe to repeat
 2. check   stored profile.rev == our rev   (else another writer → stop, read-only banner)
 3. bak     ← current stored profile string
 4. profile ← applyHand(profile, record); lastCommittedHandSeq = handSeq; rev += 1   ◄ COMMIT POINT (one setItem)
 5. session ← nextTable(...) state
```

| Found on load | Action |
|---|---|
| Session hand `complete`, `handSeq > lastCommittedHandSeq` | Commit it now (steps 1–5) |
| Session hand `complete`, `handSeq ≤ lastCommittedHandSeq` | Already counted; run step 5 only |
| Session hand mid-play and valid | Home's Play continues it |
| Session fails the type guard or `checkInvariants` | Void it: restore hand-start stacks; toast "Your last hand could not be restored. Chips were returned." |
| Hand records with `handSeq > lastCommittedHandSeq` and no matching session | Drop them |

`applyHand(stats, record)` is pure; a hand is counted exactly once whatever crashes happen (crash-injection tests, §14.9).

`rev` counts every write of `pc.v1.profile`, a settings change too (§14.2; `persist/profile.ts` `saveProfile` adds 1), so the step 2 check also catches another tab's settings change. Steps 2 and 3 plug into `saveProfile` (Stage 8).

### 14.4 Stats model and screen

- **Integers for sums:** results use `netMilliBB` (integer thousandths of a big blind) so there is no float drift; EV loss in integer milli-bb.
- **Buckets:** results `clean` (no Undo) and `practice` (with Undo), plus `byBotLevel` (clean); decisions `all`, `byCoachLevel`, `byStreet`; `leaks`; `collection`; `streak`; ring of the last 60 `SessionSummary`s; `heroModel` counters for Expert bots. *Levels (chunk 7.2, per-seat overrides):* a hand records the levels in force through its table (`HandRecord.table`, as at hand start): `config.botLevel` and, per seat, `config.seatLevels` (`levelsOf`, §9.3 notes). `HandRecord.botLevel` and `RecentHand.botLevel` are the table level; `byBotLevel` and `recentHands` (§10.4) count a hand under it only when no bot dealt in plays at another level, so a mixed table adds to the totals and to no level bucket (Stage 8 reducers).
- **Session:** starts when Play or Setup's Start game begins a table, or when Play continues a saved hand; ends at Leave table, New table, or 30 minutes without an action (checked on the next launch against `SessionState.savedAt`). Its running totals live in `stats.currentSession` (updated by `applyHand`, so they are committed atomically with the hand); at the end it moves to `recentSessions` and `sessions += 1`. "Leave table" shows "This session: 45 hands · +640 chips · Decision score 82 · 4 mistakes." (with 0 hands it just returns Home).

| Metric | Definition |
|---|---|
| Decision score | Mean over graded decisions (undone included) of Best 100 / Good 90 / Inaccuracy 60 / Mistake 25 / Blunder 0 |
| Mistakes per 100 | (Mistake + Blunder) ÷ decisions × 100, per session and per week |
| Error rate | Mean EV loss per decision in milli-big-blinds (no benchmark shown; published benchmarks are UNVERIFIED) |
| On your own | Share of Best + Good among decisions where the hint was not opened (Beginner decisions never count) |
| Hint-follow rate | Share of hint-seen decisions where the hero did the recommendation |
| Streak | Consecutive graded decisions better than Mistake; `best` = maximum ever |
| Net bb/100, VPIP, PFR, WTSD, W$SD | Clean hands only |
| All-in luck | Σ over all-in run-outs of (actual − expected share) × pot, in chips |
| Leaks | Per tag (§8.9): count and Σ loss; top 3 by Σ loss with count ≥ 3 |
| Collection | Per category (Royal separate): times made at showdown or river, first date |

**Stats screen** (four tabs; empty states teach: "Play 5 hands to see your first stats"):
1. **Progress** (default): decision score (this session, last 7 days with ↑/↓, 20-session line chart); mistakes per 100 (bars, "Lower is better"); on your own; hint-follow rate; streak; top 3 leaks with chips lost and a lesson link; "Fixed with Undo: n"; quiz accuracy; the level suggestion card (§10.4).
2. **Results:** hands, hands won, net chips and bb/100, "Plays {VPIP}% of hands, raises {PFR}%" with a plain comparison ("Good players: about 20% / 16%"), showdown win %, biggest pot won, reloads, All-in luck ("Expected +1,200 · Actual +860 · You were unlucky by 340 chips"), a small table by bot level, "Practice hands (used Undo): n, not counted above".
3. **Hands (collection):** a 10-row mirror of the rankings panel: count made and date first made; never-made rows show a lock and "About 1 in N hands". Learning goal only; it unlocks nothing.
4. **History:** last 100 hands (number, time, result, best hand, grade dots) → Review. Footer: "Your stats are saved only on this device. [Export] [Import] [Where are my stats?]".

Charts are tiny inline-SVG components, each with `<desc>` and a visually hidden data table. Long lists use `content-visibility: auto`. Times stored in UTC ISO, shown with `Intl.DateTimeFormat`; "last 7 days" uses local days.

### 14.5 Session and resume

- `pc.v1.session` is written after **every** engine step (~15 KB, < 1 ms): iOS may kill a backgrounded PWA at any time. Saving is one `JSON.stringify` and one `setItem`, with no checks (the engine already ran `checkInvariants`).
- The session's `table` is the table **as at the start of its hand** (the hand replays from it, §4.7); the controller replaces it with `nextTable(...)` only after the hand is complete (§14.3 step 5). So its stacks are the hand-start stacks, and a voided hand returns the chips by keeping the table and dropping the hand.
- Load (`persist/session.ts`, once per launch): JSON, version, the type guards, `checkInvariants` on `hand` and on `undoSnapshot.state`, the hand against its table (seat count, blinds, `handSeq == table.nextHandSeq`, `startStacks[i] == slots[i].stack`) and the engine major version (H.2 rule 4). A usable table with an unusable hand → the hand is **voided** (§14.3 toast); no usable table → the session is **discarded** and a new table starts. Either result is written back at once, so the next launch is clean.
- On launch with a session: Home's **Play** continues it (the line under Play describes it). Resuming restores the exact state and the undo snapshot; if the hero was to act, the hint is recomputed (same numbers, by determinism); bot timers restart from zero.
- ⚠️ The saved state contains the deck, so a user with developer tools can read the bots' cards. That is their own offline game; acceptable. Never send this state anywhere.

### 14.6 Load path and write failures

1. `JSON.parse` in try/catch → read `schema` → `migrations[n]` step by step → hand-written type guard (no schema library) of the current version → write back when migrated. (The guard runs after the migrations: a current-version guard cannot check an older object.)
2. If `pc.v1.profile` is corrupt: try `.bak` (at most one hand lost; toast; Stage 8). If both fail: copy the raw text to `pc.corrupt.<timestamp>` (an ISO time; `.1`, `.2` … if taken), start fresh, write the fresh profile so the next launch is normal, toast (§12.11). A `schema` newer than the app knows counts as corrupt here (it is still copied). If even the copy cannot be written, overwrite nothing. Never delete unreadable data automatically. The session is not copied: §14.5 voids or discards it.
3. Every storage call goes through `persist/storage.ts`, which never throws: it returns `{ ok: false, reason }` on `QuotaExceededError`, `SecurityError` or a missing `localStorage`. On failure keep everything in memory (a key whose last write failed reads back the value we tried to write, for the rest of the launch), show the banner once per launch (`SafeStorage.onFailure` fires once, at the first failure), retry on the next commit (every write tries the browser storage again).
4. Flush debounced writes on `visibilitychange → hidden` and `pagehide`.

### 14.7 One writer at a time (several tabs)

On start, `navigator.locks.request('pc-writer', { ifAvailable: true }, …)` and hold it for the page lifetime. If not granted: read-only mode with the §12.11 banner ("Play here" re-requests with `steal: true`). The tab whose lock is stolen sees its lock promise reject with `AbortError`: it flushes nothing further, switches to read-only, and shows the same banner. Read-only mode = the game screens are replaced by the banner; Stats and Learn stay readable. If Web Locks is unavailable (feature-detect; always missing on a plain-http LAN address, §12.14), fall back to the `rev` check of §14.3 plus the `storage` event: when another tab writes the profile, this tab reloads stats and becomes read-only. Boot reads the profile and the session synchronously (§12.14), before the lock answers, and loading may write (a migration or a repair is written back, §14.5, §14.6): `loadProfile` and `loadSession` take `readOnly: true` for that, so a tab writes back only once it holds the lock (Stage 8).

### 14.8 Keeping data alive, export, import, reset

- Call `navigator.storage.persist()` (secure context only; skipped when missing, §12.14) on the first standalone launch, or after the third finished session in a browser tab (Chrome decides silently, Firefox asks, WebKit uses heuristics such as home-screen install). Settings shows "Protected from automatic clean-up: Yes/No".
- ⚠️ Safari tabs: ITP deletes all script-written storage **and the service-worker cache** after 7 days of Safari use without a visit; home-screen apps are exempt but have separate storage. Hence the install tip and Export.
- **Export** `rb-poker-coach-stats-YYYY-MM-DD.json` = `{ app: 'poker-coach', schemaVersion, exportedAt, profile, hands }`: try `navigator.share({ files })` when `navigator.canShare({ files })` (iOS share sheet → Save to Files); fallback Blob URL + temporary `<a download>` (reported broken in iOS standalone, UNVERIFIED); last resort "Copy to clipboard".
- **Import:** `<input type="file" accept="application/json,.json">` → parse, type-guard, migrate → preview ("1,234 hands, exported 12 Sep 2026") → **Replace** only (no merge in v1) with confirmation; the current profile is saved to `pc.v1.preimport` first.
- **Reset stats:** confirmation with a red "Delete my stats" button; saves `preimport` first; clears stats, hands and hero model, keeps settings.
- The "Where are my stats?" text: Appendix G.4.

### 14.9 Persistence tests (MUST)

- **Crash injection:** a fake storage that throws or "dies" after the k-th `setItem`, for every k in the commit protocol and during session writes. After restart the hand is counted **exactly once** (or not at all if the crash was before the commit point and the session was also lost); never double-counted; the profile is never unreadable.
- Corrupt JSON, wrong types and truncated strings in each key → the documented recovery path.
- Quota exceeded and missing `localStorage` → in-memory mode, banner shown, no exception reaches the UI.
- Two tabs (Playwright, two pages) → the second is read-only; no lost update.
- Migration fixtures of every past schema version load (from v2 on; a hand-written v0 fixture tests the mechanism now).
- Export → Reset → Import restores a deep-equal profile and hands. 10,000 simulated hands keep total storage < 300 KB and the Stats screen renders in < 300 ms at 6× CPU throttle.

---

## 15. Offline PWA and performance

### 15.1 Service worker and manifest

- vite-plugin-pwa: `strategies: 'generateSW'`, `registerType: 'prompt'`, `injectRegister: false`; register through the `useRegisterSW()` hook from `virtual:pwa-register/react` (bundled, so no inline script; add `"types": ["vite-plugin-pwa/react"]` to `tsconfig.json`). Call the hook unconditionally at the top of `App` (React's rules of hooks forbid calling it inside an `if`); the plugin's own register code already does nothing when `'serviceWorker' in navigator` is false (insecure origins, §12.14; checked in vite-plugin-pwa 1.3.0), and the app's toasts and Install tile read `app/secure.ts`, not the hook. Workbox: `globPatterns: ['**/*.{js,css,html,svg,png,webp,json,webmanifest}']`, `navigateFallback: 'index.html'`, `cleanupOutdatedCaches: true`, **no runtime caching, no third-party URLs**.
- **Updates:** on `needRefresh` show the toast; at the next hand end save the session with `resumeAfterUpdate: true`, call `updateServiceWorker(true)` (reloads), and on load go straight back to the Table. Never reload mid-hand. On `offlineReady`, the one-time "Ready to play offline." toast.
- **Manifest:** `name` "RB Poker Coach", `short_name` "RB Poker", description "Learn Texas Hold'em against friendly bots, with a coach. Free, offline, no sign-up.", `display: 'standalone'`, `orientation: 'any'`, `start_url`/`scope` `./` (relative, with Vite `base: './'`, so the build does not depend on the path it is served from; asset and worker URLs are already relative), `background_color`/`theme_color` `#0f1512`, icons 192, 512, 512-maskable; `<link rel="apple-touch-icon" href="icons/apple-180.png">`, `<meta name="theme-color">`.
- System fonts only; sounds are synthesised; all tables are bundled imports.
- **Redeploys:** a new container no longer has the old hashed chunks. The SW precaches every chunk, so installed and SW-controlled pages are safe; for pages without a SW (insecure origin, first visit), `window.addEventListener('vite:preloadError', …)` saves the session and reloads once (the next load gets the new `index.html`, which is `no-cache`).

### 15.2 ⚠️ No network during play

- The app makes **no** fetches at runtime, not even to our own server: it MUST NOT call `/api` (§2.6). The CSP (§17.2) has `connect-src 'self'` and no third-party origins, both as a response header from the Nest server and as a `<meta http-equiv>` in `index.html`. The meta copy is defence in depth: a page served from the service-worker cache (offline, or while the server is down) still carries it. Do not apply the CSP on the Vite dev server (HMR needs inline scripts and websockets): the source `index.html` has **no** CSP meta; a ~10-line Vite plugin with `apply: 'build'` and `transformIndexHtml` injects it into the built file only. CI asserts the built `index.html` contains it (`scripts/check-html.ts`, `npm run check:html -w @rb/web`, after the build).
- CI checks that built `index.html` has no inline `<script>` without `src` (the same script; it also rejects inline event handlers and a meta CSP placed after a script, which would not cover it).
- Playwright: load once, wait until the service worker controls the page, go offline, reload, play a full 6-player hand to showdown, open the rankings drawer, Stats and Learn. "Go offline" kills the test's own server (`tests/e2e/own-server.ts`) and, in Chromium, also calls `context.setOffline(true)`; WebKit cannot use `setOffline` here (pitfall 46). A request listener on the browser context (`tests/e2e/fixtures.ts`: every page and the service worker) fails any test in the suite if a request leaves the origin **or goes to `/api`**, or a WebSocket opens.

### 15.3 Budgets (CI-enforced where possible)

| Metric | Budget | Check |
|---|---|---|
| Initial JS (gzip) | ≤ 150 KB fails CI; target ≤ 130 KB. React + ReactDOM + Zustand + `useRegisterSW` measure ~70 KB (Vite 8.3); the target leaves ~60 KB for first-screen app code, and the CI gate adds ~20 KB headroom | `scripts/size-budget.ts` |
| Each worker chunk incl. its data tables (gzip) | ≤ 60 KB | size-budget |
| CSS (gzip) | ≤ 20 KB | size-budget |
| Total precache (gzip) | ≤ 500 KB | size-budget |
| Lighthouse mobile | Performance ≥ 90, Accessibility ≥ 95, installable | Lighthouse CI (nightly) |
| Tap → next paint (INP) | ≤ 100 ms on action-bar taps at 6× throttle | Playwright + `PerformanceObserver` |
| Main-thread long tasks during play | none > 50 ms | `longtask` observer in E2E |
| Engine `step` + invariants | ≤ 0.2 ms | unit benchmark |
| Label + highlight | same frame as the card | component test |
| Win %: preflop / first postflop number / final | ≤ 50 ms / ≤ 150 ms / ≤ 600 ms at 6× throttle | worker timing logs |
| Hint visible | p50 ≤ 100 ms, p95 ≤ 300 ms (device); p95 ≤ 600 ms at 6× throttle | E2E timing |
| Bot decision compute | p95 ≤ 100 ms Medium, ≤ 150 ms Expert (6× throttle) | self-play timing |
| DOM nodes on the Table screen | ≤ 600 | E2E assertion |
| JS heap after 500 hands | ≤ 50 MB (Chromium) | Playwright |

`scripts/size-budget.ts` (`npm run size`, after the build) prints the four size rows as a table and exits 1 when one is over its budget (above the 130 KB target it only warns). It measures gzip with node:zlib at level 6 and 1 KB = 1,000 bytes (Vite's own report uses Rolldown's gzip and prints about 1% more). **Initial JS** = the scripts `index.html` loads (`<script src>`, `<link rel="modulepreload">`) plus every chunk they import statically; `import()` chunks are lazy, not initial. **CSS** = every `.css` file. **Worker chunk** = each `*.worker-<hash>.js` (Vite names it after `equity.worker.ts` / `brain.worker.ts`) plus its static imports. **Total precache** = the files in the service worker's precache list (`sw.js`), each counted once.

Techniques (MUST): one Zustand store with slices; every component subscribes with a narrow selector (`useShallow` when it selects several fields), never to the whole store; equity progress updates only the `equity` slice; seat components wrapped in `React.memo` with stable props; no React context for fast-changing values; animate only transform/opacity with `will-change` only while animating; no `backdrop-filter`, blur, canvas or animated shadows; one SVG sprite (card suits use its paths as CSS masks, one node per card, §13.4); fixed-size cards and pods, and rows around the table that keep their size whatever they show (no layout shift; the wide coach panel's row is fixed, §12.5); workers warmed at start and cancelled when hidden; never Monte Carlo on the main thread; no `setInterval` polling; lazy-load Stats, Learn, Review and Bench with dynamic `import()` (still precached), and the coach's strip, sheet and words (chunk 5.9: asked for when the Table mounts).

Throttled checks (chunk 4.7, `tests/e2e/perf.spec.ts`, the `chromium-perf-390x844` project, which runs after the others and its tests one at a time, `fullyParallel: false`): two 20-hand runs on a 9-player table (8 opponents, the heaviest win chance) at Instant speed in real time; at each hero turn the test waits for the final win chance, then taps. ⚠️ CDP's `Emulation.setCPUThrottlingRate` slows the page's main thread only: sent to a worker's own CDP session it answers "Operation is only supported for pages, not workers" (checked with Playwright 1.63's Chromium), so a Web Worker runs at full speed. The worker timing logs close that gap: every reply carries `timing` (A.6 `JobTiming`, ms since the request and how much of it the worker computed), the client's log keeps it with a card-free summary of the request ("board 3 · 8 opponents"), and the first run checks each win-chance budget against the time a CPU 6× slower would take, `ms + 5 × busyMs` (only the computing stretches; the pauses do not), with the real times printed next to it. That run keeps the main thread at full speed: with the throttle on, CI's 2-vCPU runner measured the worker 3–16× slower than the dev Mac (the throttled main thread, Playwright and the server share the runner), which the model would count a second time. The second run sets the plain CDP rate 6 on the main thread and checks the long-task observer on the really throttled main thread; the test's own polling is light (every 100 ms) because it runs there too. **CDP's rate is relative to the machine that runs it.** "6×" is 6× the dev Mac (Apple M1 Pro, where these budgets were checked), a phone-class CPU; on a slower machine it is a slower "phone", and CI's 2-vCPU runner is about 2.5× slower than the Mac (its `#bench` evaluator: 5.7–7.0M/s against 14.7M/s). Scaling the rate to the machine (by an integer loop, then by the `#bench` evaluator) was tried in chunk 4.7 and dropped: on the runner the worker's `busyMs` also holds the CPU it loses to the game itself (main thread, Playwright, server), and a scaled model multiplied that. **So both runs are report-only in CI and enforced on a developer machine** (§17.5, R17): in CI the numbers go to the job summary and a missed budget is a warning; `npm run e2e:perf` fails on a missed budget; and the budgets are finally checked on a real phone through `#bench` (§15.4, Stage 4 acceptance 6).

### 15.4 `#bench` route and device targets

A hidden screen that runs in the workers and reports: evaluator evaluations/s (5M random 7-card hands); time to final HUD equity for 8 opponents preflop-postflop and 1 opponent on the flop; hint latency p50/p95 on 20 fixed spots; user agent.

| Measure | Target on a Galaxy A5x-class phone | Action if missed |
|---|---|---|
| Evaluator | ≥ 2M evals/s | Profile `score7`, remove allocations |
| HUD equity, 8 opponents, final | ≤ 400 ms | Lower final n to 15,000 for ≥ 6 opponents (document it here) |
| Hint p50 / p95 | ≤ 100 / 300 ms | §8.11 fallback constants |

Phone speeds are UNVERIFIED estimates (desktop prototype 15.8M evals/s; mid-range phone ~3–4× slower). Stage 9 measures a real Galaxy A5x-class phone and an older supported iPhone, in a tab and installed, and records the numbers here.

Implementation (chunk 4.7):
- **Open it:** add `#bench` to the app's address, e.g. `http://<LAN-IP>:3000/#bench` (or the Coolify URL + `#bench`) in the phone's browser. Typing `#bench` into a running game reloads into it; [Back to the game] reloads without it. main.tsx shows it instead of the game and starts no game (no controller, no `window.__pc`); `app/bench.ts` and `ui/screens/Bench.tsx` are `import()`ed (lazy chunks, precached, so it also works offline).
- **What it measures** (`workers/bench.ts`, in a fresh `equity.worker` of its own, one `bench` job, A.6): `score7` over 5,000,000 random seven-card hands, cycled from a seeded pool of 250,000 dealt before the clock starts (1.75 MB), after an untimed warm-up pass; the time to the final HUD win chance through a job runner of its own (the game's 8 ms slices and `setTimeout(0)` pauses, so what a player waits), for A♥K♥ against 8 opponents before the flop, against 8 on Q♥ 7♥ 2♣, and against 1 on that flop: one warm-up run, then the median of three; the worker's user agent. Hint latency says "Coming in Stage 5" until `brain.worker` exists.
- **What it shows:** each number with its target above ("OK" / "Too slow" in words, not colour only; the 1-opponent row has no target), and the whole report as plain text in a read-only box to paste into a PR. [Copy the results] appears only where `navigator.clipboard` exists: on plain http over the LAN it does not (§12.14), and the text is selected by hand.
- Measured on the dev Mac (Apple M1 Pro, headless, 1 Oct 2026), Chromium / WebKit: evaluator 14.7M / 17.5M evaluations/s; 8 opponents before the flop under 0.1 ms in both (the §7.5 table lookup; 47 ms by Monte Carlo before chunk 4.4 wired it); 8 opponents on the flop 32 / 19 ms; 1 opponent on the flop 17 / 7 ms. The same build at 6× in the §15.3 e2e (worker modelled): preflop final ≤ 0.7 ms, first postflop number ≤ 49 ms, postflop final ≤ 270 ms, against 50 / 150 / 600 ms.

---

## 16. Privacy, legal and fairness

### 16.1 Privacy (no consent banner)

- ePrivacy Art. 5(3) covers localStorage as well as cookies (EDPB Guidelines 2/2023), but exempts storage **strictly necessary** for a service the user explicitly asked for (WP29 Opinion 04/2012; the UK ICO applies the same test). Saving the user's own stats, settings and resumable hand fits this exemption.
- ⚠️ This stays true only while: no analytics (including server or proxy analytics), no ads, no third-party requests, no identifiers, no cookies, nothing sent from the device. The CSP enforces the network part; server tests and the post-deploy `curl -I` enforce "no `Set-Cookie`" (§17).
- Ship a short **Privacy** screen anyway (Appendix G.2). Whether GDPR applies when the operator never receives data is a legal reading we could not confirm (UNVERIFIED). It says that the files come from the owner's own server (Coolify): like any web server it sees the visitor's IP address to send the files, and it does not store it (the Nest server has no request logging, §2.6; the Coolify proxy's access log stays off, §17.6).

### 16.2 Play-money rules (MUST)

- Never sell chips or anything else; never award prizes; no chip transfers; no leaderboards with rewards. Reload is free and unlimited. The collection and level suggestions unlock nothing.
- Reason: in the UK, social gaming with no prize of money or money's worth is unregulated; in Washington State, *Kater v. Churchill Downs* (9th Cir. 2018) held that **purchasable** virtual chips are a "thing of value". We sell nothing.
- Disclaimer on Welcome, Home and Setup (short; one-tap Play skips Setup, so Welcome and Home carry it too) and About (full) (Appendix G.1); responsible-gambling note in About (G.3). ⚠️ Do not hard-code 1-800-GAMBLER (NCPG stopped using it after 29 September 2025; use 1-800-MY-RESET) or BeGambleAware (GambleAware closed by 31 March 2026; use GamCare's National Gambling Helpline 0808 8020 133); re-check help lines at every release. No real poker-room brand names or logos.

### 16.3 Fairness: a provable shuffle (SHOULD, Stage 9)

Before each hand, store `commit = SHA-256(seed + ':' + tableId + ':' + handSeq)` (`crypto.subtle.digest`; secure context only, so on a plain-http LAN test `commit` is `null` and Review shows "Needs a secure connection (https)" instead of the check, §12.14) in the hand record; Review shows it as "Shuffle code". After the hand, Review reveals the seed; "Check the shuffle" recomputes the hash, re-shuffles from the seed and shows ✓ "The cards came from this shuffle. Nobody changed them." with the full deck order. Undo reshuffles are derived from the same seed and logged, so they verify too. About states: "The bots and the coach never see hidden cards. We test this automatically. The win chance never uses the bots' real cards."

### 16.4 Licences

All art is drawn in code. Icons: a handful of Lucide SVGs (`lucide-static`, ISC) copied inline. If face-card art is ever wanted: saulspatz/SVGCards (public domain), letele/playing-cards (CC0), notpeter/Vector-Playing-Cards (public domain / WTFPL); avoid LGPL decks. Keep `THIRD_PARTY_LICENSES.md` current (dev-only oracles included).

---

## 17. Local run, Docker and Coolify deployment

Build and run everything **locally first**. Coolify comes in only after the human has picked the domain and connected the repository (Q6); until then no stage waits for it, except the Stage 9 release. There are three local ways to run the app, from fastest feedback to closest to production:

| Command | What runs | URL | Headers (§17.2) | Used for |
|---|---|---|---|---|
| `npm run dev` + `npm run dev:server` | Vite dev server (HMR) + Nest in watch mode | `http://localhost:5173` (LAN: `http://<LAN-IP>:5173`) | No CSP (§15.2) | Writing code |
| `npm run build && npm start` | The production build served by Nest | `http://localhost:3000` | All | The "local deploy" every stage ends with; E2E |
| `npm run docker:up` (`docker compose up --build`) | The same image Coolify will run | `http://localhost:3000` | All | Checking the image before a Coolify deploy |

### 17.1 Local development (`npm run dev`)

- `npm run dev` starts Vite on port 5173 with `--host`, so a phone on the same Wi-Fi can open `http://<LAN-IP>:5173`. `vite.config.ts` proxies `/api` to `http://localhost:3000` (`server.proxy`), so dev behaves like production for the one route the server owns. The game itself never calls `/api` (§2.6).
- `npm run dev:server` runs `nest start --watch` in `apps/server` on port 3000.
- The service worker is not registered in dev (vite-plugin-pwa dev options off), and no CSP is applied (§15.2). Both are tested only on the Nest-served build.

### 17.2 Security and cache headers (served by NestJS)

The Nest server (§2.6) sends these on every response. `apps/server/src/security.ts` is the single source; server tests and the post-deploy check compare against it. It exports the helmet options (`helmetOptions(nodeEnv)`, so tests can switch HSTS on), the expected header values (`SECURITY_HEADERS`, `CONTENT_SECURITY_POLICY`, `CACHE_CONTROL`, …) and the cache rule for static files; `configureApp()` (`setup.ts`) registers the middleware before `init()`, so it runs first for routes, files, the SPA fallback and 404s. In the code below, `strictTransportSecurity` is a boolean because `exactOptionalPropertyTypes` rejects an explicit `undefined`; `true` gives helmet's default, as `undefined` did.

```ts
app.use(helmet({
  contentSecurityPolicy: { useDefaults: false, directives: {        // useDefaults:false also drops upgrade-insecure-requests
    defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:'], fontSrc: ["'self'"], connectSrc: ["'self'"],
    workerSrc: ["'self'"], manifestSrc: ["'self'"], objectSrc: ["'none'"],
    baseUri: ["'none'"], formAction: ["'none'"], frameAncestors: ["'none'"] } },
  xFrameOptions: { action: 'deny' },
  strictTransportSecurity: process.env.NODE_ENV === 'production',  // true = helmet's default HSTS; only in production
}));
app.use((_req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  next();
});
```

Resulting CSP (helmet joins directives with `;` and no space): `default-src 'self';script-src 'self';style-src 'self' 'unsafe-inline';img-src 'self' data:;font-src 'self';connect-src 'self';worker-src 'self';manifest-src 'self';object-src 'none';base-uri 'none';form-action 'none';frame-ancestors 'none'`.

| Header | Value |
|---|---|
| `Content-Security-Policy` | as above; no `upgrade-insecure-requests` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=()`; `screen-wake-lock` and `web-share` stay at their default (`self`) |
| `Referrer-Policy` · `X-Content-Type-Options` · `X-Frame-Options` | `no-referrer` · `nosniff` · `DENY` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains`, only when `NODE_ENV=production`. `docker compose up` also sets `NODE_ENV=production`, but browsers ignore HSTS received over plain http, so `http://localhost:3000` is unaffected |
| helmet's other defaults | `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy: same-origin`, `Origin-Agent-Cluster`, `X-DNS-Prefetch-Control: off` etc. are kept; they do not affect a same-origin SW or module workers. `X-Powered-By` is removed |
| `Cache-Control` | `index.html` (also as the SPA fallback), `sw.js`, `manifest.webmanifest`, `workbox-*.js`, icons: `no-cache` · `/assets/*` (hashed): `public, max-age=31536000, immutable` · `/api/*`: `no-store` |
| `Set-Cookie` | never |

`'unsafe-inline'` for styles is needed only for the `style="--x:…"` seat positions; scripts stay `'self'`. The meta CSP injected into the built `index.html` (§15.2) is the same minus `frame-ancestors` (unsupported in meta).

### 17.3 Local production run and Docker

- `npm run build` builds `@rb/web` (to `apps/web/dist`) and then `@rb/server` (to `apps/server/dist`); `npm start` runs `node apps/server/dist/main.js`, which serves the game at `http://localhost:3000` with every §17.2 header. This is how each stage is "deployed" locally.
- `npm run docker:up` runs `docker compose up --build`: one service built from the root `Dockerfile`, `ports: ["3000:3000"]`, `environment: NODE_ENV=production` and `SOURCE_COMMIT: ${SOURCE_COMMIT:-}` (unset locally, so `/api/health` says `dev`; the CI `docker` job passes the tested commit, as Coolify does at run time, §17.6). `docker compose ps` MUST show the container `healthy`.
- `Dockerfile` (the root file adds only comments to this; the full build was verified in chunk 0.5, see below):

```dockerfile
# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:24-alpine

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY . .
RUN npm run build -w @rb/web && npm run build -w @rb/server

FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
RUN npm ci --omit=dev --workspace @rb/server --no-audit --no-fund

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node apps/server/package.json apps/server/
COPY --from=build --chown=node:node /app/apps/server/dist apps/server/dist
COPY --from=build --chown=node:node /app/apps/web/dist apps/web/dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node","-e","fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
WORKDIR /app/apps/server
CMD ["node","dist/main.js"]
```

- Why this shape: the runtime image holds only the server's production dependencies (no React, Vite or dev tools), runs as the non-root `node` user, and needs no `curl` for its health check. The check uses `127.0.0.1`, not `localhost` (which can resolve to `::1` on Alpine). `node` is PID 1 and handles SIGTERM through `enableShutdownHooks()`; never start the container with `npm start`.
- `.dockerignore` keeps installed packages and old builds out of the context (`**/node_modules`, `**/dist`, coverage and test reports, logs), plus everything the build does not read (`.git`, `.github`, `.claude` (agent worktrees, each with its own `node_modules`), `.loop`, `docs`, root `*.md`, the Docker files) and `.env*`.
- **Verified on 28 Sep 2026 (chunk 0.5)** with Docker 29.4.0 and `node:24-alpine` (Node 24.21.0, npm 11.19.0, Alpine 3.24): the outline above built and ran **as written; no fix was needed**. `docker compose up --build -d` → `docker compose ps` showed `healthy` after about 12 s; `curl -I http://localhost:3000/` had every §17.2 header, HSTS (the image sets `NODE_ENV=production`), `Cache-Control: no-cache` and no `Set-Cookie`; `/table/42` → `index.html` (pitfall 44 cannot happen under `/app`), a hashed `/assets/*` file → `immutable`, `/api/nope` → JSON 404 `no-store`, `/api/health` → 200. Re-checked on the PWA shell build (chunk 0.4): `/sw.js`, `/manifest.webmanifest`, `workbox-*.js` and the icons → `no-cache`. Details checked on the way:
  - `npm ci` works under npm 11's install-script policy: on Linux the only dependency with an install script is `@swc/core`, denied in the root `allowScripts` (its binary comes as the optional `@swc/core-linux-*-musl` package); `fsevents` is skipped on Linux. No install-script warnings. The lockfile holds the arm64 and x64 musl bindings (rolldown, lightningcss, rollup, swc).
  - `npm ci --omit=dev --workspace @rb/server` installs only the server's production tree: 101 packages, 22.6 MB, no React, Vite or SWC; the image is 176 MB. The process runs as `node` (uid 1000).
  - `docker compose down` stops the container in about 0.5 s (node handles SIGTERM as PID 1). Startup lines only in the logs; no request logging.
  - A `linux/amd64` build (the CI and Coolify platform, emulated on the arm64 host) also built and became `healthy`, with the same headers.

### 17.4 Phone testing and the secure context

⚠️ Service worker, install, Web Locks, `storage.persist()`, `crypto.subtle`, `crypto.randomUUID`, Wake Lock and Web Share work only on `https://` or `http://localhost` (§12.14). A phone at `http://<LAN-IP>:3000` is **not** a secure context.

| Where | URL | What you can check |
|---|---|---|
| Desktop browser | `http://localhost:3000` | Everything, including offline and install |
| Phone on the same Wi-Fi | `http://<LAN-IP>:3000` (or `:5173` in dev) | Gameplay, layout, touch, speed. Not offline, install or the shuffle check (they degrade, §12.14) |
| Phone, HTTPS | the Coolify URL (§17.6) | Everything: install, offline, update flow, shuffle check |

**Decision:** during the local stages the commissioner tests gameplay and layout over the LAN (http). Install and offline checks on a phone happen on the Coolify HTTPS URL, because installs and service-worker caches belong to one stable origin. Before Coolify is connected, a developer MAY run a quick tunnel (`cloudflared tunnel --url http://localhost:3000`: no account, trusted certificate, a new random `*.trycloudflare.com` URL every run) against the Nest-served build for a one-off look at the HTTPS-only features; it is never the acceptance environment. Self-signed certificates (Vite basic-ssl) and mkcert are not used: phones either block the service worker on them or need a root certificate installed.

### 17.5 CI pipeline (GitHub Actions)

| Job | When | Steps |
|---|---|---|
| `check` | every push to `main` / PR | `npm ci`, typecheck (both workspaces), lint (boundaries, `Math.random` ban, server-must-not-import-web), `format:check`, the web unit + property tests once, under V8 coverage, failing below the "Testing strategy" coverage thresholds (`npm run test:coverage`: every unit test except the volume and timing tests, which V8 makes several times slower), then those volume and timing tests alone, without coverage (`npm run test:volume`), and the server tests (`npm test -w @rb/server`): together exactly the tests of `npm test`, each run once; the job times out after 25 minutes, `check-tables` (`npm run gen:check`, chunk 4.4), `check-copy`, build, size budget, no-inline-script check (`check-copy` since chunk 5.6: `npm run check:copy -w @rb/web`, a few seconds) |
| `e2e` | every PR | `npm run build:e2e` (the production build plus the Stage 3 test hooks `?seed=` and `window.__pc`: `vite build --mode e2e`, then the server), `npx playwright install --with-deps chromium webkit`, then `npm run e2e` (two workers: the runner has 2 vCPUs): Playwright's `webServer` runs the root `npm start` (`cwd` set to the repository root, because `apps/web` has no `start` script; `url` `http://localhost:3000/api/health`) (the Nest-served production build, so headers, cache rules and the SPA fallback are tested too); Chromium + WebKit at 375×667, 360×740, 390×844, 844×390, 768×1024, 1280×800; offline test; no-external-request and no-`/api`-request assertions; axe (from the first screen with content). The two Stage 4 speed checks (win chance and main-thread long tasks at 6× CPU, `tests/e2e/perf.spec.ts`, §15.3) and the Stage 6 grading-time check (§8.11, chunk 6.5) run last, in the `chromium-perf-390x844` project, and are **report-only**: `PERF_REPORT_ONLY=1` prints their numbers to the job summary and a missed budget never fails the run (see below). The HTML report is uploaded when it fails |
| `docker` | every PR to `main` | `docker compose up --build --detach --wait` (returns once the container is `healthy`), with `SOURCE_COMMIT` set to the tested commit; `node scripts/check-deploy.mjs http://localhost:3000 --commit <sha>` asserts the §17.2 headers, cache rules, `/api/health` and no `Set-Cookie` (§17.6 step 7); `docker compose down` |
| `slow` | weekly (owner decision 23 Sep 2026, saves Actions minutes on the private repo; "nightly" elsewhere in this document means this weekly run), and on demand | exhaustive evaluator, 1M-shuffle chi-square, 10M-step engine property run, 1M differential, regenerating the tables (`npm run gen`: preflop, ranges, push/fold, a separate `tables` job: the committed files must be byte-identical, §7.5), self-play (a `selfplay` job per run, each on its own runner: the Medium and Easy calibration of §9.7 at seed 1 with the Medium decision p95 gate, and the 100,000-hand legality run over 2–9 seats with a fresh seed, chunk 5.11), Lighthouse; a `perf` job with the same speed checks (`--grep "Stage [46]"`), report-only (numbers in its job summary); when the repository variable `DEPLOY_URL` is set, a second job runs `node scripts/check-deploy.mjs $DEPLOY_URL --commit <sha of main>` |

**Speed checks are report-only in CI** (decision of 1 Oct 2026, chunk 4.7; risk R17). CDP's CPU throttle slows only a page's main thread, never a worker (§15.3), so the win-chance budgets at 6× are a model, and on the shared 2-vCPU runner that model is noise: the postflop final came out at 539 to 748 ms there against 270 ms on the dev Mac (budget 600 ms), and the long-task check depends on how busy the runner is. A check that fails on noise teaches everyone to press "re-run", so the speed checks (the two of Stage 4, and since chunk 6.5 the grading time of Stage 6 acceptance 6) never fail a CI run: the `e2e` job and the weekly `perf` job print their numbers to the job summary (`PERF_REPORT_ONLY=1`, set in both workflows; unset on a developer machine, and `CI` alone turns it on) and show a missed budget as a warning annotation. They are enforced where the numbers mean something: on a developer machine by `npm run e2e:perf` (a root script that builds first; `npm run e2e:perf -w @rb/web` skips the build), which fails when a budget is missed and is run before merging a change that can slow the game (the hand loop, the HUD, the workers, the tables), and on a real phone through `#bench` (§15.4), because the Testing strategy table already says latency budgets are checked per stage on a real phone. The Stage 3 long-task test (25 hands, 6 players, no throttle) is unchanged: a hard check in every PR. The grading-time check (chunk 6.5) times the `grade` job in the real brain.worker from the act to its reply, in real time and unthrottled; it passes by a wide margin on the dev Mac (§8.11), but its budget is the same kind of latency budget on the same shared runner, so it follows the same rule.

Every workflow cancels its superseded runs (a newer push to the same PR or branch), to save Actions minutes. Node comes from `.nvmrc` (`actions/setup-node` with the npm cache). Jobs run on `ubuntu-24.04`, not `ubuntu-latest`: that label becomes Ubuntu 26 from 19 Oct 2026, and `playwright install --with-deps` supports only the Ubuntu versions its release knows; move the pin together with a Playwright upgrade that supports the newer image. There is **no deploy job**: Coolify deploys on push to `main` (§17.6). Every PR that finishes a stage states how it was checked locally (`npm start`, `docker compose up`) and, once Coolify is connected, links the deployed URL, with the stage's acceptance checklist.

### 17.6 Coolify deployment (once the human connects it)

The human does steps 1–4 once (only they can); the agent writes this as a checklist in `README.md`.

1. **Source:** in Coolify, **+ New** → the Git repository (the GitHub App is recommended; it turns **Auto Deploy** on, so every push to `main` deploys).
2. **Build:** Build Pack **Dockerfile**, Base Directory `/`, Dockerfile Location `/Dockerfile`. **Ports Exposes** `3000` (the server listens on `0.0.0.0`).
3. **Domain:** Configuration → General → Domains: the full URL with `https://` (for example `https://poker.<your-domain>`). DNS: an A record pointing at the Coolify server; ports 80 and 443 open. The proxy (Traefik, the default) gets a Let's Encrypt certificate automatically (HTTP challenge). Turn **Force HTTPS** on (its default is UNVERIFIED).
4. **Environment:** `NODE_ENV=production` (runtime). The commit id comes from Coolify's predefined `SOURCE_COMMIT`, read **at runtime** by `/api/health`; leave "Include Source Commit in Build" off so the build cache keeps working. No other variables; no secrets exist.
5. **Health check:** Coolify uses the Dockerfile's `HEALTHCHECK` (`/api/health`) and ignores the dashboard one, which would need `curl` in the image. Rolling deploys wait for the new container to be healthy before the old one is removed.
6. **Keep off** anything that adds cookies, scripts, logs or a login: basic auth, any sticky-session option (Traefik sticky sessions set a cookie), and proxy access logging (Traefik's `accesslog` is off by default and Coolify's default Traefik configuration does not turn it on; never add it to the proxy configuration). Coolify's label generator adds no cookies by default; its gzip `compress` middleware MAY stay on.
7. **After each deploy:** `node scripts/check-deploy.mjs https://<domain>` (after `npm ci`: it reads the expected values from `apps/server/src/security.ts`) asserts: the §17.2 CSP and other headers, HSTS included, on every response it fetches; `Cache-Control: no-cache` on `/`, `/sw.js`, `/manifest.webmanifest` and the SPA fallback (`/table/42`); `immutable` on the `/assets/*` script that `index.html` loads; `/api/health` is 200 with `no-store` and reports a commit (not `dev`), which `--commit <sha>` also compares with the pushed one; **no `Set-Cookie`** and no `X-Powered-By` on any of them. Redirects are not followed (an `http://` URL with Force HTTPS fails and shows where it redirects). One output line per URL; exit code 1 when anything fails.

A second Coolify app on `https://staging.<your-domain>` MAY be added later for testing risky changes; it is not required for v1.

---

## 18. Staged build plan

Build in order. Every stage ends running locally via `npm start` and `docker compose up` (§17.3) and, once the human has connected Coolify, deployed there by a push to `main` (§17.6); from Stage 3 it is playable on a phone (over the LAN until HTTPS is available, §17.4). Later stages MUST NOT weaken earlier tests; if a test must change, write the reason in the risk register.

### 18.0 Definition of done (every stage, in addition to its own criteria)

1. Typecheck, lint (boundaries), unit, property and E2E tests green in CI; size budgets pass.
2. Offline E2E passes (from Stage 0 on the shell; from Stage 3 on a full hand); no request leaves the origin in any E2E run.
3. The non-cheating tests pass for every bot/coach that exists (DOM test from Stage 3, `decide()` property test from Stage 5).
4. Runs locally via `npm start` and `docker compose up` (container healthy, §17.3); once Coolify is connected, deployed there by the push to `main` and `check-deploy` passes (§17.6); this document updated for any decision that changed.
5. From Stage 3: the commissioner plays at least 10 hands of the new build on their own phone and reports no blocker: over the LAN (`http://<LAN-IP>:3000`) until HTTPS is available; install and offline on the phone are checked once the Coolify HTTPS URL exists (§17.4).

### Stage 0 - Scaffold, pipeline, PWA shell

- Monorepo layout (§0.1); first commits 1–4 (§0.2); the NestJS server with serve-static, the §17.2 headers and `/api/health` (§2.6); `Dockerfile`, `docker-compose.yml`, `.dockerignore`; ESLint boundary rules, `Math.random` ban and the server-must-not-import-web rule; Vitest projects `unit` and `slow`; fast-check; Playwright projects; `size-budget.ts`; CI jobs (§17.5; `slow` may be empty); an "RB Poker Coach" felt page with manifest, icons, service worker and meta CSP, served by Nest.

**Acceptance criteria**
1. `npm run build`, `npm test`, `npm run e2e` pass on a clean clone; `npm run build && npm start` serves the shell at `http://localhost:3000`.
2. `curl -I http://localhost:3000/` shows the §17.2 CSP and `Cache-Control: no-cache`, an `/assets/*` file is `immutable`, and no response has `Set-Cookie`; `/api/health` returns 200 JSON; `/api/nope` is a JSON 404 (not `index.html`); `/table/42` returns `index.html`; a missing `/assets/x.js` is 404. Built `index.html` has no inline scripts.
3. `docker compose up --build` starts the image and `docker compose ps` reports it `healthy`.
4. The offline E2E test passes against the Nest-served build on `localhost`.
5. A fixture that imports `engine/step` from `brain/` makes lint fail; a fixture using `Math.random` in `src/` makes lint fail; a fixture importing `apps/web/src` from `apps/server` makes lint fail (tested through ESLint's API).
6. The size script prints a table and fails on a fake oversized file.

### Stage 1 - Cards, randomness, evaluator, `describe()`

- `core/cards.ts`, `core/rng.ts` (§5.6); `eval/tables.ts`, `eval/evaluate.ts`, `eval/describe.ts` with names and sub-labels (§5.2–5.4, §6.1); naive 21-subset oracle in `tests/`; devDependencies `@poker-apprentice/hand-evaluator`, `pokersolver`.

**Acceptance criteria**
1. Appendix C.4 golden RNG values match exactly; chi-square shuffle and `randInt` tests pass (fixed seeds).
2. 1,000,000-pair differential test agrees 100% with `@poker-apprentice/hand-evaluator`; the 200,000-hand naive-oracle test agrees 100%.
3. Appendix B vectors 19–24 and all Appendix D.1 vectors pass (names, sub-labels, `best5`, `core`, `kickers`, `holeUsed`, `playsTheBoard`).
4. Slow job: the exhaustive 133,784,560-hand count equals Appendix C.1 exactly.
5. Node micro-benchmark ≥ 5M evaluations/s on the CI runner (warning only).

### Stage 2 - Rules engine

- `engine/*` per §3–§4: `createTable`, `startHand`, `legalActions`, `step`, `settle`, `checkInvariants`, `observe`, `replay`, `nextTable` (button, bot replacement, 3→2 rule), `reshuffle`.
- `tests/engine/settle.oracle.ts`: an **independent** settlement written from the text of §3.8 without reading `settle.ts` (chip-layer method: walk the chip levels of every seat, folded seats included; a layer with a single contributor is that seat's uncalled refund; merge consecutive layers with identical eligible sets, as §3.8 merges pots, even where the contributor set changes at a folded seat's level).

**Acceptance criteria**
1. All 44 Appendix B vectors pass.
2. Property test: random legal play (2–9 seats, stacks 1–500 bb including tiny stacks, random legal actions and amounts) keeps I1–I14 after every step: 100,000 hands in `unit`, 10 million steps in `slow`. Every hand reaches `complete` in ≤ 400 inputs.
3. Settlement agrees with the oracle on 100,000 random multi-way all-in scenarios.
4. Replay of 10,000 random hands reproduces the final state; JSON round trip is deep-equal; `step` never mutates a deep-frozen input.
5. `observe()` non-leak test: permuting other seats' unrevealed hole cards and the stub leaves the observation deep-equal.
6. Branch coverage of `src/engine/` ≥ 95%.

### Stage 3 - Playable table (vertical slice)

- Screens: Welcome and Home with the one-tap **Play** (§12.1), Setup (players, chips, blinds; level cards shown but fixed to Easy/Beginner), Table in portrait, landscape and wide layouts, Menu, out-of-chips dialog.
- Components: seats for 1–8 opponents, board, pot, bets, dealer button, action bar and sizing tray, hero strip with label, sub-label and highlight (`describe()` on the main thread).
- **Hand-rankings panel** (§13): persistent panel on wide screens, edge tab + drawer elsewhere, live highlight, "beats you / you beat", tie-break footer, row details, tab dot, focus trap (the By-river column arrives in Stage 4).
- `app/controller.ts`: scheduling, `advance` gating, gates (hidden, menu, sheet), epoch, history/back handling; animations and speed setting.
- Temporary `SimpleBot` (main thread, behind the same async interface later served by `brain.worker`), receiving `Observation` only. Postflop: facing a bet → call with a pair or better, else fold if the bet ≥ ½ pot, else call; not facing a bet → bet ½ pot with two pair or better, else check. Preflop: raise to 3 bb with a pair or two cards ≥ 10 (if 3 bb is below the legal minimum raise-to or raising is not legal, call instead); otherwise check if free, call if the price is ≤ 3 bb, else fold. Every amount is snapped to a multiple of the SB and clamped to `legalActions` bounds. "The bet" is the amount to call and "the pot" is §0.3's `pot`, which already holds that bet; pairs and two pair count the board's cards. In Stage 3 it lived in `brain/simpleBot.ts` (so the §2.1 boundary keeps it on the `Observation`) and `app/brain.ts` served it through the A.6 request/reply port; its think time is §9.8 with `closeness` 0 (it has no EV model). Chunk 5.8 moved it to `scripts/bots/simple.ts` and serves its rules from `brain.worker` (§2.2).
- Test hooks for E2E (dev/E2E builds only, §Testing strategy): `?seed=<hex>` fixes the table and hand seeds; `window.__pc` exposes state, dispatch and worker logs. Stage 6 adds `script=<name>` for scripted bots and `window.__pc.faults` for a slow, failing or killed brain.worker (§11.3 notes). The build constant `__PC_TEST_HOOKS__` (vite.config.ts) is true for the dev server, Vitest and `vite build --mode e2e` (`npm run build:e2e -w @rb/web`), false for `vite build`, so main.tsx's dynamic import of `app/testHooks.ts` leaves production builds; `tests/app/testHooks.bundle.test.ts` builds both and searches the output. `?seed=` takes 1–32 hex digits (left-padded to 32): the page's first table uses that seed, table n uses `deriveSeed(seed, 'table', n)`, and the hand with `handSeq` k uses `deriveSeed(seed, 'hand', k)`.
- A minimal `pc.v1.profile` holding only `settings` (plus schema defaults for the other `Profile` fields) so last-used Setup values, levels and speed survive a reload; Stage 8 adds stats and the commit protocol on top of the same key.
- Settings screen with the Game section only (speed, auto next hand, amounts); later stages add their rows and sections (Stage 4 "show win chance", Stage 5 levels, Stage 8 Data, Stage 9 the rest). Home tiles, Menu items and links to screens that do not exist yet are **hidden**, not disabled. Level cards not yet available are shown disabled with the caption "Coming soon".
- `persist/storage.ts` and `pc.v1.session` save after every step; Home's Play continues after a reload. Bot replacement, reload, top-up.

**Acceptance criteria**
1. Playwright plays 50 full hands at 375×667, 360×740, 390×844, 844×390 and 1280×800 with no console errors and no horizontal scroll; 2 and 9 players both work; heads-up the button posts the SB and acts first preflop (from the action log).
2. For every player count 2–9 at those viewports: pods do not overlap each other, the board, the hero strip or the Hands edge tab, and stay inside the viewport; with the sizing tray open at 375×667 nothing needed for the decision (hole cards, board, tray, Row A) is covered and the page does not scroll.
3. Rankings: persistent at 1280×800 and 1024×768; at 390×844 and 844×390 a drawer opened by the edge tab, the top-bar button and the hand label; closes by scrim, ✕, right-drag, Esc and Android Back; never opens from an edge swipe; never covers the action bar (bounding boxes); no bot acts while it is open; no suit code points U+2660–U+2667 in the DOM.
4. Component test over 200 random seeded states: the highlighted row equals `describe(...).category`; the "You" line shows the actual best five.
5. With checking free, Fold is disabled and shows the tooltip.
6. Primary buttons ≥ 56 px tall; every other interactive element ≥ 44×44 px (measured).
7. Bot hole cards are never rendered face up (or named in `aria-label`) before a run-out or showdown (DOM assertion every step).
8. Closing the tab mid-hand and reopening → Home's Play restores a deep-equal state; Android Back with the sizing tray open closes the tray, not the table.
9. **One tap to play:** with a fresh profile, open the app and tap Play → a dealt hand with the hero's cards visible within 2 s (Playwright), with no other screen, dialog or tip in between. With a saved session, Home's Play continues it; without one, it starts a new table with the last-used settings.
10. **Manual:** the commissioner plays 10 hands one-handed on their phone over the LAN (§17.4) and confirms the §1.5 assumptions.

### Stage 4 - Draws, outs, win chance, chances by the river

- `analysis/handinfo.ts` (§6.2–6.5), `analysis/chances.ts` (§6.6), `analysis/equity.ts` (§7), `analysis/preflop.ts`.
- `scripts/gen-preflop.ts` → `preflop-equity`, `finals`; `check-tables` in CI.
- `workers/protocol.ts`, `workers/equity.worker.ts`, `app/workerClient.ts` (jobId, epoch, cancel, stale-drop, timeouts).
- Win badge (skeleton, `~`, hysteresis, popover, big-move lines), price chip, draw chips with out cards, "By river" column in the rankings panel, all-in TV mode and luck line, `#bench`.

**Acceptance criteria**
1. Appendix C.2–C.3 exact values reproduced to 0.01 points; Monte Carlo within tolerances; Appendix D.2 outs/risky and D.3 chances pass.
2. Identical requests give bit-identical results; a cancelled job never posts again; a stale reply is never displayed (fake worker delay).
3. At 6× throttle: preflop ≤ 50 ms, first postflop number ≤ 150 ms, final ≤ 600 ms; no main-thread long task > 50 ms in a 20-hand run. Checked by `npm run e2e:perf` on a developer machine; CI runs the same checks report-only (a shared runner is too noisy for a speed budget: §17.5, R17), and criterion 6 is the real check.
4. An opponent fold triggers a recompute with the new `nOpp`; folded cards stay in the pool (spy); no request to `equity.worker` contains unrevealed bot cards.
5. Hidden tab → all jobs cancelled (worker message log). Each worker chunk ≤ 60 KB gzip.
6. `#bench` numbers from one real Android phone are pasted into the PR.

### Stage 5 - Coach hints and real bots (Easy, Medium) — **public MVP**

- `scripts/gen-ranges.ts`, `scripts/gen-pushfold.ts`.
- `brain/*`: features, ranges, preflop, push/fold, postflop, sizing, guardrails, EV model, explain, profiles (5 personalities × Easy/Medium), opponent stats, `decide`, `hint`; `workers/brain.worker.ts` replaces `SimpleBot` (moved to `scripts/bots/`; chunk 5.8 builds the worker first, with SimpleBot's rules as the temporary `brain/standIn.ts` behind `decide`'s signature, §2.2).
- ⚠️ The **full §8.6 range model** (priors, Loki re-weighting, `loosenessEstimate` from seat stats) is built here, because the coach (`COACH.rangeModel = 'reweight+stats'`) and the E9/E13/E16 `RANGE_ADJUST` checks need it. Stage 7 only switches it on for Hard/Expert **bot** profiles and adds exploits.
- `#bench` gains the hint-latency row; the coach strip keeps an empty Undo slot until Stage 6.
- Coach strip and sheet for **Beginner** and **Intermediate** (§10.2, §12.6), recommended-button ring, "Use coach size", RANGE_ADJUST display, glossary popovers; preflop percentile line on the label.
- Level selectors enabled for Easy/Medium bots and Beginner/Intermediate coach; personality labels and bot card; think time; `scripts/selfplay.ts` with baselines.

**Acceptance criteria**
1. Range acceptance (§8.3) and push/fold acceptance (§8.4) pass.
2. Every Appendix E golden spot passes.
3. Properties C2, C3, C4, C6, C7 pass (≥ 2,000 runs each); each guardrail has a test that fails if the guardrail is removed.
4. Non-cheating property test (§9.6) passes for the coach and all Easy/Medium profiles.
5. Self-play at Medium, 6-handed, 20,000 hands: each personality within ±4 VPIP/PFR (Easy ±8), AF within ±0.7; zero illegal actions in 100,000 hands across all table sizes.
6. Hint p95 ≤ 600 ms at 6× throttle; bot decision p95 ≤ 100 ms at Medium.
7. `check-copy` passes over 1,000 generated situations; every E-spot text contains the HUD's `eRandom` as a whole number, and shows RANGE_ADJUST when the equities differ by ≥ 5 points.
8. **Manual:** the commissioner reads 10 hints on the phone and understands each without help. → Announce the public MVP.

### Stage 6 - Grading, mistake feedback, Undo, Advanced and Exam levels

- `brain/grade.ts`, leak tags, controller `grading` and `feedback` states, feedback card, grade chips, toolbar Undo, `reshuffle` input, practice flag, hand summary, Review (from memory), Advanced quiz, Exam behaviour, level matrix complete (§10.2).
- Dev/E2E-only `script=<name>` hook for scripted bots (added to the Stage 3 `?seed=` hook); stripped from production (build flag, tested).

**Acceptance criteria**
1. All §11.5 tests pass; property C8 (following the hint is always Best) passes.
2. Playwright, fixed seed, scripted blunder (folding the nuts facing a small bet) at Beginner: the feedback card appears **before** any bot action or card event is logged; Undo restores the decision; a second Undo is disabled.
3. Undo is disabled after a run-out reveal and at showdown; hidden at Advanced; absent at Exam.
4. A grade later than 1,500 ms does not block the game (fake worker delay); toolbar Undo is disabled until it arrives; a grade job that errors twice records `grade: null` and enables Undo; killing `brain.worker` mid-hand still finishes the hand (§12.14).
5. Level matrix E2E: for each of the 4 coach levels the visible elements match §10.2 (snapshot per level); the quiz fires on about 1 in 4 eligible decisions (seeded) and hides the badge and price chip.
6. Grading adds ≤ 50 ms after the action (cached EVs), ≤ 150 ms when an exact-size EV is needed.

### Stage 7 - Hard and Expert bots, per-seat levels

- Enable the Stage 5 range model for bots: re-weighting with generic priors (Hard) and per-seat stats + exploits (Expert); balanced river bluffing; hidden labels and the observed-stats bot card; per-seat level override (§9.3); hero model persisted in memory until Stage 8.

**Acceptance criteria**
1. Self-play, 20,000 hands each, 95% CI: the coach beats an Easy table; Hard beats "raise every hand" and "call everything"; the "bet pot every street" bot loses to a Hard table; Expert beats Medium.
2. At Hard, TAG/LAG/Rock within ±4 VPIP/PFR of target.
3. Expert exploits fire only after n ≥ 30 observations (unit test).
4. Non-cheating test passes for all 20 personality × level profiles and the coach.
5. Bot decision p95 ≤ 150 ms at Expert; hint p95 still ≤ 600 ms (6× throttle).
6. A per-seat override changes that seat's parameters and label visibility from the next hand only.

### Stage 8 - Persistence and stats

- `persist/*`: schema guards, migrations scaffold, profile commit protocol, backup, stats reducers, hero model, tab lock, export/import/reset, `persist()`; Stats screen (4 tabs, charts); Settings Data section; install hints; level suggestions.

**Acceptance criteria**
1. §14.9 tests pass, including crash injection at every write.
2. A fixture of 20 scripted hands produces exactly the expected numbers on every stats card (hand-computed fixture committed with the test).
3. Playwright: play 5 hands, reload → Stats shows exactly 5 hands; close mid-decision, reopen → Home's Play returns to the same decision with the same hint.
4. Undo hands appear only in the practice bucket; undone decisions still count in decision score.
4b. handSeq rule: play 3 hands, start a New table, play 3 more → Stats shows 6 hands; import a profile whose `lastCommittedHandSeq` is higher than the table's `nextHandSeq`, play 1 hand → it is counted.
5. Private-mode simulation (storage throws): playable, banner shown once.
6. **Manual iOS:** Export opens the share sheet and "Save to Files" produces a valid file that Import accepts.

### Stage 9 - Polish, accessibility, fairness, release

- Settings complete; sounds, haptics, wake lock; first-table tips; Learn (lessons, glossary, full-page rankings, "Which hand wins?"); keyboard shortcuts; provable shuffle in Review; collection and all-in luck; SW update-between-hands flow; accessibility audit; low-end performance pass; device QA; re-check help-line numbers.

**Acceptance criteria**
1. axe: zero serious or critical violations on every screen and sheet; Lighthouse mobile Performance ≥ 90, Accessibility ≥ 95, installable.
2. VoiceOver (iOS) and TalkBack (Android) script — start a table, play a hand, open the hint, undo, open the hands drawer — succeeds without sighted help. A full hand is playable by keyboard only.
3. Under reduced motion no transform animation runs (computed-style check).
4. The shuffle check verifies 1,000 recorded hands (unit) and the UI shows ✓.
5. Update scenario on `http://localhost:3000` (a secure context, so the service worker runs): serve v1 with `npm start`, play, rebuild and restart as v2 mid-hand: toast appears; reload happens only at hand end; play resumes. Repeated once on the Coolify HTTPS URL with a real push.
6. Device matrix (manual script, §Testing strategy, on the Coolify HTTPS URL): iPhone SE-size and a recent iPhone (Safari + home screen), Galaxy A5x-class and A1x-class Android (Chrome + installed), iPad portrait/landscape, desktop Chrome/Firefox/Safari. `#bench` meets §15.4 on the A5x-class phone (or the documented fallbacks are applied and re-measured); animations ≥ 55 fps there and ≥ 45 fps on A1x.
7. **Coolify is connected** (Q6) and production on Coolify carries the §17.2 headers (`check-deploy` passes, no `Set-Cookie`); on that HTTPS URL the app loads on one iPhone and one Android phone, installs, and reloads and plays in flight mode; every UNVERIFIED item in the risk register has a final status. The release requires the Coolify deployment. → Release **v1.0**.

---

## Known pitfalls

1. ⚠️ **"Raise by" vs "raise to".** Every amount in engine, UI, brain and logs is "to". The UI never computes `currentBet + x` itself; it uses `legalActions` bounds.
2. ⚠️ **Forgetting the uncalled-bet refund** before building side pots: pots with unwinnable money, broken conservation (B11–B15, B34).
3. ⚠️ **Heads-up order.** The button is the SB, acts first preflop and last after the flop; the BB gets the first hole card.
4. **BB option skipped** because blind posts were counted as actions.
5. ⚠️ **Short all-in reopening.** An incomplete raise does not reopen for players who acted, but several can add up to a full raise (B6–B9).
6. **Folded money** belongs in the pots at its levels; folded players are never eligible.
7. **Odd chips** go clockwise from the first seat left of the button, per pot, not to seat 0.
8. ⚠️ **Straight flush tested on the wrong mask** (all ranks instead of the flush suit).
9. **Wheel:** A-2-3-4-5 is five-high; Q-K-A-2-3 is not a straight. **Three pairs / two trips** in seven cards (B22–B23).
10. **`playsTheBoard` from `holeUsed`.** Compare scores; when the board plays, highlight the board (§5.4).
11. ⚠️ **Board-pair "outs"** counted as improvements to two pair (§6.3 rule 3).
12. **Rule of 4 shown as the real number.** Show exact values (15 outs: 60% vs 54.1%).
13. ⚠️ **Leaking hidden cards** into the HUD equity, the brain, the DOM, the accessibility tree, console logs or exported debug data before the hand ends. Only `observe()` reads hidden cards; never post `HandState` to a worker "for convenience".
14. **Folded cards treated as dead** in equity. They are unknown and stay in the pool.
15. **Multiway equity as heads-up^N.** Sample all opponents jointly without replacement. **Ties** among k players are worth 1/k.
16. **Time-capped Monte Carlo** makes the number device-dependent. Stop at a fixed n.
17. ⚠️ **Coach flicker** from unseeded Monte Carlo. Seed from `observationKey`.
18. **Pot odds without the bet:** `need = toCall / (pot + toCall)` with the villain's bet already in `pot`. ⚠️ And when the hero is short, cap the pot at what the hero can win (`winPot`, §0.3); otherwise a 50-chip all-in call facing a 500 bet looks like 8% instead of 25%.
19. **Float chips** from "½ pot". Round to a multiple of the SB before the engine; sum big blinds as integer milli-bb.
20. **`Math.random` and modulo bias.** Seeded streams and `randInt` with rejection only.
21. **Typed arrays or `undefined` in state** break JSON round trips, resume and replay.
22. ⚠️ **Stale timers and worker replies** after undo, new hand, resume or a hidden tab cause double bot actions. Every callback and reply checks the epoch and job id.
23. **Dealing in the same step as the closing action** makes "pause before cards" impossible. Cards appear only on `advance`.
24. ⚠️ **Undo leaking the future.** Always reshuffle the stub; one undo per decision point; no undo after any reveal.
25. **Counting a hand twice after a crash.** `lastCommittedHandSeq` and the ordered commit protocol.
26. **Two tabs overwriting each other.** Web Locks single writer, `rev` check as backup.
27. **localStorage throwing** in private modes and on quota. Every call goes through the wrapper.
28. ⚠️ **Safari's 7-day wipe** removes storage and the offline cache in a Safari tab; home-screen storage is separate. Push Add to Home Screen and Export.
29. **Edge swipe** to open the rankings drawer conflicts with browser back/forward. Tap only. **Android Back** must close overlays, not exit.
30. **iOS layout:** `100vh` (use `dvh`/`svh`), inputs < 16 px zoom on focus, `overscroll-behavior` needed on both `html` and `body`, safe areas.
31. **Unicode suits render as emoji.** Use the SVG sprite's suit paths (`<use>`, or the cards' CSS masks of the same paths, §13.4).
32. ⚠️ **Inline scripts vs CSP.** A plugin that injects an inline registration script gives a blank page. Use `injectRegister: false`; CI checks `index.html`.
33. **Service-worker update mid-hand.** Apply only between hands; `index.html` and `sw.js` are `no-cache` (set by the Nest server, including on the SPA fallback).
34. **Coach contradicting its grade.** Grade relative to the recommendation; following it is always Best (C8). Nor its strength meter: never Strong or Monster next to Fold, never Weak next to a value bet (§8.10).
35. **Showing a bare range-equity number.** Always label which equity a number is (§8.10).
36. **Colour-only meaning** fails colour-blind users. Pair colour with shape or text everywhere.
37. **Re-render storms** from worker progress. Equity progress writes only the store's `equity` slice; components use narrow Zustand selectors (`useShallow` for several fields), never `useStore()` without a selector; seats are `React.memo`. A component test wraps the table in React's `<Profiler>` and streams 50 equity progress messages: zero `Seat` renders.
38. **Worker URL built dynamically.** Vite detects only the literal `new URL('./x.ts', import.meta.url)` form.
39. **Long or idiomatic coach sentences.** `check-copy` enforces ≤ 15 words.
40. **Stale help-line numbers.** 1-800-GAMBLER is no longer NCPG's number and BeGambleAware has closed; re-check at every release.
41. ⚠️ **helmet defaults.** Its default CSP adds `upgrade-insecure-requests` (Safari then upgrades `http://localhost` to https, and every subresource on `http://<LAN-IP>` fails) and it sends HSTS on every response. Use `useDefaults: false` with the exact §17.2 directives and HSTS only in production. Helmet sets no `Permissions-Policy`; set it by hand.
42. ⚠️ **serve-static and caching.** Without per-path `setHeaders`, `index.html` and `sw.js` get cached and users are stuck on an old version; without excluding `/assets/{*splat}` from the SPA fallback, a missing chunk comes back as `index.html` with status 200; with `'/api*'` or `'/api/*splat'` the exclude throws or misses bare `/api` (§2.6).
43. ⚠️ **Plain http on the LAN is not a secure context.** On `http://192.168.x.x` the service worker, Web Locks, `crypto.subtle`, `crypto.randomUUID`, `persist()`, Wake Lock and Web Share are missing. Feature-detect each (§12.14); never call `crypto.randomUUID`; never let a missing API crash the boot.
44. ⚠️ **SPA fallback in a dot-folder checkout.** `@nestjs/serve-static` 12.0.0 sends the fallback `index.html` with `res.sendFile(<absolute path>)` and no options, and `send` answers 404 when any folder in that absolute path starts with a dot. So `/table/42` is a 404 when the repository sits under `.claude/worktrees/` (agent worktrees) or any other dot-folder; normal files and `/` still work. Docker (`/app`), CI and the main checkout are not affected. The server tests copy their fixture to a temporary folder first; for a manual check from a worktree, point `WEB_DIST_DIR` at a copy of `apps/web/dist` outside it (checked 28 Sep 2026).
45. **serve-static in tests.** `Test.createTestingModule().compile()` creates providers before any HTTP adapter exists, so `@nestjs/serve-static` silently picks its no-op loader and serves no files. HTTP tests that need the game files boot with `NestFactory.create()`, like `main.ts`.
46. ⚠️ **Offline tests in WebKit.** In Playwright's WebKit (1.63), `context.setOffline(true)` also fails every response the service worker gives (a controlled page's `fetch` and the reload both fail: "WebKit encountered an internal error"), and a `context.route()` that aborts requests sees the navigation before the service worker does ("Blocked by Web Inspector"). Chromium has neither problem. So the offline test takes the network away for real: it starts its own server on a free port, kills it once the service worker controls the page, and reloads (Chromium also calls `setOffline`). With service workers blocked, that reload fails in both browsers ("connection refused"), so the test cannot pass by accident (checked 28 Sep 2026).
47. ⚠️ **A changed import can split the entry chunk.** The bundler (Rolldown) cuts the modules that the entry and the lazy chunks share into chunks of their own, and which ones it cuts depends on the import graph, not on the code. In chunk 7.2 `botCardViews.ts` read two small functions from `app/levels.ts` (a module with nothing under it) instead of from `tableViews.ts`, and the whole store graph (about 30 modules) moved out of the entry chunk into a shared one, and 5 initial files became 14: initial JS +3.3 KB and CSS +1.1 KB gzip for no change in the code. A lazy chunk that imports `jsx-runtime` but nothing from `react` does the same to the runtime helpers (+0.15 KB; `MoreOptions` calls `useId` for this reason too). After a change to imports run `npm run build && npm run size` and look at the number of initial files (5 in 7.2: `index`, `react`, `jsx-runtime`, `cards`, `en`); `tests/ui/review.bundle.test.ts` fails when the JS budget breaks.

---

## Testing strategy

### Layers

| Layer | Tool | What | When |
|---|---|---|---|
| Unit | Vitest | Pure functions, rule vectors, golden values, grading thresholds, metrics, migrations | every push |
| Property | Vitest + fast-check | Engine invariants, termination, replay, JSON round trip, no mutation; coach C2–C8; guardrails; non-cheating; determinism | every push (bounded), nightly (large) |
| Differential | Vitest | Evaluator vs two libraries and the naive oracle; settlement vs the independent oracle | every push (100k), nightly (1M) |
| Statistical | Vitest, fixed seeds | Shuffle uniformity, `randInt`, undo reshuffle, Monte Carlo accuracy | every push (small), nightly (large) |
| Data | Node | Generated tables match checksums; finals equal the Appendix C.1 counts; 20 cells re-sampled within 0.5 points (§7.5); weekly, the tables are regenerated and must not change | every push (`check`), weekly (regeneration) |
| Simulation | `scripts/selfplay.ts` | Bot calibration, legality, decision time, coach win rate, anti-exploit | weekly (the `slow` workflow's `selfplay` jobs); a 500-hand smoke on every push (`tests/scripts/selfplay.test.ts`); the full calibration (`npm run selfplay -- --calibrate`) is required before merging bot changes |
| Component | Vitest + @testing-library/react | Hero strip, badge states, action-bar states, ladder highlight, templates; seat re-render count (pitfall 37) | every push |
| Server | Vitest + supertest against the Nest app with a small `dist` fixture (Nest's dependency injection needs decorator metadata: `unplugin-swc` emits it in tests, as the Nest docs recommend. Checked at scaffold: Vite 8's own Oxc transform also emits it, and Nest 12's ESM starter relies on that, so `unplugin-swc` MAY be dropped later. The first test boots `AppModule` and asserts `design:paramtypes`; with metadata off it fails loudly: HTTP 500). The fixture is `apps/server/test/fixtures/web-dist`, copied to a temporary folder by a Vitest global setup that sets `WEB_DIST_DIR` (pitfall 44); the HTTP tests boot with `NestFactory.create()` (pitfall 45) | Every §17.2 header on `/`, on the SPA fallback and on `/sw.js`; cache rules per path; `/api/health` 200 with `version` and `commit`; no `Set-Cookie` anywhere; `/table/42` → `index.html`; `/api` and `/api/nope` → JSON 404, not `index.html`; missing `/assets/x.js` → 404; no HSTS unless `NODE_ENV=production`; no `upgrade-insecure-requests` | every push |
| End-to-end | Playwright (Chromium, WebKit) against the Nest-served E2E build (`npm run build:e2e && npm start`: the production build plus the test hooks) | Play (one tap) → play → hint → undo → drawer → stats → export/import; Setup; level matrix; layouts at 6 viewports; offline; no external requests and no `/api` requests during play; response headers; two tabs; resume; reduced motion; keyboard-only | every PR |
| Container | `docker compose` in CI | Image builds, becomes `healthy`, serves the §17.2 headers | every PR to `main` |
| Accessibility | @axe-core/playwright + manual script | No serious/critical violations; VoiceOver/TalkBack script | every PR (axe), each release (manual) |
| Performance | Playwright CPU throttle, Lighthouse CI, `#bench` | Long tasks, INP, latency budgets, bundle sizes | every PR (size; the throttled long-task and latency checks of Stage 4 only report their numbers, §17.5), nightly (Lighthouse), before merging a change that can slow the game (`npm run e2e:perf`), and per stage on a real phone (`#bench`: the latency budgets are checked there) |
| Device | Manual script | Stage 9 matrix | Stage 9 and each release |

### Oracles (independent sources of truth)

| Subject | Oracle |
|---|---|
| Evaluator categories | Exact published 7-card counts (Appendix C.1) |
| Evaluator ordering | `@poker-apprentice/hand-evaluator`, `pokersolver`, naive 21-subset evaluator |
| Equity | Exact enumeration (Appendix C.2–C.3); CardFight aggregates for AA vs KK and 22 vs AKo |
| Settlement | Independent chip-layer implementation (Stage 2) |
| Rules | Appendix B vectors from TDA 2024 and Robert's Rules |
| Coach | Appendix E golden spots; published push/fold and opening-chart ranges |
| Outs and chances | Exact enumeration and the closed formulas (Appendix C.5, D.2–D.3) |
| RNG | Appendix C.4 golden values |

### Rules

- Every statistical test uses a **fixed seed** (deterministic in CI; significance threshold p > 0.001). Nightly runs repeat them with a random seed printed in the log; a failure is reproduced from that seed. Mechanism: `TEST_SEED=random` draws a seed and prints it, `TEST_SEED=<32 hex>` reproduces a run (`tests/helpers/seed.ts`).
- Every bug fix adds a failing test first.
- Coverage: `src/engine/` ≥ 95% branches; `src/eval/`, `src/analysis/`, `src/persist/` ≥ 90%; `src/brain/` ≥ 85%. SHOULD: mutation testing (e.g. StrykerJS) on `engine/settle.ts` and `engine/legal.ts` before release.
- Test hooks (`?seed=`, `?script=`, `window.__pc` exposing state, dispatch and worker logs, and `window.__pc.faults` for brain.worker, chunk 6.5) exist only in development and E2E builds; a test asserts they are absent from the production bundle.

### Manual device script (Stage 9 and every release)

Run on the Coolify HTTPS URL (install and offline need a secure context, §17.4).

1. Fresh visit in Safari: tap Play, play 10 hands, check Stats, Add to Home Screen, open the installed app, see the "Played in Safari before?" dialog.
2. Airplane mode: open the installed app, play 10 hands, open the drawer, Stats, Learn, Settings.
3. Background the app mid-hand for 10 minutes; reopen (tap Play if Home shows): the same decision with the same hint.
4. Silent switch on/off; music playing in another app (ambient audio).
5. One-handed play: every button reachable with the right thumb; no accidental zoom; no pull-to-refresh.
6. Rotate to landscape and back mid-hand.
7. VoiceOver / TalkBack: cards, actions and the win chance are announced.
8. Android: install from the menu item; haptics on your turn.

---

## Open questions and risk register

### Questions for the human (each has a default, so work is never blocked)

The human answered on 23 Sep 2026. Answered rows show the decision; open rows keep their default.

| # | Question | Status · decision or default |
|---|---|---|
| Q1 | Do the §1.5 assumptions match what you meant (especially "undo" and "levels for both")? | Open · as written; confirm after Stage 3. The human re-confirmed "no account: open the game, click Play, play" (§12.1) |
| Q2 | The big "Win chance" number is against **any cards** the others might hold; the coach adds "against their likely hands" when that differs. OK, or should the big number be the likely-hands guess? | **Decided by us** (the human left it to us) · the big number stays "against any cards": it is exact and checkable against oracles. The coach shows the "against their likely hands" number next to it, labelled, when they differ (§8.10) |
| Q3 | App name | **Answered** · "RB Poker Coach"; home-screen short name "RB Poker"; repository: the existing `romanbitca/rb-pocker` (the §0.1 tree root `rb-poker-coach/` means this repository) (§0.3) |
| Q4 | Four coach levels including "Exam" (win % hidden while you decide), or only three? | **Answered** · four, including Exam |
| Q5 | Language: English only for v1? | Open · English only, ready for translation |
| Q6 | Coolify: pick the domain and connect the Git repository to Coolify (only you can do this, §17.6) | **Answered** (use the owner's Coolify server) · everything runs locally until then; required before the Stage 9 release |

### Risks

| # | Risk | Likelihood | Impact | Mitigation | Stage |
|---|---|---|---|---|---|
| R1 | Settlement or side-pot bug pays the wrong player | Medium | Severe (trust) | Vectors, invariants in production, independent oracle, property tests, void-hand safety net | 2 |
| R2 | Coach gives obviously wrong advice | Medium | Severe | Guardrails, golden spots, monotonicity property, both equities labelled, "grade the decision" framing | 5–6 |
| R3 | Grades feel unfair ("Big mistake" on a close spot) | Medium | High | Close-spot rule, pot-relative thresholds with bb floors, price-signal margins, Good-if-better | 6 |
| R4 | Stats lost (Safari ITP, private mode, crash) | Medium | High | Atomic commit, backup key, crash injection, `persist()`, install nudge, Export | 8 |
| R5 | Phones too slow for equity or hints | Low–Medium | Medium | Fixed-n schedule, two workers, fallback constants, `#bench` | 4, 5, 9 |
| R6 | Bots feel exploitable or robotic | Medium | Medium | MDF defence, guardrails, anti-exploit self-play, mixing, think time | 5, 7 |
| R7 | Undo becomes "undo until I win" | Low | Medium | Always reshuffle, one undo per decision, practice bucket | 6 |
| R8 | Hidden-card leak | Low | Severe | Physical boundary, DOM test, non-cheating property | 2–7 |
| R9 | iOS layout issues (toolbars, safe areas) | Medium | Medium | Compact mode, `dvh`/`svh`, device script | 3, 9 |
| R10 | Gambling-law misunderstanding | Low | High | Nothing sold, no prizes, disclaimer, no brands | 9 |
| R11 | Server or proxy misconfiguration breaks headers or caching (stale `index.html`, missing CSP, a cookie from the proxy, `/assets` fallback returning HTML) | Medium | High | One `security.ts` source; server tests; E2E against the Nest build; `docker` CI job; `check-deploy` after every Coolify deploy (§17) | 0, 9 |
| R12 | Coolify not connected in time for release | Medium | Medium | Everything runs locally and in Docker from Stage 0; the Coolify steps are a 4-item checklist (§17.6); only Stage 9 needs it | 9 |
| R13 | React's size hurts first load on slow phones | Low | Medium | 150 KB initial-JS gate, lazy screens, Lighthouse ≥ 90 nightly (§15.3) | 0, 9 |
| R14 | Short wide screens: with the inline coach panel at its full 30vh, a 1366×600 or 900×560 window leaves a table box under 210 px, and pods overlap the board (the §12.4 geometry is only proven for the Stage 3 viewports and 1024×768) | Medium | Medium | **Done 9 Oct 2026** (v1.3.44): the panel's fixed row is `max(61px, min(30dvh, 100dvh − 540px − the safe areas))` (§12.5), so the table box keeps 320 px down to a 601 px tall window (279 px at 900×560, where nine players still fit); `tests/ui/layout/seats.test.ts` checks 1280×720, 1366×600 and 900×560. **Still open:** the sizing tray, inline on wide screens (§12.7), takes 104 px more: with the panel's 228 px row a 1024×768 table is 216 px tall while sizing, and the top pods reach the pot and the board (so since chunk 5.9, whose panel already filled 30vh at every Beginner decision) | 3, 5 |
| R15 | The §0.3 timer test was narrowed in chunk 4.5 (a test change, so it is recorded here): `tests/app/timers.test.ts` no longer scans `src/workers/` (a worker runs on its own thread and only pauses with the §7.3 `setTimeout(0)`) and ignores calls on injected timers (`this.timers.setTimeout`, the controller's `Timers` that the worker clients get). It still fails on any bare or `globalThis`/`window`/`self` timer call outside `app/controller.ts` | Low | Low | The scan's own unit test pins both sides of the rule; the controller stays the only main-thread file that calls the timer functions | 4 |
| R16 | ~~The push/fold model of §8.4 as written misses three of the five published-chart bands of its own acceptance~~ | **Closed 1 Oct 2026 (chunk 5.3)** | | The bands were the values of push/fold charts **with antes** (PokerCoaching.com 12.5% ante at 10 bb: BTN 43.9%, CO 34.2%, 6-max UTG 23.7%, 9-handed UTG at 12 bb 13.4%), and this game has none (§1.6). The same source's no-ante chart (https://pokercoaching.com/push-fold-charts/; its SB column matches HoldemResources' heads-up Nash chart) showed the first model 5.5 points too wide on the button. The model now has positional callers (the blinds call at their own price) and the pusher's card removal, 3,000 rounds: 0.5 points from the no-ante chart on average from 5 to 15 bb; the bands are restated as the chart's value ± 3 points and every spot passes (§8.4 notes). Left: below 4 bb overcalls are not modelled (up to 17 points too wide from early position at 3 bb) | 5 |
| R17 | The 6× speed checks (Stage 4 acceptance 3, chunk 4.7) cannot be proven on a CI runner. CDP cannot throttle a worker (§15.3), so the win-chance budgets are checked against the worker's own timing (`ms + 5 × busyMs`), a model; and CDP's rate is relative to the machine that runs it, so on the shared 2-vCPU runner (about 2.5× slower than the dev Mac) 6× is a much slower "phone", and the worker's `busyMs` also holds the CPU it loses to the game, Playwright and the server, which the model multiplies. CI measured the postflop final at 539 to 748 ms against about 270 ms on the dev Mac (budget 600 ms), and long tasks of 50 to 137 ms (24 of them with both checks side by side; one or two of 50–52 ms one at a time) where the Mac has none, or one just over 50 ms in about one run in five. Three attempts to make the check hold on the runner failed: running the two checks one at a time, then scaling the rate to the runner by an integer loop (the loop ran as fast as on the Mac), then by the `#bench` evaluator speed (the evaluator was only 1.2× slower while the game's worker ran 3.5–4× slower). **Decision (1 Oct 2026):** the two checks are **report-only in CI** (the PR `e2e` job and the weekly `slow` workflow's `perf` job print their numbers to the job summary and never fail the run), are **enforced on a developer machine** by `npm run e2e:perf` (run before merging a change that can slow the game), and are checked **on a real phone through `#bench`**, because the Testing strategy table already says latency budgets are checked per stage on a real phone (§15.4, §17.5). The rate is a plain 6 (no calibration). Chunk 6.5 puts the grading-time check (Stage 6 acceptance 6) under the same decision. | Medium | Medium | Report-only in CI; local enforcement by script; the e2e prints every number (worker timings real and modelled, each long task) so a slow trend is visible in the summaries; the real answer is `#bench` on a Galaxy A5x-class phone (acceptance 6, chunk 4.8, and Stage 9's device pass). If a budget is missed on the phone, fix the code, not the check. On the dev Mac a 9-player table's frames come close to 50 ms at 6×, so the enforced long-task check can fail by a few milliseconds in about one run in five: run it again before suspecting a change | 4, 9 |
| R18 | ~~Multiway `p = eRange^(1/nOpp)` (§8.2) reads high before the river, so the §8.10 meter contradicts the coach: "Strong" next to "Fold", "Decent" at a 6% win chance~~ | **Closed 10 Oct 2026** (branch `fix/strength-meter-consistency`) | | *Cause.* The n-th root reads the pot as n independent duels; before the river the cards to come tie them together (a hand that improves beats everyone), and before the flop the advice does not read `p` at all (§8.3 reads `rankPct`). Measured: 5 players, 8♣7♦ on A♥K♦9♠ checked to the hero (6%) gave 0.49, "Decent"; 6 players, Q♠3♠ first to act (17%, exactly the fair share) 0.70, "Strong" next to Fold; 9 players, 7♣2♦ first to act (5%, not the ~7% first written here) 0.70, "Strong". Over 3,881 engine-built hints, 525 of the 1,373 folds (38%) sat next to Strong, and multiway the buckets bet hands below their fair share for value (K-high against eight players at 8%). *Fix.* `p = n·E / (1 + (n − 1)·E)` (§8.2: the odds of beating one average opponent are n times the odds of beating all n; 0.5 at the fair share, `p = E` heads-up), which reads those three as 0.20 Weak, 0.50 Decent and 0.32 Weak; plus the §8.10 rule that the meter never argues against the move (at most Decent next to a fold, at least Marginal next to a value bet or raise), a safety net that acted on none of the 2,000 hints of the property test. The first candidate here, `eRange^(1/log2(nOpp + 1))`, was rejected: it squeezes weak hands toward 0.5 as players join (9-handed 7♣2♦ read 0.40, Marginal, above its heads-up 0.35), so before the flop nothing reads Weak from six players up. A preflop meter from `rankPct` was not needed: with this `p` no fold of the 3,881 hints reads above Decent, before the limit. *Advice.* Unchanged heads-up and before the flop (the preflop rules do not read `p`). After the flop in multiway pots the coach value-bets and raises less: of the same 3,881 hints (2,684 before the flop), 234 changed their main reason or action and 85 their action, all of them multiway after the flop (value bets became checks, protection raises calls or folds, e.g. a draw no longer raises over an all-in at 28% against a 41% price); E19–E22 pin it, E1–E18 are unchanged. Bots read the same `p` (§9.4): multiway they value-bet less, and more of their multiway hands are Air, where the bluff bonus applies; the 5.11 calibration (R19) should be measured with this `p` | 5 |
| R19 | Bot calibration (Stage 5 acceptance 5, chunk 5.11): §9.4 scores are dominated by the §8.9 EVs (a 0.3 pot gap is a factor 12 at Medium's T = 0.12), and the MDF fold-equity heuristic rates raises well (e.g. top pair facing a half-pot bet raises 60–95% of the time at Easy and Medium, a river five-high bluff-raises 7–23%), so the AF targets may be missed. **Closed (chunk 5.11):** measured, 24 of the 30 gates failed (every personality raised 22–59% of its hands; Easy's `'random'` model made every personality re-raise); after the §9.7 changes (the §9.4 biases in units of `T`, `A*` +3.5 `T` before the flop, the call and aggression biases, limp mode on the pick, Easy's preflop `V`, four §9.1 numbers) all 30 pass at 20,000 hands, seed 1 | Low | Medium | The weekly `selfplay` jobs (§17.5) re-check every gate; a change to `brain/` reruns `npm run selfplay -- --calibrate` at Medium and Easy before merging (Testing strategy). The tightest margins (Easy's AFs, 0.13–0.23 inside the band; TAG's Medium PFR, 0.7) mean a brain change can tip a gate: retune the §9.7 numbers, never widen a band. Hard and Expert (Stage 7) inherit the biases in units of `T` and get their own calibration | 5, 7 |
| R20 | Hard and Expert play far looser than their §9.1 targets (Stage 7 acceptance 2). Measured after chunk 7.1 (`npm run selfplay -- --level <hard\|expert> --players 6 --hands 3000 --seed 1`, the §9.3 Medium lineup, 100 bb): VPIP/PFR at Hard TAG 34/28, LAG 43/40, Rock 24/18, Station 35/12, Maniac 68/58; at Expert TAG 46/43, LAG 50/49, Rock 34/30, Station 38/21, Maniac 69/62; 3-bets 19–51% at Hard, 32–64% at Expert. The §9.4 biases were calibrated at Medium's and Easy's `T` (5.11); at `T` 0.06 and 0.04 the §8.9 fold-equity heuristic, which rates preflop raises with weak hands near break-even, weighs two to three times more, and at Expert the seat statistics of a loose table widen every range (`loosenessEstimate`), which makes more hands 3-bet for value | High | Medium | Chunk 7.3 calibrates by self-play (the §9.7 gates at Hard; the win-rate gates), as 5.11 did; 0 illegal actions, invariant violations and unfinished hands in both runs | 7 |

### UNVERIFIED items and how we close them

| Item | Closed by |
|---|---|
| Phone speeds (evaluator, equity, hint latency) | `#bench` on devices (Stage 4 one Android; Stage 9 full) |
| Short-BB "call the full BB" convention | Documented as our rule; vector B25 |
| Min raise after a postflop all-in bet below the BB | Documented as our rule; vector B37 |
| Heads-up 84% SB open | Only a rounded 80% is used; golden spots do not depend on it |
| SPR commitment bands; all HEURISTIC constants | Self-play (§9.7) and golden spots (Appendix E) |
| iPhone SE usable height for compact mode | Device script |
| `navigator.audioSession` support; Web Locks versions | Feature detection (+ `rev` fallback) |
| `<a download>` in iOS standalone | Web Share is the primary path |
| GDPR applicability with no data leaving the device | Privacy screen shipped regardless |
| PokerSnowie error-rate benchmarks, GTO Wizard thresholds | Not used for thresholds |
| ~~The full multi-stage Docker image build (steps were checked one by one on a host without Docker)~~ | **Closed 28 Sep 2026 (chunk 0.5):** built and ran `healthy` locally as written, on arm64 and on emulated amd64 (§17.3). The `docker` CI job keeps checking it on every PR to `main` |
| Coolify's **Force HTTPS** default; whether the Traefik proxy writes an access log by default; whether `SOURCE_COMMIT` is set at runtime by default | First Coolify deploy: check the settings, `check-deploy` (commit in `/api/health`), inspect the proxy logs; fix §17.6 |
| Whether any secure-context API works behind a self-signed certificate on phones | Not needed: LAN http for gameplay, Coolify HTTPS for the rest (§17.4) |

### Change log

| Version | Date | Change |
|---|---|---|
| 1.0 | 23 Sep 2026 | First complete plan, synthesised from three independent drafts and three research briefs |
| 1.1 | 23 Sep 2026 | Implementer dry-run fixes: global `handSeq` rule (§14.3); `BrainProfile`/`COACH`/`profileFor` (A.5); undo truncates replay inputs, waits for the grade, `grade: null` on failure (§11.3, A.7); seat stats persisted in the session (§9.5); bots never compute `eRandom` (§8.2); layout breakpoints, edge-tab gutter, compact tray, Menu contents (§12.3); system/failure states (§12.14); controller modes and gates (A.8); level-suggestion data (`recentHands`, `currentSession`); Stage 3 gets the settings-only profile and test hooks, Stage 5 builds the full range model; config ranges (§3.2); template placeholders, feedback fallback, glossary keys (F.1, F.5, F.9); build-only meta CSP and relative manifest URLs (§15) |
| 1.2 | 23 Sep 2026 | Domain audit: capped `winPot` for pot odds when the hero is short (§0.3, §8.2, F.1, F.5); bot decision seeds no longer derived from the deck seed (§2.4, §9.6); short opening all-in does not reopen for players who checked (§3.6, B37); "strictly after the button" wording (§3.7); board-only two pair / trips sub-labels + D.1 vectors (§6.1, F.3); flake-proof Monte Carlo tolerances (§7.5, §7.7); badge hysteresis defined; decisive semi-bluff size (§8.5); Blunder floor applies to the price signal (§8.9); COMMITTED copy; full house 1 in 39; rarity-vs-rank footer (§13.2, F.7); ITP cookie cap wording (§1.5, §14.1); help lines updated to 1-800-MY-RESET and GamCare (§16.2, G.3); Cloudflare cookie/analytics features off, no `Set-Cookie` check (§17); `webmanifest` precached (§15.1). All reference numbers in C.2, C.3 (exact rows) and D.3 re-computed with an independent evaluator and confirmed |
| 1.3 | 23 Sep 2026 | The human's answers and stack change. Q2 decided by us (the big number stays "any cards"); Q3: the human typed "RB Poker Caouch", **we read it as "RB Poker Coach"** (short name "RB Poker") — please correct us if another name was meant; internal `pc.*` identifiers unchanged (§0.3); Q4: Exam kept; Q6: the owner's Coolify server. Front end **React 19 + Zustand 5** instead of Preact + signals (§2.5, §15.3 budgets re-set, pitfall 37); **NestJS 12 server** in an npm-workspaces monorepo (§0.1, §2.1, §2.6); **local first, Docker, then Coolify** instead of Cloudflare, GitHub Pages fallback removed, CI deploy job removed (§17, §18); secure-context degradation for plain-http LAN testing (§12.14, pitfall 43); **one-tap Play** from Welcome and Home, Setup optional (§12.1, §12.2, Stage 3); privacy text for self-hosting (§16.1, G.2); Node 24, TypeScript 6.0. Review pass: `useRegisterSW` called unconditionally (§15.1), initial-JS target 130 KB under the 150 KB gate (§15.3), dealing never waits for a worker (§12.14), Traefik access log and sticky sessions off (§17.6), Playwright `webServer` from the repo root (§17.5) |
| 1.3.1 | 28 Sep 2026 | Scaffold (chunk 0.1): every §2.5 pin installed as written; the unpinned test, lint and format tools pinned exactly (§2.5 Tests, Lint and format rows); `.npmrc` `save-exact`; npm 11 blocks dependency install scripts, and the two it lists are denied in `allowScripts` (`@swc/core`: its native binary comes as an optional dependency; `fsevents`: ships prebuilt). Import convention (§0.3). Vitest `unit`/`slow` defines only the selected project, so a bare `vitest` never runs slow tests; the server has the same split. Server: `setup.ts` (`configureApp`, shared with the tests), `HealthModule` + `HealthService`; an empty `SOURCE_COMMIT` counts as unset (§0.1). Vite 8's Oxc transform also emits decorator metadata (Testing strategy, Server row) |
| 1.3.2 | 28 Sep 2026 | Static serving and headers (chunk 0.3): `security.ts` also exports the expected header values and the static cache rule; `strictTransportSecurity` written as a boolean (`exactOptionalPropertyTypes`, same behaviour) (§17.2); the `assets/` cache rule is judged relative to `rootPath`, and `no-store` covers every `/api` response, 404s included (§2.6 b); `WEB_DIST_DIR` override; misses outside `/api` get Express's own 404 page with its stricter CSP, because Nest 12 mounts its JSON 404 handler under the global prefix only (§2.6 a); new pitfalls 44 (dot-folder checkouts break the SPA fallback) and 45 (`Test.createTestingModule` gives serve-static a no-op loader); the server tests serve their fixture from a temporary copy and boot like `main.ts` (Testing strategy, Server row); with the SPA fallback in place, the scaffold's "`/health` is a 404" test now checks that `/health` is the game page, not the health JSON |
| 1.3.3 | 28 Sep 2026 | PWA shell (chunk 0.4): the meta CSP string lives in `apps/web/scripts/csp.ts` (the web app does not import `apps/server`; the E2E should compare it with the header) and is inserted right after `<meta charset>`, so it precedes every script; `scripts/check-html.ts` (`npm run check:html -w @rb/web`) also rejects inline event handlers and a meta CSP placed after a script; the icons are drawn by `scripts/gen-icons.ts` (a light spade on felt) and a test checks the committed PNGs are exactly its output; the manifest's name, short name and description come from `en.ts`; `index.html` also links `icons/icon-192.png` as the favicon (otherwise `/favicon.ico` gets the SPA fallback); `tsconfig.node.json` also covers `scripts/` and `tests/scripts/`. vite-plugin-pwa adds the manifest and its icons to the precache although the glob already matches them; Workbox ignores the identical duplicates |
| 1.3.4 | 28 Sep 2026 | Lint boundaries (chunk 0.2): the §2.1 rules are a small local ESLint rule (`rb/web-module-boundaries` in `eslint.config.js`), not `no-restricted-imports` or `eslint-plugin-boundaries`. `no-restricted-imports` matches import strings, not paths (so no allow-lists such as "`core` imports nothing", and false matches by folder name), skips dynamic `import()`, and its `allowTypeImports` accepts an inline `import { type X }`, which `verbatimModuleSyntax` keeps as a run-time import. `eslint-plugin-boundaries` classifies an import by resolving it to a file on disk, and in Stage 0 none of the modules exist yet. §2.1 table: rows for `workers/protocol`, `data`, `i18n`, `sound` and `main.tsx`; `data` added to `analysis`, `brain`, `workers` and `ui` (§0.1, §7.5, §13), `sound` to `app` and `ui` (§12.8); `workers` may import types from `engine/types`; the brain and the workers may call `observationKey` (A.4 puts it in `engine/types.ts`; §2.4 and §8.11 call it there); how to read the table is written out. `apps/server` must not import anything from `apps/web`, not only from `apps/web/src` |
| 1.3.5 | 28 Sep 2026 | Docker image (chunk 0.5): the §17.3 `Dockerfile` built and ran `healthy` as written (arm64 and emulated amd64), no fix needed; `npm ci` works under npm 11's install-script policy with the existing `allowScripts`; the "full Docker image build" UNVERIFIED row is closed. `docker-compose.yml`, `.dockerignore` (now also `.claude`, `.loop`, `docs`, `.env*`, §0.1) and the root `docker:up` script added (§17.3) |
| 1.3.6 | 28 Sep 2026 | Size budget (chunk 0.7): `scripts/size-budget.ts` and root `npm run size`; what each §15.3 size row counts is now written under the table (gzip level 6 with node:zlib, 1 KB = 1,000 bytes, initial JS = what `index.html` loads plus static imports, workers by their `*.worker-<hash>.js` name, precache = the `sw.js` list); shared `scripts/html.ts` readers for `check-html.ts` and `size-budget.ts` |
| 1.3.7 | 28 Sep 2026 | Playwright (chunk 0.6): `apps/web/playwright.config.ts` has 12 projects (Chromium and WebKit × the six §17.5 viewports; phones, landscape and tablet emulate a mobile device: user agent, pixel ratio, touch); `PORT` moves the E2E server when 3000 is taken. Root `npm run e2e` = `scripts/build-if-needed.mjs` (builds only when the build is missing or older than the sources), then `playwright test` in `apps/web` (§0.1). `tsconfig.e2e.json` type-checks the config and specs with DOM and Node types. The §15.2 request listener is on the browser context, so it also sees the service worker, and it flags WebSockets; specs import `test` from `tests/e2e/fixtures.ts`, and a spec checks that the guard records what it must. The offline test kills its own server instead of relying on `setOffline` alone, because Playwright's WebKit offline mode breaks the service worker (§15.2, new pitfall 46). The E2E compares the CSP header with `META_CSP` + `frame-ancestors` and checks the meta tag, as 1.3.3 asked |
| 1.3.8 | 28 Sep 2026 | CI (chunk 0.8): `.github/workflows/check.yml`, `e2e.yml`, `docker.yml`, `slow.yml` (§17.5); every workflow cancels superseded runs; runners pinned to `ubuntu-24.04` (`ubuntu-latest` moves to Ubuntu 26 on 19 Oct 2026); `check` also runs `format:check`, and `check-tables`/`check-copy` join when they exist; the `docker` job waits with `docker compose up --wait` and reuses `scripts/check-deploy.mjs` with `--commit`, so `docker-compose.yml` now passes `SOURCE_COMMIT` through (§17.3, §0.1); the weekly deploy check is its own job in `slow.yml` and compares the commit with `main`. `scripts/check-deploy.mjs` imports its expected values from `security.ts` (Node 24 strips the types; needs `npm ci`), also checks the SPA fallback, `no-store` on `/api/health` and no `X-Powered-By`, prints one line per URL, and has a server test (pass, no HSTS, a cookie, wrong or missing commit, server down) (§17.6 step 7). §0.2: the `slow` job is weekly |
| 1.3.9 | 28 Sep 2026 | Cards and seeded RNG (chunk 1.1): the card words live in `core/cards.ts`, the one exception to "every string in `en.ts`" (§0.3), because `core` imports nothing (§2.1); A.1 lists the extra exports (seed helpers, the C.4 reference functions, `rankLabel` for the "10, never T" rule, `newDeck`, `parseCards`/`formatCards`); `EngineError`/`InvariantError` are defined in `core/assert.ts` and re-exported by `engine/types.ts` (§0.1 vs A.3). §5.6 test details: per-card Bonferroni threshold, the `randInt(3·2^30)` modulo-bias check, unit vs slow sizes; `TEST_SEED` (Testing strategy → Rules) |
| 1.3.10 | 28 Sep 2026 | Evaluator (chunk 1.2): bit-parallel rank-multiplicity masks instead of `cnt[13]`, and module-local table references because Vitest's module runner slows imported bindings ~4× (§5.3 notes, with measured speeds); A.2 adds `score5`, `score6`, `HAND_CATEGORIES`, `scoreNibbles` and the `tables.ts` exports; §5.5 records the sample sizes, the small-deck samples and the benchmark's warn-only behaviour. Appendix C.1 counts reproduced exactly |
| 1.3.11 | 28 Sep 2026 | `describe()` (chunk 1.3): the hand names and sub-labels live in `HAND_TEXT` in `eval/describe.ts` (§0.3 Strings exception, since `eval` imports only `core`); §5.4 spells out the high-card `core`, the `best5` order and the preflop fields; D.1 notes that the nuts suffix comes from the UI and records an **open conflict** in D.1's within-rank order (row 6 vs rows 7 and 22; expected values unchanged, row 6's exact order is a known failing test until decided) |
| 1.3.12 | 28 Sep 2026 | Merge fix (Stage 1 orchestration): closed the D.1 within-rank order conflict from 1.3.11 — a rank's cards in `best5` are always listed by suit (s > h > d > c), and that is a separate rule from which cards are *selected* when a rank has spare candidates (still hole cards first) (§5.4); D.1 row 6's `best5` corrected to 7♥ 7♦ 7♣ K♠ 2♦ to match rows 7, 22 and the code; the describe test's `it.fails` on row 6 is now a normal passing assertion |
| 1.3.13 | 28 Sep 2026 | Engine types and invariants (chunk 2.1). **§3.7 round end with one active seat:** it now ends when that seat faces no bet (`streetBet ≥ currentBet`). The old wording ("at least as much in as every other live seat") ended the round before a small blind facing a short all-in BB could act, so B34's "SB fold" and §3.8's only refund to a folded seat could not happen, against §3.3 ("callers must put in the full `bb`"). Nothing else changes: `currentBet` is the largest street bet except preflop against a short BB. The §4.2 `startHand` comment follows. **§4.4:** `checkInvariants(h, { replayLog })`; the rows list the extra checks `invariants.ts` makes ("Also:": per-seat chip conservation, `deckPos`, the seat to act still has to act and the round is not over, only live seats win, are paid or are shown, `dealtIn ⇔ startStacks > 0`, `endedBy` consistency); new I0 (well-formed) and I15 (button and blind seats); I12 replays `h.log` behind the option and also checks I4's "never decreases". **A.3:** the lists `STREETS` … `PERSONALITY_IDS` and `ENGINE_VERSION` (the engine cannot read package.json, §2.1; a test keeps them equal); the comments pin what later chunks rely on: `handsDealt` counts finished hands (the top bar shows `handsDealt + 1`), `award.pot` is an index into `result.pots`, I7 also holds after refunds and settlement, settlement leaves `streetBet` and `totalBet` as they are, `hole` is [first card dealt, second]. `observationKey` is canonical JSON with sorted keys |
| 1.3.14 | 28 Sep 2026 | Table setup and deal (chunk 2.2). **Button (§3.3):** `TableState.button` keeps the last hand's button and `startHand` moves it (`buttonForHand`); the first hand's draw from the table seed passes to the next dealt-in seat if the drawn seat has no chips (engine mode); the 3 → 2 rule applies to every hand with two seats dealt in, which in a steady heads-up game is the usual alternation. **Seating (§9.3):** `createTable` keeps its §4.2 signature and `initialSlots(cfg, tableSeed, heroName)` builds the default players (bot `i` takes entry `i` of its own seat's level list; the hero's name comes from `en.ts`); the bot names live in `engine/table.ts` (§0.3: proper names picked by the engine). `nextTable` checks that `done` is complete, passes the invariants and was dealt from this table; sets `nextHandSeq = max(nextHandSeq, handSeq + 1)` and `handsDealt + 1`; replacement names skip every seated name, the busted bot's own and this batch's newcomers included; `nameCursor` never wraps, so no `playerId` is reused. `topUp`: the hero only, up to the starting stack. Between hands a table may have a single player with chips (a hero busted heads-up waits for a reload); `createTable` and `startHand` need two. **Layout (§0.1, §4.2):** new `engine/rules.ts` (shared §3 helpers for start/step/settle; `invariants.ts` keeps its own copies on purpose), `settle.ts` with only `refundUncalled` so far, `deckFromSeed`, `validateTable`, and the `EngineError` codes of the table and start functions |
| 1.3.15 | 28 Sep 2026 | Betting rules and the reducer (chunk 2.3): `engine/legal.ts` (`legalActions`, `raiseReopened`) and `engine/step.ts` exactly as §3.5–§3.7 and §4.3; no rule changed. **§4.2:** the `EngineError` code of each refused `step` input, and what "development build" means for the deep-freeze of returned states (`import.meta.env.DEV`: Vite dev and Vitest; not production or plain Node). The reducer also takes the `reshuffle` input of §4.3 (listed under chunk 2.5), since `step` must accept every `EngineInput`; 2.5 adds the undo tests of §11.5. §3.9 order in a run-out that starts before the river: no river bet, so the first live seat left of the button shows first. `settle` is chunk 2.4: until then the last `advance` of a hand throws |
| 1.3.16 | 28 Sep 2026 | Settlement oracle (chunk 2.4, test side). Stage 2 said the oracle groups chip layers "with identical contributor and eligible sets". Two consecutive layers always have different contributors, so read literally it never merges and splits a pot wherever a folded seat's chips end: a different pot list from §3.8 and, with two odd layers, different odd chips (an 8-seat case pays 502 / 500 instead of §3.8's 501 / 501; test in `settle.oracle.test.ts`). §3.8 is normative, so the oracle merges layers with identical eligible sets (Stage 2 reworded). B18 and B44 said "clockwise from the button", which could put a winning button first; they now say "from the seat left of the button", as §3.8 and TDA r.20 do |
| 1.3.17 | 28 Sep 2026 | Settlement (chunk 2.4): `settle.ts` implements §3.8–§3.9 as written, wired into `advance`, so every hand reaches `complete`. **§3.8:** the pseudo-code's merge of pots with equal eligible seats can never apply with levels from live seats (noted; the engine leaves it out, a property test checks the shrinking eligible sets); the log's `award` events go last side pot first, main pot last, as the pots are animated. **§3.9:** `result.shown` is in reveal order, its `best5` follows §5.4 (a local helper in `settle.ts` with the same rule as `describe()`, which is not on this branch's base; switch to `describe().best5` after the rebase). **Oracle:** the engine and the chip-layer oracle agree on 100,000 random multi-way all-in hands in `unit` and 1,000,000 in `slow` (refunds, pots, eligible seats, winners, odd-chip shares and payouts, compared both before and after the engine's refunds); no disagreement was found, so neither side changed. `engine/clone.ts`: `step` copies the state field by field (typed, so a new field cannot be forgotten) instead of a generic recursive copy, which was a third of its time |
| 1.3.18 | 28 Sep 2026 | Merge fix (Stage 2 orchestration, chunk 2.4 rebase onto main): 1.3.17's note is resolved now that `eval/describe.ts` is on `main` (Stage 1). `settle.ts` deletes its local `bestFive` duplicate and calls `describe(holeOf(h, i), h.board).best5` instead (`holeOf` now returns the `[Card, Card]` tuple `describe` expects); this also drops the now-unused `score5`/`scoreNibbles`/`makeCard`/`rankOf`/`suitOf` imports from `settle.ts`. `describe()`'s own `playsTheBoard` branch (empty hole when the board alone already scores the same, §5.4) is why `describe()` is called rather than exporting the old helper's internals as-is: a bare re-export would need the same board-plays pre-check at the call site to avoid picking a hole card that only ties (pitfall 10). `settle.test.ts`'s "bestFive" suite now tests `describe().best5` directly (imported from `eval/describe.ts`; the vitest `describe` is aliased to `suite` to avoid the name clash); no behaviour changed, so the same expected values still pass |
| 1.3.19 | 29 Sep 2026 | Engine tests (chunks 2.5–2.6). **Appendix B** runs from one file, `tests/engine/appendix-b.test.ts`: one test per vector, B1–B44, each id once (a meta-test checks the set, and that no other test file names a test after a vector); the evaluator half of B19–B24 and the vectors that lived in the start, step and undo tests moved there. **Stage 2 acceptance 2:** the harness `tests/engine/random-play.ts` draws tables and plays with one seeded RNG per hand, without fast-check or `expect` in the loop (100,000 hands in `unit` take about 52 s on one core; the 10 million steps in `slow`, about 590,000 hands, about 5.5 minutes); every state is checked twice, by `step` itself and by the harness with the I12 log replay; the policy also sends an occasional `reshuffle`. **§15.3 engine budget:** `tests/engine/benchmark.test.ts` times `step` over the (state, input) pairs of 500 random hands and warns, never fails, when the mean is above 0.2 ms (p50, p99 and the maximum are reported; single steps are noisy on a shared runner); Vitest is a development build, so the time includes the deep-freeze of each output and is an upper bound. **Coverage:** `@vitest/coverage-v8` thresholds in `apps/web/vitest.config.ts` (`src/engine/` ≥ 95% branches, `src/eval/` ≥ 90%), enforced by `npm run test:coverage`, a second test step of the `check` job after `npm test` (§17.5). The coverage run leaves out the volume and timing tests (`VOLUME_TESTS`: random play, the settlement differential, replay, the two benchmarks): the numbers are the same without them, and under V8 coverage on the CI runner the 100,000-hand run alone took 273 s. On CI, Vitest runs a test worker on every vCPU instead of its default cores − 1 (one worker on the 2-vCPU runner): measured there, two workers were a little faster than one (unit step 175 s against 185 s, coverage step 68 s against 78 s), although each test runs slower beside another. **§4.8:** `observe` reports `callIsAllIn` on the closed `legal` shape from the same public facts as `legalActions`; its non-leak property observes every state of random hands and re-deals the burn cards too |
| 1.3.20 | 28 Sep 2026 | Cards and seats (chunk 3.3): the geometry in `ui/layout/seats.ts` is unit-tested for 2–9 players at every Stage 3 viewport, and the PLAN's numbers failed that test, so: the 3- and 4-opponent side seats move to x = 10 / 90 and the board's card width also leaves a 72 px column on each side (§12.3, §12.4: pods overlapped the board on 360–390 px phones); pods are clamped vertically too; the pot sits right above the board instead of at (50,34); bets move from the 30% point to the nearest free slot beside the pod when the point is taken (§12.4); the edge-tab gutter applies in landscape too (§12.3). Pod details (§12.4): the dealer disc and blind tags sit inside the pod box, the personality badge is an 11 px icon before the name (a 16 px badge on the avatar collided with the status tag), the status tag sits under the avatar. `Card` has seven sizes and takes `card={null}` for face down (§13.4). View models (`ui/views.ts`) never carry a hidden card. Risk R14 (short wide screens) |
| 1.3.21 | 28 Sep 2026 | Hand-rankings panel (chunk 3.6): `data/rankings.ts` is F.7 verbatim (typed with `satisfies`, `prettier-ignore` keeps its layout); the panel's own strings are in `en.rankings`. `RankingsList` (rows + footer) is shared by `RankingsDrawer` (controlled `open` / `onOpenChange(false, reason)`), `RankingsColumn` (wide, with its 44 px rail) and later Learn; `HandsTab` is placed by the Table in the gutter. §13.1: the tab ignores a click that ends > 10 px from its pointer-down; openers focus themselves (Safari). §13.3: the "You" line also dims kickers, shows the hole cards preflop; after a fold the other rows lose their captions. §13.4: row labels end with how often. The improvement pulse and tab dot are hooks (`useImprovementPulse`, `useHandsTabDot`) scoped to one `handSeq`. `tableFrame()` takes `{ coachPanel, handsCollapsed }` |
| 1.3.22 | 28 Sep 2026 | Local session and settings storage (chunk 3.2). **§14.6 rule 1:** the type guard runs after the migrations (a current-version guard cannot check an older object). **§14.6 rules 2–3:** the corrupt copy is `pc.corrupt.<ISO time>` (`.1`, `.2` … if taken) and the fresh profile is written after it, so the next launch is normal; a newer `schema` counts as corrupt; when the copy fails nothing is overwritten; the session is never copied (§14.5 voids or discards it); `SafeStorage` keeps a failed write's value in memory for the launch, `onFailure` fires once (the banner) and every write retries. **§14.3:** `rev` counts every profile write, settings changes too. **§14.5, A.7:** the session's `table` is the table as at hand start; loading checks the guards, `checkInvariants` on the hand and the undo snapshot, the hand against its table and the engine major, then resumes, voids the hand (chips returned) or discards the session, and writes the result back; saving is one `stringify` + one `setItem`. **§14.7:** both loaders take `readOnly` (no write-backs) for a tab that does not hold the `pc-writer` lock yet. **H.2:** empty `PROFILE_MIGRATIONS`/`SESSION_MIGRATIONS`, the v0 mechanism fixture, guards accept unknown fields; `loadSession` takes `ENGINE_VERSION` from the controller, because §2.1 lets `persist` import only types from `engine/types` (so `persist/schema.ts` also repeats the union members as `Record<Union, true>` objects, which the compiler checks against the unions). **A.5:** `Grade` and `LeakId` live in `src/brain/types.ts` now (a `DecisionRecord` stores them); Stage 5 adds the rest of A.5 there |
| 1.3.23 | 29 Sep 2026 | Action bar and sizing tray (chunk 3.5). **§12.7:** a short all-in call adds the line "Pot you can win {winPot}" (§0.3's capped pot, so a 50-chip call facing 500 does not look like a 600 pot); a new row for "nobody left to raise against" (right button hidden, as for an all-in call); the tip under a disabled button stays until the next tap or decision; disabled Row A buttons use `aria-disabled`; the amount rules written out (preset targets rounded to the SB, then checked against the `legalActions` bounds; slider positions = min, every SB multiple between, max; the ±2% snap only while dragging; typed amounts snap to the nearest legal amount); the three tray placements (`inline`, `overlay`, `panel`) and `useSizing` for Android Back. **§0.3 Time:** only the controller uses timers *for game flow*; the tray's press-and-hold repeat is a local input timer. The coach parts of §12.7 (ring, "Coach" badge, the Coach chip, the coach's size as the tray start) wait for chunk 5.9, which owns them |
| 1.3.24 | 29 Sep 2026 | Store and TableController (chunk 3.1). **A.8** now lists the store's API the screens use: `Screen`, `Overlay` + `OVERLAY_GATE`, the slices, the UI and game commands, the hooks; `ControllerMode` and `Gate` live in `app/store.ts` (the slices need them) and `controller.ts` re-exports them. Gates are derived in the store (visibility, screen, overlays, explicit holds); the controller has one pausable flow timer (a bot's think time, an advance pause or the next-hand pause) that stops while any gate is closed and runs on with what was left; each start of it has its own token, so a paused or cancelled run can never fire (pitfall 22, tested with a `clearTimeout` that does nothing). Back (§12.1) uses one guard history entry; UI closes never call `history.back()`. **§12.8:** the controller's pauses and their speed factor (the next hand never under 1 s, even at Instant). **§18 Stage 3:** SimpleBot's "bet" is the amount to call and its "pot" is §0.3's (it folds to a bet of at least the pot before it), its think time is §9.8 with closeness 0; it lives in `brain/` so the boundary rule keeps it on the Observation. Test hooks: the `__PC_TEST_HOOKS__` build constant and `npm run build:e2e -w @rb/web` (`vite build --mode e2e`); E2E specs that need `?seed=` or `window.__pc` must run against that build (chunk 3.8). New table mid-hand: the unfinished hand is finished headlessly now (the hero checks when checking is free, since folding then is illegal, B32); Stage 8 adds its commit. The §0.3 timer rule is checked for every non-UI module (`tests/app/timers.test.ts`) **Phase 2 (after 3.2, 3.3, 3.6, 3.7):** one navigation model: the store holds the `Nav` of `app/navigation.ts` (3.7) and applies its actions (`go`, `replace`, `back`, `open`, `close`); navigation.ts gains the table overlays, and its history note now describes the lifecycle guard entry; `ScreenSwitcher` draws only the overlays it is given. Setup's Start game mid-hand opens the §3.1 `newTable` dialog from the controller (`confirmed: true` on Yes). The settings slice is the A.7 `Settings`, validated on every change (`seatLevels.length === players`), saved 250 ms after a change and at once on hidden, pagehide and a new table (which also writes the profile on the first launch, so the next launch opens Home). The session is saved after every step and resumed exactly (a complete hand resumes into its hand end: step 5 of §14.3). New toasts `handNotRestored` and `dataRecovered`, and the storage banner flag. View-model selectors (`app/tableViews.ts`) build the `ui/views.ts` shapes structurally (a type test keeps them assignable); a pod's `bet` stays until the street ends (`betting` and `roundComplete`), and the pot line uses `sidePots()` while someone is all-in. |
| 1.3.25 | 30 Sep 2026 | Table screen (chunk 3.4). `App` renders the store's `Nav` (`ScreenSwitcher`) with small store-wired wrappers; the Table's parts each subscribe with their own narrow selector (a `<Profiler>` test: 50 `equity` writes, zero renders). The table box is measured (`ResizeObserver`, window `resize` without it) and `tableGeometry()` places seats, bets, board and pot; compact mode is the `(max-height: 640px)` query in JS too. The sizing tray is also the Nav's `tray` overlay (shown while both are open; whichever closes first closes the other), so Back closes the tray, then the drawer, then leaves the table. The drawer host covers every row above the action bar (§13.1); on `wide` an open drawer is closed (the column replaces it). **§12.3** compact tray ends above the hero's cards; with the tray open (a table row 104 px shorter) side pods beside the board widen its free column and a low top pod moves the board and pot down (`boardSide`, tested for every player count with the tray open); **§12.4** dealer disc and blind tag hide at the reveal; **§12.5** landscape hides the label while the tray is open, top-bar buttons reach 8 px over the felt; **§12.9** banner until the next hand, loser lines and split rules, the board highlights a winning bot's five; **§12.11** the storage banner's Export sentence waits for Stage 8; **F.10** the Table words. `app/secure.ts` detects the secure-context APIs (re-exported by the store for the UI); a test boots and deals with all of them missing and checks no source calls `crypto.randomUUID`. `src/persist` joins the coverage thresholds (≥ 90% branches). **§15.3 DOM ≤ 600:** a card's rank is now a bare text node (no wrapper span, same look), so nine players on a wide screen with the rankings column and every hand shown peak at 576 nodes in Chromium (591 in the jsdom test that guards it); Stages 4–5 add to this screen and need to keep it under 600. Later chunks: the 1.2 s action bubble by the seat (§12.3), the aria-live log and turn announcement (§12.12), keyboard shortcuts (§12.5), mute, Undo, the coach UI, wake lock. |
| 1.3.26 | 30 Sep 2026 | Stage 3 acceptance suite (chunk 3.8). The E2E job and the root `npm run e2e` use the **E2E build** (`npm run build:e2e`: the production build plus `?seed=` and `window.__pc`; `scripts/build-if-needed.mjs` rebuilds when `apps/web/dist` is a production build, found by the test-hooks marker), because criteria 1, 7 and 8 read the action log and the state through `window.__pc`. Specs (`apps/web/tests/e2e/`): `hands` (criteria 1 and 7, DOM ≤ 600 at every hand end: 25 hands with nine players, then 25 heads-up, at each of the five viewports in both browsers), `layout` (2), `rankings` (3), `controls` (5, 6: every screen and sheet at all six viewports), `resume` (8, and 9's saved/no-session Play), `table` (9 at every viewport, and a full hand at Normal speed), `offline` (§15.2: a full 6-player hand to a showdown and the rankings, offline), `perf` (§15.3 long tasks: 25 hands in Chromium in a 13th project, `chromium-perf-390x844`, that depends on the other 12 so it plays alone: a long task is wall time, and parallel tests on a busy runner made 75 ms ones by themselves). The hero always taps the visible buttons. **Speed:** the long runs install Playwright's fake clock and move it on (`clock.runFor`) while bots think, and read each step's state and button positions in one round trip before tapping there with real mouse clicks, so 50 hands take 10–20 s instead of about 100 s; every timer still fires in order, each in its own task, with the page rendering between them, and no timer runs while the hero decides (auto next hand off), so no decision is skipped. **Criterion 2:** the Hands tab is its 28×88 face in the gutter (§13.1: the 44 px hit area reaches 16 px into the table on purpose). **Criterion 7:** a MutationObserver checks every DOM change: a bot seat not in `hand.revealed` shows no face-up card, and neither of its cards is named anywhere outside the rankings list's example cards (`data-examples`). **Bug fixed (WebKit):** opening the rankings drawer scrolled its `overflow: hidden` root sideways by the sheet's width while the sheet slid in (WebKit reveals the focused sheet even with `preventScroll`), so the scrim missed the table and a quick tap on it hit the table; the root is now `overflow: clip`, the hero's row is centred by scrolling the list only, and the sheet is focused with `preventScroll`. Criterion 4 stays the component test of chunk 3.6; criterion 10 is manual. |
| 1.3.27 | 30 Sep 2026 | Draws and outs (chunk 4.1, `analysis/handinfo.ts`): §6.2 implementation notes record how the table is read where it is silent (a draw's `outs` = the §6.3 outs that complete it, backdoor 0; "uses a hole card" = better than the board's own straight; open-ended with the Ace low and high; overcards only with a High-card hand; nut flush = highest card not on the board; backdoor straight's hole rank not on the board; `\|S\| ≤ 2` before the river); §6.3 says categories are the 10 display categories and how rule 2 is checked; R4 names the top two cards and counts a straight flush; A.5 lists the `handinfo.ts` functions. D.2 passes unchanged, and a brute-force oracle agrees on 5,000 random flops and turns |
| 1.3.28 | 30 Sep 2026 | Chances by the river (chunk 4.2, `analysis/chances.ts`): §6.6 implementation notes name the functions (`finalCounts`, `chancesByRiver`, `outsChances`), fix the units (percent, 0–100), define `boardShared` (the category the board's own cards make, a pair or better) and `byRiverPct` on the turn (= the next card), and record the timings. Every D.3 value and the C.5 table reproduce unchanged; an independent enumeration with the naive evaluator agrees on random flops, turns and rivers |
| 1.3.29 | 30 Sep 2026 | Win chance (chunk 4.3, `analysis/equity.ts`): the §7.3 implementation notes record the generator shape for the worker (null checkpoints, results at the marks and at the end), the units (fractions in [0, 1], `equity === win + split`), what "opponent combos × runouts" counts (unordered sets of disjoint hands, so only HU turn, HU river and two opponents on the river are exact; every flop and preflop request is Monte Carlo) and that `eq\|` seeds write the hero cards and the board highest card first. §2.4 gains the seed of the all-in run-out Monte Carlo (`run\|…`), which §7.2 needed but did not name. `analysis/types.ts` (A.5) is byte-identical to the one in the 4.1 PR, so the two merge cleanly. |
| 1.3.30 | 1 Oct 2026 | Equity worker (chunk 4.5). §2.2 names the files (`workers/spawn.ts` with the literal constructor, `equity.worker.ts`, the job runner `equityService.ts` behind an `EquityMath` interface, `equityMath.ts`; `app/workerClient.ts`, `app/equityJobs.ts`). §7.3: the worker pauses with `setTimeout(0)` after 8 ms slices of work instead of after every 2,000 trials, a newer job of a kind stops the older one, and the 3 s cap posts the last estimate as final (`truncated`) or an `error`. §7.4: the job keys that make "a request exactly on each trigger" true, known-hands mode from `hand.runout` + two face-up live seats, no job when folded or complete, the `hidden` gate cancels all and re-sends unfinished jobs, timeouts wait for the next trigger. §6: preflop `chances` is null until the `finals` table (4.4). A.6: the client's delivery rules, "two consecutive timeouts", `bench` answers `error` until 4.7. A.8: the `equity` slice, its statuses and selectors, `ControllerOptions.equity`, `logs().equity`. A.5: `brain/types.ts` gains the brain types the protocol carries (types only). §0.3: the worker clients' timeouts use the controller's timers; R15 records the narrowed timer test |
| 1.3.31 | 1 Oct 2026 | Win badge, price chip, draw chips and "By river" (chunk 4.6). **§7.6** implementation notes: percentages never read "0%" or "100%" unless exact ("<1%", ">99%"); the skeleton and hysteresis start over with each situation; the badge is off from the showdown on; the popover is a disclosure (no gate); the price chip's two lines and where "Pot you can win" shows; the big-move selection rules (which line, when none) and its 4 s callout. **§0.3 Time:** display timers are local UI timers too. **§12.3:** the draw chips' row along the bottom of the strip, one chip and "+N" on phones, two on wide screens. **§13.2:** when the "By river" column shows, and its header row comes with it. **F.10:** the badge's screen-reader names, "Show all your draws", "{card}, may help them too", "By river: {x}%.". **§6.2:** the chips' out cards are picked on the main thread from the worker's `HandAnalysis.outs` with no evaluation (`drawCards`, checked against every draw's `outs` on 2,000 random flops and turns), so the main bundle carries no analysis code; the chip numbers are `outsChances` (§6.6). The views read chunk 4.5's `equity` slice as it is. §15.3: nine players on a wide screen with the HUD on peak at 594 DOM nodes in the jsdom guard |
| 1.3.32 | 1 Oct 2026 | Preflop tables (chunk 4.4). §7.5 implementation notes: one sampler (`equity()`), seeds, the measured generation time (**181 s on 8 threads of an M1 Pro, not "~1 min on 8 cores"**: the `preflop-equity` row now says ~3 min), `finals` stored as exact counts (the `finals` row: ~11 s of CPU), the byte-plane layout and sizes (~7.9 KB gzip for both modules), and what `check-tables` checks (checksums, the recorded generator / seed / trials, the finals against Appendix C.1 × 21 and 3 rows recounted, 20 re-sampled cells). **C.2 is hand against hand, so the table's oracle is C.3** (vs random hands); a test also uses the exact identity "the combo-weighted average of one opponent count is 1 / (nOpp + 1)". Wired into `workers/equityMath.ts`: preflop `equity` is the table, preflop `handInfo.chances` is filled (`equity.worker` 14.1 KB gzip). §17.5: `check-tables` (`npm run gen:check`) is in the `check` job, and a weekly `tables` job regenerates both tables and compares them with the committed files. §0.1: `.gitattributes`, `generated.ts`, `table-jobs.ts`, `data/preflopLayout.ts` |
| 1.3.33 | 1 Oct 2026 | All-in TV mode, luck line and `#bench` (chunk 4.7). **§7.4:** a second run-out job, `allIn` (own slot), for the board as it was when the hands turned face up (`boardAtReveal`): the luck line's "{E}% when the chips went in"; hero face up only; it outlives the hand. **§7.3:** only a newer `equity` job supersedes an older one (two `equityKnown` jobs now run at once); every reply carries `timing`. **§7.6:** the bars (one element each, in the free bet slots, gone at the hand end) and the luck line's exact rules ("lost" = no payout, "won" = alone in the main pot, thresholds on the printed whole percent). **§15.3:** the throttled e2e and why the worker is modelled (`ms + 5 × busyMs`): CDP cannot throttle workers; the win-chance budgets and the long tasks are two runs (the throttled main thread slows the worker on a 2-vCPU runner); the perf project runs its tests one at a time; the rate is a plain 6 (a calibration to the machine's `#bench` speed was tried and dropped). **§17.5: the two throttled checks are report-only in CI** (numbers in the job summary of the PR `e2e` job and of a new weekly `perf` job, `PERF_REPORT_ONLY=1`; a missed budget is a warning), **enforced on a developer machine by `npm run e2e:perf`**, and checked on a real phone through `#bench`: latency budgets are checked per stage on a real phone (Testing strategy, Performance). Stage 4 acceptance 3 and the Testing strategy row say so. **§15.4:** how to open `#bench`, what it measures (5M evaluations from a seeded 250,000-hand pool; time to final through a job runner of its own, median of 3), the plain-text report. **A.6:** `JobTiming`, `EquityBenchResult` (three equity times instead of `eq8Ms` / `eqFlopMs`), the log's request summaries. **A.8:** the slice's `allIn`. **R17:** why the throttled checks cannot be proven on a CI runner, and the decision |
| 1.3.34 | 1 Oct 2026 | Range and push/fold tables (chunk 5.1). §7.5: the `ranges` and `pushfold` rows and implementation notes (sizes 4.3 KB and 0.9 KB gzip, times, what `check-range-tables` checks). §8.3: `rankPct` is the share of combos that rank at least as well (AA 0.45), because the literal "0 = AA" makes "72o in the bottom 1%" impossible at any weight (32o is always below it); the weight is tuned from 0.5 to 0.25, the plan's own remedy; `eqVsRange` uses the exact top X% with the edge class in part. §8.4: the model pinned down (blinds, dead money, who calls, rounds, what `callPct` means) with its convergence; **3 of the 5 acceptance spots miss** (risk R16, bands not edited, known failures). §0.1 and §17.5: the new scripts, `data/rangesLayout.ts`, `brain/rangesData.ts`, `brain/pushFoldData.ts`; `gen` and the weekly `tables` job cover all three tables |
| 1.3.35 | 1 Oct 2026 | Opponent range model (chunk 5.2: `brain/tunables.ts`, `opponentStats.ts`, `ranges.ts`, `features.ts`). Readings chosen where the text was open, consistent with Appendix E (E9, E13, E16 checked): **§8.6** the prior reads a seat's **last preflop raise** before its first voluntary action (otherwise an opener who 4-bets keeps the open range, which contradicts §8.3's 2.5% 4-bet range); the soft edge stays at 0.01 beyond `1.25·X` ("no hand ever becomes impossible"); the first raise after limpers is an open raise; any all-in raise to ≤ 15 bb is a push; the AF shift moves only the bet/raise μ; HS population, draw-bonus details and a `1e-12` underflow floor in the new implementation notes. **§8.2** `effStack` counts chips at the street's start (stack + street bet; E13's shove and E7's blinds need it), preflop SPR uses the blinds, `k` and `position` skip all-in players, `facing` spelled out. **§9.5** stat definitions and AF shrinkage in frequency space. `Features`, `Facing`, `Position` join `brain/types.ts`. |
| 1.3.36 | 2 Oct 2026 | Brain worker (chunk 5.8). §2.2 and A.6 name the files and the client rules (`brain.worker.ts`, `brainService.ts`, the brain client, the controller's `sendBot`); the bots now decide in the worker. **Deviations:** `botDecision.profile` is `Pick<BrainProfile, 'id'>` until 5.7 (`profileFor` does not exist yet); SimpleBot moved to `scripts/bots/simple.ts` as the self-play baseline, and the worker runs a **copy** of its rules, `brain/standIn.ts`, because the §2.1 boundary keeps `src/` from importing `scripts/` (a test checks both decide alike; 5.7 deletes the copy); the think time is computed in the worker from `Decision.ev` (`brain/think.ts`, §9.8 note); the first bot decision of a session waits 3 s (§12.14 "max 3 s") instead of 2 s. `app/brain.ts` (the Stage 3 port) is gone: the controller takes the `WorkerClient` directly, like the equity client. The worker chunk is 1.9 KB gzip (budget 60 KB). |
| 1.3.37 | 2 Oct 2026 | Guardrails and EV model (chunk 5.5: `brain/guardrails.ts`, `brain/ev.ts`; version number provisional, the Stage 5 branches are merged in order). No rule or number changed; the readings are in the new **§8.8** and **§8.9** implementation notes. **§8.8:** one object per rule, rule 4 split into its always-call and never-call halves, an injectable rule list (Stage 5 criterion 3); rule 5 (snap to legal) runs before rules 1–4, which only exchange fold, check and call, so the result is always legal and applying the list twice changes nothing; rules 1–4 never change a bet or raise; GUARDRAIL reason data `{ rule, detail }`. **§8.9:** `R` and the implied odds come from the policy, with `R = 1` and no implied odds after an action that ends the hero's betting; a bet is valued up to what the villain can match; an opponent already all-in never folds (`FE = 0`); "the top `c`" by EHS after the flop, `rankPct` before; a hidden seat's stickiness is its level's mean; candidate sizes are rounded to the small blind; one `E_called` seed per size so hint and grade agree. `GuardrailId`, `GuardrailResult` and `EvCandidate` join `brain/types.ts`. |
| 1.3.38 | 1 Oct 2026 | Preflop and push/fold policy (chunk 5.3): `brain/preflopPolicy.ts` and `brain/pushfold.ts` exactly as §8.3–8.4, with the readings in the new §8.3 notes (position and `kV` as §8.2/§8.6, callers in, facing a 3-bet after a cold call, an all-in at any depth decided by the §8.4 call rule, sizes rounded half up, `SET_MINING` for 22–99, reason-data units, the §9.4 style knobs); `PreflopDecision` and `PreflopStyle` join `brain/types.ts`, the constants `brain/tunables.ts`. **R16 closed (§8.4):** the acceptance bands were values of charts with antes; restated from the published no-ante 9-handed Nash chart (PokerCoaching.com, ± 3 points), with HoldemResources' heads-up chart for the SB; the push/fold game now has positional callers (the small and big blind call at their own price) and the pusher's card removal, and averages 3,000 rounds instead of 300 (`gen-pushfold@2`, table regenerated): every spot passes, 0.5 points from the chart on average from 5 to 15 bb; `check-range-tables` checks the small blind's 1 bb row and the rounds; the known-miss list and its `it.fails` tests are gone. §7.5 times updated |
| 1.3.39 | 2 Oct 2026 | Postflop policy and bet sizing (chunk 5.4: `brain/postflopPolicy.ts`, `sizing.ts`). Implementation notes in **§8.5** and **§8.7** record the readings, all consistent with E9–E17: SPR band 1 heads-up reads "top pair or better" as `p ≥ 0.6`, "prefer all-in lines" = an all-in raise, band 2 "commit" = never fold only (E14's 3/4-pot bet at SPR 4), band 3 one pair never raises and value-bets at most two streets; the made hand counts only the hero's own cards; implied odds count the outs that make the draw's hand; the Very wet row also covers monotone and four-to-a-straight boards; a Strong river value bet (no row in §8.7) sizes by texture with Dry 1/2; the all-in row compares the effective stack left with the pot after a call; reason codes per outcome (`COMMITTED` on every committed call, `BOARD_PLAYS`, `CHECK_FREE` on the river). `BetPurpose`, `SizeSet`, `PostflopSpot`, `PolicyIntent`, `PolicyDecision` join `brain/types.ts`. |
| 1.3.40 | 8 Oct 2026 | Level selectors and the bot card (chunk 5.10). **§12.2, §12.1:** Setup and Settings offer Easy/Medium bots and Beginner/Intermediate coach (`AVAILABLE_LEVELS`, one list for both screens); Settings gets the two level rows above Speed, built from the same `LevelCards` as Setup, with a hint that says when a change starts (F.10). **§10:** a new bot level starts with the next hand through `withLevels` (applied when the next hand is dealt and when its bots sit down: seated bots keep their personality, the table's per-seat overrides stay, the hand in play keeps its table); the coach level is read live from the settings and its strict per-decision latch waits for Stage 6's decision records (implementation note in §10). **§9.3, §12.4:** every opponent's pod is a button that opens the bot card, a lazy modal sheet on the `sheet` gate (`ui.botCardSeat`, the `botCard` command, `app/botCardViews.ts`, `LoadBoundary`); Hard/Expert cards say only "Style: unknown." until 7.1. **F.10:** the new words. The pod's personality badge already followed the level rule (`labelVisible`); it is now one function for the pod and the card |
| 1.3.41 | 9 Oct 2026 | Coach explanations (chunk 5.6: `brain/explain.ts`, `i18n/en.ts` templates and glossary, `i18n/coach.ts`, `scripts/check-copy.ts` + `copy-rules.ts`, CI `check` step). **Appendix F.1:** CALL_PROFITABLE says "{E}% is more than {need}%" (with the % signs); new "Variants, hint lines and rules": consistency variants (`.close`, `.realise`, `.implied`), VALUE_BET without an example (high card) and against several players under 50%, SEMI_BLUFF on the turn, PUSH_FOLD when the verdict is fold, RANGE_ADJUST `.weaker` and `.plain`, FALLBACK, singular forms ("1 player acts", "1 big blind"), the headline, numbers line and `{alt}` texts, the main-reason, `{E}`/range-number, `{actionDescription}` (before the flop by rank, not by ⅔ pot), "Why not …?" and rule-of-2-and-4 rules (RULE_2_4_BIG on the flop only). **§8.10:** implementation notes, including RANGE_ADJUST also when `eRandom` would contradict a price sentence the range number supports (the unrounded-`need` gap of the rule). **§17.5, §0.1:** `check-copy` runs in the `check` job; layout lists `copy-rules.ts` and `i18n/coach.ts`. `tsconfig.node.json` adds the `vite/client` types: `check-copy` imports the engine reducer, which reads `import.meta.env?.DEV`. |
| 1.3.42 | 9 Oct 2026 | Coach strip and sheet, Beginner and Intermediate (chunk 5.9: `app/coachJobs.ts`, `app/coachViews.ts`, `brain/hintStandIn.ts`, `ui/coach.ts`, `ui/coachText.ts`, `ui/coachAdvice.ts`, `ui/coachModule.ts`, `ui/glossary.ts`, `ui/components/CoachStrip.tsx`, `CoachSheet.tsx`, `GlossaryText.tsx`, `i18n/coachUi.ts`; the number may move when the Stage 5 rows are merged). **§12.6** implementation notes: the hint of each hero decision in the `coach` slice, the stand-in hint until 5.7, the strip per level (RANGE_ADJUST as the labelled pair, pitfall 35), compact pill, landscape rows, wide panel, the sheet over everything but the action bar, the lazy chunk, the text seam with 5.6's `Explanation`. **§12.7:** the ring never on a disabled button; the coach chip only while the recommendation is visible (before "Hint" it would give the hint away), a preset with the coach's amount is ringed instead of a sixth chip; landscape: five chips fit the column (6 px gaps) and a taller tray scrolls inside, so Row A never leaves a 390 px screen. **§12.3:** long hand names smaller, the label clamped (compact: two lines and one), so it never runs into the coach strip. **§13.4, §15.3, pitfall 31:** a face-up card is one DOM node (the sprite's suit paths as CSS masks): nine players on a wide screen with the rankings column peak at 449 nodes instead of 595 (jsdom); with the coach panel 481, in portrait with the sheet open 308. **§15.3:** the coach's strip, sheet and words are one lazy chunk (24.6 kB raw); Initial JS 140.25 kB (134.51 before; gate 150). **§0.3 Strings:** `i18n/coachUi.ts`. **A.8:** `CoachSlice`, `showHint`, `retryCoach`. **F.10:** the words the coach adds. |
| 1.3.43 | 9 Oct 2026 | CI `check` job runs the web unit suite once (branch `ci/faster-check-job`). §17.5: the plain `npm test` step and the coverage step used to run the same tests twice (on the runner the unit step took 194 to 336 s and the coverage step 211 to 429 s: 450 to 837 s for the whole job, against its 15 minutes). Now `npm run test:coverage` runs them once, under coverage and with the same thresholds; the volume and timing tests that the coverage run leaves out on purpose (`VOLUME_TESTS` in `apps/web/vitest.config.ts`) run in their own step (`npm run test:volume`, a third Vitest project, `--project volume`), and the server tests in theirs. `vitest list` shows 146 files in the coverage run and 8 in the volume run: the 154 files of the plain unit run, no overlap. The job's `timeout-minutes` is 25. |
| 1.3.44 | 9 Oct 2026 | The wide coach panel gets a fixed row (branch `fix/wide-layout-coach-strip-overlap`). The Stage 3 acceptance-2 E2E test failed now and then at 1280×800 in both browsers (6–9 players: pods over the hero strip at the "first decision"). **Cause, a real layout bug:** chunk 5.9's inline coach panel had no room of its own; its row followed its content (nothing, a 61 px narration line, 240 px of advice), so the table box went 580 → 519 → 340 px and back during every hand (a layout shift, against §15.3), and the pods, placed in the measured box (`useElementSize`: a `ResizeObserver`, then a React render one task later), sat where the taller table had put them, over the hero strip, until that render (measured: pods at the 580 px geometry with the hero strip at y = 384; 150 ms later all clear). The test hit that window because it measured right after the deal, mostly during the bots' turn, while the coach's answer was still arriving. **§12.5, §12.6:** the panel's row has a fixed height, drawn empty when the coach has nothing to say, and it brings R14's cap: `max(61px, min(30dvh, 100dvh − 540px − safe areas))` (`wideCoachPanel()`). **§15.3:** the rows around the table keep their size. **R14:** done, except the inline sizing tray on a 1024×768 screen (open). **Tests:** `tests/e2e/layout.spec.ts` measures at the deal, at the hero's first decision once the coach has answered, and at the hand end, with the same overlap checks, and checks that the table box keeps one size through the hand and is the one `tableFrame()` computes; `seats.test.ts` adds 1280×720, 1366×600 and 900×560. Repeat runs at 1280×800 (`--repeat-each`), before: WebKit 6 of 40 failed, Chromium 0 of 80 (4 of 30 with a 6× CPU throttle); the new test fails every run against the old layout (10 of 10). After: the old test 0 of 100 and the new one 0 of 100 (half in each browser), each 0 of 30 in Chromium at 6×. |
| 1.3.45 | 9 Oct 2026 | Bot personalities, `decide()` and `hint()` (chunk 5.7: `brain/profiles.ts`, `brain/decide.ts`, `app/hintJobs.ts`; version number provisional, the Stage 5 branches are merged in order). Readings in the new §9.4 notes; §8.9 notes 9–12 (`E_called` against one caller; a hint's alternatives and confidence), §8.5 (a call that ends the betting: `R = 1`; no value raise that cannot be made), §9.8 (the think time's own stream), A.6 (the full profile, hint jobs, the hint cache). Risks R18 (multiway `p` and the meter) and R19 (bot calibration) opened. No golden spot changed; all 18 pass through `hint(obs, null)`. **5.6 and 5.9 joined:** the hint reply carries `explain()` of the advice; 5.9's `HintText` is filled from it (§12.6 *Text*), and its stand-ins (`brain/hintStandIn.ts`, `app/coachJobs.ts`, the templates and glossary of `i18n/coachUi.ts`) are gone; 5.6's templates and glossary moved from `i18n/en.ts` to `i18n/enCoach.ts`, in the coach's lazy chunk (§0.3, §15.3; initial JS 141.6 KB). §0.1 layout, §0.3, §8.10, §12.6 and Appendix F say so. |
| 1.3.46 | 10 Oct 2026 | The strength meter agrees with the advice (branch `fix/strength-meter-consistency`; risk R18 closed). **§8.2 `p`:** `n·E / (1 + (n − 1)·E)`, the odds of beating one average opponent (Bradley–Terry–Luce), replaces `eRange^(1/nOpp)`: the same heads-up, 0.5 at the fair share (`perOpponentStrength` in `brain/features.ts`, read by `features()` and `withEquity`). **§8.10:** the meter never argues against the move: at most Decent next to a fold, at least Marginal next to a bet or raise unless its main reason is SEMI_BLUFF, CBET_DRY or PUSH_FOLD (`meterStrength`, `BLUFF_REASONS` in `brain/decide.ts`); pitfall 34 says so too. **Appendix E:** E19–E22, multiway spots for what changed. Tests: `tests/brain/meter.test.ts` (the rule; the reported Q♠3♠ fold next to "Strong" and the 6% "Decent" as regressions), the meter property in the 2,000-hint `hint.property.test.ts`, the formula's identities in `features.test.ts`; two synthetic multiway specs got new numbers to keep their buckets (`allInCall.test.ts`, `postflopPolicy.test.ts`). The advice changes only after the flop in multiway pots (R18 row) |
| 1.3.47 | 10 Oct 2026 | Headless self-play and the bot calibration (chunk 5.11: `scripts/selfplay.ts`, `selfplay-jobs.ts`, `selfplay-worker.ts`, the baselines `scripts/bots/raiseAlways.ts`, `callAlways.ts`, `potBettor.ts`, `npm run selfplay`, a 500-hand smoke test, the weekly `selfplay` jobs; §0.1 layout, §17.5 `slow` row and the Testing strategy row say so). **§9.7:** the before/after table at Medium and Easy (20,000 hands, seed 1): 24 of 30 gates failed, now none; what changed and why, what was tried and dropped, decision times, legality (100,000 hands over 2–9 seats). The calibration (R19 closed): **§9.4 step 3** every bias is in units of the level's `T` (`A*` +1 after the flop, +3.5 before it; a call `3 × (stickiness − 1)`; bluff and slow-play +2.5, the old 0.30 pot at Medium); **§9.1** `aggressionBias = 2.1 × ln(AF / 2.5)` (was `× 0.1` in pots); **§9.4 step 2** limp mode also limps an open raise the softmax picks; **§9.2, §9.4 note 9** Easy reads a preflop raise's `V` from the opening table; **§9.1** looseness Rock 0.55 → 0.35, Station 2.0 → 3.4, Maniac 2.7 → 3.5, LAG `pfrRatio` 0.80 → 1.00, and `pfrRatio` defined as the share of opens that raise; `looseness` is no longer the §9.5 read `VPIP / 0.22`. The coach is unchanged (it takes `A*`): the golden spots E1–E22, C2–C7, the non-cheating test and the `COACH` profile test pass as they were. |
| 1.3.48 | 9 Oct 2026 | Decision grading (chunk 6.1: `brain/grade.ts`; `brain.worker` answers `grade` jobs; version number provisional, the Stage 5 and 6 branches merge in order). No rule or number of §8.9 changed; readings in the new **§8.9 implementation notes**: the Close spot is the hint's (the close alternative is Best like the recommendation; any other move rated above the recommendation is exactly Good, in a Close spot too); the loss is reported for every grade; the price signal's `R` is the call's as the EV model values it (1 when the call ends the betting); leak tags only for Inaccuracy or worse, `pushfold` only where §8.4 applies (before the flop); the F.5 rows' exact conditions ("Folded a strong preflop hand" = the top 50%; no price row before anyone raised; the heads-up Air row only when checking was possible); `GradeResult.trace` = the recommendation's reasons. **§8.11:** a grade reads the cached hint of its observation whatever HUD number the hint job brought; measured times (acceptance 6). **A.5:** `GradeResult.feedback` (as chunk 6.2 wrote it). **A.6, §2.2:** the grade job and `brainService`'s `coach` option. |
| 1.3.49 | 10 Oct 2026 | Mistake feedback and Undo (chunk 6.2, stacked on 6.1; version number provisional: the Stage 5 and 6 branches merge in order). The controller's `grading` and `feedback` states, the undo snapshot, Undo with the stub always reshuffled, the practice flag, through a grade port (`app/grading.ts`) that 6.1's `grade()` answers in brain.worker: one grading flow. Readings in the new **§11.3 implementation notes** (Undo's meta is the current one with the record marked undone; the grade job's own timeout is 5 s; a decision's coach level is the one when the hero acts; Back and Esc on the card mean Keep my move; after a reload a missing grade is asked again and the card does not come back; `hintSeen` from 5.9's `showHint`; where the toolbar Undo sits beside 5.9's coach strip, landscape rows and wide panel; the `?script=` hook scripts the bots only, the coach stays brain.worker; the E2E table `?seed=46&script=river-min-bet`). **§12.6:** the strip's Undo slot holds the toolbar Undo. **A.5:** `GradeResult.feedback` carries the F.5 reason as a 5.6 line (`feedbackLine(row)`); the feedback card is a lazy chunk (§15.3). **A.7:** `DecisionRecord.eRandom` may be null (no HUD estimate yet). **A.8:** the game slice's `canUndo`, `feedback`, `decisions`; the `undo` and `keepMove` commands; the `undone` toast; `ControllerOptions.grader`. |
| 1.3.50 | 9 Oct 2026 | Review from memory (chunk 6.3; version number provisional, the branches are merged in order). `engine/replay.ts` gets `replayStates` (§4.7). The controller keeps the last 100 finished hands in the store (`review` slice, `app/review.ts`); `app/reviewViews.ts` builds Review's frames from them with the Table's own view builders, so hidden cards never enter a frame; the screen (`ui/screens/Review.tsx`) is lazy and precached, the builder stays in the main chunk (**§12.10 implementation notes**: a separate `import()` for the builder splits shared chunks and costs more initial JS than it saves). **§0.3:** the Review words live in the lazy `i18n/review.ts`. **§12.9:** until grading exists (chunk 6.1) the hand-end banner is the summary and gets a "Review this hand" link; the sheet with per-decision rows comes with 6.1/6.4. **§12.9 banner placement:** with the link the banner is 112 px or more, and on the 340 px tall wide table "above the pot" put its top under the top bar (z-index 10 over its 8) and out of the viewport. Now the banner never goes above the table box: when it does not fit under the board it sits at the foot of the table, just above the hero's cards, and grows upward (a max height keeps it in the box); on wide screens the link shares the "Next hand ›" row (a card 22 px shorter). Phones are unchanged; `layout.spec.ts` checks nine players on phones and the wide screen in both browsers. **F.10** lists the Review words. Initial JS on this branch (rebased on 5.10): 141.2 KB gzip of the 150 KB gate, about +1.9 KB for 6.3 (the store slice, the controller hook, the banner link, the Menu item and the frame builder); the screen, its CSS (2.1 KB) and its words are lazy (4.4 KB JS) |
| 1.3.51 | 10 Oct 2026 | Advanced quiz, Exam and the full coach level matrix (chunk 6.4, stacked on 6.3; version number provisional, the branches are merged in order). **§10:** the per-decision latch: a hero decision's coach level is fixed when it starts (`game.coachLevel`, the level in force; `selectCoachLevel` falls back to the settings before the hero's first decision of a hand); a Beginner decision counts as helped through `meta.hintShown`; Setup and Settings offer all four coach levels (`AVAILABLE_LEVELS`). **§10.2:** the table as data (`app/levels.ts` `LEVEL_RULES`, `UNDO_POLICY` read from it) with implementation notes: Exam's "Hint (counts as help)", the badge hidden for the whole hand at Exam, tips at Beginner only, grade chips by level, the summary on hands with a hero decision. **§10.3:** implementation notes (`app/quiz.ts`, the roll with the hint job at Advanced only, never again after Undo; the badge hidden from the decision's start; Row A disabled with a reason while it asks; the score in `DecisionRecord.quiz`; seeded rate 24.4% of eligible decisions). **§11.3 notes:** the pause and Undo follow the decision's latched level; the toolbar Undo follows the level in force; the grade chip exists now. **§12.6:** grade chips (1.5 s, late grades too, in the coach's place) and Exam's label. **§12.9:** the summary sheet (opened by the controller once per hand, `ControllerOptions.summaries`; the next hand waits for its "Next hand ›"; rows, Exam result and score). **§13.2:** "Which hand wins?" (`app/whichWins.ts`, lazy UI). **F.10:** the new words (the quiz's, the summary's and "Which hand wins?"'s are lazy `i18n` modules). **A.7, A.8:** `DecisionRecord.quiz` filled, `hintShown` also for Beginner decisions, `GameSlice.coachLevel`, `CoachSlice.quiz`, the `quizAnswer` and `quizSkip` commands, the new selectors. The E2E helpers tap the summary's "Next hand ›" at a hand end and Skip on a quiz. Sizes (§15.3): initial JS 147.6 KB gzip of the 150 KB gate (+about 2.9 KB for 6.4: the matrix, the latch, the quiz state and roll, the chip and summary hosts); CSS 19.4 KB of 20 KB (the four new parts share one lazy file); the quiz, the summary sheet and "Which hand wins?" are lazy chunks; the Table stays within 600 DOM nodes with the summary open |
| 1.3.54 | 10 Oct 2026 | Stage 6 end-to-end suite (chunk 6.5, stacked on 6.4; version number provisional, the branches are merged in order). **Testing strategy → Rules, §11.3 notes:** the dev/E2E-only hooks gain `window.__pc.faults` (`app/testFaults.ts`, stripped from production with its own marker, tested by the bundle test): a layer between the brain client and its worker that holds a reply back (`delay`), answers a job with an `error` (`fail`), sets bots' think time (`think`) or kills the worker (`kill`); `tests/e2e/grading.spec.ts` proves Stage 6 acceptance 4 with the real brain.worker (a late grade never blocks the hand and Undo waits for it; a grade that errors twice or is silent for 5 s records `grade: null`; the worker killed once or twice still finishes the hand). **§10.2, §10.3 notes:** `tests/e2e/levels.spec.ts` (acceptance 5): the matrix level by level, with the expected page written out from the table, and the quiz rate in a real game (20 to 22 of 80 to 95 eligible decisions, seeded, a statistical band) with the badge and price chip hidden while it asks. **§12.14 fix:** [Try again] now recreates a worker that has failed for good (`HintJobs.retry()` starts the brain client again first); before, the tap did nothing (found by the kill-twice test; unit test first). **§8.11, §17.5, R17:** Stage 6 acceptance 6 measured in the browser (`tests/e2e/perf.spec.ts`: cached EVs 1–3 ms, an exact-size EV 1–2 ms, against 50 and 150 ms) and **report-only in CI** with the Stage 4 checks, enforced by `npm run e2e:perf`; the weekly `perf` job runs `--grep "Stage [46]"`. The scripted-table helpers of `undo.spec.ts` moved to `tests/e2e/scripted.ts`. **Runtime (§17.5, the 20-minute job):** the new specs take 131 s of test time, 64 s at four workers on the dev Mac: the grading faults run at one phone size per browser, the level matrix at one phone and one desktop size per browser, the quiz rate at one desktop size per browser, the grading time in the Chromium perf project. |
| 1.3.55 | 10 Oct 2026 | Hard and Expert bots (chunk 7.1, branch `feature/hard-expert-bot-profiles`; version number provisional, Stage 7 merges after Stage 6). **§9.5 notes 1–5:** the controller keeps the seat statistics by `playerId`, updated at hand end, saved in the session and sent in every observation (until now every seat was `null`), the hero's entry being the hero model, in memory until Stage 8; the Expert exploits (`brain/exploits.ts`; active at n ≥ 30 of the hero's own counters, read as `x / n`; where each applies); the balanced river bluffs of Hard and Expert (`brain/bluffs.ts`, `publicRange` in `brain/ranges.ts`; `balancedBluffs` in `LevelParams`, `BrainProfile` and A.5); the decision times (Expert p95 7.6 ms, budget 150). **§9.3, F.10:** the Hard/Expert bot card says what the player has seen ("Plays 34% of hands · Raises 20% · Bets often", "Hands seen: {n}", or "You have not seen them play yet."). **§10:** `AVAILABLE_LEVELS` offers Hard and Expert. **§8.7 note:** `texture+exploit`. The coach's advice reads the seat statistics it always asked for (`reweight+stats`), so from a table's second hand it uses them; golden spots E1–E22 (null statistics), the C2–C7 properties and `check-copy` pass unchanged (C8 needs Stage 6's grading). Risk R20 opened: Hard and Expert play far looser than their §9.1 targets (7.3 calibrates). Tests: `tests/brain/exploits.test.ts` (Stage 7 acceptance 3, n ≥ 30), `decide.hardExpert.property.test.ts` (§9.6 non-cheating for the 10 Hard/Expert profiles with random seat statistics, 1,000 runs; acceptance 4 with the Easy/Medium and coach tests), the Expert p95 in `decide.benchmark.test.ts` (acceptance 5), `tests/app/controller.stats.test.ts`, the bot card's tests. |
| 1.3.56 | 10 Oct 2026 | Per-seat bot levels (chunk 7.2, branch `feature/per-seat-bot-levels`, stacked on 7.1; version number provisional, rows are renumbered at merge). **§9.3:** the level picker of the per-seat override on the bot card and Setup's "More options" ("Set each bot's level", bot speed, four-colour cards); new implementation notes 1–6, the readings where the text was open: a pick lives in `Settings.seatLevels` like the table level lives in `Settings.botLevel`, so it is saved with the settings, survives a restart and is also a last-used value; the table follows it when the next hand is dealt (`nextLevels`, `withLevels`) and the hand in play keeps the table it was dealt from; "tap a seat between hands" now reads "tap a seat" (the card also opens mid-hand; a pick always starts with the next hand); settings made for another seat count are not applied to the table; the card shows the picker's value from the settings and everything else from the hand. **§10, §12.2:** "the table's own per-seat overrides stay" (5.10) now means the settings' overrides, which Setup, the card and Settings all write; More options is built as the item 5 list says. **§14.4:** a hand records its levels through its table (`botLevel` and `seatLevels` in force, per seat); the by-level buckets and `recentHands` count a hand only when no bot dealt in plays at another level than the table's (Stage 8 reducers). **A.7, A.8, F.10:** `Settings.seatLevels` comment, the `seatLevel` command and `TableSetup`, the new words. Code: `app/botLevels.ts` (`levelsOf`, `nextLevels`, `sameSeatLevels`), with `seatLevelOf` and `labelVisible` where the pods have always had them, in `tableViews.ts`: one rule for the pods, the card, the brain's observation and the controller. `BotCardData.nextLevel`, `ui/screens/Controls.tsx` (the Settings chips and switch, shared), `MoreOptions.tsx` (lazy), and the bot card's picker uses the Settings chip classes of `Screen.module.css`. Sizes (§15.3): initial JS 149.9 KB gzip of the 150 KB gate (+1.0 KB for 7.2), CSS 19.9 KB of 20 KB (+0.5 KB); the card's picker and the panel are lazy chunks. The first version put the bot-level rules in `app/levels.ts` next to the coach matrix, which broke both budgets (initial JS 153.4 KB, CSS 21.3 KB): see pitfall 47. Tests: `controller.seatLevels.test.ts`, `levels.test.ts`, `table.test.ts` (`withLevels`), the card, Setup, Settings and Table component tests, one Playwright spec. **Also:** the type of `riverSpot` in `tests/brain/exploits.test.ts` accepts any bot level (the 7.1 test called it with Easy and Medium, which failed the typecheck; the same change as on `test/hard-expert-self-play`). |

---

## Appendix A - TypeScript types

Field names are normative; add fields only by updating this appendix. Put each block in the file named in its heading.

### A.1 Core (`src/core/*.ts`)

```ts
export type Card = number;          // 0..51 = rank * 4 + suit
export type Rank = number;          // 0..12 = 2..A
export type Suit = 0 | 1 | 2 | 3;   // clubs, diamonds, hearts, spades
export type Seed128 = string;       // 32 lowercase hex characters
export const ZERO_SEED: Seed128 = '00000000000000000000000000000000';

export interface Rng { next(): number }                        // uint32
export function rngFromSeed(seed: Seed128): Rng;               // sfc32, 16 outputs discarded
export function deriveSeed(parent: Seed128, label: string, ...ints: number[]): Seed128;
export function randInt(rng: Rng, n: number): number;          // unbiased, 0..n-1
export function shuffleRange<T>(arr: T[], lo: number, hi: number, rng: Rng): void; // Card[] for decks
export function fnv1a32(s: string): number;                    // Appendix C.4 reference ports,
export function splitmix32(a: number): () => number;           //   exported for the golden tests
export function sfc32(a: number, b: number, c: number, d: number): () => number;
export function isSeed128(s: unknown): s is Seed128;
export function seedWords(seed: Seed128): [number, number, number, number]; // big-endian words
export function seedFromWords(w0: number, w1: number, w2: number, w3: number): Seed128;
export function randomSeed(): Seed128;                         // crypto.getRandomValues (§2.4)
export const rankOf = (c: Card): Rank => c >> 2;
export const suitOf = (c: Card): Suit => (c & 3) as Suit;
export const makeCard = (rank: Rank, suit: Suit): Card => rank * 4 + suit;
export function isCard(c: unknown): c is Card;
export function newDeck(): Card[];                             // [0..51], a fresh array
export function parseCard(s: string): Card;                    // "Ah" → 50; "10h" also accepted
export function formatCard(c: Card): string;                   // 50 → "Ah"
export function parseCards(s: string): Card[];                 // "Ah Kd" → [50, 45]
export function formatCards(cards: readonly Card[]): string;   // [50, 45] → "Ah Kd"
export function rankLabel(r: Rank): string;                    // card face: "2".."10", "J", "Q", "K", "A"; never "T"
export function cardAriaLabel(c: Card): string;                // "Ace of hearts"
export function classOf(a: Card, b: Card): number;             // 0..168 (§7.5 grid)
export function className(idx: number): string;                // "AKs", "T9o", "77"
export const RANK_CHARS = '23456789TJQKA', SUIT_CHARS = 'cdhs'; // text form
export const RANK_NAMES: readonly string[];                    // "Two".."Ace" (F.2; §0.3 Strings)
export const RANK_PLURALS: readonly string[];                  // "Twos".."Aces"
export const SUIT_NAMES: readonly string[];                    // "clubs", "diamonds", "hearts", "spades"

// core/assert.ts: invariant(cond, message) throws InvariantError([message]); EngineError and
// InvariantError (A.3) are defined here and re-exported by engine/types.ts.
export function invariant(condition: unknown, message: string): asserts condition;
```

### A.2 Evaluator (`src/eval/*.ts`)

```ts
export type HandCategory =
  | 'highCard' | 'pair' | 'twoPair' | 'trips' | 'straight'
  | 'flush' | 'fullHouse' | 'quads' | 'straightFlush' | 'royalFlush';

export function score7(cards: ArrayLike<Card>, n: number): number;   // n = 5, 6 or 7; §5.2
export function score6(cards: ArrayLike<Card>): number;               // score7(cards, 6)
export function score5(cards: ArrayLike<Card>): number;               // score7(cards, 5)
export function categoryOf(score: number): HandCategory;
export const HAND_CATEGORIES: readonly HandCategory[];               // weakest first; index = display category (royal = 9)
export function scoreNibbles(score: number): [number, number, number, number, number]; // n0..n4
// eval/tables.ts: MASK_COUNT (8,192), POPCOUNT (Uint8Array), STRAIGHT_HIGH (Int8Array, −1 = none),
// TOP5 (Int32Array, the top five ranks as left-aligned nibbles)

export interface HandInfo {
  score: number;                // 0 preflop
  category: HandCategory;
  name: string;                 // Appendix F.2
  subLabel: string | null;      // §6.1 (null preflop); nuts suffix added by the UI from HandAnalysis
  preflopClass: string | null;  // "AKs" preflop, else null
  best5: Card[];                // [] preflop
  core: Card[];                 // cards forming the category
  kickers: Card[];              // best5 minus core
  holeUsed: 0 | 1 | 2;
  playsTheBoard: boolean;       // §5.4
}
export function describe(hole: [Card, Card], board: Card[]): HandInfo; // board of 0, 3, 4 or 5 cards
export const HAND_TEXT: { ... };  // eval/describe.ts: the F.2 names and F.3 sub-labels (§0.3 Strings)
```

### A.3 Engine (`src/engine/types.ts`)

```ts
export type Street = 'preflop' | 'flop' | 'turn' | 'river';
export type Phase = 'betting' | 'roundComplete' | 'showdown' | 'complete';
export type BotLevel = 'easy' | 'medium' | 'hard' | 'expert';
export type CoachLevel = 'beginner' | 'intermediate' | 'advanced' | 'exam';
export type PersonalityId = 'rock' | 'tag' | 'lag' | 'station' | 'maniac';
export const STREETS: readonly Street[];            // the unions above as lists, in order (validation)
export const PHASES: readonly Phase[]; export const BOT_LEVELS: readonly BotLevel[];
export const COACH_LEVELS: readonly CoachLevel[]; export const PERSONALITY_IDS: readonly PersonalityId[];
export const ENGINE_VERSION: string;                // = apps/web/package.json "version" (a test keeps them equal)

export type PlayerAction =
  | { type: 'fold' } | { type: 'check' } | { type: 'call' }
  | { type: 'bet'; to: number } | { type: 'raise'; to: number };      // "to" = street total

export type EngineInput =
  | { kind: 'act'; seat: number; action: PlayerAction }
  | { kind: 'advance' }
  | { kind: 'reshuffle'; decisionId: number; undoIndex: number };

export interface TableConfig {
  seatCount: number;                       // 2..9
  sb: number; bb: number;                  // bb even, 2..100,000; sb = bb / 2
  startingStack: number;                   // 200..1,000,000 and 10..500 bb (§3.2)
  botLevel: BotLevel;
  seatLevels: (BotLevel | null)[];         // per-seat override, index = seat; null = table level; [0] always null
}
export interface PlayerSlot {
  playerId: string;                        // "hero" or "bot-7" ('bot-' + nameCursor: unique for the table's life)
  name: string; kind: 'hero' | 'bot';
  personality: PersonalityId | null;       // null for hero
  stack: number;                           // chips between hands
}
export interface TableState {
  schema: 1; engineVersion: string; tableId: string; tableSeed: Seed128;
  config: TableConfig;
  slots: PlayerSlot[];                     // index = seat; hero is seat 0
  button: number;                          // last hand's button; -1 before the first hand (startHand moves it, §3.3)
  prevBB: number | null;                   // last hand's BB, for the 3→2 rule; null before the first hand
  nextHandSeq: number;                     // the next hand's handSeq, ≥ 1; global, see §14.3 "handSeq rule"
  handsDealt: number;                      // hands finished at this table (nextTable adds 1); the top bar shows "Hand {handsDealt + 1}"
  personalityCursor: number; nameCursor: number; reloads: number;   // cursors only grow (§9.3)
}
export interface SeatState {
  dealtIn: boolean; stack: number;
  hole: [Card, Card] | null;               // [first card dealt, second card dealt]; null when not dealt in
  folded: boolean;                         // false for a seat not dealt in
  allIn: boolean;                          // I7, also after refunds and settlement
  streetBet: number; totalBet: number;     // after uncalled refunds; settlement leaves them as they are
  lastActedAtBet: number | null;
}
export type LogEvent =                     // posts are the first two events: SB, then BB
  | { e: 'post'; seat: number; blind: 'sb' | 'bb'; amount: number; allIn: boolean }   // amount = min(blind, stack)
  | { e: 'act'; seat: number; street: Street; action: PlayerAction; amountIn: number; allIn: boolean; full: boolean }
  | { e: 'refund'; seat: number; amount: number }
  | { e: 'street'; street: Street; cards: Card[] }                   // the cards this street adds
  | { e: 'reveal'; seats: number[]; reason: 'runout' | 'showdown' }  // at most one per hand
  | { e: 'reshuffle'; decisionId: number; undoIndex: number }
  | { e: 'award'; pot: number; seats: number[]; amounts: number[] }; // pot = index into result.pots; seats = its winners
export interface Pot { amount: number; eligible: number[] }
export interface HandResult {
  endedBy: 'fold' | 'showdown';
  pots: Pot[]; potWinners: number[][];
  payouts: number[];                       // per seat, gross
  net: number[];                           // per seat, payout − totalBet
  shown: { seat: number; score: number; category: HandCategory; best5: Card[] }[];
}
export interface HandState {
  schema: 1; engineVersion: string; handSeq: number; seed: Seed128;
  sb: number; bb: number;
  seats: SeatState[]; button: number; sbSeat: number; bbSeat: number;
  street: Street; phase: Phase; board: Card[];
  deck: Card[]; deckPos: number;           // permutation of 0..51; deckPos = 2k, 2k+4, 2k+6, 2k+8 by street (§3.4)
  currentBet: number; minRaiseInc: number;
  lastAggressor: number | null; preflopAggressor: number | null;
  toAct: number | null; runout: boolean;
  revealed: number[];                      // seats whose hole cards are public
  undoneDecisions: number[];
  startTotal: number; startStacks: number[];   // stacks before the blinds (0 = not dealt in); startTotal = Σ
  log: LogEvent[]; result: HandResult | null;
}
export interface LegalActions {
  seat: number; toCall: number; callAmount: number; callIsAllIn: boolean;
  canFold: boolean; canCheck: boolean; canCall: boolean;
  bet: { min: number; max: number } | null;      // "to" amounts
  raise: { min: number; max: number } | null;    // "to" amounts
}
export class EngineError extends Error { code: 'NOT_YOUR_TURN' | 'ILLEGAL_ACTION' | 'BAD_AMOUNT' | 'BAD_PHASE' | 'UNDO_USED' }  // both defined in core/assert.ts,
export class InvariantError extends Error { broken: string[] }                                                              //   re-exported here
export interface ReplayRecord { engineVersion: string; seed: Seed128; commit: string | null; table: TableState; inputs: EngineInput[] }
```

### A.4 Observation (`src/engine/types.ts`, built only by `observe.ts`)

```ts
export interface PublicAction {
  seat: number; street: Street;
  type: 'postSB' | 'postBB' | 'fold' | 'check' | 'call' | 'bet' | 'raise';
  to: number | null; amountIn: number; allIn: boolean; full: boolean; potBefore: number;
}
export interface SeatStats {                 // x = times done, n = opportunities
  hands: number;
  vpip: [number, number]; pfr: [number, number]; threeBet: [number, number];
  foldTo3bet: [number, number]; cbet: [number, number]; foldToCbet: [number, number];
  wtsd: [number, number]; aggActions: number; passiveActions: number;   // AF = agg / passive
}
export interface ObserveExtras {
  seatStats: (SeatStats | null)[];
  visiblePersonality: (PersonalityId | null)[];   // non-null only for seats at Easy/Medium
  seatLevels: BotLevel[];                          // effective level per seat (public: shown at setup)
}
export interface Observation {
  seat: number; hole: [Card, Card]; board: Card[]; street: Street; handSeq: number;
  sb: number; bb: number; button: number; sbSeat: number; bbSeat: number;
  pot: number;                              // Σ totalBet
  legal: LegalActions;
  stacks: number[]; streetBets: number[]; totalBets: number[];
  dealtIn: boolean[]; folded: boolean[]; allIn: boolean[];
  history: PublicAction[];
  revealedHoles: ([Card, Card] | null)[];   // only seats in h.revealed
  seatStats: (SeatStats | null)[]; visiblePersonality: (PersonalityId | null)[]; seatLevels: BotLevel[];
}
export function observationKey(o: Observation): string;   // canonical JSON, fixed key order
```

### A.5 Analysis and brain (`src/analysis/types.ts`, `src/brain/types.ts`)

```ts
export type DrawKind = 'flush' | 'nutFlush' | 'oesd' | 'doubleGutshot' | 'gutshot' | 'overcards' | 'backdoorFlush' | 'backdoorStraight';
export type RiskRule = 'R1' | 'R2' | 'R3' | 'R4' | 'R5';
export interface OutCard { card: Card; makes: HandCategory; risky: RiskRule[] }
export interface HandAnalysis {                    // equity.worker 'handInfo' result
  draws: { kind: DrawKind; outs: number }[];
  outs: OutCard[];                                 // union, grouped in UI by `makes`
  nextCardPct: number | null; byRiverPct: number | null;
  chances: Record<HandCategory, { exactly: number; atLeast: number; boardShared: boolean }> | null;
  beaters: { count: number; total: number } | null; nuts: boolean;
}
export interface EquityResult { n: number; win: number; split: number; equity: number; exact: boolean; final: boolean; truncated: boolean }
// analysis/handinfo.ts (§6.2–6.5): findOuts(hole, board): OutCard[]; findDraws(hole, board): HandAnalysis['draws'];
// countBeaters(hole, board): HandAnalysis['beaters']; analyzeHand(hole, board): Pick<HandAnalysis, 'draws' | 'outs' | 'beaters' | 'nuts'>.
// Outs and draws exist on the flop and turn only; beaters from the flop. The handInfo job adds the §6.6 part (chances.ts).

export interface BrainProfile {             // named BrainProfile so it never collides with the persisted Profile (A.7)
  id: string;                               // "tag/hard" or "coach"
  looseness: number; pfrRatio: number; aggressionBias: number;
  bluffFreq: number; bluff3betFreq: number; stickiness: number; slowplayFreq: number;
  equityNoiseSD: number; mcTrials: number;
  rangeModel: 'random' | 'static' | 'reweight' | 'reweight+stats';
  positionAwareness: 0 | 0.5 | 1;
  sizing: 'half' | 'two' | 'texture' | 'texture+exploit';
  temperature: number; defenseFactor: number; preflopJitter: number;
  balancedBluffs: boolean;                  // Hard, Expert: river bluffs balanced by size (§9.2, §9.5 notes)
  exploit: boolean; deterministic: boolean; neverLimp: boolean;
}
export function profileFor(p: PersonalityId, level: BotLevel): BrainProfile;   // §9.1 × §9.2, brain/profiles.ts
// COACH = the 'tag' row of §9.1 with: id 'coach', equityNoiseSD 0, mcTrials 4000 (eRange, §8.2), rangeModel 'reweight+stats',
// positionAwareness 1, sizing 'texture', temperature 0 (argmax), defenseFactor 1, preflopJitter 0, bluffFreq 0, bluff3betFreq 0,
// slowplayFreq 0, balancedBluffs false, exploit false, deterministic true, neverLimp true. The coach bets without value only via the §8.5 semi-bluff/c-bet rules.
export const COACH: BrainProfile;
export type Bucket = 'monster' | 'strong' | 'medium' | 'draw' | 'air';
export type Texture = 'dry' | 'wet' | 'veryWet';
export type CandidateKey = 'fold' | 'check' | 'call' | `bet:${number}` | `raise:${number}` | 'allin';
export type ReasonCode =
  | 'OPEN_RANGE' | 'FOLD_RANGE' | 'ISOLATE' | 'CHECK_FREE' | 'THREE_BET_VALUE' | 'FOUR_BET_VALUE'
  | 'CALL_PREFLOP' | 'FOLD_VS_RAISE' | 'SET_MINING' | 'CALL_PROFITABLE' | 'FOLD_PRICE' | 'IMPLIED'
  | 'VALUE_BET' | 'VALUE_RAISE' | 'RAISE_PROTECT' | 'THIN_VALUE' | 'POT_CONTROL' | 'SEMI_BLUFF' | 'CBET_DRY'
  | 'CHECK_WEAK' | 'PUSH_FOLD' | 'CALL_ALLIN' | 'FOLD_ALLIN' | 'COMMITTED' | 'NUTS' | 'BOARD_PLAYS'
  | 'RANGE_ADJUST' | 'WHY_NOT_FOLD' | 'WHY_NOT_CHECK' | 'WHY_NOT_CALL' | 'WHY_NOT_BET' | 'WHY_NOT_RAISE'
  | 'CLOSE_SPOT' | 'GUARDRAIL' | 'RULE_2_4' | 'RULE_2_4_BIG';
export interface Reason { code: ReasonCode; data: Record<string, number | string> }
export interface Decision {
  action: PlayerAction;                     // always legal
  kind: 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin';
  ev: Partial<Record<CandidateKey, number>>;   // chips vs folding
  eRandom: number; eRange: number; need: number;
  bucket: Bucket | null;                    // null preflop
  strength: 'weak' | 'marginal' | 'decent' | 'strong' | 'monster';
  confidence: 'clear' | 'normal' | 'close'; alt: PlayerAction | null;
  trace: Reason[];
}
export type Grade = 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';
export type LeakId = 'open-loose' | 'open-tight' | 'limp' | 'call-pre-wide' | 'fold-pre-much' | 'pushfold'
  | 'missed-value' | 'bluff-much' | 'overfold' | 'chase' | 'river-call' | 'call-light' | 'sizing';
export interface GradeResult {
  decisionId: number; grade: Grade; rec: PlayerAction; taken: PlayerAction;
  lossChips: number; lossPot: number; lossMilliBB: number;   // lossMilliBB integer
  leak: LeakId | null; trace: Reason[];
  feedback: Line | null;                    // chunk 6.2: the F.5 row grade() picks, as feedbackLine(row) (5.6's Line, plain data);
}                                           //   null for Best/Good and when no row fits (the card says the fallback row)
export function decide(obs: Observation, profile: BrainProfile, seed: Seed128): Decision;
export function hint(obs: Observation, eRandom: number | null): Decision;        // COACH profile, seed from observationKey
export function grade(obs: Observation, taken: PlayerAction, eRandom: number | null, decisionId: number): GradeResult;
```

### A.6 Worker protocol (`src/workers/protocol.ts`)

```ts
export type EquityRequest =
  | { kind: 'equity'; jobId: number; epoch: number; hero: [Card, Card]; board: Card[]; nOpp: number }
  | { kind: 'equityKnown'; jobId: number; epoch: number; hands: [Card, Card][]; board: Card[] }
  | { kind: 'handInfo'; jobId: number; epoch: number; hero: [Card, Card]; board: Card[] }
  | { kind: 'bench'; jobId: number }
  | { kind: 'cancel'; jobId: number };
export interface JobTiming { ms: number; busyMs: number }  // ms since the worker took the request; busyMs of it computing (any job)
export interface EquityBenchResult { evalsPerSec: number; eq8PreflopMs: number; eq8FlopMs: number; eq1FlopMs: number; ua: string }
export type EquityReply =
  | { kind: 'equity'; jobId: number; epoch: number; result: EquityResult; timing?: JobTiming }  // several; last has final: true
  | { kind: 'equityKnown'; jobId: number; epoch: number; perPlayer: number[]; exact: boolean; final: boolean; timing?: JobTiming }
  | { kind: 'handInfo'; jobId: number; epoch: number; analysis: HandAnalysis; timing?: JobTiming }
  | { kind: 'bench'; jobId: number; result: EquityBenchResult }
  | { kind: 'error'; jobId: number; epoch: number; message: string };

export type BrainRequest =
  | { kind: 'botDecision'; jobId: number; epoch: number; obs: Observation; profile: BrainProfile; seed: Seed128 }   // profileFor(personality, level)
  | { kind: 'hint'; jobId: number; epoch: number; obs: Observation; eRandom: number | null }
  | { kind: 'grade'; jobId: number; epoch: number; obs: Observation; taken: PlayerAction; eRandom: number | null; decisionId: number }
  | { kind: 'bench'; jobId: number }
  | { kind: 'cancel'; jobId: number };
export type BrainReply =
  | { kind: 'botDecision'; jobId: number; epoch: number; decision: Decision; thinkMs: number }
  | { kind: 'hint'; jobId: number; epoch: number; decision: Decision }
  | { kind: 'grade'; jobId: number; epoch: number; result: GradeResult }
  | { kind: 'bench'; jobId: number; result: { hintP50Ms: number; hintP95Ms: number } }
  | { kind: 'error'; jobId: number; epoch: number; message: string };
```

The main thread drops any reply whose `epoch` is not current or whose `jobId` is not the latest for its kind (per seat for `botDecision`). Timeouts: equity 4,000 ms (above the worker's own 3 s `truncated` cap, so a truncated reply still lands); bot decision 2,000 ms (then the safest legal action + a diagnostic); grade 1,500 ms (continue without pause; the reply is still accepted later, §11.3 rule 5; chunk 6.2: the job's own timeout is 5,000 ms, then one retry, slot `grade`, `app/grading.ts`). The Monte Carlo seed text (§7.3) writes hero cards sorted by `Card` value descending and the board in deal order.

Client rules (chunk 4.5, `app/workerClient.ts`): every job has a slot, its kind ('equity', 'handInfo', 'known'; later 'bot:{seat}'); a new job cancels the one in its slot. A reply is delivered only when it comes from the current worker, for a pending job of the current epoch that is the newest of its slot, with the job's epoch and kind (or `error`); an `error` reply is always the last one. `cancel` and `cancelAll` post `{ kind: 'cancel' }` and forget the job at once. A timeout cancels the job. "Two consecutive timeouts" (§12.14) means two jobs of one worker in a row that timed out with no final reply in between. A restart fails the pending jobs; after the second failure the client is `failed` and sends nothing (`retry()` is the brain's [Try again]). The job timeouts run on the controller's timers (§0.3). Chunk 4.7: the log keeps a card-free summary of each request (`detail`, "board 3 · 5 opponents") and each reply's `timing` (the §15.3 worker timing logs, read through `window.__pc.logs().equity` in test builds); the all-in board job has its own slot, `allIn` (§7.4); `bench` answers once with `EquityBenchResult` (§15.4), or `error` (epoch 0) when the measurements fail.

Brain client (chunk 5.8, `app/workerClient.ts` + the controller): every bot decision is a job in the slot `bot:<seat>` with `timeoutMs` 2,000 (the first one of a session 3,000, §12.14) and the controller's epoch; the client owns the timeout, the cancel and the restart, the controller reacts to the outcome. A `timeout`, a `failed` job (the worker crashed with the decision pending) or a refused request (the client has `failed`: no worker could be started twice) all give the bot the safest legal action (check if free, else fold, §4.5) after `botWaitMs(0)`, counted in `diag.botFallbacks`, so the hand always finishes. The decision is not re-asked on the new worker. `ControllerLogs.brainWorker` is the client's message log (`window.__pc.logs()`), like `equity`. Chunk 5.7: `botDecision.profile` is the seat's full `profileFor(personality, level)` (built on the main thread from the §9.1/§9.2 tables only, so no brain data joins the main bundle). Hint jobs (`app/hintJobs.ts`): at every hero decision (the controller's `hints` option, on in the app) one job in the slot `hint` with the controller's epoch and a 4,000 ms timeout, carrying the hero's observation and the HUD's final win chance when the equity slice already has it for this situation, else null (§8.2); the answer goes to the `coach` slice under the decision's key (`handSeq:log.length`); the hero's action and a new epoch cancel a job in flight and drop its late answer; a timeout, an `error` reply or a failed client mark the decision `failed`. `brainService` caches hints by `observationKey` and `eRandom` (LRU of 32, §8.11), so an undo or a retry answers at once. Chunk 6.1: a `grade` job is answered from the same cache (`coachAnswer`: the hint and the grade of any move from one deliberation), by observation whatever HUD number the hint job brought (§8.9 notes, §8.11); the reply's `result.decisionId` is the request's, and an illegal move answers `error`.

### A.7 Persistence (`src/persist/schema.ts`)

```ts
export interface Settings {
  schema: 1;
  botLevel: BotLevel; coachLevel: CoachLevel;
  players: number; startingStack: number; sb: number; bb: number;
  seatLevels: (BotLevel | null)[];                     // one per seat (= players), [0] null; the table follows them from the next hand (§9.3)
  speed: 'normal' | 'fast' | 'instant'; autoNext: boolean; amounts: 'chips' | 'bb'; showEquity: boolean;
  fourColour: boolean; textSize: 'normal' | 'large'; reduceMotion: 'system' | 'on' | 'off';
  keepAwake: boolean; sound: boolean; haptics: boolean;
  handsPanel: 'open' | 'collapsed';                    // wide-screen rankings column (§13.1); default 'open'
}
export interface DecisionRecord {
  decisionId: number; street: Street; taken: PlayerAction; rec: PlayerAction;
  grade: Grade | null;                                 // null = grading failed twice (§11.3 r5); excluded from every decision metric
  lossMilliBB: number; eRandom: number | null;        // null: no HUD estimate yet when the hero acted (chunk 6.2)
  need: number | null;
  hintSeen: boolean; undone: boolean; leak: LeakId | null;
  quiz: { correct: number; of: number } | null;        // chunk 6.4: the Advanced quiz (§10.3) over the questions answered
}                                                      //   (all, or those before Skip); null: none, or none answered
export interface HandRecord {
  handSeq: number; at: string;                         // ISO UTC
  seed: Seed128; commit: string | null; engineVersion: string;
  table: TableState;                                   // as at hand start
  inputs: EngineInput[];                               // full replay log
  heroHole: [Card, Card]; board: Card[]; net: number[]; heroNetMilliBB: number;
  decisions: DecisionRecord[];
  assisted: boolean; undoCount: number;
  botLevel: BotLevel; coachLevel: CoachLevel;
  bestCategory: HandCategory | null;                   // hero's final category if they saw the river or showdown
  allIn: { expected: number; actual: number; pot: number } | null;
}
export interface ResultBucket {
  hands: number; handsWon: number; netChips: number; netMilliBB: number;
  vpipHands: number; pfrHands: number; sawFlop: number; wentToShowdown: number; wonAtShowdown: number;
  biggestPotWon: number; allInExpectedChips: number; allInActualChips: number;
}
export interface DecisionBucket {
  decisions: number; byGrade: Record<Grade, number>; lossMilliBB: number;
  own: number; ownBestOrGood: number; hintSeen: number; hintFollowed: number;
  undone: number; quizAsked: number; quizCorrect: number;
}
export interface SessionSummary {
  start: string; end: string; hands: number; netChips: number; decisionScore: number | null;
  mistakes: number; blunders: number; decisions: number; botLevel: BotLevel; coachLevel: CoachLevel; players: number; bb: number;
}
export interface Stats {
  schema: 1; firstPlayedAt: string | null; lastPlayedAt: string | null; sessions: number; reloads: number;
  results: { clean: ResultBucket; practice: ResultBucket; byBotLevel: Record<BotLevel, ResultBucket> };
  decisions: { all: DecisionBucket; byCoachLevel: Record<CoachLevel, DecisionBucket>;
               byStreet: Record<Street, DecisionBucket> };
  leaks: Partial<Record<LeakId, { count: number; lossMilliBB: number }>>;
  collection: Record<HandCategory, { count: number; first: string | null }>;
  streak: { current: number; best: number };
  recentSessions: SessionSummary[];                    // ring, 60
  currentSession: SessionSummary | null;               // updated inside applyHand (atomic with the commit); moved to recentSessions when the session ends
  recentHands: RecentHand[];                           // ring, 500 (~25 KB); feeds the §10.4 level suggestions
}
export interface RecentHand {
  botLevel: BotLevel; coachLevel: CoachLevel; assisted: boolean; netMilliBB: number;
  scorePoints: number; graded: number;                 // Σ decision-score points (§14.4) and count of graded decisions in the hand
}
export interface Profile {
  schema: 1; rev: number; lastCommittedHandSeq: number;
  createdAt: string; updatedAt: string;
  settings: Settings; stats: Stats; heroModel: SeatStats;
  persistGranted: boolean | null;
  flags: { tips: Record<string, boolean>; iosInstall: boolean; safariImport: boolean; offlineReady: boolean;
           suggestionSnoozedUntil: Record<'botsUp' | 'botsDown' | 'coachDown', string | null> };
}
export interface HandMeta {
  decisions: DecisionRecord[]; undoCount: number;
  hintShown: Record<number, boolean>;                  // by decisionId: the hint was opened, or on show (a Beginner decision, chunk 6.4)
}
export interface SessionState {
  schema: 1; savedAt: string; sessionStart: string;
  table: TableState;                                   // as at the start of `hand`: its stacks are the hand-start stacks (§14.5)
  hand: HandState | null;
  handInputs: EngineInput[];
  meta: HandMeta;
  undoSnapshot: { decisionId: number; state: HandState; meta: HandMeta; inputCount: number } | null;  // inputCount = handInputs.length at the snapshot
  seatStats: (SeatStats | null)[];                     // index = seat; [0] mirrors profile.heroModel; reset to null when a bot is replaced (§9.5)
  resumeAfterUpdate: boolean;
}
```

### A.8 Controller (`src/app/controller.ts`)

```ts
export type ControllerMode =
  | 'booting'        // profile read, workers starting (§12.14)
  | 'idle'           // no hand: between hands, bust dialog, or Table not open
  | 'botTurn' | 'heroTurn'
  | 'grading'        // ≤ 1,500 ms after a hero act (§11.3 r5)
  | 'feedback'       // mistake card open
  | 'advancing'      // animation pause before an `advance`
  | 'handEnd';       // banner / summary; then commit (§14.3) and next hand
export type Gate = 'hidden' | 'offTable' | 'menu' | 'sheet' | 'dialog' | 'feedback' | 'quiz' | 'tip';
// Bots, think timers and `advance` wait while ANY gate is closed. 'offTable' = any screen other than Table.
// 'sheet' = any modal overlay: rankings drawer, coach sheet, bot card, sizing tray is NOT a gate.
// The wide-screen rankings column and inline coach panel are not overlays and never close a gate.
// ControllerMode and Gate are defined in app/store.ts (its slices use them) and re-exported here.
export class TableController { dispatch(cmd: GameCommand): void; boot(): void; snapshot(): ControllerSnapshot; logs(): ControllerLogs; dispose(): void }
export const TIMING; SPEED_FACTOR; HERO; botSeed(tableSeed, handSeq, seat, logLength); safestAction(legal);

// src/app/store.ts: the only `app` module the UI imports at run time (§2.1)
// Navigation: the Nav of app/navigation.ts is the one model (screens stack + overlays); the store applies its
// NavActions. Overlay = menu | outOfChips | newTable | rankings | coach | botCard | summary | tray | feedback | quiz | tip.
export const OVERLAY_GATE: Record<Overlay, Gate | null>;  // menu → 'menu'; outOfChips, newTable → 'dialog';
  // rankings, coach, botCard, summary → 'sheet'; tray → null; feedback, quiz, tip → their own gate
export interface AppState { game: GameSlice; equity: EquitySlice; coach: CoachSlice; ui: UiSlice; settings: Settings /* A.7 */;
  dispatch(cmd: Command): void }                          // stable; UI commands apply in the store, game commands go to the controller
export interface GameSlice { mode: ControllerMode; table: TableState | null /* as at hand start */; hand: HandState | null;
  next: TableState | null /* between hands: after nextTable, top-ups */; legal: LegalActions | null /* hero's turn only */;
  heroBust: boolean; diag: { engineErrors: number; botFallbacks: number; voidedHands: number };
  canUndo: boolean /* §11.3 r2, r5, the decision's level */; feedback: FeedbackView | null /* the open feedback card */;
  decisions: readonly DecisionRecord[] /* this hand's, undone ones included (chips and summary, 6.4) */;
  coachLevel: CoachLevel | null /* chunk 6.4: the level in force, fixed when a hero decision starts (§10); null before
    the hero's first decision of the hand: the settings' (selectCoachLevel) */ }
export interface UiSlice { nav: Nav; screen: Screen /* derived */; overlays: readonly Overlay[] /* derived */; hidden: boolean;
  holds: { gate: Gate; owner: string }[]; gates: Gate[] /* closed ones, derived */; layout: 'portrait' | 'landscape' | 'wide';
  toasts: ({ id: number; kind: 'botsJoined'; names: string[] } | { id: number; kind: 'handVoided' | 'handNotRestored' | 'dataRecovered' | 'undone' })[];
  storageBanner: boolean }                                // §12.11 "Stats can't be saved…", once per launch
export type UiCommand = NavAction /* go | replace | back | open | close */ | { type: 'gate'; gate; closed; owner? }
  | { type: 'layout'; layout } | { type: 'dismissToast'; id } | { type: 'dismissStorageBanner' };
export type GameCommand = { type: 'play' } | { type: 'newTable'; setup?; confirmed? } | { type: 'act'; action: PlayerAction }
  | { type: 'nextHand' } | { type: 'reload' } | { type: 'topUp' } | { type: 'leaveTable' } | { type: 'changeTable' }
  | { type: 'settings'; patch } | { type: 'visibility'; hidden } | { type: 'pagehide' }
  | { type: 'undo' } | { type: 'keepMove' }               // chunk 6.2: Undo (toolbar, card, U key); the card's Keep my move (also Esc, Back)
  | { type: 'seatLevel'; seat; level };                 // chunk 7.2: a bot's own level (null = the table's); kept in settings.seatLevels, the table follows from the next hand (§9.3)
// newTable with a hand unfinished opens the newTable dialog (§3.1) and keeps setup; its Yes sends confirmed: true.
// Setup (chunk 7.2): `setup` is TableSetup = players, startingStack, sb, bb, botLevel, coachLevel, seatLevels, speed, fourColour.
export function useAppStore<T>(selector: (s: AppState) => T): T;          // one value; never without a selector (pitfall 37)
export function useAppStoreShallow<T>(selector: (s: AppState) => T): T;   // several values (useShallow)
export function useOverlay(overlay: Overlay): [open: boolean, setOpen: (open: boolean) => void];  // e.g. the rankings drawer
// View models (app/tableViews.ts, re-exported; memoized; the ui/views.ts shapes, since app may not import ui):
// selectSeatViews (SeatView[], seat i + 1 at index i; an unchanged pod keeps its object), selectBoardView (CardView[]),
// selectPotView, selectHeroHandView (HeroHandView), selectHeroView (the hero strip, describe() label and highlights),
// selectActionBarInput (actionBarView()'s input), selectTableInfo (blinds, hand number, opponents for tableGeometry()),
// selectHandEnd (the §12.9 banner), selectSessionLine (Home's line). A bot's hole cards are { kind: 'hidden' } (no values)
// until its seat is in hand.revealed.
// Storage (chunk 3.2): boot reads the profile (Welcome if none, else Home) and the session (resume exactly; a hand that
// fails its checks is voided, chips back, toast). The session is saved after every step (table as at hand start, savedAt
// now) and becomes { table: next, hand: null } at hand end; settings are saved 250 ms after a change and at once on hidden,
// pagehide and a new table; seatLevels.length === players always.
// Back (§12.1, app/lifecycle.ts): one guard history entry while historyDepth(nav) > 0; `popstate` → { type: 'back' }.
// Equity (chunk 4.5): ControllerOptions.equity is equity.worker's client (boot starts it); logs().equity is its message log.
// Grading (chunk 6.2): ControllerOptions.grader is the grade port (app/grading.ts; boot passes brainGrader(brain)); snapshot() adds
// meta, undoSnapshot and assisted; selectUndoButton = 'hidden' | 'disabled' | 'enabled' (UNDO_POLICY of the current level).
export type EquityStatus = 'off' | 'folded' | 'computing' | 'done' | 'timedOut' | 'unavailable';
  // off: no badge · folded: "Folded" · computing: skeleton, or "~NN%" once `result` exists · done: "NN%" ("~" when truncated)
  // · timedOut: last value with "~", or "—" · unavailable: "—", "Win chance is not available right now" (§7.6, §12.14)
export interface EquitySlice { status: EquityStatus; mode: 'random' | 'known';
  situation: { handSeq: number; hero: [Card, Card]; board: Card[]; nOpp: number } | null;  // what `result` is for
  result: EquityResult | null;                              // progress, then the final; null until the first estimate
  previous: { equity: number; nOpp: number; board: Card[] } | null;   // last final of this hand (big-move line)
  analysis: HandAnalysis | null;                            // handInfo for the current cards; null while computing and when folded
  known: { handSeq: number; seats: number[]; board: Card[]; perPlayer: number[]; exact: boolean; final: boolean } | null;
  allIn: KnownEquity | null }  // chunk 4.7: `known`'s shape, for the board when the hands turned face up (the luck line, §7.6)
// Selectors: selectEquity, selectEquityStatus, selectEquityResult, selectHandAnalysis.
// Chunk 5.9 (§12.6): written by CoachJobs (key, status, decision) and the `showHint` command (opened) only.
export interface CoachSlice { key: string | null /* coachKeyOf(hand): `${handSeq}:${log.length}` */;
  status: 'idle' | 'ready' | 'failed'; decision: Decision | null; opened: string | null /* the key whose hint was opened */;
  quiz: { key: string; answers: readonly number[]; skipped: boolean } | null /* chunk 6.4: the Advanced quiz of decision `key` */ }
// Commands: `showHint`, `quizAnswer { choice }`, `quizSkip` (store-level), `retryCoach` (game). Selectors: selectCoach,
// selectNarration, selectCoachLevel (the level in force), selectQuiz, selectQuizAsking, selectGradeChip (chunk 6.4).
// ControllerOptions.summaries (chunk 6.4): open the end-of-hand summary when the level shows one (the app; tests opt in).
```

---

## Appendix B - Rules edge-case test vectors

Blinds 50/100 and stacks 10,000 unless stated. Amounts are "to" (street totals) unless stated. Each vector is a unit test that builds the state with `createTable` + `startHand` (seeded or with a fixed deck when cards matter), applies the inputs, asserts the expected fields, and runs `checkInvariants` after every step.

| # | Setup | Inputs | Expected |
|---|---|---|---|
| 1 | Heads-up, A = BTN/SB, B = BB | — | A posted 50, B posted 100; `toAct = A`; B received the first hole card |
| 2 | 4 players, BTN A, SB B, BB C, UTG D | D call, A call, B call | `toAct = C`; legal check, raise min 200; C checks → `roundComplete` |
| 3 | Heads-up | A (BTN/SB) call | `toAct = B`, legal check/raise; B check → `roundComplete`; `advance` → flop, `toAct = B` |
| 4 | Preflop, facing 100 | — then raise to 300 | min raise-to 200; after the raise to 300, next min raise-to 500 |
| 5 | Flop, first to act | bet 150 | min bet 100; after 150, min raise-to 300 |
| 6 | 4 players: UTG A, BTN B (stack 450), SB C, BB D | A raise 300, B all-in 450, C call 450, D fold | Back at A: fold or call 150 only; `raise == null` (450 − 300 = 150 < 200) |
| 7 | As 6, stopped before D acts | — | D (BB, no voluntary action yet) may raise; min raise-to 650 |
| 8 | Flop; A, B (150), C (220), D in order | A bet 100, B all-in 150, C all-in 220, D call 220 | A may raise (220 − 100 = 120 ≥ 100); min raise-to 320 |
| 9 | Flop; A, B (200), C in order | A bet 100, B all-in 200, C call 200 | Full raise (inc 100 = `minRaiseInc`); A may re-raise, min to 300 |
| 10 | B has exactly 300, faces a bet of 300 | B call | B `allIn`; `currentBet` unchanged; not a raise |
| 11 | River, heads-up | A bet 400, B fold | 400 refunded to A; `roundComplete`; `advance` → `complete`, `endedBy: 'fold'`, `shown = []` |
| 12 | 3+ players, all fold to BB | folds | BB refunded 50; BB wins 100; net BB +50, SB −50 |
| 13 | Flop, heads-up, B has 200 | A bet 500, B call (all-in 200) | 300 refunded to A at round end; run-out, no more `betting` phases |
| 14 | Preflop, totals A 100, B 300, C 600 (all-in or called) | — | C refunded 300; main 300 (A, B, C); side 400 (B, C) |
| 15 | A folded after 200; B all-in 150; C 500 | — | C refunded 300; main 450 (B, C); side 100 (C only, awarded without comparing hands) |
| 16 | As 14, A best hand, B second best | showdown | A wins 300; B wins 400; C wins 0 |
| 17 | 301-chip pot, 2 winners | showdown | First winner clockwise from the seat left of the button gets 151, the other 150 |
| 18 | 100-chip pot, 3 winners | showdown | 34 / 33 / 33, the 34 to the first winner clockwise from the seat left of the button (a winning button comes last) |
| 19 | Board A♠ K♦ Q♣ J♥ 10♠; 2♣3♦ vs 4♥5♠ | showdown | Split; both `playsTheBoard` |
| 20 | Board A-7-7-3-2 rainbow; A♣K♦ vs A♦Q♣ | showdown | A♣K♦ wins (Two Pair, Aces and Sevens, King kicker) |
| 21 | Wheel vs 6-high straight; 5-high SF vs 6-high SF; Q-K-A-2-3 | evaluate | Wheel loses to 2-6; 5-high SF loses to 6-high SF; Q-K-A-2-3 is not a straight |
| 22 | 9♠9♦ on 8♣8♥7♦7♠K♣ and on 8♣8♥7♦7♠2♣ | evaluate | 99-88-K; 99-88 with a 7 kicker |
| 23 | 7♠7♦ on 7♣ K♥ K♦ K♠ 2♣ | evaluate | Full House, Kings full of Sevens |
| 24 | 4♥7♥ on 3♥ 5♥ 6♥ K♥ 2♥; A♥2♥ on K♥ Q♥ 9♥ 5♥ 3♥ | evaluate | Straight Flush, Seven-high; Flush A-K-Q-9-5 (top five of the suit) |
| 25 | 3 players; BB has 60 | BTN fold, SB call | Before: `currentBet = 100`, min raise-to 200. SB puts in 100 total; round ends; SB refunded 40; 60 vs 60 run-out |
| 26 | SB has 30 | — | SB posts 30, `allIn` |
| 27 | Heads-up | A all-in, B call (preflop) | No `betting` phase follows; 5 board cards via `advance`; both in `revealed` at the first `advance` |
| 28 | 3 players, flop: A all-in, B call, C already all-in | — | No more betting; board runs out |
| 29 | River bet called vs river checked | showdown | Bettor shows first; checked river → first live seat left of the button shows first |
| 30 | Engine mode with `dealtIn = false` seats; button seat has 0 chips | `nextTable` + `startHand` | Button moves to the next dealt-in seat |
| 31 | Engine mode: 3 → 2 players, previous BB alive | `startHand` | Previous BB gets the button/SB |
| 32 | `toCall == 0` | fold | `EngineError('ILLEGAL_ACTION')`, state unchanged |
| 33 | Any undo snapshot | restore (controller) | Deep-equal to the snapshot before the `reshuffle` input |
| 34 | SB posts 50; BB all-in for 30; others fold | SB fold | SB refunded 20; BB wins 60; net BB +30, SB −30 |
| 35 | 3 players; two opponents all-in | — | The remaining player's `bet` and `raise` are `null` |
| 36 | Heads-up, SB stack 40, BB stack 80 | `startHand` | `roundComplete` at once; BB refunded 40; 40 vs 40 run-out |
| 37 | Flop, 3 players in order C, A, B; A has 40 | C check, A bet 40 (all-in) | Legal although < bb; B's min raise-to = 140; back at C: fold or call 40 only, `raise == null` (C already acted, 40 < a full bet) |
| 38 | B has 250, faces a bet of 200 (streetBet 0) | — | `raise = { min: 250, max: 250 }` (all-in only) |
| 39 | A fold leaves one live seat | fold | `roundComplete`, `result == null`, no cards revealed until `advance` |
| 40 | `betting` at a hero decision | reshuffle(d, 0) | Only `deck[deckPos..51]` changes (as a permutation); hole cards and board unchanged; `undoneDecisions` contains d; a second reshuffle with d throws `UNDO_USED`; reshuffle in `showdown` throws `BAD_PHASE` |
| 41 | 1,000 random states | JSON round trip | Deep-equal |
| 42 | Recorded 6-player hand with a side pot | `replay` | Identical final state and stacks |
| 43 | All-in run-out with one folded seat | `advance` | All live seats in `revealed`; the folded seat never |
| 44 | Main pot split 3 ways (remainder 1) and side pot split 2 ways (remainder 1) | showdown | Each pot's odd chip goes independently to its first winner clockwise from the seat left of the button |

---

## Appendix C - Evaluator, equity and RNG oracles

### C.1 Exhaustive 7-card category counts (all C(52,7) = 133,784,560 hands)

| High card | Pair | Two pair | Three of a kind | Straight | Flush | Full house | Four of a kind | Straight flush (not royal) | Royal flush |
|---|---|---|---|---|---|---|---|---|---|
| 23,294,460 | 58,627,800 | 31,433,400 | 6,461,620 | 6,180,020 | 4,047,644 | 3,473,184 | 224,848 | 37,260 | 4,324 |

Score category 8 therefore totals 41,584. Random 7-card rarity (panel column): Royal 0.0032%, SF 0.0279%, Quads 0.168%, FH 2.60%, Flush 3.03%, Straight 4.62%, Trips 4.83%, 2P 23.5%, Pair 43.8%, HC 17.4%.

### C.2 Heads-up preflop, exact over all boards

| Matchup | Win / tie / lose (%) | Equity (%) |
|---|---|---|
| A♠A♥ vs K♠K♥ | 82.36 / 0.54 / 17.09 | 82.64 |
| A♠A♥ vs K♣K♦ | 81.06 / 0.38 / 18.55 | 81.26 |
| AA vs KK, all suit combinations (CardFight) | 81.71 / 0.46 / 17.82 | 81.95 |
| 2♣2♦ vs A♠K♥ | 52.75 / 0.58 / 46.67 | 53.04 |
| 22 vs AKo, all suit combinations (CardFight) | 52.34 / 0.62 / 47.04 | 52.65 |
| Q♥Q♦ vs A♠K♠ | 53.59 / 0.39 / 46.02 | 53.79 |
| Q♣Q♦ vs A♠K♥ | 56.99 / 0.34 / 42.66 | 57.16 |
| A♠K♥ vs A♦Q♣ | 71.72 / 4.59 / 23.69 | 74.02 |
| A♥K♥ vs J♠T♠ | 61.02 / 0.48 / 38.50 | 61.26 |
| 7♣2♦ vs A♠A♥ | 12.40 / 0.36 / 87.24 | 12.58 |

### C.3 Multiway and postflop

| 3-way, exact (1,370,754 boards) | Equities (%) |
|---|---|
| A♠A♥ / K♠K♥ / Q♠Q♥ | 67.67 / 17.23 / 15.10 |
| A♣K♦ / Q♠Q♥ / J♦T♣ | 39.25 / 47.19 / 13.56 |

| Postflop vs 1 random hand, exact | Equity (%) |
|---|---|
| A♥K♥ on Q♥7♥2♣ | 72.68 (win 72.32, tie 0.72) |
| A♥K♥ on Q♥7♥2♣3♦ | 59.73 |
| A♥K♥ on Q♥7♥2♣3♦5♠ | 36.41 |
| 9♠8♠ on 7♦6♣2♥ | 49.50 |

Equity vs N random hands, preflop (Monte Carlo, 2M trials per cell, ±0.07%; test tolerance ±0.5; also checks the committed preflop table):

| Hand \ opponents | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|
| A♠A♥ | 85.24 | 73.48 | 63.90 | 55.86 | 49.24 | 43.60 | 38.70 | 34.63 |
| K♥K♦ | 82.35 | 68.84 | 58.19 | 49.76 | 42.97 | 37.46 | 32.83 | 29.17 |
| A♠K♥ | 65.32 | 48.26 | 38.55 | 32.30 | 27.87 | 24.37 | 21.58 | 19.23 |
| 2♣2♦ | 50.28 | 30.63 | 21.91 | 17.72 | 15.49 | 14.15 | 13.20 | 12.51 |
| 7♣2♦ | 34.58 | 20.46 | 14.25 | 10.76 | 8.61 | 7.20 | 6.17 | 5.39 |

A♥K♥ vs 1 random hand: 67.04 (Monte Carlo, 1M trials).

### C.4 Randomness golden values (pin the exact implementation)

Reference implementation (port verbatim to TypeScript). These values were re-computed and confirmed with this exact code on 23 September 2026.

```js
function fnv1a32(s){let h=0x811c9dc5;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,0x01000193)>>>0;}return h>>>0;}
function splitmix32(a){return function(){a|=0;a=(a+0x9e3779b9)|0;let t=a^(a>>>16);t=Math.imul(t,0x21f0aaad);t=t^(t>>>15);t=Math.imul(t,0x735a2d97);return ((t=t^(t>>>15))>>>0);};}
function sfc32(a,b,c,d){return function(){a>>>=0;b>>>=0;c>>>=0;d>>>=0;let t=(a+b)|0;a=b^(b>>>9);b=(c+(c<<3))|0;c=(c<<21)|(c>>>11);d=(d+1)|0;t=(t+d)|0;c=(c+t)|0;return t>>>0;};}
// seed words: the 32 hex chars read as four big-endian uint32 (chars 0–7, 8–15, 16–23, 24–31)
// deriveSeed(parent,label,...ints): h = fnv1a32(parent+'|'+label+'|'+ints.join(',')); g = splitmix32(h);
//   word[i] = (g() ^ parentWord[i]) >>> 0 for i = 0..3, formatted as 8 lowercase hex chars each
// rngFromSeed(seed): sfc32(word0..3), then discard 16 outputs
// deck: [0..51]; for i = 51 down to 1: j = randInt(rng, i + 1); swap(i, j)
```

| Input | Expected |
|---|---|
| `fnv1a32("abc")` | `1a47e90b` |
| `fnv1a32("")` | `811c9dc5` |
| `splitmix32(1)`, first 3 outputs | `5e2d1772 14e498f0 d20ea1fd` |
| `sfc32(1,2,3,4)`, first 3 raw outputs (no discard) | `00000008 00000023 0360006a` |
| `rngFromSeed("0123456789abcdef0123456789abcdef")`, first 3 outputs | `1699e12c c0fc4273 8d0e744a` |
| `deriveSeed("0123456789abcdef0123456789abcdef", "deck")` | `d49e95ccee49479bd11f9acb75374998` |
| `deriveSeed(same, "undo", 0, 0)` | `1870cd6895c6410193df02721c991b96` |
| `deriveSeed(same, "bot", 3, 12)` | `22524e3de439b97b9cd107383cf7264c` |
| Deck from `rngFromSeed(deriveSeed(same, "deck"))`, positions 0–11 | `6h Kc 6d Qh 8h 4h Td 2h 2d 3s Ah 3h` |
| Same deck, positions 48–51 | `4s 7h As 7c` |

### C.5 Outs → exact chance to hit (%)

| Outs | Flop → turn | Turn → river | Flop → river | Rule of 4 / 2 |
|---|---|---|---|---|
| 4 (gutshot) | 8.5 | 8.7 | 16.5 | 16 / 8 |
| 8 (OESD) | 17.0 | 17.4 | 31.5 | 32 / 16 |
| 9 (flush draw) | 19.1 | 19.6 | 35.0 | 36 / 18 |
| 12 | 25.5 | 26.1 | 45.0 | 48 / 24 |
| 15 (flush draw + OESD) | 31.9 | 32.6 | 54.1 | 60 / 30 |
| 21 | 44.7 | 45.7 | 69.9 | 84 / 42 |

---

## Appendix D - Hand-information vectors

### D.1 `describe` vectors (names, sub-labels, best five)

| Hole | Board | name | subLabel | best5 (order) | Notes |
|---|---|---|---|---|---|
| A♥ K♥ | Q♥ 7♥ 2♣ | Ace-high | — | A♥ K♥ Q♥ 7♥ 2♣ | highCard |
| A♠ K♦ | K♣ 7♥ 2♦ | Pair of Kings | Top pair, Ace kicker | K♦ K♣ A♠ 7♥ 2♦ | holeUsed 2 |
| Q♠ Q♦ | J♣ 7♥ 2♦ | Pair of Queens | Overpair | Q♠ Q♦ J♣ 7♥ 2♦ | |
| 5♠ 5♦ | K♣ Q♥ 9♦ | Pair of Fives | Pocket pair under the board | 5♠ 5♦ K♣ Q♥ 9♦ | |
| 7♠ 7♦ | 7♣ K♥ 2♦ | Three of a Kind, Sevens | A set: well hidden and strong | 7♠ 7♦ 7♣ K♥ 2♦ | |
| K♠ 7♦ | 7♣ 7♥ 2♦ | Three of a Kind, Sevens | Trips: others may share your card | 7♥ 7♦ 7♣ K♠ 2♦ | holeUsed 2 (K kicker) |
| K♣ K♦ | K♠ 7♥ 7♣ 2♦ 3♠ | Full House, Kings full of Sevens | Uses 2 of your cards | K♠ K♦ K♣ 7♥ 7♣ | core = all 5 |
| 9♠ 9♦ | 8♣ 8♥ 7♦ 7♠ K♣ | Two Pair, Nines and Eights | One pair is on the board | 9♠ 9♦ 8♥ 8♣ K♣ | kickers [K♣] |
| 9♠ 9♦ | 8♣ 8♥ 7♦ 7♠ 2♣ | Two Pair, Nines and Eights | One pair is on the board | 9♠ 9♦ 8♥ 8♣ 7♠ | kicker 7 from the third pair |
| A♠ 5♦ | K♣ K♥ 7♦ 7♠ 2♣ | Two Pair, Kings and Sevens | Both pairs are on the board: your kicker decides | K♥ K♣ 7♠ 7♦ A♠ | kickers [A♠], holeUsed 1 |
| A♠ K♦ | 7♣ 7♥ 7♦ 5♠ 2♣ | Three of a Kind, Sevens | The three are on the board: everyone has them | 7♥ 7♦ 7♣ A♠ K♦ | kickers [A♠ K♦] |
| 2♣ 3♦ | A♠ K♦ Q♣ J♥ 10♠ | Straight, Ace-high | The board plays: everyone shares this hand | A♠ K♦ Q♣ J♥ 10♠ | holeUsed 0, playsTheBoard |
| 10♣ 2♦ | A♠ K♦ Q♣ J♥ 10♠ | Straight, Ace-high | The board plays: everyone shares this hand | A♠ K♦ Q♣ J♥ 10♠ | holeUsed 0 although a hole 10 duplicates a board rank |
| 7♦ 2♣ | A♠ A♥ K♣ K♦ Q♠ | Two Pair, Aces and Kings | The board plays: everyone shares this hand | A♠ A♥ K♦ K♣ Q♠ | playsTheBoard |
| A♥ 2♣ | 3♦ 4♠ 5♥ K♣ Q♦ | Straight, Five-high | Uses 2 of your cards | 5♥ 4♠ 3♦ 2♣ A♥ | wheel |
| Q♠ K♦ | A♥ 2♣ 3♦ 9♠ 8♥ | Ace-high | — | A♥ K♦ Q♠ 9♠ 8♥ | Q-K-A-2-3 is not a straight |
| 4♥ 7♥ | 3♥ 5♥ 6♥ K♥ 2♥ | Straight Flush, Seven-high | Uses 2 of your cards | 7♥ 6♥ 5♥ 4♥ 3♥ | beats the flush in the same cards |
| A♥ 2♥ | K♥ Q♥ 9♥ 5♥ 3♥ | Flush, Ace-high | Uses 1 of your cards | A♥ K♥ Q♥ 9♥ 5♥ | top five of the suit; not the nuts (J♥10♥ makes a straight flush) |
| A♥ 5♥ | K♥ 9♥ 2♥ | Flush, Ace-high | Uses 2 of your cards · Best possible hand | A♥ K♥ 9♥ 5♥ 2♥ | `nuts: true` (0 beaters) |
| A♠ K♠ | Q♠ J♠ 10♠ 2♦ 3♣ | Royal Flush | Uses 2 of your cards · Best possible hand | A♠ K♠ Q♠ J♠ 10♠ | category royalFlush |
| 7♠ 7♦ | 7♣ K♥ K♦ K♠ 2♣ | Full House, Kings full of Sevens | Uses 2 of your cards | K♠ K♥ K♦ 7♠ 7♦ | two trips; pair taken from hole cards |
| Q♣ Q♦ | Q♥ Q♠ 7♦ 7♣ 2♠ | Four of a Kind, Queens | Uses 2 of your cards | Q♠ Q♥ Q♦ Q♣ 7♦ | kicker 7♦ (higher suit than 7♣) |
| K♠ 7♣ | — (preflop) | King-Seven offsuit | — | [] | category highCard |
| 9♥ 9♣ | — (preflop) | Pocket Nines | — | [] | category pair |

The " · Best possible hand" suffix in two rows is not part of `describe()`: the UI appends it from the hand analysis (`nuts`, §6.5), as A.2 says. `tests/eval/describe.test.ts` checks every other field of every row, including `core` = the leading category cards of `best5` and `kickers` = the rest.

~~**Open (found in Stage 1.3, not yet decided):** the order of cards *within one rank* in `best5` differs between rows.~~ **Closed 28 Sep 2026 (chunk 1.3, orchestrator decision):** row 6 (K♠ 7♦ on 7♣ 7♥ 2♦) previously listed the hole card first (7♦ 7♥ 7♣), which disagreed with rows 7 and 22 (higher suit first even ahead of hole cards: K♠ K♦ K♣; Q♠ Q♥ Q♦ Q♣) and with the code, which already lists every rank's cards by suit (s > h > d > c) regardless of which are hole cards — only the *selection* of which cards fill a rank prefers hole cards (§5.4). Row 6 is fixed to 7♥ 7♦ 7♣ K♠ 2♦ to match; the set of cards, name, sub-label, `core`, `kickers` and `holeUsed` were already correct. The test's `it.fails` on row 6's order is now a normal passing test (v1.3.12).

### D.2 Outs and risky outs (verified with the prototype evaluator)

| Hole | Board | Draw chips | Outs by category (risky rule) | Total |
|---|---|---|---|---|
| A♥ K♥ | Q♥ 7♥ 2♣ | Nut flush draw · Two overcards | Flush 9: 2♥ 3♥ 4♥ 5♥ 6♥ 8♥ 9♥ 10♥ J♥ (2♥ risky R2); Pair 6: A♣ A♦ A♠ K♣ K♦ K♠ (all R5) | 15 |
| 9♠ 8♠ | 7♦ 6♣ 2♥ | Open-ended straight draw · Two overcards | Straight 8: all 5s and 10s (none risky); Pair 6: 8♣ 8♦ 8♥ 9♣ 9♦ 9♥ (R3, R5) | 14 |
| 9♠ 8♠ | J♦ 7♣ 2♥ | Gutshot | Straight 4: all 10s (none risky); Pair 6 (R3, R5) | 10 |
| 9♥ 9♦ | K♠ 7♣ 2♦ | — | Trips 2: 9♣ 9♠ (none risky). Board-pairing cards are **not** outs | 2 |
| 7♠ 7♦ | K♣ 7♥ 2♦ | — | Full house 6: K♦ K♥ K♠ 2♣ 2♥ 2♠; Quads 1: 7♣ (none risky) | 7 |
| A♣ 2♣ | 3♦ 4♥ K♠ | Gutshot | Straight 4: all 5s (all R3: 6-7 or 2-6 makes a higher straight); Pair 6: 2♦ 2♥ 2♠ A♦ A♥ A♠ (R3, R5) | 10 |
| J♠ 10♠ | Q♠ 9♦ 2♠ | Flush draw · Open-ended straight draw | Flush 9: 3♠ 4♠ 5♠ 6♠ 7♠ 8♠ 9♠ K♠ A♠ (all R4; 9♠ also R2); Straight 6: 8♣ 8♦ 8♥ K♣ K♦ K♥ (none risky); Pair 6: J♣ J♦ J♥ 10♣ 10♦ 10♥ (R3, R5) | 21 |
| A♠ A♦ | 5♣ 6♦ 7♥ 8♠ (turn) | — | Trips 2: A♣ A♥ (both R3). A 4 or 9 makes a board straight: not an out | 2 |
| 9♣ 7♦ | J♠ 8♥ 5♣ | Double gutshot | Straight 8: all 6s (none risky) and all 10s (R3: Q-9 makes a higher straight); Pair 6 (R3, R5) | 14 |

### D.3 Chances by the river (exact, % finishing with exactly this category)

| Hand | Result |
|---|---|
| 2♣2♦ preflop | Pair 35.98, Two pair 39.67, Trips 11.77, Straight 1.22, Flush 1.96, Full house 8.55, Quads 0.84 |
| A♥K♥ preflop | High card 18.22, Pair 43.27, Two pair 22.14, Trips 4.34, Straight 3.09, Flush 6.53, Full house 2.22, Quads 0.13, Royal 0.05 |
| 9♠8♠ preflop | Straight 8.53, Flush 6.38, Straight flush 0.20 (other categories not listed) |
| A♥K♥ on Q♥7♥2♣ | Flush 34.88 + Royal 0.09 = 34.97 (the 9-out value) |
| 9♠8♠ on J♦7♣2♥ | Straight 17.95 (outs formula says 16.5; the difference is runner-runner straights) |
| J♠J♦ on J♥7♣2♥ | Full house 29.14, Quads 4.26 |

---

## Appendix E - Coach golden spots

Each spot is a unit test that builds an `Observation` directly (no engine), with labels visible or hidden as stated, and calls `hint(obs, null)`. Sizes are raise-to amounts in big blinds with ±0.5 bb tolerance unless a range is given. A spot may change only with a reason in the risk register.

| # | Spot | Expected |
|---|---|---|
| E1 | 6 players, 100 bb, hero first to act preflop (k = 5), A♠A♥, unopened | Raise to 2.5 bb (`OPEN_RANGE`) |
| E2 | 9 players, 100 bb, hero first to act (k = 8), 7♣2♦ | Fold (`FOLD_RANGE`) |
| E3 | 6 players, 100 bb, hero on the button (k = 2), K♠10♦, folded to hero | Raise to 2.5 bb |
| E4 | 3 players, hero BB, button folds, SB limps, hero 7♣2♦ | Check (`CHECK_FREE`); never fold |
| E5 | 9 players, 100 bb, folded to hero in the SB, 9♣4♦ | Fold (never complete) |
| E6 | 6 players, 100 bb, TAG opens 2.5 bb from the cutoff, hero on the button with 6♣6♦ | Call (`SET_MINING`) |
| E7 | 6 players, hero on the button (k = 2), effective 10 bb, unopened, A♣5♦ | All-in (`PUSH_FOLD`) |
| E8 | 6 players, 100 bb, UTG goes all-in, hero in the BB with A♥A♦ | Call |
| E9 | Heads-up flop, hero in position, A♥K♥ on Q♥7♥2♣, pot 6 bb, villain bets 2 bb, 95 bb behind | Call or raise; never fold |
| E10 | Heads-up flop, hero in position, J♠10♠ on Q♠9♦2♠, pot 6 bb, villain bets 3 bb | Call or raise; never fold |
| E11 | Heads-up flop, hero in position, 7♠7♦ on K♣7♥2♦ (Dry), hero called preflop, checked to hero, pot 6 bb, 97 bb behind | Bet 1/3 pot (2 bb) (`VALUE_BET`); no slow-play |
| E12 | Heads-up flop, 7♣2♦ on A♠K♠Q♠, checked to hero | Check; never fold |
| E13 | Heads-up turn, A♠K♦ on K♥8♣4♦2♠, pot 30 bb, 40 bb behind (SPR 1.3), villain all-in 40 bb | Call (`COMMITTED`) |
| E14 | Heads-up river, hero in position, A♥4♥ on K♥9♥2♣7♥3♠ (nut flush), pot 20 bb, 80 bb behind, checked to hero | Bet 12–20 bb (value, about 3/4 pot) |
| E15 | Heads-up river, A♠K♠ on Q♠J♠10♠4♦2♣ (royal flush), villain all-in | Call |
| E16 | Heads-up river, hero 5♥4♥ on A♠K♦9♣2♠J♦, pot 20 bb, Rock (label visible) bets 20 bb | Fold (`FOLD_PRICE`) |
| E17 | Heads-up river, board A♠K♦Q♣J♥9♠, hero 3♣2♦ (board plays), villain bets pot | Fold (`BOARD_PLAYS`) |
| E18 | 9 players, 8 bb effective, hero first to act (k = 8), 9♠4♣ | Fold (`PUSH_FOLD`) |
| E19 | 9 players, 100 bb, everyone limps (the big blind checks), flop 7♦7♥3♦ checked to the hero on the button with K♥10♥ (8 opponents, about 8%) | Check; never a value bet |
| E20 | 4 players, 100 bb, UTG raises to 2.5 bb, the button and both blinds call, flop K♠8♣3♥ checked to the hero on the button with 8♦7♠ (middle pair) | Check (`POT_CONTROL`) |
| E21 | 5 players limp (100 bb, the big blind 12 bb), flop Q♠J♥9♣, the small blind checks, the big blind goes all-in for 11 bb, hero UTG with A♦10♦ (straight draw), two players behind | Fold (`FOLD_ALLIN`); never a raise to "protect" a draw |
| E22 | 4 players limp, flop 8♠7♠2♣, the big blind bets 3 bb, UTG calls, hero on the button with 8♥8♦ (top set) | Raise (`NUTS`); strong hands still raise multiway |

Rendering checks on these spots: every text contains the HUD's `eRandom` as a whole number; E9, E13 and E16 show `RANGE_ADJUST` whenever the two equities differ by ≥ 5 points.

E19–E22 (multiway) came with the fair-share `p` (§8.2, risk R18). With the old `eRange^(1/nOpp)` the coach bet E19 (as "Strong") and E20 for value and raised over E21's all-in to protect its draw; E22 checks that the change keeps value raises with strong hands.

---

## Appendix F - UI copy, coach templates, glossary

Rules: sentences ≤ 15 words; whole-number percentages; no idioms; `{x}` = placeholder; `{g:term}` = glossary link. Chips shown with thousands separators; big blinds with one decimal only when needed ("2.5 BB").

### F.1 Coach reason templates

| Code | Template |
|---|---|
| OPEN_RANGE | "{hand} is in the top {rankPct}% of starting hands. {behind} players act after you. Play about the top {openPct}% here. Raise to {size}." |
| FOLD_RANGE | "{hand} is not strong enough here. {behind} players act after you. Folding saves chips." |
| ISOLATE | "Players only called. Raise to {size} to play against fewer players." |
| CHECK_FREE | "Checking costs nothing. Never fold when you can check." |
| THREE_BET_VALUE | "Your {hand} beats most hands that raise here (about {E}%). Re-raise to {size}." |
| FOUR_BET_VALUE | "Your {hand} is ahead of most re-raising hands. Raise again to {size}." |
| CALL_PREFLOP | "You win about {E}% against their likely hands. You need {need}%. Calling is fine." |
| FOLD_VS_RAISE | "They raised, so they likely have a good hand. {hand} wins only about {E}% against it." |
| SET_MINING | "Small {g:pocket pair}. Call to try for a {g:set}. You hit about 1 time in 8. Then you can win a big pot." |
| CALL_PROFITABLE | "You win about {E}%. You need {need}% to call {toCall} into {pot}. {E}% is more than {need}%, so calling wins over time." |
| FOLD_PRICE | "You need {need}% to call. You win only about {E}%. Folding saves chips." |
| IMPLIED | "The price alone needs {need}%. If you hit your {draw}, you can win more later. About {needImplied}% is enough." |
| VALUE_BET | "Your {handName} is probably best (about {E}%). Bet {size}. Worse hands like {example} can pay you." |
| VALUE_RAISE | "You likely have the best hand. Raise to {size} to win more." |
| RAISE_PROTECT | "Strong, but this board has many draws. Raise now so draws pay to continue." |
| THIN_VALUE | "Your {handName} is a bit better than their calling hands. A small bet of {size} wins more." |
| POT_CONTROL | "Medium hand ({handName}). Check. Better hands would call a bet. Worse hands would fold." |
| SEMI_BLUFF | "{draw}: {outs} {g:outs}. You hit about {hitNext}% next card and {hitRiver}% by the river. Betting can win now or later." |
| CBET_DRY | "You raised before the flop. This board likely missed them. A small bet of {size} often wins." |
| CHECK_WEAK | "You have little now. Check and see the next card for free." |
| PUSH_FOLD | "Only {S} {g:big blind}s left: go {g:all-in} or fold. They fold about {Pfold}%. If called, you still win about {E}%." |
| CALL_ALLIN | "You need {need}% to call. You win about {E}% against hands that go all-in here. Call." |
| FOLD_ALLIN | "You need {need}% to call. Against hands that go all-in here, you win only about {E}%. Fold." |
| COMMITTED | "The pot is big compared to your chips. With {handName}, folding gives up too much." |
| NUTS | "You have the best possible hand. Make the pot big." |
| BOARD_PLAYS | "Your cards don't help. The board is your hand, and everyone shares it." |
| RANGE_ADJUST | "Against any cards you win {eRandom}%. This player {actionDescription} only with good hands. Against those, you win about {eRange}%." |
| WHY_NOT_FOLD | "Why not fold? You win more often than you need to." |
| WHY_NOT_CHECK | "Why not check? Worse hands would get a free card." |
| WHY_NOT_CALL | "Why not call? You need {need}%, and you win about {E}%." |
| WHY_NOT_BET | "Why not bet? Better hands call, and worse hands fold." |
| WHY_NOT_RAISE | "Why not raise? Worse hands fold, and better hands call." |
| CLOSE_SPOT | "Close call: {alt} is also fine." |
| GUARDRAIL | "This decision is clear. {detail}" |
| RULE_2_4 | "Quick trick: outs × 2 ≈ % for the next card. Outs × 4 ≈ % by the river. Exact: {exact}%." |
| RULE_2_4_BIG | "The trick guesses too high for big draws." |

Placeholder values that are not plain numbers (the brain puts keys in `Reason.data`; `en.ts` maps them to words):
- `{E}`, `{need}`, `{eRandom}`, `{eRange}`, `{hitNext}`, `{hitRiver}`, `{exact}`, `{Pfold}`, `{rankPct}`, `{openPct}`: whole-number percentages.
- `{E}`: in codes whose sentence names the range (CALL_PREFLOP, FOLD_VS_RAISE, THREE_BET_VALUE, FOUR_BET_VALUE, CALL_ALLIN, FOLD_ALLIN, PUSH_FOLD) it is `eRange`. In every other code it is `eRandom`, unless the hint shows RANGE_ADJUST, which then comes first and labels `{E} = eRange` for the rest of the hint. The numbers line (§8.10 hint structure 3) always shows `eRandom`, so every hint contains the HUD number.
- `{pot}` in CALL_PROFITABLE and the numbers line = `winPot` (§0.3; equal to the pot unless the hero is short), so "call {toCall} into {pot}" always states the pot the hero can actually win.
- `{needImplied}` = `toCall / (winPot + toCall + implied)`. `{S}` = §8.4 `S`. `{behind}` = `k`. `{size}` = "{to} ({bb} BB)". `{hand}` = preflop name (F.2); `{handName}` = `describe().name`; `{draw}` = the largest draw's name from F.3, lower case.
- `{example}` (VALUE_BET), by the hero's category: pair → "smaller pairs"; two pair → "one pair"; trips → "one pair and two pair"; straight → "two pair and sets"; flush → "straights and sets"; full house or better → "flushes and straights".
- `{actionDescription}` (RANGE_ADJUST), from the villain's last voluntary action: bet or raise ≥ ⅔ pot → "bets big"; other bet → "bets"; raise → "raises"; re-raise → "re-raises"; all-in → "goes all-in"; call → "calls".
- `{detail}` (GUARDRAIL), by rule (§8.8): 1 "Checking is free." · 2 "Your hand is too strong to fold." · 3 "You almost never win here." · 4 always-call "The price is too good to fold." · 4 never-call "You win too rarely to call."
- `{alt}` = the alternative action's headline ("Fold", "Call 40", "Bet 120").

**Variants, hint lines and rules (chunk 5.6; code `brain/explain.ts`, text `i18n/enCoach.ts`, moved from `i18n/en.ts` by chunk 5.7).** The brain picks a template key and its values; `i18n/coach.ts` renders it. Variants exist only where the F.1 sentence would be false for the numbers it shows (§8.10: the coach never contradicts its own numbers) or ungrammatical:

| Key | Template | When |
|---|---|---|
| CALL_PROFITABLE.close | "You win about {E}%. You need {need}% to call {toCall} into {pot}. It is close, but calling is a little better." | the shown whole numbers are equal (or {E} is below {need}) |
| CALL_PREFLOP.close | "You win about {E}% against their likely hands. You need {need}%. It is close, but calling is a little better." | shown {E} below {need}, no implied odds |
| CALL_PREFLOP.implied | "You win about {E}% against their likely hands. You need {need}%. If you make a {g:set}, you can win a big pot." | shown {E} below {need}, a pocket pair's implied odds (`data.implied > 0`) |
| FOLD_PRICE.close | "You need {need}% to call. You win about {E}%. It is close, but folding is a little better." | shown {E} not below {need}, on the river or in position heads-up |
| FOLD_PRICE.realise | "You need {need}% to call. You win about {E}% if you see every card. Later bets can make you fold before that. Folding saves chips." | shown {E} not below {need} where R < 1 (flop or turn, out of position or multiway) |
| CALL_ALLIN.close / FOLD_ALLIN.close | the F.1 sentence with "It is close, but calling (folding) is a little better." for "Call." ("Fold.") | the comparison fails on whole numbers |
| VALUE_BET.noExample | "Your {handName} is probably best (about {E}%). Bet {size}." | high card (no `{example}`) |
| VALUE_BET.multiway (/.multiwayNoExample) | "Your {handName} is strong against {n} players (about {E}%). Bet {size}. Worse hands like {example} can pay you." | 2+ opponents and shown {E} under 50% ("probably best" would be false) |
| SEMI_BLUFF.turn | "{draw}: {outs} {g:outs}. You hit about {hitNext}% on the river. Betting can win now or later." | on the turn (next card = river) |
| PUSH_FOLD.fold | "Only {S} {g:big blind}s left: go {g:all-in} or fold. They fold only about {Pfold}%. If called, you win only about {E}%." | the push/fold verdict is fold (F.1's sentence argues for the shove) |
| RANGE_ADJUST.weaker | "Against any cards you win {eRandom}%. How they played makes strong hands less likely. Against their likely hands, you win about {eRange}%." | the range number is higher than `eRandom` |
| RANGE_ADJUST.plain | "Against any cards you win {eRandom}%. Against their likely hands, you win about {eRange}%." | the villain's action is unknown, or the range number is a policy's own (against the raiser only, not every opponent) |
| FALLBACK | "This move wins the most chips over time." | no reason in the trace explains the final action with its own numbers |

- **Singular forms.** A template may have a form for a count of 1: OPEN_RANGE and FOLD_RANGE ("1 player acts after you"), PUSH_FOLD and PUSH_FOLD.fold ("Only 1 big blind left"), the F.5 push/fold row ("With 1 big blind").
- **Hint lines.** Headline: "Fold" · "Check" · "Call {amount}" · "Call all-in {amount}" · "Bet {size}" · "Raise to {size}" · "All-in {size}". Numbers line: "Win {eRandom}% · Need {need}% · Pot {pot} · To call {toCall}"; "Win {eRandom}% · Pot {pot}" with nothing to call; "… · Pot you can win {pot} · …" when `winPot < pot` (§0.3). `{alt}`: the same headlines with chips only. A sentence starts with a capital letter even when it starts with a value ("Flush draw: 9 outs."); `{draw}` is lower case elsewhere and "draw" when the hand has no named draw.
- **Percentages** show as the HUD shows them (§7.6): whole numbers, "<1%" and ">99%" at the ends. `{rankPct}` is rounded up and at least 1 ("Pocket Aces is in the top 1%", §8.3: `rankPct` 0.45). `{size}` and the F.5 size are "{to} ({bb} BB)" with big blinds to one decimal only when needed.
- **The main reason** is the first reason of the trace that explains the final action (a raise reason for a raise, a fold reason for a fold, …); a GUARDRAIL reason that changed the action comes first, and the policy reason it overruled is dropped. At most two reasons follow RANGE_ADJUST (a committed all-in raise: VALUE_RAISE, COMMITTED). "It is close" is said only for whole numbers at most 2 points apart (`CLOSE_POINTS`); a price sentence that no variant can say with its numbers is dropped, and the next reason or FALLBACK explains the action (seen with chunk 5.4's policy: a value raise that became an all-in call because no raise was legal, labelled CALL_PROFITABLE at 28% against a 33% price).
- **`{E}` and the range number.** A range code's `{E}` is its own `data.E` (the equity its policy compared, e.g. §8.3's E against the raiser), else `eRange`; that number is also RANGE_ADJUST's `{eRange}`. PUSH_FOLD's `{E}` is its own equity when called and never labels the range. RANGE_ADJUST is shown when §8.10's rule holds for the range number or for the decision's `eRange`, and also when a CALL_PROFITABLE or FOLD_PRICE sentence would contradict the decision with `eRandom` but not with the range number (the §8.10 rule compares an unrounded `need` with rounded equities, so need 25.01% with 21% and 25.49% slips through). F.1's RANGE_ADJUST sentence is used when the range number is the decision's `eRange`, lower than `eRandom`, and the villain's last voluntary action is known.
- **`{actionDescription}`** reads the last voluntary action (call, bet, raise) of a live opponent: a call (all-in or not) "calls"; an all-in bet or raise "goes all-in"; after the flop a bet or raise putting in at least ⅔ of the pot before it "bets big"; else after the flop the street's first bet "bets", the second "raises", later ones "re-raise"; before the flop the open "raises" and later raises "re-raise" (an open is several blinds, so the ⅔ rule would call every open "big").
- **"Why not …?"** One line per legal action group other than the recommendation's (fold, check, call, bet, raise; an all-in is a bet or a raise), only when its sentence is true: WHY_NOT_FOLD facing a bet when the shown win chance beats the price; WHY_NOT_CHECK before a value bet or raise (not a semi-bluff or a continuation bet); WHY_NOT_CALL when the shown win chance is below the price, never for a limp (unopened or limped pot) or in push/fold; WHY_NOT_BET instead of a check; WHY_NOT_RAISE instead of a call, a check or a fold. The close alternative's group gets CLOSE_SPOT instead.
- **Rule of 2 and 4**: on the flop and turn when the hand has a draw other than a backdoor draw; `{exact}` is the chance by the river (on the turn, the river card); RULE_2_4_BIG only on the flop, where the ×4 guess is used (on the turn ×2 guesses low, not high).

### F.2 Hand names

Rank words: Two, Three, Four, Five, Six, Seven, Eight, Nine, Ten, Jack, Queen, King, Ace. Plurals: Twos, Threes, Fours, Fives, Sixes, Sevens, Eights, Nines, Tens, Jacks, Queens, Kings, Aces.

| Category | Pattern | Example |
|---|---|---|
| High card | "{Rank}-high" | "Ace-high" |
| Pair | "Pair of {Ranks}" | "Pair of Kings" |
| Two pair | "Two Pair, {Ranks} and {Ranks}" | "Two Pair, Kings and Sevens" |
| Trips | "Three of a Kind, {Ranks}" | "Three of a Kind, Sevens" |
| Straight | "Straight, {Rank}-high" | "Straight, Five-high" |
| Flush | "Flush, {Rank}-high" | "Flush, Ace-high" |
| Full house | "Full House, {Ranks} full of {Ranks}" | "Full House, Kings full of Fours" |
| Quads | "Four of a Kind, {Ranks}" | "Four of a Kind, Queens" |
| Straight flush | "Straight Flush, {Rank}-high" | "Straight Flush, Nine-high" |
| Royal flush | "Royal Flush" | |
| Preflop | "Pocket {Ranks}" / "{Rank}-{Rank} suited" / "{Rank}-{Rank} offsuit"; line 2 "Top {pct}% of starting hands" | "Ace-King suited" |

### F.3 Sub-labels, draw names, big-move lines

- Sub-labels: "Overpair" · "Top pair, {Rank} kicker" · "Second pair" · "Weak pair" · "Pocket pair under the board" · "The pair is on the board: everyone has it" · "Both your cards make pairs" · "Both pairs are on the board: your kicker decides" · "One pair is on the board" · "A set: well hidden and strong" · "Trips: others may share your card" · "The three are on the board: everyone has them" · "Uses {n} of your cards" · "The board plays: everyone shares this hand" · suffix " · Best possible hand".
- Draw names: "Flush draw" · "Nut flush draw" · "Open-ended straight draw" · "Double gutshot" · "Gutshot straight draw" · "Two overcards" · "Backdoor flush draw" · "Backdoor straight draw". Chip format: "{name} · {outs} outs · {pct}% {by river|next card}"; risky suffix "({n} risky)".
- Big-move lines: §7.6. Threat words for EQ_DANGER: "a flush" (3+ of a suit on the board), "a straight" (4 to a straight), "a full house" (board paired).

### F.4 Grades and outcome lines

| Grade | Chip | Feedback card title |
|---|---|---|
| best | "✓✓ Best move" | — (chip only) |
| good | "✓ Good" | — (chip only) |
| inaccuracy | "~ Slightly off" | "Small mistake" |
| mistake | "✗ Mistake" | "Mistake" |
| blunder | "✗✗ Big mistake" | "Big mistake" |

Outcome lines: "Good decision. You were unlucky this time." · "You won, but it was risky. You had {E}% when you called." · "You had {E}% when the chips went in."

### F.5 Feedback card reasons (one sentence, picked by what the hero did)

| Situation | Text |
|---|---|
| Folded with E·R > need | "You folded with a {E}% win chance. You needed only {need}% to call." |
| Called with E·R < need | "You called with a {E}% win chance. You needed {need}%. Calling loses chips over time." |
| Checked a Monster/Strong hand | "You checked a very strong hand. Betting wins more from worse hands." |
| Bet/raised with Air multiway | "You bet with almost nothing into {n} players. Someone usually calls." |
| Bet/raised with Air heads-up | "This bet rarely makes better hands fold. Checking was cheaper." |
| Size far from the recommendation | "Good idea, but the size was too {big/small}. Coach: {size}." |
| Opened too loose | "{hand} is too weak to play from here. Most players fold it." |
| Folded a strong preflop hand | "{hand} is in the top {rankPct}% of hands. It is strong enough to play." |
| Push/fold deviation | "With {S} big blinds, {hand} should {go all-in/fold}." |
| None of the above (fallback) | "The coach's move wins more chips here: {alt}." |

Rows are checked in this order: push/fold deviation (when `effBB ≤ 12`), the two preflop rows (preflop only), size, then the rest top to bottom; first match wins.

⚠️ In the two price rows, `E` in the condition and `{E}` in the text are the same number, `eRange` (the grade uses it), and `{need}` uses the capped `winPot` (§0.3). When the §8.10 RANGE_ADJUST condition holds, the text adds "against their likely hands" after "{E}% win chance", so it never contradicts the HUD badge (e.g. "You called with a 20% win chance against their likely hands. You needed 25%." while the badge shows 30%). A price row fires only if `E·R` and `{E}` are on the same side of `need` after rounding; otherwise use the fallback row.

Buttons: "Undo: try again" · "Keep my move". Small print: "Undo lets you try again. The first move still counts in your stats."

### F.6 Personalities (bot card)

| Name | Description | How to beat them |
|---|---|---|
| Careful | "Plays few hands. When they bet big, believe them." | "Steal their blinds. Fold when they raise." |
| Solid | "Plays good hands and bets them well." | "Play good hands. Don't bluff too much." |
| Aggressive | "Plays many hands and bets often." | "Call them down with good hands. Let them bluff." |
| Calls a lot | "Calls with almost anything. Rarely raises." | "Bet your good hands. Almost never bluff." |
| Wild | "Bets and raises with anything." | "Wait for a good hand. Then let them bet for you." |

### F.7 Hand-rankings data (`src/data/rankings.ts`)

```ts
export const RANKINGS = [
  { key: 'royalFlush',    name: 'Royal flush',     cards: ['As','Ks','Qs','Js','Ts'], kickers: 0, rarity: 0.0032, oneIn: 30900,
    tip: 'A-K-Q-J-10, all one suit. The best hand.',
    detail: 'The highest straight flush. It cannot be beaten. Two royal flushes split the pot.' },
  { key: 'straightFlush', name: 'Straight flush',  cards: ['9h','8h','7h','6h','5h'], kickers: 0, rarity: 0.0279, oneIn: 3600,
    tip: 'Five in a row, all one suit.',
    detail: 'The highest top card wins. A-2-3-4-5 of one suit is the lowest.' },
  { key: 'quads',         name: 'Four of a kind',  cards: ['Qc','Qd','Qh','Qs','7d'], kickers: 1, rarity: 0.168,  oneIn: 595,
    tip: 'Four cards of the same rank.',
    detail: 'Higher four of a kind wins. If equal, the fifth card (kicker) decides.' },
  { key: 'fullHouse',     name: 'Full house',      cards: ['Ks','Kh','Kd','4c','4h'], kickers: 0, rarity: 2.60,   oneIn: 39,
    tip: 'Three of one rank plus two of another.',
    detail: 'The higher three-of-a-kind wins. Kings full of Fours beats Queens full of Aces.' },
  { key: 'flush',         name: 'Flush',           cards: ['Ad','Jd','8d','5d','2d'], kickers: 0, rarity: 3.03,   oneIn: 33,
    tip: 'Any five cards of one suit.',
    detail: 'Compare the highest card, then the next. The suit itself never matters.' },
  { key: 'straight',      name: 'Straight',        cards: ['Tc','9d','8s','7h','6c'], kickers: 0, rarity: 4.62,   oneIn: 22,
    tip: 'Five in a row, mixed suits. A can be low: A-2-3-4-5.',
    detail: 'The highest top card wins. Q-K-A-2-3 is not a straight.' },
  { key: 'trips',         name: 'Three of a kind', cards: ['7s','7h','7c','Kd','2s'], kickers: 2, rarity: 4.83,   oneIn: 21,
    tip: 'Three cards of the same rank.',
    detail: 'Higher three-of-a-kind wins. If equal, the kickers decide.' },
  { key: 'twoPair',       name: 'Two pair',        cards: ['Jh','Jc','5s','5d','Ac'], kickers: 1, rarity: 23.5,   oneIn: 4,
    tip: 'Two different pairs.',
    detail: 'Compare the higher pair, then the lower pair, then the kicker.' },
  { key: 'pair',          name: 'One pair',        cards: ['Th','Ts','Kc','6d','3h'], kickers: 3, rarity: 43.8,   oneIn: 2,
    tip: 'Two cards of the same rank.',
    detail: 'Higher pair wins. If equal, the highest other card (kicker) decides.' },
  { key: 'highCard',      name: 'High card',       cards: ['Ac','Qd','9s','6h','3c'], kickers: 4, rarity: 17.4,   oneIn: 6,
    tip: 'No pair. Your highest card plays.',
    detail: 'Compare the highest card, then the next, down to the fifth. With 7 cards it is rarer than one pair, but it still ranks lowest.' },
] as const;
// kickers = how many trailing cards are drawn at 45% opacity (they do not form the hand).
// Footer lines: §13.2.
```

### F.8 Lessons (each ≤ 150 words, one card diagram; `src/data/lessons.ts`)

1. **The goal.** Win chips. Have the best 5-card hand at the end, or make everyone else fold. You get 2 private cards; 5 shared cards come to the middle.
2. **A hand, step by step.** Blinds → 2 cards each → betting → flop (3 cards) → betting → turn (1) → betting → river (1) → betting → showdown.
3. **Your options.** Fold (give up), check (pass, only if nobody bet), call (match the bet), bet (put chips in first), raise (bet more than someone else).
4. **Which hand wins.** Opens the rankings panel. "Same hand? Higher cards win. Suits never break a tie."
5. **Position.** Acting last shows you what others did first. The button is the best seat. Play more hands near the button.
6. **Pot odds.** "Need %" = the call ÷ (pot + the call). If your win chance is higher, calling wins chips over time. Uses the coach's price bar.
7. **Outs.** Cards that improve your hand. 9 outs for a flush draw. The rule of 2 and 4, and why the app shows the exact number.

### F.9 Glossary (one line each; `{g:term}` keys)

Keys: every name in the Term column is a key on its own, split at " / " and with a parenthesised alias as an extra key, all lower-case. So "big blind (BB)" gives `big blind` and `bb`; "call / check / fold / raise" gives four keys sharing one definition. A template may add a plural "s" after the braces (`{g:big blind}s`); the link covers the key only.

| Term | Definition |
|---|---|
| all-in | Betting all the chips you have left. |
| big blind (BB) | The larger forced bet. Amounts are often counted in big blinds. |
| blinds | Two forced bets that start the pot each hand. |
| bluff | A bet with a weak hand, hoping better hands fold. |
| board | The shared cards in the middle of the table. |
| button | The dealer seat. It acts last after the flop, which is an advantage. |
| call / check / fold / raise | Match the bet / pass without betting / give up the hand / bet more than the current bet. |
| continuation bet (c-bet) | A bet on the flop by the player who raised before the flop. |
| draw | A hand that needs more cards to become strong. |
| equity / win chance | Your share of the pot if the hand were played out many times. |
| flop / turn / river | The first three shared cards / the fourth / the fifth and last. |
| gutshot | A straight draw that needs one exact rank in the middle. 4 outs. |
| heads-up | Only two players. |
| kicker | A side card that breaks ties between equal hands. |
| limp | Calling the big blind instead of raising. |
| need % / pot odds | How often you must win for a call to pay: call ÷ (pot + call). |
| nuts | The best possible hand right now. |
| open-ended straight draw | Four cards in a row that can be completed at either end. 8 outs. |
| outs | Cards still in the deck that improve your hand. |
| risky out | An out that improves you but may help an opponent more. |
| overpair | A pocket pair higher than every card on the board. |
| pocket pair | Two hole cards of the same rank. |
| position | Where you sit. Acting later is better. |
| pot | All the chips bet this hand. |
| range | All the hands a player could have here. |
| semi-bluff | A bet with a draw: it can win now or improve later. |
| set | Three of a kind made with a pocket pair. |
| showdown | Players show their cards; the best hand wins. |
| side pot | A separate pot that an all-in player cannot win. |
| SPR | Your chips behind divided by the pot. Low SPR means close to all-in. |
| split pot | Equal hands share the pot. |
| top pair | Pairing the highest card on the board. |
| value bet | A bet with a strong hand, hoping worse hands call. |

### F.10 Other strings

- Welcome and Home: "RB Poker Coach" · "Learn poker by playing." · "Play" · "Choose players, chips and levels" · "New table…" · "New to poker? 1-minute guide" · "Hand {n} · {players} players · You have {chips} chips · {botLevel} bots · {coachLevel} coach" · "Play money only." The hero is always "You".
- Table (Stage 3): screen-reader heading "Poker table" · the hand label's hint "Tap to see all poker hands" · the hero's bet chip "Your bet {x}" · banner "{name} wins {x}." (a winner whose hand was not shown) · loser-line names "High Card" · "Pair" · "Two Pair" · "Three of a Kind" · "Straight" · "Flush" · "Full House" · "Four of a Kind" · "Straight Flush" · "Royal Flush".
- Secure context: "Needs a secure connection (https)" (Review's shuffle row on a plain-http address, §12.14).
- Action bar: "Fold" · "Check" · "Call {x}" · "Call all-in {x}" · "Bet ▲" · "Raise ▲" · "Bet {x}" · "Raise to {x}" · "All-in {x}" · "Waiting…" · "Checking is free. No need to fold." · "You can't raise here: the all-in was too small to reopen the betting."
- Badge: "win chance" · "Folded" · "Wins {win}% · splits {tie}% · vs {n} players (any cards) · {deals} deals" · "Against their likely hands: about {x}% (a guess from how they bet)" · "How is this calculated?" · "We play out the rest of the hand thousands of times, dealing the other players random cards. You won in {E}% of them. We never look at the bots' real cards." · price chip "Call {toCall} · need {need}%". Screen-reader names (chunk 4.6): "Win chance {x}%" · "Win chance about {x}%" · "Win chance: working it out" · "Win chance: you folded" · "Win chance not available".
- Draw chips (chunk 4.6): the "+N" chip is named "Show all your draws"; a risky out card is named "{card}, may help them too". Rankings: a row's screen-reader label ends with "By river: {x}%." while the column shows.
- Coach (chunk 5.9, §12.6, besides the words §12.6 and §12.11 quote): the strip's opener is named "Show why"; its line when the hint shows both equities (§8.10) "Any cards: {eRandom}%. Their likely hands: about {eRange}%."; the price bar "{win line}. Need {need}%." with "You win more often than you need." / "You win less often than you need."; the strength meter "Hand strength: {label}"; the tray's coach chip "Coach" (accessible name "Coach's amount: {x}"); the narration "{name} folds." · "{name} checks." · "{name} calls {x}." · "{name} bets {x}." · "{name} raises to {x}." · "You fold." · "You check." · "You call {x}." · "You bet {x}." · "You raise to {x}." with " All-in." after an all-in.
- Undo: "Move taken back. The unseen cards were shuffled again."
- Voided hand: "This hand was cancelled because of an internal error. Your chips were returned."
- New table mid-hand: "Your unfinished hand will be folded. Start a new table?"
- Review (chunk 6.3; the words are in `i18n/review.ts`, the three loading and failure lines in `en.review`): "Review this hand" (under the hand-end banner) · "Recent hands" (Menu and list heading) · "Hand {n}" · "All hands" · "No finished hands yet." · "Play a hand, then come back here to replay it." · "Back to the game" · "Loading…" · "Review could not be loaded. Check your connection and try again." · "Step through the hand" · "First step" · "Previous step" · "Play" · "Pause" · "Next step" · "Last step" · "Step" · "Start" · "Step {i} of {n}" · "You won {x} chips." · "You lost {x} chips." · "You broke even." · "This hand was saved by an older version of the game, so it cannot be replayed." · "This hand cannot be replayed." · step lines "The cards are dealt." · "{Name} posts the small blind, {x}." / "…the big blind, {x}." · "You fold." / "{Name} folds." · "checks" · "calls {x}" · "bets {x}" · "raises to {x}" · "All-in." · "The flop: {cards}." · "The turn: {card}." · "The river: {card}." · "Showdown. Cards face up: {names}." · "All-in. Cards face up: {names}." · "{Name} gets {x} back. Nobody called." (plus the Undo line above).
- Other dialogs and toasts: §12.11.
- Screens, plain words the sections above do not fix (Stage 3): "Back" · Setup "Starting chips", "Blinds", "Custom", "Big blind", "Small blind {sb}", "2 to 100,000" · Settings "Game", "Speed" (Normal · Fast · Instant; "How fast the bots play and the cards move."), "Deal the next hand by itself" ("Off: the next hand waits for your tap."), "Show amounts as" (Chips · Big blinds; "For example 2,000 chips, or 100 big blinds.") · new-table dialog buttons "Start new table" · "Cancel".
- Coach levels (chunk 6.4; the quiz's words in `i18n/quiz.ts`, the summary's in `i18n/summary.ts`, "Which hand wins?"'s in `i18n/whichWins.ts`, each with its lazy chunk; the grade chips are F.4's): Exam's hint button "Hint (counts as help)" · Row A while the quiz asks "Answer the quiz first, or tap Skip." · the quiz (besides the §10.3 questions and choices) "Quiz" · "Question {i} of {n}" · "Skip" · "{correct} of {of} correct" · "Win chance: {band}." · "You need: {band}." · "Best move: {moves}." (two moves joined by " or ") · "Hint" · the summary "Hand {n}: {net}" (+160, −40) · "Exam result" · "Your score: {score} of 100" · "Before the flop" · "Flop" · "Turn" · "River" · "You folded" · "You checked" · "You called" · "You bet {x}" · "You raised to {x}" · "Coach: Fold" · "Coach: Check" · "Coach: Call" · "Coach: Bet {x}" · "Coach: Raise to {x}" · "You had {win}, needed {need}." · "You had {win}." · "Taken back with Undo" · "No grade" · "Review hand" · "Next hand ›" · "Close" · the rankings button "Which hand wins?" and its quiz "Tap the hand that wins." · "First hand: {cards}" · "Second hand: {cards}" · "Right!" · "Not this time." · "{winner} beats {loser}." · "Both are {name}." · "{right} of {asked} right" · "Next hands" · "Close".
- Levels and the bot card (chunk 5.10): Settings, Game, above "Speed": "Coach level" ("Changes start with your next decision.") then "Bot level" ("Changes start with the next hand."), each with the four Setup cards ("Coming soon" on the ones not built yet). The bot card, a bottom sheet named by the bot, then its personality: "Close" (✕) · "How to beat them" (the F.6 tip) · "Stack: {x}" · "Style: unknown." (Hard and Expert, chunk 7.1: then "Here is what you have seen:", the line "Plays 34% of hands · Raises 20% · Bets often" with the aggression word "Bets often" · "Bets sometimes" · "Mostly calls" (AF from 2, from 1, below 1; left out before the bot has bet, raised or called after the flop) and "Hands seen: {n}"; before its first preflop decision "You have not seen them play yet.").
- Per-seat levels (chunk 7.2): the bot card, below "Stack: {x}", has the group "This bot's level" with the choices "Same as table ({level})" · "Easy" · "Medium" · "Hard" · "Expert" and the line "Changes start with the next hand."; Setup has a button "More options" that opens "Speed" (the Settings words), "Set each bot's level" ("Bots are numbered clockwise, from your left.", one row "Bot {n}" per bot, "Same as table ({level})" first) and "Four-colour cards" ("Each suit has its own colour."), and while it is closed the lines "1 bot has its own level." · "{n} bots have their own level."; Settings adds, after "Changes start with the next hand." under "Bot level", "1 bot has its own level. Tap that bot at the table to change it." · "{n} bots have their own level. Tap a bot at the table to change it."

---

## Appendix G - Legal and disclaimer text

### G.1 Play-money disclaimer (full in About; first sentence on Welcome, Home and Setup)

> **Play money only.** This is a free poker learning game. You play against computer bots with virtual chips that have no value. They cannot be bought, sold, won as prizes, or exchanged for money. Success here does not mean you will win at real-money poker. Intended for adults.

### G.2 Privacy screen

> **Privacy**
> - **What we store:** your settings, your game in progress, and your stats (hands, decisions, grades).
> - **Where:** only on this device, inside this browser ("local storage"). There is no account, and nothing is sent to us or anyone else. The app makes no network requests while you play.
> - **Why:** so you can continue your game and see your progress. Nothing else.
> - **How to delete it:** Stats → Reset, or clear this site's data in your browser settings.
> - **Hosting:** the app's files come from our own server. Like any web server, it sees your IP address so it can send you the files. The app does not store it. We do not use cookies, analytics or ads.

### G.3 Responsible gambling (About)

> If gambling is causing problems for you or someone you know, free confidential help is available. For example: the UK National Gambling Helpline (GamCare), 0808 8020 133, or the US National Problem Gambling Helpline, call or text 1-800-MY-RESET (1-800-697-3738).

⚠️ Re-check both at every release. Do not use 1-800-GAMBLER (NCPG lost the right to use it on 29 September 2025 and now runs the helpline on 1-800-MY-RESET; its site also still lists 1-800-522-4700). Do not use BeGambleAware: GambleAware wound down by 31 March 2026 when the UK statutory levy system replaced it; GamCare runs the National Gambling Helpline.

### G.4 "Where are my stats?"

> Your stats and settings are saved only on this device, inside this browser. Nothing is sent to the internet, and there is no account. If you clear your browser data, use private mode, or (on iPhone) don't open the game in Safari for a while, the stats can be deleted. To keep them safe, add the game to your Home Screen, and use **Export** to save a backup file. On a new phone, use **Import**.

### G.5 How this app works (About; the §1.5 assumptions)

> **The game:** No-Limit Texas Hold'em against computer bots, with play chips only.
> **Undo:** you can take back your last decision, and the coach stops you after a mistake so you can try again. Hands where you used Undo count as practice, not in your main results.
> **Levels:** choose how strong the bots are (Easy to Expert) and how much the coach helps (Beginner to Exam). They are separate.
> **Win chance:** your chance against any cards the other players might hold. The coach may also show your chance against the hands a player likely has.
> **Your data:** saved on this device only. We do not use cookies; we use the browser's local storage, which stays on your device and is never sent anywhere.
> **The coach:** it uses poker rules of thumb and maths. It is a teacher, not a perfect player. The bots and the coach never see hidden cards, and we test this automatically.

---

## Appendix H - Storage schema and migration rules

### H.1 Example (`pc.v1.profile`, abridged)

```jsonc
{ "schema": 1, "rev": 412, "lastCommittedHandSeq": 1287,
  "createdAt": "2026-10-01T09:12:00Z", "updatedAt": "2026-10-19T21:40:11Z",
  "settings": { "schema": 1, "botLevel": "easy", "coachLevel": "beginner", "players": 6,
                "startingStack": 2000, "sb": 10, "bb": 20, "seatLevels": [null,null,null,null,null,null],
                "speed": "normal", "autoNext": true, "amounts": "chips", "showEquity": true,
                "fourColour": true, "textSize": "normal", "reduceMotion": "system",
                "keepAwake": true, "sound": true, "haptics": true, "handsPanel": "open" },
  "stats": { "schema": 1, "results": { "clean": { "hands": 1150, "netMilliBB": 83400 }, "practice": { "hands": 137 } } },
  "heroModel": { "hands": 1287, "vpip": [301, 1287] },
  "persistGranted": true,
  "flags": { "tips": { "heroStrip": true }, "iosInstall": true, "safariImport": false, "offlineReady": true } }
```

### H.2 Migration rules

1. Every persisted object has `schema`. `migrations: Record<number, (x: unknown) => unknown>` maps version n to n + 1 (`persist/migrations.ts`: `PROFILE_MIGRATIONS` and `SESSION_MIGRATIONS`, both empty while version 1 is the only one; `migrate` never throws). Migrations are pure and tested with a frozen fixture of every past version (`tests/persist/fixtures/profile.v1.json`, …); a hand-written `profile.v0.json` with a test-only 0 → 1 step tests the mechanism now (§14.9).
2. A migration never deletes a field it does not understand; it copies unknown fields into `legacy`. So the type guards accept fields they do not know.
3. A new major schema (`pc.v2.*`) is written alongside `pc.v1.*`. The v1 keys are removed only after the v2 profile has been written and read back successfully on a later launch.
4. The session is not migrated across engine major versions: an unfinished hand from an older engine is voided with chips returned (§14.3). The table between hands is kept: it only has to pass its guard. `persist` may not import `ENGINE_VERSION` (§2.1), so the controller passes it to `loadSession`.
5. Export files carry `schemaVersion`; import runs the same migrations and type guards.
