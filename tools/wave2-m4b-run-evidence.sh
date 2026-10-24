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

# The manifest for this capture, produced and checked *inside* the capture. The committed
# manifest cannot exist yet for a capture that has not been committed, so the capture proves
# its own evidence is internally consistent and records that proof as a log.
printf '%s\n' "node tools/wave2-m4b-evidence-manifest.mjs $CAPTURE_SHA $LOGS/manifest.json" > "$LOGS/manifest.cmd"
node tools/wave2-m4b-evidence-manifest.mjs "$CAPTURE_SHA" "$LOGS/manifest.json" > "$LOGS/manifest.txt" 2>&1
code=$?
printf '%s\n' "$code" > "$LOGS/manifest.exit"
printf '%-24s exit=%s\n' manifest "$code"
[ "$code" -eq 0 ] || overall=1

printf '%s\n' "node tools/wave2-m4b-evidence-integrity.mjs $LOGS/manifest.json" > "$LOGS/m4b-integrity.cmd"
node tools/wave2-m4b-evidence-integrity.mjs "$LOGS/manifest.json" > "$LOGS/m4b-integrity.txt" 2>&1
code=$?
printf '%s\n' "$code" > "$LOGS/m4b-integrity.exit"
printf '%-24s exit=%s\n' m4b-integrity "$code"
[ "$code" -eq 0 ] || overall=1

git status --porcelain > "$LOGS/git-status-after.txt"

# The capture's own outcome, recorded in the capture. The manifest reads it to build the
# index of failed captures, so a failure is findable from the index rather than only by
# listing directories — and so the index cannot omit a failure that nobody wrote a note for.
printf '%s\n' "$overall" > "$LOGS/overall.txt"

if [ "$overall" -ne 0 ]; then
  # A failed capture says so, in the capture. A diagnostic written by hand can be forgotten;
  # one the script writes cannot.
  {
    echo "# M4B 捕获失败"
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
