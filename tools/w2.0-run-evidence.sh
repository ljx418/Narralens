#!/usr/bin/env bash
# W2.0 correction evidence capture.
#
# Separate from the Wave 1 capture on purpose: `docs/evidence/WAVE1/` is frozen history and
# is never written again. This writes `docs/evidence/WAVE2/`, whose `logs/<capture-sha>/`
# is append-only.
#
# Two of the commands below are expected to fail, and their failures are the result:
#   - `evidence:wave1:integrity` asserts no code moved after the Wave 1 freeze, so any later
#     wave tip fails it by design. Its exit 1 is recorded verbatim and explained.
#   - nothing else here is expected to fail. A non-zero exit anywhere else is a real failure.
#
# Usage: bash tools/w2.0-run-evidence.sh
set -u
cd "$(dirname "$0")/.." || exit 1

CAPTURE_SHA="$(git rev-parse HEAD)"
SHORT_SHA="$(git rev-parse --short HEAD)"
LOGS="docs/evidence/WAVE2/logs/$CAPTURE_SHA"
if [ -d "$LOGS" ]; then
  echo "evidence directory $LOGS already exists; capture from a new commit" >&2
  exit 2
fi
mkdir -p "$LOGS" docs/evidence/WAVE2/reviews docs/evidence/WAVE2/security docs/evidence/WAVE2/cases

DIRTY="$(git status --porcelain | wc -l | tr -d ' ')"
{
  echo "date_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "node=$(node -v)"
  echo "pnpm=$(corepack pnpm -v)"
  echo "os=$(uname -sr)"
  echo "git_head=$CAPTURE_SHA"
  echo "git_branch=$(git rev-parse --abbrev-ref HEAD)"
  echo "git_head_short=$SHORT_SHA"
  echo "repo_dirty_at_capture=$DIRTY"
  echo "origin_main=$(git rev-parse origin/main 2>/dev/null || echo unknown)"
  echo "wave1_frozen_code=e2dec5ca03ee881b55f92b920ee6df2c676aeb26"
  echo "openfilm_upstream=e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3"
  echo "hypit_upstream=6fdd8c0f02c17b9970aee6deb4550a70e9d57acf"
} > "$LOGS/environment.txt"

overall=0
run() {
  local name="$1"; shift
  printf '%s\n' "$*" > "$LOGS/$name.cmd"
  "$@" > "$LOGS/$name.txt" 2>&1
  local code=$?
  printf '%s\n' "$code" > "$LOGS/$name.exit"
  printf '%-24s exit=%s\n' "$name" "$code"
  [ "$code" -eq 0 ] || overall=1
}

echo "== W2.0 correction gates at $SHORT_SHA (dirty=$DIRTY) =="
run check              corepack pnpm check
run contracts          corepack pnpm test:contracts
run m2.1               corepack pnpm test:m2.1
run m2.2               corepack pnpm exec vitest run tests/m2.2
run m2.3               corepack pnpm exec vitest run tests/m2.3
run wave2              corepack pnpm test:wave2:w2.0
run wave2-fitness      corepack pnpm test:wave2:fitness
run wave1-historical   corepack pnpm evidence:wave1:historical
run credential-scan    corepack pnpm evidence:m2.1:secret-scan
run doc-consistency    corepack pnpm check:m2.1-docs

# Expected to fail, and that is the finding: this gate asserts no code changed after the
# Wave 1 freeze, and W2.0 changed code. Recorded verbatim, never written up as PASS.
printf '%s\n' "corepack pnpm evidence:wave1:integrity" > "$LOGS/wave1-integrity.cmd"
corepack pnpm evidence:wave1:integrity > "$LOGS/wave1-integrity.txt" 2>&1
printf '%s\n' "$?" > "$LOGS/wave1-integrity.exit"
printf '%-24s exit=%s (expected: asserts no code moved since the Wave 1 freeze)\n' \
  "wave1-integrity" "$(cat "$LOGS/wave1-integrity.exit")"

# The pinned OpenFilm upstream, probed for real.
run openfilm-availability corepack pnpm exec tsx tools/openfilm-availability-probe.mjs

git status --porcelain > "$LOGS/git-status-after.txt"
git rev-parse HEAD > "$LOGS/git-head-after.txt"

echo "overall=$overall"
echo "logs=$LOGS"
