#!/usr/bin/env bash
# M2.1 evidence runner.
#
# Writes tracked evidence: `.txt` for stdout+stderr, `.exit` for the exit code, `.cmd` for the
# command line. `.log` is excluded by the repository's .gitignore, which is why M2.1 evidence
# uses `.txt`: a file nobody can clone is not evidence.
#
# Usage: bash tools/m2.1-run-evidence.sh
set -u
cd "$(dirname "$0")/.." || exit 1

LOGS="docs/evidence/M2/M2.1/logs"
ARTIFACTS="docs/evidence/M2/M2.1/artifacts"
rm -rf "$LOGS"
mkdir -p "$LOGS" "$ARTIFACTS" docs/evidence/M2/M2.1/screenshots

PINNED_VENDOR="/mnt/c/workspace/videoworkline/Narralens-openfilm-m1b/vendor/openfilm"
PINNED_PROJECT="/mnt/c/workspace/videoworkline/Narralens-openfilm-m1b/spikes/openfilm-m1b/project"

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

echo "== environment =="
{
  echo "date_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "node=$(node -v)"
  echo "pnpm=$(corepack pnpm -v)"
  echo "python=$(python3 -V 2>&1)"
  echo "os=$(uname -sr)"
  echo "git_head=$(git rev-parse HEAD)"
  echo "git_branch=$(git rev-parse --abbrev-ref HEAD)"
  echo "git_status_porcelain_lines=$(git status --porcelain | wc -l)"
} > "$LOGS/environment.txt"

echo "== gates =="
run check            corepack pnpm check
run contracts        corepack pnpm test:contracts
run m21              corepack pnpm test:m2.1
run build            corepack pnpm build
run golden-python    python3 -I tests/m2.1-golden/source-digest-v1.golden.py tests/m2.1-golden/source-digest-v1.vectors.json
run secret-scan      corepack pnpm exec tsx tools/secret-scan.ts
run mutation-gates   bash tools/m2.1-gate-mutation-check.sh "$LOGS"

echo "== real upstream (positive and tamper negative) =="
if [ -d "$PINNED_VENDOR/.git" ] && [ -d "$PINNED_PROJECT" ]; then
  echo "e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3  $PINNED_VENDOR" > "$LOGS/openfilm-probe.cmd"
  corepack pnpm exec tsx tests/m2.1-probe/openfilm-upstream-probe.mjs \
    "$PINNED_VENDOR" "$PINNED_PROJECT" "$ARTIFACTS/openfilm-upstream-probe.json" \
    > "$LOGS/openfilm-probe.txt" 2>&1
  code=$?
  printf '%s\n' "$code" > "$LOGS/openfilm-probe.exit"
  printf '%-18s exit=%s\n' "openfilm-probe" "$code"
  [ "$code" -eq 0 ] || overall=1
else
  printf 'pinned OpenFilm checkout not present at %s\n' "$PINNED_VENDOR" > "$LOGS/openfilm-probe.txt"
  printf '1\n' > "$LOGS/openfilm-probe.exit"
  overall=1
fi

echo "== external review reproductions =="
run repro-b02 corepack pnpm exec tsx tools/m2.1-external-review-repro.mts hypit-visual-asset
run repro-m03 corepack pnpm exec tsx tools/m2.1-external-review-repro.mts symlink-alias

echo "== source tree after mutation gates =="
git status --porcelain src tests contracts tools package.json > "$LOGS/post-mutation-tree.txt"
echo "overall=$overall"
exit "$overall"
