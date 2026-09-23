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
- GitHub: `romanbitca/rb-pocker` (private), `romanbitca` gh account, local email `me@romanbitca.com`.

## Environment

- Node 24 LTS (`.nvmrc`), installed as Homebrew `node@24` but **not linked** (the global default
  stays Node 22 for the owner's other projects). Prefix every node/npm/npx command in this repo with
  `PATH=/opt/homebrew/opt/node@24/bin:$PATH` and check `node -v` shows v24.
- Docker Desktop must be running for Docker checks.
- CI: the heavy `slow` job runs **weekly** (not nightly as PLAN §17.5 says) to save Actions
  minutes on this private repo.
- Owner tests on a phone and is not a native English speaker: keep user-facing copy plain,
  and keep notifications/reports short.
