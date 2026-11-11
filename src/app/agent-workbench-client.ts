import type {
  Context,
  HealthRead,
  Meta,
  ReviewDecision,
  ReviewPackage,
  ReviewPart,
  Workflow,
} from "../contracts/agent-driven-types.js";
// MEDIA owns the preview receipt, the media facts and the descriptor. They are consumed
// here as they are: this client does not define a second copy of that protocol.
import type {
  PreparedPreviewMediaFactsV1,
  PreviewMediaDescriptorV1,
} from "../host/render/assembly-ports.js";
import { GatewayApiError } from "./m5/GatewayApiClient.js";

/**
 * The workbench's client for the agent surface (CR-R1-001 §3).
 *
 * It speaks the *closed* workbench RPC: a surface, an operation and the original input
 * DTO. It never invents a request, never drops a field before the Host's own validator
 * sees it, and never treats a missing producer as an available one.
 *
 * Two rules shape it:
 *
 * - **The project is fixed.** Every call is made for one project, and the Host's own
 *   delegate checks it again. A body that names another project is refused before it
 *   leaves.
 * - **An unknown result stays unknown.** A 503 is a missing producer, not a failure and
 *   not a success, and the caller keeps its request key so it can reconcile the same
 *   key instead of issuing a new one.
 *
 * The local-asset runtime DTO and its validator belong to BRIDGE; this client sends the
 * registration fields exactly and returns what the Host answered, without copying that
 * protocol into a second one here.
 */

/** The three closed surfaces. */
export type AgentWorkbenchSurface = "agent.v1" | "local-assets.v1" | "workbench.v1";

/** The transport this client speaks over: one closed call. */
export interface WorkbenchUiTransport {
  call(surface: string, operation: string, input: unknown): Promise<unknown>;
}

/** The frozen source kinds. */
export type LocalAssetSourceKind = "owned" | "generated" | "licensed";

/** The frozen licence statuses. */
export type LocalAssetLicenseStatus = "cleared" | "restricted" | "unknown";

export interface LocalAssetSource {
  readonly kind: LocalAssetSourceKind;
  readonly label: string;
}

export interface LocalAssetLicense {
  readonly status: LocalAssetLicenseStatus;
  readonly label: string;
  readonly commercial_use: boolean;
}

/**
 * The registration request a local asset is declared with.
 *
 * Exactly the declaration: the project, the candidate, the source, the licence and the
 * recording origin. No relative path, no expected digest, no attestation reference.
 */
export interface LocalAssetRegistrationRequest {
  readonly project_id: string;
  readonly candidate_id: string;
  readonly source: LocalAssetSource;
  readonly license: LocalAssetLicense;
  readonly recording_origin: string;
}

/** The five part kinds of a review package: the frozen contract's own union. */
export type ReviewPartKind = ReviewPart["kind"];

/** The exact input of `workbench.v1/review.part.describe`. */
export interface ReviewPartDescribeInput {
  readonly run_id: string;
  readonly package_id: string;
  readonly package_version: number;
  readonly part_kind: ReviewPartKind;
  readonly artifact_ref: { readonly id: string; readonly version: number; readonly sha256: string };
}

/**
 * The descriptor of one prepared artifact (CR-R1-001 §8).
 *
 * It is MEDIA's own type, and it is the only thing that may authorize a preview: the
 * bytes are checked against it before anything is shown.
 */
export type { PreviewMediaDescriptorV1, PreparedPreviewMediaFactsV1 };

/** A failure that is not a failure of the call, but a missing producer. */
export function isUnavailable(reason: unknown): boolean {
  return reason instanceof GatewayApiError && reason.status === 503;
}

/** The reason a call could not be made, told truthfully. */
export function unavailableReason(reason: unknown): string {
  if (reason instanceof GatewayApiError) return reason.message;
  return "工作台观察暂不可用。";
}

export class AgentWorkbenchClient {
  constructor(private readonly transport: WorkbenchUiTransport, readonly projectId: string) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(projectId)) throw new Error("INVALID_PROJECT_ID");
  }

  async #call<T>(surface: AgentWorkbenchSurface, operation: string, input: unknown): Promise<T> {
    const body = await this.transport.call(surface, operation, input);
    return body as T;
  }

  /** The project's current context. */
  async readContext(): Promise<Context> {
    const value = await this.#call<unknown>("agent.v1", "context.read", { project_id: this.projectId });
    if (!isRecord(value) || value.project_id !== this.projectId) throw new Error("INVALID_CONTEXT");
    return value as unknown as Context;
  }

  /** The project's workflow. */
  async readWorkflow(): Promise<Workflow> {
    const value = await this.#call<unknown>("agent.v1", "workflow.read", { project_id: this.projectId });
    if (!isRecord(value) || value.project_id !== this.projectId || !Array.isArray(value.nodes)) {
      throw new Error("INVALID_WORKFLOW");
    }
    return value as unknown as Workflow;
  }

  /** One review package of the project's current run. */
  async readReview(runId: string, packageId: string): Promise<ReviewPackage> {
    const value = await this.#call<unknown>("agent.v1", "review.read", {
      project_id: this.projectId, run_id: runId, package_id: packageId,
    });
    if (!isRecord(value) || value.project_id !== this.projectId || value.run_id !== runId) {
      throw new Error("INVALID_REVIEW_PACKAGE");
    }
    return value as unknown as ReviewPackage;
  }

  /**
   * Record one decision about a package.
   *
   * The decision is a *decision*. It is not a commit and not a native acknowledgement:
   * the answer says the decision was recorded, and nothing more.
   */
  async decideReview(input: {
    readonly meta: Meta;
    readonly package: ReviewPackage;
    readonly choice: "accept" | "changes_requested" | "reject" | "accept_and_adopt";
    readonly impact_id?: string | null;
    readonly plan_sha256?: string | null;
  }): Promise<ReviewDecision> {
    const document = input.package;
    const value = await this.#call<unknown>("agent.v1", "review.decide", {
      meta: input.meta,
      project_id: document.project_id,
      run_id: document.run_id,
      package_id: document.package_id,
      package_version: document.version,
      plan_version: document.plan_version,
      input_digest: document.input_digest,
      output_digest: document.output_digest,
      quality_digest: document.quality_digest,
      choice: input.choice,
      impact_id: input.impact_id ?? document.impact?.impact_id ?? null,
      plan_sha256: input.plan_sha256 ?? document.impact?.plan_sha256 ?? null,
    });
    if (!isRecord(value) || value.package_id !== document.package_id) throw new Error("INVALID_REVIEW_DECISION");
    return value as unknown as ReviewDecision;
  }

  /** The service health. A stale or missing sample is unknown, not ready. */
  async readHealth(): Promise<HealthRead> {
    const value = await this.#call<unknown>("agent.v1", "health.read", null);
    if (!isRecord(value) || !Array.isArray(value.services)) throw new Error("INVALID_HEALTH");
    return value as unknown as HealthRead;
  }

  /** The controlled local-source candidates the operator may declare. */
  async readLocalSourceFiles(): Promise<unknown> {
    return await this.#call<unknown>("local-assets.v1", "local-source-files.read", { project_id: this.projectId });
  }

  /**
   * Register one declared local asset.
   *
   * The request carries exactly the declaration: the candidate, the source, the licence
   * and the recording origin. It never carries a relative path, an expected digest or
   * an attestation reference — the Host owns those.
   */
  async importLocalAsset(request: LocalAssetRegistrationRequest): Promise<unknown> {
    if (request.project_id !== this.projectId) throw new Error("PROJECT_MISMATCH");
    return await this.#call<unknown>("local-assets.v1", "local-assets.import", {
      project_id: request.project_id,
      candidate_id: request.candidate_id,
      source: { kind: request.source.kind, label: request.source.label },
      license: {
        status: request.license.status,
        label: request.license.label,
        commercial_use: request.license.commercial_use,
      },
      recording_origin: request.recording_origin,
    });
  }

  /** The registered local assets of this project. */
  async readLocalAssets(): Promise<unknown> {
    return await this.#call<unknown>("local-assets.v1", "local-assets.read.ui", { project_id: this.projectId });
  }

  /** The asset inventory the Agent sees — the same inventory, read by id. */
  async readAssetInventory(): Promise<unknown> {
    return await this.#call<unknown>("local-assets.v1", "asset-inventory.read", { project_id: this.projectId });
  }

  /**
   * Re-open the native view for this project.
   *
   * The input is exactly empty: the project comes from the delegate, and the call
   * returns the Host's own validated native entry. It grants no native write.
   */
  async reopenNative(): Promise<unknown> {
    return await this.#call<unknown>("workbench.v1", "native.reopen", {});
  }

  /**
   * Describe one prepared part.
   *
   * The input is exact, and the answer is the descriptor that may authorize a preview.
   */
  async describePart(input: ReviewPartDescribeInput): Promise<PreviewMediaDescriptorV1> {
    const value = await this.#call<unknown>("workbench.v1", "review.part.describe", {
      run_id: input.run_id,
      package_id: input.package_id,
      package_version: input.package_version,
      part_kind: input.part_kind,
      artifact_ref: {
        id: input.artifact_ref.id,
        version: input.artifact_ref.version,
        sha256: input.artifact_ref.sha256,
      },
    });
    if (!isRecord(value) || value.format !== "narralens.review-media-descriptor@1") {
      throw new Error("INVALID_MEDIA_DESCRIPTOR");
    }
    return value as unknown as PreviewMediaDescriptorV1;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** One controlled candidate the panel may offer. */
export interface LocalAssetCandidate {
  readonly candidate_id: string;
  readonly label: string;
  readonly detail?: string;
}

/** One registered asset, as the inventory reports it. */
export interface LocalAssetInventoryItem {
  readonly asset_id: string;
  readonly label: string;
  readonly source_label?: string;
  readonly license_label?: string;
  readonly recording_origin?: string;
  readonly eligible?: boolean;
}

/**
 * The controlled candidates, as far as they can be read.
 *
 * The runtime DTO belongs to BRIDGE. This reads the two fields the panel needs and
 * ignores whatever it does not understand, so a shape it does not know shows nothing
 * rather than something invented.
 */
export function readCandidates(value: unknown): LocalAssetCandidate[] {
  const list = Array.isArray(value) ? value
    : isRecord(value) && Array.isArray(value.candidates) ? value.candidates
      : isRecord(value) && Array.isArray(value.files) ? value.files
        : [];
  const candidates: LocalAssetCandidate[] = [];
  for (const item of list) {
    if (!isRecord(item)) continue;
    const candidate_id = typeof item.candidate_id === "string" ? item.candidate_id
      : typeof item.id === "string" ? item.id : null;
    if (candidate_id === null) continue;
    const label = typeof item.label === "string" ? item.label
      : typeof item.name === "string" ? item.name : candidate_id;
    const detail = typeof item.detail === "string" ? item.detail : undefined;
    candidates.push(detail === undefined ? { candidate_id, label } : { candidate_id, label, detail });
  }
  return candidates;
}

/**
 * The registered assets, read from the frozen inventory shape.
 *
 * The inventory contract is frozen (`contracts/asset-inventory-response.schema.json`),
 * so its fields are read by name. An entry that does not carry an `asset_id` is
 * skipped: the Agent discovers assets by their own id, never by a copied one.
 */
export function readInventoryItems(value: unknown): LocalAssetInventoryItem[] {
  const list = isRecord(value) && Array.isArray(value.assets) ? value.assets : [];
  const items: LocalAssetInventoryItem[] = [];
  for (const item of list) {
    if (!isRecord(item)) continue;
    const asset_id = typeof item.asset_id === "string" ? item.asset_id : null;
    if (asset_id === null) continue;
    const source = isRecord(item.source) && typeof item.source.label === "string" ? item.source.label : undefined;
    const license = isRecord(item.license) && typeof item.license.label === "string" ? item.license.label : undefined;
    const origin = typeof item.recording_origin === "string" ? item.recording_origin : undefined;
    const label = typeof item.label === "string" ? item.label : asset_id;
    const eligible = typeof item.eligible === "boolean" ? item.eligible : undefined;
    items.push({
      asset_id,
      label,
      ...(source === undefined ? {} : { source_label: source }),
      ...(license === undefined ? {} : { license_label: license }),
      ...(origin === undefined ? {} : { recording_origin: origin }),
      ...(eligible === undefined ? {} : { eligible }),
    });
  }
  return items;
}
