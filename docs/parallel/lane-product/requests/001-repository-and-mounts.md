# MAIN integration request 001
Production modules will export `CreativeService` and `FixedWorkflowService` with injected `ProductRepository` from src/host/creative/product-repository.ts. No own DB/memory fallback. Please implement persistent adapter against MAIN database and register the frozen ApplicationPorts routes.

Proposed exact atomic port:
```ts
interface ProductTransaction {
 get<T>(collection: string, id: string): T | null;
 list<T>(collection: string): T[];
 put<T>(collection: string, id: string, value: T): void;
}
interface ProductRepository { transaction<T>(work: (tx: ProductTransaction) => T): Promise<T>; }
```
Collection names namespaced product.*; MAIN adapter must serialize transaction + persist records and idempotency receipts atomically, rollback on throw; sync callback contains no await. This is a typed opaque JSON repository seam, not a second fact store. Fail closed if adapter unavailable; collection record shapes exported by lane. Intake/decision/artifact/run/review entities and idempotency all stored via this port. MAIN may map records to existing tables; if requiring alternate precise port, reply before integration.

Trusted channel context must be supplied by authenticated HTTP dispatcher, never body `meta` or relay text: principalId, channel (authenticated/trusted_ui), source (agent_conversation/driver_relay/trusted_ui). Adoption: inject atomic trusted approval callback only if MAIN can join review transaction; absent capability must reject accept_and_adopt, never fake approval. Please specify ready adopt seam.

M5 mount: new WorkflowTopBar, SystemControlPanel and CreativeReviewPanel exports receive DTO state/callbacks; MAIN mounts in original shell and retains native selection/clock. System lifecycle actions receive MAIN-owned callbacks, never component command execution. Workflow/review reads via existing frozen route IDs. A models remain unsupported/unverified, no mutation controls.
