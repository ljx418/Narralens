# Next wiring draft rev2 targeted gap recheck

**DRAFT_GAP_REVIEW_NOT_FINAL_RELEASE_PASS**

Read-only targeted recheck of original findings NW-D01..NW-D07 and contradictions introduced by rev2. No implementation release, accepted014 commit, production evidence, Studio/A claim, or business PASS is established. No source, test, Host, media, browser, config, or network command was run.

## Original findings

|Finding|Rev2 disposition|Evidence / residual limit|
|---|---|---|
|NW-D01 event order|Addressed|01_CONTRACT.md:34 now commits `acceptMapping` pending/CAS and revokes live-loaded before async mapper, then finishes CAS and starts fresh Expected proof. It explicitly permits document/hydration proof from epoch before selection. Original S01-E02/E05/R01/D01 remain linked in 02.|
|NW-D02 producer prerequisite|Addressed in plan|02 separates W2 component evidence from W2+W3 production acceptance. 04 names preview → impact → immutable package/receipt and same-DB binding → media binding → trusted decision/approval → apply and recovery gate. This remains proposed; all required producer/runtime cases remain NOT_RUN.|
|NW-D03 paths and private ports|Addressed as proposal|04 inventories proposed existing/new source and test paths and owner, distinguishes mapper implementation from its existing port, and specifies bootstrap permit, Ack permit transaction/replay, Context lease/final assert/release. It correctly defers exact re-anchor to accepted014 signatures and final ReleaseAssignment.|
|NW-D04 lifecycle|Addressed as plan|05 gives startup and shutdown dependency tables, including S01 settle/reconcile, dedicated/generic recovery/reaper, public admission, pure final guards, accepted raw work drain, native/workspace ordering, and DB/FD9 last. 02 and 05 preserve the original recovery/crash cases.|
|NW-D05 rollback|Addressed|02:41 and 05 explicitly require affected created paths on incompatible binaries to be read-only/unavailable, preserve ledgers and receipts, and prohibit falling back to legacy selection0. Legacy behavior is separately retained.|
|NW-D06 cache/pool ownership|Addressed as proposal|05 maps native document/media/poster/probe/non-page/history/background-warm routes, parameter authority, witness issuance/revocation, unknown cache-hit behavior, shared pool, peer-browser ownership, and disposal. Actual signatures and route acceptance remain explicitly dependent on accepted014 and future implementation.|
|NW-D07 reference closure|Addressed|Manifest now has 12 hashed source inputs including Native DESIGN, MAIN decisions and 014 constraints; it states actual implementation cwd, canonical docs root, evidence root, and command partitions/seams. |

No new contradiction was found in the rev2 corrections. The proposed immutable review-publication payload schema is still correctly marked as requiring literal SQL, independent fingerprint review, and a future exact release binding; its presence does not silently authorize a migration. The exact 28 S01 appendix rows (IDs, level, steps, expected result, NOT_RUN) match the preserved rev1 appendix; no case has been dropped or promoted.

## Read-only verification performed

- Recomputed every manifest source-input hash (12) and each listed draft-file hash (6): all match; no mismatch.
- Compared the 28 S01 appendix rows with preserved rev1: exact match and all remain NOT_RUN.
- Read rev2 00–05 and manifest, the immutable rev1 review/history, and live MAIN service declarations used to check the proposed chain. In particular, `PreparedPreviewService.preview`, `FixedWorkflowService.publishReviewPackageInScope`, `CreatedPreparedSourceStore.bindPackage`, and the current `CreatedRunAuthority` setup are distinguishable as existing components versus proposed wiring; the draft does not claim this proposed production chain already exists.
- No tests or runtime/Host/media/browser commands executed; no source/index/current014 writer/draft files were modified.

## Disposition

The seven original document gaps are closed at the proposal level. This is not final release acceptance: accepted014 remains null, actual interface and ownership re-anchor remains open, the proposed private receipt DDL remains unreviewed, exact next-stage ReleaseAssignment remains absent, and all new cases remain NOT_RUN. Preserve those gates and the `DRAFT_GAP_REVIEW_NOT_FINAL_RELEASE_PASS` label.
