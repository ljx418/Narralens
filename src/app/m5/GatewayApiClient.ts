import type {
  ComparisonReplayRequestV1, ComparisonReplayResponseV1, LockCreateRequestV1,
  LockMutationResponseV1, WorkbenchProjectionV1,
} from "../../contracts/wave3-types.js";
import type { HistoryReadModelV1, HistoryIntentResponseV1, ImpactSpecV1 } from "../../contracts/wave2-types.js";

/**
 * The panel's client for the Gateway (Wave 3 `01` §2, `04` §1).
 *
 * The panel lives in the Studio's page, on the Gateway's origin. It never talks to the
 * Narralens Host directly and never holds a Host bearer: the Gateway relays the request
 * inside the Host's own process. So this client is same-origin, cookie-only, and it
 * carries no token at all.
 *
 * Every answer is checked here, so a component never sees a body it cannot trust: the
 * panel draws what the contract allows and nothing else.
 */
export class GatewayApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string,
    readonly details?: Record<string, unknown>) {
    super(message);
  }
}

export interface MaterializationStatus {
  readonly materialization_id?: string;
  readonly job_id?: string;
  readonly state?: string;
  readonly [key: string]: unknown;
}

export class GatewayApiClient {
  constructor(private readonly baseUrl = "") {}

  async #request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      // The Gateway's session cookie is HttpOnly and SameSite=Strict: it is sent because
      // the request is same-origin, and it is the only credential there is.
      credentials: "same-origin",
      headers: { ...init.headers, "content-type": "application/json" },
    });
    const text = await response.text();
    let body: Record<string, unknown> = {};
    if (text !== "") {
      try { body = JSON.parse(text) as Record<string, unknown>; }
      catch { throw new GatewayApiError(response.status, "INVALID_RESPONSE", "本地服务返回了无法读取的响应"); }
    }
    if (!response.ok) {
      throw new GatewayApiError(response.status, String(body.code ?? "UNKNOWN"),
        String(body.message ?? "本地服务请求失败"), body.details as Record<string, unknown> | undefined);
    }
    return body as T;
  }

  workbench(projectId: string): Promise<WorkbenchProjectionV1> {
    return this.#request(`/narralens/api/workbench?project_id=${encodeURIComponent(projectId)}`);
  }

  replay(projectId: string, request: ComparisonReplayRequestV1): Promise<ComparisonReplayResponseV1> {
    return this.#request(`/narralens/api/comparisons/replay?project_id=${encodeURIComponent(projectId)}`,
      { method: "POST", body: JSON.stringify(request) });
  }

  createLock(projectId: string, request: LockCreateRequestV1): Promise<LockMutationResponseV1> {
    return this.#request(`/narralens/api/locks?project_id=${encodeURIComponent(projectId)}`,
      { method: "POST", body: JSON.stringify(request) });
  }

  releaseLock(projectId: string, lockId: string, baseControlRevision: number,
    idempotencyKey: string): Promise<LockMutationResponseV1> {
    return this.#request(
      `/narralens/api/locks/${encodeURIComponent(lockId)}?project_id=${encodeURIComponent(projectId)}`,
      { method: "DELETE", body: JSON.stringify({
        lock_id: lockId, base_control_revision: baseControlRevision, idempotency_key: idempotencyKey,
      }) },
    );
  }

  impact(projectId: string, body: unknown): Promise<ImpactSpecV1> {
    return this.#request(`/narralens/api/impact?project_id=${encodeURIComponent(projectId)}`,
      { method: "POST", body: JSON.stringify(body) });
  }

  materialize(projectId: string, body: unknown): Promise<MaterializationStatus> {
    return this.#request(`/narralens/api/materialize?project_id=${encodeURIComponent(projectId)}`,
      { method: "POST", body: JSON.stringify(body) });
  }

  materialization(materializationId: string, projectId: string): Promise<MaterializationStatus> {
    return this.#request(
      `/narralens/api/materializations/${encodeURIComponent(materializationId)}?project_id=${encodeURIComponent(projectId)}`,
    );
  }

  history(projectId: string): Promise<HistoryReadModelV1> {
    return this.#request(`/narralens/api/history?project_id=${encodeURIComponent(projectId)}`);
  }

  inventory(projectId: string): Promise<{ assets: ReadonlyArray<{
    asset_id: string; duration_frames: number; source_label: string; license_label: string;
    availability: string; eligible: boolean;
  }> }> {
    return this.#request(`/narralens/api/inventory?project_id=${encodeURIComponent(projectId)}`);
  }

  undo(projectId: string): Promise<HistoryIntentResponseV1> {
    return this.#request(`/narralens/api/history/undo?project_id=${encodeURIComponent(projectId)}`,
      { method: "POST", body: "{}" });
  }

  redo(projectId: string): Promise<HistoryIntentResponseV1> {
    return this.#request(`/narralens/api/history/redo?project_id=${encodeURIComponent(projectId)}`,
      { method: "POST", body: "{}" });
  }

  restore(projectId: string, body: unknown): Promise<unknown> {
    return this.#request(`/narralens/api/history/restore?project_id=${encodeURIComponent(projectId)}`,
      { method: "POST", body: JSON.stringify(body) });
  }

  /**
   * A governed native write, addressed by its registry entry id.
   *
   * The Gateway refuses anything the OpenFilm capability map does not report as
   * supported, so the panel never has to know the policy — but the panel still has to
   * ask, and the refusal has to be visible.
   */
  nativeWrite(entryId: string, projectId: string, body: unknown): Promise<unknown> {
    return this.#request(`/narralens/native/${encodeURIComponent(entryId)}`,
      { method: "POST", body: JSON.stringify({ ...(body as Record<string, unknown>), project_id: projectId }) });
  }
}
