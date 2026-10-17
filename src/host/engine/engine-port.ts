import type {
  CapabilityMap, EngineProjection, EngineKind, Sha256, TypedEdit,
} from "../../contracts/engine-types.js";

/**
 * EnginePort (`03_M2_M4_MODULE_DESIGN.md` §1.1, `05_API_INTERFACE_SPEC.md` §4).
 *
 * The port exposes exactly seven operations. It has no `commit`, no revision or lock
 * mutation, no binding change and no way to run an arbitrary command, path or URL: the
 * Host owns commit, revision and locks (AC-002). An architecture fitness test parses this
 * file and fails if the member set changes or a forbidden member appears.
 */

/** Opaque server path. Only the Host constructs one; it never appears in a request schema. */
const absoluteServerPathBrand: unique symbol = Symbol("narralens.AbsoluteServerPath");

export interface AbsoluteServerPath {
  readonly [absoluteServerPathBrand]: true;
  readonly value: string;
}

/** Reference to an immutable committed source. M2.2 replaces the digest with a SnapshotStore id. */
export interface SnapshotRef {
  readonly project_id: string;
  readonly source_digest: Sha256;
  readonly engine: EngineKind;
}

export interface ReadContext {
  readonly correlationId: string;
  readonly projectId: string;
  readonly signal: AbortSignal;
}

export interface CommandContext extends ReadContext {
  readonly idempotencyKey: string;
  readonly baseRevision: number;
  readonly expectedSourceDigest: Sha256;
  readonly controlRevision: number;
}

export type StagedSource = Readonly<{
  /** Path under the isolated root the Host allocated for this transaction. */
  readonly isolated_root: AbsoluteServerPath;
  readonly relative_entry: string;
  readonly source_digest: Sha256;
  readonly revision: string;
}>;

/** Internal preimage an engine uses while writing; never a Narralens revision. */
export interface EngineEditPlan {
  readonly engine: EngineKind;
  readonly base_source_digest: Sha256;
  readonly base_revision: number;
  readonly edit: TypedEdit;
  readonly ops: readonly unknown[];
}

export interface ValidationReport {
  readonly ok: boolean;
  readonly problems: readonly string[];
  readonly source_digest: Sha256 | null;
}

export interface PreviewDescriptor {
  readonly kind: "hypit-studio" | "openfilm-studio";
  readonly url: string;
}

export interface RenderProfile {
  readonly profile_id: string;
}

export interface JobRef {
  readonly job_id: string;
}

export interface EnginePort {
  inspect(snapshot: SnapshotRef, ctx: ReadContext): Promise<EngineProjection>;
  capabilities(snapshot: SnapshotRef, ctx: ReadContext): Promise<CapabilityMap>;
  plan(snapshot: SnapshotRef, intent: TypedEdit, ctx: CommandContext): Promise<EngineEditPlan>;
  stage(plan: EngineEditPlan, isolatedRoot: AbsoluteServerPath, ctx: CommandContext): Promise<StagedSource>;
  validate(staged: StagedSource, ctx: CommandContext): Promise<ValidationReport>;
  preview(snapshot: SnapshotRef, ctx: ReadContext): Promise<PreviewDescriptor>;
  render(snapshot: SnapshotRef, profile: RenderProfile, ctx: CommandContext): Promise<JobRef>;
}

/** Host-only constructor for an `AbsoluteServerPath`; adapters can never forge one. */
export function absoluteServerPath(value: string): AbsoluteServerPath {
  return { [absoluteServerPathBrand]: true, value } as AbsoluteServerPath;
}
