# A BRIDGE handoff

Base/contract/HEAD: ca5b67a8285b130c79055317c6202f73cfbb99c8. Owner Codex
/root/a_bridge_lead. Writer for both rounds: Claude Code session
d94ac073-b5b8-42c6-9b4d-f0eef57d7850 (sole writer, implementation only, no commit).

Round 1 delivered the A-BRIDGE-001 implementation. Codex reviewed it read-only
(`REVIEW-1.md`, NEEDS_WORK) and transferred the same session back to Claude for the
fixes. Round 2 is the result. The original session logs are preserved unchanged:
`claude-A.stdout.log`, `claude-A.stderr.log`, `claude-A-review1.stdout.log`,
`claude-A-review1.stderr.log`.

Status: **code and tests written; nothing executed.** MAIN resource reservation 62928
is still RUNNING, so no install, no `tsc`, no vitest, no browser and no media ran in
either round. This work tree has no `node_modules`: the repository's dependencies are
not installed here, so even the real-SDK stdio case cannot start until MAIN releases
the reservation and `pnpm install --offline --frozen-lockfile` runs.

## Round 1 — what was delivered (unchanged by round 2)

**A01 — launcher (pure modules, `src/launcher/`)**: pure planning
(`planLaunch`/`planStop`/`planHealth`/`planInstanceHealth`), the instance types and
three injected ports, `ServiceHealthRegistry` with the contract constants 5000/15000
and real expiry to `unknown`, `LauncherSupervisor` (cold start, duplicate start
including concurrent convergence, shared attach and the refusal to stop it, owned
stop and reopen with the next generation, detach-without-stop, the contract
`Instance` descriptor).

**A02 — MCP façade (`src/mcp/`, `skills/`)**: a checked view over the frozen registry
(31 routes, 24 tools, 5 resources, throws on drift), contract-derived JSON Schemas
with the local `$ref`s inlined, a typed local Host HTTP client on `ApplicationPorts`,
the SDK 1.26.0 stdio server and its executable, `skills/narralens` (entry skill and
bin wrapper) and `skills/narralens-lib` (registry re-export, error table, reconnect
runbook). No trusted-UI and no native-bridge route is exposed.

**A03 — read-only observation projection (`src/host/observability/`)**: the injected
atomic-read, event-read, cursor-sign and cursor-verify ports; the cursor's scope,
expiry and retention rules; `Last-Event-ID` verified separately from the initial
cursor; the atomic snapshot read and the signed cursor that follows it.

## Round 2 — the REVIEW-1 fixes

Every finding is addressed in the code and covered by a case. Nothing was executed,
so "covered" means "the case exists", not "the case passes".

### 1 — façade validation on both surfaces

- The tool surface validated the input and the output; the **resource** surface
  validated the output but not the input. It now validates the input with
  `validateAgentRouteInput` before the port is called, so a malformed project id or
  cursor never reaches the Host (`src/mcp/mcp-server.ts`).
- Injected port output that is not the route's contract becomes `INTERNAL_ERROR`
  instead of reaching the client.
- Every envelope that crosses the protocol is checked with
  `validateAgentDefinition("Error", …)`; one that is not a contract error is
  reported as an internal fault (`checkedEnvelope`).
- A URI that cannot be percent-decoded is `INVALID_REQUEST`, not an uncaught
  `URIError`.
- A query parameter the resource does not accept is refused rather than ignored;
  only `events.snapshot` accepts `filter_digest`, `cursor` and `last_event_id`.
- The jobs resource keeps its identity projection (an object with the project's
  identity, not a bare array).
- Cases: `mcp-registry.test.ts` — "refuses a malformed project id without calling
  the port", "refuses a URI that cannot be percent-decoded", "refuses a query
  parameter the resource does not accept", "refuses an injected output that is not
  the route's contract".

### 2 — the local Host client refuses before it sends

- The input is validated **before any network request** (`validateAgentRouteInput`).
- The base URL must be an `http` loopback literal (`127.0.0.1`, `[::1]`). A name such
  as `localhost` is accepted only with an injected resolution policy whose answers
  are all loopback literals. Userinfo, query, fragment, a path prefix, another
  scheme and any other origin are refused when the client is built
  (`assertEndpointPolicy`).
- Redirects are refused, not followed (`redirect: "manual"`), so the credentials are
  never handed to whoever the redirect names.
- The response body is bounded (`readBoundedBody`); a body over the limit is
  cancelled rather than buffered.
- Cases: `mcp-host-client.test.ts` (new) — "never sends an input the contract does
  not describe", "refuses a base URL that is not a loopback literal", "refuses a
  base URL that carries credentials, a query, a fragment or a path", "refuses a host
  name unless a resolution policy restricts it to loopback", "refuses a redirect
  instead of following it", "refuses a response body that is larger than the limit".

### 3 — a strict contract handshake before the first dispatch

- Before the façade asks the Host for anything except the instance itself, it reads
  the Host's `api_version` and `contract_version` and refuses a mismatch —
  **before a write is sent**. The check reads the versions before applying the
  schema, so a foreign contract and a malformed instance get different answers.
- The handshake validates the frozen `Instance` schema, and the façade never
  synthesises capabilities or a registration: it reads the Host's own instance.
- MAIN may inject an already-verified handshake (`McpFacadeOptions.handshake`).
  A successful handshake is remembered; a failed one is not, so a Host that was still
  starting can answer a moment later.
- `tools/list` remains protocol-only and is documented as such.
- Cases: `mcp-registry.test.ts` — "verifies the host's contract version before the
  first dispatch", "refuses a host that speaks another contract, before any write is
  sent", "accepts an explicitly injected, verified handshake"; `mcp-stdio-client.test.ts`
  — "verifies the host's contract version before the first dispatch".

### 4 — an ambiguous write is an unknown outcome, not a failure and not a success

- A POST whose transport times out, whose answer cannot be read, or whose success
  body is off-contract is reported as `PROVIDER_RESULT_UNKNOWN`: **not retryable**,
  with `next_actions` `reconcile_by_idempotency_key` and
  `read_back_before_retry`. It never proposes a new idempotency key.
- A request that provably never reached a server (a refused connection, an
  unresolvable name, an unreachable network) is *not* ambiguous, and stays a
  retryable `CAPABILITY_UNAVAILABLE`.
- A read's network failure stays a retryable `CAPABILITY_UNAVAILABLE`.
- A known Host error envelope is passed through with **the Host's own** retryability
  and next actions; the façade no longer recomputes them.
- The skill now distinguishes an authenticated safe cancel from unconditional
  authority, and warns that an unknown write is reconciled under the *original*
  idempotency key (`skills/narralens/SKILL.md`, `skills/narralens-lib/lib/errors.md`,
  `skills/narralens-lib/lib/reconnect.md`).
- Cases: `mcp-host-client.test.ts` — "reports an unreachable host on a read as a
  retryable capability failure", "reports a write that may or may not have been
  applied as an unknown outcome", "reports a write that provably never left the
  process as a retryable failure", "reports a write whose answer is off-contract as
  an unknown outcome", "keeps the host's own error envelope for a write that was
  refused".

### 5 — the health roll-up fails closed and is scoped to the instance

- `planInstanceHealth` reports `degraded` for a stopped instance and for a stopped,
  degraded or unknown service; `starting` for an instance or a required service that
  is still coming up; `ready` only when everything is observed ready.
- Health samples carry the instance they belong to, and the descriptor's roll-up
  reads only that instance's services — the registry can hold several instances at
  once.
- Cases: `launcher-cold.test.ts` — "reports a stopped instance as degraded, not
  ready", "reports a stopped service as degraded", "does not let another instance's
  services decide this instance's health".

### 6 — the scan position may never run ahead of what was read

- `EventBatch` now distinguishes `scanned_watermark` (the position the scan
  **reached**) from `high_watermark` (the global tail, informational). A scan
  truncated by its limit reports the last row it read, never the tail.
- The port contract says the port returns every row it scanned; the projector
  verifies that the rows cover the position the batch claims, that they are
  ascending, unique and after the client's position, and that the positions are
  safe, non-negative and monotonic. An inconsistent batch is refused
  (`EventBatchError`) instead of silently losing a window.
- `readProjectedEvents` always enforces `event.project_id === requested project`,
  even when a custom `matches` predicate is supplied.
- Cases: `cursor-events.test.ts` — "advances the position past rows the filter
  skipped", "never advances past rows that were not read", "refuses a batch that
  claims a position its rows do not cover", "refuses an empty batch that claims to
  have advanced", "refuses unordered or duplicated rows", "refuses a position that
  is not a safe integer or runs ahead of the tail", "keeps the project scope even
  when a custom filter is supplied", "passes the client's position and limit to the
  port".

### 7 — no cursor implementation in production code

- `src/host/observability/local-cursor-codec.ts` is **deleted**. The production
  index exports only the injected cursor ports; MAIN owns the key material, the
  rotation and the durable nonce/claims store.
- The lane's own codec moved to `tests/agent-driven/bridge/helpers/cursor-codec.ts`
  and speaks MAIN's agreed wire shape: `c` + 12 random bytes base64url (16 chars) +
  `_` + the **full** HMAC-SHA256 base64url (43 chars) = 61 characters, with the MAC
  binding the nonce and the complete `CursorClaims`, and the nonce/claims mapping
  persisted. No truncated HMAC and no self-contained dot token.
- The cursor TTL is now a **required** option (`cursorTtlMs`), validated as a
  positive finite number of milliseconds. The module's invented default is gone.
- The claims returned by the verifier are validated against the frozen
  `CursorClaims` schema, their issued/expiry interval must be well formed, their
  watermark must be a safe non-negative integer, and the snapshot's context must
  belong to the requested project.
- Both the cursor and the `Last-Event-ID` are still verified independently.
- Cases: `cursor-events.test.ts` — "refuses claims the contract does not describe",
  "refuses a cursor whose claims describe no usable interval", "refuses a cursor
  lifetime that is not a positive finite number", "refuses a context that belongs
  to another project".

### 8 — the filter digest is MAIN's policy, not the module's

- The invented empty-filter digest is gone. `McpFacadeOptions.filterDigest` is the
  policy value; without it the events-snapshot resource answers with a typed
  configuration failure that names the missing value, and the discovery and read
  tools keep working.
- The stdio entry receives it from `NARRALENS_FILTER_DIGEST`.
- Cases: `mcp-registry.test.ts` — "answers the snapshot resource with a
  configuration failure when no digest is configured", "uses the configured digest
  for the snapshot resource".

### 9 — the test expectations were wrong about the resources

- Four of the five registered resources are templates; `narralens://services/health`
  is concrete. The cases now expect four templates and one resource, and read the
  health resource's **actual contents** over the real stdio transport.
- The fixtures are typed with `satisfies Context` / `satisfies Instance` /
  `satisfies HealthRead` / `satisfies EventSnapshot`, so a fixture that drifts from
  the contract is a type error instead of a widened literal.
- Case: `mcp-stdio-client.test.ts` — "advertises exactly the registry's tool
  allowlist over a real stdio transport", "reads the concrete health resource over
  the real transport".

### 10 — the bin wrapper owns its child and nothing else

- The wrapper handles the child's spawn `error`, forwards `SIGINT`/`SIGTERM`, and
  kills its child when its own stdin closes, so a client disconnect cannot leave an
  orphaned stdio server.
- Shutting the façade down never stops the Host: the wrapper only ever touches the
  process it started.
- The wrapper runs a JavaScript entry directly and only needs `tsx` for a
  TypeScript entry, so its own behaviour can be exercised without the repository's
  dependencies.
- Cases: `mcp-wrapper-cleanup.test.ts` (new) — "stops the server it started when the
  client disconnects", "does not stop anything but its own child".

## Files and SHA256

```
4bd9a64c7070ba1f537141469e8f669a8c124b61d3a51cadfbd4a1e8de9545d1  skills/narralens-lib/SKILL-LIB.md
bd7c79c79f8d36d01799ab3ce1fd8751c4829b04494c85f4814cf07a0fe9986b  skills/narralens-lib/lib/agent-registry.ts
6ca1921d3a45506a3e0d46bb260c69cc274acc42e6687daa2118a92e387337a4  skills/narralens-lib/lib/errors.md
7c3ddb8bbe661e30f9c57780126f80ef27beaef9a29f857cbf10ffb76dde01d2  skills/narralens-lib/lib/reconnect.md
1fc19e32ba4fb2401531bc7d8b5a5cee421f5cf6af1f150dba55e814536b7cb8  skills/narralens/SKILL.md
9eebe096a7c668fbabeb7008f58a11b4a258634d44f6670688cf2843d7efae24  skills/narralens/bin/narralens-mcp.mjs
9350b1084968c2629cc2ff58120e0f3c8cfe0c460c3b87879f9a9405dfc0d1b7  src/host/observability/cursor.ts
525a8f9a532e63d74e970da4c182f3b076d9fcbc9e03fd1b3e44db60b9a221cc  src/host/observability/event-projection.ts
2a84cf3648ffab54d3bf1c9587620cfdfc8a6723524b876f801f4a980397e4b7  src/host/observability/event-snapshot.ts
988c709f5efb2229f874e7d76aeb20c9afd6ff648bcaa698a61a6ce4ca51320b  src/host/observability/index.ts
0d8f36abe472bf1af32d26c4a971730c7d4203d192b28572027a8bc022e104e2  src/host/observability/ports.ts
8a7ccd99cf53d0911f79cb95c43421e13db323ded197b8c34c188998f4fcc119  src/host/observability/service-health-registry.ts
0a606ea2b495947fe042ac32a418ced214d0f2f687c2a017121d8eae21effa10  src/launcher/health-registry.ts
e6bc8306ebd4fc80fc99ef12d12aa43254df198f36d8a562d64f97fcdc1813d9  src/launcher/index.ts
bc51d9954267b6743c8abc8be5f0d0e8c9d54a96c743ce3483e56263fa1363e1  src/launcher/launcher-plan.ts
c36d146a53840970829d83062176b1e97d69d899e2a53da9dca754325d96d6eb  src/launcher/launcher-types.ts
65a2f69750bf7cee4c8846eaa5ba46326271d7ba4cbe5d7744ff6656c1961cac  src/launcher/service-supervisor.ts
233623b71d92b4f7ad36dc38bb578ef83ffe5c5bbcf6296329f9288dbce361d2  src/mcp/host-application-ports.ts
bb0a5d610d164b3c4d43c0ccd779921bca073c3cd9725529c72ce59846066594  src/mcp/host-error-mapping.ts
65b388af3345b32b3ecbbe452fb6f8d371064c6cf2bac4c5de3d10e4e413fa52  src/mcp/index.ts
97ac8d0f8f30e474b472901a9e9ec064098c348f36d4b09041c6809a7649f96f  src/mcp/mcp-server.ts
f97dc42716a80bc97390c31e1fa2b0b2095241dfdaca063b5778ee0a43c33d15  src/mcp/registry-view.ts
8a34ce53223067abb2a14bd7469589f7a2cf2005ea88a118350b1a185128fc83  src/mcp/stdio-main.ts
070e096f3f000cf21ecb0b2cd0cfdf8fcf5fbc8b17b69de32f763a2a9e2f2c2d  src/mcp/tool-schemas.ts
c38ff1e4d758198d0039793ce64125b978d0b9804a0d8ea6f99d53575edd914f  tests/agent-driven/bridge/cursor-events.test.ts
c4c5b2406b67d6f2f01e6783393ca2c56c5597944b6d4377151397df90c1f765  tests/agent-driven/bridge/helpers/cursor-codec.ts
4a5e26365d7df2183f18e41e09aa6a581558ac2fe14d1d69b73a044312e28876  tests/agent-driven/bridge/helpers/long-lived-child.mjs
358ed227395587dd1272ba9c90be30ffedd1bcf519c5e988f9847f05fdea0613  tests/agent-driven/bridge/launcher-cold.test.ts
95f054decbc7e29ab27c8cb3e8502f96d24545e7130ead5c6ab880f35a7e49fe  tests/agent-driven/bridge/mcp-host-client.test.ts
5e76a8b095da9f73be904816e99059c62cf5ebb8b8ec9faee86df0174ae57f76  tests/agent-driven/bridge/mcp-registry.test.ts
2152c6bf30790084511e46080bd0598e063bae82290ef378cbfcaa9a8cce49f3  tests/agent-driven/bridge/mcp-stdio-client.test.ts
a99f19b6178a51cf33d23f4db767f1897378bec0fc2ff612e257e377a7cbbf7e  tests/agent-driven/bridge/mcp-wrapper-cleanup.test.ts
d874d8b111a9c0d061c8487e62d39fdc5373cadd31c031cfaff96332975931ae  tests/agent-driven/bridge/skill-library.test.ts
4920e19e34be778caf158d308008029379eb7980aa9a8c153161b377337f3527  tools/agent-driven/bridge/probe-mcp.mjs
```

Removed in round 2: `src/host/observability/local-cursor-codec.ts` (moved to
`tests/agent-driven/bridge/helpers/cursor-codec.ts`, rewritten to MAIN's agreed
61-character scheme).

## Tests written — all NOT_RUN

| file | case | what it covers |
|---|---|---|
| `launcher-cold.test.ts` | A-COLD | cold start, duplicate start (sequential and concurrent), shared attach and the refusal to stop it, owned stop and reopen with the next generation, detach-without-stop, the health TTL boundary (14999 ms fresh, 15000 ms expired), the fail-closed roll-up, the per-instance scoping, the contract `Instance` descriptor |
| `mcp-registry.test.ts` | A-MCP | the exact 24-tool allowlist, no trusted-UI or native-bridge route, each tool's contract input schema, path/query/body building, the error mapping rules, the contract handshake (success, mismatch, injected), the resource input validation, the query-parameter refusal, the configuration failure, the jobs projection, four templates + one concrete resource |
| `mcp-host-client.test.ts` | A-MCP | the Host client's refusals before a request leaves: invalid input, non-loopback and name-based base URLs, credentials/query/fragment/path in the URL, redirects, an unbounded body, and the read-failure versus unknown-write-outcome split |
| `mcp-stdio-client.test.ts` | A-MCP | a **real** SDK `Client` against the **real** façade in a **real** child process over stdio, against a local stand-in Host that records the requests: tool discovery, four templates + one concrete resource, the health resource's contents, the handshake order, a call that reaches the Host, a resource read, an invalid field that never reaches the Host, an unreachable Host, recovery when the Host returns, an unknown tool |
| `mcp-wrapper-cleanup.test.ts` | A-MCP | the bin wrapper stops the server it started when the client disconnects, and stops nothing else |
| `cursor-events.test.ts` | A-EVENTS | the atomic snapshot and its cursor, resuming, `Last-Event-ID` precedence, both cursors verified separately, the four scope mismatches, expiry, tampering, malformation, malformed claims, a broken interval, the retention floor, the refusal-to-code table, the TTL policy, the context identity, and the scan-position rules |
| `skill-library.test.ts` | A-MCP | the skill library describing exactly what the façade exposes |

## Commands actually run (all read-only; none of them builds, type-checks or tests)

| command | exit | result |
|---|---|---|
| `git -C … rev-parse HEAD` / `git status --porcelain` | 0 | HEAD `ca5b67a…`; only untracked new files under the allowed prefixes plus the lane docs |
| `find` / `grep` / `cat` over the contract, the registry, the schema, the existing host code and the installed SDK (read-only, `/mnt/c/workspace/videoworkline/Narralens/node_modules/@modelcontextprotocol/sdk`) | 0 | read for the implementation |
| `python3` cross-check of the registry ↔ `ROUTE_PATH_BINDINGS` ↔ contract schema | 0 | `tools: 24, routes: 31, problems: none` |
| `python3` import/export cross-check of every lane module and test | 0 | `no problems` — and it found a real defect: the observability modules imported `../../../contracts/…` instead of `../../contracts/…`, which would not have resolved. Fixed |
| `node --check` on the three `.mjs` files (the wrapper, the probe tool, the test helper) | 0 | syntax ok — those files are outside `tsconfig`'s `include` and are not covered by `tsc --noEmit` |
| `sha256sum` over every new file | 0 | the table above |

No `find /`, no traversal of `/mnt/J/` or any other drive.

### NOT_RUN (blocked by MAIN reservation 62928, still RUNNING)

- `pnpm install --offline --frozen-lockfile` — NOT_RUN. This work tree has no
  `node_modules`; the MCP SDK, the test runner and `tsx` are not present here.
- `pnpm exec vitest run tests/agent-driven/bridge --maxWorkers=1` — NOT_RUN.
- `pnpm exec tsc --noEmit` — NOT_RUN. **No type-check has been performed on any of
  the code above**, in either round; the first real `tsc` run is still outstanding
  and may find type errors.
- No browser, no ffmpeg, no media, no network, no paid request, no model download.

## Dependencies and policy injection

What the lane modules need from MAIN, and what they deliberately do not decide:

| need | supplied by MAIN | where it is injected |
|---|---|---|
| Host address and credentials | MAIN | `NARRALENS_HOST_URL`, `NARRALENS_HOST_TOKEN`, or `createHostApplicationPorts`'s options; a name-based host needs `resolveHost` |
| the filter digest for the snapshot resource | MAIN | `NARRALENS_FILTER_DIGEST`, or `McpFacadeOptions.filterDigest` |
| the cursor lifetime | MAIN | `EventSnapshotOptions.cursorTtlMs` (required, positive, finite) |
| the cursor keys, the nonce/claims store and the rotation | MAIN | `CursorSigningPort` / `CursorVerificationPort` |
| the atomic snapshot read and the event log | MAIN | `AtomicObservationReadPort`, `EventReadPort` |
| the instance identity and the process lifecycle | MAIN | `InstanceDiscoveryPort`, `InstanceLaunchPort`, `InstanceProbePort` |
| the verified handshake, when MAIN has already checked it | MAIN | `McpFacadeOptions.handshake` |
| the instance capability list | MAIN | `LauncherSupervisor`'s `capabilities` option |

None of these has a value invented in this lane any more: the empty-filter digest,
the cursor TTL and the cursor codec were all removed in round 2.

## Limitations and caveats that remain

1. **Nothing has been executed, in either round.** No install, no type-check, no
   test run. The code and the cases are written; they are not proven.
2. **The SDK API surface was verified by reading the installed SDK elsewhere**, not
   by installing it here: the 1.26.0 `.d.ts`/`.js` were read (read-only) from
   `/mnt/c/workspace/videoworkline/Narralens/node_modules/@modelcontextprotocol/sdk`.
   The first real `vitest` run is the check that this matches the SDK resolved here.
3. **The global watermark and the event ids are assumed to live in the same id
   space.** The contract calls one a "global outbox watermark" and the other an
   `event_id`; the retention check compares them directly. MAIN must confirm this
   reading before the projection is wired to the real log.
4. **The scan-position contract is a port guarantee.** The projector verifies that
   the rows cover the position the batch claims; it cannot verify that the port
   scanned a contiguous range. MAIN's port must return every row it scanned.
5. **`PROVIDER_RESULT_UNKNOWN` is the contract's only "unknown outcome" code**, so
   it is what a write with an ambiguous outcome reports. The Host's own
   `PROVIDER_RESULT_UNKNOWN` has the same meaning for an external provider; the
   façade does not distinguish the two, and MAIN may want a dedicated code in a
   later contract version.
6. **The façade's message sanitiser is deliberately narrower than the Host's
   diagnostics redactor** (`src/host/host-diagnostics.ts`): it removes paths and
   URLs and keeps the words, because a reason such as
   `cursor_outside_retention_window` is what a client needs to act on.
7. **The health registry lives in `src/launcher/`**, next to the launcher that owns
   the service inventory, with a re-export at the path the implementation design
   names. One implementation, two documented paths.
8. **The wrapper's `NARRALENS_MCP_ENTRY` is a local override**, used by the lane's
   own cleanup case. It is not part of the client's contract.
9. **Nothing here is registered.** The modules are dormant: no route is registered,
   no process is started, no key is read, no database is touched.

## Integration required from MAIN

1. Register the façade with the Host (route registration, authentication, Origin,
   CSRF) and compose it with the frozen `ApplicationPorts`. The façade implements
   `ApplicationPorts` over HTTP for a local Host; MAIN's production composition may
   inject the in-process ports instead — the façade is identical either way.
2. Implement the launcher ports against the real process manager and the real
   single-instance store.
3. Implement the observation ports against the shared repository, the event log and
   the signing keys, with the cursor wire shape MAIN agreed (61 characters, full
   HMAC over the nonce and the complete claims).
4. Supply the filter digest, the cursor TTL, the instance capability list and — if
   MAIN has already verified the instance — the handshake.
5. Run the released commands, re-run the lane cases independently, and freeze the
   implementation SHA before any integration claim.

## Declaration ceiling

Module-level only. A-COLD, A-MCP and A-EVENTS are **NOT_RUN**: the code and the
cases exist, and nothing has been executed. This is not a production Host PASS, not
an integration PASS, not an independent external review and not a human acceptance.
Independent review: REVIEW_PENDING (REVIEW-1 was a code-reading review by the lane
owner, not an independent external review). Production assembly and human
acceptance: NOT_RUN.

Next allowed action: MAIN releases the resource reservation, then
`pnpm install --offline --frozen-lockfile`,
`pnpm exec vitest run tests/agent-driven/bridge --maxWorkers=1` and
`pnpm exec tsc --noEmit` are run and the real failures — including any type errors
— are reported as they are.

## Codex review 2
review1 exec63426 exit0, old PID3563078 terminal; source review still NEEDS_WORK. Focused corrections in REVIEW-2.md. PRODUCT holds light slot; BRIDGE source-only. Codex freezing review1 candidate before returning sole writer to Claude.
