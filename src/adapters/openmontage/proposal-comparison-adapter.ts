import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { validateProposalComparison, validateProposalComparisonDraft } from "../../contracts/validator.js";
import type { ProposalComparison, ProposalComparisonDraft, ProposalComparisonRequest, RunnerGenerationAudit } from "../../contracts/types.js";
import { HttpError } from "../../host/api-error.js";

const TMP_PATTERN = /^\.narralens-comparison-[A-Za-z0-9_-]+\.tmp$/;

export interface ProposalStructureSignature {
  segment_count: number;
  roles: string[];
  normalized_durations: number[];
}

export class ProposalComparisonAdapter {
  constructor(private readonly stagingRoot: string) {}

  build(value: unknown, projectId: string, request: ProposalComparisonRequest,
    audit: RunnerGenerationAudit, now = new Date()): ProposalComparison {
    const result = validateProposalComparisonDraft(value);
    if (!result.ok) this.invalid("Runner returned an invalid proposal comparison", result.errors);
    const draft = result.value;
    const semanticErrors = validateDraftSemantics(draft, request);
    if (semanticErrors.length) this.invalid("Runner returned an invalid proposal set", semanticErrors);
    const suffix = randomUUID().replaceAll("-", "_");
    const comparison: ProposalComparison = {
      schema_version: "1.0",
      kind: "narralens.proposal_comparison",
      comparison_id: `comparison_${suffix}`,
      project_id: projectId,
      base_revision: request.base_revision,
      selection: { ...request.selection },
      intent_sha256: createHash("sha256").update(request.intent).digest("hex"),
      preserve: [...request.preserve],
      proposal_count: request.proposal_count,
      proposals: draft.proposals.map(({ option_key: _optionKey, ...proposal }, index) => ({
        ...proposal,
        proposal_id: `proposal_${suffix}_${index + 1}`,
        materialization_cost: { status: "unknown", currency: null, amount: null },
      })),
      generation_audit: { ...audit, model_names: [...audit.model_names] },
      created_at: now.toISOString(),
    };
    const final = validateProposalComparison(comparison);
    if (!final.ok) this.invalid("Host produced an invalid proposal comparison", final.errors);
    return final.value;
  }

  async save(comparison: ProposalComparison): Promise<void> {
    const checked = validateProposalComparison(comparison);
    if (!checked.ok) this.invalid("Refused to store an invalid proposal comparison", checked.errors);
    const semanticErrors = validateFinalSemantics(checked.value);
    if (semanticErrors.length) this.invalid("Refused to store an invalid proposal comparison", semanticErrors);
    await mkdir(this.stagingRoot, { recursive: true });
    const destination = resolve(this.stagingRoot, `${comparison.comparison_id}.json`);
    const temporary = resolve(this.stagingRoot, `.narralens-comparison-${randomUUID().replaceAll("-", "_")}.tmp`);
    let handle;
    try {
      handle = await open(temporary, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify(comparison, null, 2)}\n`, "utf8");
      await handle.datasync();
      await handle.close();
      handle = undefined;
      await rename(temporary, destination);
      await syncDirectoryBestEffort(this.stagingRoot);
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await unlink(temporary).catch(() => undefined);
      if (error instanceof HttpError) throw error;
      throw new HttpError(500, "INTERNAL_ERROR", "Could not atomically publish proposal comparison");
    }
  }

  async read(comparisonId: string): Promise<ProposalComparison> {
    if (!/^comparison_[A-Za-z0-9_-]+$/.test(comparisonId)) throw new HttpError(400, "INVALID_REQUEST", "Invalid comparison identifier");
    try {
      const raw: unknown = JSON.parse(await readFile(resolve(this.stagingRoot, `${comparisonId}.json`), "utf8"));
      const valid = validateProposalComparison(raw);
      if (!valid.ok) throw new HttpError(422, "INVALID_PROPOSAL_SET", "Stored proposal comparison is invalid", { errors: valid.errors });
      const semanticErrors = validateFinalSemantics(valid.value);
      if (semanticErrors.length) throw new HttpError(422, "INVALID_PROPOSAL_SET", "Stored proposal comparison is invalid", { errors: semanticErrors });
      return valid.value;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (error instanceof SyntaxError) throw new HttpError(422, "INVALID_PROPOSAL_SET", "Stored proposal comparison is invalid");
      if (isNodeError(error) && error.code !== "ENOENT") throw new HttpError(500, "INTERNAL_ERROR", "Could not read proposal comparison");
      throw new HttpError(404, "NOT_FOUND", "Proposal comparison not found");
    }
  }

  async cleanupStaleTemporaryFiles(): Promise<number> {
    await mkdir(this.stagingRoot, { recursive: true });
    const names = await readdir(this.stagingRoot);
    const stale = names.filter((name) => TMP_PATTERN.test(name));
    await Promise.all(stale.map((name) => unlink(resolve(this.stagingRoot, name)).catch(() => undefined)));
    return stale.length;
  }

  private invalid(message: string, errors: string[]): never {
    throw new HttpError(422, "INVALID_PROPOSAL_SET", message, { errors });
  }
}

export function proposalStructureSignature(proposal: ProposalComparisonDraft["proposals"][number]): ProposalStructureSignature {
  const durations = proposal.segments.map((segment) => segment.duration_frames);
  const divisor = durations.reduce(gcd);
  return {
    segment_count: proposal.segments.length,
    roles: proposal.segments.map((segment) => segment.role),
    normalized_durations: durations.map((duration) => duration / divisor),
  };
}

function validateDraftSemantics(draft: ProposalComparisonDraft, request: ProposalComparisonRequest): string[] {
  const errors: string[] = [];
  if (draft.proposals.length !== request.proposal_count) errors.push("proposal count does not match the request");
  requireUnique(draft.proposals.map((proposal) => proposal.option_key), "option_key", errors);
  requireUnique(draft.proposals.map((proposal) => proposal.strategy.kind), "strategy.kind", errors);
  const selectedFrames = request.selection.end_frame_exclusive - request.selection.start_frame;
  draft.proposals.forEach((proposal, index) => {
    const prefix = `proposals[${index}]`;
    requireUnique(proposal.segments.map((segment) => segment.segment_id), `${prefix}.segment_id`, errors);
    requireUnique(proposal.assets_needed.map((asset) => asset.requirement_id), `${prefix}.requirement_id`, errors);
    requireUnique(proposal.source_refs.map((source) => source.ref_id), `${prefix}.ref_id`, errors);
    if (proposal.source_refs.length) errors.push(`${prefix}.source_refs must be empty without a trusted source manifest`);
    if (proposal.segments.reduce((sum, segment) => sum + segment.duration_frames, 0) !== selectedFrames) {
      errors.push(`${prefix}.segments must exactly cover the selected frame range`);
    }
    const requirements = new Set(proposal.assets_needed.map((asset) => asset.requirement_id));
    for (const segment of proposal.segments) {
      for (const id of segment.asset_requirement_ids) if (!requirements.has(id)) errors.push(`${prefix} contains a dangling asset requirement reference`);
    }
    if (proposal.assets_needed.some((asset) => asset.duration_frames > selectedFrames)) {
      errors.push(`${prefix}.assets_needed duration exceeds the selected frame range`);
    }
  });
  for (let left = 0; left < draft.proposals.length; left += 1) {
    for (let right = left + 1; right < draft.proposals.length; right += 1) {
      const a = proposalStructureSignature(draft.proposals[left]!);
      const b = proposalStructureSignature(draft.proposals[right]!);
      if (a.segment_count === b.segment_count && arraysEqual(a.roles, b.roles) && arraysEqual(a.normalized_durations, b.normalized_durations)) {
        errors.push(`proposals[${left}] and proposals[${right}] are not structurally distinct`);
      }
    }
  }
  return errors;
}

function validateFinalSemantics(comparison: ProposalComparison): string[] {
  const proposalIds = comparison.proposals.map((proposal) => proposal.proposal_id);
  const errors: string[] = [];
  requireUnique(proposalIds, "proposal_id", errors);
  const proposals = comparison.proposals.map(({ proposal_id, materialization_cost: _cost, ...proposal }) => ({ ...proposal, option_key: proposal_id }));
  errors.push(...validateDraftSemantics({ schema_version: "1.0", kind: "narralens.proposal_comparison_draft", proposals }, {
    base_revision: comparison.base_revision, selection: comparison.selection, intent: "bound-by-sha256", preserve: comparison.preserve, proposal_count: comparison.proposal_count,
  }));
  return errors;
}

function requireUnique(values: string[], label: string, errors: string[]): void {
  if (new Set(values).size !== values.length) errors.push(`${label} values must be unique`);
}

function arraysEqual(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function gcd(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

async function syncDirectoryBestEffort(path: string): Promise<void> {
  let directory;
  try {
    directory = await open(path, "r");
    await directory.sync();
  } catch {
    // Directory fsync is not supported on every host (notably Windows); rename remains atomic.
  } finally {
    await directory?.close().catch(() => undefined);
  }
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}
