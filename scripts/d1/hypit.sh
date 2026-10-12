#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fixture_root="$project_root/fixtures/d1-30s"
cache_root="${XDG_CACHE_HOME:-${HOME}/.cache}"
hypit_cli="${NARRALENS_HYPIT_CLI:-$cache_root/narralens/hypit-0.3.1/node_modules/@hypit/hypit/bin/hypit.mjs}"

if [[ ! -f "$hypit_cli" ]]; then
  hypit_cli="$project_root/vendor/hypit/bin/hypit.mjs"
fi

cd "$project_root"
exec node "$hypit_cli" "$@" --project "$fixture_root"
