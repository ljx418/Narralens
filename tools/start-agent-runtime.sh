#!/usr/bin/env bash
set -euo pipefail
umask 077
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
command -v flock >/dev/null || { printf 'flock is required for the owned local runtime.\n' >&2; exit 1; }
test -f node_modules/tsx/package.json || { printf 'Locked local dependencies are required.\n' >&2; exit 1; }
exec corepack pnpm exec tsx tools/agent-runtime.ts "$@"
