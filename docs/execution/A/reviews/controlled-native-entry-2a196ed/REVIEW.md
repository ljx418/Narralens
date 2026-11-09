# Independent frozen native-entry verification

**PASS — limited controlled native-entry read chain at `2a196ed943acc4dab8d868f95f5d0a535332f957`.** CNE-R1 is closed within this chain by repaired source, independent positive controls and two targeted regression mutations. This does not sign NativeAck, completed film, managed native writes, producer execution, full A05/A, comprehensive security or human acceptance.

## Exact input and independence

Reviewer used a new `git archive` of the exact commit in own `var/independent-native-entry-2a196ed/source`; MAIN source and index were never modified. Archive preparation exec33403 exited0. At capture MAIN HEAD was exact and status empty. The final MAIN observation also records exact HEAD and empty status; all validation used the archive regardless of subsequent MAIN work.

Final evidence manifest: **24 source hashes + 63 artifact hashes = 87 matching entries**, recorded in `manifest-check.json`. All **6,384 original archived files** retained their original SHA256 after build, tests and restored mutations (`archive-final-check.json`: changed=[]). `package.json`, lockfile and static generated validator bytes are included. Fixed vendor was `e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3`, tracked-clean when inspected. Source/contract tests use the pinned actual vendor and isolated runtime roots, not an imitation Studio.

## Actual sequential commands and results

Execution handle **50181** reached terminal exit0. Each step has its exact argv/cwd/environment in `<step>.cmd.json`, raw stdout/stderr and `<step>.exit`.

| Step | Actual result |
|---|---|
| `corepack pnpm install --offline --frozen-lockfile --ignore-scripts` | exit0, own node_modules, downloaded0; 25.33s runner duration |
| `corepack pnpm exec tsc --noEmit` | exit0; 17.06s |
| `corepack pnpm build` | exit0; 6.48s; six independent dist files hashed |
| Specified four-file Vitest command, `--maxWorkers=1 --minWorkers=1` | exit0, **4 files / 9 tests**, Vitest45.72s, runner49.11s |
| `corepack pnpm exec tsx tools/check-native-session-mutations.mts <own output>` | exit0, two expected assertion failures from injected regressions, source restored; 10.77s |

`COREPACK_ENABLE_NETWORK=0` and `CI=1` were set. Mutation subprocesses run one test file sequentially under the frozen config's maxWorkers1. The mutation checker deliberately edits only the independent archive's controlled-access file and restores exact original bytes; this is not described as immutable for the whole run. Each injected CNE-REUSE / CNE-RECLAIM regression produced exit1 with the expected `503` versus `200` assertion. Both original production behavior and regression rejection were observed. The original MAIN remains untouched.

## What the passed chain establishes

- Component transport: 80 same-scope reopens retain the same proof/readtoken/cookie and usable existing tab; 64 inactive scopes are reclaimed and a fresh scope works while the old token remains stale. Exact reuse includes owner session, project/native ID, generation and commit tuple. A different current prepared copy/native ID is rejected by the real Host integration; stable same-scope reuse does not erase that isolation.
- Real Host and real isolated Studio: owner/committed project open, scoped native API, film assets and panel reads; one-use ticket, cookie-only/cross-origin refusal, foreign project refusal, no readtoken upgrade to general API authority, raw native writes403, actual owner revocation, original author bytes/active commit unchanged.
- Physical child liveness: closing the actual child invalidates old native access before networking. Replacement closes both old privileged Gateway listeners, creates a live new child/Gateway and leaves the active commit unchanged. Source inspection ties the grant to the actual child process start identity and live Host generation, owner and issued workspace object.
- Actual headless **Chrome/156.0.8078.80**, fixed muted launch: original editor, timeline and existing M5 panel in one page, cleared ticket fragment, no fabricated proxies/selection, API access, delegated project WebSocket, refresh preserving proof, and actual cookie delivery to another loopback port without access to origin sessionStorage/protected API. Screenshot independently viewed by reviewer; empty zero-frame draft and “原生版本待确认” are visible.
- Static browser validators match the frozen created/legacy schemas and reject unknown fields/invalid values without eval/Function compilation. Browser capture records zero uncaught exceptions. The test-owned deny proxy recorded **18 rejected external attempts**; this is a blocked-attempt observation, not a claim that the browser attempted no external traffic.

## Derived output and limits

Build output is independent archive `dist/` (`dist-hashes.json`). The test created one new capture directory, `controlled-native-headless-1794266756645`, inside the archive; both files were copied byte-for-byte to `generated-headless/` and hashed (`generated-headless-hashes.json`). Screenshot SHA256 `50e28f4b2f8d01728a72bbca82deea28c5af5019f754c8058de8e6749f4de3cb`; observation SHA256 `efbb8bf989ebf437a33e2f96e1df90666088bd0eb5976b6c840ca746468dde5b`. Thus node_modules/dist/browser capture and temporary mutations are explicitly derived output, not a claim of whole-run clean archive state.

NativeAck stays **unknown**, acknowledgement table stays empty, panel phase is “尚未开始制作；原生版本待确认”, and this zero-frame fixture is not an authorized completed film. No public write workflow, assembly/adoption/Delivery, complete recovery suite, full A regression or human check was run. No additional unresolved defect was found in the specified frozen chain. Full security/race coverage is not implied by these nine cases.

All tests/build/browser/mutation handles are terminal. Resource release was explicitly sent to MAIN after exec50181 exited; only own documentation/hash work followed.
