#!/usr/bin/env bash
# M4A evidence capture. Append-only; never overwrites a previous capture.
#
# Separate from the M3 runner because M4A has its own scope, its own reviewer and its own
# declaration ceiling. The M3 captures stay exactly where they are — including the failed
# capture at 14cc3b6, which is the record of the two root causes M4A-0 had to close around.
#
# Usage: bash tools/wave2-m4a-run-evidence.sh
set -u
cd "$(dirname "$0")/.." || exit 1

CAPTURE_SHA="$(git rev-parse HEAD)"
LOGS="docs/evidence/WAVE2/logs/$CAPTURE_SHA"
if [ -d "$LOGS" ]; then
  echo "capture $CAPTURE_SHA already exists; evidence is append-only" >&2
  exit 2
fi
mkdir -p "$LOGS"

DIRTY="$(git status --porcelain | wc -l | tr -d ' ')"
{
  echo "date_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "node=$(node -v)"
  echo "pnpm=$(corepack pnpm -v)"
  echo "python=$(python3 -V 2>&1)"
  echo "os=$(uname -sr)"
  echo "git_head=$CAPTURE_SHA"
  echo "git_branch=$(git rev-parse --abbrev-ref HEAD)"
  echo "repo_dirty_at_capture=$DIRTY"
  echo "origin_main=$(git rev-parse origin/main 2>/dev/null || echo unknown)"
  echo "openfilm_upstream=e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3"
  echo "vitest_max_workers=2"
  echo "declaration_ceiling=M4A_INTERNAL_EVIDENCED"
  echo "interaction=headless,muted,no-window,no-focus-steal,no-network,no-payment"
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

echo "== M4A capture at ${CAPTURE_SHA:0:7} (dirty=$DIRTY) =="

# The full gate twice, recorded, never re-rolled.
for attempt in 1 2; do
  run "check-$attempt" corepack pnpm check
done

run typecheck       corepack pnpm exec tsc --noEmit
run contracts       corepack pnpm test:contracts
run wave2-m4a       corepack pnpm test:wave2:m4a
run wave2-m3        corepack pnpm test:wave2:m3
run wave2-w2.0      corepack pnpm test:wave2:w2.0
run m2.1            corepack pnpm test:m2.1
run wave2-fitness   corepack pnpm test:wave2:fitness
run wave1-historical corepack pnpm evidence:wave1:historical
run openfilm        corepack pnpm exec tsx tools/openfilm-availability-probe.mjs

# M4A-H01's independent implementation. A second program, written from the ADR, hashing the
# same frozen vectors: the TypeScript proving it is deterministic is not the claim.
run hash-vectors-python corepack pnpm test:wave2:m4a:golden-python

# The frozen vector file is regenerated into a scratch copy and compared, so a drift in the
# canonical rules cannot pass unnoticed just because both sides moved together.
run hash-vectors-regen corepack pnpm test:wave2:m4a:vectors

printf '%s\n' "NARRALENS_SECRET_SCAN_OUT=docs/evidence/WAVE2/security/credential-scan-m4a.json corepack pnpm exec tsx tools/secret-scan.ts" > "$LOGS/credential-scan.cmd"
NARRALENS_SECRET_SCAN_OUT=docs/evidence/WAVE2/security/credential-scan-m4a.json \
  corepack pnpm exec tsx tools/secret-scan.ts > "$LOGS/credential-scan.txt" 2>&1
code=$?
printf '%s\n' "$code" > "$LOGS/credential-scan.exit"
printf '%-22s exit=%s\n' "credential-scan" "$code"
[ "$code" -eq 0 ] || overall=1

# Expected to fail: it asserts no code moved after the Wave 1 freeze, and Wave 2 moved code
# twice. Recorded verbatim and never tuned green.
printf '%s\n' "corepack pnpm evidence:wave1:integrity" > "$LOGS/wave1-integrity.cmd"
corepack pnpm evidence:wave1:integrity > "$LOGS/wave1-integrity.txt" 2>&1
code=$?
printf '%s\n' "$code" > "$LOGS/wave1-integrity.exit"
printf '%-22s exit=%s (expected: asserts no code moved since the Wave 1 freeze)\n' \
  "wave1-integrity" "$code"

git status --porcelain > "$LOGS/git-status-after.txt"
echo "overall=$overall"
echo "logs=$LOGS"
