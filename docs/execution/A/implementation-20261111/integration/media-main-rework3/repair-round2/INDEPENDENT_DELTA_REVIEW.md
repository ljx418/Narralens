# Independent MEDIA repair delta review

**NOT_PASS (bounded repair closure): 0 BLOCKER, 0 MAJOR, 1 MINOR remaining.** The reported M1, M2 and m1 triggers are repaired; m2's fifth-publication trigger is repaired, but the final exposure boundary still has an asynchronous cleanup gap.

Reviewed exact immutable commit `34118e71cf9582d20a715b441e3fe4ea8e98412f`, verified parent `16c0c401f34116264f3515eee8af039333c9124b`, comparing the preview implementation and tests against `05889e7f10e94538b0aff9ef121d3a120e52a985`. Public DTO relocation and assembly reexports were inspected for compatibility. Moving working-tree bytes are not this review's authority. The original NOT_PASS report is preserved unchanged. Prior proof-purpose and SQLite scopes were not restarted. No tests, renderer, Host, browser, build, or external provider was run; no source/index/branch was modified.

## Remaining finding

**MINOR — m2 remains open during cleanup before actual receipt delivery.** `src/host/render/preview-prepared-source.ts:527–545`, particularly `exposed=true` at 531 and the awaited `copy.dispose()` at 533.

The final signal/closed/proof checks occur before setting `exposed=true` and evaluating the return value. JavaScript still executes both asynchronous finally blocks before resolving that return: `copy.dispose()` awaits source/target descriptor closes (lines 272–275), followed by the object directory close and workspace removal. Cancellation, service close, or proof revocation during those awaits is never checked again. Because `exposed` is already true, failed/cancelled exposure cleanup also skips the five objects.

Reproducible source counterexample (not executed by this reviewer): use the existing filesystem fault seam to delay a copy source-directory handle's `close()` in disposal, after the fifth product and line 529's verifier call. While disposal is paused, abort the request or call `service.close()` without awaiting it inside the hook; then release the close barrier. The present `preview()` resolves with its receipt despite that cancellation preceding promise settlement, and all five objects remain. A variant releases/revokes the proof at that barrier; no further verifier call occurs. This is the same final-boundary obligation as m2, not a new product feature requirement.

Narrow fix: complete awaited staging/descriptor cleanup before the final current-object/proof/cancellation check and synchronous receipt handoff, while retaining the object directory authority and unpublished-object ownership until that handoff. Ensure all failure paths can still remove owned unpublished objects and close the directory. Add a deterministic cleanup-close barrier assertion for cancel/close (and a proof-revocation variant), requiring rejection and no retained unpublished objects. The current fifth-sync tests exercise an earlier point and cannot catch this gap. This minor does not negate the observed seven regression improvements, but prevents signing complete closure of all four findings.

## Repairs supported by source and causal tests

- **M1 original redirection trigger repaired:** publication uses `/proc/self/fd/<held directory>/<random leaf>` with exclusive/no-follow creation, not the old absolute directory name. Held/named identity and realpath are checked around publication and before the proposed handoff. Rejection cleanup uses the retained directory FD and only unlinks a regular file whose device/inode matches the recorded created object. The injected rename-to-held plus symlink-to-author at open asserts rejection, unchanged author-tree digest and empty held directory. This supports the tested substitution case; it is not a claim of atomic compare-and-unlink against every possible concurrent same-UID actor.
- **M2 original read races repaired:** initial hash completion and positional range reads now have held/named fingerprint checks after I/O, plus cancellation checks. Fingerprints include device/inode/size/mtimeNs/ctimeNs. The two real-filesystem barriers overwrite the same inode at equal length immediately before positional read and after hash EOF; both expect rejection and exactly one descriptor close. The hash case explicitly closes an unexpected success handle so the negative control itself does not leak it.
- **m1 short-write trigger repaired:** target copy uses read/write mode, loops until each input buffer is fully written, rejects invalid/zero progress, syncs and hashes the target FD to check both bytes and length against the prepared fact. Partial-write testing limits each write to seven bytes and verifies the copied film digest; zero-write testing proves rendering is never reached. Those two cases intentionally stop at a mocked renderer inspection and are not encoding acceptance evidence.
- **m2 fifth-sync trigger repaired:** publication checks cancellation/close after each object and checks proof/author/rights again after all five. The cancel/close hooks fire at the fifth sync, assert five attempted publications, rejection, and an empty object domain. These pass at the injected boundary, with the later cleanup gap described above.
- `contracts/prepared-preview.ts` relocates the existing DTO shapes and the unchanged 1 MiB read constant; `assembly-ports.ts` reexports compatible names. No wire fields, proof authority or new runtime service are introduced by this relocation.

## Retained evidence verification

The full-run input SHA256 values match the exact frozen implementation, test suite and shared fixture. Its retained log actually reports **11 passed**, comprising the original four plus seven causal cases; result metadata records exit 0. This is MAIN execution evidence, not a reviewer rerun.

The old-reader negative log was decompressed in memory only: gzip 115487 bytes / SHA256 `575c890c311a5e4f03f8c938f11920fee1040ba81cc277335462ff8746534ce2`; raw 714857 bytes / SHA256 `c97a3e63fda5b214ae7598e3725d7bf261fa5bb0257b68c3c9da3506e0f44817`. These match compression metadata and result provenance. Its two failures are unexpected successful read/handle exposure, not setup failures. The other negative log has five actual failures: directory redirection resolves, partial copy has the wrong digest, zero-copy reaches rendering, and cancel/close each resolve a receipt. Result provenance records old-implementation substitution and exact restoration; the fixed backup digest matches the reviewed implementation. Restoration is a retained execution claim, not something independently witnessed live.

Five new committed products under `docs/parallel/lane-media/A-R1-20261111/evidence/prepared-preview-real-1794410584408/` were read as Git blobs. Each byte length and SHA256 matches its receipt and observed manifest; recomputing canonical receipt content gives `84722cdf4d1df6b18e2bd05ea966692d530c008102b58585d320b2d7dd99eb8a`, matching the receipt. These are the retained synthetic three-second diagnostic products, not real-user Run admission, human voice, UI acceptance, or A/R1 closure. No media decoding was rerun. Cleanup metadata's PID observations are historical scoped evidence, not a global process absence claim.

## Exact SHA256 bindings

The fixture hash is input provenance only; prior fixture/proof/SQL reviews are not restarted here. All following hashes are of frozen Git blobs.

| File | SHA256 |
|---|---|
| `src/host/render/preview-prepared-source.ts` | `b50016728357c91bb748314297fa9e5e87fbfbf33b48caa7e799c3889032bafc` |
| `tests/agent-driven/media/preview-prepared-source.test.ts` | `739d4f0fc0e7e5362709761431ffd8cd95731f35182b8c29d9ce9e14623039c5` |
| `tests/agent-driven/integration/helpers/created-draft-fixture.ts` | `3e553993afcb4c9364227b86806fb64466e3ce595ed838433ee1cfcbb5b92ffb` |
| `src/contracts/prepared-preview.ts` | `7da67257dd016fa4aeff34ca418642467ec0a999b91d518eda0a507ebed8c6c0` |
| `src/host/render/assembly-ports.ts` | `6c0d0f18602d4fb7a0c334d51e2c5a0f0c21c7cab4ff4a980fbe77f8461eb596` |
| `docs/execution/A/implementation-20261111/integration/media-main-rework3/repair-round2/FIX_MAPPING.md` | `226f2e9d4577ffb4d552cb64f2b2291ed28c02231cb84a45ad501c1139496ab6` |
| `docs/execution/A/implementation-20261111/integration/media-main-rework3/repair-round2/SUMMARY.json` | `c935ab0e7799c3d34478f1cd03b63873c0f89f54face4382d35e2ac74d21205d` |
| `docs/execution/A/implementation-20261111/integration/media-main-rework3/repair-round2/other-old-negative.cmd.json` | `d612b529010aa412c7fb73e14128418e104a9a63500838de1df9a0f47f4235c3` |
| `docs/execution/A/implementation-20261111/integration/media-main-rework3/repair-round2/other-old-negative.result.json` | `a648a916d2b9141c08009c3f8e4c1044593cf51a24c66264839cdc6adbc69c94` |
| `docs/execution/A/implementation-20261111/integration/media-main-rework3/repair-round2/other-old-negative.txt` | `7450bc5985c8b4f7f4c6e011256f55daf16a33958807a9c5ba0c10ef70348535` |
| `docs/execution/A/implementation-20261111/integration/media-main-rework3/repair-round2/reader-old-negative-compression.json` | `724d3e1155ed4cc72d002b9a1c9c3ba156dba6a6bd02835612975350ff888f39` |
| `docs/execution/A/implementation-20261111/integration/media-main-rework3/repair-round2/reader-old-negative.result.json` | `29520505f53922ab9a954f303529bdd1305ba885c3bd3499f32ed3f10c03356e` |
| `docs/execution/A/implementation-20261111/integration/media-main-rework3/repair-round2/reader-old-negative.txt.gz` | `575c890c311a5e4f03f8c938f11920fee1040ba81cc277335462ff8746534ce2` |
| `docs/execution/A/implementation-20261111/integration/media-main-rework3/repair-round2/safety-full-run1.cmd.json` | `a368aad2a9779edec0c886d46306133613e373281d7befa16b28dd3f8e0c153b` |
| `docs/execution/A/implementation-20261111/integration/media-main-rework3/repair-round2/safety-full-run1.result.json` | `3a4642831a51ce0d6c8978fb64016d69dd38098e6e7ce0d22153c35824cca951` |
| `docs/execution/A/implementation-20261111/integration/media-main-rework3/repair-round2/safety-full-run1.txt` | `85cf72ac3def81b4c161d95764e01003a2a6be701d5bc29bc53ff3d221dcebae` |
| `docs/parallel/lane-media/A-R1-20261111/evidence/prepared-preview-real-1794410584408/narration.wav` | `42c9992dbd4dcfbeaf52790767beb0febee1279ce37e2e46d5cb474bdd8e1a1d` |
| `docs/parallel/lane-media/A-R1-20261111/evidence/prepared-preview-real-1794410584408/observed.json` | `b834f03a8a57d0c9781bf098a592eb7fe26261282ee71631de9732defc3432b0` |
| `docs/parallel/lane-media/A-R1-20261111/evidence/prepared-preview-real-1794410584408/preview.mp4` | `011bd960b4cc2d41b575af6e91a252ee6f96524e24a22f3a608603957378e1ec` |
| `docs/parallel/lane-media/A-R1-20261111/evidence/prepared-preview-real-1794410584408/receipt.json` | `89a76c37572d61db79be9c63544f03df3562dbcaf4dd7d7ea7ea81f1e7f62d50` |
| `docs/parallel/lane-media/A-R1-20261111/evidence/prepared-preview-real-1794410584408/rights-quality.json` | `4083e474b85669581ab2b1145904bbb6e38e96b260b399c334a8c473361878eb` |
| `docs/parallel/lane-media/A-R1-20261111/evidence/prepared-preview-real-1794410584408/shot-summary.json` | `74edc63e9c45f366c82945d4b501ab65bd487745a4caa96e38927dc032fae582` |
| `docs/parallel/lane-media/A-R1-20261111/evidence/prepared-preview-real-1794410584408/subtitles.vtt` | `7589688eff6e9ca5ee39341deb23d149f5a6cccec1da8ac9299fbb07230b88d9` |
