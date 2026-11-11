# R2-MEDIA-PROOF-001 — ordering, failure cause and owned-resource disposition

This is the exact record of the two attempts of the single granted heavy command, in the
order the events happened. It is written by the MEDIA implementation writer, who ran the
command, and it is not a claim about anything that happened outside this worktree.

## The command

Both attempts ran exactly this, in this worktree, and nothing else:

```
corepack pnpm test tests/agent-driven/integration/created-draft-processor.test.ts \
  tests/agent-driven/media/prepared-source-adoption-proof.test.ts --maxWorkers=1 --minWorkers=1
```

`pnpm test` is `vitest run --config vitest.config.ts`, so the effective command is the
vitest run with the two named files, one worker.

## Attempt 1 — exit 1

- Launched 2026-11-11T17:01:42Z (log: `r2-media-proof-001-run.log`, "Start at 01:01:42").
- Duration 104.65 s, ended 2026-11-11T17:03:27Z.
- Exit 1.
- Input freeze: `r2-media-proof-001-input-freeze-attempt1.txt`, HEAD `ef9e095c2ae8781fd58cfc6f4daaca3032d74364`.
- `tests/agent-driven/integration/created-draft-processor.test.ts`: **11/11 passed**, 62.797 s.
  The four cases added by this ticket are among them.
- `tests/agent-driven/media/prepared-source-adoption-proof.test.ts`: **8/8 failed**, every
  one with the identical message `Test timed out in 5000ms`.

### The exact failure cause of attempt 1

The defect is in the new test file and nowhere else. The eight cases of
`prepared-source-adoption-proof.test.ts` drive the real Host fixture (a real Host
process, a real SQLite database, the real worker, real `ffmpeg`), and each of them
needs several seconds. The file was written without the per-case timeout argument that
`created-draft-processor.test.ts` already passes (`}, 120000);`), so vitest's five
second default cut every case off. The log contains **no assertion failure** in that
file — every failure line is the timeout.

Consequence for the record: attempt 1 proves the eleven processor cases and proves
**nothing at all** about the eight proof cases. It is not a "19 passed" run and it is
not a product failure either; it is a harness defect that stopped the assertions from
running at all.

### What attempt 1 left behind

One fixture workspace survived in `/tmp`:

```
drwx------ 7 administrator administrator 4096 2026-11-12 01:03:32 +0800 /tmp/narralens-created-workspace-AUfkd9
sha256(host.sqlite) = 28420558e031aa72eebe5745030960236dd4807172eb879a099ce04658c55fc4
```

It is the fixture's own root: the Host's SQLite database with its WAL, the registered
local media, the project tree and the task stage. A timed-out vitest case does not
finish its `finally`, so the fixture's own `rm(root)` never ran for it.

## Attempt 2 — exit 0

- Fix commit `6c22182aebefee14f4cceccd3e2583da8630cc2f`: exactly eight `}, 120000);`
  additions to the eight `it(...)` calls of `prepared-source-adoption-proof.test.ts`. No
  assertion was removed, no threshold was widened beyond the 120000 ms the existing
  integration file already uses, and no product file was touched.
- Input freeze: `r2-media-proof-001-input-freeze.txt`, HEAD
  `6c22182aebefee14f4cceccd3e2583da8630cc2f`.
- Launched 2026-11-11T17:05:36Z (log: `r2-media-proof-001-run-attempt2.log`).
- Duration 121.60 s, ended 2026-11-11T17:07:38Z.
- Exit 0.
- `tests/agent-driven/media/prepared-source-adoption-proof.test.ts`: **8/8 passed**, 58.020 s.
- `tests/agent-driven/integration/created-draft-processor.test.ts`: **11/11 passed**, 61.846 s.
- 19/19 passed.

### The ordering, stated exactly

1. Attempt 1 ended on its own; the shell that ran it reported completion and the log
   carries its final vitest summary and `EXIT=1`.
2. The timeout defect was diagnosed from that log and fixed in commit `6c22182a`.
3. The input hashes were frozen again (`r2-media-proof-001-input-freeze.txt`).
4. Attempt 2 was launched at 17:05:36Z.

**What is *not* claimed:** between step 1 and step 4 no dedicated descendant sweep of
attempt 1 was run. The evidence that attempt 1's own process tree was gone before
attempt 2 started is indirect and is stated as indirect: the background command that ran
attempt 1 reported completion, attempt 1's log carries its own final summary, and the
only processes observed while attempt 2 was running were attempt 2's own tree
(`node (vitest)`, `node (vitest 1)` and their `sh` parent). A vitest timeout is not a
cancellation, so this ordering is reported rather than asserted as a proof of exit.

## Owned-resource disposition after attempt 2

Observed at 2026-11-11T17:08:16Z, after the command had exited:

- `ps` for `vitest|ffmpeg|ffprobe|openfilm`: **no matching process**. The three `codex`
  processes present are the BRIDGE, PRODUCT and MEDIA lane agents, not this command's
  descendants.
- `/tmp/narralens-*` fixture workspaces: **one** survivor, the attempt-1 one listed
  above. It was inspected (contents and `host.sqlite` digest recorded) and then removed
  with `rm -rf`. No process held it (`lsof` found none).
- After the removal: **no** `/tmp/narralens-*` workspace remains.
- The two successful runs each left their own workspace removed by the fixture itself.

## Evidence the released test wrote into the repository

`created-draft-processor.test.ts` writes its own real-run evidence into
`docs/parallel/lane-media/A-R1-20261111/evidence/`, one timestamped directory per run.
That is the pre-existing behaviour of that test and not something this ticket added.
All three directories are preserved, the R1 one included:

- `draft-processor-real-1794408261304` — the preserved R1 run (`observed.json`
  sha256 `80a0069538bf11be87300cf5b47349d536793f1bc321f54ed69cba0cc5747d84`).
- `draft-processor-real-1794416514046` — attempt 1 (`observed.json`
  sha256 `1ec09aa2e689e6a6a06e297792c88308a598ae77721adfcfd3bdea4b45276e47`).
- `draft-processor-real-1794416805157` — attempt 2 (`observed.json`
  sha256 `8d59a04686ba1ba415dd0fb37fd8ae9ae485adc2536be006fb1faa8e76e1ed7e`).

In every directory `film.html` is sha256 `1ec8a5ee0d98ce3a61d0a65a234ec25d1f159853c547c9f522c3fe0b265d1c7c`
and `diagnostic.wav` is sha256 `42c9992dbd4dcfbeaf52790767beb0febee1279ce37e2e46d5cb474bdd8e1a1d`:
the same real prepared film and the same real registered audio in all three runs.
