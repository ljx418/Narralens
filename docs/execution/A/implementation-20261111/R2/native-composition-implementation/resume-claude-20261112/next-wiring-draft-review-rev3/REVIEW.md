# Review publication schema proposal: read-only annex review

**DRAFT_GAP_REVIEW_NOT_FINAL_RELEASE_PASS**

Scope: static review of `06_REVIEW_PUBLICATION_SCHEMA_PROPOSAL.md` against actual MAIN source at `/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`. No source/test/index/config changes, SQLite execution, test, Host, media, browser or network activity occurred. The MAIN/Claude 014 writer was not touched.

## Findings

No blocking contradiction was found in the annex as a proposal. The exact SQL digest, table/marker separation, whole-transaction install/publication intent, immutable behavior and failure/reopen gates are internally consistent with the inspected source. The following details are design gates, not evidence of implementation:

|Area|Read-only result|Required before release / what remains unproven|
|---|---|---|
|DDL and digest|Extracted SQL block is 2,158 UTF-8 bytes including its final LF; SHA256 is `be75d5683a25861ab2cbe14d0a12c4bbde050a342288e2f254f577a2a6623e56`, matching the annex.|No DB executed; SQLite acceptance of all constraints remains NOT_RUN.|
|Namespace/marker|Two tables and four immutable triggers form the proposed six-object private namespace. The singleton key/check permits at most one marker; the specified verifier must require exactly one row and reject every partial/extra object. Names are separate from cp_a0, S01 and `created_prepared_source*`.|Implement an explicit, non-constructor installer and compare each `sqlite_schema` definition plus `table_xinfo`, FK, unique, STRICT/CHECK and trigger facts using frozen definitions. Tests must exercise marker missing/extra/tampered and partial/unknown objects. No such verifier exists in this annex/source.|
|Install atomicity and connection|`RevisionStore` opens one `DatabaseSync`, enables `foreign_keys=ON`, and its `atomic` method owns `BEGIN IMMEDIATE`/COMMIT/ROLLBACK. `ProductSqliteRepository` uses `revisions.compose` and its transaction delegates to that same store. `CreatedPreparedSourceStore` also composes the same connection; `bindPackage` is synchronous. The proposal correctly forbids nested BEGIN and requires installation to join the existing transaction when one is active.|Actual Host owner/constructor/bootstrap ordering and shared `RevisionStore` identity still need binding. Existing `CreatedPreparedSourceStore` constructor currently invokes `#schema()` and may create its own old schema; that behavior must not be mistaken for authorization to install the proposed publication schema. Process-kill/reopen behavior is NOT_RUN.|
|Receipt/canonical/five slots|`PreparedPreviewReceiptV1` has no package identity and its receipt digest covers canonical content; it includes the named source/plan/rights, run, job, execution and producer-attempt facts. `PreparedReviewMediaReaderImpl.open` recomputes the receipt digest and validates an individual part, but does not establish the entire five-slot set. The annex correctly assigns full receipt schema, exactly-once slot, cross-field and no-path checks to the new publisher/reader authority.|No actual strict whole-receipt validator is present in the inspected reader. New tests must prove each single-field/slot mutation fails and canonical JSON persistence is byte-stable. Do not treat current per-part reader checks as complete receipt validation.|
|Cross-table identity|The current prepared-source table has immutable execution/source facts; the binding table stores `prepared_source_id`, package id/version and receipt digest. Workflow package facts live in the ProductRepository collections. The annex requires resolving current run/package → binding → publication row and checking duplicated identities, digest and receipt against all relevant facts.|The new row has a direct FK only to prepared source; run/package/artifact/attempt consistency is therefore an application invariant and needs one same-connection transaction plus actual conflict tests. This is explicitly planned, not enforced by this DDL alone.|
|Replay/idempotency|Existing `publishReviewPackageInScope` is synchronous inside the caller's `ProductTransaction`; identical existing package digest returns stored package and changed content throws `REVIEW_STALE`. Existing `bindPackage` accepts exact binding replay and rejects a differing package/version/receipt digest. The proposed row identity plus fieldwise immutable replay rule is compatible with those behaviors.|End-to-end command-ledger replay must be shown to return stored results without re-rendering; same-prepared-source changed run/attempt/receipt must fail before any replacement. Not tested.|
|Error handling and media GET|`ReviewMediaHttp` gets binding and reader as required constructor dependencies, checks current binding around awaits and returns through existing route error handling. The annex keeps GET read-only and delays exact public error-code mapping to release.|No publication binding producer, error mapping implementation or stale-read race evidence was inspected as completed work. Required PUB-MD01/RD01 remain NOT_RUN.|
|Close/reopen|The annex says to stop new admission, drain publication/proof/media work and only then close the shared DB; it preserves real filesystem ownership for already-created objects if DB rollback occurs.|No process/crash/close behavior was executed. PUB-DB01/TX01/RC01 and the Host lifecycle cases remain NOT_RUN.|

The manifest still has `accepted_native_commit: null`, `implementation_release: false`, and `business_acceptance: NOT_RUN`. These are correctly preserved. The annex explicitly says not to convert its PUB cases into current N1/N2 acceptance.

## Bound inputs

All seven draft-document hashes (00–06) below match the current manifest; the manifest itself was also hashed for this review. The source hashes identify exactly the inspected MAIN files:

|Input|SHA256|
|---|---|
|Draft 00_READ_FIRST.md|`6074de454ec0a474cc71e1d43a97e8ebbb48befe7b0458f502eecaf49be1ccbe`|
|Draft 01_CONTRACT.md|`580f024a64afaa1e3939189c817038d13e705d128c53ab14bd6f48ab792fd813`|
|Draft 02_DEVELOPMENT_AND_ACCEPTANCE.md|`8d094d8b45f13baad44faf2390f23ef96bebd0eea5c7edc1d3fde4e26672dfd2`|
|Draft 03_CLAUDE_HANDOFF.md|`c8dedb0cf373ac3aa9c26f29bbdb66e6a8e822451eb9ad6c3e400f92bf513fc3`|
|Draft 04_PATHS_PORTS_AND_PRODUCERS.md|`f7c3b784701c4feef729caba24eb18f1c28f7bead3a42408f1c3ad9053954110`|
|Draft 05_LIFECYCLE_AND_NATIVE_CACHE_ROUTES.md|`b496d5e0b4f14febbad824fdc58c9578d4c5dd72dfcf544a995dbbe3a606c938`|
|Draft 06_REVIEW_PUBLICATION_SCHEMA_PROPOSAL.md|`474b62a0d6e558416b6178cd82a62a231d728aecfda3c37f40655b265d3f8043`|
|Draft manifest.json|`c7e0924bed082db7eba315d0e71ee51128c0f26bb0bc81ef6caa3643ce3bc6f7`|
|MAIN src/contracts/prepared-preview.ts|`7da67257dd016fa4aeff34ca418642467ec0a999b91d518eda0a507ebed8c6c0`|
|MAIN src/host/agent-driven/created-prepared-source-store.ts|`f234fc0d74bee887ad4c09ff711d52f7b22d44559a8302e2327b5674f86611d1`|
|MAIN src/host/agent-driven/review-media-http.ts|`6e9551c8e37ff29d225030efd84810d5f52b2400cc492823316829d72c4241e6`|
|MAIN src/host/render/preview-prepared-source.ts|`630d9222c33bcd44e01bd2dad46328e59c4db95dc90069af9b310be0d51fced0`|
|MAIN src/host/creative/fixed-workflow-service.ts|`e0a2718b1a98aa0fcaa5d2150dca0aa25614b655b2c89a9a3408abd7ecb86e7f`|
|MAIN src/host/agent-driven/product-sqlite-repository.ts|`d2233cae1669f42f3236cb793c7f4a2864bb9d2fc467be2bb56531cef09f9226`|
|MAIN src/host/projects/revision-store.ts|`b558839b76f8cad595b79efa66734e12de1058452efe55eecf8f9f6d0b1dec8e`|
|MAIN src/host/agent-driven/agent-schema-definition.ts|`581974592352a9fd6da2affa47afe722274581933d1cbbf569f6c94b18e6a46d`|
|MAIN src/host/creative/digest.ts|`0a67cb54d1e7b5edf22a26dc8d23eb411da856d872f1f00ca3a8027375214e3d`|

Disposition: gap review only. A full release still needs independent verification of the implemented schema/transaction behavior and exact frozen014 integration after accepted commit; this report grants neither implementation nor acceptance.
