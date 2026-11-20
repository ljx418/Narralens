# Independent frozen review A — REQUEST_CHANGES

Candidate: `1d348d419120f23f45d958112ea8c43df5a04675`; parent: `e2eff61b464d75d36598103d718cd2a75db5dfda`; cached origin/main: `304c89134fdf9f834f7d69e3f4d5c89a68044c60`.

Read-only repository: `/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`, branch `agent-driven/main-a-integration`. Fixed upstream: `/mnt/c/workspace/videoworkline/Narralens-openfilm-m1b/vendor/openfilm`, `e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3`. This reviewer did not implement this candidate, edit its source, run business code, or participate in its repair. Only the specified review-a output directory was written. No push, merge, checkout, index change, reset, stash, new worktree, network access, user-configuration/credential/environment read, or artifact rebuild was performed.

This decision concerns N1N2 source-reader/capability/cache/lifetime components. It is not A-round, NativeAck, Studio-ready or V1 acceptance. MAIN must close the major findings through the authorized implementation writer, retain this candidate/evidence, freeze a new SHA and obtain affected verification and independent review. NEXT remains pending after N1N2 acceptance. Two actual Chinese voiced60–180second A films remain NOT_RUN; diagnostic media cannot replace them.

## Findings and actual reachability

### A057-01 — MAJOR: Malformed public request escapes the folder serving callback

Locations: `src/adapters/openfilm/openfilm-upstream.ts:654`, `src/adapters/openfilm/openfilm-upstream.ts:943`.

Call path: produceNativeCacheEntry -> servingFor -> createPinnedOpenFilmServingOwner -> loopback createServer -> folder.handle. Once this component listener exists, raw HTTP request targets are public input; no Host-private hook or caller-supplied capability is needed.

Trigger: Send raw request target //[ with the correct 127.0.0.1:<port> Host header. It contains no colon, backslash, NUL or dot component, so guards 641-653 admit it. new URL(url, base) treats // as an authority reference and throws for an unterminated IPv6 host.

Contract failure: The request must be refused within the serving boundary. The URL constructor is outside a catch, and the createServer callback at943-962 also has none; this synchronous exception escapes the HTTP handler. No uncaughtException handler was found in frozen src/tools, so the default Node outcome is process termination. This is a reachable public input defect, not a claim that the listener is already wired into the next Host stage.

Minimal correction: Parse only a validated origin-form target, or catch URL parsing and return a bounded 400 response. Ensure every public parsing branch stays inside an HTTP error boundary.

Required counterexample: In an isolated child process start the real pinned serving, send //[ over raw HTTP, assert 400 plus child liveness and a subsequent valid asset response; prove all listener/probe resources settle. Do not rely on fetch, which may normalize/reject the target before it reaches the server.

Evidence limit: Static reachable counterexample; no runtime reproduction executed.

### A057-02 — MAJOR: Text budget is checked after the initial full-file hashing read

Locations: `src/host/agent-driven/retained-native-closure.ts:679`, `src/host/agent-driven/retained-native-closure.ts:685`, `src/host/agent-driven/retained-native-closure.ts:772`, `src/host/agent-driven/committed-snapshot-authority.ts:453`, `tests/agent-driven/integration/created-native-source-reader.test.ts:989`.

Call path: acquireNativeFacts -> #streamDigest.read -> retainFile -> #hash, then readText. The workspace reader also retains every leaf at711-724 before classifying text/cache files.

Trigger: The existing F06 case itself overwrites committed film.html with 9 MiB, above the 8 MiB text limit. retainFile accepts its current stat size and hashes all 9 MiB before readText rejects. A much larger corrupted referenced text has the same path.

Contract failure: R07 requires size checks before text reads and explicit total-byte bounds. F06 asserts onReadChunk observed zero bytes, but that observation exists only at #readAll1018, while #hash reads via readSync1000 without notifying it. Thus the test proves zero decoded-text reads, not zero pre-budget file reads; the advertised preflight does not bound actual input work.

Minimal correction: Introduce an explicit bounded-text retention path or preflight classification that checks per-file and aggregate text limits before any hashing/read of that text; keep large media on a separate bounded streaming path. Instrument all underlying reads used by the assertion.

Required counterexample: Run actual authority and actual workspace reader with an oversized known text and a cumulative-text overflow; count reads including initial digest/verification reads, assert refusal before any bytes of the rejected text are read, and check all descriptors are released. The old frozen implementation must fail the corrected assertion.

Evidence limit: Direct source contradiction and inspection of the complete F06 assertions; no runtime executed.

### A057-03 — MAJOR: Normal retain/hash/verify use EOF loops instead of the captured media size

Locations: `src/host/agent-driven/retained-native-closure.ts:994`, `src/host/agent-driven/retained-native-closure.ts:1094`, `src/host/agent-driven/retained-native-closure.ts:805`, `src/host/agent-driven/retained-native-closure.ts:824`, `src/host/agent-driven/retained-native-closure.ts:1066`.

Call path: retainFile uses #hash; authority #streamDigest hashes media again with hashFile; delivered handle.verify uses verifyFile -> #hashSync; whole closure.verify also uses #hashSync. These are normal production component paths, not the Host-private fault hooks.

Trigger: A separate writer grows an already opened regular file after the identity/size stat and while its descriptor is being hashed. The streaming buffer is bounded but the loop keeps reading until current EOF, with no captured-size byte counter, extra-byte refusal, time bound or cancellation yield.

Contract failure: The requested growth bound is missing on these paths. A sufficiently sustained writer can extend the work arbitrarily, and the synchronous loop blocks the event loop so reader.close and child timers cannot run. verifyFileExact already uses #hashBoundedSync at863, but that helper does not protect the ordinary retain/hash/verify paths. Existing P07 grows the file before readText, rather than during hashing, so it does not cover this window.

Minimal correction: Use the captured stat size as the limit for every hash, refuse early EOF and a single extra byte, and recheck exact identity after hashing. Apply the same bounded primitive to hashFile, verifyFile and whole verify, preserving streaming media memory behavior.

Required counterexample: Use an external process/barrier to append during initial retainFile, hashFile, verifyFile and verify; assert work stops at captured-size plus a bounded growth probe, refuses rather than truncates, and shutdown/cleanup completes. Exercise the normal methods, not only verifyFileExact.

Evidence limit: Static control-flow review; concurrent growth reproduction remains NOT_RUN.

### A057-04 — MAJOR: Rejected pinned page-frame promise does not prove the page/browser work settled

Locations: `src/adapters/openfilm/openfilm-upstream.ts:402`, `src/adapters/openfilm/openfilm-upstream.ts:412`, `src/adapters/openfilm/openfilm-upstream.ts:1109`, `src/host/agent-driven/created-native-workspace.ts:815`.

Pinned upstream: `packages/openfilm/studio/server/pageframes.mjs:268`, `packages/openfilm/studio/server/pageframes.mjs:274`, `packages/openfilm/studio/server/pageframes.mjs:280`, `packages/openfilm/studio/server/pageframes.mjs:299`.

Call path: Actual registered bridge.draw -> issued producer.pageFrame -> pinned pageframes.withPage. A 45s job timeout or a failing/timed-out seek can occur on real media/resource stalls; it does not require an arbitrary injectable producer.

Trigger: In withPage the JOB timer launches void closeBrowser() and rejects the race without awaiting browser close. The catch calls forget(), whose page.then(p=>p.close()) is also fire-and-forget. W tracks only loaded.pageFrame; bridge finally calls endDraw immediately after that rejection, and workspace releases its PRE closure.

Contract failure: The accepted draw count and owned-call ledger represent promise settlement, not actual page/context/browser settlement on this branch. closeServing can consequently see zero accepted draws while teardown is still running, and a peer producer owner means owner.close need not close the shared browser. R07 requires accepted work/probes to settle before input release; Q02 proves the successful late-dependency branch only. No witness is minted on this failure, but resource-lifetime acceptance still fails.

Minimal correction: Add a real per-call settlement contract in the pinned adapter layer and retain draw ownership until underlying timeout/forget cleanup is acknowledged. Do not treat a race rejection or fire-and-forget browser close as release evidence, and do not solve it by killing a peer owner. Preserve the upstream pin; any seam change needs explicit reviewed scope.

Required counterexample: Under an exact resource grant drive the real pinned seek/job timeout with a peer producer owner; observe page/context or browser disconnection and all child/probe settlement before endDraw/tree release, verify the peer is not killed, no late request outlives the serving, and cleanup uncertainty is retained if settlement cannot be established.

Evidence limit: Static cross-repository lifetime counterexample on the pinned upstream timeout branch; not observed or reproduced in current captures.

### A057-05 — MAJOR: A duration cache retained without its frame triple bypasses dependency identity checks

Locations: `src/host/agent-driven/created-native-source-reader.ts:1226`, `src/host/agent-driven/created-native-source-reader.ts:1239`, `src/host/agent-driven/created-native-source-reader.ts:1245`, `src/host/agent-driven/created-native-source-reader.ts:1327`.

Call path: Real film.html pageframe draw at ms0 creates a witness including duration and triple. Reader later classifies only files currently present. Duration-only classification asks the current output authorization, but never validates that witness dependencies still have their original identities.

Trigger: After a valid pageframe draw (no poster), delete only its derived .jpg/.json/.stamp triple, keep film-duration.json intact, modify film.html in place and restore its exact bytes and original mtime. Its ctime changes. Take a fresh reader round. Source-copy digests still match, duration output identity and film mtime:size match, and the empty allowed pageframes directory is accepted.

Contract failure: With no triple present #proveWitnessedCache is never called, so its dependency identity comparison at1327-1331 never runs. The duration branch accepts a witness whose film dependency has changed/restored identity. Newly acquired closures only prove the current restored epoch and do not compare it to the historical draw. K04-b874-906 keeps the triple and therefore reaches the stronger check; it misses this reachable path. This is stale cache authorization, not proof of a forged Expected numeric duration, which is independently computed.

Minimal correction: Validate all dependency identities of the current duration witness as well as its concrete duration output. Share the witness-dependency validation with pageframe/poster without requiring unrelated historical outputs to remain; preserve legitimate multi-frame/current-duration behavior.

Required counterexample: Start with an actually accepted real draw and reader round, remove just the derived triple, restore film bytes+mtime after an in-place change, prove ctime moved, and assert fresh reader refusal with NATIVE_SOURCE_CACHE_STALE. Include a duration-only stable positive control and retain Q03 two-frame/no-fallback tests.

Evidence limit: Static full-path counterexample; new duration-only regression NOT_RUN.

### A057-06 — MINOR: Media poster/frame/wave cache admission is still filename/shape based

Locations: `src/host/agent-driven/created-native-source-reader.ts:1205`, `src/host/agent-driven/created-native-source-reader.ts:1210`, `src/host/agent-driven/created-native-source-reader.ts:1217`.

Call path: The actual reader retains all workspace files and reaches #classifyCache for a cache path absent from committed source.

Trigger: Create .film/cache/posters/<correct-media-key>.jpg with arbitrary bytes, or frames/<correct-key>-0-32.jpg with arbitrary bytes, or waves/<correct-key>.json containing {}. The first two branches return after a key/width check; waves only parses an object.

Contract failure: These bytes have no concrete producer authorization. This falls short of the original R04 wording that forged cache is refused with no broad cache whitelist. Severity is limited because these outputs are not consumed as authoritative Expected facts by the reviewed reader; this is not an HTTP authorization bypass or a claim that arbitrary images alter the projection.

Minimal correction: Refuse unsupported cache families until their producer output is proved, or explicitly narrow and approve the contract for retained, non-authoritative cache families. If retained, separate that weaker classification from a claim that the producer was verified.

Required counterexample: Use each well-formed native key with deliberately fabricated output bytes and assert the documented refusal/non-authority behavior through the actual reader; do not use an unknown path that fails an earlier boundary.

Evidence limit: Static admission counterexample; no new runtime executed.

## What the review does substantiate

The actual component fixture invokes HTTP bootstrap, registered local assets and the real SOURCE_ONLY assembly worker; CreatedSourcePublisher publishes rich source and commitPreparedCreatedSource commits it. It then prepares an independent physical workspace, registers an issued ref and reads through the actual authority/source reader. The accepted review/session policy is explicitly fixture data, and does not prove human review or production session integration. A frozen source grep finds no current application instantiation of CreatedNativeSourceReader or producer-cache wiring outside their component definitions; that is the explicitly deferred next integration, not an invented implementation defect.

Source leases bind committed lineage, rights, native producer plan and consumer graph, and compare actual owner/base/control rows. Workspace lease release does not invalidate another lease or the registered ref; replaced views invalidate the old generation. The real negative tests start with genuine current leases before testing copied/foreign capabilities. The exported test hooks are Host-private injections, not public HTTP authority. Conversely the serving request target is public input and is reviewed as such in A057-01.

The retained closure owns allocations, not recycled integers. The actual tests observe a reused FD number and still release the new allocation once; PRE/POST tests compare namespace+monotonic-id coverage for all allocations, preserve the genuine primary and both cleanup error objects, and latch uncertainty. Source/workspace directory sets and physical identities are compared against actual filesystem enumeration, including empty and nested directories and live descriptor increments for both roots. Reader delivery transfers closures and negative/directory guards with leaf handles; reader.close does not revoke delivered resources. These strengths do not close the EOF/hash or upstream timeout defects.

The fixed source-reader probe uses the parent PID's held descriptor path and normalized actual ffprobe output. Rotated and multiple-video-stream diagnostic media have concrete assertions for coded/shown dimensions and first-stream fps. Timeout/overflow/signal/cancel tests use real local child processes through an explicitly injected transport and do not inject successful media facts. Numeric video order is compared against pinned listFiles on a real tree with scrambled input. Caption ordering is separately compared against platform readdir and the actual consumer's language order; five literal revision vectors preserve UTF8, BOM and CRLF bytes.

Pageframe and film-poster outputs normally require exact issued producer/production lease/serving identities and exact output/dependency identities; witnesses are staged until release and final checks complete. Actual tests cover same bytes/new inode, restored mtime with changed ctime, non-film draw refusing to authorize a preexisting forged duration, two different lawful frame triples and newest duration authorization. The pure ledger no-fallback test is not being represented as a real revoke-after-browser-failure test. Duration-only admission in A057-05 remains a separate reachable gap.

Expected parent-to-candidate diff preserves the original84 test bodies, supplies the newly required parser exports to explicit test stubs and adds one missing-export refusal. The production loader only adds settings/markers parsers from the approved015 module; it does not change the artifact/pin. Original render SnapshotReadPort and legacy refusal remain separate paths.

## Independently checked evidence and limits

All seven required freeze entry documents were read. SHA256 and byte counts of all28 SOURCE_SCOPE paths match the enclosing Git blobs, including the three opaque fixtures of18/17/17bytes. All626 fullcapture input hashes match raw bytes in the frozen Git tree. All seven GATES-indexed log hashes match. The parent SHA matches the dispatched baseline. Working approved015 license/manifest/declaration/expected/pure module hashes match all five protected approved values; none was rebuilt.

The fullcheck log has actual188 files /2592 pass /1 skip, Python eight vector receipts and both vite builds. The opt-in real-tools test is explicitly skipped/NOT_RUN. The separate build capture reports exit0, including validator --check. The85-test Expected capture reports85 passed. LF03 and PF03 recorded baseline0/mutant1/restored0; inspected failures hit the content-proof and genuine-cleanup assertion respectively, not missing imports or compilation. These are prior captured runs, not reruns by this reviewer, and no aggregate count substitutes for the assertion references in MATRIX.json. Fullcheck records Node v22.22.1, ICU78.2, locale en-US. Security scan status is a bounded selected-payload/ruleset claim, not proof that every possible secret is absent.

The worktree remains honestly dirty: user AGENTS.md and eight unrelated lane-media evidence directories are preserved. Historical failed captures are not relabeled. No assertion here converts all053 globbed media into valid current artifacts; only the receipt-specific validity rules may do that.

Not executed in this review: tests, build, validator, Host/server/browser startup, HTTP requests, ffprobe, ffmpeg, new tamper or mutation runs, page timeout reproduction, image/media playback, human acceptance or next integration. The new counterexamples are static control-flow findings with explicit reproduction plans and preconditions. MAIN should grant exact argv/resources before any reproduction.

The17 original requirements are retained verbatim in MATRIX.json with source, complete inspected assertion blocks, captured run references and scoped proven/partial/pending-after-acceptance statuses. REVIEW is partial because repairs and the next frozen acceptance have not occurred; NEXT is pending-after-acceptance and is not used as a false reason to declare the entire project complete.
