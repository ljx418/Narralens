# N1N2 — the 014 implementation record (G01–G07, one round)

Writer: Claude implementation child, task `task_5dcbe8192764` / dispatch
`ctx_b4086093cd96`, terminal `term_d383bb87-4e85-4090-a651-e24d730f642b`, coordinator
`term_c42901ca-2c06-452f-8f59-085ab98adb8a`. Sole writer of the ten released paths;
MAIN is the sole reviewer and document owner.

Authority: `resume-claude-20261112/G01_G07_CONSOLIDATED_014_RELEASE.md`
(sha256 `2c2b0225ea951bb3b5df33b4368da528aeae6156621305e6c02ef67cfb3a500a`) and its
`.json` (sha256 `38faf27bd3340ccdccfc8fc960ff17f4d649f39c99832214a75e5a199748b084`).
The proposal REVISION 1 sha256 `eedc56388ebfcd833256b92be364a89258105a9fc285e57205585b02daaa79f3`
matches MAIN's independent check.

**Nothing has been run except the recorded serial `tsc`.** No vitest, no Host, no
media, no browser, no build. Every verdict below is a TARGET, not an achieved fact.

## 1. The ten writable paths after the implementation

| path | sha256 | changed |
|---|---|---|
| `src/host/agent-driven/retained-native-closure.ts` | `bd83a07eb2e9d7ca4acbd30e131a19b225b7f82b50a574b64f178b86ec297c29` | yes |
| `src/host/agent-driven/committed-snapshot-authority.ts` | `53321dfe1560b8403d9b78ca643eb24ff4ce6360a619cee30adbff0fc7b8bca5` | yes |
| `src/host/agent-driven/created-native-source-reader.ts` | `20f20dad2ac532e43832ec26e426343fd3794d13c85df09b2d6b5f67c81c4e22` | yes |
| `src/host/agent-driven/created-native-workspace.ts` | `a04defc20f7e88ebfa5041d6153bc64d1d2b520670aa96916f65b2aaad87c38c` | yes |
| `src/host/agent-driven/native-cache-witness.ts` | `b5aad45d437f2807ee309dbb2787abb7eefbe637ea2eea35671bc0805fe2a838` | yes (NEW) |
| `src/adapters/openfilm/openfilm-upstream.ts` | `89cf1859f5c0834871031d05dd22562492944475842c82d5dbd0cfab9e183cb5` | yes |
| `tests/agent-driven/integration/created-native-source-reader.test.ts` | `18e5e73ddb7438f552d3a3bab8cd86ea90ed8d31879b058c0f3721aacfe3cfb3` | yes |
| `tests/agent-driven/integration/helpers/native-source-fixture.ts` | `19cb73cb9d69394e550699d3363128a4ea60e96a3f28f22e1ea4fce01c6dda0a` | no (not needed) |
| `tests/agent-driven/integration/committed-snapshot-host.test.ts` | `bfd0c6373b254050d32a6a99e7b6f8b9827dc24b6b2587515ab4c5aad2cd9037` | no (the legacy path is unchanged) |
| `tests/agent-driven/integration/native-cache-witness.test.ts` | `a11e20be296f43c08e7b4780ee4eec3e95c56a81d58db0581eca2df9bf920f8a` | yes (NEW) |

Unchanged and protected: `src/host/m5/openfilm-native-expected.ts`
(`19110e45a83b6d5b611b4260620ce873f923f1e5a5b907bc6176c4b734fbeed3`),
`tests/agent-driven/integration/created-native-ack.test.ts`
(`5f50db85c7c07a2ecf4faefc20ec2ec6c7ad4910fafe549c2edc76bbad729c7c`),
`tests/agent-driven/integration/created-native-workspace.test.ts`
(`439d469032c9af2b83ceb826e0aead7cf5c2fe5c5693be7cbf18c8e67f0f615f`), `AGENTS.md`
(`37300463a72a612ae16e0a5fcfb496502c57c722b83781e0e2e8c9480594542b`). HEAD is still
`e2eff61b464d75d36598103d718cd2a75db5dfda` and the git index is still EMPTY. No
add, commit, reset, stash, checkout or push.

## 2. What each G became

### G01 — an error is not a cleanup uncertainty
- `retained-native-closure.ts`: a private `WeakMap` ledger of GENUINE release
  failures, with `retainedCleanupFailures(error)` and
  `markRetainedCleanupFailures(error,causes)`; `mergeRetainedCleanupCauses(error,
  causes)` (exported) merges the causes into the primary and marks them; `failOpen`
  does NOT mark, so an ordinary `EIO` cause never marks anything.
- `committed-snapshot-authority.ts`: the acquisition's catch merges the closure's real
  release failures into the primary (never replacing the causes it already has) and
  marks them; `#streamDigest` keeps the named syscall cause instead of replacing it
  with a bare `REVISION_CONFLICT` (`changed(cause?)`).
- `created-native-source-reader.ts`: `#adopt` adopts only the GENUINE uncertainty of a
  raw rejection into the reader's existing sticky ledger; the read's own catch merges
  its real failures the same way.

### G02 — the delivery linearization point
`created-native-source-reader.ts` `#read`: after the last await and the last callback
of `#readFacts`, and with **no** await and **no** re-entrant callback between the
check and the flag, the reader refuses when it is closed or uncertain
(`NATIVE_SOURCE_READER_CLOSED` / `NATIVE_SOURCE_READER_UNCERTAIN`) into the existing
all-attempt pre-delivery cleanup. The post-delivery ownership rule is untouched.

### G03 — the parser consumes bounded, retained bytes
`committed-snapshot-authority.ts` only: `#parseRetainedFilm(closure)` reads the
BOUNDED retained text, writes it into an OWNED private folder (mkdtemp → 0700) as a
0600 file (flag `wx`), and calls the SAME pinned `readProjectFilm` on that immutable
copy; the copy is removed afterwards and a failure of that removal is kept with the
failure that stopped the parse. The legacy render path (the closure-less
`#nativeLineage`) keeps its own behaviour, and the original source's final
identity/hash fence is unchanged. The adapter needed no change for this.

### G04 — the witness comes from the real producer
- `native-cache-witness.ts` (NEW): the witness type, the `nativeCacheKey` and
  `nativeCacheStamp` helpers (the upstream's own formulas), the issued brand
  (`WeakSet`), the registry, and `produceNativeCacheEntry` — the guarded wrapper
  whose order is fixed: the key is computed with the upstream's formula, a
  pre-existing unwitnessed triple is REFUSED (a cache hit is never witnessed as a
  production), the fixed producer runs, the three files it wrote are read back and
  hashed, the returned picture must be the file that is there, the dependency list is
  the one the producer ITSELF wrote, every dependency is hashed by the Host, and the
  upstream's own stamp over them must be the stamp that was written. Only then is the
  witness issued and recorded.
- `created-native-workspace.ts`: the per-instance ledger; the service implements the
  registry, refuses a lookalike, a clone, another view and another generation, and
  the witnesses die with the instance.
- `created-native-source-reader.ts`: a pageframe entry and the poster are accepted
  ONLY with a live witness of this instance and generation whose picture, dependency
  list and stamp digests equal the retained files', and whose dependencies are all
  retained with the same bytes and size. A fabricated but self-consistent triple is
  refused with `NATIVE_SOURCE_CACHE_UNWITNESSED`.
- `openfilm-upstream.ts`: a NEW guarded factory that loads `pageframes.mjs` from the
  SAME pinned tree (after that tree's SHA and cleanliness are verified), records the
  digest of the file that was really loaded, and wraps `pageFrame`, `filmPoster` and
  `closePageFrames`. The three original methods, the pin fields, the seam exports and
  the artifact are untouched. The shared browser is owned by a ledger: an owner stops
  admitting, drains the calls it really started, and the browser is closed only when
  the LAST owner has drained and nothing is in flight.

### G05 — the real subprocess faults
The injected children are REAL local processes of the test and emit ONLY a failure;
the version query stays the real fixed `ffprobe`; the branch that failed is proven
through the reader's own `childEvents` (the media probe's `/proc/<pid>/fd/<n>`
argument, never `-version`).

### G06 — the original discriminating cases
The absent heard transcript (the real negative fact) and its later birth, the
empty-directory-only birth, the stale generation at the reader, the foreign lease
consumed through the actual reader, and the isolated parent swap that leaves no extra
file behind.

### G07 — the physical isolation and the instance budget
- `retained-native-closure.ts`: the membership carries `nlink`; a REGULAR FILE with
  `nlink > 1` is refused at admission (`NATIVE_CLOSURE_ALIASED`) — **directories are
  exempt**, their link count is normally greater than one; the final guard re-reads
  the CURRENT link count of the path and of the descriptor, so a hardlink that
  appears after the issue invalidates the proof.
- The descriptor budget is an EXPLICIT, brand-checked pool instance argument
  (`RetainedDescriptorPool`, `RetainedDescriptorBudget`,
  `isRetainedDescriptorPool`), passed optionally into `RetainedNativeClosure.open`
  and `acquireNativeFacts`; the reader owns ONE pool per instance and shares it
  between the source tree, the working copy and the parallel proofs; the reservation
  happens before the open, a failed open rolls it back, and an UNCERTAIN release does
  NOT return the capacity. The per-closure cap stays as an additional bound.
- `created-native-source-reader.ts`: the alias comparison covers ANY path pair that
  shares an inode (not only the same relative path); every directory of BOTH trees is
  retained, so an empty or nested directory is evidence of its own, and the reader
  exposes the retained directories' identities (`retainedDirectories`).

## 3. The actual case inventory (enumerated, not forced)

The reader file holds **71** cases: **18 pure** and **53 component** (the 34 of the
component filter plus the 19 new `G0…` cases). The filters are mutually exclusive
(0 in both) and their union covers the whole file (0 in neither). The new browser
file holds **2** cases (`B0-1`, `B0-2`), in neither filter of the reader file: they
are a separate invocation.

| group | cases | what they assert |
|---|---|---|
| G01 | 3 | the genuine uncertainty of a rejected acquisition is adopted; an ordinary failure leaves the reader usable (the negative control); the causes of a late raw rejection |
| G02 | 2 | the reader is closed inside the LAST verification's callback → the round is refused; another delivered proof fails to release during the final work → the round in flight is refused |
| G03 | 1 | the film's path replaced by a directory between the digest and the parse → the refusal is the revision fence, not the engine's refusal of a non-regular file: the parser never opened the mutable path |
| G04 | 2 | a self-consistent pageframe triple with no witness is refused and nothing is deleted; the poster without its exact paired witness is refused |
| G05 | 3 | a real stdout overflow and a real stderr overflow are refused; a real hung child is killed and reaped and the input stays held until it ended; the named media branch is the one that failed |
| G06 | 5 | the absent heard transcript is accepted and its birth invalidates the proof; an empty directory born alone invalidates it; a stale generation is refused; a foreign lease consumed through the reader is refused; an isolated parent swap with no extra file is refused |
| G07 | 4 | an external hardlink is refused; a hardlink that appears after the proof invalidates it; both trees and a parallel proof share ONE pool count; every nested and empty directory of both trees is held independently |
| B0 (browser) | 2 | the fixed producer really draws on the diagnostic local page and the witness binds the request, the key, the triple and the dependencies (and the old proof is invalidated while the next round accepts it); a pre-existing triple is refused and its old bytes stay untouched |

The existing `F05` case's expected reason changed from
`NATIVE_SOURCE_CACHE_UNPROVABLE` to `NATIVE_SOURCE_CACHE_UNWITNESSED`: the refusal
is still there, with the more precise reason of the new contract. No other old
assertion was rewritten, and the legacy files were not touched at all.

## 4. The compile evidence (recorded, serial, the standing grant)

| capture | argv | exit | log |
|---|---|---|---|
| `n1n2-claude-resume-103…110` | `corepack pnpm exec tsc --noEmit` | 2 (a missing method on the pool interface; a missing `never` annotation) | the failures of my own making, preserved |
| `n1n2-claude-resume-111…116` | `corepack pnpm exec tsc --noEmit` | **0** | empty log (`e3b0c442…`), `source_changed []`, `source_added []` |

The last compile of the round is `n1n2-claude-resume-116-tsc-browser-test`, exit 0,
empty log, no input drift. Every failed capture of this round is preserved under its
own name and none was re-run under it.

## 5. What is NOT covered — kept UNPROVEN for MAIN's ruling

These are technical constraints, not waivers:

1. **The absent style path is unreachable with this fixture.** The committed source
   always holds `.film/settings.json`, and the reader requires the working copy to
   hold every committed file, so the style can never be absent in a read. The
   settings/style add-delete variants of G06 would need a producer that writes no
   style — a fixture change beyond this ticket's component scope. The absent heard
   transcript and its birth ARE covered.
2. **The owner/control liveness is checked at the start of a read, not after an
   await.** The reader's `binding.isCurrent()` fence runs before the acquisition; the
   generation fence runs right after the lease. A control transition *between* two
   awaits of a read is not observed by the reader itself (the Expected service
   fences it at `assertCurrent`).
3. **The G05 abrupt-exit and cancel variants are not new cases**: the abrupt exit
   and the reader's close during a read are already covered by the existing
   "R07 lets the real media child exit before the reader closes" and "R07 ends a
   read at a close and releases a late result exactly once" cases; the new cases add
   the real stdout/stderr overflows, the real hang and the named-branch proof.
4. **The caption-order case remains non-discriminating** when the platform's
   `readdir` is lexical: the raw order is asserted against the platform's own order,
   which cannot fail if the platform is sorted. A discriminating fixture needs a
   consumer that reorders, which is outside this ticket.
5. **A frame's request is bound, its clip is not.** The witness binds the request
   (rel, ms, normalized width, overrides) exactly, but nothing proves that a request
   corresponds to a clip of the film — the upstream's own cache rule does not use it
   either. The poster keeps the native's LAST semantics: it is a retained
   non-authority cache and never says that the current film was rendered.
6. **The quarantine route was not implemented.** The wrapper REFUSES a pre-existing
   unwitnessed triple instead of quarantining it, which the release allows
   ("拒绝该实例，或…保全并隔离"). Nothing is deleted and nothing is moved out of the
   workspace, so no quarantine location had to be owned.
7. **The browser case has never been executed.** It is written against the pinned
   producer, the local loopback server and the real chromium, but no browser has
   been started: the grant for that resource has not been given.

## 6. What is NOT claimed

Not a completion of N1N2, not an independent review, not a NativeAck, not a Studio
or native-UI readiness, not an A-film result, not a human acceptance. Every group
verdict of this round is a TARGET until the gates actually run. The candidate is not
frozen and not committed.

---

# Addendum — the MAIN preflight corrections (014-P01…P07 and the original gaps)

MAIN's review `G014_MAIN_PREFLIGHT_REVIEW.json` (verdict
`REQUEST_CHANGES_BEFORE_HEAVY_OR_BROWSER`) and its message `msg_597c554f49ec` asked
for seven concrete corrections and five original-scope gaps. All of them are now in
the source; the interim pure gate `n1n2-claude-resume-117-gate-pure` (exit 0, 18
passed, 53 filtered, log `3c4dba0d2a28e8b410f1d38ef137f55e91e9e35e2a27b3ac81ea232efb8cf929`)
ran BEFORE these corrections and is preserved as it was.

| finding | what it became |
|---|---|
| 014-P01 (an arbitrary structural producer/registry/root could mint an issued witness) | the producer must be the one the Host's factory ISSUED (`isIssuedOpenFilmCacheProducer`, a brand), and the root must be the ISSUED root of that view and generation (`issuedRoot` on the registry). The test's repacked producer is gone: the owner itself is the producer, and a repack is not branded. |
| 014-P02 (no pre-render retained dependency closure) | the tree is RETAINED before the draw and again after it: the page must be the very same file (device, inode, digest, size, change time) before and after, and the upstream's own stamp over the dependencies must be the stamp that was written. |
| 014-P03 (the poster always refused) | the poster is the PAIRED output of one awaited `pageFrame` of the film's own page (`rel='film.html'`, `ms=-1`, `width=480`); the upstream writes the poster while it draws that page, so the wrapper draws it and witnesses it - and the reader compares the poster's digest with the witness's `poster_sha256`. |
| 014-P04 (the overrides key was wrong) | the upstream's own predicate: the overrides are hashed ONLY when one of them is an object that carries an `at` (`upstreamCacheTweaks`); an empty list or a list without such an override hashes as nothing. |
| 014-P05 (unbounded allocation, raw path reads, unvalidated paths, untracked FDs, a wrong media limit) | every dependency and every written file is read through the EXISTING retained closure: the safe root, the tracked descriptors, the 8 MiB / 64 MiB metadata limits, the 64 KiB hash buffer, the identity fence on fstat, no parent-link traversal, and the media hash streamed without the text cap. The closure draws from the same instance pool. |
| 014-P06 (the loopback server did not stop the browser from leaving) | the answer carries a content-security-policy that allows this folder only, the served file must really be inside the folder (a link out of it is refused), and the case is labelled as a no-egress fixture. |
| 014-P07 (the early `filmPoster` race hid the raw work from the owner drain) | the owner's `filmPoster` is GONE: the poster is drawn through the awaited `pageFrame`, so there is no background promise to lose; the owner drains its own calls and the shared browser is closed only by the LAST owner. The browser case `B0-2` proves that one owner's close does not kill a peer's draw in flight. |

The original-scope gaps that were still open are now closed as cases:

- **G01** — a raw rejection that arrives AFTER the caller was cancelled is a real
  deferred fault path: the reader adopts the GENUINE uncertainty of it and its close
  reports it.
- **The final liveness fence** — the binding's `isCurrent()`, the committed source's
  lease and the working copy's lease are checked at the last moment, right before
  the delivery, with nothing running in between; the cases flip the binding during
  the media probe and replace the working copy's view during it.
- **The real child's faults** — a child that dies by a SIGNAL is refused as
  interrupted, and a child that is CANCELLED while it runs is proved by the order of
  the child's own exit and the read's rejection.
- **The present settings** — a working copy whose settings file was deleted is not
  the committed source any more, and a held proof does not survive it.
- **The caption order** — a clearly labelled non-lexical SUPPLIER fixture hands the
  ACTUAL pinned consumer an order that is not lexical; it says nothing about the
  order the platform returns (the platform's own vector stays where it was).

## The inventory after the corrections

The reader file holds **77** cases: **18 pure** and **59 component** (the 34 of the
component filter plus **25** new ones: G01 x3, G02 x4, G03 x1, G04 x2, G05 x4,
G06 x7, G07 x4). The filters stay mutually exclusive (0 in both) and their union
covers the whole file (0 in neither). The new browser file holds **3** cases
(`B0-1` the real producer and the witness, `B0-2` the peer owner's drain and close,
`B0-3` the pre-existing triple refused), in neither filter of the reader file.

## The ten writable paths after the corrections

| path | sha256 |
|---|---|
| `src/host/agent-driven/retained-native-closure.ts` | `bd83a07eb2e9d7ca4acbd30e131a19b225b7f82b50a574b64f178b86ec297c29` |
| `src/host/agent-driven/committed-snapshot-authority.ts` | `53321dfe1560b8403d9b78ca643eb24ff4ce6360a619cee30adbff0fc7b8bca5` |
| `src/host/agent-driven/created-native-source-reader.ts` | `128fb4d23929faace3c32f12f8e6d98d2001436636357bec60e58f3ac2c9b814` |
| `src/host/agent-driven/created-native-workspace.ts` | `3decdc3d826e323a943589b372ccca23560802170b2cebf34904fc2355fbca56` |
| `src/host/agent-driven/native-cache-witness.ts` | `87d05c958672e7030a202f75eafc6f2e38f2d79e59e80d28a06d3926f03fdb04` |
| `src/adapters/openfilm/openfilm-upstream.ts` | `046cb8bd74a70770b1afc8dc5bf2800a6a54c35961e75254a1b7b5ae2dcb086d` |
| `tests/agent-driven/integration/created-native-source-reader.test.ts` | `83d13030b19a6e3bc79eaa2104a53ab31cfc8214b9fbce8047a24cc34bb0d21a` |
| `tests/agent-driven/integration/helpers/native-source-fixture.ts` | `19cb73cb9d69394e550699d3363128a4ea60e96a3f28f22e1ea4fce01c6dda0a` |
| `tests/agent-driven/integration/committed-snapshot-host.test.ts` | `bfd0c6373b254050d32a6a99e7b6f8b9827dc24b6b2587515ab4c5aad2cd9037` |
| `tests/agent-driven/integration/native-cache-witness.test.ts` | `114ddd385e0d67dd2b78f4b9af46fb2c49987e7fbc9dc4e96892994917379e82` |

(The browser test file's digest is the one before the renumbering of its titles; the
renumbering changes only the two titles and the file's digest is recomputed in the
handoff message.)

Unchanged and protected: `openfilm-native-expected.ts`
`19110e45a83b6d5b611b4260620ce873f923f1e5a5b907bc6176c4b734fbeed3`,
`created-native-ack.test.ts` `5f50db85c7c07a2ecf4faefc20ec2ec6c7ad4910fafe549c2edc76bbad729c7c`,
`created-native-workspace.test.ts` `439d469032c9af2b83ceb826e0aead7cf5c2fe5c5693be7cbf18c8e67f0f615f`,
`AGENTS.md` `37300463a72a612ae16e0a5fcfb496502c57c722b83781e0e2e8c9480594542b`.
HEAD `e2eff61b464d75d36598103d718cd2a75db5dfda`, the git index EMPTY.

**Correction of the addendum's last line:** the browser test file's digest after the
renumbering of its two titles is
`6cb418cd4fa2ed9481ec98130b9133ceb7a20d04f53f8c072b14b19c4aa8ff2c`.

---

# Addendum 2 — the corrections of the 126 failures and of MAIN's clarifications

The 126 component gate failed (13 cases) and its capture is preserved unchanged. The
source and the fixtures now carry the fixes; nothing has been executed since.

## The source fixes

- **The authority's public boundary is restored.** A failure of the retained tree is
  the revision fence (`REVISION_CONFLICT`) with the named cause attached - EXCEPT the
  two refusals whose visibility IS the Host's: the budget's own refusal and a release
  that did not finish keep their own code. When the wrapped failure carried GENUINE
  release failures, they are kept and stay marked, so the reader still adopts the
  uncertainty.
- **The reader keeps its own alias refusal** (`NATIVE_SOURCE_COPY_ALIASED`): the
  closure's `NATIVE_CLOSURE_ALIASED` is translated into it, so F04's boundary and
  its meaning are unchanged.
- **The delivery fence is linearized.** The liveness callbacks (the binding's
  `isCurrent()`, the committed source's lease and the working copy's lease) run
  FIRST, and the reader's own closed/uncertain state is checked AFTER them, with no
  callback and no await between that check and `owned.delivered = true`. A callback
  may re-enter the reader - the last one may close it and still answer true - and the
  delivery is refused.
- **The witness binds the issued root and the frame key.** The dependency list and
  the stamp are the ones of the COMPUTED frame key (the poster is the paired output
  of that very draw), the registry is no longer a self-branded factory, and the
  service's own `record` - which knows its refs, generations and roots - is the
  unforgeable gate.
- **The PRE/POST dependency closure is real.** Every regular file of the tree is
  retained and hashed BEFORE the draw, that closure stays OPEN across it, and every
  dependency the producer declares is compared with its PRE facts afterwards -
  device, inode, digest, size, change time AND the inode's change time, so a file
  whose content was changed and restored under the same inode is refused. A
  dependency that was not in the PRE membership is refused as well.
- **The factory returns the object it brands**, so the real producer is the branded
  one.
- **The retained file's facts carry the inode's change time** (`ctime_ms`).

## The fixture fixes

Every one of the thirteen failures was a fixture that did not hit the boundary it
named; no assertion was weakened and no protected expectation was changed.

- **G01 (the first fault)**: the leaf that moves is the named primary, and the
  release fault is armed AFTER the enumeration, so the first failure is the primary
  and the second one is the release - in that order.
- **G01 (the ordinary failure)**: the missing file is the ordinary refusal it is,
  and the reader stays usable.
- **G01 (the late rejection)**: the RAW close promise is kept (a derived promise
  hid both of its outcomes), the raw acquisition's entry is synchronized, and the
  late rejection's genuine cause reaches the reader's ledger.
- **G02 (the invalidated view)**: the service's own close invalidates every ref -
  a second preparation of the same binding would NOT (it reuses the cached view by
  design, and that reuse is not broken).
- **G02 (the other proof)**: the case expects its OWN cleanup failure - the failed
  release is the behaviour under test.
- **G02 (the reentry)**: a new case - the last liveness callback closes the reader
  and answers true; no proof is delivered and every pre-delivery resource is
  released.
- **G03**: the refusal is the revision fence, never the engine's refusal of a film
  that is not a regular file - which is what proves the parser never opened the
  mutable path.
- **G05**: the case waits for the NAMED media child (its real pid and its
  `/proc/<pid>/fd/<n>` argument, the version query excluded) before it closes the
  reader, and it asserts the media child's exit, the input descriptor still held at
  that exit, and the order before the read's rejection.
- **G06 (the supplier)**: the ACTUAL pinned consumer receives two captions whose
  order IS observable (the languages of the alternative lines follow the listing),
  the exact order-dependent value is asserted, and the sorted listing gives a
  DIFFERENT value.
- **G06 (the absent transcript)**: the absent fact is a real producer-owned one -
  the producer writes ONE transcript, for the narration, and the video media has
  none at all.
- **G06 (the parent swap)**: the swap happens AFTER the source was opened and the
  moved sibling is removed again, so nothing extra is left; the HELD proof and the
  next round are refused, and a new acquisition of a legitimately changed source may
  still acquire - no inode authority is persisted.
- **G07 (the empty directory)**: it is a GENUINE native cache directory
  (`.film/cache/probe`), the arbitrary unknown directory stays refused, and the two
  trees' same relative path are shown to be two independent allocations.

## The browser fixture

- the ready promise is awaited before the base is used, and the producers are
  drained BEFORE the server and the fixture go;
- the server records every request it answered;
- **SILENT is proven, not assumed**: the installed Playwright adds `--mute-audio` in
  its headless branch (`playwright-core/lib/coreBundle.js`), and the pinned
  upstream launches with `headless: !headed` and `headed` false by default;
- **NO EGRESS is bounded honestly**: the answer carries a CSP that allows this
  folder only and a file that is not really inside the folder is refused - but the
  request log only shows what REACHED this server, so it cannot prove that no
  request went elsewhere; the policy forbids it, and the page is the native's own
  film page whose resources are the folder's. The Host does not own the browser and
  cannot intercept its requests; that limit is stated, not hidden.
- new cases: the normal PAGEFRAME family (the real producer, the witness, the
  reader's acceptance), a producer the Host did not issue (refused), and a registry
  the Host did not issue (the witness it records is worth nothing: the reader only
  asks the service it holds, and the service never saw it).
