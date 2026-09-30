# RB Poker Coach - Execution Plan

This is the working checklist for building [PLAN.md](PLAN.md). PLAN.md is the source of truth for
*what* to build. This file tracks *how far along we are* and *in which order*. Each `[ ]` is one
**chunk**: a unit of work sized to finish within one usage window, on its own branch, merged by PR.

Legend: `[ ]` todo · `[~]` in progress (branch exists) · `[x]` merged to `main` · `[H]` waiting on the human

**Current position:** Stages 0–3 ✅ complete in CI (3.9 = owner's phone check, doesn't block). Next: Stage 4 — merge held PRs #27 (4.1), #28 (4.2), #29 (4.3), then 4.4 preflop tables, 4.5 equity worker, 4.6 win badge, 4.7 all-in + bench. Paused for the 03:20Z reset (+30 budget spent).

---

## Prerequisites (before the first chunk)

| # | Item | Status |
|---|---|---|
| P1 | Node 24 LTS (Nest 12 CLI needs ≥ 22.22.3 or ≥ 24.15). `.nvmrc` pins 24 | done — Homebrew `node@24` 24.21.0, unlinked; use via PATH prefix (see CLAUDE.md) |
| P2 | Docker Desktop running (needed for chunk 0.5 and the `docker` acceptance checks) | done — started 27 Sep 2026 (Docker 29.4.0) |
| P3 | GitHub repo `romanbitca/rb-pocker` cloned, `romanbitca` gh account active, local git email `me@romanbitca.com` | done |
| P4 | All pinned versions from PLAN §2.5 exist on npm (checked 23 Sep 2026: react 19.3.0, vite 8.3.0, plugin-react 6.1.1, vite-plugin-pwa 1.3.0, typescript 6.0.3, zustand 5.0.15, @nestjs/core 12.1.0, serve-static 12.0.0, cli 12.0.5, helmet 8.3.0, vitest 5.0.1, @testing-library/react 16.3.3, fast-check 4.10.2, @playwright/test 1.63.0, hand-evaluator 4.3.0, pokersolver 2.1.4) | done |

## Deviations from PLAN.md (recorded in PLAN.md as well)

- CI `slow` job runs weekly instead of nightly (owner decision, 23 Sep 2026: saves Actions minutes on a private repo).
- Repository is `romanbitca/rb-pocker` (PLAN §0.1 says `rb-poker-coach`). The directory name has no effect on code; package names stay `@rb/web` / `@rb/server`.

---

## Stage 0 - Scaffold, pipeline, PWA shell (PLAN §0.2, §17, §18 Stage 0)

- [x] 0.1 `chore/monorepo-scaffold` - npm workspaces, `apps/web` (Vite 8 + React 19 + Zustand + strict TS + CSS Modules + tokens.css), `apps/server` (Nest 12 ESM, `/api/health`), Vitest `unit`/`slow` projects in both, fast-check, Prettier, root scripts. One trivial test per workspace.
- [x] 0.2 `feature/eslint-module-boundaries` - boundary rules (§2.1), `Math.random` ban, server-must-not-import-web; fixtures asserted through ESLint's API (acceptance 5).
- [x] 0.3 `feature/nest-static-serving-and-security-headers` - `security.ts`, helmet config, Permissions-Policy, serve-static with SPA fallback + excludes, per-path cache headers; supertest suite over a `dist` fixture (acceptance 2).
- [x] 0.4 `feature/pwa-shell` - manifest, icons, vite-plugin-pwa `generateSW` with `injectRegister: false`, build-time meta CSP, green felt "RB Poker Coach" page, no-inline-script check.
- [x] 0.5 `chore/docker-image` - `Dockerfile`, `docker-compose.yml`, `.dockerignore`; container reaches `healthy` (acceptance 3). Needs P2.
- [x] 0.6 `test/playwright-offline-e2e` - Playwright projects (6 viewports, Chromium + WebKit), `webServer` = root `npm start`, offline test, no-external-request and no-`/api` assertions (acceptance 4).
- [x] 0.7 `chore/bundle-size-budget` - `scripts/size-budget.ts` table + failing fixture (acceptance 6).
- [x] 0.8 `ci/github-actions-pipeline` - `check`, `e2e`, `docker`, `slow` (weekly, may be empty).
- [x] 0.9 `docs/readme-and-coolify-checklist` - README: local run, phone testing, the §17.6 Coolify checklist for the human.

## Stage 1 - Cards, randomness, evaluator, describe() (PLAN §5, §6.1)

- [x] 1.1 `feature/cards-and-seeded-rng` - `core/cards.ts`, `core/rng.ts`, `core/assert.ts`; Appendix C.4 golden values, chi-square and `randInt` tests.
- [x] 1.2 `feature/seven-card-evaluator` - `eval/tables.ts`, `eval/evaluate.ts`; naive 21-subset oracle, 1M differential vs `@poker-apprentice/hand-evaluator` + pokersolver, exhaustive C.1 count in `slow`, micro-benchmark.
- [x] 1.3 `feature/hand-describe-labels` - `eval/describe.ts`: best five, core, kickers, names, sub-labels, `playsTheBoard`; Appendix D.1 and B19–B24.

## Stage 2 - Rules engine (PLAN §3, §4, Appendix A.3–A.4, B)

- [x] 2.1 `feature/engine-types-and-invariants` - Appendix A types, `checkInvariants` (I1–I14) before any reducer logic.
- [x] 2.2 `feature/engine-table-setup-and-deal` - `createTable`, `startHand`, `nextTable` (button, bot replacement, 3→2 rule).
- [x] 2.3 `feature/engine-betting-rules` - `legalActions`, `step` reducer, raise-to sizes, reopening, street advance on `advance`.
- [x] 2.4 `feature/engine-side-pot-settlement` - `settle.ts` (uncalled refunds, side pots, odd chips) + independent chip-layer oracle written from §3.8 only; 100k differential.
- [x] 2.5 `feature/engine-observe-replay-reshuffle` - `observe` (non-leak test), `replay`, `reshuffle`, JSON round trip, deep-freeze no-mutation.
- [x] 2.6 `test/engine-rule-vectors-and-properties` - all 44 Appendix B vectors, property run (100k hands unit / 10M steps slow), ≤ 400 inputs termination, branch coverage ≥ 95%.

## Stage 3 - Playable table (PLAN §12, §13, §14 minimal, A.8)

- [x] 3.1 `feature/zustand-store-and-table-controller` - store slices, `TableController` (scheduling, `advance` gating, gates, epoch), temporary `SimpleBot` behind the async interface, test hooks `?seed=` / `window.__pc`.
- [x] 3.2 `feature/local-session-and-settings-storage` - `persist/storage.ts`, minimal `pc.v1.profile` (settings), `pc.v1.session` saved after every step, resume.
- [x] 3.3 `feature/card-and-seat-components` - SVG cards (no Unicode suits), `Seat` (memo), `layout/seats.ts` ellipse tables, dealer button, bets.
- [x] 3.4 `feature/table-screen-layouts` - Table in portrait / landscape / wide, board, pot, hero strip with label + highlight, secure-context feature detection.
- [x] 3.5 `feature/action-bar-and-sizing-tray` - presets, slider, disabled Fold with tooltip, 56 px / 44 px targets, Android Back closes tray.
- [x] 3.6 `feature/hand-rankings-panel` - persistent panel on wide screens, edge tab + drawer, live highlight, beats-you / you-beat, focus trap, bot pause while open.
- [x] 3.7 `feature/one-tap-play-and-setup-screens` - Welcome, Home (one-tap Play / continue), Setup, Menu, Settings (Game section), out-of-chips dialog, top-up.
- [x] 3.8 `test/playable-table-e2e` - acceptance 1–9 (50 hands × viewports, overlap checks, no bot card leak in DOM, resume deep-equal).
- [H] 3.9 [H] **Human gate:** play 10 hands on the phone over LAN, confirm §1.5 assumptions (Q1).

## Stage 4 - Draws, outs, win chance (PLAN §6.2–6.6, §7)

- [~] 4.1 `feature/draws-and-outs-analysis` - `analysis/handinfo.ts` (draws, outs rule, risky outs R1–R5, nuts/beaters); D.2.
- [~] 4.2 `feature/chances-by-the-river` - `analysis/chances.ts`; D.3.
- [~] 4.3 `feature/win-chance-equity` - `analysis/equity.ts` exact + fixed-n seeded Monte Carlo; C.2–C.3.
- [ ] 4.4 `feature/preflop-equity-tables` - `scripts/gen-preflop.ts`, `analysis/preflop.ts`, `check-tables` in CI.
- [ ] 4.5 `feature/equity-worker` - `workers/protocol.ts`, `equity.worker.ts`, `app/workerClient.ts` (jobId, epoch, cancel, stale-drop, timeouts).
- [ ] 4.6 `feature/win-badge-and-draw-chips` - badge (skeleton, `~`, hysteresis, popover), price chip, draw chips, By-river column.
- [ ] 4.7 `feature/all-in-run-out-and-bench` - all-in TV mode, luck line, `#bench` route, throttled latency checks.
- [ ] 4.8 [H] **Human gate:** `#bench` numbers from one real Android phone.

## Stage 5 - Coach hints and Easy/Medium bots: public MVP (PLAN §8, §9, §10)

- [ ] 5.1 `feature/range-and-push-fold-tables` - `gen-ranges.ts`, `gen-pushfold.ts`, range + push/fold acceptance.
- [ ] 5.2 `feature/opponent-range-model` - `brain/features.ts`, `ranges.ts`, full §8.6 model, `opponentStats.ts`, `tunables.ts`.
- [ ] 5.3 `feature/preflop-and-push-fold-policy` - `preflopPolicy.ts`, `pushfold.ts`.
- [ ] 5.4 `feature/postflop-policy-and-bet-sizing` - `postflopPolicy.ts`, `sizing.ts`.
- [ ] 5.5 `feature/coach-guardrails-and-ev-model` - `guardrails.ts`, `ev.ts`; each guardrail has a test that fails without it.
- [ ] 5.6 `feature/coach-explanations` - `explain.ts`, `i18n/en.ts` templates, `check-copy.ts`.
- [ ] 5.7 `feature/bot-personalities-easy-medium` - `profiles.ts`, `decide.ts`, `hint`, think time, non-cheating property test, Appendix E golden spots.
- [ ] 5.8 `feature/brain-worker` - `brain.worker.ts` replaces `SimpleBot` (moved to `scripts/bots/`).
- [ ] 5.9 `feature/coach-strip-and-sheet` - Beginner/Intermediate UI, recommended ring, "Use coach size", RANGE_ADJUST, glossary popovers.
- [ ] 5.10 `feature/bot-and-coach-level-selectors` - level cards, personality labels, bot card.
- [ ] 5.11 `test/self-play-calibration` - `scripts/selfplay.ts` + baselines; acceptance 5–6.
- [ ] 5.12 [H] **Human gate:** read 10 hints on the phone → announce MVP.

## Stage 6 - Grading, feedback, Undo, Advanced/Exam (PLAN §8.9, §10.2–10.3, §11)

- [ ] 6.1 `feature/decision-grading` - `grade.ts`, leak tags, controller `grading` state, grade chips.
- [ ] 6.2 `feature/mistake-feedback-and-undo` - feedback card, toolbar Undo, `reshuffle`, practice flag, §11.5 tests, `?script=` hook.
- [ ] 6.3 `feature/hand-review-replay` - hand summary and read-only Review.
- [ ] 6.4 `feature/advanced-quiz-and-exam-level` - quiz, Exam behaviour, full level matrix.
- [ ] 6.5 `test/grading-and-undo-e2e` - acceptance 2–6.

## Stage 7 - Hard and Expert bots (PLAN §9.5, §10.1)

- [ ] 7.1 `feature/hard-expert-bot-profiles` - range model on for bots, exploits (n ≥ 30), balanced river bluffs, hidden labels, observed-stats card.
- [ ] 7.2 `feature/per-seat-bot-levels` - per-seat override from next hand.
- [ ] 7.3 `test/hard-expert-self-play` - acceptance 1–5.

## Stage 8 - Persistence and stats (PLAN §14, Appendix H)

- [ ] 8.1 `feature/profile-commit-protocol` - schema guards, migrations scaffold, atomic commit + backup, crash injection tests.
- [ ] 8.2 `feature/stats-model-and-screen` - stats reducers, Stats screen (4 tabs, charts), 20-hand fixture.
- [ ] 8.3 `feature/tab-lock-and-export-import` - Web Locks writer, `rev` fallback, export/import/reset, `persist()`.
- [ ] 8.4 `feature/level-suggestions-and-install-hints` - Settings Data section, install nudge, suggestions.
- [ ] 8.5 [H] **Human gate:** iOS Export → Save to Files → Import.

## Stage 9 - Polish, accessibility, fairness, release (PLAN §12.11–12.14, §15, §16)

- [ ] 9.1 `feature/sounds-haptics-and-wake-lock`
- [ ] 9.2 `feature/learn-lessons-and-glossary` - lessons, glossary, full-page rankings, "Which hand wins?".
- [ ] 9.3 `feature/first-table-tips-and-keyboard-shortcuts`
- [ ] 9.4 `feature/provable-shuffle-check` - Review ✓ over 1,000 recorded hands.
- [ ] 9.5 `feature/service-worker-update-between-hands`
- [ ] 9.6 `chore/accessibility-audit` - axe clean, reduced motion, keyboard-only hand.
- [ ] 9.7 `chore/performance-pass` - Lighthouse ≥ 90 / 95, budgets.
- [ ] 9.8 [H] **Human gate:** Coolify connected (Q6), device matrix, VoiceOver/TalkBack → release v1.0.

---

## Human gates: how the loop handles them

A `[H]` item never blocks the loop. When one is reached, Claude marks it `[H]`, writes what the human
needs to do in "Waiting on the human" below, sends a notification, and continues with the next stage.
If the human's answer later reveals a problem, the fix becomes a new chunk ahead of the current one.

### Waiting on the human

- **3.9 — play 10 hands on your phone** (Stage 3 manual gate). On the Mac: `npm run build && npm start` in the repo (Node 24), then on the phone (same Wi-Fi) open `http://<Mac LAN IP>:3000`. Check it feels right one-handed, and confirm the §1.5 assumptions (Q1: "undo" and "levels for both" as planned). Claude can start the server for you on request.

- Q (from 4.1, PR #27): by §6.3 rule 3's wording, a card that makes **trips on the board** counts as an out (e.g. Q♠J♦ on 9♣9♥4♦2♠ → 9♠, 9♦ "improve" a board pair to board trips). Everyone shares it. Default: keep the rule as written but mark such outs risky? Owner to confirm; until then the code follows the text.

### Rebase map for stacked branches (old base..old tip, from git merge-base, 27 Sep 23:25Z)

| PR | Branch | Replay onto main |
|---|---|---|
| #14 | feature/engine-types-and-invariants | 55d23ee..ba91ca9 |
| #16 | feature/engine-table-setup-and-deal | ba91ca9..25aef21 |
| #18 | feature/engine-betting-rules | 25aef21..997d122 |
| #20 | feature/engine-side-pot-settlement | 997d122..11890f8 |
| #19 | feature/local-session-and-settings-storage | ba91ca9..f54cce4 |
| #15 | feature/card-and-seat-components | e84ece6..bb2a8f6 |
| #17 | feature/hand-rankings-panel | bb2a8f6..7624866 |

### Pending fixes (apply at merge time)

- ✅ done in PR #10 — 1.3 (PR #10): PLAN D.1 row 6 best5 order contradicts rows 7 and 22. Decision (orchestrator, 27 Sep): within a rank, order by suit s > h > d > c (selection still prefers hole cards, §5.4). Change row 6 to `7♥ 7♦ 7♣ K♠ 2♦`, state the order rule in §5.4, turn the `it.fails` for row 6 into a normal test.
- PLAN change-log rows 1.3.x were numbered independently by parallel agents: renumber them in merge order.
- ✅ done in 3.4 — `src/persist` coverage threshold.
- Later (Stage 9 or a small fix): Workbox `navigateFallbackDenylist: [/^\/api\//]` so a browser with the SW installed shows JSON at `/api/health` (needs a §15.1 edit).

## Log

| Date | Chunk | Result | Usage window (baseline → end) |
|---|---|---|---|
| 27 Sep 20:44–21:05Z | 0.1 | [PR #1](https://github.com/romanbitca/rb-pocker/pull/1) merged; all local checks green | overnight mode; ~4% of window |
| 27 Sep 21:07–21:35Z | 0.3, 0.4, 0.2, 0.5 | PRs [#2](https://github.com/romanbitca/rb-pocker/pull/2), [#4](https://github.com/romanbitca/rb-pocker/pull/4), [#6](https://github.com/romanbitca/rb-pocker/pull/6), [#7](https://github.com/romanbitca/rb-pocker/pull/7) merged (local checks; no CI yet). Docker image healthy; PLAN pitfalls 44–45 added | 4% → 31% (5 agents in parallel) |
| 27 Sep 21:30Z | 2.4 (oracle part) | [PR #5](https://github.com/romanbitca/rb-pocker/pull/5) open, held for Stage 2 | — |
| 27 Sep 21:10–21:48Z | 1.1, 1.2, 1.3 | PRs [#3](https://github.com/romanbitca/rb-pocker/pull/3), [#9](https://github.com/romanbitca/rb-pocker/pull/9), [#10](https://github.com/romanbitca/rb-pocker/pull/10) open (stacked, held until Stage 0 CI is green). C.4 golden ✓, 1M differential 0 mismatches, exhaustive C.1 ✓ (2.9 s), 16.4M evals/s | — |
| 27 Sep 21:40Z | 0.7 | [PR #8](https://github.com/romanbitca/rb-pocker/pull/8) merged; initial JS 69 KB gzip | — |
| 27 Sep 21:36–22:10Z | 0.6, 0.9, 0.8 | PRs [#11](https://github.com/romanbitca/rb-pocker/pull/11), [#12](https://github.com/romanbitca/rb-pocker/pull/12), [#13](https://github.com/romanbitca/rb-pocker/pull/13) merged; CI green (check 35 s, docker 57 s, e2e 2m43s). **Stage 0 complete** | — |
| 27 Sep 21:37–22:35Z | 2.1, 2.2 | PRs [#14](https://github.com/romanbitca/rb-pocker/pull/14), [#16](https://github.com/romanbitca/rb-pocker/pull/16) open (stacked on Stage 1, held). I0–I15 with mutation tests; 3,000-table fast-check; B1/B26/B30/B31/B36 full. PLAN §3.7 fixed so B34 is reachable | 53% → 66% |
| 27 Sep 22:12–22:40Z | Stage 1 merge | PRs #3, #9, #10 rebased and merged with green CI (check, docker, e2e); D.1 row 6 fixed. **Stage 1 complete** | Sonnet agent |
| 27 Sep 21:47–22:43Z | 3.3, 3.6 (early) | PRs [#15](https://github.com/romanbitca/rb-pocker/pull/15), [#17](https://github.com/romanbitca/rb-pocker/pull/17) open, held for stage order (need rebase onto main). View models in `src/ui/views.ts`; seat geometry fixed for 360–390 px phones (PLAN §12.4 amended) | 69% → ~75% |
| 27 Sep 22:37–23:22Z | 2.3, 2.4 | PRs [#18](https://github.com/romanbitca/rb-pocker/pull/18), [#20](https://github.com/romanbitca/rb-pocker/pull/20) ready. Engine vs independent oracle: 0 mismatches on 100k (unit) + 1M (slow) all-in hands; 2,500-hand property run; engine branch coverage 99.0%; B1–B20, B25–B29, B32, B34–B40, B43–B44 through the real engine | 71% → 86% |
| 27 Sep 22:44–23:20Z | 3.2 (early) | [PR #19](https://github.com/romanbitca/rb-pocker/pull/19) ready, held for stage order; persist branch coverage 95.6% | (same window) |
| 27 Sep 23:25–23:58Z | Stage 2 merge train | #14, #16, #18, #20 merged with green CI (check, e2e, docker); settlement now uses `describe()`; #5 closed as superseded | Sonnet agent, 86% → 89% (Sonnet ≈ 3× cheaper than Opus per token) |
| 28 Sep 00:00–00:22Z | 2.5 | [PR #21](https://github.com/romanbitca/rb-pocker/pull/21) draft: observe (non-leak property), replay (10k), engine-level undo reshuffle, B33/B41/B42; targeted tests green, full suite + CI pending. Agent stopped itself at 93% | 89% → 93%; pause until 01:50Z reset |
| 29 Sep 19:40–21:05Z | 2.5, 2.6 (+ fix) | PRs [#21](https://github.com/romanbitca/rb-pocker/pull/21), [#26](https://github.com/romanbitca/rb-pocker/pull/26) (test timeouts: main was red), [#23](https://github.com/romanbitca/rb-pocker/pull/23) merged. All 44 B vectors in one runner; 100k-hand property (unit, ~52 s) + 10M steps (slow, 325 s); step+invariants 15 µs; coverage engine 99.1%, eval 97.7% (CI thresholds 95/90). observe() non-leak test strengthened (burn cards). **Stage 2 complete** | 10% → 56% (day override) |
| 29 Sep 19:40–21:00Z | 3.2/3.3/3.6 rebased; 3.1 (phase 1), 3.5, 3.7 | PRs #15/#17/#19 rebased with green CI; [#25](https://github.com/romanbitca/rb-pocker/pull/25) controller (gates, epochs, SimpleBot via observe only, 200 seeded hands, hooks absent from prod), [#24](https://github.com/romanbitca/rb-pocker/pull/24) action bar/tray, [#22](https://github.com/romanbitca/rb-pocker/pull/22) screens | (same window) |
| 29 Sep 21:05–22:00Z | Stage 3 merge train | #15, #17, #19, #22, #24 merged with green CI (Sonnet agent) | 56% → ~80% |
| 29 Sep 21:36–22:14Z | 3.1 (phase 2) | [PR #25](https://github.com/romanbitca/rb-pocker/pull/25) merged (3e7ae0b): session save/resume deep-equal, view-model selectors (no bot card leaks in 60 hands), one navigation model, rankings `sheet` gate | → 91% |
| 29 Sep 21:52–22:14Z | 4.3 (early) | [PR #29](https://github.com/romanbitca/rb-pocker/pull/29) draft, CI green: C.2/C.3 exact to 0.01, MC within tolerance, bit-identical | (same window) |
| 29 Sep 22:15–23:37Z | 3.4 | [PR #30](https://github.com/romanbitca/rb-pocker/pull/30) merged (cb2a974): **the game is playable** — 42 hands via UI in Chromium+WebKit, 0 console errors; one tap → cards in ~0.1–0.2 s; DOM ≤ 600 nodes at 9 players (576); no bot card leaks over 60 hands | new window 0% → 13% |
| 29 Sep 23:38–01:17Z | 3.8 | [PR #31](https://github.com/romanbitca/rb-pocker/pull/31) merged (fac265d): every Stage 3 criterion as Playwright tests in Chromium + WebKit (50 hands × 5 viewports, overlaps 2–9 players, drawer, no card leak per DOM change, resume, offline 6-player hand, DOM ≤ 600, no long task > 50 ms). WebKit drawer bug found and fixed. e2e job now ~11 min. **Stage 3 complete** | 13% → 31% |
| 29 Sep 21:05–21:48Z | 4.1, 4.2 (early) | PRs [#27](https://github.com/romanbitca/rb-pocker/pull/27), [#28](https://github.com/romanbitca/rb-pocker/pull/28) ready, held: all D.2, D.3, C.5 exact; brute-force oracle agreement | (same window) |
