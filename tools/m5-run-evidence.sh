#!/usr/bin/env bash
# M5 append-only, headless evidence capture.
#
# Every command's raw stdout/stderr and its exit code are kept, and nothing is ever
# overwritten: a capture that already exists for a commit is refused, because the
# evidence for a commit is a fact and a fact cannot be rewritten.
set -u
cd "$(dirname "$0")/.." || exit 1

CAPTURE_SHA="$(git rev-parse HEAD)"

# The tree's state is read *before* this script creates its own directory: an untracked
# file inside it would make `git status` report a dirty tree, and the capture would then
# record its own output as somebody else's work.
DIRTY="$(git status --porcelain | wc -l | tr -d ' ')"

LOGS="docs/evidence/WAVE3/M5/captures/$CAPTURE_SHA"
if [ -d "$LOGS" ]; then
  echo "capture $CAPTURE_SHA already exists; evidence is append-only" >&2
  exit 2
fi
mkdir -p "$LOGS"

{
  echo "date_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "node=$(node -v)"
  echo "pnpm=$(corepack pnpm -v)"
  echo "git_head=$CAPTURE_SHA"
  echo "git_branch=$(git branch --show-current)"
  echo "repo_dirty_at_capture=$DIRTY"
  echo "origin_main=$(git rev-parse origin/main)"
  echo "openfilm_upstream=e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3"
  echo "declaration_ceiling=M5_HEADLESS_EVIDENCED"
  echo "interaction=headless,muted,no-window,no-focus-steal,no-network,no-payment"
  echo "human_experience=NOT_RUN"
  echo "ux12=HUMAN_NOT_RUN"
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

# The pinned OpenFilm checkout is *not* exported for the whole capture.
#
# The suites that need it set it themselves (the Wave 2 harness does), and the ones that
# do not — the legacy Host HTTP suite, the composition suite — must not pay for verifying
# a checkout they never read: the verification runs `git status` in the upstream tree on
# the Windows drive, and a second of it per Host start is enough to push a test with the
# default five-second timeout over the line. The probe resolves the checkout itself.

echo "== M5 capture at ${CAPTURE_SHA:0:7} (dirty=$DIRTY) =="
run check             corepack pnpm check
run typecheck         corepack pnpm exec tsc --noEmit
run contracts         corepack pnpm test:contracts
run m2.1              corepack pnpm test:m2.1
run wave2-w2.0        corepack pnpm test:wave2:w2.0
run wave2-m3          corepack pnpm test:wave2:m3
run wave2-m4a         corepack pnpm test:wave2:m4a
run wave2-m4b         corepack pnpm test:wave2:m4b
run wave2-m4c         corepack pnpm test:wave2:m4c
run wave2-fitness     corepack pnpm test:wave2:fitness
run m5                corepack pnpm test:m5
run build             corepack pnpm build

# The headless experience run. It writes its own cases, screenshots and measurements into
# this capture's directory, and it starts and closes its own browser, Host and Gateway.
printf '%s\n' "NARRALENS_M5_EVIDENCE_ROOT=$LOGS corepack pnpm test:m5:headless" > "$LOGS/m5-headless.cmd"
NARRALENS_M5_EVIDENCE_ROOT="$LOGS" corepack pnpm test:m5:headless > "$LOGS/m5-headless.txt" 2>&1
code=$?
printf '%s\n' "$code" > "$LOGS/m5-headless.exit"
printf '%-24s exit=%s\n' m5-headless "$code"
[ "$code" -eq 0 ] || overall=1

# The upstream seam probe, re-run so the evidence carries the digests of *this* tree.
printf '%s\n' "corepack pnpm exec tsx tools/m5-studio-seam-probe.ts" > "$LOGS/studio-seam-probe.cmd"
corepack pnpm exec tsx tools/m5-studio-seam-probe.ts > "$LOGS/studio-seam-probe.txt" 2>&1
code=$?
printf '%s\n' "$code" > "$LOGS/studio-seam-probe.exit"
printf '%-24s exit=%s\n' studio-seam-probe "$code"
[ "$code" -eq 0 ] || overall=1

# The credential scan: the capture's own directory must not contain a secret either.
printf '%s\n' "NARRALENS_SECRET_SCAN_OUT=$LOGS/credential-scan.json corepack pnpm exec tsx tools/secret-scan.ts" > "$LOGS/credential-scan.cmd"
NARRALENS_SECRET_SCAN_OUT="$LOGS/credential-scan.json" \
  corepack pnpm exec tsx tools/secret-scan.ts > "$LOGS/credential-scan.txt" 2>&1
code=$?
printf '%s\n' "$code" > "$LOGS/credential-scan.exit"
printf '%-24s exit=%s\n' credential-scan "$code"
[ "$code" -eq 0 ] || overall=1

# The Chinese acceptance report, generated from this capture.
printf '%s\n' "node tools/m5-acceptance-report.mjs $LOGS docs/evidence/WAVE3/M5/acceptance-report.html" > "$LOGS/acceptance-report.cmd"
node tools/m5-acceptance-report.mjs "$LOGS" docs/evidence/WAVE3/M5/acceptance-report.html \
  > "$LOGS/acceptance-report.txt" 2>&1
code=$?
printf '%s\n' "$code" > "$LOGS/acceptance-report.exit"
printf '%-24s exit=%s\n' acceptance-report "$code"
[ "$code" -eq 0 ] || overall=1

# The failed-capture index: every capture that did not pass is listed, so a failure is
# never invisible. It runs before the manifest, because the manifest is what the index
# is checked against.
printf '%s\n' "node tools/m5-failed-captures.mjs" > "$LOGS/failed-captures.cmd"
node tools/m5-failed-captures.mjs > "$LOGS/failed-captures.txt" 2>&1
code=$?
printf '%s\n' "$code" > "$LOGS/failed-captures.exit"
printf '%-24s exit=%s\n' failed-captures "$code"
[ "$code" -eq 0 ] || overall=1

# The manifest for this capture, produced and checked inside it.
printf '%s\n' "node tools/m5-evidence-manifest.mjs $CAPTURE_SHA $LOGS/manifest.json" > "$LOGS/manifest.cmd"
node tools/m5-evidence-manifest.mjs "$CAPTURE_SHA" "$LOGS/manifest.json" > "$LOGS/manifest.txt" 2>&1
code=$?
printf '%s\n' "$code" > "$LOGS/manifest.exit"
printf '%-24s exit=%s\n' manifest "$code"
[ "$code" -eq 0 ] || overall=1

# The end marker: every command of this capture has finished. It is written *before* the
# integrity gate, because the gate reads the capture's own files and a file that is still
# being written is by definition incomplete.
git status --porcelain > "$LOGS/git-status-after.txt"

# The integrity gate, over the whole M5 evidence tree.
printf '%s\n' "node tools/m5-evidence-integrity.mjs" > "$LOGS/integrity.cmd"
node tools/m5-evidence-integrity.mjs > "$LOGS/integrity.txt" 2>&1
code=$?
printf '%s\n' "$code" > "$LOGS/integrity.exit"
printf '%-24s exit=%s\n' integrity "$code"
[ "$code" -eq 0 ] || overall=1

printf '%s\n' "$overall" > "$LOGS/overall.txt"
printf 'capture %s overall=%s\n' "$CAPTURE_SHA" "$overall"
exit "$overall"
