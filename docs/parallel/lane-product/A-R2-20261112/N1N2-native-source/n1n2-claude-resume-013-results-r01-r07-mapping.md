# N1N2 — the 013 scope results, the R01–R07 mapping and the ONE consolidated correction plan

Writer: Claude implementation child, task `task_5dcbe8192764` / dispatch
`ctx_b4086093cd96`, terminal `term_d383bb87-4e85-4090-a651-e24d730f642b`, coordinator
`term_c42901ca-2c06-452f-8f59-085ab98adb8a`. Sole writer of the released paths; MAIN
is the sole reviewer and document owner. Every tool ran with cwd
`/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`.

**N1N2 is NOT complete.** MAIN's round-2 independent review is `REQUEST_CHANGES`
(1 BLOCKER, 6 MAJOR) on exactly these bytes, and the G01–G07 gaps below are real.

## 1. The 013 scope (grant `N1N2-RESUME-FULL-013`)

| capture | argv | exit | result | log sha256 |
|---|---|---|---|---|
| `n1n2-claude-resume-102-gate-component` | `vitest run --config vitest.config.ts tests/agent-driven/integration/created-native-source-reader.test.ts -t "R0\|F02\|F03\|F04\|F05\|F06\|F07\|F08\|F09\|F10 shows"` | **0** | **34 passed**, 18 filtered, 0 failures | `18cd9b8e9f40058b1f5e6887a066cd55efd50cf1eeb938a0a8b04528491ff1ac` |
| `n1n2-claude-resume-095-gate-legacy` | `vitest run --config vitest.config.ts tests/agent-driven/integration/created-native-ack.test.ts tests/agent-driven/integration/committed-snapshot-host.test.ts tests/agent-driven/integration/created-native-workspace.test.ts` | **0** | 3 files, **107 passed / 107** (the ACTUAL count of this run) | `80fd6fc8ac54da5d8f22498b2d79881ac5c9c60cc33961cfa787805496fdbd19` |

Both report `source_changed []` and `source_added []` (no input drift); serial; the
unchanged recorder; the canonical cwd. The ten released paths were frozen for the
whole scope and carry the digests of section 5. HEAD `e2eff61b…`, git index empty,
`AGENTS.md` `37300463a…` untouched. Own cleanup receipt:
`n1n2-claude-resume-102-095-cleanup-evidence.txt` (current observation only: no
vitest/ffprobe/ffmpeg process alive, zero fixture/pure temp roots, the earlier
session's `/tmp/n1n2-rot/` diagnostic media left untouched).

Earlier captures of this round, all preserved under their own names: `096` tsc exit 2
(my own misplaced brace), `097` tsc exit 0, `098` pure gate exit 1 (the duplicate
cause, since fixed), `099` tsc exit 0 after the dedupe, `100` pure gate exit 0
(18 passed), `101` the two component targets exit 0 (2 passed).

## 2. The original R01–R07 requirement → actual code, actual assertion, actual capture

Line numbers are of the **current** bytes
(`tests/agent-driven/integration/created-native-source-reader.test.ts`,
`src/host/agent-driven/committed-snapshot-authority.ts`,
`src/host/agent-driven/created-native-source-reader.ts`,
`src/host/agent-driven/retained-native-closure.ts`). Captures: **100** = pure gate,
**101** = the two component targets, **102** = the full component gate, **095** = the
legacy regressions. No row is a count.

| # | Original ledger item | Actual code | Actual assertion | Capture | Verdict on these bytes |
|---|---|---|---|---|---|
| 1 | R01 `producer_chain` | `committed-snapshot-authority.ts:409-520` (`acquireNativeFacts`), `:227-293` (`#nativeLineage`); the real producer in `tests/agent-driven/integration/helpers/native-source-fixture.ts:84-263` (real SOURCE_ONLY worker, real publisher, real `commitPreparedCreatedSource`) | `:92-98` binding + lease generation; `:121-133` the four parts hydrated from a **real** Expected proof; `:155-162` the committed source really holds `film.html`, `.film/settings.json`, `.film/subtitles.json`, `rights.json`, `draft-plan.json`, `scenes/…`, `assets/video/*.mp4`, `assets/vo/*.wav`; `:174-175` the legacy project is refused | 102 | **PARTIAL** — the real chain is proved; the accepted review/approval/authorization are fixture policy; no negative rights/graph tamper per new lease |
| 2 | R01 `independent_trees` | `created-native-source-reader.ts:628-654` (two closures, per-leaf handles); `retained-native-closure.ts:97-105,436-474` (one owner per allocation) | `:451-460` the whole closure travels with the handles and goes with the last leaf; `:786` a same-path hardlink alias is refused (`NATIVE_SOURCE_COPY_ALIASED`); `:790` an unknown directory is refused; `:1946-1957` an empty directory is evidence of its own | 100 (`:1946`), 102 (`:451`,`:780`) | **PARTIAL** — an **external**/cross-path hardlink and the two-tree empty-directory FD ownership are unproved (G07) |
| 3 | R02 `tamper_and_authority` | `retained-native-closure.ts:541-568` (the identity fence before **and** after the read), `:585-595` (`verifyFile`), `:659-714` (`verify`); `committed-snapshot-authority.ts:416` + `:466` (the lineage fence sampled before the first await and re-checked after) | `:203` the old proof no longer verifies; `:208-209` the Expected refusal carries **exactly** `NATIVE_EXPECTED_CLOSURE_MOVED` (the old interface's reason, asserted as a message); `:212` a fresh stable round succeeds; `:216` changed bytes are refused; `:729`/`:746` a source leaf and a source parent replaced during the acquisition; `:760`/`:767` an equal-byte replacement makes the lease stale and the next round proves the new identity; `:1612-1650` pure: a symlink is refused, a same-bytes replacement is seen, a restored change time does not hide a rewrite; `:851-874`/`:876-899` the producer's lineage changed after the issue and during the acquisition | 100 (`:1612`), 101 (`:185`), 102 | **PARTIAL** — the parser reread window (G03), the owner/base/control/generation/ref transition at a real await, the isolated root/parent swap |
| 4 | R03 `complete_dependencies` | `created-native-source-reader.ts:819-832` (four separate ledgers: consumed files, negative lookups, directory lookups, media lookups), `:934-987` (the bounded missing-dependency discovery) | `:268`/`:272`/`:278` a sidecar, an unknown item and a missing committed file are each refused with their own code; `:906-913` a proved absence is accepted and its later **birth** invalidates the proof; `:1061` the retained caption listing equals the platform's raw order; `:1471-1479` an uncommitted translation beside the media is refused | 100 (`:902`,`:1049`), 102 (`:264`,`:1471`) | **PARTIAL** — the absent **style**/heard-transcript consumer branch is not exercised (the markers case never reaches `computeNativeEffectiveSidecars`); the empty-directory-only birth; the settings/style variants; the caption fixture is not discriminating against a sorted readdir (G06) |
| 5 | R04 `native_cache` | `created-native-source-reader.ts:1024-1138` (`#classifyDerived`, `#classifyCache`) | `:298` a foreign native id; `:303` a forged probe cache; `:307` a file in flight; `:317-332` a **legitimate** probe cache invalidates the old round and the next stable round accepts it; `:806`/`:813` a pageframe triple and an orphan film poster are refused and `:808` nothing was deleted | 102 | **UNPROVEN for the normal derivation** — every pageframe triple and the film poster are refused, so no stable round can accept legitimate native output (G04) |
| 6 | R05 `actual_probe` | `created-native-source-reader.ts:443-461` (the parent-PID FD path, the fixed argv, the provenance digest), `:103-129` (`normalizeNativeProbe`), `:131-133` (the upstream's own media key) | `:343-351` the media facts are the facts of the same bytes; `:1386-1387` an **independent 64 KiB stream hash** of the actual media equals the returned fact **and** the committed fact; `:1406` the real provenance digest is recomputed and equal; `:1420-1424` each of the seven preimage fields changes the digest and the seven differ; `:994-1013` a rotated video and the first of two video streams; `:547-596` the real child | 100 (`:976`), 101 (`:1375`), 102 (`:340`,`:547`,`:976`) | **PARTIAL** — no reader round whose duration disagrees with the trim/subtitle; no source/parent swap during the held-FD probe; the normalizer case does not use reader-held descriptors |
| 7 | R05 `child_lifetime` | `created-native-source-reader.ts:372-419` (bounded output, the 30 s deadline, the awaited `close`, the child's bookkeeping), `:28-31` (the limits) | `:547-596` the real child's PID and FD, the FD still live at the actual `exited` event, the exit before the reader's close returns, the FD gone after; `:492-538` the canceled caller vs the drained raw acquisition, the late result released exactly once; `:966` the five injected runner branches | 102 | **PARTIAL** — no **real** hung/abrupt/timeout child, the stderr limit has no input vector, the injected hang/spawn can pass on the version query before the media child exists (G05) |
| 8 | R06 `native_bytes_and_order` | `created-native-source-reader.ts:131-171` (the upstream's listing rule), `:172-201` (the upstream's media key and stamp) | `:1968-2000` the five pinned native revision vectors (BOM, CRLF, CJK, emoji, empty) byte for byte; `:1031-1042` the **pinned consumer's own** `listFiles` on real FS paths + the environment fingerprint (Node/ICU/locale recorded); `:1061` the raw caption order; `:1501-1522` a clip without a place is the native's own zero and a disagreement is refused; `:1524-1541` the pinned consumer's own `layoutTracks` puts it at zero; `:2002-2016` the numeric order of the host | 100 (`:1968`,`:2002`,`:1501`,`:1524`,`:1049`), 102 (`:1020`) | **BOUNDED** — the byte vectors do not run the full reader film path; the caption fixture cannot fail if the platform's readdir is lexical |
| 9 | R07 `budgets` | `retained-native-closure.ts:20-23` (the budget), `:544-552` (the size check **before** the read), `:547-550` (the total, each file counted once), `:352` (the depth), `:359` (the paths), `:779-789` (the descriptor reservation **before** the open) | `:1142` a file that grows under the read; `:1160-1170` the cumulative text, each file counted once; `:1181` the depth; `:1190` the descriptor admission; `:1206-1212` the measured peak never exceeds the cap; `:935-938` a referenced text above the budget is refused **and its bytes were never read**; `:1658-1687` a text file above the budget and the total | 100 | **PARTIAL** — the pinned parser's reread is not bounded by the retained budget (G03); no maxPaths overflow; no real tool output limit |
| 10 | R07 `per_allocation_fd_lifetime` | `retained-native-closure.ts:97-105` (the ownership is the **allocation**, not the number), `:791-803` (`#closeOwned`: released first, then the close, then the latch), `:833-852` (`#closeAll`: every allocation attempted) | `:1689-1739` a release while work is in flight is refused, the OS really reuses a number and the live allocation is still released exactly once; `:1857-1860` every allocation released exactly once, matched by the real path of each descriptor; `:1896-1897` every outstanding allocation attempted once; `:1902-1904` a repeated release does not retry and does not report twice | 100 | **BOUNDED, pure** — it does not extend to the authority/reader boundary (G01) |
| 11 | R07 `cleanup_uncertainty` | `retained-native-closure.ts:791-803` (the latch and the ledger), `:46-57` (`mergeCauses`), `:31-38` (`attachCauses`); `created-native-source-reader.ts:335-364` (`#adopt` — the raw rejection is ignored), `:593-609` (the read's catch), `:316-320` (the close reports only `#cleanupFailures`) | `:689-704` a temporary release failure is kept, latches the uncertainty, is reported once and a repeated close does not retry; `:1839-1853` the named primary keeps the first place, every cleanup cause is kept by identity **and in order**, the production refusal code; `:1857-1860` every allocation once; `:1924-1928` the uncertainty latches, `verify()` is false and a later retain is refused with `NATIVE_CLOSURE_UNCERTAIN`; `:657-668` a delivered release failure latches the reader and the reader's close reports it | 100 (`:679`,`:1801`), 102 (`:640`) | **UNPROVEN at the boundary (G01)** — the source-acquisition cleanup uncertainty is not adopted by the reader; the authority overwrites existing causes; the named syscall cause of a `retainFile` failure is dropped |
| 12 | R07 `drain_and_delivery` | `created-native-source-reader.ts:298-321` (the close: the children killed and reaped, the reads drained, the acquisitions drained), `:464-610` (the owner, the delivery), `:824-854` (the facts' `verifyClosure`) | `:492-538` the caller is cancelled promptly while the owner is not quiescent, the late result is released exactly once, the workspace lease exactly once; `:547-596` the real child's exit precedes the close; `:1454-1466` the delivered resources stay usable until their owner releases them and the closure is gone afterwards | 102 | **PARTIAL** — no final closed/uncertain fence before the delivery (G02); the cancelled raw rejection's cleanup errors are ignored (G01) |
| 13 | R01/R02 `lease_isolation` | `created-native-workspace.ts` (the issued ref, the generation, `acquireExpectedLease`); `committed-snapshot-authority.ts:484-507` (the lease's brand, `assertCurrent`, `release`) | `:386-391` two parallel leases, a released one does not revoke the ref or the other lease, a repeated acquisition still works; `:395-397` a copy of a lease is not a lease; `:417-418` a lease of another service is not a lease of this one; `:434-435` a facts lease of another authority is refused | 102 | **PARTIAL** — the predicates are not consumption evidence; no replaced-generation old-proof/new-lease rejection through the actual reader |
| 14 | REG `existing_behavior` | `src/host/m5/openfilm-native-expected.ts` — the Expected `prove`/`assertCurrent`/`release`/`close` bodies unchanged; only the loader's approved-015 exposure; the legacy `SnapshotReadPort` untouched | `tests/agent-driven/integration/created-native-ack.test.ts` (85 assertions, the 84 inherited), `committed-snapshot-host.test.ts`, `created-native-workspace.test.ts` — **107/107 on these bytes** | 095 (+100/101/102) | **EVIDENCED for the regression files** on these bytes; the loader's artifact and pin are unchanged |
| 15 | EVIDENCE `frozen_capture` | the recorder's own `cmd.json`/`result.json`/`exit`/`inputs.json` per capture | the ten digests of section 5 match the recorder's recorded inputs; every capture reports `source_changed []` and `source_added []`; the exits and log digests are above | 095/099/100/101/102 | **EVIDENCED for the current bytes**; no candidate commit, no frozen candidate yet |
| 16 | REVIEW `independent_acceptance` | `resume-claude-20261112/independent-coverage-audit-round2/REVIEW.md` + `MATRIX.json` (read-only, 1 BLOCKER + 6 MAJOR) and the round-1 audit | the review's own dispositions F01–F10 and its 17-row matrix | — | **PENDING** — a gap audit is not an acceptance; this child signs nothing |
| 17 | NEXT `next_integration_plan` | `resume-claude-20261112/NEXT_WIRING_ENTRY_CHECKLIST.md` (preparation only) | — | — | **DEFERRED** until N1N2 is accepted; no Studio/Ack/Context/selection-DDL/Chinese-A-film/V1 claim |

## 3. The ONE consolidated correction plan (G01–G07 + the 17 obligations)

One round, all of it, then ONE full gate — not one bug per round. Every path below is
one of the ten released paths unless it says otherwise; no new public contract, no
DTO, no DDL, no pin/artifact change, no config.

### G01 (BLOCKER) — the reader adopts the raw acquisition's cleanup uncertainty

- `src/host/agent-driven/retained-native-closure.ts`: export the existing private
  merge helper (`mergeCauses`) under a Host-internal name, so the authority and the
  reader merge with the SAME rule (merge, never overwrite, never duplicate).
- `src/host/agent-driven/created-native-source-reader.ts` `#adopt` (`:335-364`): in
  the raw **rejection** branch, when the rejection carries `cleanup_errors` (or is
  itself a cleanup failure), latch `#cleanupUncertain = true` and push the causes
  into `#cleanupFailures`. No descriptor is retried and the raw cause is not swallowed.
- `created-native-source-reader.ts` `#read` catch (`:593-609`): merge the local
  failures into the primary with the shared helper instead of the raw
  `Object.defineProperty`, so the raw rejection's causes survive.
- `committed-snapshot-authority.ts` `acquireNativeFacts` catch (`:510-518`): the same
  merge instead of the raw `Object.defineProperty` (`:516`).
- `committed-snapshot-authority.ts` `#streamDigest` (`:313-314`): keep the named
  syscall cause instead of `catch{throw changed();}` — the primary stays
  `REVISION_CONFLICT`, the syscall error becomes its cause.
- Barriers/assertions (test file only): (a) an **authority-to-reader** fault — via
  `observeNativeFacts({closureOps:{close:…}})` make the source open/unpack fail with
  a named `EIO` **and** the source close fail: the first read rejects with the named
  cause, a **second** read on the same reader is refused with
  `NATIVE_SOURCE_READER_UNCERTAIN`, and the reader's close reports the causes;
  (b) the cancelled-raw-rejection variant: the reader is closed while the
  acquisition is pending, the raw acquisition then rejects with cleanup causes — the
  ledger holds them and the close reports them.

### G02 (MAJOR) — the final closed/uncertain fence before the delivery

- `created-native-source-reader.ts` `#read` (`:589-592`): after the last await of
  `#readFacts` and immediately before `owned.delivered = true`, refuse when
  `this.#closed` or `this.#cleanupUncertain` — into the **existing** all-attempt
  pre-delivery cleanup (every handle closed once, the owner released, the primary
  kept). The rule that a close *after* a completed delivery does not destroy
  owner-held resources is untouched.
- Assertion: a `closureOps.close` callback that fires during the final
  `workspaceClosure.verify()` calls `reader.close()` synchronously → the read must
  NOT deliver; it must reject, and no handle may survive; the reader's close
  reports nothing new. Plus the variant: an uncertain release of another delivered
  proof during the final work refuses this in-flight proof.

### G03 (MAJOR) — the pinned parser reads an owned, bounded, immutable copy

MAIN's preferred route, and it needs **no adapter change**: the adapter already
isolates the pinned parser (`src/adapters/openfilm/openfilm-upstream.ts:272-289`
reads the bytes, copies them into its own `mkdtemp` folder with mode `0600` and calls
the pinned `readProjectFilm` on it). What is missing is that the **bytes** come from
the mutable path with an unbounded `handle.readFile()`.

- `committed-snapshot-authority.ts` `#nativeLineage` (`:280-288`): BEFORE the parse,
  take the **bounded retained film text** from the closure
  (`closure.readText(await closure.retainFile('film.html'))` — the 8 MiB / 64 MiB
  budget and the identity fence apply); seed an **owned** private folder
  (`mkdtemp` → mode 0700) with exactly those bytes at mode 0600 (flag `wx`); call
  the **same pinned** `readProjectFilm(ownedFolder)`; clean **only** the owned folder
  afterwards, keeping every cause and draining the cleanup. The later original
  source guard still checks the actual source (the manifest digest, the retained-text
  equality at `:286-287`, and the final `closure.verify()` at `:465`).
- The closure-less legacy path (`#verifyAdoptedNative`, `:227-228`, called from
  `:537`): seed the same owned folder with the bytes the bounded, digest-checked
  64 MiB handle already read (`:267-270`).
- Barriers/assertions: a **between-digest-and-parser** barrier — swap or grow the
  source `film.html` after the bounded digest and before the parse → the read is
  refused **and** the parser never saw the swapped bytes (proved by the retained-text
  equality); the owned folder is removed on the failure path with its cause kept; the
  F06 zero-counter assertion (`:938`) is re-described as *bounded text decoding*, not
  as "no file was read".

### G04 (MAJOR) — the normal cache families, with the upstream's OWN witness

Direct upstream facts (pinned, read this round):

- `studio/server/pageframes.mjs:62-71` `pageFrame(root, base, rel, ms, width,
  overrides)`: `w = Math.max(32, Math.min(960, Math.round(width/2)*2 || 160))`;
  `tweaks = overrides?.some(o => o && typeof o === 'object' && 'at' in o) ?
  JSON.stringify(overrides) : ''`; `key = sha256('black\0' + rel + '\0' +
  Math.round(ms) + '\0' + w + (tweaks ? '\0' + tweaks : '')).slice(0, 24)`; the
  directory is `root/TOOL_DIR/cache/pageframes` and the three files are `<key>.jpg`,
  `<key>.json`, `<key>.stamp`.
- `pageframes.mjs:102-104`: `deps = [...new Set([rel, ...loaded])].filter(f =>
  existsSync(join(root, f)))` and the stamp is `stampOf(root, deps)`.
- `pageframes.mjs:119-122`: `stampOf(root, files) = sha256(files.map(f => `${f}:${s.mtimeMs}:${s.size}`).join('\n')).slice(0, 24)`.
- `pageframes.mjs:75-81` — **the upstream's own cache-validity rule**: the cached
  JPEG is used **iff** the deps JSON exists **and** `stampOf(root, files) === the
  content of <key>.stamp`, where `files = known.includes(rel) ? known : [rel]`.
- `pageframes.mjs:109` and `:124-127`: the film poster is written only when
  `rel === FILM_PAGE ('film.html')`, `ms < 0` and `w === POSTER_W (480)` — "the
  film's poster, kept as its last whatever film.html becomes": it is **explicitly
  stale** by the native's own design.
- `studio/server/server.mjs:563-566`: the producer is reached as
  `pageFrame(project.path, folderUrl, at, -1, 480, tweaks)` for a page poster and
  `pageFrame(project.path, folderUrl, at, ms, w, tweaks)` for a page frame, with
  `tweaks = clipOverrides(project.path, clipId)`.

The proposal — a witness, not a guess:

1. The upstream itself decides that a cache entry is usable by the **(deps JSON,
   stamp) pair**, not by the key and not by the pixels. The reader can reproduce
   that rule exactly from the bytes it already retains:
   - `<key>.json` parses to `{files: [...]}`; **every** listed file must be a
     retained relative path of the working copy;
   - the upstream's own stamp rule over those files' **retained** `mtime_ms` and
     `bytes` must equal the content of `<key>.stamp`;
   - all three files of the key exist (jpg + json + stamp) — the triple is the
     pairing;
   - the JPEG is then a derived item of the native's own producer. Its pixels are
     **not** verified — and the upstream does not verify them either: its rule is
     the stamp.
2. The **key is not recomputed**: `(rel, ms, w, tweaks)` are the *request's*
   parameters (`server.mjs:563-566`), not facts of the workspace, so recomputing
   the key would be exactly the reverse-hash guess MAIN forbade. The key only binds
   the three files together; the witness is the deps+stamp pairing.
3. `film-poster.jpg`: the native keeps it as the LAST poster whatever `film.html`
   becomes. The honest treatment is to classify it as a **known native-derived
   stale artifact** of the native's own producer path and never to use it as a fact
   about the current film — not to refuse it as unknown, and not to claim it proves
   a current render.
4. What stays UNPROVEN and needs MAIN's explicit bounded decision: the **poster**
   family can additionally be bound to the film (`rel='film.html'`, `ms=-1`,
   `w=480` → the key IS recomputable from the retained facts), but the **frame**
   family (an arbitrary browser-requested `ms`/`w`) cannot be bound to the film; its
   witness is the deps+stamp pairing alone. If MAIN wants the frame family bound to
   the clip as well, that needs the exact scope of the `ms`/`w`/overrides derivation
   — a decision, not a waiver.

Barriers/assertions: a legitimate pageframe triple, built by the test with the
upstream's **own** key and stamp rules over retained files, is accepted in a stable
round **and** its appearance invalidates the older proof (the R04 "legitimate cache"
pattern); a forged triple (a stamp that does not match the deps' current
mtime/size, a deps list naming a file that is not retained, a missing `.stamp`) is
refused with its own code and **nothing is deleted**; the film poster is classified
as the known stale native artifact and is never used as a proof. **No broad cache
whitelist is restored and no cache is ever a source of an expected fact.**

### G05 (MAJOR) — the real raw-child faults (test file only)

- Assert that each injected transport branch **actually fired** (a per-scenario
  counter): the current `:947` case can pass on the version query's failure before
  the media child even exists.
- Add a **real** hung child (a real `sleep` through the transport with a short
  deadline): the runner's real kill path → assert the child's **actual exit** was
  observed, the input FD was still held at that exit and released only after it, and
  the refusal is `NATIVE_PROBE_TIMEOUT`.
- Add a **real** stdout (>4 MiB) and **stderr** (>256 KiB) overflow: the refusal is
  `NATIVE_PROBE_OUTPUT` and the child was killed and reaped. The stderr limit
  currently has no input at all.
- Keep the injected cases, but label them as injections.

### G06 (MAJOR) — the missing original negative/fence cases (test file only)

- an absent **style** or an absent **heard transcript** that the sidecar consumer
  really consumes (the markers case never reaches `computeNativeEffectiveSidecars`):
  the read succeeds, and the file's later birth invalidates the old proof;
- an **empty-directory-only** birth while a proof is held;
- a replaced workspace ref / a moved generation **through the actual reader** (the
  current predicates are not consumption evidence);
- an owner / commit / control liveness transition **at a real await**;
- an **isolated** parent/root identity swap (the current case leaves an extra
  directory behind, so an earlier membership refusal could be the real reason);
- a **discriminating** caption-order fixture: the raw order must be asserted
  independently of the video listing's sort — if the platform's readdir is lexical,
  the current comparison cannot fail, and that limit must be labelled rather than
  claimed as mutation coverage.

### G07 (MAJOR) — the physical isolation

- `retained-native-closure.ts`: the membership gains the **link count** from the
  bigint `lstat` (`nlink`), so an alias is visible.
- `created-native-source-reader.ts` `:645-654`: refuse a retained leaf whose
  `nlink > 1` (it is an alias to another file) and refuse a source/workspace leaf
  pair that shares an inode on **any** path, not only the same relative path.
- Assertions: a workspace leaf hardlinked to an **external** identical file is
  refused (today it is accepted); a cross-path hardlink between the source tree and
  the working copy is refused; and the two trees' **empty directories** are retained
  and listed with their own descriptors, proved by two independent `(dev, ino)`
  allocations for the same relative path in the two trees.

### The gate after the round

One recorded serial sequence, then the freeze: `tsc --noEmit` → the pure gate
(18 cases) → the full component gate (34 cases) → the legacy regressions (107
cases), each with its own unique capture name, the ten hashes at the moment of each
run, and a cleanup receipt. Only then a candidate freeze for MAIN's independent
review.

## 4. What is NOT claimed

Not a completion of N1N2, not an independent review, not a NativeAck, not a Studio
or native-UI readiness, not an A-film result, not a human acceptance, not a business
acceptance. The green gates above are **internal evidence on these bytes only**.
No source, test, tool, config or index write happened in the 013 scope, and the
candidate is **not** frozen and **not** committed.

## 5. The ten released paths (the frozen candidate bytes)

| path | sha256 |
|---|---|
| `src/host/agent-driven/committed-snapshot-authority.ts` | `f8470afddb8e8732edb112379902c3e28f51892a0104d6182f13207d473906c9` |
| `src/host/agent-driven/created-native-workspace.ts` | `b57bed5df0ea600a2aa1a5b2dc3df2873f794389ee5274f32efb52a6f3d653ad` |
| `src/host/m5/openfilm-native-expected.ts` | `19110e45a83b6d5b611b4260620ce873f923f1e5a5b907bc6176c4b734fbeed3` |
| `src/host/agent-driven/retained-native-closure.ts` | `ab6697759a85c4a0b787ad00ce57b2a25680c5fb9630cf6a7797a10aa775a48e` |
| `src/host/agent-driven/created-native-source-reader.ts` | `b386615cb4036f0ce3d2bc65a5d9aa99ee8bc9c191f3468eb15baf65b2a33aa1` |
| `tests/agent-driven/integration/created-native-workspace.test.ts` | `439d469032c9af2b83ceb826e0aead7cf5c2fe5c5693be7cbf18c8e67f0f615f` |
| `tests/agent-driven/integration/committed-snapshot-host.test.ts` | `bfd0c6373b254050d32a6a99e7b6f8b9827dc24b6b2587515ab4c5aad2cd9037` |
| `tests/agent-driven/integration/created-native-ack.test.ts` | `5f50db85c7c07a2ecf4faefc20ec2ec6c7ad4910fafe549c2edc76bbad729c7c` |
| `tests/agent-driven/integration/created-native-source-reader.test.ts` | `bf1a7e3394142a07aa08ea3799fbe9ed3e2e9276ecbc0f6786e945ea40f72b6b` |
| `tests/agent-driven/integration/helpers/native-source-fixture.ts` | `19cb73cb9d69394e550699d3363128a4ea60e96a3f28f22e1ea4fce01c6dda0a` |

HEAD `e2eff61b464d75d36598103d718cd2a75db5dfda`, git index EMPTY, `AGENTS.md`
`37300463a72a612ae16e0a5fcfb496502c57c722b83781e0e2e8c9480594542b` untouched.

## 6. The plan as extended by MAIN's review of it (append-only)

MAIN's notes on the plan above (message `msg_ad48c97b273f`) are answered here.

### 6.1 G05 — the fault children are REAL OS processes, and the branch must be proven

The test transport may replace the transport, never the runner — and it may only
make the tool **fail**. The design:

- The injected child is a **real subprocess** of this test (spawned by the test
  itself, never a hand-written object with a fake pid): one that writes more than
  4 MiB on stdout, one that writes more than 256 KiB on stderr, one that sleeps
  forever, and one that exits abruptly. It emits **only a failure** — it never
  produces a tool answer, and **no case may assert a successful probe from it**.
- The **named branch hit** is asserted, not assumed: the reader's `childEvents`
  must show a `started` event whose argument is the `/proc/<pid>/fd/<n>` path of the
  MEDIA probe (the argv of the version query is `-version` and must NOT match), so a
  refusal can never be attributed to the wrong child.
- The **version query must not steal the timeout**: the transport lets the REAL
  `ffprobe -version` through (as the current case does), and the timeout case
  asserts that the timed-out child was the media probe, not the version query.
- The **stdout AND stderr** limits each get their own case (the stderr limit
  currently has no input at all), and each asserts `NATIVE_PROBE_OUTPUT`.
- The **kill/reap and the input-FD ordering** are asserted: the child's actual exit
  is observed, the input descriptor is still held at that exit and released only
  after it, and the reader's close waits for the child.
- The existing injected-transport cases stay, but are labelled as injections.

### 6.2 G07 — the hardlink policy, the final guard, the empty directories, the FD pool

**(a) The safe hardlink policy.** A regular file whose link count is greater than
one is an alias to another file, so it is not a file of this tree:

- `retained-native-closure.ts`: the membership carries the **link count** (`nlink`)
  from the bigint `lstat`, and the file's **admission** refuses a regular file with
  `nlink > 1` with its own code (a new, specific refusal — not a generic one).
- The **final guard** re-reads the CURRENT link count of the path and of the
  retained descriptor, so a hardlink created **after the issue** invalidates the
  proof: the old proof no longer verifies and the next round refuses the alias.
- `created-native-source-reader.ts`: the source/workspace leaf comparison is widened
  from "the same relative path" to **any** path pair that shares an inode, so a
  cross-path alias between the two trees is refused as well.

**(b) An external alias after the issue** is the case that proves (a): a working-copy
leaf is replaced by a hardlink to an **external** file with identical bytes — the
bytes are equal, the identity is an alias — and the final guard must see it.

**(c) The empty directories of both trees, retained independently.** The reader must
**retain every directory** of the working copy and of the committed source (not only
the ones it needs), so that every empty directory is held by its own descriptor;
the facts then expose the retained directory identities, and the proof is that the
**same relative path** in the two trees has **two independent allocations** (a
different `(dev, ino)` and a different live descriptor), and that a nested empty
directory of each tree is held as well.

**(d) The FD budget becomes instance-wide, not per closure.** Today each closure
caps itself (`maxDescriptors`), so two trees could hold twice the intended number
of descriptors. The design:

- A **shared instance descriptor pool** lives in `retained-native-closure.ts`: one
  counter, one limit, shared by **every** closure of the process (the source closure
  of the authority and the working-copy closure of the reader draw from the SAME
  pool, because they are two halves of one acquisition).
- Every allocation **reserves from the pool before the open** and **releases on the
  close**, exactly as the per-closure counter does today; the refusal is
  `NATIVE_CLOSURE_BUDGET` **before** the open, so the process never reaches EMFILE.
- The per-closure `maxDescriptors` stays as an ADDITIONAL cap.
- The pool's limit and its current use are **readable** by the Host's own tests
  (a Host-private export on this private module — no public contract, no DTO), so a
  case can prove that two trees share ONE count and that the count returns to zero
  when both are released. A case can also lower the shared limit to prove that the
  SECOND tree is refused while the first is still held.
- **Alternative, needing an exact scope from MAIN:** an explicit pool object passed
  into `RetainedNativeClosure.open` and then into `acquireNativeFacts` — this
  changes an internal method signature, so it is proposed only, not assumed.

### 6.3 G04 — the witness keeps the normal native cache and the stale poster semantics

The proposal of section 3 stands, with the two semantics MAIN named made explicit:

- **The normal native cache is preserved**: a pageframe triple that satisfies the
  upstream's OWN cache-validity rule (the deps JSON names retained files, and the
  upstream's own `stampOf` over their current `mtime:size` equals the stored stamp)
  is **accepted** in a stable round, and its appearance invalidates the older proof
  — the cache becomes a normal, provable native derivation again.
- **The stale poster semantics are preserved**: `film-poster.jpg` is the native's
  LAST poster "whatever film.html becomes" (`pageframes.mjs:109`, `:124-127`), so it
  is classified as a **known native-derived stale artifact** and is never used as a
  fact about the current film — neither accepted as a proof nor refused as unknown.
- No new HTTP DTO, no EnginePort, no pin or artifact change, no fake authorisation,
  no broad whitelist, and no cache is ever a source of an expected fact.

### 6.4 The one round, and what stays UNPROVEN

All of G01–G07 plus the 17 closure requirements are ONE round with ONE gate
sequence at the end (`tsc` → the pure gate → the full component gate → the legacy
regressions), not one bug per round. The requirements that cannot be closed inside
this round's private scope are listed in section 7 as UNPROVEN with their concrete
reason and the exact decision MAIN would have to take — not waived.

## 7. The 17 closure requirements → what this round does, and what stays UNPROVEN

| # | Requirement | Closed by | The assertion that will exist | Honest verdict after the round |
|---|---|---|---|---|
| 1 | R01 `producer_chain` | G06 | a negative rights/graph tamper per **new** lease: the committed rights digest or the consumer graph is changed after the issue and the new lease is refused with its own code (the F08 bodies already prove the lineage fence) | **PROVED for the component scope**; the accepted review/approval remains fixture policy and is labelled as such |
| 2 | R01 `independent_trees` | G07 (a)(c) | the two trees' same-relative-path leaves and **every empty directory** are held by distinct live descriptors with distinct `(dev, ino)`; an external alias is refused | **PROVED for the component scope** |
| 3 | R02 `tamper_and_authority` | G03, G07, G06 | the between-digest-and-parser swap/growth barrier; the isolated parent/root swap (no extra membership left behind); the owner/commit/control liveness transition at a real await; a replaced ref/generation through the actual reader | **PROVED for the listed vectors**; the parser-read window is closed by G03 |
| 4 | R03 `complete_dependencies` | G06 | an absent **style** and an absent **heard transcript** that the sidecar consumer really consumes → the read succeeds, and the file's later birth invalidates the proof; an empty-directory-only birth; the settings/style add/delete variants; a caption fixture that is discriminating against a sorted readdir | **PROVED for the component scope**; the valid-translation consumer stays unreachable from this producer (the producer writes one VTT and no translations) and is labelled as such |
| 5 | R04 `native_cache` | G04 | a legitimate pageframe triple built with the upstream's own key/stamp rules is accepted in a stable round and invalidates the older proof; a forged stamp/deps/missing-stamp triple is refused with its own code and nothing is deleted; the stale poster is classified, not refused and not used as a fact | **PROVED for the reachable families**; the frame family's binding to a clip (a browser-chosen `ms`/`w`) needs MAIN's bounded decision — it is not waived |
| 6 | R05 `actual_probe` | G05 | a real reader round whose probed duration disagrees with the film trim/subtitle is refused; a source/parent swap **during** the held-FD probe is refused; the rotated/multi-stream normalisation runs through the reader's held descriptors, not only through a separate tool call | **PROVED for the component scope**; the diagnostic media remains diagnostic and is never called an A film |
| 7 | R05 `child_lifetime` | G05 | a real hung/abrupt child: the actual exit is observed, the input FD is held at the exit and released after it, the refusal is `NATIVE_PROBE_TIMEOUT`; real stdout **and** stderr overflows are refused with `NATIVE_PROBE_OUTPUT`; the branch hit is asserted and the version query cannot steal the timeout | **PROVED for the component scope** |
| 8 | R06 `native_bytes_and_order` | G06 | the raw caption order is asserted independently of the video listing's sort, with a fixture that can actually fail if the order were sorted; the five byte vectors are additionally run through the full reader film path | **PROVED for the component scope** |
| 9 | R07 `budgets` | G03, G07(d) | the parser's read is bounded by the retained text; a `maxPaths` overflow case; the instance-wide FD count refuses the second tree while the first is held; the real tool's stdout/stderr limits are exercised | **PROVED for the component scope** |
| 10 | R07 `per_allocation_fd_lifetime` | G01, G07(d) | the same per-allocation rule is asserted across the **authority→reader** boundary, not only inside one closure: a source allocation is released exactly once even when its release fails | **PROVED for the component scope** |
| 11 | R07 `cleanup_uncertainty` | G01 | the authority-to-reader fault: a source open/unpack failure with a failed source close → the reader's sticky ledger holds the causes, the next read is refused with `NATIVE_SOURCE_READER_UNCERTAIN` and the reader's close reports them; the cancelled raw rejection carries its causes into the same ledger | **PROVED for the component scope** |
| 12 | R07 `drain_and_delivery` | G02 | the final closed/uncertain fence refuses the in-flight proof instead of delivering it; every handle is released once on that path; the rule that a close **after** a completed delivery does not destroy owner-held resources is asserted as well | **PROVED for the component scope** |
| 13 | R01/R02 `lease_isolation` | G06 | a replaced generation / a replaced ref is refused **through the actual reader** (a brand predicate alone is not evidence); a foreign lease substituted into a real acquisition is refused | **PROVED for the component scope** |
| 14 | REG `existing_behavior` | the whole round | the Expected lifecycle body and the 84 inherited assertions are unchanged (the diff is parser-only plus the missing-export case); the loader's artifact and pin are unchanged; the three legacy files pass on the final bytes | **PROVED by the legacy gate on the final bytes** |
| 15 | EVIDENCE `frozen_capture` | the whole round | one recorded sequence with the ten hashes at the moment of each run, the actual exits, the raw logs and their digests, the cleanup receipt, and no capture overwritten | **PROVED for the final bytes**; the candidate freeze is MAIN's decision |
| 16 | REVIEW `independent_acceptance` | MAIN | the round-2 gap audit (and this round's own plan) are the inputs; a NEW read-only independent review of the frozen candidate is required — this child signs nothing | **PENDING MAIN** |
| 17 | NEXT `next_integration_plan` | MAIN | the next-stage contract is rebound only after N1N2 is accepted | **DEFERRED** |

## 8. Erratum of section 7 — the verdicts there are TARGETS, not achieved facts (append-only)

MAIN's instruction (`msg_fd79d491fa8e`): "All future PROVED table entries currently
TARGET_NOT_RUN, not achieved."

Section 7 above therefore describes **targets**: every "PROVED for the component
scope" wording there is a **TARGET_NOT_RUN** entry — the requirement that the
consolidated round will close, once MAIN releases it and the round actually runs.
**Nothing in section 7 has been achieved.** The only achieved facts are the
executions of the current bytes recorded in sections 1 and 5:

| achieved on the current bytes | capture | exit | result |
|---|---|---|---|
| the pure gate (18 cases) | `n1n2-claude-resume-100-gate-pure` | 0 | 18 passed / 34 filtered, log `62c7c84b039019dc1a411e55ca7f3892c641982052456955d90453e97a339a9c` |
| the two component targets | `n1n2-claude-resume-101-gate-component-focused` | 0 | 2 passed / 50 filtered, log `18857c1d892cc3f8a5e191ac6b560d3c7c1b02853b12ea13c3784b9dc8261fb5` |
| the full component gate | `n1n2-claude-resume-102-gate-component` | 0 | 34 passed / 18 filtered, log `18cd9b8e9f40058b1f5e6887a066cd55efd50cf1eeb938a0a8b04528491ff1ac` |
| the legacy regressions | `n1n2-claude-resume-095-gate-legacy` | 0 | 107 passed / 107, log `80fd6fc8ac54da5d8f22498b2d79881ac5c9c60cc33961cfa787805496fdbd19` |
| the compile | `n1n2-claude-resume-099-tsc-dedupe` | 0 | empty log, no input drift |

The R01–R07 verdicts of section 2 keep their wording ("PARTIAL", "BOUNDED",
"UNPROVEN", "PENDING", "DEFERRED") — those describe **what the current bytes
prove**, which is a fact. It is only section 7, which describes the future round,
that is a target.
