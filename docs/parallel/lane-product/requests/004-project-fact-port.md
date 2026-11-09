# MAIN integration request 004 — the mandatory project fact port

Status: PRODUCT lane, session `4548ddcb-e870-405b-863f-a17a4a7ed683`. Base/contract
`ca5b67a8285b130c79055317c6202f73cfbb99c8`. Written during SOURCE REPAIR batch 1.

Companions: `requests/001-repository-and-mounts.md`,
`requests/002-exact-record-mapping.md`, `requests/003-idempotency-scope-and-route-ownership.md`
(which now records MAIN's **final** decisions, not questions).

---

## 1. What the lane cannot verify by itself

Preparing a run binds the content decision, the creative closure, the resolved inputs and
the fixed template. Three of the facts that decision depends on are not the lane's:

- **does the project exist**, and which revision, control revision, source digest and
  snapshot does it have;
- **is the brief's local material strategy actually licensed** for this project — writing
  `rights_refs` into a brief does not make the material authorized;
- **is the registered capability available**, and under which fingerprint.

The lane refuses to guess them and refuses to take the client's word for them. It asks
MAIN through a read-only port, and when the port is absent it **fails closed**: the
preparation raises `CAPABILITY_UNAVAILABLE` and nothing is prepared.

An optional port would turn "the facts are unknown" into "the facts are fine", which is
exactly the failure the contract keeps naming.

## 2. The exact port

The port is defined in `src/host/creative/product-facts.ts`:

```ts
export interface ProductProjectFacts {
  readonly project_id: string;
  readonly exists: boolean;
  readonly project_revision: number;
  readonly control_revision: number;
  readonly source_digest: string;
  readonly snapshot_id: string;
  readonly rights_authorized: boolean;
  readonly rights_reason: string;
  readonly capability_available: boolean;
  readonly capability_reason: string;
}

export interface ProductFactPort {
  readProjectFacts(projectId: string): Promise<ProductProjectFacts>;
}
```

MAIN injects it into `FixedWorkflowService`:

```ts
const workflow = new FixedWorkflowService({
  repository,          // MAIN's ProductRepository adapter
  adoption,            // MAIN's trusted adoption authority
  facts,               // MAIN's project fact port  ← this request
  now,                 // optional clock, for tests
});
```

## 3. What the lane does with each fact

| Fact | How the lane uses it |
| --- | --- |
| `exists` | a run cannot be prepared for a project that does not exist (`NOT_FOUND`) |
| `project_revision`, `control_revision` | carried into the adoption's approval as the base and control revision of the change |
| `source_digest` | the digest the adoption's impact has to match |
| `snapshot_id` | the snapshot the adoption's impact targets |
| `rights_authorized` | an unlicensed material strategy stops the preparation (`IMPACT_STALE`) |
| `capability_available` | an unavailable capability stops the preparation (`CAPABILITY_UNAVAILABLE`) |
| `rights_reason`, `capability_reason` | carried in the error details, so the operator sees why |

The port is **read-only**. It is not a second write path, not a second fact store and not
a second bootstrap. It answers questions about MAIN's own facts.

## 4. What MAIN has to do

- [ ] Implement `ProductFactPort` over MAIN's authoritative project state, its rights
      ledger and its capability registry.
- [ ] Answer the six facts from **one** consistent read, so the lane never sees a project
      that exists in one table and not in another.
- [ ] Inject it into `FixedWorkflowService`. Without it the lane refuses to prepare a run,
      which is the intended behaviour and not an accident.
- [ ] Keep the port read-only. The lane writes through `ProductRepository` and through the
      trusted adoption authority; nothing else may write.

## 5. One formula the lane owns and MAIN has to match

The lane recomputes the style digest rather than trusting the client's:

```
style_digest = SHA-256(canonicalJson({
  style_id, version, visual_direction, voice_direction, subtitle_direction
}))
```

The canonical JSON is the restricted JCS of `src/host/creative/digest.ts`: ASCII object
keys sorted by UTF-16 code unit, no whitespace, UTF-8, arrays in order, safe integers
only.

If MAIN's brief writer computes the style digest differently, MAIN's briefs are refused by
the lane with `INVALID_REQUEST`. If MAIN prefers a different formula, the lane changes
`styleDigest` in one place — but the two have to agree, and the frozen contract does not
fix the formula, so this is the lane's proposal rather than a frozen rule.

## 6. What else MAIN already decided

`requests/003` records the final decisions, so they are not repeated here:

- the pre-project idempotency namespace is the existing `operation_idempotency` table with
  `project_id = 'principal:' + <authenticated principal>` before the project exists and the
  real project id afterwards, `operation_kind = 'agent.v1:' + <operation>`, the receipt and
  the original response in the same transaction, and no new ledger;
- the seven sensitive `businessProducer` registry entries stay MAIN's; PRODUCT supplies
  pure domain helpers, MAIN verifies the trusted channel, the principal and the
  currentness and injects the authority inside the same transaction, and the Coordinator
  consumes the adoption approval in the final commit;
- `intake.confirm` stays MAIN's trusted-UI entry;
- the gates live in `checkpoint_json`, the `ReviewPackage` body in an artifact version, the
  wire `plan_sha256` maps to `action_digest`, and the non-run events reach the outbox only;
- the bootstrap command lifecycle state is MAIN's dedicated service; the lane's surface is
  the initial append-only reservation and the read.


## MAIN disposition after stable batch (2026-11-09)
The style preimage in §5 is accepted: exact original strings, no implicit trim/translation/Unicode normalization. Server recomputes before authorization/real execution; schema example placeholder hashes are not semantic proof. PRODUCT must preserve a real golden and a single-field mutation negative.

`readProjectFacts(projectId)` is candidate preparation pre-read only. It is NOT sufficient for final side-effect authorization. MAIN binds actual action, specific input refs/assets/rights, capability fingerprint, and committed snapshot for render, then rechecks current durable grant/attempt/gates/source/rights/locks inside project serialization. Render already bound to an immutable committed snapshot must neither rebind to later project revision nor be cancelled as stale merely because project advanced. Adoption/apply must strictly match current base. MAIN owns actual dispatcher/Coordinator checks; generic booleans in this port do not replace them. No new schema or arbitrary capability claim is authorized.
