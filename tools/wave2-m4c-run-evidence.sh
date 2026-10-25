#!/usr/bin/env bash
# M4C append-only, headless evidence capture. Historical current-tip integrity failures are
# recorded verbatim and are not converted into green results.
set -u
cd "$(dirname "$0")/.." || exit 1

CAPTURE_SHA="$(git rev-parse HEAD)"

# **The tree's state is read before anything touches it.**
#
# The capture's own log directory is created below, and an untracked file inside it makes
# `git status` report a dirty tree — so measuring *after* the directory exists would record
# the capture's own output as somebody else's work. The M4B script gets away with measuring
# after the `mkdir` because its directory is empty at that point and git does not report
# empty directories; this script copies M4B's gate output into the directory first, so it
# has to measure before.
DIRTY="$(git status --porcelain | wc -l | tr -d ' ')"

# **M4B's current-tip integrity gate runs before this capture's log directory exists.**
#
# It has to. That gate checks that every failed capture under `docs/evidence/WAVE2/logs` is
# in M4B's index, and a capture that is *being written* is by definition incomplete: it has
# no end marker yet, so the shared failure rule calls it failed. Running the gate while
# this capture's directory existed would therefore report a failure that has nothing to do
# with M4B's evidence — it would be reporting this capture's own incompleteness.
#
# So the gate runs first, against the tree as it stands, and its output is copied into this
# capture afterwards. Whatever it says is what it said.
PRELOGS="$(mktemp -d)"
printf '%s\n' "corepack pnpm evidence:wave2:m4b:integrity" > "$PRELOGS/m4b-integrity.cmd"
corepack pnpm evidence:wave2:m4b:integrity > "$PRELOGS/m4b-integrity.txt" 2>&1
M4B_INTEGRITY_EXIT=$?
printf '%s\n' "$M4B_INTEGRITY_EXIT" > "$PRELOGS/m4b-integrity.exit"

LOGS="docs/evidence/WAVE2/logs/$CAPTURE_SHA"
if [ -d "$LOGS" ]; then
  echo "capture $CAPTURE_SHA already exists; evidence is append-only" >&2
  rm -rf "$PRELOGS"
  exit 2
fi
mkdir -p "$LOGS"
cp "$PRELOGS/m4b-integrity.cmd" "$PRELOGS/m4b-integrity.txt" "$PRELOGS/m4b-integrity.exit" "$LOGS/"
rm -rf "$PRELOGS"

{
  echo "date_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "node=$(node -v)"
  echo "pnpm=$(corepack pnpm -v)"
  echo "git_head=$CAPTURE_SHA"
  echo "git_branch=$(git branch --show-current)"
  echo "repo_dirty_at_capture=$DIRTY"
  echo "origin_main=$(git rev-parse origin/main)"
  echo "openfilm_upstream=e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3"
  echo "declaration_ceiling=M4C_INTERNAL_EVIDENCED"
  echo "interaction=headless,muted,no-window,no-focus-steal,no-network,no-payment"
  # The failures this capture expects, recorded so the shared failure rule can tell them
  # from a real one. Wave 1's and M4A's current-tip integrity gates fail by design once a
  # later stage has moved the code; their historical gates pass. M4B's current-tip gate is
  # **not** expected to fail: it reads the tree at its own capture commit, so M4C's routes
  # cannot change its verdict.
  echo "expected_failure_commands=wave1-integrity,m4a-integrity"
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

echo "== M4C capture at ${CAPTURE_SHA:0:7} (dirty=$DIRTY) =="
run check                 corepack pnpm check
run typecheck             corepack pnpm exec tsc --noEmit
run contracts             corepack pnpm test:contracts
run m2.1                  corepack pnpm test:m2.1
run wave2-w2.0            corepack pnpm test:wave2:w2.0
run wave2-m3              corepack pnpm test:wave2:m3
run wave2-m4a             corepack pnpm test:wave2:m4a
run wave2-m4b             corepack pnpm test:wave2:m4b
run wave2-m4c             corepack pnpm test:wave2:m4c
run wave2-fitness         corepack pnpm test:wave2:fitness
run build                 corepack pnpm build
run wave1-historical      corepack pnpm evidence:wave1:historical
run m4a-historical        corepack pnpm evidence:wave2:m4a:historical
run m4b-historical        corepack pnpm evidence:wave2:m4b:historical
run restore-plan-golden-python corepack pnpm test:wave2:m4c:golden-python
record_expected_failure wave1-integrity corepack pnpm evidence:wave1:integrity
record_expected_failure m4a-integrity corepack pnpm evidence:wave2:m4a:integrity

# The frozen restore-plan vectors are regenerated into a *temporary* copy and compared, so a
# drift in the canonical rules is detected rather than caused. Regenerating the committed
# file in place would bake any change into the very file whose job is to catch it.
SCRATCH="$(mktemp -d)"
printf '%s\n' "corepack pnpm test:wave2:m4c:vectors $SCRATCH/restore-plan.vectors.json" \
  > "$LOGS/restore-plan-vectors.cmd"
corepack pnpm test:wave2:m4c:vectors "$SCRATCH/restore-plan.vectors.json" > "$LOGS/restore-plan-vectors.txt" 2>&1
code=$?
if [ "$code" -eq 0 ]; then
  diff -u tests/wave2/m4c/restore-plan.vectors.json "$SCRATCH/restore-plan.vectors.json" \
    >> "$LOGS/restore-plan-vectors.txt" 2>&1
  code=$?
fi
rm -rf "$SCRATCH"
printf '%s\n' "$code" > "$LOGS/restore-plan-vectors.exit"
printf '%-24s exit=%s (0 means the committed vectors still reproduce byte for byte)\n' restore-plan-vectors "$code"
[ "$code" -eq 0 ] || overall=1

printf '%s\n' "NARRALENS_SECRET_SCAN_OUT=$LOGS/credential-scan.json corepack pnpm exec tsx tools/secret-scan.ts" > "$LOGS/credential-scan.cmd"
NARRALENS_SECRET_SCAN_OUT="$LOGS/credential-scan.json" \
  corepack pnpm exec tsx tools/secret-scan.ts > "$LOGS/credential-scan.txt" 2>&1
code=$?
printf '%s\n' "$code" > "$LOGS/credential-scan.exit"
printf '%-24s exit=%s\n' credential-scan "$code"
[ "$code" -eq 0 ] || overall=1

# The capture's outcome at this point in the run — which is *before* the manifest and the
# gate, so it is a record of where the run had got to, not a verdict. The failed-capture
# index reads it as a failure signal only; the end marker is `git-status-after.txt`, which
# every script writes last.
printf '%s\n' "$overall" > "$LOGS/overall.txt"

# The manifest for this capture, produced and checked *inside* the capture. The committed
# manifest cannot exist yet for a capture that has not been committed, so the capture proves
# its own evidence is internally consistent and records that proof as a log.
printf '%s\n' "node tools/wave2-m4c-evidence-manifest.mjs $CAPTURE_SHA $LOGS/manifest.json" > "$LOGS/manifest.cmd"
node tools/wave2-m4c-evidence-manifest.mjs "$CAPTURE_SHA" "$LOGS/manifest.json" > "$LOGS/manifest.txt" 2>&1
code=$?
printf '%s\n' "$code" > "$LOGS/manifest.exit"
printf '%-24s exit=%s\n' manifest "$code"
[ "$code" -eq 0 ] || overall=1

printf '%s\n' "node tools/wave2-m4c-evidence-integrity.mjs $LOGS/manifest.json" > "$LOGS/m4c-integrity.cmd"
node tools/wave2-m4c-evidence-integrity.mjs "$LOGS/manifest.json" > "$LOGS/m4c-integrity.txt" 2>&1
code=$?
printf '%s\n' "$code" > "$LOGS/m4c-integrity.exit"
printf '%-24s exit=%s\n' m4c-integrity "$code"
[ "$code" -eq 0 ] || overall=1

git status --porcelain > "$LOGS/git-status-after.txt"

# The capture's own outcome, recorded in the capture. The manifest reads it to build the
# index of failed captures, so a failure is findable from the index rather than only by
# listing directories — and so the index cannot omit a failure that nobody wrote a note for.
if [ "$overall" -ne 0 ]; then
  # A failed capture says so, in the capture. A diagnostic written by hand can be forgotten;
  # one the script writes cannot.
  {
    echo "# M4C 捕获失败"
    echo
    echo "本目录是失败捕获，禁止作为冻结证据或改写为全绿。"
    echo
    echo "- capture commit：\`$CAPTURE_SHA\`"
    echo "- overall：\`$overall\`"
    echo "- 失败的命令："
    for exit_file in "$LOGS"/*.exit; do
      [ -e "$exit_file" ] || continue
      code="$(cat "$exit_file")"
      [ "$code" -eq 0 ] && continue
      name="$(basename "$exit_file" .exit)"
      echo "  - \`$name\` exit=$code"
    done
    echo
    echo "逐条输出见本目录的 \`.txt\` 日志。失败捕获只追加，不覆盖、不删除。"
  } > "$LOGS/CAPTURE_FAILED_DIAGNOSTIC.md"
fi

echo "overall=$overall"
echo "logs=$LOGS"
exit "$overall"
