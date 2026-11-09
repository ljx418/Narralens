import type { Delivery, DeliveryManifest, Ref } from "../../contracts/agent-driven-types.js";
import { buildDelivery, DeliveryContractError } from "./manifest.js";
import { openDeliveryDownload, type DownloadRequest, type DownloadResponse } from "./download.js";
import type { PublishedPackageStore } from "./published-package-store.js";

/**
 * The delivery read model.
 *
 * Reading a delivery never renders anything and never publishes anything. The contract
 * says so directly, and the reason is practical: a read that re-rendered would turn a
 * page refresh into a twenty-minute job, and a read that published would let a caller
 * decide what a delivery is by asking for it twice.
 *
 * The durable facts are MAIN's. This service reads them, checks the one thing it can
 * check on its own — that a delivery recorded as ready really has a published package
 * — and projects them onto the contract's `Delivery` DTO.
 *
 * A download is a read of bytes, and it is held to the same rule. The bytes are served
 * only when MAIN's durable record says the delivery is ready, says it is this download
 * reference, and describes exactly the manifest that was published. A package that is
 * on the disk but was never recorded — the state a crash between the publish and the
 * record leaves — is not served: a deterministic reference would otherwise let anyone
 * who guessed it fetch a delivery that does not exist.
 */

/** The durable delivery record, as MAIN holds it. */
export interface DeliveryRecord {
  readonly project_id: string;
  readonly job_id: string;
  readonly snapshot_id: string;
  readonly state: "preparing" | "blocked" | "ready" | "failed";
  readonly qc: "pending" | "passed" | "blocked";
  readonly artifact_ref: Ref | null;
  readonly download_ref: string | null;
  readonly manifest: DeliveryManifest | null;
}

/** MAIN's read port for the delivery record. */
export interface DeliveryRecordPort {
  /** The record for one job of one project, or null when there is none. */
  readDelivery(input: { readonly project_id: string; readonly job_id: string }): Promise<DeliveryRecord | null>;
}

/**
 * Whether two manifests describe the same delivery.
 *
 * The record and the published package have to agree on everything that identifies the
 * bytes: the delivery, the film, the source, the configuration, the attempt and the
 * media itself.
 */
export function sameDelivery(recorded: DeliveryManifest, published: DeliveryManifest): boolean {
  return recorded.delivery_id === published.delivery_id
    && recorded.project_id === published.project_id
    && recorded.snapshot_id === published.snapshot_id
    && recorded.source_digest === published.source_digest
    && recorded.render_config_digest === published.render_config_digest
    && recorded.attempt === published.attempt
    && recorded.download_ref === published.download_ref
    && recorded.media_ref.id === published.media_ref.id
    && recorded.media_ref.sha256 === published.media_ref.sha256;
}

export class DeliveryService {
  readonly #records: DeliveryRecordPort;
  readonly #packages: PublishedPackageStore;

  constructor(deps: { readonly records: DeliveryRecordPort; readonly packages: PublishedPackageStore }) {
    this.#records = deps.records;
    this.#packages = deps.packages;
  }

  /**
   * Read a delivery.
   *
   * A delivery that is recorded as ready but whose package is not published is a
   * contradiction, and it is reported as one. Answering "ready" would send a client
   * to a download that cannot be served; answering "failed" would be a guess about
   * what happened to the package.
   */
  async read(input: { readonly project_id: string; readonly job_id: string }): Promise<Delivery | null> {
    const record = await this.#records.readDelivery(input);
    if (record === null) return null;
    if (record.project_id !== input.project_id) return null;

    if (record.state === "ready") {
      if (record.manifest === null || record.download_ref === null || record.artifact_ref === null) {
        throw new DeliveryContractError("Delivery", "the delivery is recorded as ready but has no manifest, artifact or download reference");
      }
      const resolved = await this.#packages.resolveDownloadRef(record.download_ref, record.project_id);
      if (resolved === null) {
        throw new DeliveryContractError("Delivery", "the delivery is recorded as ready but its package is not published");
      }
      if (!sameDelivery(record.manifest, resolved.receipt.manifest)) {
        throw new DeliveryContractError("Delivery", "the delivery is recorded as ready but the published package describes something else");
      }
    }

    return buildDelivery({
      project_id: record.project_id,
      snapshot_id: record.snapshot_id,
      job_id: record.job_id,
      state: record.state,
      artifact_ref: record.artifact_ref,
      qc: record.qc,
      download_ref: record.download_ref,
      manifest: record.manifest,
    });
  }

  /**
   * Open the download of a published delivery.
   *
   * MAIN's record has to say that the delivery is ready and that this is its download
   * reference, and the published package has to be the one the record describes. The
   * bytes are served from a descriptor that was hashed before a byte of it was sent.
   */
  async download(request: DownloadRequest): Promise<DownloadResponse | null> {
    const record = await this.#records.readDelivery({
      project_id: request.project_id,
      job_id: request.job_id,
    });
    if (record === null) return null;
    if (record.state !== "ready" || record.qc !== "passed") return null;
    if (record.download_ref !== request.download_ref) return null;
    if (record.manifest === null) return null;

    const resolved = await this.#packages.resolveDownloadRef(request.download_ref, request.project_id);
    if (resolved === null) return null;
    if (!sameDelivery(record.manifest, resolved.receipt.manifest)) return null;

    return await openDeliveryDownload(this.#packages, request);
  }
}
