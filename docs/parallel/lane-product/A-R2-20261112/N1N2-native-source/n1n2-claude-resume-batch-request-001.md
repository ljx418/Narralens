# N1N2 — the coherent selected batch for validation

Child: task_5dcbe8192764 / dispatch ctx_e5e736e1846b / terminal term_b4006907-19df-46dd-ae99-34909d8de5e6
cwd of every command: `/mnt/c/workspace/videoworkline/Narralens-agents/main-integration` (WSL)
HEAD/base: `e2eff61b464d75d36598103d718cd2a75db5dfda` — git index clean — protected `AGENTS.md` `37300463a72a612ae16e0a5fcfb496502c57c722b83781e0e2e8c9480594542b` untouched.

One batch, three commands, run **serially** in this order, each through the existing immutable
`run-recorded.py` with the unique `n1n2-claude-resume-*` prefix. Nothing else runs while a
command runs; no concurrent edit, tsc or other heavy work.

## Command A — the pure FS cases of the new file

```sh
python3 docs/execution/A/implementation-20261111/integration/e1-main-takeover/run-recorded.py \
  n1n2-claude-resume-017-batch-pure \
  corepack pnpm exec vitest run --config vitest.config.ts \
  tests/agent-driven/integration/created-native-source-reader.test.ts -t "P0"
```

Selected cases (exactly six, `-t "P0"` matches only these):

| case | what it proves |
|---|---|
| `P06 reproduces the five pinned native revision vectors` | the five pinned upstream `revOf` vectors, the byte-order mark included; the bytes come back exactly |
| `P06 lists the media in the numeric order of the host` | the native listing is the host's numeric collation and not a plain sort; the Node/ICU/locale evidence is recorded |
| `P07 refuses a symbolic link, a same-bytes replacement and a restored change time` | a symlink leaf, a same-bytes new inode and a same-size write with a restored mtime are all refused |
| `P07 refuses a text file above the budget and bounds the total` | the 8 MiB and 64 MiB budgets are enforced before the bytes are read |
| `P07 refuses to release while work is in flight and releases every allocation once` | the release is refused while an operation is admitted, the accepted operation still completes, and every allocation is released exactly once — including one that **reuses** a descriptor number the walk had already released |
| `P07 keeps the failure of the walk release with the failure that stopped it` | an injected walk-close failure is kept with the failure that stopped the walk |
| `P07 proves an empty directory and sees the file that appears in it` | an empty directory is evidence of its own and a file appearing in it changes the closure |

**Classification: pure FS.** Only `mkdtemp`, file writes, `lstat`/`readdir`/`read` and the
closure's own descriptors. No Host, no database, no listener, no media tool, no network, no
browser, no provider, no J drive, no build. The temporary trees are under `tmpdir()` and are
removed by the cases themselves.

## Command B — the component cases of the new file

```sh
python3 docs/execution/A/implementation-20261111/integration/e1-main-takeover/run-recorded.py \
  n1n2-claude-resume-018-batch-component \
  corepack pnpm exec vitest run --config vitest.config.ts \
  tests/agent-driven/integration/created-native-source-reader.test.ts -t "R0"
```

Selected cases (exactly sixteen, `-t "R0"` matches only these):

| case | what it proves |
|---|---|
| `R00 smoke reaches the reader from the real committed created source` | the whole chain reaches the reader and the four hydration parts are computed and hydrated; the exact refusal reason and the emitted input are carried in every failure message |
| `R00 smoke commits a rich source with the native files and the media` | the committed source really holds the native files and the media |
| `R01 refuses the legacy project that has no created producer` | the bootstrap commit, which has no created producer, is refused rather than weakened |
| `R02 refuses a working copy that changed under the proof` | a same-bytes, new-inode replacement under the proof makes `verifyClosure()` false and the next read refuse |
| `R02 keeps parallel leases independent and refuses foreign and copied tokens` | two parallel leases, one released while the other stays current, a repeated acquisition, a copied token and a lease of another service instance |
| `R02 refuses a facts lease of another authority` | a facts lease of another authority over the same store, and a copy of one, are not leases of this one; both leases are released |
| `R02 releases the whole closure only after the last retained leaf` | the closure travels with the handles and is released with the last leaf |
| `R03 refuses a sidecar, an unknown item and a missing committed file` | a native sidecar the source does not have, an unknown item and a missing committed file are all refused |
| `R04 refuses a foreign native id, a forged probe cache and a file in flight` | a `.film/id` the Host did not issue, a probe cache with a forged duration and a file still being written are refused |
| `R04 accepts a legitimate cache in the next stable round` | a legitimate cache invalidates the proof made before it and the next stable round accepts it against an independent probe |
| `R05 proves the media facts of the retained bytes` | every media fact equals an independent probe of the same bytes with the upstream's own argv and rules |
| `R06 lists the media in the native numeric order` | the listing is the native's numeric order and the environment it depends on is recorded |
| `R06 places every clip where the committed film places it` | every clip's placement equals the placement read again, independently, from the committed film's own bytes |
| `R07 ends a read at a close and releases a late result exactly once` | the caller's promise is cancelled at the close, the workspace lease is released exactly once and the late authority result is released exactly once — two separate counters |
| `R07 lets the real child exit before the reader closes` | the real tool process is observed starting and exiting by the reader's own child events; the exit precedes the close and the rejection; no elapsed time is used as evidence |

**Classification: heavy** — the same effects as the granted smoke slots: a real `NarralensHost`
HTTP listener on `127.0.0.1` with an ephemeral port, a private SQLite database with this
worktree's migrations, private `projects/`, `snapshots/`, `stage/`, `derived/`, `tasks/`,
`local-assets/`, `publication/` and `native-workspaces/` roots under the fixture's own tmpdir,
the fixed local `ffmpeg` producing two **diagnostic** media files (a 320x180 3 s libx264 colour
video and a 3 s 48 kHz sine wav — diagnostic only, not authorised Chinese film material and
not A-film evidence), the fixed local `ffprobe` invoked by the reader through the parent's own
retained descriptor with the upstream argv plus one `ffprobe -version`, the read-only pinned
upstream `e70d9d93`, and the already provisioned approved 015 module (no rebuild, no pin
change). No browser, no external network, no J drive, no provider, no paid action, no build, no
config change, no index change.

## Command C — the existing behavioural regressions

```sh
python3 docs/execution/A/implementation-20261111/integration/e1-main-takeover/run-recorded.py \
  n1n2-claude-resume-019-batch-regressions \
  corepack pnpm exec vitest run --config vitest.config.ts \
  tests/agent-driven/integration/created-native-ack.test.ts \
  tests/agent-driven/integration/committed-snapshot-host.test.ts \
  tests/agent-driven/integration/created-native-workspace.test.ts
```

Selected cases: every case of those three files, unchanged, no `-t` filter.

**Classification, per file**:
- `created-native-ack.test.ts` — **pure**: it starts no Host, opens no listener, reads no fixture
  and needs no heavy slot (its own file comment says so). The 84 inherited assertions stay
  intact; the only change in it is the two type-only imports the loader change needs.
- `committed-snapshot-host.test.ts` — **heavy (DB + Host)**: a real `NarralensHost` with a private
  SQLite database and an ephemeral loopback port.
- `created-native-workspace.test.ts` — **heavy (DB + Host + the upstream Studio server)**: the
  same, plus the pinned upstream's Studio server started from the read-only vendor checkout. No
  browser page is rendered by these cases.

## Frozen inputs at the moment of this request

```
7421eedae0a9a4b2c028ac705adb376e64697cf0cf7ce40745dcbe4a7035d2a6  src/host/agent-driven/committed-snapshot-authority.ts
b57bed5df0ea600a2aa1a5b2dc3df2873f794389ee5274f32efb52a6f3d653ad  src/host/agent-driven/created-native-workspace.ts
19110e45a83b6d5b611b4260620ce873f923f1e5a5b907bc6176c4b734fbeed3  src/host/m5/openfilm-native-expected.ts
c5c311c99bfcdb547e3e4fc61787f26e499dfb15ec14e736eeba90fd6b85378b  src/host/agent-driven/retained-native-closure.ts
9bd5cadda7e49ddb140826106363cd2f090e427ba20a7796bb279303339c6314  src/host/agent-driven/created-native-source-reader.ts
439d469032c9af2b83ceb826e0aead7cf5c2fe5c5693be7cbf18c8e67f0f615f  tests/agent-driven/integration/created-native-workspace.test.ts
bfd0c6373b254050d32a6a99e7b6f8b9827dc24b6b2587515ab4c5aad2cd9037  tests/agent-driven/integration/committed-snapshot-host.test.ts
e0b3c6985819618cb70af7970b18b8c3e993834ff5b9237af0c00b7ae8a0aa95  tests/agent-driven/integration/created-native-ack.test.ts
9d4a464fc5d63105644384a5a2bb0a36f9b287dcae816d56980cfac9d510c5cc  tests/agent-driven/integration/created-native-source-reader.test.ts
d6d719f1c2c7deddd900b6b2372c840ed515da26df92c16c16c1791ea4a9c322  tests/agent-driven/integration/helpers/native-source-fixture.ts
```

Since the granted smoke the reader changed (`858ecfdf…` → `9bd5cadda7e49ddb140826106363cd2f090e427ba20a7796bb279303339c6314`)
for exactly the reasons PRODUCT required: the Host-private child-event observer that makes the
real child's start and exit observable (it can never state a fact about the media), and nothing
else. The test file and the fixture changed for the required oracles.

Compile evidence for these bytes: `n1n2-claude-resume-016-tsc-batch4`, argv
`corepack pnpm exec tsc --noEmit`, cwd main-integration, actual exit **0**, log sha256
`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` (empty log). Compile is not
behaviour evidence.

## What this batch does not claim

It does not close the N1N2 gate. It is component evidence: no human acceptance, no native UI
load, no NativeAck row, no Studio session, no A-film, no independent review, and no
NativeAck/Studio/A readiness of any kind. The independent review of this candidate remains
outstanding and is not mine to perform.
