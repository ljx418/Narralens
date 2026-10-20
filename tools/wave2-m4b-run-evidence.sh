#!/usr/bin/env bash
# M4B append-only, headless evidence capture. Historical current-tip integrity failures are
# recorded verbatim and are not converted into green results.
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
  echo "git_head=$CAPTURE_SHA"
  echo "git_branch=$(git branch --show-current)"
  echo "repo_dirty_at_capture=$DIRTY"
  echo "origin_main=$(git rev-parse origin/main)"
  echo "openfilm_upstream=e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3"
  echo "declaration_ceiling=M4B_INTERNAL_EVIDENCED"
  echo "interaction=headless,muted,no-window,no-focus-steal,no-network,no-payment"
} > "$LOGS/environment.txt"

overall=0
run() {
  local name="$1"; shift
  printf '%q ' "$@" > "$LOGS/$name.cmd"; printf '\n' >> "$LOGS/$name.cmd"
  "$@" > "$LOGS/$name.txt" 2>&1
  local code=$?
  printf '%s\n' "$code" > "$LOGS/$name.exit"
  printf '%-24s exit=%s\n' "$name" "$code"
  [ "$code" -eq 0 ] || overall=1
}
record_expected_failure() {
  local name="$1"; shift
  printf '%q ' "$@" > "$LOGS/$name.cmd"; printf '\n' >> "$LOGS/$name.cmd"
  "$@" > "$LOGS/$name.txt" 2>&1
  local code=$?
  printf '%s\n' "$code" > "$LOGS/$name.exit"
  printf '%-24s exit=%s (historical current-tip assertion; expected non-zero)\n' "$name" "$code"
  [ "$code" -ne 0 ] || overall=1
}

echo "== M4B capture at ${CAPTURE_SHA:0:7} (dirty=$DIRTY) =="
run check                 corepack pnpm check
run typecheck             corepack pnpm exec tsc --noEmit
run contracts             corepack pnpm test:contracts
run m2.1                  corepack pnpm test:m2.1
run wave2-w2.0            corepack pnpm test:wave2:w2.0
run wave2-m3              corepack pnpm test:wave2:m3
run wave2-m4a             corepack pnpm test:wave2:m4a
run wave2-m4b             corepack pnpm test:wave2:m4b
run wave2-fitness         corepack pnpm test:wave2:fitness
run build                 corepack pnpm build
run wave1-historical      corepack pnpm evidence:wave1:historical
run m4a-historical        corepack pnpm evidence:wave2:m4a:historical
record_expected_failure wave1-integrity corepack pnpm evidence:wave1:integrity
record_expected_failure m4a-integrity corepack pnpm evidence:wave2:m4a:integrity

printf '%s\n' "NARRALENS_SECRET_SCAN_OUT=$LOGS/credential-scan.json corepack pnpm exec tsx tools/secret-scan.ts" > "$LOGS/credential-scan.cmd"
NARRALENS_SECRET_SCAN_OUT="$LOGS/credential-scan.json" \
  corepack pnpm exec tsx tools/secret-scan.ts > "$LOGS/credential-scan.txt" 2>&1
code=$?
printf '%s\n' "$code" > "$LOGS/credential-scan.exit"
printf '%-24s exit=%s\n' credential-scan "$code"
[ "$code" -eq 0 ] || overall=1

git status --porcelain > "$LOGS/git-status-after.txt"
echo "overall=$overall"
echo "logs=$LOGS"
exit "$overall"
