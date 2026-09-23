# rb-pocker

## Usage budget (mandatory)

The owner runs several projects in parallel, so this project may consume only a
fixed slice of the Claude plan.

- **Budget: 30 percentage points of the 5-hour limit per window.** Record the
  5-hour `percentUsed` at the start of a window as the *baseline*; stop when
  usage reaches `baseline + 30`. Example: baseline 50% → stop at 80%.
  The absolute value doesn't matter, only how much this project adds.
- **Check before every chunk of work** (one task/feature) with
  `mcp__ccd_session_mgmt__get_usage`. Chunks should be small enough that one
  chunk can't blow far past the budget.
- **When the budget is spent:** commit and push the work in progress, update the
  progress in the plan, then pause (`ScheduleWakeup`, chained up to the 3600s max)
  until the 5-hour window resets. After the reset, take a new baseline and continue.
- **Hard ceilings regardless of budget:** never push the 5-hour window above 95%,
  and don't start new work while the weekly all-models limit is at or above 95%.
  Wait for the relevant reset instead.
- Continuous work requires the session to be running in `/loop` (dynamic mode).

## Workflow

- GitHub: `romanbitca/rb-pocker`, using the `romanbitca` gh account.
- Git is fully delegated to Claude: create branches, commit, push, and merge as judged best.
- Branch names must describe the actual feature being built, e.g.
  `feature/table-lobby`, `feature/hand-evaluator`, `fix/pot-split-rounding`.
  Never use generic names like `claude/...`, `wip`, `dev`, or `branch-1`.
- Commit and push after each completed chunk so progress is never lost.
- Track progress as checkboxes in the plan file so work resumes cleanly after a pause.
