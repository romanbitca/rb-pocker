#!/usr/bin/env bash
# Local CI (PLAN §17.5). Runs the steps of the `check`, `e2e` and `docker` workflows against one
# commit, in a clean worktree, and with --post reports the result to GitHub as the commit status
# `local-ci`. The owner decided on 13 Oct 2026 that CI runs on the dev Mac: the private
# repository's free GitHub Actions minutes ran out, and the workflows now run only by hand.
#
#   scripts/ci-local.sh [<ref>] [--post] [--only check,e2e,docker] [--slow] [--keep]
#
#   <ref>    the commit to test: a SHA, a branch, origin/<branch> or pr/<number> (default HEAD;
#            uncommitted changes are never tested)
#   --post   post the commit status (pending, then success or failure); `local-ci` needs all
#            three jobs
#   --only   run some of the jobs (never posts)
#   --slow   run the `slow` workflow's steps instead: the long tests, the tables made again, the
#            self-play gates and the enforced speed checks (status `local-slow`)
#   --keep   keep the worktree after a passing run (a failing run always keeps it, with the
#            Playwright report)
#
# The first failing step ends the run. Logs go to $CI_DIR/logs. One run at a time: a second run
# waits for the first. Environment: GH, the GitHub CLI used to post (default: .loop/gh of the main
# checkout when it exists, else gh); CI_PORT, the e2e server's port (default 3100, so a server
# already on port 3000 is never tested by mistake); CI_DOCKER_PORT, the container's host port
# (default 3200); CI_DIR, where worktrees and logs go (default ~/.cache/rb-pocker-ci, the same for
# every shell and agent on the machine, so the one-run lock holds).
set -euo pipefail

die() {
  echo "ci-local: $*" >&2
  exit 2
}

REF=HEAD
POST=0
ONLY=check,e2e,docker
SLOW=0
KEEP=0
while [ $# -gt 0 ]; do
  case $1 in
    --post) POST=1 ;;
    --only)
      [ $# -ge 2 ] || die "--only needs a list, e.g. --only check,e2e"
      ONLY=$2
      shift
      ;;
    --slow) SLOW=1 ;;
    --keep) KEEP=1 ;;
    -h | --help)
      sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    -*) die "unknown option $1 (see --help)" ;;
    *) REF=$1 ;;
  esac
  shift
done
for job in ${ONLY//,/ }; do
  case $job in check | e2e | docker) ;; *) die "unknown job $job (check, e2e, docker)" ;; esac
done
if [ "$POST" = 1 ] && [ "$SLOW" = 0 ] && [ "$ONLY" != check,e2e,docker ]; then
  die "--post needs the full suite (no --only)"
fi

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
# The main checkout (this may be a linked worktree): its .loop/gh posts as the repo's owner.
MAIN=$(dirname "$(cd "$(git rev-parse --git-common-dir)" && pwd)")
SLUG=$(git remote get-url origin | sed -E 's#^(git@|ssh://git@|https://)github\.com[:/]##; s#\.git$##')
if [ -z "${GH:-}" ]; then
  if [ -x "$MAIN/.loop/gh" ]; then GH=$MAIN/.loop/gh; else GH=gh; fi
fi
CI_DIR=${CI_DIR:-$HOME/.cache/rb-pocker-ci}
CI_DIR=${CI_DIR%/}
CI_PORT=${CI_PORT:-3100}
CI_DOCKER_PORT=${CI_DOCKER_PORT:-3200}
CONTEXT=local-ci
[ "$SLOW" = 1 ] && CONTEXT=local-slow

# Node from .nvmrc. Homebrew's node@<major> is used when it is installed but not linked.
NODE_MAJOR=$(tr -dc '0-9.' < .nvmrc | cut -d. -f1)
if [ -d "/opt/homebrew/opt/node@$NODE_MAJOR/bin" ]; then
  PATH="/opt/homebrew/opt/node@$NODE_MAJOR/bin:$PATH"
  export PATH
fi
[ "$(node -p 'process.versions.node.split(".")[0]')" = "$NODE_MAJOR" ] ||
  die "Node $NODE_MAJOR is needed (.nvmrc), node -v says $(node -v)"

case $REF in
  pr/*)
    git fetch -q origin "pull/${REF#pr/}/head" || die "no pull request ${REF#pr/}"
    SHA=$(git rev-parse FETCH_HEAD)
    ;;
  *)
    git fetch -q origin || echo "ci-local: git fetch failed, using the local refs" >&2
    SHA=$(git rev-parse --verify -q "$REF^{commit}") || die "unknown ref $REF"
    ;;
esac
SHORT=$(printf %.12s "$SHA")

mkdir -p "$CI_DIR"
LOCK=$CI_DIR/lock
while ! mkdir "$LOCK" 2> /dev/null; do
  holder=$(cat "$LOCK/pid" 2> /dev/null || true)
  if [ -n "$holder" ] && ! kill -0 "$holder" 2> /dev/null; then
    rm -rf "$LOCK"
    continue
  fi
  echo "ci-local: waiting for another run (pid ${holder:-?})"
  sleep 30
done
echo $$ > "$LOCK/pid"

WT=$CI_DIR/wt-$SHORT
LOGS=$CI_DIR/logs/$SHORT-$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$LOGS"
PROJECT=rb-ci-$(printf %.7s "$SHA")
DOCKER_UP=0
POSTED=0
FAILED=""
SUMMARY=""
T0=$(date +%s)

post() { # post <state> <description>
  [ "$POST" = 1 ] || return 0
  "$GH" api -X POST "repos/$SLUG/statuses/$SHA" -f state="$1" -f context="$CONTEXT" \
    -f description="$(printf %.140s "$2")" > /dev/null || echo "ci-local: could not post the status" >&2
}

cleanup() {
  local code=$?
  if [ "$DOCKER_UP" = 1 ]; then
    (cd "$WT" && HOST_PORT=$CI_DOCKER_PORT docker compose -p "$PROJECT" down --rmi local > /dev/null 2>&1) || true
  fi
  if [ "$POSTED" = 0 ]; then post error "the run stopped early (exit $code)"; fi
  rm -rf "$LOCK"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

step() { # step <job> <name> <command...>: runs in the worktree, output appended to <job>.log
  local job=$1 name=$2 t1 log
  shift 2
  log=$LOGS/$job.log
  t1=$(date +%s)
  printf '▶ %-6s %s\n' "$job" "$name"
  printf '\n===== %s: %s\n$ %s\n' "$job" "$name" "$*" >> "$log"
  if (cd "$WT" && "$@") >> "$log" 2>&1; then
    SUMMARY="$SUMMARY✓ $job: $name ($(($(date +%s) - t1)) s)"$'\n'
    return 0
  fi
  SUMMARY="$SUMMARY✗ $job: $name ($(($(date +%s) - t1)) s)"$'\n'
  FAILED="$job: $name"
  echo "✗ $job: $name failed. The end of $log:"
  tail -n 60 "$log"
  return 1
}

port_free() { # port_free <port>
  if lsof -nP -iTCP:"$1" -sTCP:LISTEN > /dev/null 2>&1; then
    echo "✗ port $1 is in use (set CI_PORT or CI_DOCKER_PORT):"
    lsof -nP -iTCP:"$1" -sTCP:LISTEN | tail -n +2
    FAILED="port $1 in use"
    return 1
  fi
}

# The steps of .github/workflows/check.yml.
job_check() {
  step check "typecheck" npm run typecheck || return 1
  step check "lint" npm run lint || return 1
  step check "format" npm run format:check || return 1
  step check "unit and property tests, coverage thresholds" npm run test:coverage || return 1
  step check "volume and timing tests" npm run test:volume || return 1
  step check "server tests" npm test -w @rb/server || return 1
  step check "generated tables" npm run gen:check || return 1
  step check "coach copy" npm run check:copy -w @rb/web || return 1
  step check "build" npm run build || return 1
  step check "size budget" npm run size || return 1
  step check "index.html: no inline script, meta CSP" npm run check:html -w @rb/web
}

# The steps of .github/workflows/e2e.yml. Like the runner: the speed checks only report, and a
# failed test gets one retry (a test that passes on the retry is counted as flaky).
job_e2e() {
  port_free "$CI_PORT" || return 1
  step e2e "E2E build" npm run build:e2e || return 1
  step e2e "browsers" npx playwright install chromium webkit || return 1
  step e2e "Playwright: Chromium + WebKit, six sizes" \
    env PORT="$CI_PORT" PERF_REPORT_ONLY=1 npm run e2e -- --retries=1
}

# The steps of .github/workflows/docker.yml, on host port CI_DOCKER_PORT.
job_docker() {
  port_free "$CI_DOCKER_PORT" || return 1
  docker info > /dev/null 2>&1 || {
    FAILED="docker: Docker is not running"
    echo "✗ Docker is not running: start Docker Desktop"
    return 1
  }
  DOCKER_UP=1
  if ! step docker "image builds, container healthy" env SOURCE_COMMIT="$SHA" HOST_PORT="$CI_DOCKER_PORT" \
    docker compose -p "$PROJECT" up --build --detach --wait --wait-timeout 180 ||
    ! step docker "headers, cache rules, health, no cookies" \
      node scripts/check-deploy.mjs "http://localhost:$CI_DOCKER_PORT" --commit "$SHA"; then
    (cd "$WT" && HOST_PORT=$CI_DOCKER_PORT docker compose -p "$PROJECT" logs) >> "$LOGS/docker.log" 2>&1 || true
    return 1
  fi
  # --rmi local: the image built for this run goes too (the build cache stays).
  step docker "stop the container" env HOST_PORT="$CI_DOCKER_PORT" \
    docker compose -p "$PROJECT" down --rmi local || return 1
  DOCKER_UP=0
}

# The self-play runs of .github/workflows/slow.yml (keep the two lists in step). The runs with a
# decision-time gate go first, one at a time (a p95 is wall time); the rest run side by side.
SELFPLAY_TIMED=(
  "medium|--level medium --players 6 --hands 20000 --seed 1 --calibrate --max-p95 100"
  "expert|--level expert --players 6 --hands 20000 --seed 1 --max-p95 150"
)
SELFPLAY_PARALLEL=(
  "easy|--level easy --players 6 --hands 20000 --seed 1 --calibrate"
  "legality|--level mixed --players 2-9 --stacks random --hands 100000 --seed $(date +%s)"
  "hard|--level hard --players 6 --hands 20000 --seed 1 --calibrate --calibrate-stats vpip,pfr"
  "hard-vs-raise-always|--level hard --lineup raiseAlways,tag,lag,rock,tag,lag --hands 20000 --seed 1 --loses raiseAlways --wins hard"
  "hard-vs-call-always|--level hard --lineup callAlways,tag,lag,rock,tag,lag --hands 20000 --seed 1 --loses callAlways --wins hard"
  "pot-bettor-vs-hard|--level hard --lineup potBettor,tag,lag,rock,tag,lag --hands 20000 --seed 1 --loses potBettor --wins hard"
  "expert-vs-medium|--lineup tag@medium,tag@expert,lag@medium,lag@expert,rock@medium,rock@expert --hands 20000 --seed 1 --wins expert --loses medium"
  "coach-vs-easy|--level easy --lineup coach,station,station,maniac,station,rock --hands 20000 --seed 1 --wins coach"
)

selfplay_all() {
  local run name args pid fail=0 pids=""
  for run in "${SELFPLAY_TIMED[@]}"; do
    name=${run%%|*}
    args=${run#*|}
    # shellcheck disable=SC2086 # the arguments are split on purpose
    npm run selfplay -- $args --quiet > "$LOGS/selfplay-$name.log" 2>&1 || {
      echo "✗ self-play $name (see $LOGS/selfplay-$name.log)"
      fail=1
    }
  done
  for run in "${SELFPLAY_PARALLEL[@]}"; do
    name=${run%%|*}
    args=${run#*|}
    # shellcheck disable=SC2086
    npm run selfplay -- $args --quiet > "$LOGS/selfplay-$name.log" 2>&1 &
    pids="$pids $!:$name"
  done
  for run in $pids; do
    pid=${run%%:*}
    name=${run#*:}
    wait "$pid" || {
      echo "✗ self-play $name (see $LOGS/selfplay-$name.log)"
      fail=1
    }
  done
  return $fail
}

# The steps of .github/workflows/slow.yml, except Lighthouse (Stage 9) and the deploy check.
job_slow() {
  step slow "long tests (exhaustive, statistical, large property runs)" npm run test:slow || return 1
  step slow "tables made again are byte-identical" \
    sh -c 'npm run gen && git diff --exit-code -- apps/web/src/data/generated' || return 1
  step slow "self-play gates (10 runs)" selfplay_all || return 1
  port_free "$CI_PORT" || return 1
  step slow "speed checks of Stages 4 and 6, enforced" \
    env PORT="$CI_PORT" npm run e2e:perf -- --grep "Stage [46]"
}

echo "ci-local: $CONTEXT for $SHORT ($REF) in $WT"
post pending "running on the dev Mac since $(date -u +%H:%MZ)"
# A failing run keeps its worktree; this one's goes now, and any kept for more than two days.
for old in "$WT" $(find "$CI_DIR" -maxdepth 1 -name 'wt-*' -mtime +2); do
  [ -e "$old" ] || continue
  git worktree remove --force "$old" > /dev/null 2>&1 || rm -rf "$old"
done
git worktree prune
git worktree add -q --detach "$WT" "$SHA"

run_all() {
  step setup "npm ci" npm ci --no-audit --no-fund || return 1
  if [ "$SLOW" = 1 ]; then
    job_slow
    return
  fi
  case ",$ONLY," in *,check,*) job_check || return 1 ;; esac
  case ",$ONLY," in *,e2e,*) job_e2e || return 1 ;; esac
  case ",$ONLY," in *,docker,*) job_docker || return 1 ;; esac
}
run_all || true

MINUTES=$((($(date +%s) - T0 + 59) / 60))
count() { # count <log> <regex>: the number in each matching line (colours stripped), never fails
  [ -f "$1" ] || return 0
  perl -pe 's/\e\[[0-9;]*m//g' "$1" | grep -Eo "$2" | grep -Eo '[0-9]+' || true
}
UNIT=$(count "$LOGS/check.log" 'Tests +[0-9]+ passed' | awk '{ s += $1 } END { print s + 0 }')
E2E=$(count "$LOGS/e2e.log" '^ +[0-9]+ passed' | tail -n 1)
FLAKY=$(count "$LOGS/e2e.log" '^ +[0-9]+ flaky' | tail -n 1)

printf '\n%s' "$SUMMARY"
if [ -z "$FAILED" ]; then
  DESC="passed in $MINUTES min"
  [ "$UNIT" != 0 ] && DESC="$DESC · unit $UNIT"
  [ -n "$E2E" ] && DESC="$DESC · e2e $E2E"
  [ -n "$FLAKY" ] && DESC="$DESC ($FLAKY flaky)"
  echo "✓ $CONTEXT $SHORT: $DESC"
  post success "$DESC"
  POSTED=1
  if [ "$KEEP" = 0 ]; then git worktree remove --force "$WT" && git worktree prune; fi
  echo "logs: $LOGS"
  exit 0
fi
DESC="failed: $FAILED ($MINUTES min)"
echo "✗ $CONTEXT $SHORT: $DESC"
post failure "$DESC"
POSTED=1
echo "logs: $LOGS"
echo "worktree kept: $WT (playwright report: $WT/apps/web/playwright-report)"
exit 1
