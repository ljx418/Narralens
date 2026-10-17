#!/usr/bin/env bash
# M2.1 gate mutation check.
#
# Proves each architecture gate actually bites: it introduces one deliberate violation,
# runs only the suite that owns that gate, records that the suite FAILS, then reverts.
# A gate that cannot fail is not a gate.
#
# Usage: bash tools/m2.1-gate-mutation-check.sh <evidence-dir>
set -u
cd "$(dirname "$0")/.." || exit 1
EVIDENCE="${1:-docs/evidence/M2/M2.1/logs}"
mkdir -p "$EVIDENCE"
LOG="$EVIDENCE/gate-mutation-check.txt"
: > "$LOG"

results=0
bites=0

run_case() {
  local id="$1"; local description="$2"; local file="$3"; local suite="$4"; shift 4
  {
    echo "=== $id: $description ==="
    echo "command: corepack pnpm exec vitest run --config vitest.config.ts $suite"
  } | tee -a "$LOG"

  # Apply the mutation.
  python3 - "$file" "$@" <<'PY' 2>&1 | tee -a "$LOG"
import sys, io
path, before_path, after_path = sys.argv[1], sys.argv[2], sys.argv[3]
# Read everything before opening for write: open(path, "w") truncates immediately, so
# reading the file inside the write call would write back an empty string.
current = open(path, encoding="utf-8").read()
before = open(before_path, encoding="utf-8").read()
after = open(after_path, encoding="utf-8").read()
if before not in current:
    print("MUTATION_ANCHOR_NOT_FOUND"); raise SystemExit(2)
mutated = current.replace(before, after, 1)
with open(path, "w", encoding="utf-8") as handle:
    handle.write(mutated)
assert open(path, encoding="utf-8").read() == mutated, "MUTATION_WRITE_MISMATCH"
print(f"mutation applied ({len(current)} -> {len(mutated)} bytes)")
PY

  corepack pnpm exec vitest run --config vitest.config.ts "$suite" > "$EVIDENCE/mutation-$id.txt" 2>&1
  local status=$?
  tail -n 12 "$EVIDENCE/mutation-$id.txt" >> "$LOG"

  git checkout -- "$file" 2>/dev/null
  git checkout HEAD -- "$file" 2>/dev/null

  results=$((results + 1))
  if [ "$status" -ne 0 ]; then
    bites=$((bites + 1))
    echo "RESULT $id: GATE_BITES (exit $status)" | tee -a "$LOG"
  else
    echo "RESULT $id: GATE_DID_NOT_FAIL (exit $status)" | tee -a "$LOG"
  fi
  echo "" | tee -a "$LOG"
}

SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

# A: an adapter grows a commit method -> fitness rule 4 must fail.
cp src/adapters/openfilm/openfilm-engine-adapter.ts "$SCRATCH/a-before.ts"
python3 - "$SCRATCH/a-before.ts" "$SCRATCH/a-after.ts" <<'PY'
import sys
text = open(sys.argv[1], encoding="utf-8").read()
anchor = "  async inspect(snapshot: SnapshotRef, ctx: ReadContext): Promise<EngineProjection> {"
open(sys.argv[2], "w", encoding="utf-8").write(
    text.replace(anchor, "  async commit(): Promise<void> {\n    return await Promise.resolve();\n  }\n\n" + anchor, 1))
PY
run_case MUT-A "adapter declares a commit method" src/adapters/openfilm/openfilm-engine-adapter.ts \
  tests/architecture/m2.1-fitness.test.ts "$SCRATCH/a-before.ts" "$SCRATCH/a-after.ts"

# B: a production registry entry becomes unknown -> registry completeness must fail.
cp src/host/engine/native-mutation-registry.ts "$SCRATCH/b-before.ts"
python3 - "$SCRATCH/b-before.ts" "$SCRATCH/b-after.ts" <<'PY'
import sys
text = open(sys.argv[1], encoding="utf-8").read()
anchor = 'impact_class: "picture", lock_class: "duration", policy: "blocked",\n    reason: "Split creates clip identity'
assert text.count(anchor) == 1, f"MUT-B anchor count {text.count(anchor)}"
open(sys.argv[2], "w", encoding="utf-8").write(text.replace(anchor,
    'impact_class: "picture", lock_class: "duration", policy: "unknown" as never,\n    reason: "Split creates clip identity', 1))
PY
run_case MUT-B "a registry entry claims an unknown policy" src/host/engine/native-mutation-registry.ts \
  tests/m2.1/native-write-gateway.test.ts "$SCRATCH/b-before.ts" "$SCRATCH/b-after.ts"

# C: production code imports a spike -> fitness rule 3 must fail.
cp src/host/engine/native-mutation-registry.ts "$SCRATCH/c-before.ts"
python3 - "$SCRATCH/c-before.ts" "$SCRATCH/c-after.ts" <<'PY'
import sys
text = open(sys.argv[1], encoding="utf-8").read()
anchor = 'export type NativeTransport ='
open(sys.argv[2], "w", encoding="utf-8").write(
    'import "../../../spikes/openfilm-m1b/native-mutation-inventory.md";\n\n' + text.replace(anchor, anchor, 1))
PY
run_case MUT-C "production code imports a spike" src/host/engine/native-mutation-registry.ts \
  tests/architecture/m2.1-fitness.test.ts "$SCRATCH/c-before.ts" "$SCRATCH/c-after.ts"

# D: the digest silently drops an unreferenced-but-declared root -> closure test must fail.
cp src/host/engine/source-digest-v1.ts "$SCRATCH/d-before.ts"
python3 - "$SCRATCH/d-before.ts" "$SCRATCH/d-after.ts" <<'PY'
import sys
text = open(sys.argv[1], encoding="utf-8").read()
anchor = "  for (const asset of input.declaredAssets ?? []) {\n    const relative = normalizeRelative(asset.path, correlationId);\n    if (assets.some((entry) => entry.path === relative)) continue;"
assert text.count(anchor) == 1, f"MUT-D anchor count {text.count(anchor)}"
open(sys.argv[2], "w", encoding="utf-8").write(text.replace(anchor, "  for (const asset of [] as readonly DeclaredAsset[]) {\n    const relative = normalizeRelative(asset.path, correlationId);\n    if (assets.some((entry) => entry.path === relative)) continue;", 1))
PY
run_case MUT-D "digest silently skips declared assets" src/host/engine/source-digest-v1.ts \
  tests/m2.1/source-digest-v1.test.ts "$SCRATCH/d-before.ts" "$SCRATCH/d-after.ts"

# E: assets get sorted, violating the pinned semantic-order rule -> vector V04 must fail.
cp src/host/engine/source-digest-v1.ts "$SCRATCH/e-before.ts"
python3 - "$SCRATCH/e-before.ts" "$SCRATCH/e-after.ts" <<'PY'
import sys
text = open(sys.argv[1], encoding="utf-8").read()
anchor = "  files.sort((left, right) => compareUtf8(left.path, right.path));"
open(sys.argv[2], "w", encoding="utf-8").write(
    text.replace(anchor, anchor + "\n  assets.sort((left, right) => compareUtf8(left.path, right.path));", 1))
PY
run_case MUT-E "digest sorts assets against the pinned rule" src/host/engine/source-digest-v1.ts \
  tests/m2.1/source-digest-v1.test.ts "$SCRATCH/e-before.ts" "$SCRATCH/e-after.ts"

# F: the stale-base check is dropped from stage -> stale base would be accepted.
cp src/adapters/openfilm/openfilm-engine-adapter.ts "$SCRATCH/f-before.ts"
python3 - "$SCRATCH/f-before.ts" "$SCRATCH/f-after.ts" <<'PY'
import sys
text = open(sys.argv[1], encoding="utf-8").read()
anchor = "    if (plan.base_source_digest !== currentDigest.source_digest) {"
open(sys.argv[2], "w", encoding="utf-8").write(text.replace(anchor, "    if (false && plan.base_source_digest !== currentDigest.source_digest) {", 1))
PY
run_case MUT-F "stage drops the strict base check" src/adapters/openfilm/openfilm-engine-adapter.ts \
  tests/m2.1/engine-port.test.ts "$SCRATCH/f-before.ts" "$SCRATCH/f-after.ts"

echo "SUMMARY cases=$results gates_that_failed_as_required=$bites" | tee -a "$LOG"
[ "$results" -eq "$bites" ] || exit 1
