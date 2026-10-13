import type { EditRequest, EditResponse, JobEvent, JobResponse, ProjectResponse, ProposalBundle, ProposalComparison, ProposalComparisonRequest } from "../../../contracts/types.js";

export class HostApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

export class HostApiClient {
  #token = "";
  constructor(private readonly baseUrl = "") {}

  async start(): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/session`);
    const body = await response.json() as { token: string };
    if (!response.ok) throw new HostApiError(response.status, "SESSION_FAILED", "无法建立本地会话");
    this.#token = body.token;
  }

  project(projectId: string): Promise<ProjectResponse> { return this.#get(`/api/projects/${projectId}`); }
  job(jobId: string): Promise<JobResponse> { return this.#get(`/api/jobs/${jobId}`); }
  proposal(proposalId: string): Promise<ProposalBundle> { return this.#get(`/api/proposals/${proposalId}`); }
  comparison(comparisonId: string): Promise<ProposalComparison> { return this.#get(`/api/proposal-comparisons/${comparisonId}`); }
  events(jobId: string, after: number): Promise<JobEvent[]> { return this.#getSse(`/api/jobs/${jobId}/events?after=${after}`); }

  async createProposal(projectId: string, request: ProposalComparisonRequest): Promise<JobResponse> {
    return this.#request(`/api/projects/${projectId}/proposals`, { method: "POST", body: JSON.stringify(request), headers: { "content-type": "application/json" } });
  }

  async edit(projectId: string, request: EditRequest): Promise<EditResponse> {
    return this.#request(`/api/projects/${projectId}/edits`, { method: "POST", body: JSON.stringify(request), headers: { "content-type": "application/json" } });
  }

  async cancel(jobId: string): Promise<void> { await this.#request(`/api/jobs/${jobId}/cancel`, { method: "POST" }); }

  async #get<T>(path: string): Promise<T> { return this.#request<T>(path); }
  async #request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, { ...init, headers: { ...init.headers, authorization: `Bearer ${this.#token}` } });
    const body = await response.json() as { code?: string; message?: string } & T;
    if (!response.ok) throw new HostApiError(response.status, body.code ?? "UNKNOWN", body.message ?? "本地服务请求失败");
    return body;
  }

  async #getSse(path: string): Promise<JobEvent[]> {
    const response = await fetch(`${this.baseUrl}${path}`, { headers: { authorization: `Bearer ${this.#token}` } });
    if (!response.ok) {
      const body = await response.json() as { code?: string; message?: string };
      throw new HostApiError(response.status, body.code ?? "UNKNOWN", body.message ?? "任务事件读取失败");
    }
    const text = await response.text();
    return text.split("\n\n").map((block) => block.split("\n").find((line) => line.startsWith("data: "))?.slice(6)).filter((line): line is string => Boolean(line)).map((line) => JSON.parse(line) as JobEvent);
  }
}
