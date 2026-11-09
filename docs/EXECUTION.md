# RB Poker Coach - Execution Plan

This is the working checklist for building [PLAN.md](PLAN.md). PLAN.md is the source of truth for
*what* to build. This file tracks *how far along we are* and *in which order*. Each `[ ]` is one
**chunk**: a unit of work sized to finish within one usage window, on its own branch, merged by PR.

Legend: `[ ]` todo · `[~]` in progress (branch exists) · `[x]` merged to `main` · `[H]` waiting on the human

**Current position:** ▶ **Overnight run (owner, 8 Nov ~22:50Z): "a set of improvements" + Telegram Mini App + multiplayer with other Telegram users; work all night, bypass blockers.** Weekly cap 80% (resets 13 Nov 18:00Z). **Stages 0–9 ✅ (all automated criteria).** Live: https://poker.romanbitca.com. In progress: three improvement chunks (from a product review), and Stage 10 (design merged, PLAN §19; chunks below). Docker Desktop is off since 6 Nov, so CI runs with `--no-docker` (#94); not started, to leave the owner's other projects' containers alone. **Waiting on the owner:** the 9.8 phone checks and the "all OK" for [#86](https://github.com/romanbitca/rb-pocker/pull/86) (v1.0.0); the Telegram bot token from @BotFather; gates 3.9, 4.8, 5.12, 8.5.

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

- [x] 4.1 `feature/draws-and-outs-analysis` - `analysis/handinfo.ts` (draws, outs rule, risky outs R1–R5, nuts/beaters); D.2.
- [x] 4.2 `feature/chances-by-the-river` - `analysis/chances.ts`; D.3.
- [x] 4.3 `feature/win-chance-equity` - `analysis/equity.ts` exact + fixed-n seeded Monte Carlo; C.2–C.3.
- [x] 4.4 `feature/preflop-equity-tables` - `scripts/gen-preflop.ts`, `analysis/preflop.ts`, `check-tables` in CI.
- [x] 4.5 `feature/equity-worker` - `workers/protocol.ts`, `equity.worker.ts`, `app/workerClient.ts` (jobId, epoch, cancel, stale-drop, timeouts).
- [x] 4.6 `feature/win-badge-and-draw-chips` - badge (skeleton, `~`, hysteresis, popover), price chip, draw chips, By-river column.
- [x] 4.7 `feature/all-in-run-out-and-bench` - all-in TV mode, luck line, `#bench` route, throttled latency checks.
- [H] 4.8 [H] **Human gate:** `#bench` numbers from one real Android phone.

## Stage 5 - Coach hints and Easy/Medium bots: public MVP (PLAN §8, §9, §10)

- [x] 5.1 `feature/range-and-push-fold-tables` - `gen-ranges.ts`, `gen-pushfold.ts`, range + push/fold acceptance.
- [x] 5.2 `feature/opponent-range-model` - `brain/features.ts`, `ranges.ts`, full §8.6 model, `opponentStats.ts`, `tunables.ts`.
- [x] 5.3 `feature/preflop-and-push-fold-policy` - `preflopPolicy.ts`, `pushfold.ts`.
- [x] 5.4 `feature/postflop-policy-and-bet-sizing` - `postflopPolicy.ts`, `sizing.ts`.
- [x] 5.5 `feature/coach-guardrails-and-ev-model` - `guardrails.ts`, `ev.ts`; each guardrail has a test that fails without it.
- [x] 5.6 `feature/coach-explanations` - `explain.ts`, `i18n/en.ts` templates, `check-copy.ts`.
- [x] 5.7 `feature/bot-personalities-easy-medium` - `profiles.ts`, `decide.ts`, `hint`, think time, non-cheating property test, Appendix E golden spots.
- [x] 5.8 `feature/brain-worker` - `brain.worker.ts` replaces `SimpleBot` (moved to `scripts/bots/`).
- [x] 5.9 `feature/coach-strip-and-sheet` - Beginner/Intermediate UI, recommended ring, "Use coach size", RANGE_ADJUST, glossary popovers.
- [x] 5.10 `feature/bot-and-coach-level-selectors` - level cards, personality labels, bot card.
- [x] 5.11 `test/self-play-calibration` - `scripts/selfplay.ts` + baselines; acceptance 5–6.
- [H] 5.12 [H] **Human gate:** read 10 hints on the phone → announce MVP.

## Stage 6 - Grading, feedback, Undo, Advanced/Exam (PLAN §8.9, §10.2–10.3, §11)

- [x] 6.1 `feature/decision-grading` - `grade.ts`, leak tags, controller `grading` state, grade chips.
- [x] 6.2 `feature/mistake-feedback-and-undo` - feedback card, toolbar Undo, `reshuffle`, practice flag, §11.5 tests, `?script=` hook.
- [x] 6.3 `feature/hand-review-replay` - hand summary and read-only Review.
- [x] 6.4 `feature/advanced-quiz-and-exam-level` - quiz, Exam behaviour, full level matrix.
- [x] 6.5 `test/grading-and-undo-e2e` - acceptance 2–6.

## Stage 7 - Hard and Expert bots (PLAN §9.5, §10.1)

- [x] 7.1 `feature/hard-expert-bot-profiles` - range model on for bots, exploits (n ≥ 30), balanced river bluffs, hidden labels, observed-stats card.
- [x] 7.2 `feature/per-seat-bot-levels` - per-seat override from next hand.
- [x] 7.3 `test/hard-expert-self-play` - acceptance 1–5.

## Stage 8 - Persistence and stats (PLAN §14, Appendix H)

- [x] 8.1 `feature/profile-commit-protocol` - schema guards, migrations scaffold, atomic commit + backup, crash injection tests.
- [x] 8.2 `feature/stats-model-and-screen` - stats reducers, Stats screen (4 tabs, charts), 20-hand fixture. [#66](https://github.com/romanbitca/rb-pocker/pull/66) 64e1ce1 (Stage 8 train).
- [x] 8.3 `feature/tab-lock-and-export-import` - Web Locks writer, `rev` fallback, export/import/reset, `persist()`.
- [x] 8.4 `feature/level-suggestions-and-install-hints` - Settings Data section, install nudge, suggestions. [#73](https://github.com/romanbitca/rb-pocker/pull/73) 1226b72 (Stage 8 train).
- [H] 8.5 [H] **Human gate:** iOS Export → Save to Files → Import (steps in "Waiting on the human").

## Stage 9 - Polish, accessibility, fairness, release (PLAN §12.11–12.14, §15, §16)

- [x] 9.1 `feature/sounds-haptics-and-wake-lock` - merged [#67](https://github.com/romanbitca/rb-pocker/pull/67) 3ec39f9.
- [x] 9.2 `feature/learn-lessons-and-glossary` - lessons, glossary, full-page rankings, "Which hand wins?". Merged [#69](https://github.com/romanbitca/rb-pocker/pull/69) 9979edc.
- [x] 9.2b `feature/hand-drill-page` - **owner request (6 Nov):** the owner's Poker Hand Drill (github.com/romanbitca/Poker-hand-drill, v5: 8 games, 3 difficulties, stats, All hands drawer) as a page of its own: ported to React/TypeScript on RB's evaluator, `Card`, rankings list, seeded RNG and tokens; key `pc.v1.drill`; Home + Menu entries; lazy chunk. The standalone GitHub Pages app stays as it is. Merged [#71](https://github.com/romanbitca/rb-pocker/pull/71) 7e7e3c5.
- [x] 9.2c `feature/about-screen` - **gap found 6 Nov:** no chunk built the About screen (§12.1: how this app works G.5, how the coach works, Privacy, disclaimer G.1, help lines G.3 re-checked, licences, version). Merged [#75](https://github.com/romanbitca/rb-pocker/pull/75) 18dd390 (help lines still right on 6 Nov; new G.6 "how the coach works"; the live About shows the version only, §17.6 keeps "Include Source Commit in Build" off).
- [x] 9.1b `feature/settings-complete-and-collection-moment` - **gaps found 6 Nov** (the About agent's audit): Settings rows "show win chance", "four-colour cards", "reduce motion" and "text size" (never applied until now), and the "New in your collection" toast + row pulse (§12.x). Merged [#77](https://github.com/romanbitca/rb-pocker/pull/77) f82ac05 (on the train; text size ×1.15 at the root, px text moved to rem; follow-up: "default speed Fast under reduced motion" is not built).
- [x] `fix/coach-strip-narrow-phones` - [#76](https://github.com/romanbitca/rb-pocker/pull/76) 1b43f3c: the portrait coach strip is 56 px, two lines, one sentence per line (from the Stage 9 notes).
- [x] `fix/stage-9-review-findings` - [#80](https://github.com/romanbitca/rb-pocker/pull/80) 820b5df: 6 of the 7 review findings (the drill's "uses" line counts kickers like the Table; the shuffle check compares reshuffles with `undoCount` and says "before the deal" only when true; read-only tabs never write or deal; the Home reload waits for toasts; read-only tabs reload only in front; the drill's Easy copy). Finding 6 was not a bug. (Stage 9 train part 2).
- [x] `feature/stage-9-follow-ups` - [#81](https://github.com/romanbitca/rb-pocker/pull/81) 23c0e8e: Stats → lesson links ("Lesson 6: Pot odds"), the `vite:preloadError` reload between hands (once per chunk per 10 min, never offline), Fast speed on a first run under reduced motion. (Stage 9 train part 2).
- [x] `fix/tabs-spec-flake` - [#74](https://github.com/romanbitca/rb-pocker/pull/74): "Play here" without Web Locks could leave both tabs read-only (an app race), and `tabs.spec.ts` now waits for state; merged b28de0c (Stage 9 train).
- [x] 9.3 `feature/first-table-tips-and-keyboard-shortcuts` - merged [#72](https://github.com/romanbitca/rb-pocker/pull/72) 1c22bf5.
- [x] 9.4 `feature/provable-shuffle-check` - Review ✓ over 1,000 recorded hands. Merged [#68](https://github.com/romanbitca/rb-pocker/pull/68) 7cce744.
- [x] 9.5 `feature/service-worker-update-between-hands` - merged [#70](https://github.com/romanbitca/rb-pocker/pull/70) 2a6d866 (also the `/api/` navigateFallbackDenylist fix).
- [x] 9.6 `chore/accessibility-audit` - axe clean, reduced motion, keyboard-only hand. Merged [#79](https://github.com/romanbitca/rb-pocker/pull/79) 5e146bd: `axe.spec.ts` (~50 states × 2 sizes × 2 browsers): no violations of any impact; `motion.spec.ts`: ten CSS modules now honour the app's Reduce motion as well as the system's; keyboard-only hand from Play.
- [x] 9.7 `chore/performance-pass` - Lighthouse ≥ 90 / 95, budgets, R14. Merged [#78](https://github.com/romanbitca/rb-pocker/pull/78) f9b3a69: `npm run lighthouse` (in `--slow`), server gzip/brotli (`compression`), Lighthouse mobile Performance 96–98 / Accessibility 100 / installable at load 6–10 (71 at load 47 before compression); initial JS 133.46 → 129.30 KB; R14 fixed (table 320 px at 1024×768 with the tray open).
- [x] `fix/coach-words-and-draws` - **coach audit (6 Nov, 964 decisions: maths sound; 720 correct, 208 right move with misleading words, 12+15 wrong):** fake "draws" on paired boards (decides open question Q: board-pair two pair and board trips become weak outs), draws described as made hands, one draw name on all outs, folds explained by a win % above the price, the limp price shown next to raise/fold, river "free card" texts; plus QA-1 (the summary shows the grade's likely-hands number) and QA-5 (the kicker in the showdown line). [#83](https://github.com/romanbitca/rb-pocker/pull/83): audit counts fake draws 32/70 → 0/58, contradicting folds 50 → 0, unopened numbers lines 56 → 0, river free-card 23 → 0; self-play gates pass. Merged 511ed90 (coach-fixes train).
- [x] `fix/coach-strategy-audit` - from the same audit: "also fine" backs bluffs and grades them Best (EV fold equity), the 4-bet range read from the 3% column (JJ calls a 5-bet shove), short-stack shoves ignore the push/fold solver set, small pairs ranked too low (22/33 folded on the button). [#82](https://github.com/romanbitca/rb-pocker/pull/82): the coach's EV model uses fold rates measured in self-play (bots keep theirs), a 2.5% range column, the solver's push set, small pairs re-ranked (tables regenerated), a set-mining call past the cap; audit: misleading "also fine" 66 → 3, push/fold mismatches 3 → 0; all 10 self-play gates pass, Medium p95 3.7 ms; R23. Merged a9252dd (`local-ci` ✅ f2f6b24, 15 min, unit 3657, e2e 470).
- [x] `fix/phone-qa-layout` - **exploratory QA (6 Nov, ~400 hands, both browsers, 360/390/landscape/tablet/desktop, Large text; no crashes, no console errors):** Stats pans sideways at 360–390 (an sr-only `<table>`), landscape hides the likely-hands number, toasts cover the top seat while you decide, a grey Undo with no reason, WebKit selects 25 px tall, the drill button cut at Large text. [#84](https://github.com/romanbitca/rb-pocker/pull/84): all six fixed (new `phoneLayout.spec.ts`; toasts on the Table sit over the top bar, one at a time); CSS 19.03 of 20 KB. (QA-1 summary numbers vs grade and QA-5 same-hand showdown line → `fix/coach-words-and-draws`; QA-6 "Best move" next to "Coach: Fold" → `fix/coach-strategy-audit`.) Merged f609502 (coach-fixes train).
- [x] `fix/silent-test-browsers` - [#85](https://github.com/romanbitca/rb-pocker/pull/85) 4896973: the owner heard the game's sounds from the test browsers; the E2E build plays at gain 0 (unless `window.__pcAudible`), Chromium (Playwright, Lighthouse) starts with `--mute-audio`.
- [x] R22 closed (owner OK 6 Nov): Cloudflare cache rule for poker.romanbitca.com only (Browser TTL: respect origin); `check-deploy` passes every URL.
- [x] `fix/coach-words-round-2` - **second QA pass (6 Nov, ~450 hands on the final build):** a river call with the nut flush graded "Big mistake", "Only 5 big blinds left" naming the wrong stack, the summary's preflop number differing from the hint (23 of 260), a call all-in below its own price graded Best, shove words when facing an all-in, the summary never saying all-in, heads-up "fewer players" words, "about >99%". [#88](https://github.com/romanbitca/rb-pocker/pull/88): all eight fixed; a check or a paying call where the coach bets is at most "Slightly off" with "…wins chips too, but raising wins more here" (orchestrator decision, 6 Nov: also for checks, e.g. checking a set; harsh grades for a profitable move taught the wrong lesson); the summary uses the hint's own number and label; 10 self-play gates pass. Merged ed952df (QA round 2 train).
- [x] `fix/landscape-row-toasts-badge` - same pass: the landscape coach row still scrolls at 740×360, 667×375 and 844×390 Large; short toasts let the top bar peek out and a tap reveals an older toast; "100%" overflows the win badge. [#87](https://github.com/romanbitca/rb-pocker/pull/87): Fold and Call share a row in landscape (column 120 px), compact head below 390 px tall, checked at 844×390, 740×360, 667×375, 568×320 and 932×430 at both text sizes; a toast covers the whole top bar and a newer one closes the older; the badge fits "100%". Merged f25e3ab (QA round 2 train).
- [x] `feature/hand-summary-on-demand` - **owner request (6 Nov 12:30Z):** "i dont want to see exam result automatically after every game, i need to have a button to open it if i want." The end-of-hand summary never opens by itself at any level (orchestrator: one rule; the same complaint would come back at Beginner); the hand-end banner gets "Exam result" / "Hand summary" when the level's rule offers one. [#89](https://github.com/romanbitca/rb-pocker/pull/89): the button sits beside "Review this hand" (key **S**); a late grade adds it, never opens the sheet; the banner is placed by its real height (at 375×667 the two links covered the hero's cards); PLAN 1.3.92. Merged a06b0b8 (`local-ci` ✅ 1bfb9e2, 14 min, unit 3744, e2e 484).
- [x] `feature/next-hand-on-tap` - **owner request (6 Nov ~15:30Z):** "when game end and i see result, it must not start automatically, i need to click next game." "Deal the next hand by itself" becomes off by default, and turns off once for profiles saved with the old default (since #89 the summary no longer held the next hand). [#90](https://github.com/romanbitca/rb-pocker/pull/90): optional `Settings.defaultsRev`; `upgradeDefaults` turns it off once on load and on Import, then the player's choice is kept; PLAN H.2 rule 6, 1.3.94; `e2e:perf` 5/5 at load 8. Merged 4f7e317 (`local-ci` ✅ 85a74fc, 16 min, unit 3761, e2e 485; 1 flaky: `phoneLayout.spec.ts:567` WebKit 360, the badge test from #87).
- [x] `chore/slow-speed-check-retry` - [#91](https://github.com/romanbitca/rb-pocker/pull/91): `--slow` gives the enforced speed checks one retry (R17, 1.3.96). Script/CI only. Merged c7d0cfd (`local-ci` ✅ 4517c71; 2 flaky: phoneLayout badge WebKit 360, tips WebKit landscape → `test/e2e-flakes`).
- [x] `test/e2e-flakes` - [#92](https://github.com/romanbitca/rb-pocker/pull/92), test-only: a hero that can't bust (data 4b, stats 4b: a bust opened the out-of-chips dialog), the badge test waits for jobs and grades, keyboard holds the bots until Undo (`faults.think`), tips wait for the tapped tip to close; each 10/10, 5/5 under load. Merged 25dfc72 (gold-edge train).
- [x] `feature/gold-edge-best-five` - **owner report (6 Nov ~19:00Z, screenshots):** "sometimes cards look like with opacity, like they are not active". Cards outside the best five were faded (`.dim`, opacity 0.45) without explanation. Now: no fade on the Table; all five cards of the best hand (the hero's, or the winner's at the end) get the gold edge; a one-time tip explains it. [#93](https://github.com/romanbitca/rb-pocker/pull/93): one 3 px gold edge on the five (the hand's cards stay raised), screen-reader text "…, part of your hand", the tip "Gold edge: the five cards that make your hand." (first flop; above the board in landscape); the rankings panel, lessons and drill keep their dimmed examples. Merged 89ba847 (gold-edge train).
- [~] `chore/release-v1.0.0` - draft [#86](https://github.com/romanbitca/rb-pocker/pull/86): app version 1.0.0 (`ENGINE_VERSION` stays 0.1.0 and no longer follows package.json, §4.6), CHANGELOG.md, PLAN 1.3.95; `local-ci` ✅ 7fd5e91 (unit 3761, e2e 486). Merge after 9.8 (rebase first), then tag `v1.0.0`.
- [x] `feature/hand-end-at-the-thumb` - product review 8 Nov (owner: "a set of improvements"): one big "Next hand ›" at the thumb, the result and Next hand in the wide panel, Enter/Space deal, "Skip to result ›" after a fold. PLAN 1.3.99. Merged 91e2c6b (improvements train).
- [x] `feature/no-cut-words-one-gold-rule` - no text cut with "…", one gold rule everywhere (Lesson 1, Hands drawer, Drill), one word per grade, "Both players", "Why?". PLAN 1.3.100. Merged 5aa5b9f (improvements train).
- [x] `feature/review-decisions-stats-leaks-drill-fit` - Review shows your decisions (grade, numbers, coach; Next decision; opens at the first mistake), leaks first in Stats and "Work on: …" on Home, the Drill fits one screen. PLAN 1.3.101. Merged e19ed14 (improvements train).
- [H] 9.8 [H] **Human gate:** Coolify ✅ (5 Nov, https://poker.romanbitca.com), device matrix, VoiceOver/TalkBack → release v1.0.

---

## Stage 10 - Telegram Mini App and playing with friends (PLAN §18 Stage 10, §19; owner request 8 Nov 2026)

- [x] 10.1 `feature/mp-engine-copy-and-protocol` - the engine copied for the server, the wire protocol, `PublicHand`. Merged #98 7864aa3.
- [x] 10.2 `feature/telegram-initdata` - `initData` validation. Merged #96 a1138ff.
- [x] 10.3 `feature/mp-table-machine` - rooms, seats, hands, timers (needs 10.1). Merged #103.
- [x] 10.4 `feature/mp-websocket` - the gateway, limits, reconnect, leak tests (needs 10.2, 10.3). Merged #105.
- [x] 10.5 `feature/telegram-bot` - webhook, `/start` `/new` `/help` `/post`, inline (needs 10.2). Merged #100 0431561.
- [x] 10.6 `chore/headers-for-telegram` - `frame-ancestors` for Telegram Web, check-deploy. Merged #97 960d59f.
- [x] 10.7 `feature/telegram-shell` - launch params, bridge, theme, BackButton, safe area, haptics. Merged #99 748c697.
- [x] 10.8 `feature/mp-client-driver` - the Table driven by the server (needs 10.1). Merged #104 ef44ff6.
- [x] 10.9 `feature/mp-screens` - Create, Share, Join, Waiting, Playing, Busted, Ended (needs 10.7, 10.8). Merged #108.
- [ ] 10.10 `test/mp-end-to-end` - 2–3 browser contexts with signed `initData`, leak, connection (needs 10.4, 10.6, 10.7, 10.9).
- [x] 10.11 `docs/telegram-privacy-and-owner-steps` - privacy text, owner's steps, cover image. Merged #101 25766ac.
- [ ] 10.12 `feature/mp-quick-match` - public tables for strangers (after the core).
- [ ] 10.13 `feature/mp-bots-fill-seats` - the app's bots fill empty seats (after the core).
- [ ] 10.14 [H] **Human gate:** create the bot at @BotFather (PLAN §19.13), give the token; play a hand with a friend on a real phone.

---

## Human gates: how the loop handles them

A `[H]` item never blocks the loop. When one is reached, Claude marks it `[H]`, writes what the human
needs to do in "Waiting on the human" below, sends a notification, and continues with the next stage.
If the human's answer later reveals a problem, the fix becomes a new chunk ahead of the current one.

### Waiting on the human

- **9.8 — final phone checks for v1.0** (when Stage 9 part 2 is live; PLAN "Manual device script"), on https://poker.romanbitca.com: 1. iPhone, Safari: play 10 hands, look at Stats; Share → Add to Home Screen, open it from the Home Screen ("Played in Safari before?" shows). 2. Airplane mode: open the installed app, play 10 hands, open Hand rankings, Stats, Learn, the Hand Drill, Settings. 3. Mid-hand, switch to another app for 10 minutes, come back (tap Play if Home shows): the same decision, the same hint. 4. Silent switch on/off, and music playing in another app: the sounds behave. 5. One hand: every button reachable with your thumb, no zoom by accident, no pull-to-refresh. 6. Turn the phone sideways and back mid-hand. 7. VoiceOver on: cards, actions and the win chance are read out. 8. Android, if you have one: install from the browser menu, it vibrates on your turn, and open /#bench (that is gate 4.8). Tell Claude what failed.

- **5.12 — read 10 coach hints on your phone** (Stage 5 manual gate): on https://poker.romanbitca.com play with the coach at **Beginner** and read 10 hints. Do they make sense, and are the words plain enough? Tell Claude which ones were unclear.

- **8.5 — iPhone: Export → Save to Files → Import** (Stage 8 manual gate), in Safari on https://poker.romanbitca.com: 1. play 3 hands; 2. Menu (☰) → Settings → **Data** → **Export** → **Save to Files** → Save; 3. the Files app shows `rb-poker-coach-stats-<date>.json`; 4. Settings → Data → **Reset stats** → **Delete my stats** (Stats shows no hands); 5. Settings → Data → **Import**, pick the file: "3 hands, exported <date>" → **Replace** → Stats shows the 3 hands again; 6. optional: Share → Add to Home Screen, open it from there: "Played in Safari before?" → Import the same file. Tell Claude what happened.

- **4.8 — `#bench` on an Android phone**: in Chrome on the phone open **https://poker.romanbitca.com/#bench** (the live app, since 5 Nov), wait a few seconds, copy the "results as text" box and paste it into the chat.

- **3.9 — play 10 hands on your phone** (Stage 3 manual gate): open **https://poker.romanbitca.com** on the phone (Add to Home Screen if you like). Check it feels right one-handed, and confirm the §1.5 assumptions (Q1: "undo" and "levels for both" as planned).

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

### Decisions made

- **Expert style vs strength** (orchestrator, 10 Oct, from 7.3): Expert bots adapt to the table, e.g. an Expert Maniac stops bluffing into callers (AF 1.89 vs target 5.0) and an Expert TAG 3-bets a Maniac's opens (VPIP 30.6). Stage 7 gates style only at Hard, and at Hard/Expert the labels are hidden and the bot card shows the observed stats, so Expert keeps strength over personality (R20 note). Owner may revisit after playing.

- **4.7 acceptance 3 (perf at 6× throttle) in CI** (orchestrator, 1 Oct 00:30Z): CDP cannot throttle workers, and on the shared 2-vCPU runner the modelled 6× worker time is noise (final 539–748 ms in CI vs 270 ms locally). Decision: the two perf checks run **report-only** in the PR e2e job (numbers printed in the job summary), are **enforced locally** (`npm run e2e:perf` or equivalent, run before merging perf-sensitive PRs), and on a **real phone via `#bench`** (4.8 [H]). PLAN Testing strategy already says latency budgets are checked "per stage on a real phone"; write this into §17.5 + risk register.

### Notes for Stage 9 (polish)

- **Release v1.0 (after the Stage 9 gate and the owner's 9.8 checks):** bump the app version to 1.0.0 in the three `package.json` files (About and `/api/health` show it), but keep `ENGINE_VERSION` (`engine/types.ts`, 0.1.0) unchanged: its major gates session resume (H.2 rule 4: another major drops the saved session), Review's shuffle check and the review summary, so bumping it would throw away every player's saved hand and make old hands uncheckable. Tag `v1.0.0` on main and write short release notes.
- Coach strip (from #64, 5 Nov): its single line already cuts off on phones narrower than about 400 px ("All 5 players: 17%. Raiser alone: about 38%." is as long as the old pair). The owner plays on a phone: wrap to two lines or shorten at 360–390 px.
- R14 (open): at 1024×768 wide layout with the sizing tray open the table shrinks to 216 px and pods reach the pot/board (since 5.9). Portrait tray open can show one frame of stale pod positions (ResizeObserver lag) — left as is to protect tap→paint.

### Notes for Stage 6

- 6.2 (PR #49, draft): all built except the Playwright specs for acceptance 2 (scripted blunder: `?seed=46&script=river-min-bet`, 3 players → nut flush on the river of hand 1) and the e2e half of 3. Until 6.1's `grade()` lands, decisions record `grade: null` (no pause yet). Undo slot must be rebased onto #44's coach strip.

- 5.10 (PR #45): the coach level is read live from settings, not latched per hero decision as §10 says; latching needs the Stage 6 decision records — do it in 6.1/6.4.

### Decisions pending (Claude, before Stage 5 completes)

- ✅ resolved in 5.3 (PR #41): bands came from 12.5%-ante charts; restated from PokerCoaching.com no-ante charts (± 3 pts), model fixed (blinds call at own price, pusher's cards removed, 3,000 rounds); R16 closed. — **§8.4 push/fold acceptance bands** (from 5.1, PR #37): the fictitious-play model gives CO 27.2% (band 28–38), 6-max UTG 15.1% (18–26), 9-handed UTG @12 bb 8.8% (10–15); SB and BTN pass. Suspicion: the bands assume antes (this game has none, §1.6). Plan: check published no-ante Nash push/fold charts (e.g. HRC), then either fix the model (multiway-aware caller) or restate the bands with a named source (risk R16). Tests are `it.fails` until then.

### Budgets to watch in Stage 5 (from 4.6, 1 Oct)

- **10 Oct (6.4):** initial JS 147.59 of 150 KB and CSS 19.40 of 20 KB on the Stage 6 stack: Stage 8–9 UI must be lazy (Stats, Learn, lessons, sounds), or the gate must be renegotiated in PLAN §15.3 with a reason.
- Table screen DOM: 594 of 600 nodes at 9 players with everything shown — the coach strip (5.9) must find nodes (e.g. collapse/merge elements) or the budget must be renegotiated in PLAN §15.3 with a reason.
- Main JS: ~140 KB gzip after 5.9, ~144 KB with 5.6's coach text (target 130, gate 150) — Stage 6+ UI must be lazy (feedback card, quiz, Review, Stats). 5.9 freed DOM nodes: Table peak 481/600.
- UX: the strength meter read "Decent" at 6% win chance 5-handed (5.9) — check its bands in 5.7. Brain tables must live in the brain worker chunk; coach UI should lazy-load its sheet.

### Pending fixes (apply at merge time)

- ✅ done in PR #10 — 1.3 (PR #10): PLAN D.1 row 6 best5 order contradicts rows 7 and 22. Decision (orchestrator, 27 Sep): within a rank, order by suit s > h > d > c (selection still prefers hole cards, §5.4). Change row 6 to `7♥ 7♦ 7♣ K♠ 2♦`, state the order rule in §5.4, turn the `it.fails` for row 6 into a normal test.
- PLAN change-log rows 1.3.x were numbered independently by parallel agents: renumber them in merge order. (10 Oct: #52 = 1.3.48, #49 = 1.3.49, #48 = 1.3.50, and #55 (7.1) also took 1.3.48, so renumber at merge.)
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
| 30 Sep 20:45–22:05Z | 4.1–4.3 merge train | #27 (0915526), #28 (6a147a6), #29 (d16dc67) merged with green CI; #33 fixes a flaky offline e2e (hero busts → dialog covered the Hands tab) | Sonnet; 5h 4% → 32%, weekly 50% → 54% |
| 30 Sep 20:45–22:20Z | 4.5 | [PR #32](https://github.com/romanbitca/rb-pocker/pull/32) merged (e33edc3): equity worker + protocol + client; no unrevealed bot card in any posted message (spy, 2–9 players, run-outs); hidden tab cancels all jobs; worker chunk 6.2 KB gzip | 5h 37%, weekly 54% |
| 30 Sep 21:15–22:40Z | 4.6 | [PR #35](https://github.com/romanbitca/rb-pocker/pull/35) merged (b87dbf6): win badge (skeleton, ~, hysteresis, popover), big-move lines, price chip with capped pot, draw chips with risky outs, By-river column; 0 Seat renders on progress; DOM 594/600 | 5h 50%, weekly 56% |
| 30 Sep 21:15–23:00Z | 4.4 | [PR #34](https://github.com/romanbitca/rb-pocker/pull/34) merged (a63beb1): 169×8 win/split + 169×10 finals (7.9 KB gzip), check-tables in CI (20 cells ≤ 0.41 pts), preflop HUD + By-river chances now from the tables; worker 14.1 KB gzip | weekly ~57% |
| 30 Sep 22:42–23:40Z | 5.1 (early) | [PR #37](https://github.com/romanbitca/rb-pocker/pull/37) draft, CI green, held: rankPct/eqVsRange + pushfold tables (5.3 KB + 1.0 KB gzip); §8.3 range acceptance ✅ (after 2 recorded fixes); §8.4 push/fold 2/5 ❌ → decision pending | weekly ~60% |
| 30 Sep 23:18–00:00Z | 5.2 (early) | [PR #38](https://github.com/romanbitca/rb-pocker/pull/38) draft, CI green, stacked on #37: full §8.6 range model (priors, re-weighting, looseness), features, opponent stats, tunables; non-cheating re-deal test; brain coverage 99.5–100%; E9/E13/E16 range checks ✅ | 5h 86%, weekly 61% |
| 1 Oct 20:40–21:00Z | 4.7 | [PR #36](https://github.com/romanbitca/rb-pocker/pull/36) merged (27473f4): all-in TV mode + luck line, `#bench`; perf checks report-only in CI, enforced locally (risk R17). **Stage 4 code complete** | weekly 68% → 71% |
| 8 Oct 20:25–22:10Z | 5.8, 5.5, 5.3 merged; 5.10, 5.6 ready | #42 (a714b4b), #40 (5445df2), #41 (48b1472) merged; [#45](https://github.com/romanbitca/rb-pocker/pull/45) level selectors + bot card, [#46](https://github.com/romanbitca/rb-pocker/pull/46) explanations + check-copy (1,000 situations) ready. Git rerere disabled (it silently dropped PLAN rows once) | weekly 23% → 34% |
| 8 Oct 22:10–23:30Z | 5.4, 5.10, 5.6, 5.9 merged; 5.7 nearly done | #43 (35373d8), #45 (bb249e5), #46 (63ae15e), #44 (53cb525). [#47](https://github.com/romanbitca/rb-pocker/pull/47): 18/18 golden spots via hint(), properties + non-cheating ✅, bot p95 3.8 ms; EV-model fix (equity vs one caller) — bots no longer fold aces | 5h → 85%, weekly 44% |
| 9 Oct 02:51–04:00Z | CI speed-up, wide-layout fix | #50 (98706d7): check job 597 s, 25-min timeout. #53: real bug — wide coach panel had no reserved row, table resized mid-hand and pods lagged one render over the hero strip; reserved row (table min 320 px); WebKit 6/40 → 0/50 failures | weekly 45% → 52% |
| 9 Oct 02:51–04:20Z | 5.7 merged | [#47](https://github.com/romanbitca/rb-pocker/pull/47) (a03f9d6): real hints with explanations; 18/18 golden spots; C2–C4/C6/C7 + non-cheating; initial JS 141.6 KB | weekly ~53% |
| 1 Oct 20:40–21:55Z | 5.1, 5.2 merged; 5.3, 5.5, 5.8 built | #37 (db1d249), #38 (d5848b7) merged. Ready/held: [#40](https://github.com/romanbitca/rb-pocker/pull/40) guardrails + EV, [#42](https://github.com/romanbitca/rb-pocker/pull/42) brain worker (no HandState/hidden cards in any message; hands finish if the worker dies), [#41](https://github.com/romanbitca/rb-pocker/pull/41) preflop + push/fold (E1–E8, E18 ✅; R16 closed with sources). 5.4 [#39](https://github.com/romanbitca/rb-pocker/pull/39) in progress | weekly 68% → ~79% |
| 29 Sep 21:05–21:48Z | 4.1, 4.2 (early) | PRs [#27](https://github.com/romanbitca/rb-pocker/pull/27), [#28](https://github.com/romanbitca/rb-pocker/pull/28) ready, held: all D.2, D.3, C.5 exact; brute-force oracle agreement | (same window) |
| 9 Oct 21:50–22:50Z | R18 fix merged | [PR #54](https://github.com/romanbitca/rb-pocker/pull/54) (4233d52): the meter showed Strong next to Fold in 38% of folds; multiway `p = n·E / (1 + (n−1)·E)` (heads-up unchanged, 0.5 at the fair share) + meter cap (never fired in 2,000 hints); E19–E22 added; 85 of 3,881 hints changed (multiway postflop, fewer value bets) | 5h 8% → 55%, weekly 2% → 8% |
| 9 Oct 21:50–23:10Z | 5.11 merged | [PR #51](https://github.com/romanbitca/rb-pocker/pull/51) (ad54330): 20,000-hand calibration, 12 failing gates → 0 at Medium and at Easy (biases in units of T, 3.5 T preflop rule bonus, Easy reads the opener's range, 4 §9.1 numbers; TAG untouched); 0 illegal actions in 100,000 hands (2–9 seats); Medium bot p95 3.7 ms; coach +288 ± 58 bb/100 vs Easy; R19 closed. Main's check for ad54330 did not start (GitHub billing) | weekly ~11% |
| 9 Oct 23:05–23:50Z | 7.1 built (held) | [PR #55](https://github.com/romanbitca/rb-pocker/pull/55): range model on for Hard/Expert bots, exploits from n ≥ 30, balanced river bluffs, hidden labels, observed-stats card; non-cheating for all 20 profiles + coach; Expert p95 7.6 ms; initial JS 143.0 KB; R20 (Hard/Expert too loose) for 7.3. 6.2 #49 finished (300/300 on a 5× e2e repeat) | 5h → ~85%, weekly 12% |
| 10 Oct 02:44–03:40Z | 7.2 built (held) | [PR #57](https://github.com/romanbitca/rb-pocker/pull/57) on #55: per-seat level override from the next hand (bot card picker, Setup "More options", `Settings.seatLevels`), levels recorded per seat; 208 e2e passed on 12 projects; initial JS 144.45 KB. Fixed a typecheck error on #55 (8c85f70, `riverSpot` level type) | weekly ~17% |
| 10 Oct 02:44–04:10Z | 7.3 built (held) | [PR #56](https://github.com/romanbitca/rb-pocker/pull/56): R20 fixed (rule bonus floored at Medium's value in pots for bots); Expert reads each seat's fold-to-c-bet for fold equity after the flop (the model said 31–55% folds, bots fold 0–25%); Expert beats Medium +57.8 ± 16.9; Hard beats raise-always/call-always; pot-bettor loses; Expert p95 10.5 ms | 5h 46%, weekly 20% |
| 10 Oct 02:44–04:10Z | 6.4 built (held), #48 banner fixed | [PR #58](https://github.com/romanbitca/rb-pocker/pull/58) on #48: Advanced quiz (24.4% of eligible decisions, hides badge + price chip), Exam (no Undo, win badge hidden all hand, "Exam result"), full §10.2 matrix, grade chips, per-decision coach-level latch; the summary sheet waits for a tap (§12.8); 274 e2e passed. #48 e20c3cc: banner never above the table box | weekly 20% |
| 10 Oct 04:15–05:10Z | 6.5 built (held) | [PR #59](https://github.com/romanbitca/rb-pocker/pull/59) on #58: e2e for Stage 6 criteria 2–6 (scripted blunder, Undo per level, late/failed grades and a killed worker via the dev-only `window.__pc.faults`, level matrix on one phone + one desktop per browser, quiz 21% with no badge/price chip, grading time report-only); fixed "Try again" after two worker failures (`hintJobs.ts`); +131 s of e2e → [#60](https://github.com/romanbitca/rb-pocker/pull/60) raises the e2e job timeout to 30 min | weekly 23% |
| 13 Oct 20:30–21:50Z | Stages 6 and 7 merged; 8.1 built (draft) | Owner: no paid GitHub → CI = full local suite on this Mac (`local-ci` status), weekly cap 68%. Merged #52 fbd550c, #49 75f10d8, #48 cb19849, #58 a3ebf01, #59 acbdb85 (Stage 6 gate on main: unit 2656, e2e 308, docker ✅; two runs timed out under load first), #55 1cd3a5d, #57 011879b, #56 72fd6c0 (same tree as the verified #56 head: unit 2796, e2e 316). #60 closed. [#61](https://github.com/romanbitca/rb-pocker/pull/61) 8.1: §14.9 crash injection, handSeq rule, private mode, resume e2e ✅; initial JS 151.78 KB ❌ | weekly 57% → 68% |
| 5 Nov 19:50–20:35Z | `chore/local-ci` | [PR #62](https://github.com/romanbitca/rb-pocker/pull/62) merged (8b228b9; f1aa01e moves its folder to `~/.cache/rb-pocker-ci`): `scripts/ci-local.sh` runs the check, e2e and docker steps in a clean worktree and posts `local-ci` (`--slow`: `local-slow`); the four workflows run by hand only; `docker-compose.yml` takes `HOST_PORT`; PLAN §17.5 + 1.3.58, README, CLAUDE.md step 5. Its own run: passed in 13 min (unit 2887, e2e 316, docker ✅). WebKit had gone from the Playwright cache; the script reinstalls browsers | weekly 34% → 34% |
| 5 Nov 20:00–21:10Z | `chore/initial-bundle-headroom` | [PR #63](https://github.com/romanbitca/rb-pocker/pull/63) merged (1e02342): Table, Setup, Settings, Menu and dialogs in one screens chunk loaded right after first paint (no `React.lazy`: React 19 holds Suspense content 300 ms), reload-to-retry when it fails; one stylesheet (`cssCodeSplit: false`: the gate counts every CSS file and split files compress worse). Initial JS 149.88 → 125.14 KB, CSS 19.94 → 16.43 KB; Home → cards at 6× 113 → 105 ms. Explicit timeouts for four slow test files (load). `local-ci` ✅ 11 min, unit 2892, e2e 318 | weekly 34% → 38% (4 agents) |
| 5 Nov 20:40–22:45Z | 8.1 merged; 8.2, 8.3, labels fix built | [#61](https://github.com/romanbitca/rb-pocker/pull/61) restacked onto main (row 1.3.60), `pc.v1.diag` stored (last 5 voided hands), initial JS 127.15 KB; `local-ci` ✅ 20 min, unit 2946, e2e 324 → merged 7c41deb. Built: [#66](https://github.com/romanbitca/rb-pocker/pull/66) 8.2 (20-hand fixture exact, Stats lazy 6.85 KB, +2.23 KB initial; R21: 10,000 hands = 553 KB of storage, budget raised to 600 KB, hand-end commit 19–30 ms at 6×, records average 3,963 chars), [#65](https://github.com/romanbitca/rb-pocker/pull/65) 8.3 (Web Locks + rev fallback, export/import/reset with crash injection, +2.40 KB; Settings buttons left for 8.4; pitfall 48: WebKit `close({runBeforeUnload})`), [#64](https://github.com/romanbitca/rb-pocker/pull/64) labels ("All 5 players: 17%. Raiser alone: about 38%."; the price bar showed ✓ next to Fold or ✗ next to Call in 114 of 634 facing-a-bet hints, now follows E·R / implied price) | weekly 38% → ~42% |
| 5 Nov 22:45Z–6 Nov 00:35Z | 8.3 merged; Coolify live; 9.1, 9.2, 9.4 built | [#65](https://github.com/romanbitca/rb-pocker/pull/65) merged (a8d29dd). Coolify: app `rb-poker`, https://poker.romanbitca.com healthy; the first deploy failed (NODE_ENV=production at build time made `npm ci` skip devDependencies → runtime-only). check-deploy ✅ except /sw.js (Cloudflare Browser Cache TTL 4 h, R22). Drafts: [#67](https://github.com/romanbitca/rb-pocker/pull/67) 9.1, [#68](https://github.com/romanbitca/rb-pocker/pull/68) 9.4 (initial JS −1.46 KB → 128.10 KB), [#69](https://github.com/romanbitca/rb-pocker/pull/69) 9.2 (Learn chunk 4.54 KB gzip). Every ci-local run since 22:28Z failed on timeouts only (load 43–70; the owner's Docker projects take ~4 cores): agents now run targeted tests only, and only the orchestrator runs ci-local. | weekly 44% → 53% |
| 6 Nov 00:35–01:05Z | Stage 8 merged (8.2, labels fix, 8.4) | One `local-ci` on the train tip 955a712 (main + [#66](https://github.com/romanbitca/rb-pocker/pull/66) + [#64](https://github.com/romanbitca/rb-pocker/pull/64) + [#73](https://github.com/romanbitca/rb-pocker/pull/73), one squash commit each): ✅ 17 min, unit 3168, e2e 358, docker ✅ (load ~20 once the agents' processes ran at nice 15). Merged in order: 64e1ce1, e0044e4, 1226b72 (each branch reset to its train commit; main = the tested tree). PLAN §17.5 + 1.3.65: merge trains. #66 alone had failed only on 8.3's flaky `tabs.spec.ts:97` (a first hand that is a walk). Drafts: [#70](https://github.com/romanbitca/rb-pocker/pull/70) 9.5, [#71](https://github.com/romanbitca/rb-pocker/pull/71) 9.2b, [#72](https://github.com/romanbitca/rb-pocker/pull/72) 9.3. | weekly 53% → 55% |
| 6 Nov 00:54–01:50Z | Stage 8 gate; Stage 9 train | **Stage 8 gate ✅:** `local-slow` on main f76cdab passed in 41 min (long tests 6 min, tables 7 min, 10 self-play gates 25 min, enforced speed checks of Stages 4 and 6); `local-ci` on main = the train tip's code. **Stage 8 complete** (8.5 [H] waits on the owner). Stage 9 train `train/stage-9` 67ea5b6 = main + #74 + #67 + #69 + #71 + #72 + #68 + #70 (agent-built, then re-stacked with #74 first): `local-ci` check job ✅, e2e ✗: `levels.spec.ts:309` (the "Ready to play offline." toast covers a button while the spec's clock is paused; 9.5 registers the SW later now) + two flaky (botcard, tabs). The train agent is fixing them. New: #75 About, #76 coach strip; agents on 9.1b, 9.6, 9.7. | weekly 55% → 58% |
| 6 Nov 02:13–02:40Z | Stage 9 part 1 merged | `local-ci` on the train tip 401b993 ✅ 17 min, unit 3537, e2e 396 (3 flaky, passed on retry: tips, stats, perf). Fixes the train agent made first: the e2e fixture turns the "Ready to play offline." toast off unless a spec asks for it (#70), botcard waits until no bot is acting (#70), the tabs specs wait for the tab to settle (#74). Merged in order with `merge-train.sh` (each branch reset to its train commit, main = the tested tree): b28de0c, 3ec39f9, 9979edc, 7e7e3c5, 1c22bf5, 7cce744, 2a6d866. A read-only review of the train found no high-severity bug and 7 smaller ones (agent `fix/stage-9-review-findings`). | weekly 58% → 61% |
| 6 Nov 02:40–04:20Z | Stage 9 part 2 merged | Train part 2 (agent): #76, #75, #77, #78, #79, #80, #81 as one squash commit each. The first `local-ci` (e51359f) failed in unit: #77's collection toasts broke exact toast lists in 8.4's and 9.5's controller tests (only found by the full run: agents test their own files). Fixed in the train, plus a second read-only review's 3 findings (#81: one 10-minute guard for every stale chunk, `online` checked again before the reload, no "Update ready" for a stale reload; #75: the privacy sentence). Tip 513be33 `local-ci` ✅ 14 min, unit 3632, e2e 470, docker ✅. Merged 1b43f3c … 23c0e8e; main = the tested tree. Initial JS 130.16 KB (target 130, gate 150). | weekly 61% → 65% |
| 6 Nov 04:16–04:45Z | **Stage 9 gate ✅** | `local-slow` on main 7fbe22c passed in 29 min: long tests 5 min, tables 5 min, 10 self-play gates 17 min, the enforced speed checks of Stages 4 and 6, and Lighthouse mobile (first visit 94/100/100, FCP 2.0 s, LCP 2.7 s, TBT 40 ms, CLS 0; later visit 100/100/100; installable). `local-ci` on main = the part-2 tip's code. All automated Stage 9 criteria pass; 9.8 [H] (device matrix, VoiceOver/TalkBack, `#bench` on phones) waits on the owner, then v1.0. QA agents started: exploratory play at phone sizes, a coach-advice audit. | weekly 65% → 66% |
| 6 Nov 05:00–08:20Z | QA round: coach audit, exploratory play; fixes merged | Coach audit (964 decisions; maths sound): [#82](https://github.com/romanbitca/rb-pocker/pull/82) strategy (fold-equity model, 2.5% column, push/fold solver set, small pairs; `local-ci` ✅ f2f6b24 → a9252dd), [#83](https://github.com/romanbitca/rb-pocker/pull/83) words and hand classes (weak outs decide open question Q; audit after both: misleading words 208 → 4, wrong actions 12 → 2, both correct). Exploratory QA (~400 hands, both browsers, 5 sizes, Large text): [#84](https://github.com/romanbitca/rb-pocker/pull/84) layout (Stats pan, landscape coach row, toasts over the top bar, Undo reason, 44 px selects, drill button). The owner heard the test browsers' sounds: run stopped, [#85](https://github.com/romanbitca/rb-pocker/pull/85) mutes them. Owner OK → Cloudflare cache rule (R22 closed). Coach-fixes train (#83, #84, #85) tip 82ebf8e `local-ci` ✅ 19 min, unit 3708, e2e 481 (1 flaky) → 511ed90, f609502, 4896973. | weekly 66% → 71% |
| 6 Nov 08:14–09:55Z | `--slow` after the coach fixes | The first `local-slow` on main cb9d4d0 failed on a timeout (the 1M-hand settlement differential, 1,258 s against 900 s): the second QA agent's browsers ran at nice 0 (its commands carry a relative path, so the renice loop missed them; it now also matches by working directory). Re-run ✅ in 56 min (self-play 42 min at a load of up to ~200; Lighthouse 94/100/100). All automated checks pass on main with the coach fixes. Release PR [#86](https://github.com/romanbitca/rb-pocker/pull/86) (v1.0.0) is ready and waits for 9.8. | weekly 71% → 73% |
| 6 Nov 10:00–12:25Z | QA round 2 merged | Second exploratory QA (~450 hands on the final build): [#88](https://github.com/romanbitca/rb-pocker/pull/88) coach words and grades (a river call with the nuts no longer "Big mistake"; whose stack is short; one likely-hands number in hint, grade and summary; committed calls at the price; no shove words facing an all-in; heads-up words; ">99%"), [#87](https://github.com/romanbitca/rb-pocker/pull/87) layout (landscape coach row on every phone on its side; toasts over the top bar's title only, never its buttons, after its first `local-ci` caught a toast covering the Hands button; the badge fits "100%"). Train tip 31b6ea3 `local-ci` ✅ 14 min, unit 3734, e2e 483 (1 flaky: `data.spec.ts:79`, seed-dependent) → ed952df, f25e3ab. Load reached ~415 (the owner's Docker projects) during #87's first run. The release PR #86 (v1.0.0, green on its own) waits for 9.8. | weekly 73% → 77% |
| 6 Nov 12:22–13:04Z | `--slow` after round 2 | `local-slow` on main 957eea6: long tests, tables and the 10 self-play gates ✅; the enforced long-task check ✗ at a load of 105–130 (the owner's Docker projects): 5 tasks of 50–73 ms at 6×. Re-run twice in the kept worktree at load < 12: 0 tasks over 50 ms, all speed checks ✅ (R17: the check is load-sensitive). Lighthouse not reached; the full `--slow` runs again after `feature/hand-summary-on-demand`. | weekly 77% → 78% |
| 6 Nov 14:02–15:25Z | Final `--slow`; release PR green | `local-slow` on main 637a169: long tests, tables and the 10 self-play gates ✅; the enforced long-task check ✗ at a load of ~155. Calm re-runs of that check, then an A/B at the same load (6–9) with alternating runs: before #89 (957eea6) 2 of 3 runs failed (up to 325 ms), after #89 (637a169) 2 of 3 failed (up to 80 ms). So the button didn't cause it: the check is sensitive to this Mac's load (R17); the owner's Docker projects keep the 15-minute load at 35–155. Lighthouse ran last on cb9d4d0 (94/100/100); #89 only changes the hand-end banner. Release PR [#86](https://github.com/romanbitca/rb-pocker/pull/86) rebased on 637a169 with CHANGELOG updated: `local-ci` ✅ 1ccdb0a, 17 min, unit 3744, e2e 484. Waiting for the owner's 9.8 results; nothing is pushed to main meanwhile, so the live app doesn't change under the test. | weekly 78% → 79% |
| 6 Nov 15:30–18:15Z | Owner request: next hand on tap | The owner, testing: "when game end and i see result, it must not start automatically" (since #89 no summary sheet held the next hand). [#90](https://github.com/romanbitca/rb-pocker/pull/90): "Deal the next hand by itself" off by default; old profiles switch once (`Settings.defaultsRev`). `local-ci` ✅ 85a74fc → 4f7e317. **Weekly reset 6 Nov 18:00Z:** 79% at the end; from now on the 80% weekly cap, don't stop. | weekly 79% → 0% (reset) |
| 8 Nov 22:50–23:20Z | Gold edge and flake fixes merged | The owner: "ok good. now do a set of improvements, and create a telegram bot web app… work all night". Gold-edge train (#92, #93): the first run failed one old leak test on the new screen-reader suffix (fixed); then check and e2e ✅ (unit 3772, e2e 488, no flakes). Docker Desktop was off, so the header checks ran on the server started directly; `--no-docker` added (#94). Merged 25dfc72, 89ba847, e006657. | weekly 4% |
| 8–9 Nov 23:30–02:00Z | Improvements merged; Stage 10 server and client foundations merged | Product review → three chunks (#106 hand end at the thumb, #107 no cut words + one gold rule, #102 Review decisions + leaks + Drill fit): train tip 1962a76 `local-ci` ✅ unit 4865, e2e 562 (no image built, Docker off). Stage 10 so far: design #95; trains: #98 (10.1) 7864aa3; #96, #100, #97, #99 (10.2, 10.5, 10.6, 10.7) 748c697; #104, #101 (10.8, 10.11) 25766ac; #103, #105 (10.3, 10.4) 28d58df; #109 hardening d4f5363 (a security review proved no leak, no forged login, no act-for-others; the DoS findings were fixed). Coolify built the image with the generated engine copy (deploy of 748c697: check-deploy ✅). Open: #108 (10.9 screens), 10.10 E2E (agent). | weekly 4% → see the next row |
