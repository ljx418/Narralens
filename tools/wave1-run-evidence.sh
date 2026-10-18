#!/usr/bin/env bash
# Wave 1 combined evidence capture.
#
# Runs every gate once, on the tree as it stands, into a per-capture log directory. The
# manifest and its integrity check are written separately so the capture can be committed
# before the manifest that references it exists.
#
# Usage: bash tools/wave1-run-evidence.sh
set -u
cd "$(dirname "$0")/.." || exit 1

CAPTURE_SHA="$(git rev-parse --short HEAD)"
LOGS="docs/evidence/WAVE1/logs/$CAPTURE_SHA"
if [ -d "$LOGS" ]; then
  echo "evidence directory $LOGS already exists; capture from a new commit" >&2
  exit 2
fi
mkdir -p "$LOGS" docs/evidence/WAVE1/reviews

{
  echo "date_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "node=$(node -v)"
  echo "pnpm=$(corepack pnpm -v)"
  echo "python=$(python3 -V 2>&1)"
  echo "os=$(uname -sr)"
  echo "git_head=$(git rev-parse HEAD)"
  echo "git_branch=$(git rev-parse --abbrev-ref HEAD)"
  echo "code_note=gates in this directory were produced by this commit"
} > "$LOGS/environment.txt"

overall=0
run() {
  local name="$1"; shift
  printf '%s\n' "$*" > "$LOGS/$name.cmd"
  "$@" > "$LOGS/$name.txt" 2>&1
  local code=$?
  printf '%s\n' "$code" > "$LOGS/$name.exit"
  printf '%-18s exit=%s\n' "$name" "$code"
  [ "$code" -eq 0 ] || overall=1
}

echo "== Wave 1 combined gates at $CAPTURE_SHA =="
run check           corepack pnpm check
run contracts       corepack pnpm test:contracts
run m2.1            corepack pnpm test:m2.1
run m2.2            corepack pnpm exec vitest run --config vitest.config.ts tests/m2.2
run m2.3            corepack pnpm exec vitest run --config vitest.config.ts tests/m2.3
run golden          python3 -I tests/m2.1-golden/source-digest-v1.golden.py tests/m2.1-golden/source-digest-v1.vectors.json
run mutation        bash tools/m2.1-gate-mutation-check.sh "$LOGS"
run doc-consistency corepack pnpm check:m2.1-docs
# Informational, not a gate: once a later Wave 1 ticket builds on an earlier one, that
# ticket's own "no code changed since my freeze" check is expected to report movement. The
# combined capture re-ran every gate that matters here, so the result is recorded verbatim
# and explained rather than silently turned green or silently ignored.
printf '%s\n' "corepack pnpm evidence:m2.2:integrity" > "$LOGS/m2.2-integrity.cmd"
corepack pnpm evidence:m2.2:integrity > "$LOGS/m2.2-integrity.txt" 2>&1
printf '%s\n' "$?" > "$LOGS/m2.2-integrity.exit"
printf '%-18s exit=%s (informational)\n' "m2.2-integrity" "$(cat "$LOGS/m2.2-integrity.exit")"

echo "overall=$overall"
exit "$overall"
