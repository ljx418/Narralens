import {workbenchProofHeaders} from "../../workbench-session.js";
import type { AssetImportMetadata, AssetImportResponse, AssetInventoryResponse, EditRequest, EditResponse, JobEvent, JobResponse, ProjectResponse, ProposalBundle, ProposalComparison, ProposalComparisonRequest } from "../../../contracts/types.js";

export class HostApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

export class HostApiClient {
  #token = "";
  #csrf: string | null = null;
  constructor(private readonly baseUrl = "") {}

  async start(): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/session`, { credentials: "same-origin", headers: workbenchProofHeaders() });
    const body = await response.json() as { token?: string; mode?: string };
    if (!response.ok) throw new HostApiError(response.status, "SESSION_FAILED", "无法建立本地会话");
    if (body.mode === "trusted_ui") {
      const sessionResponse = await fetch(`${this.baseUrl}/api/workbench/session`, { credentials: "same-origin", cache: "no-store", headers: workbenchProofHeaders() });
      const session = await sessionResponse.json() as { csrf?: string };
      if (!sessionResponse.ok || typeof session.csrf !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(session.csrf)) throw new HostApiError(sessionResponse.status, "SESSION_FAILED", "请从本机启动入口重新打开工作台");
      this.#csrf = session.csrf;
      this.#token = "";
    } else if (typeof body.token === "string" && body.token) {
      this.#token = body.token;
      this.#csrf = null;
    } else throw new HostApiError(response.status, "SESSION_FAILED", "无法建立本地会话");
  }

  project(projectId: string): Promise<ProjectResponse> { return this.#get(`/api/projects/${projectId}`); }
  job(jobId: string): Promise<JobResponse> { return this.#get(`/api/jobs/${jobId}`); }
  proposal(proposalId: string): Promise<ProposalBundle> { return this.#get(`/api/proposals/${proposalId}`); }
  comparison(comparisonId: string): Promise<ProposalComparison> { return this.#get(`/api/proposal-comparisons/${comparisonId}`); }
  assets(projectId: string): Promise<AssetInventoryResponse> { return this.#get(`/api/projects/${projectId}/assets`); }
  events(jobId: string, after: number): Promise<JobEvent[]> { return this.#getSse(`/api/jobs/${jobId}/events?after=${after}`); }

  async createProposal(projectId: string, request: ProposalComparisonRequest): Promise<JobResponse> {
    return this.#request(`/api/projects/${projectId}/proposals`, { method: "POST", body: JSON.stringify(request), headers: { "content-type": "application/json" } });
  }

  async edit(projectId: string, request: EditRequest): Promise<EditResponse> {
    return this.#request(`/api/projects/${projectId}/edits`, { method: "POST", body: JSON.stringify(request), headers: { "content-type": "application/json" } });
  }

  async importAsset(projectId: string, file: File, metadata: AssetImportMetadata,
    options: { signal?: AbortSignal; onUploadComplete?: () => void } = {}): Promise<AssetImportResponse> {
    const { boundary, body } = buildAssetImportRequest(file, metadata);
    return await new Promise<AssetImportResponse>((resolvePromise, reject) => {
      const request = new XMLHttpRequest();
      const abort = (): void => request.abort();
      const finish = (): void => options.signal?.removeEventListener("abort", abort);
      request.open("POST", `${this.baseUrl}/api/projects/${projectId}/assets/import`);
      if (this.#csrf !== null) request.setRequestHeader("X-Narralens-CSRF", this.#csrf);
      else request.setRequestHeader("authorization", `Bearer ${this.#token}`);
      request.setRequestHeader("content-type", `multipart/form-data; boundary=${boundary}`);
      request.upload.addEventListener("load", () => options.onUploadComplete?.(), { once: true });
      request.addEventListener("load", () => {
        finish();
        let body: ({ code?: string; message?: string } & AssetImportResponse) | undefined;
        try { body = JSON.parse(request.responseText) as typeof body; }
        catch { reject(new HostApiError(request.status, "UNKNOWN", "本地服务返回了无法读取的响应")); return; }
        if (request.status < 200 || request.status >= 300) {
          reject(new HostApiError(request.status, body?.code ?? "UNKNOWN", body?.message ?? "本地资产导入失败")); return;
        }
        resolvePromise(body as AssetImportResponse);
      }, { once: true });
      request.addEventListener("error", () => { finish(); reject(new HostApiError(0, "NETWORK_ERROR", "本地资产导入连接失败")); }, { once: true });
      request.addEventListener("abort", () => { finish(); reject(new DOMException("Asset import cancelled", "AbortError")); }, { once: true });
      if (options.signal?.aborted) { reject(new DOMException("Asset import cancelled", "AbortError")); return; }
      options.signal?.addEventListener("abort", abort, { once: true });
      request.send(body);
    });
  }

  async cancel(jobId: string): Promise<void> { await this.#request(`/api/jobs/${jobId}/cancel`, { method: "POST" }); }

  #headers(): Record<string, string> { return this.#csrf !== null ? { "X-Narralens-CSRF": this.#csrf } : { authorization: `Bearer ${this.#token}` }; }

  async #get<T>(path: string): Promise<T> { return this.#request<T>(path); }
  async #request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, { ...init, credentials: "same-origin", headers: { ...init.headers, ...this.#headers() } });
    const body = await response.json() as { code?: string; message?: string } & T;
    if (!response.ok) throw new HostApiError(response.status, body.code ?? "UNKNOWN", body.message ?? "本地服务请求失败");
    return body;
  }

  async #getSse(path: string): Promise<JobEvent[]> {
    const response = await fetch(`${this.baseUrl}${path}`, { credentials: "same-origin", headers: this.#headers() });
    if (!response.ok) {
      const body = await response.json() as { code?: string; message?: string };
      throw new HostApiError(response.status, body.code ?? "UNKNOWN", body.message ?? "任务事件读取失败");
    }
    const text = await response.text();
    return text.split("\n\n").map((block) => block.split("\n").find((line) => line.startsWith("data: "))?.slice(6)).filter((line): line is string => Boolean(line)).map((line) => JSON.parse(line) as JobEvent);
  }
}

export function buildAssetImportRequest(file: Blob, metadata: AssetImportMetadata): { boundary: string; body: Blob } {
  const boundary = `----NarralensUpload${crypto.randomUUID().replaceAll("-", "")}`;
  const body = new Blob([
    `--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="upload.mp4"\r\nContent-Type: video/mp4\r\n\r\n`,
    file,
    `\r\n--${boundary}--\r\n`,
  ], { type: `multipart/form-data; boundary=${boundary}` });
  return { boundary, body };
}
