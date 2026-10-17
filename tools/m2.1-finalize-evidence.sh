#!/usr/bin/env bash
# Finalize M2.1 evidence for a capture.
#
# Generates the manifest from the immutable log set of the current capture commit, then runs
# the integrity validator and records its result back into the manifest.
#
# The integrity check deliberately lives here rather than inside `pnpm check`: it validates
# the manifest against the code tree, so running it as part of the gate it is validating would
# make every capture fail on a manifest that is one step behind. M-02 allows a script.
#
# Usage: bash tools/m2.1-finalize-evidence.sh
set -u
cd "$(dirname "$0")/.." || exit 1

LOGS_DIR="$(ls -1dt docs/evidence/M2/M2.1/logs/*/ | head -1)"
LOGS="${LOGS_DIR%/}"

# The manifest describes the integrity run, so its command is declared before the run itself.
printf 'node tools/m2.1-evidence-integrity.mjs\n' > "$LOGS/integrity.cmd"
printf '1\n' > "$LOGS/integrity.exit"
: > "$LOGS/integrity.txt"

corepack pnpm exec tsx tools/m2.1-evidence-manifest.ts || exit 1
node tools/m2.1-evidence-integrity.mjs > "$LOGS/integrity.txt" 2>&1
status=$?
printf '%s\n' "$status" > "$LOGS/integrity.exit"
[ "$status" -eq 0 ] || { echo "EVIDENCE_INTEGRITY_FAILED" >&2; tail -20 "$LOGS/integrity.txt" >&2; exit 1; }

corepack pnpm exec tsx tools/m2.1-evidence-manifest.ts || exit 1
echo "finalized: $LOGS"
