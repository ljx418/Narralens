#!/usr/bin/env bash
# M3 evidence capture. Append-only; never overwrites a previous capture.
#
# Separate from `tools/w2.0-run-evidence.sh` because M3 has its own scope and its own
# reviewer. The older W2.0 captures stay exactly where they are, including their failures:
# B4 of the Codex review was partly a manifest that described a tree it was no longer
# describing, and rewriting the old one would have destroyed the record of that.
#
# Usage: bash tools/wave2-m3-run-evidence.sh
set -u
cd "$(dirname "$0")/.." || exit 1

CAPTURE_SHA="$(git rev-parse HEAD)"
LOGS="docs/evidence/WAVE2/logs/$CAPTURE_SHA"
if [ -d "$LOGS" ]; then
  echo "capture $CAPTURE_SHA already exists; evidence is append-only" >&2
  exit 2
fi
mkdir -p "$LOGS" docs/evidence/WAVE2/reviews

DIRTY="$(git status --porcelain | wc -l | tr -d ' ')"
{
  echo "date_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "node=$(node -v)"
  echo "pnpm=$(corepack pnpm -v)"
  echo "os=$(uname -sr)"
  echo "git_head=$CAPTURE_SHA"
  echo "git_branch=$(git rev-parse --abbrev-ref HEAD)"
  echo "repo_dirty_at_capture=$DIRTY"
  echo "origin_main=$(git rev-parse origin/main 2>/dev/null || echo unknown)"
  echo "openfilm_upstream=e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3"
  echo "vitest_max_workers=2"
} > "$LOGS/environment.txt"

overall=0
run() {
  local name="$1"; shift
  printf '%s\n' "$*" > "$LOGS/$name.cmd"
  "$@" > "$LOGS/$name.txt" 2>&1
  local code=$?
  printf '%s\n' "$code" > "$LOGS/$name.exit"
  printf '%-22s exit=%s\n' "$name" "$code"
  [ "$code" -eq 0 ] || overall=1
}

echo "== M3 capture at ${CAPTURE_SHA:0:7} (dirty=$DIRTY) =="

# The full gate is run and recorded, never re-rolled. Two attempts is the requirement; every
# attempt is kept with its own log.
for attempt in 1 2; do
  run "check-$attempt" corepack pnpm check
done

run contracts       corepack pnpm test:contracts
run m2.1            corepack pnpm test:m2.1
run m2.2            corepack pnpm exec vitest run tests/m2.2
run m2.3            corepack pnpm exec vitest run tests/m2.3
run wave2-w2.0      corepack pnpm test:wave2:w2.0
run wave2-m3        corepack pnpm test:wave2:m3
run wave2-fitness   corepack pnpm test:wave2:fitness
run wave1-historical corepack pnpm evidence:wave1:historical
run openfilm        corepack pnpm exec tsx tools/openfilm-availability-probe.mjs

printf '%s\n' "NARRALENS_SECRET_SCAN_OUT=docs/evidence/WAVE2/security/credential-scan-m3.json corepack pnpm exec tsx tools/secret-scan.ts" > "$LOGS/credential-scan.cmd"
NARRALENS_SECRET_SCAN_OUT=docs/evidence/WAVE2/security/credential-scan-m3.json \
  corepack pnpm exec tsx tools/secret-scan.ts > "$LOGS/credential-scan.txt" 2>&1
printf '%s\n' "$?" > "$LOGS/credential-scan.exit"
printf '%-22s exit=%s\n' "credential-scan" "$(cat "$LOGS/credential-scan.exit")"
[ "$(cat "$LOGS/credential-scan.exit")" -eq 0 ] || overall=1

# Expected to fail: it asserts no code moved after the Wave 1 freeze. Recorded verbatim.
printf '%s\n' "corepack pnpm evidence:wave1:integrity" > "$LOGS/wave1-integrity.cmd"
corepack pnpm evidence:wave1:integrity > "$LOGS/wave1-integrity.txt" 2>&1
printf '%s\n' "$?" > "$LOGS/wave1-integrity.exit"
printf '%-22s exit=%s (expected: asserts no code moved since the Wave 1 freeze)\n' \
  "wave1-integrity" "$(cat "$LOGS/wave1-integrity.exit")"

git status --porcelain > "$LOGS/git-status-after.txt"
echo "overall=$overall"
echo "logs=$LOGS"
