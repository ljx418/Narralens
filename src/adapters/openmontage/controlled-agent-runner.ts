import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import proposalSchema from "../../../contracts/proposal-bundle.schema.json" with { type: "json" };
import type { ProjectResponse, ProposalRequest } from "../../contracts/types.js";
import { HttpError } from "../../host/api-error.js";

export const cliProposalEnvelopeSchema = structuralSchema(proposalSchema);

export interface RunnerInput {
  project: Pick<ProjectResponse, "project_id" | "revision" | "frame_rate" | "frame_count">;
  request: ProposalRequest;
  fixed_context: {
    product: "Narralens";
    output_contract: "narralens.proposal_bundle@1.0";
    upstream: "OpenMontage";
    pipeline: "proposal-only";
  };
}

export interface RunnerOutput { value: unknown; raw_sha256: string; metadata: Record<string, unknown> }

export interface RunnerOptions {
  executable?: string;
  prefixArgs?: string[];
  timeoutMs?: number;
  maxOutputBytes?: number;
  cwd?: string;
  onAudit?: (audit: RunnerAudit) => void;
}

export interface RunnerAudit { stdout_sha256: string; model_names: string[]; total_cost_usd: number | null; duration_ms: number | null; num_turns: number | null; service_tier: string | null }

export class ControlledAgentRunner {
  readonly executable: string;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly cwd: string | undefined;
  readonly prefixArgs: string[];
  readonly onAudit: ((audit: RunnerAudit) => void) | undefined;

  constructor(options: RunnerOptions = {}) {
    this.executable = options.executable ?? "claude";
    this.prefixArgs = options.prefixArgs ?? [];
    this.timeoutMs = options.timeoutMs ?? 180_000;
    this.maxOutputBytes = options.maxOutputBytes ?? 1_048_576;
    this.cwd = options.cwd;
    this.onAudit = options.onAudit;
  }

  async run(input: RunnerInput, signal?: AbortSignal): Promise<RunnerOutput> {
    const args = [...this.prefixArgs,
      "--print", "--safe-mode", "--permission-mode", "plan", "--tools", "",
      "--disable-slash-commands", "--no-session-persistence", "--output-format", "json",
      "--json-schema", JSON.stringify(cliProposalEnvelopeSchema),
      "--append-system-prompt", "Generate exactly one Narralens ProposalBundle JSON object from the JSON user prompt. Do not use tools or files. Required fields: schema_version='1.0'; kind='narralens.proposal_bundle'; project_id copied exactly; proposal_id matching proposal_[A-Za-z0-9_-]+; base_revision copied exactly; selection copied exactly; preserve copied exactly and in the same order; non-empty Chinese summary; segments as non-empty objects {id,duration_frames,intent,asset_id} whose positive integer durations exactly sum to selection end_frame_exclusive-start_frame; assets_needed array; source_refs array; cost={status:'unknown',currency:null,amount:null}; requires_materialization=true; renderable=false. Use null asset_id for unknown assets. No markdown or extra top-level fields.",
    ];
    const stdin = `${JSON.stringify(input)}\n`;
    return await new Promise<RunnerOutput>((resolvePromise, reject) => {
      const child = spawn(this.executable, args, {
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        ...(this.cwd ? { cwd: this.cwd } : {}),
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let outputBytes = 0;
      let killedForSize = false;
      let settled = false;
      const finishError = (error: HttpError): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        reject(error);
      };
      const abort = (): void => { child.kill("SIGTERM"); finishError(new HttpError(504, "RUNNER_TIMEOUT", "Runner was cancelled")); };
      const timer = setTimeout(() => { child.kill("SIGTERM"); finishError(new HttpError(504, "RUNNER_TIMEOUT", "Runner timed out")); }, this.timeoutMs);
      signal?.addEventListener("abort", abort, { once: true });
      child.on("error", () => finishError(new HttpError(503, "RUNNER_UNAVAILABLE", "Runner executable is unavailable")));
      child.stdout.on("data", (chunk: Buffer) => {
        outputBytes += chunk.length;
        if (outputBytes > this.maxOutputBytes) {
          killedForSize = true;
          child.kill("SIGTERM");
          return;
        }
        stdout.push(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        if (stderr.reduce((sum, item) => sum + item.length, 0) < 65_536) stderr.push(chunk);
      });
      child.on("close", (code) => {
        if (settled) return;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        if (killedForSize) return finishError(new HttpError(422, "INVALID_PROPOSAL", "Runner output exceeded 1 MiB"));
        const errorText = Buffer.concat(stderr).toString("utf8");
        if (code !== 0) {
          const stdoutText = Buffer.concat(stdout).toString("utf8");
          const diagnostic = runnerFailureDiagnostic(errorText, stdoutText);
          if (/\b422\b/.test(diagnostic)) return finishError(new HttpError(422, "PROVIDER_REJECTED", "Provider rejected the request"));
          if (/\b529\b|overloaded/i.test(diagnostic)) return finishError(new HttpError(529, "PROVIDER_OVERLOADED", "Provider is overloaded; retry manually later"));
          return finishError(new HttpError(503, "RUNNER_UNAVAILABLE", "Runner invocation failed", { exit_code: code, diagnostic }));
        }
        let wrapper: unknown;
        try { wrapper = JSON.parse(Buffer.concat(stdout).toString("utf8")); }
        catch { return finishError(new HttpError(422, "INVALID_PROPOSAL", "Runner stdout was not a single JSON value")); }
        if (!wrapper || typeof wrapper !== "object") return finishError(new HttpError(422, "INVALID_PROPOSAL", "Runner JSON wrapper was invalid"));
        const record = wrapper as Record<string, unknown>;
        const value = record.structured_output;
        if (!value || typeof value !== "object" || Array.isArray(value)) return finishError(new HttpError(422, "INVALID_PROPOSAL", "Runner did not return a structured_output object"));
        settled = true;
        const raw = Buffer.concat(stdout);
        const metadata = Object.fromEntries(Object.entries(record).filter(([key]) => !["structured_output", "result"].includes(key)));
        this.onAudit?.({
          stdout_sha256: createHash("sha256").update(raw).digest("hex"),
          model_names: record.modelUsage && typeof record.modelUsage === "object" ? Object.keys(record.modelUsage) : [],
          total_cost_usd: typeof record.total_cost_usd === "number" ? record.total_cost_usd : null,
          duration_ms: typeof record.duration_ms === "number" ? record.duration_ms : null,
          num_turns: typeof record.num_turns === "number" ? record.num_turns : null,
          service_tier: typeof record.service_tier === "string" ? record.service_tier : null,
        });
        resolvePromise({
          value,
          raw_sha256: createHash("sha256").update(raw).digest("hex"),
          metadata,
        });
      });
      child.stdin.end(stdin);
    });
  }
}

function sanitizeDiagnostic(value: string): string {
  return value.replace(/[A-Za-z]:\\[^\r\n]+|\/(?:home|mnt|Users)\/[^\r\n]+/g, "[local-path-redacted]").slice(0, 500);
}

function runnerFailureDiagnostic(stderr: string, stdout: string): string {
  if (stderr.trim()) return sanitizeDiagnostic(stderr);
  try {
    const value = JSON.parse(stdout) as Record<string, unknown>;
    return sanitizeDiagnostic(JSON.stringify({ subtype: value.subtype, api_error_status: value.api_error_status, result: value.result, terminal_reason: value.terminal_reason }));
  } catch { return sanitizeDiagnostic(stdout); }
}

function structuralSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(structuralSchema);
  if (!value || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  if ("type" in source) result.type = source.type;
  if (Array.isArray(source.required)) result.required = source.required;
  if (source.properties && typeof source.properties === "object" && !Array.isArray(source.properties)) {
    result.properties = Object.fromEntries(Object.entries(source.properties as Record<string, unknown>).map(([key, item]) => [key, structuralSchema(item)]));
  }
  if ("items" in source) result.items = structuralSchema(source.items);
  if (!("type" in result)) {
    if ("const" in source) result.type = jsonType(source.const);
    else if (Array.isArray(source.enum)) result.type = [...new Set(source.enum.map(jsonType))];
  }
  return result;
}

function jsonType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value === "number" ? "number" : typeof value;
}
