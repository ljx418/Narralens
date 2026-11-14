# N1N2 validation request — the first real component smoke

Child: task_5dcbe8192764 / dispatch ctx_e5e736e1846b / terminal term_b4006907-19df-46dd-ae99-34909d8de5e6
cwd of every command: `/mnt/c/workspace/videoworkline/Narralens-agents/main-integration` (WSL)
branch `agent-driven/main-a-integration` — HEAD/base `e2eff61b464d75d36598103d718cd2a75db5dfda` — git index clean.

## Exact command requested

```sh
corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/created-native-source-reader.test.ts -t "R00 smoke"
```

Selected case names (the `-t` filter matches exactly these two, nothing else in the file):

1. `R00 smoke reaches the reader from the real committed created source`
2. `R00 smoke commits a rich source with the native files and the media`

No other file, no other case, no `--reporter` change, no concurrency change, no whole-suite run.

## Classification requested: heavy, one slot

The two cases are the real chain and they are heavy. Their effects, exactly:

| effect | detail |
|---|---|
| Host | the real `NarralensHost` of the fixture: an HTTP listener bound on `127.0.0.1` with an ephemeral port, closed by the fixture |
| database | a private SQLite database under the fixture's own tmpdir (`host.sqlite`), with the real migrations of this worktree |
| private roots | `projects/`, `snapshots/`, `stage/`, `derived/`, `tasks/`, `local-assets/`, `publication/`, `native-workspaces/` — all under the fixture's own tmpdir, all removed by the fixture |
| ffmpeg | the fixed local `ffmpeg` generates two **diagnostic** media files: a 320x180 3 s `libx264` colour video and a 3 s 48 kHz sine wav. Diagnostic only; they are not authorised Chinese film material and are not A-film evidence |
| ffprobe | the fixed local `ffprobe`, invoked by the reader itself through the **parent's own retained descriptor** (`/proc/<parentPid>/fd/<fd>`), argv `ffprobe -v error -print_format json -show_format -show_streams <fd path>`, once per media file, plus one `ffprobe -version` for the probe provenance |
| pinned upstream | the read-only pinned OpenFilm checkout at `/mnt/c/workspace/videoworkline/Narralens-openfilm-m1b/vendor/openfilm` (upstream `e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3`), used by the real native assembler and the real film parser |
| approved 015 | the **already provisioned** approved module at `var/native-hydration-r2/managed-native-expected/dist` (no rebuild, no pin change, no re-provision): `expected-projection.mjs` sha256 `3500b1d6485791b13ec9364c6eb80740531142c16754877e21923ad73e9d494e`, `native-pure-library.mjs` sha256 `9cb18aebe9a5daf08a2c92259b6314493fe98e40fe8a1b410bad444671a9904c` |
| browser / network / J drive / provider / paid | none |
| ports | one ephemeral loopback port of the fixture's own Host, closed by the fixture |

## Frozen inputs at the moment of the request

The ten released paths, sha256:

```
7421eedae0a9a4b2c028ac705adb376e64697cf0cf7ce40745dcbe4a7035d2a6  src/host/agent-driven/committed-snapshot-authority.ts
b57bed5df0ea600a2aa1a5b2dc3df2873f794389ee5274f32efb52a6f3d653ad  src/host/agent-driven/created-native-workspace.ts
19110e45a83b6d5b611b4260620ce873f923f1e5a5b907bc6176c4b734fbeed3  src/host/m5/openfilm-native-expected.ts
c5c311c99bfcdb547e3e4fc61787f26e499dfb15ec14e736eeba90fd6b85378b  src/host/agent-driven/retained-native-closure.ts
3e07efd01918421474a53d37b0169ab0b51122f3aba0ce4a2ce7a92953753a90  src/host/agent-driven/created-native-source-reader.ts
439d469032c9af2b83ceb826e0aead7cf5c2fe5c5693be7cbf18c8e67f0f615f  tests/agent-driven/integration/created-native-workspace.test.ts
bfd0c6373b254050d32a6a99e7b6f8b9827dc24b6b2587515ab4c5aad2cd9037  tests/agent-driven/integration/committed-snapshot-host.test.ts
e0b3c6985819618cb70af7970b18b8c3e993834ff5b9237af0c00b7ae8a0aa95  tests/agent-driven/integration/created-native-ack.test.ts
3c665d7af9f1aafe2ef6fc77501f3d3fe5b310ccc7b28165529cb6801a5ca2a2  tests/agent-driven/integration/created-native-source-reader.test.ts
98c07c98b20cc4660f81f05e7713f8b97032eaa41071966a90e43a112c1c70e9  tests/agent-driven/integration/helpers/native-source-fixture.ts
```

Protected `AGENTS.md`: `37300463a72a612ae16e0a5fcfb496502c57c722b83781e0e2e8c9480594542b` (untouched).
Git index: clean, no `add`/`commit`/`reset`/`stash`/`checkout` by this child.

The compile evidence already recorded for these bytes: `n1n2-claude-resume-007-tsc-smoke`, argv `corepack pnpm exec tsc --noEmit`, cwd main-integration, actual exit **0**, log sha256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` (empty log). Compile is not behaviour evidence; this request is for the behaviour.

## What the two cases prove, and what they do not

They prove that the real committed rich source reaches the reader and that the reader's proof is produced from it: the real prepared draft, the real publisher, the real closed commit, the real working copy, the real issued workspace ref, the real approved 015 module, the real retained descriptors and the real fixed ffprobe.

They do **not** claim: a human review or acceptance, a native UI load, a NativeAck row, a Studio session, an A-film, or an independent review. The review policy of the fixture is fixture data, and the session liveness callback is the fixture's own truth.

## Capture

When granted, the run goes through the existing immutable `run-recorded.py` with the unique prefix `n1n2-claude-resume-`:

```sh
python3 docs/execution/A/implementation-20261111/integration/e1-main-takeover/run-recorded.py \
  n1n2-claude-resume-008-smoke \
  corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/created-native-source-reader.test.ts -t "R00 smoke"
```

The capture freezes every source/test/tool text input with its hash, records the argv, the cwd, the git HEAD and the actual exit, and keeps the complete stdout and stderr. No other command runs while it runs.

## Not requested, not run

No full suite, no build, no browser, no network, no provider, no paid action, no J drive, no migration of an old Gate, no package or lock change, no index mutation, and no other test file. The remaining R01–R07 cases are written and submitted separately, case by case.
