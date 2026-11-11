import {validateNativeWorkbench,type NativeWorkbenchProjection} from '../../contracts/created-workbench.js';
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

/**
 * Where the transport script keeps this tab's independent UI credential.
 *
 * It is a second purpose with its own proof. It is never the native proof, and it is
 * never derived from it.
 */
export const UI_SESSION_STORAGE_KEY = "narralens.ui.session";

export interface GatewayUiSession {
  readonly csrf: string;
  readonly expires_at: number;
}

/** This tab's UI credential, or `null` when there is none — a native-only entry. */
export function readUiSession(): GatewayUiSession | null {
  try {
    const raw = globalThis.sessionStorage?.getItem(UI_SESSION_STORAGE_KEY);
    if (raw === null || raw === undefined) return null;
    const value = JSON.parse(raw) as { csrf?: unknown; expires_at?: unknown };
    if (typeof value.csrf !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value.csrf)) return null;
    if (typeof value.expires_at !== "number" || value.expires_at <= Date.now()) return null;
    return { csrf: value.csrf, expires_at: value.expires_at };
  } catch { return null; }
}

/** The header that carries the independent UI proof — and nothing else. */
export function uiProofHeaders(): Record<string, string> {
  const session = readUiSession();
  return session === null ? {} : { "X-Narralens-Workbench-CSRF": session.csrf };
}

/** Read one JSON answer, and turn a failure into the Host's own error semantics. */
async function readJsonBody<T>(response: Response): Promise<T> {
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

/** The digest of the bytes, as the lowercase hex the contracts use. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) throw new Error("DIGEST_UNAVAILABLE");
  const digest = await subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
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
    return readJsonBody<T>(response);
  }

  /**
   * One closed workbench UI call.
   *
   * It carries the *independent* UI proof, not the native one: the native proof that
   * rides along on this origin does not make the request a UI request. The Host's own
   * status and body come back untouched, so the caller sees the real error semantics.
   *
   * The call can be aborted: a read that is no longer wanted must not keep a request
   * and a response alive on the wire.
   */
  async uiCall<T>(surface: string, operation: string, input: unknown, signal?: AbortSignal): Promise<T> {
    const response = await fetch(`${this.baseUrl}/narralens/api/ui/call`, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      ...(signal === undefined ? {} : { signal }),
      headers: { ...uiProofHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ surface, operation, input }),
    });
    return readJsonBody<T>(response);
  }

  /**
   * Read one prepared review object.
   *
   * The bytes are returned raw, with the ETag the alias answered: the caller checks
   * them against the descriptor it was given before it shows anything.
   *
   * The read is abortable, so a preview that is abandoned does not keep pulling bytes.
   */
  async reviewMedia(ref: string, signal?: AbortSignal): Promise<{
    readonly bytes: Uint8Array;
    readonly etag: string;
    readonly contentType: string;
  }> {
    const response = await fetch(`${this.baseUrl}/narralens/api/ui/review-media/${encodeURIComponent(ref)}`, {
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      ...(signal === undefined ? {} : { signal }),
      headers: { ...uiProofHeaders() },
    });
    if (!response.ok) {
      const text = await response.text();
      let body: Record<string, unknown> = {};
      try { body = JSON.parse(text) as Record<string, unknown>; } catch { /* the body is not JSON */ }
      throw new GatewayApiError(response.status, String(body.code ?? "UNKNOWN"),
        String(body.message ?? "预览读取失败"), body.details as Record<string, unknown> | undefined);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      bytes,
      etag: response.headers.get("etag") ?? "",
      contentType: response.headers.get("content-type") ?? "",
    };
  }

  async workbench(projectId: string): Promise<NativeWorkbenchProjection> {
    return validateNativeWorkbench(await this.#request(`/narralens/api/workbench?project_id=${encodeURIComponent(projectId)}`));
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
