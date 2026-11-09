# A BRIDGE handoff

Base/contract/HEAD: ca5b67a8285b130c79055317c6202f73cfbb99c8. Owner Codex
/root/a_bridge_lead. Writer for all three rounds: Claude Code session
d94ac073-b5b8-42c6-9b4d-f0eef57d7850 (sole writer, implementation only, no commit).

Round 1 delivered the A-BRIDGE-001 implementation. Codex reviewed it read-only
(`REVIEW-1.md`, NEEDS_WORK) and transferred the same session back to Claude for the
fixes; round 2 is that result. Codex reviewed the round-2 source again
(`REVIEW-2.md`, NEEDS_WORK, focused source corrections) and transferred the session
back once more; round 3 is that result. The original session logs are preserved
unchanged: `claude-A.stdout.log`, `claude-A.stderr.log`, `claude-A-review1.stdout.log`,
`claude-A-review1.stderr.log`.

Status: **validated in the lane.** MAIN granted BRIDGE-light (see
`VALIDATION-TASK.md` and MAIN's `docs/execution/A/resource-reservation.json`): an
offline frozen install with `--ignore-scripts`, `tsc`, and the lane's own tests with
one worker. The install, the type-check and the whole bridge suite have been run in
this lane and are **green**: `tsc --noEmit` exits 0, and the suite is 7 files /
108 tests, all passing. Every raw stdout, stderr and exit code is in
`docs/parallel/lane-bridge/evidence/`, and the first failing run is preserved
alongside the later green ones.

The ceiling is unchanged by that: this is still **module-level evidence only**. No
real Narralens Host, no ffmpeg, no browser, no full suite, no production
registration, no production keys, no external client and no human acceptance were
touched, and none of them were run.

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

## Round 3 — the REVIEW-2 fixes

Codex reviewed the round-2 source again (`REVIEW-2.md`, NEEDS_WORK, focused source
corrections) and transferred the session back. The light slot belongs to PRODUCT, so
this round was source-only: no install, no `tsc`, no test run, no browser, no
ffmpeg. All five findings are addressed below; every one of them still needs the
released commands before it can be claimed as proven.

### 1 — the wrapper's streams, and the arbitrary entry override

- The wrapper had `stdio: "inherit"` *and* `process.stdin.resume()`: the wrapper
  and the server read the **same** input descriptor, and the client's JSON-RPC
  stream was split between them. The wrapper now spawns the server with pipes and
  wires them by hand — the client's stdin is forwarded into the child's stdin, the
  child's stdout and stderr are copied out — so the wrapper never interprets a byte
  of the protocol.
- The `NARRALENS_MCP_ENTRY` override is **removed**. There is no way to point the
  wrapper at another program any more, and the wrapper always starts the real
  server (`src/mcp/stdio-main.ts`).
- The child is shut down with `SIGTERM` and then `SIGKILL` after a two second
  grace period, on a client disconnect, on `SIGINT`/`SIGTERM`, and as an `exit`
  safety net. The Host is never touched.
- The wrapper's own case now runs the **real** path: the SDK's `Client`, over the
  SDK's `StdioClientTransport`, against the **actual** skill wrapper, which starts
  the **actual** stdio server. The only stand-in is a micro HTTP server standing in
  for the Host. The case asserts that the handshake completed and the 24 tools were
  listed (the proof that the streams are not corrupted), that the wrapper's child
  is found while it runs, and that both are gone after the client disconnects.

### 2 — the endpoint policy, simplified

- `new URL("http://[::1]:4173").hostname` is `"[::1]"`, brackets included, so the
  IPv6 loopback literal was being refused. The host is now unwrapped before it is
  compared (`normalizeHost`).
- The resolver hook is **removed**: a name is resolved again by the network stack
  on every connection, so a policy that checked a name once and then fetched the
  name left a window in which the name pointed somewhere else. The base URL must
  now be an address literal, and the address that is checked is the address that is
  fetched.
- `timeoutMs` and `maxResponseBytes` must be positive, finite, safe integers, and
  are checked when the client is built (`HostConfigurationError`).
- Cases: `mcp-host-client.test.ts` — "refuses a host name: the address that is
  checked must be the address that is fetched", "accepts an IPv6 loopback literal",
  "fetches the loopback literal it was configured with", "refuses a timeout or a
  response limit that is not a positive finite bound".

### 3 — the handshake is repeated, not remembered

- The façade no longer memoises a successful handshake. A Host can be replaced
  under a façade that is still connected — restarted, upgraded, taken over — and a
  remembered "the contract was fine earlier" would keep dispatching to a Host the
  façade has never spoken to. Every non-instance dispatch is now preceded by a
  fresh handshake; concurrent dispatches share one handshake in flight, and its
  result is never kept.
- Case: `mcp-registry.test.ts` — "rechecks the handshake before every dispatch and
  fails closed when the host is replaced": the same connected client, a first
  dispatch against a valid Host, then the Host replaced by one that speaks another
  contract, and the next **write** is refused with the write port never called.

### 4 — a late, repeated or reordered log is normal; only a lying batch is refused

- The projection no longer refuses every duplicate or out-of-order batch. Rows the
  client has already seen are dropped, rows are ordered before they are shown, and
  a row that arrives twice is shown once. What it still refuses: an impossible
  event id, a row beyond the position the batch claims, the *same* id carrying
  *different* content, and a batch that does not cover the position it claims.
- The scanned/high invariants, the forced project scope and the port contract
  (the port returns every row it scanned) are unchanged, and no schema was
  touched.
- Cases: `cursor-events.test.ts` — "normalises duplicate, reordered and late rows
  instead of refusing them", "refuses the same event id carrying two different
  rows", "refuses a row that lies beyond the position the batch claims", "refuses
  a row with an impossible id".

### 5 — the resource URI is parsed once, strictly

- The query is everything after the **first** question mark; `split("?")` used to
  drop the tail of a URI that carried two. A URI with a fragment is refused.
- A query parameter given more than once is refused: taking the first value
  silently would answer a different question from the one that was asked.
- The percent-decode now happens exactly **once**, in the façade, inside the error
  handling. `matchResourceUri` returns the raw segment and no longer decodes (and
  no longer throws from inside a matching helper).
- Cases: `mcp-registry.test.ts` — "decodes a percent-encoded project exactly
  once", "refuses a URI that carries a fragment", "refuses a query parameter that
  is given more than once", "does not silently drop the tail of a URI that carries
  two question marks", "refuses a URI that cannot be percent-decoded".

## Round 4 — admitted validation (BRIDGE-light)

Authority: MAIN's `VALIDATION-TASK.md` and
`/mnt/c/workspace/videoworkline/Narralens/docs/execution/A/resource-reservation.json`
(holder MAIN, status RUNNING, `admissions[0] = BRIDGE-light`, `maxConcurrentWorkers: 1`;
allowed: offline frozen install `--ignore-scripts`, tsc, pure modules and real SDK
stdio with a small HTTP stand-in; forbidden: real Narralens Host, ffmpeg, Chrome,
full suite). Candidate HEAD `1d60ff9ed22851d2647e81a840b5f2af65aa3427`.

Everything ran **in the lane only**, **sequentially**, with the lane's own
`node_modules`. No parallel compiler, test or install run. Nothing was committed.

### Environment actually used

| tool | version |
|---|---|
| node | v22.22.1 |
| pnpm | 10.33.0 |
| @modelcontextprotocol/sdk | 1.26.0 |
| typescript | 5.9.2 |
| vitest | 3.2.4 |
| tsx | 4.20.5 |

### Commands, in order, with their exits

| # | command | exit | result |
|---|---|---|---|
| 01 | `pnpm install --offline --frozen-lockfile --ignore-scripts` | 0 | Done in 31.3 s; the pinned versions above installed from the local store. No network, no scripts, no lockfile change |
| 02 | `pnpm exec tsc --noEmit` | 0 | no diagnostics — the lane's TypeScript was already clean |
| 03 | `pnpm exec vitest run tests/agent-driven/bridge --maxWorkers=1 --minWorkers=1` | **1** | **first failure — preserved.** 7 files, 108 tests: **104 passed, 4 failed** |
| 04 | `pnpm exec vitest run tests/agent-driven/bridge/mcp-registry.test.ts tests/agent-driven/bridge/mcp-stdio-client.test.ts --maxWorkers=1 --minWorkers=1` | 0 | the two failing files re-run after the fixes: 46 passed |
| 05 | `pnpm exec tsc --noEmit` | 0 | still clean after the test fixes |
| 06 | `pnpm exec vitest run tests/agent-driven/bridge --maxWorkers=1 --minWorkers=1` | 0 | whole lane suite green: 7 files, 108 tests |
| 07 | `pnpm exec tsc --noEmit` | 0 | after the timeout bound was widened |
| 08 | `pnpm exec vitest run tests/agent-driven/bridge --maxWorkers=1 --minWorkers=1` | 0 | **final**: 7 files, 108 tests, all passing (worst case 8.3 s against a 60 s bound) |

Every run wrote `NN-<name>.stdout.log`, `NN-<name>.stderr.log` and `NN-<name>.exit`
into `docs/parallel/lane-bridge/evidence/`. **No first-failure log was overwritten**:
run 03 still carries the failing output, and the green runs are separate files.

### The four first-run failures — all mine, all fixed

None of them was a production defect: they were defects in my own test fixtures and
in my own timing assumptions.

1. **`narralens_artifact_put` fixture was invalid.** The payload used
   `paragraphs: []`, and the contract's `Script` requires `minItems: 1`, so the
   façade correctly rejected it with `INVALID_REQUEST` **before** the handshake. The
   fixture now carries one paragraph, and the case exercises the handshake refusal it
   was written for.
2. **The percent-decode case asserted the wrong thing.** It read
   `project_id` out of the *context payload* (the fixture's own id) instead of the
   input the façade passed to the port. The fake now records the last input per
   route, and the case asserts `{ project_id: "p-1" }` — the decode happens, and it
   happens once.
3. and 4. **Two stdio cases hit the default five second timeout.** The server is
   started as a child process and loaded through the repository's own `tsx`, which
   takes about four seconds on this filesystem; the two cases that spawn a client
   *and* restart the Host could not finish inside five. The stdio and wrapper cases
   now carry an explicit 60 second bound, chosen with room for a loaded machine —
   the observed worst case in the final run was 8.3 s.

### Evidence hashes (SHA256)

```
9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa  evidence/01-install.exit
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  evidence/01-install.stderr.log
880c46ede4bf1e3f539105cff079b84155ba07e7e293a148c83957eae1389f4d  evidence/01-install.stdout.log
9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa  evidence/02-tsc.exit
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  evidence/02-tsc.stderr.log
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  evidence/02-tsc.stdout.log
4355a46b19d348dc2f57c046f8ef63d4538ebb936000f3c9ee954a27460dd865  evidence/03-vitest-bridge.exit   <- the failing run
3a96496239900a2f20a41e1a7c241166c92eae3622bc958f28194f3c5896a85c  evidence/03-vitest-bridge.stderr.log
f303b73e24e1af58ab994fd4cbee0d807863815dd4fd54479b81f064bbf383f3  evidence/03-vitest-bridge.stdout.log
9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa  evidence/04-vitest-targeted.exit
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  evidence/04-vitest-targeted.stderr.log
c7e8c72d41b3f11499f77c3c18a13ba08f7c416b616df05d6e4ea95b274d96ab  evidence/04-vitest-targeted.stdout.log
9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa  evidence/05-tsc-after-fixes.exit
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  evidence/05-tsc-after-fixes.stderr.log
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  evidence/05-tsc-after-fixes.stdout.log
9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa  evidence/06-vitest-bridge-final.exit
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  evidence/06-vitest-bridge-final.stderr.log
db120cbc2ee91217747696d085d69f1a182a76960d1b8ca12efbfd0792a64f10  evidence/06-vitest-bridge-final.stdout.log
9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa  evidence/07-tsc-final.exit
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  evidence/07-tsc-final.stderr.log
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  evidence/07-tsc-final.stdout.log
9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa  evidence/08-vitest-bridge-final.exit
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  evidence/08-vitest-bridge-final.stderr.log
963c7cc99cbb7cb4eb9a8577c71596e2af200d6571fa423a0ca3c898ec5897cb  evidence/08-vitest-bridge-final.stdout.log
```

### What the green run does and does not prove

It proves: the frozen registry is exposed as exactly 24 tools and 5 resources; the
input, output, error and handshake rules behave as specified; the stdio façade
really answers a real SDK client over a real child process; the skill's wrapper
really forwards the client's stream and really takes its child down on disconnect;
the cursor's scope, expiry, retention and scan-position rules hold; and the
launcher's cold/duplicate/shared/health rules hold — all against frozen contract
vectors and small local stand-ins.

It does **not** prove: anything about the real Narralens Host, the real
registration, the real authentication, the real database, the production cursor keys
or their rotation, a real media or render chain, an external MCP client, or human
acceptance. Those remain MAIN's and remain NOT_RUN.

### Still NOT_RUN (out of the admitted scope)

- The real Narralens Host, its registration and its authentication.
- The production cursor keys, their rotation and the durable cursor store.
- ffmpeg, media, rendering and delivery.
- Chrome or any browser, the Vite build, and the production bundle.
- The full repository test suite and the other lanes' suites.
- Any online install, package fetch or external upload.
- An external MCP client (a real Codex/DSH session) and human acceptance.

## Files and SHA256

```
4bd9a64c7070ba1f537141469e8f669a8c124b61d3a51cadfbd4a1e8de9545d1  skills/narralens-lib/SKILL-LIB.md
bd7c79c79f8d36d01799ab3ce1fd8751c4829b04494c85f4814cf07a0fe9986b  skills/narralens-lib/lib/agent-registry.ts
6ca1921d3a45506a3e0d46bb260c69cc274acc42e6687daa2118a92e387337a4  skills/narralens-lib/lib/errors.md
7c3ddb8bbe661e30f9c57780126f80ef27beaef9a29f857cbf10ffb76dde01d2  skills/narralens-lib/lib/reconnect.md
1fc19e32ba4fb2401531bc7d8b5a5cee421f5cf6af1f150dba55e814536b7cb8  skills/narralens/SKILL.md
c8f4144053ca33ed33f0a65b70d5dc6222a26f5f84f84e1c74e2f9f790933187  skills/narralens/bin/narralens-mcp.mjs
9350b1084968c2629cc2ff58120e0f3c8cfe0c460c3b87879f9a9405dfc0d1b7  src/host/observability/cursor.ts
7e40641684559701fcb22002cd0ab48ce43dc600ca5097bd0de8e1d512c4fdbf  src/host/observability/event-projection.ts
2a84cf3648ffab54d3bf1c9587620cfdfc8a6723524b876f801f4a980397e4b7  src/host/observability/event-snapshot.ts
988c709f5efb2229f874e7d76aeb20c9afd6ff648bcaa698a61a6ce4ca51320b  src/host/observability/index.ts
0d8f36abe472bf1af32d26c4a971730c7d4203d192b28572027a8bc022e104e2  src/host/observability/ports.ts
8a7ccd99cf53d0911f79cb95c43421e13db323ded197b8c34c188998f4fcc119  src/host/observability/service-health-registry.ts
0a606ea2b495947fe042ac32a418ced214d0f2f687c2a017121d8eae21effa10  src/launcher/health-registry.ts
e6bc8306ebd4fc80fc99ef12d12aa43254df198f36d8a562d64f97fcdc1813d9  src/launcher/index.ts
bc51d9954267b6743c8abc8be5f0d0e8c9d54a96c743ce3483e56263fa1363e1  src/launcher/launcher-plan.ts
c36d146a53840970829d83062176b1e97d69d899e2a53da9dca754325d96d6eb  src/launcher/launcher-types.ts
65a2f69750bf7cee4c8846eaa5ba46326271d7ba4cbe5d7744ff6656c1961cac  src/launcher/service-supervisor.ts
dfa4f2226c3a940962e7effaaa2934193327d14816f81b5e48c316d6585c3f54  src/mcp/host-application-ports.ts
bb0a5d610d164b3c4d43c0ccd779921bca073c3cd9725529c72ce59846066594  src/mcp/host-error-mapping.ts
fd87aead27542881fb762fa4188bfc932afaac738e29ab78c7e248697e79776b  src/mcp/index.ts
1e0dc41ba957b8615f8143d165c1bffa79eebd946f77e6e3ffdf4a54ab250ac7  src/mcp/mcp-server.ts
f0d431951318a86d1ba3feef681428431e8fad026d922ee9c147984c703ca0e6  src/mcp/registry-view.ts
8a34ce53223067abb2a14bd7469589f7a2cf2005ea88a118350b1a185128fc83  src/mcp/stdio-main.ts
070e096f3f000cf21ecb0b2cd0cfdf8fcf5fbc8b17b69de32f763a2a9e2f2c2d  src/mcp/tool-schemas.ts
00f2868069d5aa9f01f8ca5f2176963b48adaf5767d1da49d8b6a24a7a37316a  tests/agent-driven/bridge/cursor-events.test.ts
c4c5b2406b67d6f2f01e6783393ca2c56c5597944b6d4377151397df90c1f765  tests/agent-driven/bridge/helpers/cursor-codec.ts
358ed227395587dd1272ba9c90be30ffedd1bcf519c5e988f9847f05fdea0613  tests/agent-driven/bridge/launcher-cold.test.ts
3f73b5b1d8dffb94fb7402b4b741a25b8c36767c3bc9fff41cf760ab21a47302  tests/agent-driven/bridge/mcp-host-client.test.ts
273604c4eec7a10bb71c354dfa47e25ea2ed1d5f1f0e20b8bec23a6a87a62c43  tests/agent-driven/bridge/mcp-registry.test.ts
c5c73b67d7d68a8af73e7d1742b72456a51d3c3cbe6612aae076fb2f30cb69ad  tests/agent-driven/bridge/mcp-stdio-client.test.ts
ae229b365d22bf8c89ba8437735a419371c79ab36f07af12751e3242ec5547ee  tests/agent-driven/bridge/mcp-wrapper-cleanup.test.ts
d874d8b111a9c0d061c8487e62d39fdc5373cadd31c031cfaff96332975931ae  tests/agent-driven/bridge/skill-library.test.ts
4920e19e34be778caf158d308008029379eb7980aa9a8c153161b377337f3527  tools/agent-driven/bridge/probe-mcp.mjs
```

Removed in round 2: `src/host/observability/local-cursor-codec.ts` (moved to
`tests/agent-driven/bridge/helpers/cursor-codec.ts`, rewritten to MAIN's agreed
61-character scheme).
Removed in round 3: `tests/agent-driven/bridge/helpers/long-lived-child.mjs` (the
arbitrary entry override it existed for is gone).

## Tests written — all NOT_RUN

| file | case | what it covers |
|---|---|---|
| `launcher-cold.test.ts` | A-COLD | cold start, duplicate start (sequential and concurrent), shared attach and the refusal to stop it, owned stop and reopen with the next generation, detach-without-stop, the health TTL boundary (14999 ms fresh, 15000 ms expired), the fail-closed roll-up, the per-instance scoping, the contract `Instance` descriptor |
| `mcp-registry.test.ts` | A-MCP | the exact 24-tool allowlist, no trusted-UI or native-bridge route, each tool's contract input schema, path/query/body building, the error mapping rules, the contract handshake (success, mismatch, injected), the resource input validation, the query-parameter refusal, the configuration failure, the jobs projection, four templates + one concrete resource |
| `mcp-host-client.test.ts` | A-MCP | the Host client's refusals before a request leaves: invalid input, non-loopback and name-based base URLs, credentials/query/fragment/path in the URL, redirects, an unbounded body, and the read-failure versus unknown-write-outcome split |
| `mcp-stdio-client.test.ts` | A-MCP | a **real** SDK `Client` against the **real** façade in a **real** child process over stdio, against a local stand-in Host that records the requests: tool discovery, four templates + one concrete resource, the health resource's contents, the handshake order, a call that reaches the Host, a resource read, an invalid field that never reaches the Host, an unreachable Host, recovery when the Host returns, an unknown tool |
| `mcp-wrapper-cleanup.test.ts` | A-MCP | the **real** SDK client over the **real** wrapper running the **real** stdio server: the handshake completes and the 24 tools are listed (the streams are not corrupted), the wrapper's child is found while it runs, and both are gone after the client disconnects; the Host is untouched |
| `cursor-events.test.ts` | A-EVENTS | the atomic snapshot and its cursor, resuming, `Last-Event-ID` precedence, both cursors verified separately, the four scope mismatches, expiry, tampering, malformation, malformed claims, a broken interval, the retention floor, the refusal-to-code table, the TTL policy, the context identity, and the scan-position rules |
| `skill-library.test.ts` | A-MCP | the skill library describing exactly what the façade exposes |

## Commands actually run in rounds 1–3 (all read-only)

These are superseded for the build and test commands by round 4; the read-only
inspection commands below are still the record of rounds 1–3.

| command | exit | result |
|---|---|---|
| `git -C … rev-parse HEAD` / `git status --porcelain` | 0 | the lane's own commits and working tree, tracked each round |
| `find` / `grep` / `cat` over the contract, the registry, the schema, the existing host code and the installed SDK (read-only, `/mnt/c/workspace/videoworkline/Narralens/node_modules/@modelcontextprotocol/sdk`) | 0 | read for the implementation |
| `python3` cross-check of the registry ↔ `ROUTE_PATH_BINDINGS` ↔ contract schema | 0 | `tools: 24, routes: 31, problems: none` |
| `python3` import/export cross-check of every lane module and test | 0 | `no problems` — and it found two real defects: the observability modules imported `../../../contracts/…` instead of `../../contracts/…` (rounds 2 and 3), which would not have resolved. Both fixed |
| `node --check` on the `.mjs` files (the wrapper, the probe tool) | 0 | syntax ok — those files are outside `tsconfig`'s `include` and are not covered by `tsc --noEmit` |
| `sha256sum` over every new file | 0 | the table above |

No `find /`, no traversal of `/mnt/J/` or any other drive.

### The build and test commands

`pnpm install --offline --frozen-lockfile --ignore-scripts`, `pnpm exec tsc --noEmit`
and `pnpm exec vitest run tests/agent-driven/bridge --maxWorkers=1 --minWorkers=1`
were **NOT_RUN in rounds 1–3** and were **run in round 4**, where they are green.
See "Round 4 — admitted validation" above for the exact commands, exits and logs.
The remaining NOT_RUN items are listed there.

## Dependencies and policy injection

What the lane modules need from MAIN, and what they deliberately do not decide:

| need | supplied by MAIN | where it is injected |
|---|---|---|
| Host address and credentials | MAIN | `NARRALENS_HOST_URL`, `NARRALENS_HOST_TOKEN`, or `createHostApplicationPorts`'s options; the address must be a loopback literal — the client refuses a host name |
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

1. **Only the lane has been exercised.** The install, the type-check and the
   bridge suite ran in this lane and are green (round 4). Nothing outside the lane
   was run: no real Host, no ffmpeg, no browser, no full suite, no other lane's
   tests.
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
8. **The wrapper has no configuration hook left.** It always starts the real
   server, and the Host address comes from the environment like any other
   configuration. The lane's own case exercises it through the real path.
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

**Module-level only, with the lane's own validation green.** A-COLD, A-MCP and
A-EVENTS are covered by cases that ran and passed in this lane (round 4: 7 files,
108 tests, exit 0; `tsc --noEmit` exit 0). What that is: the lane's modules behave as
the frozen contract specifies, checked against the frozen runtime schema/registry and explicit test cases with small local
stand-ins.

What it is **not**: this is not a production Host PASS, not an integration PASS, not
a cross-lane or full-suite PASS, not an independent external review and not a human
acceptance. The real Host, its registration and authentication, the production
cursor keys and their rotation, the durable cursor store, media/render/delivery,
Chrome, the production build, the full repository suite, an external MCP client and
the human gate all remain NOT_RUN.

Independent review: REVIEW_PENDING. REVIEW-1 and REVIEW-2 were code-reading reviews
by the lane owner, not independent external reviews. Production assembly and human
acceptance: NOT_RUN.

Next allowed action: Codex independently rechecks the frozen source and the round-4
evidence. The source writer is stopped; this session does not write again unless
Codex hands it back.

## Codex review 2
review1 exec63426 exit0, old PID3563078 terminal; source review still NEEDS_WORK. Focused corrections in REVIEW-2.md. PRODUCT holds light slot; BRIDGE source-only. Codex freezing review1 candidate before returning sole writer to Claude.

## Validation admission
MAIN BRIDGE-light formally admitted after MAIN exec64238 terminal; source review2 exec78749 terminal, clean HEAD1d60ff9ed22851d2647e81a840b5f2af65aa3427. Transfer same Claude sole writer to execute VALIDATION-TASK.md. No final acceptance until author ends and Codex independently rechecks frozen source.

## Round 4 close — writer stopped
Claude session d94ac073-b5b8-42c6-9b4d-f0eef57d7850 finished the admitted
validation and stopped. Final state: offline frozen install with `--ignore-scripts`
exit 0; `pnpm exec tsc --noEmit` exit 0 (twice, after the fixes); the bridge suite
green at 7 files / 108 tests, exit 0, run last as evidence 08. The first failing run
(evidence 03, exit 1, 104/108) is preserved and was fixed in the lane's own test
fixtures and timing bounds only — no production source change was needed for it.
Working tree: `docs/parallel/lane-bridge/HANDOFF.md` plus the three lane test files
modified, `docs/parallel/lane-bridge/evidence/` added; `node_modules/` is ignored and
was not committed; nothing outside the allowed prefixes was written; no commit was
made. No orphan test processes remain. Codex recheck is next; this writer does not
write again unless it is handed back.

## Codex acceptance transfer (actual)
Validation exec44062 exit0; Claude PID3614630 and immediate children absent. Initial37149, review1 63426, review2 78749 all terminal; no429. Single writer now Codex for documents/acceptance only. Production source unchanged in validation; test fixture and explicit stdio bound fixes frozen next. Original first FAIL03 retained. MAIN slot remains BRIDGE-light for one final Codex independent frozen tsc+108 tests, then release.


## Final Codex recheck and handoff

Source/test freeze: `a325f9483cb5106aeb829121fc20ac34496e34e3`. Claude validation exec44062 exited0 and PID3614630/children are terminal; no429 occurred. Codex independently ran the frozen tree: `pnpm exec tsc --noEmit` exit0; `pnpm exec vitest run tests/agent-driven/bridge --maxWorkers=1 --minWorkers=1` exit0, **7 files / 108 tests PASS**, 91.80s, exec36533 terminal. Evidence09/10 binds that SHA; original FAIL03 remains. No production source changed during validation; fixture correction and dedicated stdio subprocess timeout were reviewed. Acceptance metadata in MODULE-ACCEPTANCE.json. Node v22.22.1, pnpm10.33.0, SDK1.26.0, TS5.9.2, Vitest3.2.4.

BRIDGE-light released to MAIN after recheck, no observed lane test/stdio remnants; subsequent work here is documentation only. Code can be cherry-picked from this branch after MAIN review. Docs/evidence-only follow-up commit does not alter tested production/test bytes. No package, lock, public contract, DB, protected core or other-lane file changed.

Consumption: `src/launcher/index.ts` exposes supervisor and health pure ports; `src/mcp/index.ts` exposes createMcpServer(ApplicationPorts)/createHostApplicationPorts(local HTTP); `src/mcp/stdio-main.ts` and `skills/narralens/bin/narralens-mcp.mjs` are real SDK stdio entrypoints; `src/host/observability/index.ts` exposes snapshot/projection/cursor APIs. Set NARRALENS_HOST_URL and token from MAIN trusted configuration; NARRALENS_FILTER_DIGEST is MAIN policy. MAIN alone registers Host HTTP and injects real auth/persistence/process capabilities.

Module checks pass. Actual A-COLD/A-MCP/A-EVENTS production chains, real Codex/Claude/DSH clients, real Host, whole-suite/build/media/native acknowledgement, external independent review and human gate remain NOT_RUN/REVIEW_PENDING. No A phase or B release is implied.
