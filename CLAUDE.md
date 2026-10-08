# rb-pocker (RB Poker Coach)

- **What to build:** [docs/PLAN.md](docs/PLAN.md). It is the single source of truth: rules, maths,
  architecture, UX, copy, build order. If code and PLAN.md disagree, fix one of them in the same
  commit and note why in PLAN.md's "Open questions and risk register".
- **Where we are:** [docs/EXECUTION.md](docs/EXECUTION.md). This is the chunk checklist. Its
  "Current position" line names the next chunk.

## Usage budget (mandatory)

The owner runs several projects in parallel, so this project may consume only a
fixed slice of the Claude plan.

- **Budget: 30 percentage points of the 5-hour limit per window.** Record the
  5-hour `percentUsed` at the start of a window as the *baseline*; stop when
  usage reaches `baseline + 30`. Example: baseline 50% → stop at 80%.
  The absolute value doesn't matter, only how much this project adds.
- **Check before every chunk of work** with `mcp__ccd_session_mgmt__get_usage`, and again
  between sub-steps of a long chunk.
- **Baseline state** lives in `.loop/state.json` (gitignored):
  `{ "windowResetsAt": "<5-hour resetsAt>", "baseline": <percent> }`. If the current
  `resetsAt` differs from the stored one, a new window has started: write a new baseline.
- **When the budget is spent:** commit and push the work in progress (WIP commit on the
  feature branch is fine), update EXECUTION.md, then pause with `ScheduleWakeup`
  (max 3600 s each, chain them) until the 5-hour window resets. Then take a new baseline.
- **Hard ceilings regardless of budget:** never push the 5-hour window above 95%,
  and don't start new work while the weekly all-models limit is at or above 95%.
  Wait for the relevant reset instead.
- Continuous work requires the session to be running in `/loop` (dynamic mode).
- **Overnight override (owner, 2026-09-27 ~20:40Z, "use all, even 100%"):** no +30 project cap
  while the owner is away. Work each 5-hour window up to **95%** (not 100%: a rejected request can
  kill the session before it schedules its wake-up), stop spawning new subagents above ~88%, then
  wait for the reset. Weekly ceiling (95%) still applies. The override ends when the owner next
  writes a message; then the +30 rule applies again. **(Ended 28 Sep 08:01Z: +30 rule is back.)**
- **Day override (owner, 2026-09-29 19:37Z, "use 95% of today's usage"):** the current 5-hour window
  (resets 2026-09-29 22:20Z) may be used up to **95%**, same rules as the overnight override. After
  that reset (it is past midnight for the owner, UTC+3) the +30 rule applies again unless the owner
  says otherwise.
- **Day override (owner, 2026-09-30 21:11Z = 1 Oct local, "use 95% of today's usage" + "65"):**
  each 5-hour window may be used up to **95%**, but **stop all work when the weekly all-models limit
  reaches 65%** (it was 50%). Then pause until the owner writes again (the weekly resets
  2026-10-02 18:00Z). Rule of thumb: ~7 five-hour points ≈ 1 weekly point.
- **Weekly override (owner, 2026-10-01 20:36Z, "/loop now next. You are allowed to spend until 80%
  of weekly usage"):** each 5-hour window up to **95%**, and **stop all work when the weekly
  all-models limit reaches 80%** (it was 68%). Then pause until the owner writes again (weekly
  resets 2026-10-02 18:00Z).
- **Autonomous run (owner, 2026-10-08 20:25Z, "/loop continue work ... maximum use 80% of weekly
  usage; if daily usage runs out, wait until it's back and continue"):** each 5-hour window up to
  **95%**, wait for the reset, continue, and **stop all work when the weekly all-models limit
  reaches 80%** (it was 23%; resets 2026-10-09 18:00Z). Wake-up safety net: a session cron tick
  (CronCreate, every 15 min), background `sleep` timers, ScheduleWakeup, and a desktop-app scheduled
  task `rb-poker-watchdog` (hourly) that messages this session if `.loop/heartbeat` (Unix seconds,
  written every orchestrator turn) is older than 40 min. Disable the watchdog by writing
  `{"enabled": false}` to `.loop/watchdog.json`.
- **Order (owner, 2026-09-27): strict plan order.** Every acceptance criterion of a stage passes in
  CI before the next stage is merged. Development of the next stage MAY overlap (parallel branches),
  but merges happen in stage order and never onto a red `main`. Human gates `[H]` still don't block.

## Loop iteration protocol

Each wake-up:
1. `get_usage` → update `.loop/state.json` → if over budget, schedule the next wake-up and stop.
2. Read EXECUTION.md "Current position". `git fetch`, check out / create that chunk's branch.
3. Read the PLAN.md sections the chunk cites (not the whole 3,000-line file every time).
4. Implement with tests. Run the chunk's checks locally (typecheck, lint, tests, build).
5. Commit, push, open a PR, wait for CI; fix until green; squash-merge; delete the branch.
6. Tick the chunk in EXECUTION.md, advance "Current position", add a Log row. Commit on `main`.
7. Back to step 1.

Stop the loop entirely (and notify the owner) only when: every chunk is done, a prerequisite
needs the human (e.g. P1/P2 in EXECUTION.md), or the same CI failure survives three fix attempts.

## Git

- Git is fully delegated to Claude: create branches, commit, push, open and merge PRs.
- Branch names must describe the actual feature being built, e.g.
  `feature/hand-evaluator`, `fix/side-pot-odd-chip`. EXECUTION.md lists the planned name for
  every chunk. Never use generic names like `claude/...`, `wip`, `dev`, or `branch-1`.
- One chunk = one branch = one PR, squash-merged into `main` when CI is green.
- Commit messages follow PLAN §0.2 style (`feat(engine): ...`, `chore: ...`, `test: ...`).
- GitHub: `romanbitca/rb-pocker` (private), `romanbitca` account, local email `me@romanbitca.com`.
  The owner's **global** active gh account may be a different one (other projects need it): never
  run `gh auth switch`. `git push` works through a repo-local credential helper (in `.git/config`,
  shared by all worktrees). For `gh`, use the wrapper `/Users/romanbitca/work/code/rb-pocker/.loop/gh`
  (sets `GH_TOKEN` for `romanbitca`), e.g. `.loop/gh pr create ...`.

## Environment

- Node 24 LTS (`.nvmrc`), installed as Homebrew `node@24` but **not linked** (the global default
  stays Node 22 for the owner's other projects). Prefix every node/npm/npx command in this repo with
  `PATH=/opt/homebrew/opt/node@24/bin:$PATH` and check `node -v` shows v24.
- Docker Desktop must be running for Docker checks.
- CI: the heavy `slow` job runs **weekly** (not nightly as PLAN §17.5 says) to save Actions
  minutes on this private repo.
- Owner tests on a phone and is not a native English speaker: keep user-facing copy plain,
  and keep notifications/reports short.
