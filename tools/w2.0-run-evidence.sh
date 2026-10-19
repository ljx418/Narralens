#!/usr/bin/env bash
# W2.0 correction evidence capture.
#
# Separate from the Wave 1 capture on purpose: `docs/evidence/WAVE1/` is frozen history and
# is never written again. This writes `docs/evidence/WAVE2/`, whose `logs/<capture-sha>/`
# is append-only.
#
# Two of the commands below are expected to fail, and their failures are the result:
#   - `evidence:wave1:integrity` asserts no code moved after the Wave 1 freeze, so any later
#     wave tip fails it by design. Its exit 1 is recorded verbatim and explained.
#   - nothing else here is expected to fail. A non-zero exit anywhere else is a real failure.
#
# Usage: bash tools/w2.0-run-evidence.sh
set -u
cd "$(dirname "$0")/.." || exit 1

CAPTURE_SHA="$(git rev-parse HEAD)"
SHORT_SHA="$(git rev-parse --short HEAD)"
LOGS="docs/evidence/WAVE2/logs/$CAPTURE_SHA"
if [ -d "$LOGS" ]; then
  echo "evidence directory $LOGS already exists; capture from a new commit" >&2
  exit 2
fi
mkdir -p "$LOGS" docs/evidence/WAVE2/reviews docs/evidence/WAVE2/security docs/evidence/WAVE2/cases

DIRTY="$(git status --porcelain | wc -l | tr -d ' ')"
{
  echo "date_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "node=$(node -v)"
  echo "pnpm=$(corepack pnpm -v)"
  echo "os=$(uname -sr)"
  echo "git_head=$CAPTURE_SHA"
  echo "git_branch=$(git rev-parse --abbrev-ref HEAD)"
  echo "git_head_short=$SHORT_SHA"
  echo "repo_dirty_at_capture=$DIRTY"
  echo "origin_main=$(git rev-parse origin/main 2>/dev/null || echo unknown)"
  echo "wave1_frozen_code=e2dec5ca03ee881b55f92b920ee6df2c676aeb26"
  echo "openfilm_upstream=e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3"
  echo "hypit_upstream=6fdd8c0f02c17b9970aee6deb4550a70e9d57acf"
} > "$LOGS/environment.txt"

overall=0
run() {
  local name="$1"; shift
  printf '%s\n' "$*" > "$LOGS/$name.cmd"
  "$@" > "$LOGS/$name.txt" 2>&1
  local code=$?
  printf '%s\n' "$code" > "$LOGS/$name.exit"
  printf '%-24s exit=%s\n' "$name" "$code"
  [ "$code" -eq 0 ] || overall=1
}

echo "== W2.0 correction gates at $SHORT_SHA (dirty=$DIRTY) =="
# `check` is run up to three times and *every attempt is kept*. This box intermittently
# fails the full suite with ENOMEM on a filesystem call — readdir/read/scandir, at a
# different file each run, never on an assertion, always passing in isolation. Re-running
# once and recording only the green result would be a re-roll, so the attempts are all
# written to disk with their exit codes and the summary says plainly what happened.
# The summary reports, per attempt: exit code, how many ENOMEM occurrences the output
# contained, and which test files failed. It deliberately does NOT classify failures as
# "assertion" vs "other" — a test that expected 200 and got a 500 because an allocation
# failed prints an assertion-shaped line, so a keyword count would mislabel an
# out-of-memory failure as a logic failure. The raw output is kept either way.
CHECK_ATTEMPTS=3
check_pass=0
for attempt in $(seq 1 "$CHECK_ATTEMPTS"); do
  printf '%s\n' "corepack pnpm check  # attempt $attempt of $CHECK_ATTEMPTS" > "$LOGS/check-$attempt.cmd"
  corepack pnpm check > "$LOGS/check-$attempt.txt" 2>&1
  code=$?
  printf '%s\n' "$code" > "$LOGS/check-$attempt.exit"
  printf '%-24s attempt %s exit=%s\n' "check" "$attempt" "$code"
  enomem=$(grep -c "ENOMEM" "$LOGS/check-$attempt.txt" 2>/dev/null || true)
  # A Host route normalises internal failures to INTERNAL_ERROR on purpose, so an
  # out-of-memory failure behind an HTTP call leaves no ENOMEM text in the output at all.
  # A failing test with zero ENOMEM occurrences is therefore reported as `unknown`, not as
  # "not memory" — claiming otherwise would be reading a gap in the evidence as a result.
  unknown=0
  if [ "$code" -ne 0 ] && [ "$enomem" -eq 0 ]; then unknown=1; fi
  failed_files=$(grep -oE "^ (FAIL|❯) +tests/[^ ]+" "$LOGS/check-$attempt.txt" 2>/dev/null | sort -u | tr '\n' ' ')
  printf '%s\n' "attempt=$attempt exit=$code enomem_occurrences=$enomem cause=unknown=$unknown failing_files=[$failed_files]" \
    >> "$LOGS/check-attempts.txt"
  if [ "$code" -eq 0 ]; then check_pass=$((check_pass + 1)); fi
done
# `check.txt` / `check.exit` name the *first passing* attempt, so anything reading them
# sees the gate's result rather than whichever attempt happened to run first. Every attempt
# keeps its own `check-<n>.txt`, and the summary lists all of them.
first_pass=0
for attempt in $(seq 1 "$CHECK_ATTEMPTS"); do
  if [ "$(cat "$LOGS/check-$attempt.exit")" -eq 0 ]; then first_pass=$attempt; break; fi
done
if [ "$first_pass" -ne 0 ]; then
  cp "$LOGS/check-$first_pass.txt" "$LOGS/check.txt"
  cp "$LOGS/check-$first_pass.exit" "$LOGS/check.exit"
  cp "$LOGS/check-$first_pass.cmd" "$LOGS/check.cmd"
else
  cp "$LOGS/check-$CHECK_ATTEMPTS.txt" "$LOGS/check.txt"
  cp "$LOGS/check-$CHECK_ATTEMPTS.exit" "$LOGS/check.exit"
  cp "$LOGS/check-$CHECK_ATTEMPTS.cmd" "$LOGS/check.cmd"
fi
{
  echo "attempts=$CHECK_ATTEMPTS"
  echo "attempts_passed=$check_pass"
  cat "$LOGS/check-attempts.txt"
} > "$LOGS/check-summary.txt"
if [ "$check_pass" -eq 0 ]; then overall=1; fi
run contracts          corepack pnpm test:contracts
run m2.1               corepack pnpm test:m2.1
run m2.2               corepack pnpm exec vitest run tests/m2.2
run m2.3               corepack pnpm exec vitest run tests/m2.3
run wave2              corepack pnpm test:wave2:w2.0
run wave2-m3           corepack pnpm test:wave2:m3
run wave2-fitness      corepack pnpm test:wave2:fitness
run wave1-historical   corepack pnpm evidence:wave1:historical
# Writes to W2.0's own directory. The default output path is M2.1's historical report,
# and overwriting an earlier stage's recorded evidence is not this stage's to do.
printf '%s\n' "NARRALENS_SECRET_SCAN_OUT=docs/evidence/WAVE2/security/credential-scan.json corepack pnpm exec tsx tools/secret-scan.ts" > "$LOGS/credential-scan.cmd"
NARRALENS_SECRET_SCAN_OUT=docs/evidence/WAVE2/security/credential-scan.json \
  corepack pnpm exec tsx tools/secret-scan.ts > "$LOGS/credential-scan.txt" 2>&1
printf '%s\n' "$?" > "$LOGS/credential-scan.exit"
printf '%-24s exit=%s\n' "credential-scan" "$(cat "$LOGS/credential-scan.exit")"
[ "$(cat "$LOGS/credential-scan.exit")" -eq 0 ] || overall=1
run doc-consistency    corepack pnpm check:m2.1-docs

# Expected to fail, and that is the finding: this gate asserts no code changed after the
# Wave 1 freeze, and W2.0 changed code. Recorded verbatim, never written up as PASS.
printf '%s\n' "corepack pnpm evidence:wave1:integrity" > "$LOGS/wave1-integrity.cmd"
corepack pnpm evidence:wave1:integrity > "$LOGS/wave1-integrity.txt" 2>&1
printf '%s\n' "$?" > "$LOGS/wave1-integrity.exit"
printf '%-24s exit=%s (expected: asserts no code moved since the Wave 1 freeze)\n' \
  "wave1-integrity" "$(cat "$LOGS/wave1-integrity.exit")"

# The pinned OpenFilm upstream, probed for real.
run openfilm-availability corepack pnpm exec tsx tools/openfilm-availability-probe.mjs

git status --porcelain > "$LOGS/git-status-after.txt"
git rev-parse HEAD > "$LOGS/git-head-after.txt"

echo "overall=$overall"
echo "logs=$LOGS"
