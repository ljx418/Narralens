# MAIN integration request 003 — idempotency scope and route ownership

Status: PRODUCT lane, session `4548ddcb-e870-405b-863f-a17a4a7ed683`. Base/contract
`ca5b67a8285b130c79055317c6202f73cfbb99c8`.

**MAIN's decisions on this request are FINAL** (recorded in `22cc663a`, accepted in the
first acceptance intake). This file no longer asks questions; it records the decisions and
what the lane does about them. The one remaining item is `requests/004-project-fact-port.md`.

Companions: `requests/001-repository-and-mounts.md`,
`requests/002-exact-record-mapping.md`, `requests/004-project-fact-port.md`,
`INTEGRATION.md`.

---

## 1. The pre-project idempotency scope — DECIDED

MAIN's decision:

> Existing `operation_idempotency` only: `project_id = principal:<authenticated principal>`
> before project, real `project_id` otherwise; `operation_kind = agent.v1:<operation>`.
> Same transaction stored receipt + response. No new ledger.

What the lane does about it:

- the seam's idempotency scope is a closed union,
  `ProductIdempotencyScope = { kind: "project"; project_id } | { kind: "principal"; principal_id }`;
- `tx.recallIdempotency(scope, operation, key)` and `tx.recordIdempotency(...)` are the only
  two entry points, and both run inside the lane's transaction, so the receipt, the
  records and the outbox event land together or not at all;
- the operation string the lane passes is the plain operation name; MAIN prefixes it with
  `agent.v1:`;
- the pre-project scope is `{ kind: "principal", principal_id }`, and MAIN maps it onto
  `project_id = principal:<principal_id>`;
- the **stored response** is what a replay returns, so a replayed answer keeps its original
  `recorded_at` instead of minting a new one;
- the request digest excludes `meta` (the idempotency key and the correlation id), because
  two requests that differ only in their correlation id are the same request;
- there is no second command ledger, and the lane never writes
  `operation_idempotency` itself.

## 2. Route ownership — DECIDED

MAIN's decision:

> The seven sensitive `businessProducer` registry entries remain MAIN. MAIN verifies
> trusted session/principal/currentness, invokes pure domain helpers and injects authority
> on the same tx; the adoption approval is consumed only by the Coordinator's final
> commit. `intake.confirm` remains MAIN's trusted-UI entry.

What the lane does about it:

- the lane's services are **pure domain helpers**: they take a validated input plus an
  out-of-band caller context and return a validated output, and they never register a
  route, never change the registry and never touch the server;
- the lane does not write the seven sensitive routes' trusted evidence itself. It asks the
  injected `TrustedAdoptionAuthority`, which writes `cp_a0_trusted_confirmation` and
  `cp_a0_approval` **inside the lane's transaction**;
- the lane **checks** what the authority returns — the same project, run, purpose, actor,
  action and window — and refuses the operation when the confirmation says something else;
- when the authority cannot join the transaction, `registerApproval` returns `null` and the
  adoption fails closed with `APPROVAL_REQUIRED`;
- `intake.confirm` is MAIN's trusted-UI entry; the lane exposes
  `CreativeService.confirmIntake`, which writes the `cp_a0_intake_confirmation` row from
  the trusted caller context, and MAIN is the one that authenticates the session;
- the lane never consumes an approval: the Coordinator does that in the final commit, and
  the lane's approval row stays `active` until then.

## 3. The storage decisions — ACCEPTED

MAIN accepted these in the same decision:

| Decision | Where the lane implements it |
| --- | --- |
| the gates live in `checkpoint_json` | `RunCheckpoint.gates` in `src/host/creative/product-repository.ts` |
| the `ReviewPackage` body lives in an artifact version | `cp_a0_artifact_version.content_json`, with `cp_a0_review_request` pointing at it |
| the wire `plan_sha256` maps to `action_digest` | `toWireApproval` in the same file |
| the non-run events reach the outbox only | `ProductEventScope` has a `run`, a `project` and an `intake` variant; only the run variant is mirrored into `cp_a0_event` |
| the bootstrap command lifecycle is MAIN's dedicated service | the lane's surface is the initial append-only reservation and the read; it never advances the lifecycle state |

## 4. What the lane still needs — one item

`requests/004-project-fact-port.md`: MAIN has to implement the mandatory read-only
`ProductFactPort` (`src/host/creative/product-facts.ts`). The lane cannot verify the
project's existence, the material rights or the registered capability on its own, and it
refuses to prepare a run without that port — by design, not by accident.

## 5. The style digest formula — the lane's proposal

The frozen contract says the style digest is recomputed rather than trusted, but it does
not fix the formula. The lane's formula, which MAIN's brief writer has to match, is in
`requests/004` §5 and in `INTEGRATION.md`.
