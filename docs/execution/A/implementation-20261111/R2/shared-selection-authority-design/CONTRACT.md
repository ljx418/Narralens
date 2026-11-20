# S01 — persistent project selection authority (proposed private contract)

Design only, NOT_IMPLEMENTED / NOT_RUN. Source baseline is immutable MAIN `e2eff61b464d75d36598103d718cd2a75db5dfda`; no live N1N2 source was treated as frozen. MAIN_DECISIONS S-01 and S01_MAIN_REVIEW_CHECKPOINTS override earlier suggestions. MAIN owns eventual N3 release. Existing public Selection/Context/NativeAck DTOs, cp_a0 schema, nine-field commit and approval semantics remain byte-for-byte unchanged. This is one authority on the existing RevisionStore connection, not a selection service per consumer, new Ack table or durable UI restoration system. Hypit/migrated paths retain their legacy mode.

## 1. Exact storage and migration

New entity `src/host/agent-driven/created-native-selection-state.ts` exports frozen DDL constant and a Host factory only. Two private tables comprise ONE authority: immutable schema receipt and one mutable project row. No business status/approved/loaded field. Epoch is unsigned JS safe integer stored SQLite INTEGER; read `typeof` and Number.isSafeInteger, do not coerce corrupt strings/floats. Tokens are Host CSPRNG 32-byte lowercase hex, validated as such in code, never supplied by HTTP. binding_digest = canonicalDigest({project_id,owner,revision,control_revision,snapshot_id,source_digest}) from original DB and verified created origin, NOT from plan or browser. bootstrap_digest binds original verified bootstrap transaction+owner+initial snapshot/source; it remains immutable across later commits.

DDL bytes (UTF-8, LF, trailing LF) and receipt hash below are proposed v1 fingerprint. The receipt does not hash its own inserted value; fingerprint covers this DDL string, not DML. This static design has NOT been executed in SQLite.

```sql
CREATE TABLE created_native_selection_schema (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 version INTEGER NOT NULL CHECK(version=1),
 ddl_sha256 TEXT NOT NULL CHECK(length(ddl_sha256)=64)
);
CREATE TRIGGER created_native_selection_schema_no_update BEFORE UPDATE ON created_native_selection_schema BEGIN SELECT RAISE(ABORT,'SELECTION_SCHEMA_IMMUTABLE'); END;
CREATE TRIGGER created_native_selection_schema_no_delete BEFORE DELETE ON created_native_selection_schema BEGIN SELECT RAISE(ABORT,'SELECTION_SCHEMA_IMMUTABLE'); END;
CREATE TABLE created_native_selection_state (
 project_id TEXT PRIMARY KEY NOT NULL,
 bootstrap_transaction_id TEXT NOT NULL REFERENCES project_transaction(transaction_id),
 bootstrap_digest TEXT NOT NULL CHECK(length(bootstrap_digest)=64),
 epoch INTEGER NOT NULL CHECK(typeof(epoch)='integer' AND epoch BETWEEN 0 AND 9007199254740991),
 cas_token TEXT NOT NULL CHECK(length(cas_token)=64),
 binding_digest TEXT NOT NULL CHECK(length(binding_digest)=64),
 session_token TEXT,
 mapping_digest TEXT,
 pending_token TEXT,
 reason TEXT NOT NULL CHECK(reason IN ('bootstrap','session_open','session_close','baseline_changed','view_invalidated','mapping_changed','mapping_same','mapping_unavailable','mapping_accepted','restart_unfinished','shutdown_unfinished')),
 CHECK(session_token IS NULL OR length(session_token)=64),
 CHECK(mapping_digest IS NULL OR length(mapping_digest)=64),
 CHECK(pending_token IS NULL OR (length(pending_token)=64 AND session_token IS NOT NULL))
);
CREATE TRIGGER created_native_selection_state_no_delete BEFORE DELETE ON created_native_selection_state BEGIN SELECT RAISE(ABORT,'SELECTION_STATE_NO_DELETE'); END;
CREATE TRIGGER created_native_selection_state_guard BEFORE UPDATE ON created_native_selection_state
WHEN NEW.project_id<>OLD.project_id OR NEW.bootstrap_transaction_id<>OLD.bootstrap_transaction_id OR NEW.bootstrap_digest<>OLD.bootstrap_digest
 OR NEW.epoch<OLD.epoch OR NEW.epoch>OLD.epoch+1 OR NEW.cas_token=OLD.cas_token
BEGIN SELECT RAISE(ABORT,'SELECTION_STATE_CAS_SHAPE'); END;
```

DDL SHA256: `6c9804ca36e226cb28674eff742c1eb433f6c650fe7148bacb603a902f8ab896`.

Migration runs explicitly in owned Host startup before observation/recovery admission, not lazily in a constructor/consumer. The independent marker is the EXISTING same-DB `schema_migration` table, ensured by original job-kind-migration.ts:121–126 during RevisionStore open. S01 never creates/rebuilds that table, edits its DDL, uses another connection, sets user_version, or edits another receipt. Validate the original six-column table definition and successful original store-open prerequisite; absence/unreadable/malformed migration table is a storage/schema failure, not first install. The S01 implementation owns exactly one INSERT row:

```sql
INSERT INTO schema_migration
 (id,from_version,to_version,applied_at,backup_path,detail)
 VALUES ('created_native_selection_v1',0,1,?,'',?);
```

`applied_at` is the actual Host UTC ISO timestamp for this transaction, valid round-trippable `Date.toISOString()`; it is immutable history, never refreshed on reopen. `backup_path=''` is exact because this additive schema-only migration neither rebuilds old tables nor claims a backup was made. Canonical `detail` is EXACT UTF-8 JSON below, no whitespace/trailing LF. Reopen checks exact string bytes as well as parsed fields (same `canonicalJson` key ordering); no extra keys/coercion:

```json
{"ddl_sha256":"6c9804ca36e226cb28674eff742c1eb433f6c650fe7148bacb603a902f8ab896","format":"narralens.created-native-selection-migration@1","namespace":"created_native_selection_","version":1}
```

Canonical detail SHA256 (DML validation constant, separate from unchanged DDL fingerprint): `ee34688afab9e316c24fc3a93e3d66e7aa43db5dd167257ab777ed1edf81f483`. DDL remains v1 and unchanged; independent receipt data is not a new business table nor part of the `created_native_selection_*` sqlite_schema namespace. Require numeric integer from_version=0/to_version=1, exact id, backup_path and detail, valid applied_at. Query all migration IDs with exact prefix using `substr(id,1,length(?))=?` and prefix `created_native_selection_` (avoid SQL LIKE underscore wildcard). This v1 recognizes only `created_native_selection_v1`; a higher-version/unknown sibling ID rejects as UNSUPPORTED_SELECTION_MIGRATION, never falls through absent.

Within ONE original `RevisionStore.atomic` BEGIN IMMEDIATE, read both marker and complete sqlite_schema namespace afresh and apply these four quadrants:

|External marker|Private namespace|Decision|
|---|---|---|
|absent|wholly absent|First schema installation eligible ONLY after original DB open/owned FD9, valid schema_migration and no unknown selection migration ID; execute frozen DDL, insert private singleton receipt, insert external marker, reverify both, then COMMIT|
|present exact v1|complete exact v1|Verify every definition/trigger/index, singleton receipt and external marker; validate project rows, then normal startup; no writes to receipts|
|present|absent or partial/mismatched|SCHEMA_MISMATCH; preserve evidence, no re-create or repair, even when private receipt was also dropped|
|absent|any existing namespace object|UNVERIFIED_SELECTION_SCHEMA; do not backfill marker or adopt apparently matching definitions|

Malformed marker has priority over quadrant handling: fail, not absent. Namespace means ALL objects with literal prefix `created_native_selection_`; use existing exact `matchesFrozenSchemaNamespace` against the shipped DDL, not just table names or database self-reported hash. The private receipt must contain exactly singleton1/version1/compiled DDL digest; empty receipt table is partial/mismatch. Recheck schema_version, external marker and private receipt at startup and each authority operation (only schema-definition parsing may cache while schema_version is unchanged; marker DML is freshly read because it does not change schema_version). Structural schema failure is authority-wide; malformed per-project row remains project-local where the global schema is valid.

The first quadrant is the concrete first-install condition WITHIN the existing owned-DB trust boundary: there is no committed S01 marker and no S01 namespace. Migration COMMIT makes both exist atomically; crashes before COMMIT leave neither. Dropping only the entire private namespace leaves independent marker and is detected. Deleting only marker leaves namespace and is detected. An attacker/operator deleting both marker and namespace, or restoring a complete older DB including schema_migration, defeats this local provenance; this is explicitly outside the cryptographic/anti-rollback guarantee. No unspecified external deployment receipt is assumed. Historical project rows are NOT initialized by first schema install and retain the stricter bootstrap/upgrade policy below.

Any failure between DDL, private receipt INSERT, external marker INSERT, final verification and COMMIT rolls back all this migration's effects; no `INSERT OR IGNORE`, `REPLACE`, autocommit DDL or independent receipt transaction. Concurrent accidental init on the same authorized connection is rejected/reused only after actual transaction completion; a second writer is not admitted. Preserve original job-kind and all other migration rows byte-for-byte. Version upgrade requires separate reviewed forward migration; v1 does not repair unknown versions. EIO/BUSY/read failure is not absence. No SQL has been executed in this design task.

Create schema != initialize projects. Fresh project row0 is inserted ONLY inside the original verified bootstrap commit transaction, after original bootstrap source/origin/owner facts have been established and before transaction COMMIT. An opaque BootstrapInitPermit minted by original bootstrap implementation binds same connection, project, exact original bootstrap transaction and verified facts; initializer re-reads those facts and requires no OTHER nonterminal project transaction, no unresolved original edit/import journal, and no prior applicable prepared/adoption/selection/Ack authority. The just-committing bootstrap transaction is the sole exact exception, not an arbitrary ignore list. No client call can mint permit. Insert epoch0, fresh cas token, binding digest, null session/mapping/pending, reason bootstrap. Same initializer permit is single-use; committed bootstrap replay returns the original receipt without invoking initialization (exact hook rules below); disagreement refuses, never REPLACE. Rollback of bootstrap rolls back epoch0 too. Entire schema creation is forbidden inside a commit proof scope.

Existing rows reopen unchanged after full validation; their bound original bootstrap fact must still exist and match. Missing row when schema receipt already exists is MISSING_LEDGER, not automatic INSERT0. Old projects at first upgrade are likewise not silently initialized merely because a table was absent: first-zero proof is required, not absence of a current session or a lack of conveniently queried rows. See migration backlog policy below. Fresh newly verified bootstrap has no such backlog.

### Exact bootstrap mint, insertion and replay hook (e2eff61 lines238–309)

ProjectCreationStore.commit already enters `#repository.transaction` at248; the already-committed reservation branch254–257 returns the original result before the new initialization path. Keep that replay branch read-only: it MUST NOT mint a permit or INSERT a missing row. If ledger is missing/corrupt, preserve the already-true bootstrap receipt and record/propagate selection-unavailable through the separate authority/Context gate, not rewrite the committed reservation or pretend initialization succeeded. Replaying a receipt does not certify authority readiness.

For the genuinely new staging→committed path, retain all original checks at259–268 (principal/confirmation, job lease owner+attempt+expiry, exact transaction/source proof, no competing gate and absence of prior active binding). Original state/binding/snapshot/transaction/pointer/source_fact writes271–284 and project_origin285 establish the facts inside that SAME transaction. Proposed insertion point is immediately AFTER existing `fault('origin')`286 and BEFORE brief/artifact writes287 onward. Do not move or weaken final schema/proof/lease/confirmation checks302–307; failure of any of these rolls epoch0 back with every original DB write.

Add a constructor-only initialization binding to the real ProjectCreationStore, installed once by MAIN composition before it accepts bootstrap work. The binding is not a public `commit(input)` field: input's caller may not supply a hook, permit or epoch. The store owns a module-private active-scope object created on entry into the original transaction and invalidated in a `finally` on return/throw. At the insertion point the store mints ONE opaque BootstrapInitPermit registered with the bound authority (WeakMap): exact RevisionStore/DatabaseSync identity, active scope nonce, command/project/transaction/principal, snapshot/source/fact digest and original verified proof reference. No exported mint accepting arbitrary IDs or raw DB; wiring capability stays in private trusted composition. Initializer requires scope still active AND db.isTransaction, checks same original rows written earlier, project origin's creation_transaction_id, original snapshot/source fact and owner, and reuses original verifier/assertCurrent before issuing epoch0. It independently confirms no other applicable pending/old capability history; the bootstrap transaction is already locally committed at279 but not durably committed, and only that exact transaction may be excepted from preexisting-history checks. No nested transaction or schema migration here.

Permit is single-consumption per callback; mark consumed before attempting initialization and close scope on failure. If outer transaction rolls back, the permit stays dead and a new legitimate bootstrap attempt gets a new scope/permit. A second invocation in one scope is an explicit misuse rejection, not token replay. A repeated whole bootstrap call after successful COMMIT takes existing read-only receipt path; it never supplements missing ledger. An already-existing row encountered on the genuine new-bootstrap path is a conflict unless it can be proved to be the exact row already inserted by this still-active scope; given single-use callback, ordinary implementation should reject it, not use general upsert. This tightens the earlier generic initializer-retry sentence: persisted committed replay is handled by original reservation branch, not initializer repair.

Proposed internal fault points `selection_before_initialize` and `selection_after_initialize` join the original CreationCommitBoundary union only (private TypeScript/test seam, no wire/DDL change). Test each before/after hook and each existing later boundary brief/command/job/outbox plus final proof/expiry/confirmation failure; all bootstrap rows and epoch0 are atomic. Child termination before/after actual outer COMMIT separately proves crash semantics; fault throws prove rollback only. Physical published snapshot files may preexist the DB commit under original bootstrap policy; test preserves those original artifacts rather than claiming SQLite rollback erases files. No RevisionStore nine-field created-source-adoption commit edit is needed.

## 2. Two faces; pending mapping is not unknown authority

Proposed private API (types/brands are NEW, not existing source):

```ts
interface EpochRead { readonly projectId:string; readonly epoch:number; readonly casToken:string; }
interface CreatedSelectionBusinessPort { currentSelectionVersion(projectId:string):number; }
interface CreatedSelectionEpochPort { readEpoch(projectId:string):EpochRead; }
// Opaque objects registered in module-private WeakMaps; not structural DTOs.
interface SelectionOwner {} // exactly one Host/Observation owner per original RevisionStore
interface SessionPermit {} // project + live session/workspace + runtime incarnation
interface MappingPermit {} // accepted sequence + profile + row CAS token + owner
interface BootstrapInitPermit {}
interface SelectionWriteScope {} // internal synchronous same-connection scope
interface CreatedNativeSelectionOwner {
 initializeBootstrap(permit:BootstrapInitPermit, scope:SelectionWriteScope):EpochRead;
 reconcileBaseline(projectId:string, scope?:SelectionWriteScope):EpochRead;
 openSession(binding:VerifiedSessionBinding):SessionPermit;
 acceptMapping(session:SessionPermit, sequence:number, profile:ProfileStamp):MappingPermit;
 finishMapping(event:MappingPermit, result:VerifiedMapping|null):EpochRead;
 invalidate(session:SessionPermit, cause:InvalidationCause, identity:InvalidationStamp):EpochRead;
 closeSession(session:SessionPermit):void;
 settleInterruptedObservations():ReadonlyArray<ProjectSelectionDiagnostic>;
 stopAdmission():void;
 drain():Promise<void>;
 close():Promise<void>;
}
```

Factory hands only business read face to FactsReader/normal adoption/Publisher/Recovery, epoch read face to Observation/Expected binding builder, and owner face to original trusted Host lifecycle + Observation. No HTTP epoch/root/force, public writer, raw DatabaseSync argument or callback to bypass guards. Revisions association checked by identity. Mapping digest and immutable verified result come from real N1N2 mapping plus revalidated committed binding, not arbitrary structural browser output.

`readEpoch` validates row/schema/bootstrap and returns actual persistent integer even if mapping is null or pending_token non-null. It never returns live selection/Ack. The business `currentSelectionVersion` is a pure synchronous fence: it checks binding against actual original DB facts, then reads SAME row and throws ProductError CAPABILITY_UNAVAILABLE with internal reason SELECTION_MAPPING_PENDING if pending_token is non-null. A known epoch with no mapped selection and NO in-flight mapping is readable by BOTH faces: bootstrap/no-session/new-session/doc-await state is not a commit barrier by itself. This explicitly avoids Expected→mapping→version bootstrap deadlock. Consumer exceptions never become version0; missing/corrupt/I/O/closed authority is unavailable with distinct internal diagnostic. Known-but-pending is retryable deferral, not authority revoked and not permission to compensate merely from a 503.

Context created mode MUST use epoch authority even without a live native session; remove created-mode `native ?? version0` fallback at project-context-service:35. Return current_selection=null, native_sync unknown/pending and no live Ack when epoch is valid but mapping unproved; if authority unavailable, return existing CAPABILITY_UNAVAILABLE error (DTO has no unknown numeric sentinel). Legacy fallback stays legacy-only. Context final fence compares epoch+CAS/live binding after async reads. Expected can construct binding/proof from readable epoch; Ack final transaction still requires mapped selection/current profile, no pending token and matching epoch+CAS. Numeric epoch availability is never loaded proof.

## 3. CAS, asynchronous events and linearization

Every mutation is synchronous within original DB atomic scope or joins a verified original active synchronous transaction; no await while holding transaction, no new SQLite connection. UPDATE ... WHERE project_id=? AND epoch=? AND cas_token=?; require changes=1. Token changes on EVERY update, including same-epoch pending transitions, preventing CAS ABA without increment/decrement tricks. Triggers only enforce shape; code still verifies opaque owner, allowed reason, old/new binding, project origin and exact event liveness. CAS failure rejects stale event, never retries against a new unrelated session. DB busy/I/O preserves previous committed row and fences local project; diagnose uncertain COMMIT by fresh same-owner read, never blindly duplicate a bump. A successful COMMIT followed by process death is recovered from row, not retried by wall clock.

Event sequence is original per-session ingress anti-replay, distinct from project epoch; do not put native sequence into Selection.selection_version. Wrong session/project/sequence is rejected before DB mutation. Profile stamp binds runtime incarnation, bridge session, registered workspace identity, view ID/document epoch/hydration epoch and current commit/control. Host records highest accepted sequence before awaiting mapper. Newer document/hydration/selection event invalidates old permits; late callback cannot overwrite. Cross-project maps/queues never share epoch.

1. New actual session/workspace: in one CAS increment epoch, new session_token, clear mapping/pending; revoke old live selection/Ack synchronously. Duplicate delivery of the exact same issued active session binding is a no-op; reopening after close or new workspace is new token/increment even if native/session textual ID repeats. Reopen never compares against old lastMapping digest to suppress first mapping.
2. Valid authenticated selection event: persist pending_token=fresh event token and new cas token, SAME epoch; retain prior mapping_digest only for dedup in same current profile/session. Revoke live Ack/selection immediately. Only AFTER commit of accepted pending row invoke async real mapper. This pending marker is durable; a crash cannot erase an accepted potentially changed selection. A newer selection replaces pending via CAS (same epoch) and invalidates previous permit. Document/hydration supersession cancels accepted mapping by a real invalidation transition, not by clearing marker and restoring old mapping.
3. Mapper returns: synchronous final scope verifies token, latest session sequence/profile/current owner and DB binding. If same canonical effective mapping AND same active session/profile binding as before pending, clear pending and keep epoch unchanged (fresh CAS token); restore live mapping only after commit. Different mapping, first mapped result after session/invalidation, or definite unmappable result increments epoch ONCE and clears pending; unmappable clears mapping and returns no selection/Ack. A→B→A increments twice. Do not increment on admission then decrement on duplicate.
4. Mapper I/O/unknown failure: do not pretend unmappable. Finish accepted event with conservative lifecycle invalidation (epoch+1, clear mapping/pending) ONLY if owner/current row can be verified; reason mapping_unavailable distinguishes unknown result from known selected content. If DB write cannot be proven, keep durable pending barrier and local unavailable; no fallback old mapping. New session or explicit later accepted observation may reconcile once when storage works.
5. Cross-interface ordering: old valid apply can finish BEFORE pending acceptance linearizes; after pending commit, all business currentSelectionVersion calls refuse until finish/invalidate. Publisher already rechecks selection in synchronous assertCurrentForCommit called by original nine-field commit; this final read sees the pending marker even when epoch is numerically unchanged. No need to change nine-field shape or original commit predicate. FactsReader captures/preflight/final reads and recovery use same face. No transient/pending error may be interpreted as selection_changed and used to abort. A source-changing operation cannot interleave between synchronous final check and commit in the owned same-connection model; multi-Host writers remain unsupported and refused by original FD9.
6. Document/profile invalidation: authenticated dirty/replaced/new view/new document epoch, changed committed baseline/control or lost workspace clears mapping/pending and increments once for the actual transition. Repeated identical invalidation identity is a no-op while already invalid; keep an in-memory issued invalidation receipt keyed by active permit/profile (not caller reason text), no late replay across restart. Hydration progress for same document does NOT increment epoch by itself; it revokes loaded until four parts proved. If it supersedes a pending selection mapper, consume that pending event as one invalidation, then accept fresh mapping. Never await a mapped selection to begin document/hydration Expected proof.

## 4. Original commit/control changes and final fences

Ledger binding_digest is last reconciled original DB baseline. Host-owned reconcileBaseline compares actual created owner/commit/control against it, before any issued session, Expected/context snapshot or business read. Exact match is no-op. Changed baseline increments once, clears session/mapping/pending and updates binding; missing/invalid original origin/commit is unavailable, not new baseline. Reconciliation is an explicit trusted Host lifecycle action before public admission/Context or Expected round construction, using its own original atomic scope or a verified bootstrap scope; it MUST NOT mutate during publication final proof or inside the existing created-source commit scope. Business and epoch readers are pure synchronous fences: if actual baseline differs, return BASELINE_RECONCILIATION_REQUIRED/unavailable until the Host reconciles it, never lazily mutate in a commit guard. MAIN composition invokes reconcile before each new created prepare/apply/native/context operation and after original commit/control lifecycle notifications; final reads only compare. No nested BEGIN or ProductSqliteRepository bypass of the closed scope. A prior plan cannot pass because source/control also checks original DB; rebind does not grant approval. Post-successful commit baseline reconciliation may happen on next read; successful business receipt must not be rolled back merely because that later reconciliation fails. Return genuine committed receipt, subsequent selection unavailable.

Ack needs N3's opaque permit rechecked INSIDE original NativeAckStore.record transaction (currently baseline lines83–105 lacks this fence), compare fresh epoch, casToken, no pending token, original DB state, session/profile and proof before cp_a0 append. Do not add epoch column to cp_a0; persisted Ack stays historical, live association is privately held and revalidated on read. Context async final fence uses same private snapshot. Repeated same mapping can keep numeric version but invalidates old round CAS permit; recreate final proof/fence rather than trusting an old pending-era Ack.

## 5. Restart, close and lifecycle matrix

|Transition|Persistent effect|Live effect / business behavior|
|---|---|---|
|Fresh verified bootstrap|atomic row0|no session/map/Ack, actual0 allowed|
|UI/native session close while Host continues|epoch+1 once, clear mapping/session/pending|old plans stale; duplicate close no-op|
|New session/workspace|epoch+1 once; new token|first mapping cannot dedup with prior session|
|Changed real mapping / definite unmappable|epoch+1|mapped or null honestly; pending removed|
|Duplicate same effective mapping in same profile|epoch unchanged; CAS token changes for pending completion|no integer ABA; final proof round revalidated|
|Document/view/commit/control invalidation|epoch+1 per real transition|null selection and no live loaded; version readable|
|Ordinary hydration pending with no in-flight map|no epoch mutation|Expected still starts, no Ack until proof|
|Graceful Host shutdown|no blanket epoch bump solely for service shutdown|stop new ingress, retain epoch for accepted recovery; revoke live loaded|
|SIGKILL/reboot with no pending map|no unconditional bump; read existing validated epoch|never restore session/map/Ack from row; old mapping_digest is only history, not live state|
|Restart with durable pending_token|atomic epoch+1, clear session/mapping/pending, reason restart_unfinished|one-time conservative invalidation, not fake user mapping; next boot no further bump|

At startup, after original FD9 and schema validation, settleInterruptedObservations scans actual pending rows and performs one CAS per project with known owner/baseline; no session needed, no media, no infinite retry. If baseline changed simultaneously, combine baseline change and lost pending into ONE transition with restart_unfinished and new binding. Missing/corrupt project facts quarantine only that project in authority diagnostics; do not falsely clear pending. Storage-global failure remains instance failure. If schema exists but row's mapping_digest/session_token survives a clean/crashed process, do NOT issue a live permit for it: only actual new session can do that and increments epoch.

Graceful close sequence: Host closes public admission and freezes new native events, revokes live Ack and marks native bindings not publicly usable, but retains dependency/read capability for already admitted recovery. Await full accepted recovery scan, normal apply and accepted mapper/proof rounds; admitted mapper may persist its selection result if its private close-drain permit still current, but must not publish loaded after close. Their CAS changes can legitimately make accepted write stale under original final checks; do not force success. Unfinished canceled mapper settles once as shutdown_unfinished invalidation, with honest reason, before authority drain. Close-driven gateway sessionClosed notifications use reason host_shutdown and do not separately increment all projects; ordinary user/UI close does increment. After consumers fully quiesce, authority.close marks closed and read faces refuse; tasks/assets/DB release afterward per MAIN owner. On failed drain do not close dependencies under active commands. SIGKILL never claims finally/drain ran.

## 6. Legacy upgrade and honest reconciliation

No ledger + historical created pending: mark internal project diagnostic SELECTION_LEDGER_MISSING, capture original transactions/journals/identities/authority and retain gate. Do not initialize from plan.selection_version, local session counter, latest Ack or max observed plan values. Early unpublished work may still follow original D10 independently proven source/base/owner safe-abort path if it does not need selection; malformed request follows original attention before any path access. Published state with no ledger cannot prove current selection: no automatic commit or authorization-based rollback; preserve and require reconciliation. Unknown authority is NOT evidence that approval was revoked.

A complete verified backup of the original private ledger from the SAME runtime/DB lineage may be restored only as audited whole-state recovery with source/DB consistency and ownership proof, not selecting a convenient epoch. Otherwise, stop just that project's automated adoption; expose concrete missing-ledger diagnostic and retained paths/transaction IDs through existing diagnostics, not a false ready status. MAIN must give an explicit audited resource-resolution ticket to decide original published author ownership and terminalize pending using original recovery/compensation rules. Where physical ownership or user intent cannot be proven, true human high-risk choice is required. No raw SQL terminalization or silent epoch reset is part of S01.

After all historical pending and old usable approvals/prepared authorizations are safely resolved, first initialization may occur ONLY if verified bootstrap plus demonstrable first-use conditions can still be proved. For historical projects with prior native selection/use but irrecoverable ledger lineage, this v1 cannot safely invent a counter: preserve old project as read-only/reconciliation-required and use an explicit authorized new-project/bootstrap lineage for future editing, retaining old artifacts. A future in-place ledger rebaseline needs its own reviewed contract invalidating all old capabilities; it is not a hidden v1 fallback. This is a concrete bounded upgrade limitation, not permanent deferred labeled RD05 success. Normal new projects initialize atomically and are unaffected. Missing table on a DB already known to have used S01 is corruption, not first migration; the independent schema_migration marker and four-quadrant algorithm above decide schema installation within the owned-DB trust boundary; simultaneous whole-DB rollback is not detected or promised.

## 7. Failures and limits

SCHEMA_MISMATCH, LEDGER_MISSING/CORRUPT, OWNER_UNPROVEN, DATABASE_IO, CLOSED, EPOCH_EXHAUSTED and MAPPING_PENDING stay distinct internal reasons under existing public error mapping. None becomes zero. At MAX_SAFE_INTEGER, reads of validated stable row remain valid, but any required bump refuses before change and revokes live validity; no wrap, saturation pretending transition, decimal-string public version or project-global reset. Pending same-epoch transitions must not admit new event if worst-case completion cannot increment. Only already-established duplicate/no-op reads may proceed at max.

Table constraints do not protect against a hostile SQL writer replacing all schema/data; same owned runtime/DB access is a prerequisite, not a new cryptographic ledger claim. SQL NULL/type coercion and bad tokens must be rejected by strict code validators too. No tests/DDL/migration/Host/SIGKILL were run for this design. Static syntax/fingerprint generation is not execution evidence. Source hashes and exact release/cases follow in ACCEPTANCE_AND_RELEASE.json.
