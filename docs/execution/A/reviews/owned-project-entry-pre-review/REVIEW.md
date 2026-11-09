# Owned-project entry — source pre-review

Input MAIN HEAD `824b7dba9cd37ced3da597e2b490c555c17e8c01` plus the actual dirty/untracked files in `input-hashes.json` (20 files). **No concrete BLOCKER/MAJOR identified in the reviewed candidate. REVIEW_PENDING for actual build/browser/frozen verification.** No tests, Host, browser, compiler or services were run by this reviewer, and no MAIN source/index was modified. This is not a frozen PASS or full A05/A/security/human acceptance.

## Permission and query boundaries

The UI-only list branch authenticates trusted_ui with origin/cookie/proof before queries. Cookie-only, driver and anonymous requests cannot select an owner by parameter. The SQL itself filters `principal_id`, committed bootstrap state and created project origin, and each returned item is also checked through the existing owner authority. `after` is a validated project ID, used only as a bound keyset value; it is not an authorization claim. A foreign ID used as a boundary does not cause a foreign row to be returned. Ordering and `> after` use the same project-ID column, LIMIT25 supports output of24 and next_after from the final returned ID. Duplicate/unknown/empty/invalid query parameters are rejected.

Listing does not resolve/prepare a native workspace, start Studio, call a mutation, publish a revision or create a loaded acknowledgement. It reads current durable commit/source facts and recovery gate; absent facts/recovery produce attention. The saved state explicitly describes persistence rather than current source/media/native readiness. List reads are synchronous; the route authenticates again before returning. No await was introduced between owner query/projection and that final authentication.

## Stale state, navigation and rendering

Opening is separate from list GET. It reuses the existing real owner prepare→Supervisor.ensure→current principal/prepared tuple checks and now validates the native-entry response. Frontend selection must be an existing saved card. The response is rejected if its project differs, entry expired, native_state differs, URL points outside the fixed 127.0.0.1 HTTP one-use fragment shape, or port is outside1..65535. Fetch uses same-origin credentials/proof, no-store and redirect:error. No caller-provided path, native ID, Host token or operator credential enters the navigation URL.

OwnedProjectBrowser invalidates stale load responses using a request serial, invalidates pending work on effect cleanup, disallows open while loading/opening, and suppresses navigation after the serial is superseded/unmounted. Existing page facts can remain visible after a failed refresh; they are historical display, not renewed authorization, and the server independently validates every subsequent open. React renders titles/IDs as text; no innerHTML or user-controlled href was added.

The root exchanges the one-use fragment first, then uses the authenticated mode endpoint. Only explicit trusted_ui mode mounts the owned chooser; explicit legacy session shape mounts the prior NarralensApp. Merely importing that module does not trigger its d1-30s fetch: the request is inside the legacy component effect, which is not mounted in owned mode. Ambiguous or failed mode detection produces a fixed error instead of a fixture fallback. The legacy component source remains intact. Production proof stays origin-scoped; cookie delivery across ports alone cannot authenticate list/open.

## CSP and component boundary

The client imports generated static validators, not Ajv's compiler. The generator registers both new contracts and incorporates them in the source-input manifest, while rejecting require/eval/Function output. It does not relax CSP. Pure OwnedProjectEntry consumes data/callback props only, escapes display text, disables attention/busy rows, labels zero-frame content as empty, and explicitly distinguishes saved from loaded. It does not sign approval or construct engine facts.

## Evidence limits

Read test sources cover real owned persisted list/no-native-side-effect, foreign-owner empty result, unauthenticated/driver/cookie-only/query refusal, client mode/destination validation and a planned real headless root→chooser→refresh→selected native editor path. These source tests have **not been executed or accepted by this reviewer**. The current list integration fixture contains one actual project; it does not itself demonstrate a real 25th-row keyset boundary. The SQL boundary was inspected directly, without claiming that unexecuted multi-page behavior has been evidenced. PRODUCT's presentation component was inspected as implementation, not independently tested here.

Candidate still requires MAIN's actual affected build/browser evidence; that pending evidence is already part of the active implementation, not a new scope or module gate requested by this review. No source defect was inferred solely from missing test coverage. Save remains distinct from load, NativeAck remains unknown, and actual content/assembly/Run/Delivery/authorized-film/human acceptance are outside this review.
