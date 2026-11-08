#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."

printf '[1/4] Checking local prerequisites...\n'
for narralens_tool in node corepack ffmpeg ffprobe flock; do
  command -v "$narralens_tool" >/dev/null || { printf 'Missing prerequisite: %s\n' "$narralens_tool" >&2; exit 1; }
done
node -e 'const [a,b]=process.versions.node.split(".").map(Number);if(a<22||(a===22&&b<15))throw Error("Node >=22.15 required")'
test -f node_modules/tsx/package.json || { printf 'Local dependencies missing. Ask the maintainer to install the locked dependencies.\n' >&2; exit 1; }
export NARRALENS_OPENFILM_VENDOR="${NARRALENS_OPENFILM_VENDOR:-$(dirname "$PWD")/Narralens-openfilm-m1b}"
test -f "$NARRALENS_OPENFILM_VENDOR/vendor/openfilm/package.json" || { printf 'Pinned OpenFilm checkout missing: %s\n' "$NARRALENS_OPENFILM_VENDOR" >&2; exit 1; }
test -f 'fixtures/d1-30s/assets/generated/visual-10s.mp4' || { printf 'Local example media missing.\n' >&2; exit 1; }
if [[ "${1:-}" == '--check' ]]; then
  printf 'Prerequisites OK. Check-only: no services or visible browser started.\n'
  exit 0
fi

# Keep the lock outside the versioned source and hold it for the entire session.
mkdir -p var
exec 9>var/narralens-experience.lock
flock -n 9 || { printf 'An experience session is already starting or running. Use its Chrome window.\n' >&2; exit 1; }
printf '[2/4] Building the Director panel...\n'
corepack pnpm build:m5
printf '[3/4] Warming local media, migration, Host, Studio and Gateway...\n'
printf '[4/4] Chrome will open when the environment is ready. Close it to stop this session.\n'
export NARRALENS_ALLOW_VISIBLE_UI=1
exec corepack pnpm experience:m5
