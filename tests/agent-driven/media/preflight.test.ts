import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runPreflight } from "../../../src/host/preflight/preflight.js";
import { computeRenderConfigDigest } from "../../../src/host/render/render-profile.js";
import { RENDER_PIN } from "../../../src/host/render/upstream-pin.js";
import { makeClosure, removeDirectory, renderSpec, temporaryDirectory } from "./support.js";

/**
 * The preflight.
 *
 * Module checks: each blocking fact is checked in isolation, so a test says which fact
 * stopped the render rather than only that something did. The real T20 acceptance
 * (a real render, a real disk, a real process) is `NOT_RUN`.
 */

const dirs: string[] = [];

afterEach(async () => {
  while (dirs.length > 0) await removeDirectory(dirs.pop()!);
});

async function directory(label: string): Promise<string> {
  const path = await temporaryDirectory(label);
  dirs.push(path);
  return path;
}

function findingStatus(report: { findings: readonly { id: string; status: string }[] }, id: string): string | undefined {
  return report.findings.find((finding) => finding.id === id)?.status;
}

describe("the preflight", () => {
  it("clears a closure whose rights, digest and configuration all hold", async () => {
    const source = await directory("preflight-ok-source");
    const staging = await directory("preflight-ok-staging");
    const closure = await makeClosure({ directory: source, with_asset: true });
    const spec = renderSpec({
      config_digest: computeRenderConfigDigest({
        render_spec: renderSpec(),
        upstream_sha: RENDER_PIN.upstream_sha,
        worker_sha256: RENDER_PIN.worker_sha256,
      }),
    });

    const report = await runPreflight({
      closure,
      render_spec: spec,
      project_id: closure.project_id,
      snapshot_id: closure.snapshot_id,
      expected_source_digest: closure.source_digest,
      upstream_root: join(source, "no-checkout-here"),
      staging_parent: staging,
    });

    expect(findingStatus(report, "snapshot_identity")).toBe("pass");
    expect(findingStatus(report, "inputs_local")).toBe("pass");
    expect(findingStatus(report, "inputs_rights")).toBe("pass");
    expect(findingStatus(report, "render_spec")).toBe("pass");
    expect(findingStatus(report, "render_config")).toBe("pass");
    expect(findingStatus(report, "output_space")).toBe("pass");
  });

  it("blocks a snapshot whose rights were never cleared", async () => {
    const source = await directory("preflight-rights-source");
    const staging = await directory("preflight-rights-staging");
    const closure = await makeClosure({
      directory: source,
      with_asset: true,
      rights: [{ asset_id: "clip.mp4", status: "restricted", commercial_use: false, ref: "rights_01" }],
    });

    const report = await runPreflight({
      closure,
      render_spec: renderSpec(),
      project_id: closure.project_id,
      snapshot_id: closure.snapshot_id,
      expected_source_digest: closure.source_digest,
      upstream_root: join(source, "no-checkout-here"),
      staging_parent: staging,
    });

    expect(findingStatus(report, "inputs_rights")).toBe("block");
    expect(report.ok).toBe(false);
  });

  it("blocks an asset that has no rights fact at all", async () => {
    const source = await directory("preflight-norights-source");
    const staging = await directory("preflight-norights-staging");
    const closure = await makeClosure({ directory: source, with_asset: true, rights: [] });

    const report = await runPreflight({
      closure,
      render_spec: renderSpec(),
      project_id: closure.project_id,
      snapshot_id: closure.snapshot_id,
      expected_source_digest: closure.source_digest,
      upstream_root: join(source, "no-checkout-here"),
      staging_parent: staging,
    });

    expect(findingStatus(report, "inputs_rights")).toBe("block");
  });

  it("blocks a configuration digest that does not name this renderer", async () => {
    const source = await directory("preflight-config-source");
    const staging = await directory("preflight-config-staging");
    const closure = await makeClosure({ directory: source });

    const report = await runPreflight({
      closure,
      render_spec: renderSpec({ config_digest: "b".repeat(64) }),
      project_id: closure.project_id,
      snapshot_id: closure.snapshot_id,
      expected_source_digest: closure.source_digest,
      upstream_root: join(source, "no-checkout-here"),
      staging_parent: staging,
    });

    expect(findingStatus(report, "render_config")).toBe("block");
  });

  it("blocks an engine version that names nothing this Host can pin", async () => {
    const source = await directory("preflight-engine-source");
    const staging = await directory("preflight-engine-staging");
    const closure = await makeClosure({ directory: source });

    const report = await runPreflight({
      closure,
      render_spec: renderSpec({ engine_version: "openfilm@0.0.1" }),
      project_id: closure.project_id,
      snapshot_id: closure.snapshot_id,
      expected_source_digest: closure.source_digest,
      upstream_root: join(source, "no-checkout-here"),
      staging_parent: staging,
    });

    expect(findingStatus(report, "render_spec")).toBe("block");
  });

  it("blocks a snapshot that is not the one that was asked for", async () => {
    const source = await directory("preflight-identity-source");
    const staging = await directory("preflight-identity-staging");
    const closure = await makeClosure({ directory: source });

    const report = await runPreflight({
      closure,
      render_spec: renderSpec(),
      project_id: closure.project_id,
      snapshot_id: "another_snapshot",
      expected_source_digest: closure.source_digest,
      upstream_root: join(source, "no-checkout-here"),
      staging_parent: staging,
    });

    expect(findingStatus(report, "snapshot_identity")).toBe("block");
  });

  it("blocks when the pinned upstream is not there", async () => {
    const source = await directory("preflight-upstream-source");
    const staging = await directory("preflight-upstream-staging");
    const closure = await makeClosure({ directory: source });

    const report = await runPreflight({
      closure,
      render_spec: renderSpec(),
      project_id: closure.project_id,
      snapshot_id: closure.snapshot_id,
      expected_source_digest: closure.source_digest,
      upstream_root: join(source, "no-checkout-here"),
      staging_parent: staging,
    });

    expect(findingStatus(report, "upstream_pin")).toBe("block");
    expect(report.ok).toBe(false);
  });

  it("blocks when the staging area cannot be measured", async () => {
    const source = await directory("preflight-space-source");
    const closure = await makeClosure({ directory: source });

    const report = await runPreflight({
      closure,
      render_spec: renderSpec(),
      project_id: closure.project_id,
      snapshot_id: closure.snapshot_id,
      expected_source_digest: closure.source_digest,
      upstream_root: join(source, "no-checkout-here"),
      staging_parent: join(source, "no-staging-here"),
    });

    expect(findingStatus(report, "output_space")).toBe("block");
  });
});
