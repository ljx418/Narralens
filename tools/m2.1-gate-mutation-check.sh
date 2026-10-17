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

  # Snapshot the pristine file, then apply the mutation.
  cp "$file" "$SCRATCH/$(basename "$file").pristine"
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

  # Restore from the copy taken before the mutation, never from git: `git checkout` restores
  # from the index and would silently discard uncommitted work in the file under test.
  if [ -f "$SCRATCH/$(basename "$file").pristine" ]; then
    cp "$SCRATCH/$(basename "$file").pristine" "$file"
  fi

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
anchor = "  for (const asset of input.declaredAssets ?? []) {\n    const relative = normalizeRelative(asset.path, correlationId);\n    const loaded = await read(relative, relative);\n    if (assets.some((entry) => entry.path === loaded.relative)) continue;"
assert text.count(anchor) == 1, f"MUT-D anchor count {text.count(anchor)}"
mutated = text.replace(anchor, "  for (const asset of [] as readonly DeclaredAsset[]) {\n    const relative = normalizeRelative(asset.path, correlationId);\n    const loaded = await read(relative, relative);\n    if (assets.some((entry) => entry.path === loaded.relative)) continue;", 1)
assert mutated != text, "MUT-D mutation did not change anything"
open(sys.argv[2], "w", encoding="utf-8").write(mutated)
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

# ── Gates for the external-review rework (M2.1 round 2) ────────────────────────────────

# G: the gateway stops failing closed on an unreported capability (M-01).
cp src/host/engine/native-write-gateway.ts "$SCRATCH/g-before.ts"
sed 's/    if (reported === undefined) {/    if (false \&\& reported === undefined) {/' \
  "$SCRATCH/g-before.ts" > "$SCRATCH/g-after.ts"
cmp -s "$SCRATCH/g-before.ts" "$SCRATCH/g-after.ts" && { echo "MUT-G anchor not found" >&2; exit 2; }
run_case MUT-G "gateway stops failing closed on an unreported capability" src/host/engine/native-write-gateway.ts \
  tests/m2.1/native-write-gateway.test.ts "$SCRATCH/g-before.ts" "$SCRATCH/g-after.ts"

# H: the Hypit closure stops hashing referenced asset bytes (B-02).
cp src/adapters/hypit/hypit-engine-adapter.ts "$SCRATCH/h-before.ts"
sed 's/declaredAssets: await this.#referencedAssets(projectId, descriptor),/declaredAssets: [],/' \
  "$SCRATCH/h-before.ts" > "$SCRATCH/h-after.ts"
cmp -s "$SCRATCH/h-before.ts" "$SCRATCH/h-after.ts" && { echo "MUT-H anchor not found" >&2; exit 2; }
run_case MUT-H "Hypit digest stops covering referenced asset bytes" src/adapters/hypit/hypit-engine-adapter.ts \
  tests/m2.1/native-bypass.test.ts "$SCRATCH/h-before.ts" "$SCRATCH/h-after.ts"

# I: digest identity falls back to the logical reference path (M-03). The load-bearing line is
# the one that enqueues the canonical path; reverting it reproduces the original duplicate rows.
cp src/host/engine/source-digest-v1.ts "$SCRATCH/i-before.ts"
sed 's/queue.push({ relative: target.relative, referrer: item.relative });/queue.push({ relative: resolvedRelative, referrer: item.relative });/' \
  "$SCRATCH/i-before.ts" > "$SCRATCH/i-after.ts"
cmp -s "$SCRATCH/i-before.ts" "$SCRATCH/i-after.ts" && { echo "MUT-I anchor not found" >&2; exit 2; }
run_case MUT-I "digest enqueues the logical reference path instead of the canonical one" src/host/engine/source-digest-v1.ts \
  tests/m2.1/source-digest-v1.test.ts "$SCRATCH/i-before.ts" "$SCRATCH/i-after.ts"

# J: the upstream loader stops verifying pinned file digests (M-04).
cp src/adapters/openfilm/openfilm-upstream.ts "$SCRATCH/j-before.ts"
sed 's/for (const \[relative, expected\] of digests) {/for (const [relative, expected] of [] as Array<[string, string]>) {/' \
  "$SCRATCH/j-before.ts" > "$SCRATCH/j-after.ts"
cmp -s "$SCRATCH/j-before.ts" "$SCRATCH/j-after.ts" && { echo "MUT-J anchor not found" >&2; exit 2; }
run_case MUT-J "upstream loader stops verifying pinned file digests" src/adapters/openfilm/openfilm-upstream.ts \
  tests/m2.1/openfilm-upstream-lock.test.ts "$SCRATCH/j-before.ts" "$SCRATCH/j-after.ts"

# K: the Host stops raising attention when it detects an external change (B-01).
cp src/host/server.ts "$SCRATCH/k-before.ts"
sed 's/this.revisions.recordExternalSourceChange(projectId, "", descriptor.revision);/void descriptor;/' \
  "$SCRATCH/k-before.ts" > "$SCRATCH/k-after.ts"
cmp -s "$SCRATCH/k-before.ts" "$SCRATCH/k-after.ts" && { echo "MUT-K anchor not found" >&2; exit 2; }
run_case MUT-K "Host stops raising attention on an external change" src/host/server.ts \
  tests/m2.1/native-bypass.test.ts "$SCRATCH/k-before.ts" "$SCRATCH/k-after.ts"

# L: inability to prove a clean checkout is treated as success again (R2-M-01).
cp src/adapters/openfilm/openfilm-upstream.ts "$SCRATCH/l-before.ts"
sed 's/  if (dirty === null) {/  if (false \&\& dirty === null) {/' \
  "$SCRATCH/l-before.ts" > "$SCRATCH/l-after.ts"
cmp -s "$SCRATCH/l-before.ts" "$SCRATCH/l-after.ts" && { echo "MUT-L anchor not found" >&2; exit 2; }
run_case MUT-L "upstream loader skips clean verification when git status fails" src/adapters/openfilm/openfilm-upstream.ts \
  tests/m2.1/openfilm-upstream-lock.test.ts "$SCRATCH/l-before.ts" "$SCRATCH/l-after.ts"

# M: the coordinator state machine stops checking its predecessor (M2.2 JRNL).
cp src/host/projects/revision-store.ts "$SCRATCH/m-before.ts"
sed 's/WHERE transaction_id=? AND state=?`)/WHERE transaction_id=?`)/' \
  "$SCRATCH/m-before.ts" > "$SCRATCH/m-after.ts"
cmp -s "$SCRATCH/m-before.ts" "$SCRATCH/m-after.ts" && { echo "MUT-M anchor not found" >&2; exit 2; }
run_case MUT-M "transition stops requiring its predecessor" src/host/projects/revision-store.ts \
  tests/m2.2/transaction-state-machine.test.ts "$SCRATCH/m-before.ts" "$SCRATCH/m-after.ts"

# J: a journal step stops requiring its predecessor (M2.2 JRNL, legacy journal half).
cp src/host/projects/revision-store.ts "$SCRATCH/n-before.ts"
sed 's/    if (changed !== 1) throw new Error(`INVALID_JOURNAL_TRANSITION:/    if (false) throw new Error(`INVALID_JOURNAL_TRANSITION:/' \
  "$SCRATCH/n-before.ts" > "$SCRATCH/n-after.ts"
cmp -s "$SCRATCH/n-before.ts" "$SCRATCH/n-after.ts" && { echo "MUT-J anchor not found" >&2; exit 2; }
run_case MUT-J "advanceJournal stops requiring its predecessor" src/host/projects/revision-store.ts \
  tests/m2.2/journal-predecessor.test.ts "$SCRATCH/n-before.ts" "$SCRATCH/n-after.ts"

# S: the snapshot stops proving the parent directory entry before publishing (M2.2 DUR).
cp src/host/projects/snapshot-store.ts "$SCRATCH/s-before.ts"
sed 's/      await this.#fsync(projectRoot);/      \/\* mutated: parent fsync removed *\//' \
  "$SCRATCH/s-before.ts" > "$SCRATCH/s-after.ts"
cmp -s "$SCRATCH/s-before.ts" "$SCRATCH/s-after.ts" && { echo "MUT-S anchor not found" >&2; exit 2; }
run_case MUT-S "snapshot skips the parent directory fsync" src/host/projects/snapshot-store.ts \
  tests/m2.2/snapshot-store.test.ts "$SCRATCH/s-before.ts" "$SCRATCH/s-after.ts"

# T: the snapshot stops re-hashing what it actually copied (M2.2 SNAP).
cp src/host/projects/snapshot-store.ts "$SCRATCH/t-before.ts"
sed 's/      if (landed !== entry.sha256) {/      if (false \&\& landed !== entry.sha256) {/' \
  "$SCRATCH/t-before.ts" > "$SCRATCH/t-after.ts"
cmp -s "$SCRATCH/t-before.ts" "$SCRATCH/t-after.ts" && { echo "MUT-T anchor not found" >&2; exit 2; }
run_case MUT-T "snapshot stops re-hashing the copied bytes" src/host/projects/snapshot-store.ts \
  tests/m2.2/snapshot-store.test.ts "$SCRATCH/t-before.ts" "$SCRATCH/t-after.ts"

echo "SUMMARY cases=$results gates_that_failed_as_required=$bites" | tee -a "$LOG"
[ "$results" -eq "$bites" ] || exit 1
