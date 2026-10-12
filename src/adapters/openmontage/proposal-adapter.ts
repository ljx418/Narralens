import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validateProposalBundle } from "../../contracts/validator.js";
import type { ProposalBundle, ProposalRequest } from "../../contracts/types.js";
import { HttpError } from "../../host/api-error.js";

export class ProposalAdapter {
  constructor(private readonly stagingRoot: string) {}

  validate(value: unknown, projectId: string, request: ProposalRequest): ProposalBundle {
    const result = validateProposalBundle(value);
    if (!result.ok) throw new HttpError(422, "INVALID_PROPOSAL", "Runner returned an invalid proposal", { errors: result.errors });
    const proposal = result.value;
    const sameSelection = proposal.selection.shot_id === request.selection.shot_id
      && proposal.selection.start_frame === request.selection.start_frame
      && proposal.selection.end_frame_exclusive === request.selection.end_frame_exclusive;
    const samePreserve = proposal.preserve.length === request.preserve.length
      && proposal.preserve.every((item, index) => item === request.preserve[index]);
    if (proposal.project_id !== projectId || proposal.base_revision !== request.base_revision ||
      !sameSelection || !samePreserve) {
      throw new HttpError(422, "INVALID_PROPOSAL", "Proposal is not bound to the submitted project revision and selection");
    }
    return proposal;
  }

  async save(proposal: ProposalBundle): Promise<void> {
    await mkdir(this.stagingRoot, { recursive: true });
    const safeId = proposal.proposal_id.replace(/[^A-Za-z0-9_-]/g, "_");
    const destination = resolve(this.stagingRoot, `${safeId}.json`);
    const temporary = `${destination}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(proposal, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, destination);
  }

  async read(proposalId: string): Promise<ProposalBundle> {
    if (!/^[A-Za-z0-9_-]+$/.test(proposalId)) throw new HttpError(400, "INVALID_REQUEST", "Invalid proposal identifier");
    try {
      const raw: unknown = JSON.parse(await readFile(resolve(this.stagingRoot, `${proposalId}.json`), "utf8"));
      const valid = validateProposalBundle(raw);
      if (!valid.ok) throw new HttpError(422, "INVALID_PROPOSAL", "Stored proposal is invalid");
      return valid.value;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(404, "NOT_FOUND", "Proposal not found");
    }
  }
}
