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

  /** Open the download of a published delivery. */
  async download(request: DownloadRequest): Promise<DownloadResponse | null> {
    return await openDeliveryDownload(this.#packages, request);
  }
}
