import { readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommittedRenderPhases, closureDigestOf, frameRateOf, rightsDigestOf } from "../../../src/host/render/committed-render-phases.js";
import { PublishedPackageStore } from "../../../src/host/delivery/published-package-store.js";
import { computeRenderConfigDigest } from "../../../src/host/render/render-profile.js";
import { RENDER_PIN } from "../../../src/host/render/upstream-pin.js";
import { NativeRenderError, type NativeRenderPort, type NativeRenderRequest } from "../../../src/host/render/native-renderer.js";
import {
  CommittedRenderPhaseError,
  phaseReceiptDigest,
  PHASE_OBJECT_MAX_READ_BYTES,
  type AttemptFencePort,
  type EncodedFactV1,
  type QcReceiptV1,
  type RenderRequest,
  type SnapshotClosure,
  type SnapshotReadPort,
} from "../../../src/host/render/ports.js";
import type { QCItem } from "../../../src/contracts/agent-driven-types.js";
import { makeClosure, removeDirectory, renderSpec, runnerOf, temporaryDirectory } from "./support.js";

/**
 * The three media stages of a committed render.
 *
 * These are module checks: the renderer and the media tools are faked, because the
 * point of the stage split is the *boundary* — what each stage is allowed to do, what it
 * hands over, what it refuses, and what it leaves behind. The real acceptance (a real
 * encoder, a real ffprobe, a real full decode, a real process killed between the
 * stages) belongs to the T20 gate and is `NOT_RUN` here: it needs MAIN's resource
 * reservation and the real Host.
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

/** A renderer that writes a file, like the real one does. */
function fakeRenderer(behaviour: "write" | "fail" = "write"): NativeRenderPort {
  return {
    async render(request: NativeRenderRequest) {
      if (behaviour === "fail") {
        throw new NativeRenderError("RENDER_FAILED", "the film could not be rendered");
      }
      await import("node:fs/promises").then((fs) => fs.writeFile(request.out_path, "the rendered film", "utf8"));
      return { out_path: request.out_path, lines: [], elapsed_ms: 1 };
    },
  };
}

interface Harness {
  readonly phases: CommittedRenderPhases;
  readonly packages: PublishedPackageStore;
  readonly closure: SnapshotClosure;
  readonly objectRoot: string;
  readonly workspace: string;
  readonly deliveryRoot: string;
  readonly setVerdict: (verdict: "proceed" | "cancelled" | "superseded") => void;
  readonly fenceChecks: () => number;
}

async function harness(input: {
  readonly label: string;
  readonly renderer?: NativeRenderPort;
  readonly qc?: Parameters<typeof runnerOf>[0];
  readonly verdict?: "proceed" | "cancelled" | "superseded";
  readonly with_supplement?: boolean;
}): Promise<Harness> {
  const source = await directory(`${input.label}-source`);
  const objectRoot = await directory(`${input.label}-objects`);
  const workspace = await directory(`${input.label}-workspace`);
  const deliveryRoot = await directory(`${input.label}-delivery`);
  const closure = await makeClosure({
    directory: source,
    with_asset: true,
    with_supplement: input.with_supplement ?? true,
  });

  const spec = renderSpec({
    config_digest: computeRenderConfigDigest({
      render_spec: renderSpec(),
      upstream_sha: RENDER_PIN.upstream_sha,
      worker_sha256: RENDER_PIN.worker_sha256,
    }),
  });

  const snapshots: SnapshotReadPort = {
    async readSnapshot() { return closure; },
  };
  let verdict: "proceed" | "cancelled" | "superseded" = input.verdict ?? "proceed";
  let checks = 0;
  const fence: AttemptFencePort = {
    async claimAttempt() { return true; },
    async checkAttempt() { checks += 1; return verdict; },
    async releaseAttempt() { /* the executor owns the claim */ },
  };

  const packages = new PublishedPackageStore({ root: deliveryRoot });
  const phases = new CommittedRenderPhases({
    snapshots,
    fence,
    packages,
    native_renderer: input.renderer ?? fakeRenderer(),
    upstream_root: join(source, "no-checkout-here"),
    object_root: objectRoot,
    workspace_root: workspace,
    qc_runner: runnerOf(input.qc ?? {}),
    // The pin is checked by the pin probe and by the real acceptance. Here it is
    // stated, so that the orchestration can be exercised on a machine that does not
    // have the pinned checkout.
    pin_verifier: async () => ({
      ok: true,
      reason: "the pin was checked elsewhere",
      checked: [],
      missing: [],
      mismatched: [],
      upstream_root: source,
      observed_sha: RENDER_PIN.upstream_sha,
      expected_sha: RENDER_PIN.upstream_sha,
      worker_sha256: RENDER_PIN.worker_sha256,
    }),
  });

  return {
    phases,
    packages,
    closure,
    objectRoot,
    workspace,
    deliveryRoot,
    setVerdict: (next) => { verdict = next; },
    fenceChecks: () => checks,
  };
}

function requestFor(harness: Harness, attempt = 1, dispositions: readonly string[] = ["output_space"]): RenderRequest {
  return {
    project_id: "proj_media_01",
    job_id: "job_render_01",
    snapshot_id: "snap_media_01",
    source_digest: harness.closure.source_digest,
    render_spec: renderSpec({
      config_digest: computeRenderConfigDigest({
        render_spec: renderSpec(),
        upstream_sha: RENDER_PIN.upstream_sha,
        worker_sha256: RENDER_PIN.worker_sha256,
      }),
    }),
    execution: {
      run_id: "run_media_01",
      plan_version: 1,
      step_id: "snapshot.render",
      attempt,
      input_digest: harness.closure.source_digest,
      run_scope_digest: "0".repeat(64),
      authorization_id: "auth_media_01",
    },
    attempt,
    qc_dispositions: [...dispositions],
    required_supplements: ["rights"],
    signal: undefined,
  };
}

/** The delivery job's request: another job, another lease, the same film. */
function deliveryRequestFor(harness: Harness, attempt = 1, dispositions: readonly string[] = ["output_space"]): RenderRequest {
  const base = requestFor(harness, attempt, dispositions);
  return {
    ...base,
    job_id: "job_delivery_01",
    execution: { ...base.execution, step_id: "delivery.package" },
  };
}

describe("encoding a committed closure", () => {
  it("returns an encoded fact that describes the bytes it produced", async () => {
    const built = await harness({ label: "phase-encode" });
    const encoded = await built.phases.prepareEncoded(requestFor(built));

    expect(encoded.format).toBe("narralens.encoded-fact@1");
    expect(encoded.project_id).toBe("proj_media_01");
    expect(encoded.job_id).toBe("job_render_01");
    expect(encoded.producer_lease_attempt).toBe(1);
    expect(encoded.snapshot_id).toBe("snap_media_01");
    expect(encoded.frame_count).toBe(60);
    expect(encoded.fps_numerator).toBe(30);
    expect(encoded.fps_denominator).toBe(1);
    expect(encoded.closure_digest).toBe(closureDigestOf(built.closure, frameRateOf(requestFor(built).render_spec)));
    expect(encoded.rights_digest).toBe(rightsDigestOf(built.closure));
    expect(encoded.receipt_digest).toBe(phaseReceiptDigest(encoded));
  });

  it("carries no quality-control verdict and no readiness", async () => {
    const built = await harness({ label: "phase-encode-clean" });
    const encoded = await built.phases.prepareEncoded(requestFor(built));

    expect(Object.keys(encoded)).not.toContain("qc");
    expect(Object.keys(encoded)).not.toContain("ready");
    expect(Object.keys(encoded)).not.toContain("technical_status");
  });

  it("names an immutable object that holds the film and its supplements", async () => {
    const built = await harness({ label: "phase-encode-object" });
    const encoded = await built.phases.prepareEncoded(requestFor(built));

    const roles = encoded.files.map((file) => file.role);
    expect(roles).toContain("media");
    expect(roles).toContain("native_document");
    expect(roles).toContain("native_source");
    expect(roles).toContain("rights");
    expect(roles).toContain("subtitles");
    const media = encoded.files.find((file) => file.role === "media");
    expect(media?.sha256).toBe(encoded.media_ref.sha256);
  });

  it("never puts a physical path into the receipt", async () => {
    const built = await harness({ label: "phase-encode-paths" });
    const encoded = await built.phases.prepareEncoded(requestFor(built));

    const text = JSON.stringify(encoded);
    expect(text).not.toContain(built.objectRoot);
    expect(text).not.toContain(built.workspace);
    for (const file of encoded.files) {
      expect(file.relative_path.startsWith("/")).toBe(false);
    }
  });

  it("asks the fence before the film is rendered and before the object is published", async () => {
    const built = await harness({ label: "phase-encode-fence" });
    await built.phases.prepareEncoded(requestFor(built));

    expect(built.fenceChecks()).toBeGreaterThanOrEqual(3);
  });

  it("does not encode when the attempt may not act", async () => {
    const built = await harness({ label: "phase-encode-cancelled", verdict: "cancelled" });

    await expect(built.phases.prepareEncoded(requestFor(built))).rejects.toBeInstanceOf(CommittedRenderPhaseError);
  });

  it("leaves no published object behind when the renderer fails", async () => {
    const built = await harness({ label: "phase-encode-failed", renderer: fakeRenderer("fail") });

    await expect(built.phases.prepareEncoded(requestFor(built))).rejects.toBeInstanceOf(CommittedRenderPhaseError);
    const objects = await import("node:fs/promises").then((fs) => fs.readdir(resolve(built.objectRoot, "objects")).catch(() => [] as string[]));
    expect(objects).toEqual([]);
  });

  it("refuses a closure that does not say how many frames the film has", async () => {
    const built = await harness({ label: "phase-encode-noframes" });
    const withoutLength: SnapshotClosure = { ...built.closure, expected_frames: undefined };
    const phases = new CommittedRenderPhases({
      snapshots: { async readSnapshot() { return withoutLength; } },
      fence: { async claimAttempt() { return true; }, async checkAttempt() { return "proceed"; }, async releaseAttempt() { /* executor owns it */ } },
      packages: built.packages,
      native_renderer: fakeRenderer(),
      upstream_root: join(built.objectRoot, "no-checkout-here"),
      object_root: built.objectRoot,
      workspace_root: built.workspace,
      qc_runner: runnerOf({}),
      pin_verifier: async () => ({
        ok: true, reason: "stated", checked: [], missing: [], mismatched: [],
        upstream_root: built.objectRoot, observed_sha: RENDER_PIN.upstream_sha,
        expected_sha: RENDER_PIN.upstream_sha, worker_sha256: RENDER_PIN.worker_sha256,
      }),
    });

    await expect(phases.prepareEncoded(requestFor(built))).rejects.toMatchObject({ code: "SNAPSHOT_LENGTH_UNKNOWN" });
  });
});

describe("inspecting an encoded object", () => {
  it.each(["cancelled", "superseded"] as const)("does not start a decode after the probe settles into durable %s", async verdict => {
    const built = await harness({ label: "phase-between-tools-" + verdict });
    const encoded = await built.phases.prepareEncoded(requestFor(built));
    const tools: string[] = [], runner = runnerOf({});
    let state: "proceed" | "cancelled" | "superseded" = "proceed";
    const phases = new CommittedRenderPhases({
      snapshots: { async readSnapshot() { return built.closure; } },
      fence: { async claimAttempt() { return true; }, async checkAttempt() { return state; }, async releaseAttempt() {} },
      packages: built.packages, native_renderer: fakeRenderer(), upstream_root: join(built.objectRoot, "absent-checkout"),
      object_root: built.objectRoot, workspace_root: built.workspace,
      qc_runner: { async run(...args) { tools.push(args[0]); const result = await runner.run(...args); state = verdict; return result; } },
      pin_verifier: async () => ({ ok: true, reason: "module fixture", checked: [], missing: [], mismatched: [],
        upstream_root: built.objectRoot, observed_sha: RENDER_PIN.upstream_sha, expected_sha: RENDER_PIN.upstream_sha, worker_sha256: RENDER_PIN.worker_sha256 }),
    });
    try {
      await expect(phases.inspectEncoded({ request: deliveryRequestFor(built), encoded }))
        .rejects.toMatchObject({ code: verdict === "cancelled" ? "ATTEMPT_CANCELLED" : "ATTEMPT_SUPERSEDED" });
      expect(tools).toEqual(["ffprobe"]);
    } finally { await phases.close(); await built.phases.close(); }
  });

  it.each(["cancelled", "superseded"] as const)("does not start QC tools when preflight observes a durable %s attempt", async verdict => {
    const built = await harness({ label: "phase-inspect-preflight-" + verdict });
    const encoded = await built.phases.prepareEncoded(requestFor(built));
    let state: "proceed" | "cancelled" | "superseded" = "proceed", calls = 0;
    const runner = runnerOf({});
    const phases = new CommittedRenderPhases({
      snapshots: { async readSnapshot() { return built.closure; } },
      fence: { async claimAttempt() { return true; }, async checkAttempt() { return state; }, async releaseAttempt() {} },
      packages: built.packages, native_renderer: fakeRenderer(), upstream_root: join(built.objectRoot, "absent-checkout"),
      object_root: built.objectRoot, workspace_root: built.workspace,
      qc_runner: { async run(...args) { calls += 1; return runner.run(...args); } },
      pin_verifier: async () => { state = verdict; return { ok: true, reason: "module fixture", checked: [], missing: [], mismatched: [],
        upstream_root: built.objectRoot, observed_sha: RENDER_PIN.upstream_sha, expected_sha: RENDER_PIN.upstream_sha, worker_sha256: RENDER_PIN.worker_sha256 }; },
    });
    try {
      await expect(phases.inspectEncoded({ request: deliveryRequestFor(built), encoded })).rejects.toMatchObject({
        code: verdict === "cancelled" ? "ATTEMPT_CANCELLED" : "ATTEMPT_SUPERSEDED" });
      expect(calls).toBe(0);
    } finally { await phases.close(); await built.phases.close(); }
  });

  it("returns a receipt that is bound to the encoded fact", async () => {
    const built = await harness({ label: "phase-inspect" });
    const encoded = await built.phases.prepareEncoded(requestFor(built));
    const qc = await built.phases.inspectEncoded({ request: deliveryRequestFor(built), encoded });

    expect(qc.format).toBe("narralens.qc-receipt@1");
    expect(qc.parent_encoded_digest).toBe(encoded.receipt_digest);
    expect(qc.receipt_digest).toBe(phaseReceiptDigest(qc));
    expect(["pass", "warn", "block"]).toContain(qc.technical_status);
    expect(qc.files.map((file) => file.role)).toEqual(["ffprobe", "full_decode"]);
  });

  it("writes its own object and leaves the encoded object alone", async () => {
    const built = await harness({ label: "phase-inspect-objects" });
    const encoded = await built.phases.prepareEncoded(requestFor(built));
    const before = await readFile(resolve(built.objectRoot, "objects", encoded.media_object_id, "media.mp4"), "utf8");

    const qc = await built.phases.inspectEncoded({ request: deliveryRequestFor(built), encoded });

    const after = await readFile(resolve(built.objectRoot, "objects", encoded.media_object_id, "media.mp4"), "utf8");
    expect(after).toBe(before);
    expect(qc.qc_object_id).not.toBe(encoded.media_object_id);
    const qcFiles = await import("node:fs/promises").then((fs) => fs.readdir(resolve(built.objectRoot, "objects", qc.qc_object_id)));
    // The object carries its own durable receipt beside its evidence.
    expect(qcFiles.sort()).toEqual(["ffprobe.json", "full_decode.log", "receipt.json"]);
  });

  it("refuses an encoded fact whose digest does not describe it", async () => {
    const built = await harness({ label: "phase-inspect-tampered" });
    const encoded = await built.phases.prepareEncoded(requestFor(built));
    const tampered: EncodedFactV1 = { ...encoded, frame_count: 61 };

    await expect(built.phases.inspectEncoded({ request: deliveryRequestFor(built), encoded: tampered }))
      .rejects.toMatchObject({ code: "RECEIPT_DIGEST_CHANGED" });
  });

  it("refuses an encoded fact that is about another snapshot", async () => {
    const built = await harness({ label: "phase-inspect-other" });
    const encoded = await built.phases.prepareEncoded(requestFor(built));
    const other = { ...deliveryRequestFor(built), snapshot_id: "snap_other" };

    await expect(built.phases.inspectEncoded({ request: other, encoded }))
      .rejects.toMatchObject({ code: "ENCODED_MISMATCH" });
  });

  it("refuses when the closure is no longer the closure the film was rendered from", async () => {
    const built = await harness({ label: "phase-inspect-changed" });
    const encoded = await built.phases.prepareEncoded(requestFor(built));

    const changed = new CommittedRenderPhases({
      snapshots: {
        async readSnapshot() {
          return { ...built.closure, project_revision: built.closure.project_revision + 1 };
        },
      },
      fence: { async claimAttempt() { return true; }, async checkAttempt() { return "proceed"; }, async releaseAttempt() { /* executor owns it */ } },
      packages: built.packages,
      native_renderer: fakeRenderer(),
      upstream_root: join(built.objectRoot, "no-checkout-here"),
      object_root: built.objectRoot,
      workspace_root: built.workspace,
      qc_runner: runnerOf({}),
      pin_verifier: async () => ({
        ok: true, reason: "stated", checked: [], missing: [], mismatched: [],
        upstream_root: built.objectRoot, observed_sha: RENDER_PIN.upstream_sha,
        expected_sha: RENDER_PIN.upstream_sha, worker_sha256: RENDER_PIN.worker_sha256,
      }),
    });

    await expect(changed.inspectEncoded({ request: deliveryRequestFor(built), encoded }))
      .rejects.toMatchObject({ code: "CLOSURE_CHANGED" });
  });

  it("blocks when the decoder refuses the file", async () => {
    const built = await harness({ label: "phase-inspect-blocked", qc: { decode: { code: 1, stderr: "Invalid data found when processing input\n" } } });
    const encoded = await built.phases.prepareEncoded(requestFor(built));
    const qc = await built.phases.inspectEncoded({ request: deliveryRequestFor(built), encoded });

    expect(qc.technical_status).toBe("block");
    expect(qc.qc_items.find((item) => item.id === "media_full_decode")?.status).toBe("block");
  });
});

describe("publishing from the encoded and inspected bytes", () => {
  it("refuses a successful publication result if durable cancellation arrives during cleanup", async () => {
    const built = await harness({ label: "phase-publish-cleanup-cancel" });
    const encoded = await built.phases.prepareEncoded(requestFor(built));
    const qc = await built.phases.inspectEncoded({ request: deliveryRequestFor(built), encoded });
    const original = built.packages.discardStaging.bind(built.packages);
    const spy = vi.spyOn(built.packages, "discardStaging").mockImplementation(async path => {
      await original(path); built.setVerdict("cancelled");
    });
    try {
      await expect(built.phases.publishValidated({ request: deliveryRequestFor(built), encoded, qc }))
        .rejects.toMatchObject({ code: "ATTEMPT_CANCELLED" });
    } finally { spy.mockRestore(); await built.phases.close(); }
  });

  it("refuses a legacy winner without lineage and preserves its verified files", async () => {
    const built = await harness({ label: "phase-legacy-winner" });
    const encoded = await built.phases.prepareEncoded(requestFor(built));
    const qc = await built.phases.inspectEncoded({ request: deliveryRequestFor(built), encoded });
    const original = built.packages.publish.bind(built.packages);
    let legacy: Awaited<ReturnType<PublishedPackageStore['publish']>> | undefined;
    // Create the actual old package layout through the real immutable package
    // store; only the newly added phase lineage supplement is deliberately absent.
    const spy = vi.spyOn(built.packages, "publish").mockImplementation(async input => {
      const lineage = input.files.find(file => file.name === "phase_lineage.json");
      legacy = await original({ ...input, files: input.files.filter(file => file.name !== "phase_lineage.json"),
        manifest: { ...input.manifest, supplement_refs: input.manifest.supplement_refs.filter(ref => ref.id !== lineage?.id) } });
      return legacy;
    });
    try {
      await expect(built.phases.publishValidated({ request: deliveryRequestFor(built), encoded, qc }))
        .rejects.toMatchObject({ code: "PACKAGE_LINEAGE_CONFLICT" });
    } finally { spy.mockRestore(); }
    expect(legacy).toBeDefined();
    await expect(built.phases.publishValidated({ request: deliveryRequestFor(built, 2), encoded, qc }))
      .rejects.toMatchObject({ code: "PACKAGE_LINEAGE_CONFLICT" });
    expect(await built.packages.verifyPackage(legacy!.package_id)).toEqual(legacy!.receipt);
    await built.phases.close();
  });

  it.each(["different media", "different encoder parent", "different QC parent"] as const)("refuses an existing winner with %s without relabelling or replacing it", async mode => {
    let rendered = 0;
    const built = await harness({ label: "phase-winner-lineage-" + mode.replaceAll(" ", "-"), renderer: {
      async render(request) { await writeFile(request.out_path, mode === "different media" ? `film-${++rendered}` : "same film bytes");
        return { out_path: request.out_path, lines: [], elapsed_ms: 1 }; },
    } });
    const encoded = await built.phases.prepareEncoded(requestFor(built));
    const qc = await built.phases.inspectEncoded({ request: deliveryRequestFor(built), encoded });
    const winner = await built.phases.publishValidated({ request: deliveryRequestFor(built), encoded, qc });
    const nextEncoded = mode === "different QC parent" ? encoded : await built.phases.prepareEncoded(requestFor(built, 2));
    const nextQc = await built.phases.inspectEncoded({ request: deliveryRequestFor(built, 2), encoded: nextEncoded });
    if (mode === "different media") expect(nextEncoded.media_ref.sha256).not.toBe(encoded.media_ref.sha256);
    else expect(nextEncoded.media_ref.sha256).toBe(encoded.media_ref.sha256);
    if (mode === "different encoder parent") expect(nextEncoded.receipt_digest).not.toBe(encoded.receipt_digest);
    expect(nextQc.receipt_digest).not.toBe(qc.receipt_digest);
    await expect(built.phases.publishValidated({ request: deliveryRequestFor(built, 2), encoded: nextEncoded, qc: nextQc }))
      .rejects.toMatchObject({ code: "PACKAGE_LINEAGE_CONFLICT" });
    expect(await built.packages.verifyPackage(winner.package_receipt.package_id)).toEqual(winner.package_receipt);
    await built.phases.close();
  });

  it("replays the same verified parent chain under a later publication lease", async () => {
    const built = await harness({ label: "phase-winner-same-lineage" });
    const encoded = await built.phases.prepareEncoded(requestFor(built));
    const qc = await built.phases.inspectEncoded({ request: deliveryRequestFor(built), encoded });
    const first = await built.phases.publishValidated({ request: deliveryRequestFor(built), encoded, qc });
    const replay = await built.phases.publishValidated({ request: deliveryRequestFor(built, 2), encoded, qc });
    expect(replay.package_receipt).toEqual(first.package_receipt);
    expect(replay.parent_encoded_digest).toBe(first.parent_encoded_digest);
    expect(replay.parent_qc_digest).toBe(first.parent_qc_digest);
    expect(replay.publication_lease_attempt).toBe(2);
    const lineage = replay.package_receipt.files.find(file => file.file === "phase_lineage.json");
    expect(lineage).toBeDefined();
    expect(replay.package_receipt.manifest.supplement_refs).toContainEqual({ id: lineage!.id, version: 1, sha256: lineage!.sha256 });
    await built.phases.close();
  });

  it("publishes one package and returns a receipt that names it", async () => {
    const built = await harness({ label: "phase-publish" });
    const encoded = await built.phases.prepareEncoded(requestFor(built));
    const qc = await built.phases.inspectEncoded({ request: deliveryRequestFor(built), encoded });

    const published = await built.phases.publishValidated({ request: deliveryRequestFor(built), encoded, qc });

    expect(published.format).toBe("narralens.published-phase-receipt@1");
    expect(published.parent_encoded_digest).toBe(encoded.receipt_digest);
    expect(published.parent_qc_digest).toBe(qc.receipt_digest);
    expect(published.publication_lease_attempt).toBe(1);
    expect(published.package_receipt.kind).toBe("narralens.delivery_package_receipt@1.0");
    expect(published.package_receipt.manifest.delivery_id).toBe(published.package_receipt.delivery_id);
    expect(published.receipt_digest).toBe(phaseReceiptDigest(published));
  });

  it("publishes the very bytes the encoder produced", async () => {
    const built = await harness({ label: "phase-publish-bytes" });
    const encoded = await built.phases.prepareEncoded(requestFor(built));
    const qc = await built.phases.inspectEncoded({ request: deliveryRequestFor(built), encoded });

    const published = await built.phases.publishValidated({ request: deliveryRequestFor(built), encoded, qc });

    const media = published.package_receipt.files.find((file) => file.file === "media.mp4");
    expect(media?.sha256).toBe(encoded.media_ref.sha256);
    const resolved = await built.packages.resolveDownloadRef(published.package_receipt.download_ref, "proj_media_01");
    const names = resolved?.receipt.files.map((file) => file.file) ?? [];
    expect(names).toContain("native_film.html");
    expect(names).toContain("native_source.json");
    expect(names).toContain("ffprobe.json");
    expect(names).toContain("full_decode.log");
  });

  it("does not publish a blocked inspection", async () => {
    const built = await harness({ label: "phase-publish-blocked", qc: { decode: { code: 1, stderr: "Invalid data found when processing input\n" } } });
    const encoded = await built.phases.prepareEncoded(requestFor(built));
    const qc = await built.phases.inspectEncoded({ request: deliveryRequestFor(built), encoded });

    await expect(built.phases.publishValidated({ request: deliveryRequestFor(built), encoded, qc }))
      .rejects.toMatchObject({ code: "QC_BLOCKED" });
  });

  it("does not publish a warning that has no recorded decision", async () => {
    const built = await harness({ label: "phase-publish-warn" });
    const encoded = await built.phases.prepareEncoded(requestFor(built));
    const qc = await built.phases.inspectEncoded({ request: deliveryRequestFor(built), encoded });

    const warned: QCItem = { id: "quality_warning", status: "warn", reason: "a person has to look at this", evidence_ref: null };
    const content = { ...qc, qc_items: [...qc.qc_items, warned] };
    const withWarning: QcReceiptV1 = { ...content, receipt_digest: phaseReceiptDigest(content) };

    await expect(built.phases.publishValidated({ request: deliveryRequestFor(built, 1, []), encoded, qc: withWarning }))
      .rejects.toMatchObject({ code: "QC_DISPOSITION_MISSING" });
  });

  it("publishes a warned inspection when the decision is recorded", async () => {
    const built = await harness({ label: "phase-publish-warn-ok" });
    const encoded = await built.phases.prepareEncoded(requestFor(built));
    const qc = await built.phases.inspectEncoded({ request: deliveryRequestFor(built), encoded });

    const warned: QCItem = { id: "quality_warning", status: "warn", reason: "a person has to look at this", evidence_ref: null };
    const content = { ...qc, qc_items: [...qc.qc_items, warned] };
    const withWarning: QcReceiptV1 = { ...content, receipt_digest: phaseReceiptDigest(content) };

    const published = await built.phases.publishValidated({
      request: deliveryRequestFor(built, 1, ["output_space", "quality_warning"]),
      encoded,
      qc: withWarning,
    });
    expect(published.package_receipt.manifest.qc.some((item) => item.id === "quality_warning")).toBe(true);
  });

  it("refuses an inspection receipt that is not about this encoded fact", async () => {
    const built = await harness({ label: "phase-publish-parent" });
    const encoded = await built.phases.prepareEncoded(requestFor(built));
    const qc = await built.phases.inspectEncoded({ request: deliveryRequestFor(built), encoded });

    const content = { ...qc, parent_encoded_digest: "b".repeat(64) };
    const other: QcReceiptV1 = { ...content, receipt_digest: phaseReceiptDigest(content) };

    await expect(built.phases.publishValidated({ request: deliveryRequestFor(built), encoded, qc: other }))
      .rejects.toMatchObject({ code: "QC_PARENT_MISMATCH" });
  });

  it("publishes under another job and another lease without changing the encoded fact", async () => {
    const built = await harness({ label: "phase-publish-lease" });
    const encoded = await built.phases.prepareEncoded(requestFor(built));
    const qc = await built.phases.inspectEncoded({ request: deliveryRequestFor(built), encoded });

    const published = await built.phases.publishValidated({ request: deliveryRequestFor(built, 7), encoded, qc });

    expect(published.publication_lease_attempt).toBe(7);
    expect(published.package_receipt.attempt).toBe(7);
    expect(encoded.job_id).toBe("job_render_01");
    expect(published.package_receipt.manifest.delivery_id).toBe(published.package_receipt.delivery_id);
  });
});

describe("the phase object resolver", () => {
  it("opens a file of an object and reads it in bounded pieces", async () => {
    const built = await harness({ label: "phase-resolver" });
    const encoded = await built.phases.prepareEncoded(requestFor(built));
    const media = encoded.files.find((file) => file.role === "media");
    if (media === undefined) throw new Error("the encoded object holds no media");

    const handle = await built.phases.openPhaseObject({
      object_id: encoded.media_object_id,
      relative_path: media.relative_path,
      sha256: media.sha256,
      bytes: media.bytes,
    });
    const bytes = await handle.read({ offset: 0, length: media.bytes });

    expect(bytes.byteLength).toBe(media.bytes);
    expect(handle.sha256).toBe(media.sha256);
    await handle.close();
    await handle.close();
  });

  it("refuses a read that is larger than the bound", async () => {
    const built = await harness({ label: "phase-resolver-bound" });
    const encoded = await built.phases.prepareEncoded(requestFor(built));
    const media = encoded.files.find((file) => file.role === "media");
    if (media === undefined) throw new Error("the encoded object holds no media");

    const handle = await built.phases.openPhaseObject({
      object_id: encoded.media_object_id,
      relative_path: media.relative_path,
      sha256: media.sha256,
      bytes: media.bytes,
    });
    await expect(handle.read({ offset: 0, length: PHASE_OBJECT_MAX_READ_BYTES + 1 }))
      .rejects.toMatchObject({ code: "READ_TOO_LARGE" });
    await handle.close();
  });

  it("refuses a file that is not the bytes it was recorded to be", async () => {
    const built = await harness({ label: "phase-resolver-hash" });
    const encoded = await built.phases.prepareEncoded(requestFor(built));
    const media = encoded.files.find((file) => file.role === "media");
    if (media === undefined) throw new Error("the encoded object holds no media");

    await expect(built.phases.openPhaseObject({
      object_id: encoded.media_object_id,
      relative_path: media.relative_path,
      sha256: "c".repeat(64),
      bytes: media.bytes,
    })).rejects.toMatchObject({ code: "OBJECT_DIGEST_CHANGED" });
  });

  it("refuses a path that walks out of the object", async () => {
    const built = await harness({ label: "phase-resolver-escape" });
    const encoded = await built.phases.prepareEncoded(requestFor(built));
    const media = encoded.files.find((file) => file.role === "media");
    if (media === undefined) throw new Error("the encoded object holds no media");

    await expect(built.phases.openPhaseObject({
      object_id: encoded.media_object_id,
      relative_path: "../../../etc/passwd",
      sha256: media.sha256,
      bytes: media.bytes,
    })).rejects.toMatchObject({ code: "RELATIVE_PATH_REJECTED" });
  });

  it("refuses an object id that is not a plain name", async () => {
    const built = await harness({ label: "phase-resolver-id" });

    await expect(built.phases.openPhaseObject({
      object_id: "../../etc",
      relative_path: "media.mp4",
      sha256: "d".repeat(64),
      bytes: 1,
    })).rejects.toMatchObject({ code: "OBJECT_ID_REJECTED" });
  });
});

describe("the objects a phase leaves behind", () => {
  it("keeps a published object when the service is closed", async () => {
    const built = await harness({ label: "phase-close" });
    const encoded = await built.phases.prepareEncoded(requestFor(built));

    await built.phases.close();

    const info = await stat(resolve(built.objectRoot, "objects", encoded.media_object_id, "media.mp4"));
    expect(info.isFile()).toBe(true);
  });

  it("keeps the encoded object when a later stage fails", async () => {
    const built = await harness({ label: "phase-close-failure", qc: { decode: { code: 1, stderr: "Invalid data found when processing input\n" } } });
    const encoded = await built.phases.prepareEncoded(requestFor(built));
    const qc = await built.phases.inspectEncoded({ request: deliveryRequestFor(built), encoded });

    await expect(built.phases.publishValidated({ request: deliveryRequestFor(built), encoded, qc }))
      .rejects.toBeInstanceOf(CommittedRenderPhaseError);

    const info = await stat(resolve(built.objectRoot, "objects", encoded.media_object_id, "media.mp4"));
    expect(info.isFile()).toBe(true);
  });

  it("holds no descriptor across the phases", async () => {
    const built = await harness({ label: "phase-no-fd" });
    const encoded = await built.phases.prepareEncoded(requestFor(built));
    const qc = await built.phases.inspectEncoded({ request: deliveryRequestFor(built), encoded });
    await built.phases.publishValidated({ request: deliveryRequestFor(built), encoded, qc });

    // Nothing is left open: closing the service succeeds.
    await expect(built.phases.close()).resolves.toBeUndefined();
  });
});

/**
 * Review batch 1 — the four gaps MAIN found in the source review.
 *
 * These cases are written against the *behaviour* the review asked for, not against an
 * internal shape, so they can be run against the old candidate to show the gap and
 * against the corrected one to show it is closed. Each case is labelled with the gap
 * it belongs to.
 */

async function openDescriptorCount(): Promise<number> {
  const { readdir } = await import("node:fs/promises");
  return (await readdir("/proc/self/fd")).length;
}

describe("MP01 — a closure digest over a fractional duration", () => {
  it("computes a digest for a duration that is not a whole number of seconds", async () => {
    const built = await harness({ label: "mp01-fractional" });
    const fractional: SnapshotClosure = {
      ...built.closure,
      expected_frames: 91,
      expected_duration_seconds: 91 / 30,
    };
    const rate = { numerator: 30, denominator: 1 };

    expect(() => closureDigestOf(fractional, rate)).not.toThrow();
    const digest = closureDigestOf(fractional, rate);
    expect(digest).toBe(closureDigestOf({ ...fractional }, rate));
    // A different number of frames is a different film, and it is digested as such.
    expect(digest).not.toBe(closureDigestOf({ ...fractional, expected_frames: 92, expected_duration_seconds: 92 / 30 }, rate));
  });

  it("computes a digest for a film of one frame at 30 fps", async () => {
    const built = await harness({ label: "mp01-one-frame-30" });
    const oneFrame: SnapshotClosure = {
      ...built.closure,
      expected_frames: 1,
      expected_duration_seconds: 1 / 30,
    };
    const rate = { numerator: 30, denominator: 1 };

    expect(() => closureDigestOf(oneFrame, rate)).not.toThrow();
    expect(closureDigestOf(oneFrame, rate)).toBe(closureDigestOf({ ...oneFrame }, rate));
  });

  it("computes a digest for a film of one frame at 30000/1001", async () => {
    const built = await harness({ label: "mp01-one-frame-rational" });
    const oneFrame: SnapshotClosure = {
      ...built.closure,
      expected_frames: 1,
      expected_duration_seconds: 1001 / 30000,
    };
    const rate = { numerator: 30000, denominator: 1001 };

    expect(() => closureDigestOf(oneFrame, rate)).not.toThrow();
    expect(closureDigestOf(oneFrame, rate)).toBe(closureDigestOf({ ...oneFrame }, rate));
  });

  it("does not carry the stated seconds into the digest", async () => {
    const built = await harness({ label: "mp01-no-float" });
    const closure: SnapshotClosure = { ...built.closure, expected_frames: 60, expected_duration_seconds: 2 };
    const rate = { numerator: 30, denominator: 1 };

    // The seconds are checked, not hashed: a difference far below one frame does not
    // change the digest, and a difference above one frame is refused outright.
    expect(closureDigestOf({ ...closure, expected_duration_seconds: 2.0000001 }, rate))
      .toBe(closureDigestOf(closure, rate));
    let code: string | undefined;
    try {
      closureDigestOf({ ...closure, expected_duration_seconds: 92 / 30 }, rate);
    } catch (error) {
      code = (error as { code?: string }).code;
    }
    expect(code).toBe("CLOSURE_DURATION_INCONSISTENT");
  });

  it("encodes and inspects a film whose frame rate is a rational number", async () => {
    const built = await harness({ label: "mp01-rational-fps" });
    const rational = renderSpec({
      fps_numerator: 30000,
      fps_denominator: 1001,
      config_digest: computeRenderConfigDigest({
        render_spec: renderSpec({ fps_numerator: 30000, fps_denominator: 1001 }),
        upstream_sha: RENDER_PIN.upstream_sha,
        worker_sha256: RENDER_PIN.worker_sha256,
      }),
    });
    const closure: SnapshotClosure = {
      ...built.closure,
      expected_frames: 91,
      expected_duration_seconds: (91 * 1001) / 30000,
    };
    const phases = new CommittedRenderPhases({
      snapshots: { async readSnapshot() { return closure; } },
      fence: { async claimAttempt() { return true; }, async checkAttempt() { return "proceed"; }, async releaseAttempt() { /* executor owns it */ } },
      packages: built.packages,
      native_renderer: fakeRenderer(),
      upstream_root: join(built.objectRoot, "no-checkout-here"),
      object_root: built.objectRoot,
      workspace_root: built.workspace,
      qc_runner: runnerOf({}),
      pin_verifier: async () => ({
        ok: true, reason: "stated", checked: [], missing: [], mismatched: [],
        upstream_root: built.objectRoot, observed_sha: RENDER_PIN.upstream_sha,
        expected_sha: RENDER_PIN.upstream_sha, worker_sha256: RENDER_PIN.worker_sha256,
      }),
    });
    const request = { ...requestFor(built), render_spec: rational };

    const encoded = await phases.prepareEncoded(request);
    expect(encoded.fps_numerator).toBe(30000);
    expect(encoded.fps_denominator).toBe(1001);
    const qc = await phases.inspectEncoded({ request, encoded });
    expect(qc.parent_encoded_digest).toBe(encoded.receipt_digest);
  });
});

describe("MP02 — the resolver may not be walked out of, nor serve changed bytes", () => {
  it("releases every opened root descriptor when an ancestor alias is rejected", async () => {
    const built = await harness({ label: "mp02-ancestor-alias-fds" });
    const fsRoot = await import("node:fs/promises");
    await fsRoot.mkdir(built.objectRoot, { recursive: true });
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const alias = join(await directory("mp02-alias-container"), "parent");
    await fs.symlink(path.dirname(built.objectRoot), alias);
    const aliased = new CommittedRenderPhases({
      snapshots: { async readSnapshot() { return built.closure; } },
      fence: { async claimAttempt() { return true; }, async checkAttempt() { return "proceed"; }, async releaseAttempt() {} },
      packages: built.packages, native_renderer: fakeRenderer(),
      upstream_root: join(built.objectRoot, "no-checkout-here"),
      object_root: join(alias, path.basename(built.objectRoot)), workspace_root: built.workspace,
      qc_runner: runnerOf({}),
    });
    const owned = async () => {
      const links = await Promise.all((await fs.readdir("/proc/self/fd")).map(async (fd) => {
        try { return await fs.readlink(`/proc/self/fd/${fd}`); } catch { return ""; }
      }));
      return links.filter((link) => link === built.objectRoot).length;
    };
    const before = await owned();
    for (let i = 0; i < 6; i += 1) {
      await expect(aliased.openPhaseObject({ object_id: "obj_probe",
        relative_path: "media.mp4", sha256: "0".repeat(64), bytes: 1,
      })).rejects.toMatchObject({ code: "OBJECT_ROOT_ALIASED" });
    }
    expect(await owned()).toBe(before);
    await aliased.close();
    await built.phases.close();
  });

  it("refuses an object root that is an alias of the real root", async () => {
    const built = await harness({ label: "mp02-alias-root" });
    const encoded = await built.phases.prepareEncoded(requestFor(built));
    const media = encoded.files.find((file) => file.role === "media");
    if (media === undefined) throw new Error("the encoded object holds no media");

    const alias = join(built.objectRoot, "alias-root");
    await import("node:fs/promises").then((fs) => fs.symlink(built.objectRoot, alias));
    const aliased = new CommittedRenderPhases({
      snapshots: { async readSnapshot() { return built.closure; } },
      fence: { async claimAttempt() { return true; }, async checkAttempt() { return "proceed"; }, async releaseAttempt() { /* executor owns it */ } },
      packages: built.packages,
      native_renderer: fakeRenderer(),
      upstream_root: join(built.objectRoot, "no-checkout-here"),
      object_root: alias,
      workspace_root: built.workspace,
      qc_runner: runnerOf({}),
      pin_verifier: async () => ({
        ok: true, reason: "stated", checked: [], missing: [], mismatched: [],
        upstream_root: built.objectRoot, observed_sha: RENDER_PIN.upstream_sha,
        expected_sha: RENDER_PIN.upstream_sha, worker_sha256: RENDER_PIN.worker_sha256,
      }),
    });

    await expect(aliased.openPhaseObject({
      object_id: encoded.media_object_id,
      relative_path: media.relative_path,
      sha256: media.sha256,
      bytes: media.bytes,
    })).rejects.toBeTruthy();
  });

  it("refuses an object that is a symlink", async () => {
    const built = await harness({ label: "mp02-alias-object" });
    const encoded = await built.phases.prepareEncoded(requestFor(built));
    const media = encoded.files.find((file) => file.role === "media");
    if (media === undefined) throw new Error("the encoded object holds no media");

    const fs = await import("node:fs/promises");
    const objects = resolve(built.objectRoot, "objects");
    const elsewhere = join(built.objectRoot, "elsewhere");
    await fs.mkdir(elsewhere, { recursive: true, mode: 0o700 });
    await fs.copyFile(resolve(objects, encoded.media_object_id, media.relative_path), join(elsewhere, media.relative_path));
    await fs.symlink(elsewhere, join(objects, "obj_alias"));

    await expect(built.phases.openPhaseObject({
      object_id: "obj_alias",
      relative_path: media.relative_path,
      sha256: media.sha256,
      bytes: media.bytes,
    })).rejects.toBeTruthy();
  });

  it("refuses a file that lives under a symlinked directory inside the object", async () => {
    const built = await harness({ label: "mp02-alias-parent" });
    const encoded = await built.phases.prepareEncoded(requestFor(built));
    const media = encoded.files.find((file) => file.role === "media");
    if (media === undefined) throw new Error("the encoded object holds no media");

    const fs = await import("node:fs/promises");
    const objects = resolve(built.objectRoot, "objects");
    const elsewhere = join(built.objectRoot, "elsewhere-parent");
    await fs.mkdir(elsewhere, { recursive: true, mode: 0o700 });
    await fs.copyFile(resolve(objects, encoded.media_object_id, media.relative_path), join(elsewhere, media.relative_path));
    await fs.symlink(elsewhere, resolve(objects, encoded.media_object_id, "nested"));

    await expect(built.phases.openPhaseObject({
      object_id: encoded.media_object_id,
      relative_path: `nested/${media.relative_path}`,
      sha256: media.sha256,
      bytes: media.bytes,
    })).rejects.toBeTruthy();
  });

  it("refuses to serve bytes that were changed in place after the file was opened", async () => {
    const built = await harness({ label: "mp02-in-place" });
    const encoded = await built.phases.prepareEncoded(requestFor(built));
    const media = encoded.files.find((file) => file.role === "media");
    if (media === undefined) throw new Error("the encoded object holds no media");

    const handle = await built.phases.openPhaseObject({
      object_id: encoded.media_object_id,
      relative_path: media.relative_path,
      sha256: media.sha256,
      bytes: media.bytes,
    });
    const path = resolve(built.objectRoot, "objects", encoded.media_object_id, media.relative_path);
    const original = await readFile(path);
    const tampered = Buffer.from(original);
    tampered[0] = tampered[0] === 0x00 ? 0x01 : 0x00;
    await import("node:fs/promises").then((fs) => fs.writeFile(path, tampered));

    await expect(handle.read({ offset: 0, length: media.bytes })).rejects.toMatchObject({ code: "OBJECT_MUTATED" });
    await handle.close();
  });

  it("leaks no descriptor when close runs while an open is still hashing", async () => {
    const built = await harness({ label: "mp02-close-race" });
    const fs = await import("node:fs/promises");
    const objects = resolve(built.objectRoot, "objects");
    const objectId = "obj_slow";
    await fs.mkdir(resolve(objects, objectId), { recursive: true, mode: 0o700 });
    const big = resolve(objects, objectId, "big.bin");
    await fs.writeFile(big, Buffer.alloc(0));
    await fs.truncate(big, 32 * 1024 * 1024);
    const digest = (await import("node:crypto")).createHash("sha256")
      .update(await fs.readFile(big)).digest("hex");

    const before = await openDescriptorCount();
    const opening = built.phases.openPhaseObject({
      object_id: objectId,
      relative_path: "big.bin",
      sha256: digest,
      bytes: 32 * 1024 * 1024,
    });
    await built.phases.close();
    const handle = await opening;
    try {
      // The service closed the descriptor it opened while the close was running.
      expect(await openDescriptorCount()).toBe(before);
    } finally {
      await handle.close();
    }
  });
});

describe("MP03 — the actual bytes of the promised supplements are checked", () => {
  it("refuses an encoded object whose actual subtitle bytes changed", async () => {
    const built = await harness({ label: "mp03-corrupt-subtitle" });
    const encoded = await built.phases.prepareEncoded(requestFor(built));
    const subtitle = encoded.files.find((file) => file.role === "subtitles");
    if (subtitle === undefined) throw new Error("the encoded object holds no subtitles");

    const path = resolve(built.objectRoot, "objects", encoded.media_object_id, subtitle.relative_path);
    const original = await readFile(path);
    const tampered = Buffer.from(original);
    tampered[0] = tampered[0] === 0x31 ? 0x32 : 0x31;
    await import("node:fs/promises").then((fs) => fs.writeFile(path, tampered));

    await expect(built.phases.inspectEncoded({ request: deliveryRequestFor(built), encoded }))
      .rejects.toBeTruthy();
  });

  it("refuses an encoded object whose actual licence file is missing", async () => {
    const built = await harness({ label: "mp03-missing-licence" });
    const encoded = await built.phases.prepareEncoded(requestFor(built));
    const licence = encoded.files.find((file) => file.role === "rights");
    if (licence === undefined) throw new Error("the encoded object holds no licence");

    await import("node:fs/promises").then((fs) => fs.rm(resolve(built.objectRoot, "objects", encoded.media_object_id, licence.relative_path)));

    await expect(built.phases.inspectEncoded({ request: deliveryRequestFor(built), encoded }))
      .rejects.toBeTruthy();
  });

  it("refuses an encoded object whose supplements were reordered", async () => {
    const built = await harness({ label: "mp03-reordered" });
    const encoded = await built.phases.prepareEncoded(requestFor(built));
    const supplements = encoded.files.filter((file) => file.role === "rights" || file.role === "subtitles");
    if (supplements.length < 2) throw new Error("the encoded object holds no pair of supplements");

    const reordered = { ...encoded, files: [...encoded.files.filter((file) => file.role !== "rights" && file.role !== "subtitles"), supplements[1]!, supplements[0]!] };
    const tampered: EncodedFactV1 = { ...reordered, receipt_digest: phaseReceiptDigest(reordered) };

    await expect(built.phases.inspectEncoded({ request: deliveryRequestFor(built), encoded: tampered }))
      .rejects.toBeTruthy();
  });
});

describe("MP04 — the object carries a durable receipt and the cleanup is honest", () => {
  it("preserves the primary publication failure and a failed staging discard", async () => {
    const built = await harness({ label: "phase-cleanup-two-failures" });
    const encoded = await built.phases.prepareEncoded(requestFor(built));
    const qc = await built.phases.inspectEncoded({ request: deliveryRequestFor(built), encoded });
    const create = built.packages.createStaging.bind(built.packages);
    const discarded = built.packages.discardStaging.bind(built.packages);
    const created: string[] = [];
    const createSpy = vi.spyOn(built.packages, "createStaging").mockImplementation(async token => {
      const path = await create(token); created.push(path); built.setVerdict("cancelled"); return path;
    });
    const discardSpy = vi.spyOn(built.packages, "discardStaging").mockRejectedValue(Object.assign(new Error("discard denied"), { code: "EACCES" }));
    let failure: unknown;
    try {
      try { await built.phases.publishValidated({ request: deliveryRequestFor(built), encoded, qc }); } catch (error) { failure = error; }
      expect(failure).toMatchObject({ code: "PHASE_CLEANUP_FAILED", requires_reconciliation: true });
      expect((failure as { errors: unknown[] }).errors).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "ATTEMPT_CANCELLED" }), expect.objectContaining({ code: "EACCES" }),
      ]));
    } finally {
      createSpy.mockRestore(); discardSpy.mockRestore();
      for (const path of created) await discarded(path);
      await built.phases.close();
    }
  });

  it("preserves the primary QC failure and an actual object-staging removal failure", async () => {
    const built = await harness({ label: "phase-qc-cleanup-two-failures" });
    const encoded = await built.phases.prepareEncoded(requestFor(built));
    const fs = await import("node:fs/promises"), runner = runnerOf({});
    let qcFinished = false, injected = false;
    const denied: string[] = [];
    const phases = new CommittedRenderPhases({
      snapshots: { async readSnapshot() { return built.closure; } },
      fence: { async claimAttempt() { return true; }, async releaseAttempt() {}, async checkAttempt() {
        if (qcFinished) for (const name of await fs.readdir(resolve(built.objectRoot, "staging"))) {
          const staged = resolve(built.objectRoot, "staging", name);
          if ((await fs.readdir(staged)).includes("receipt.json")) {
            await fs.chmod(staged, 0o500); denied.push(staged); injected = true; return "cancelled";
          }
        }
        return "proceed";
      } },
      packages: built.packages, native_renderer: fakeRenderer(), upstream_root: join(built.objectRoot, "absent-checkout"),
      object_root: built.objectRoot, workspace_root: built.workspace,
      qc_runner: { async run(...args) { const result = await runner.run(...args); if (args[0] === "ffmpeg") qcFinished = true; return result; } },
      pin_verifier: async () => ({ ok: true, reason: "module fixture", checked: [], missing: [], mismatched: [],
        upstream_root: built.objectRoot, observed_sha: RENDER_PIN.upstream_sha, expected_sha: RENDER_PIN.upstream_sha, worker_sha256: RENDER_PIN.worker_sha256 }),
    });
    let failure: unknown;
    try {
      try { await phases.inspectEncoded({ request: deliveryRequestFor(built), encoded }); } catch (error) { failure = error; }
      expect(injected).toBe(true);
      expect(failure).toMatchObject({ code: "PHASE_CLEANUP_FAILED", requires_reconciliation: true });
      expect((failure as { errors: unknown[] }).errors).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "ATTEMPT_CANCELLED" }), expect.objectContaining({ code: "EACCES" }),
      ]));
    } finally {
      for (const path of denied) await fs.chmod(path, 0o700).catch(() => undefined);
      await phases.close(); await built.phases.close();
    }
  });

  it.each(["encode", "qc"] as const)("refuses a %s result when cancellation arrives during object publication fsync", async phase => {
    const built = await harness({ label: "phase-object-postsync-" + phase });
    const encoded = phase === "qc" ? await built.phases.prepareEncoded(requestFor(built)) : undefined;
    const fs = await import("node:fs/promises");
    const probe = await fs.open(built.objectRoot, "r");
    const prototype = Object.getPrototypeOf(probe); await probe.close();
    const original = prototype.sync;
    let crossed = false;
    const spy = vi.spyOn(prototype, "sync").mockImplementation(async function(this: { fd: number }, ...args: unknown[]) {
      const target = await fs.readlink(`/proc/self/fd/${this.fd}`);
      const result = await Reflect.apply(original, this, args);
      if (target === resolve(built.objectRoot, "objects")) { crossed = true; built.setVerdict("cancelled"); }
      return result;
    });
    try {
      const result = phase === "encode" ? built.phases.prepareEncoded(requestFor(built))
        : built.phases.inspectEncoded({ request: deliveryRequestFor(built), encoded: encoded! });
      await expect(result).rejects.toMatchObject({ code: "ATTEMPT_CANCELLED" });
      expect(crossed).toBe(true);
      // A durable private orphan is retained, never presented as a successful fact.
      expect((await fs.readdir(resolve(built.objectRoot, "objects"))).length).toBe(phase === "encode" ? 1 : 2);
    } finally { spy.mockRestore(); await built.phases.close(); }
  });

  it("refuses new reads on returned handles while another open is pending at service close", async () => {
    const built = await harness({ label: "mp04-pending-open-read-gate" });
    const encoded = await built.phases.prepareEncoded(requestFor(built));
    const media = encoded.files.find(file => file.role === "media")!;
    const input = { object_id: encoded.media_object_id, relative_path: media.relative_path, sha256: media.sha256, bytes: media.bytes };
    const returned = await built.phases.openPhaseObject(input);
    const fs = await import("node:fs/promises");
    const probe = await fs.open(resolve(built.objectRoot, "objects", encoded.media_object_id, media.relative_path), "r");
    const prototype = Object.getPrototypeOf(probe); await probe.close();
    const original = prototype.read;
    let enter!: () => void, release!: () => void, armed = true;
    const entered = new Promise<void>(done => { enter = done; });
    const gate = new Promise<void>(done => { release = done; });
    const spy = vi.spyOn(prototype, "read").mockImplementation(function(this: unknown, ...args: unknown[]) {
      if (armed) { armed = false; enter(); return gate.then(() => Reflect.apply(original, this, args)); }
      return Reflect.apply(original, this, args);
    });
    const opening = built.phases.openPhaseObject(input);
    const observed = opening.then(handle => ({ handle }), error => ({ error }));
    await entered;
    const first = built.phases.close(), second = built.phases.close();
    const settlements = Promise.allSettled([first, second]);
    try {
      expect(second).toBe(first);
      await expect(returned.read({ offset: 0, length: 1 })).rejects.toMatchObject({ code: "OBJECT_CLOSED" });
      release();
      const result = await observed;
      if ('handle' in result) await expect(result.handle.read({ offset: 0, length: 1 })).rejects.toMatchObject({ code: "OBJECT_CLOSED" });
      await Promise.all([first, second]);
    } finally { release(); await observed; await settlements; spy.mockRestore(); }
  });

  it.each(["handle", "service"] as const)("shares the %s close barrier and waits for an in-flight descriptor read", async owner => {
    const built = await harness({ label: "mp04-read-barrier-" + owner });
    const encoded = await built.phases.prepareEncoded(requestFor(built));
    const media = encoded.files.find(file => file.role === "media")!;
    const handle = await built.phases.openPhaseObject({ object_id: encoded.media_object_id,
      relative_path: media.relative_path, sha256: media.sha256, bytes: media.bytes });
    const fs = await import("node:fs/promises");
    const probe = await fs.open(resolve(built.objectRoot, "objects", encoded.media_object_id, media.relative_path), "r");
    const prototype = Object.getPrototypeOf(probe);
    await probe.close();
    const original = prototype.read;
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(done => { enter = done; });
    const gate = new Promise<void>(done => { release = done; });
    let armed = true;
    const spy = vi.spyOn(prototype, "read").mockImplementation(function(this: unknown, ...args: unknown[]) {
      if (armed) { armed = false; enter(); return gate.then(() => Reflect.apply(original, this, args)); }
      return Reflect.apply(original, this, args);
    });
    const reading = handle.read({ offset: 0, length: media.bytes });
    const observed = reading.then(bytes => ({ bytes }), error => ({ error }));
    await entered;
    const another = owner === "service" ? await built.phases.openPhaseObject({ object_id: encoded.media_object_id,
      relative_path: media.relative_path, sha256: media.sha256, bytes: media.bytes }) : undefined;
    const target = owner === "handle" ? handle : built.phases;
    const first = target.close(), second = target.close();
    const settled: string[] = [];
    const observers = [first.then(() => { settled.push("first"); }, () => { settled.push("first_error"); }),
      second.then(() => { settled.push("second"); }, () => { settled.push("second_error"); })];
    try {
      await new Promise<void>(done => setImmediate(done));
      expect(settled).toEqual([]);
      expect(second).toBe(first);
      if (another) await expect(another.read({ offset: 0, length: 1 })).rejects.toMatchObject({ code: "OBJECT_CLOSED" });
      release();
      expect(await observed).toHaveProperty("bytes");
      await Promise.all([first, second]);
      await expect(handle.read({ offset: 0, length: 1 })).rejects.toMatchObject({ code: "OBJECT_CLOSED" });
    } finally {
      release(); await observed; await Promise.all(observers); spy.mockRestore();
      await built.phases.close().catch(() => undefined);
    }
  });

  it("publishes an immutable receipt beside the object it describes", async () => {
    const built = await harness({ label: "mp04-receipt" });
    const encoded = await built.phases.prepareEncoded(requestFor(built));
    const objectDir = resolve(built.objectRoot, "objects", encoded.media_object_id);

    const names = await import("node:fs/promises").then((fs) => fs.readdir(objectDir));
    expect(names).toContain("receipt.json");
    const receipt = JSON.parse(await readFile(resolve(objectDir, "receipt.json"), "utf8")) as {
      object_id: string; files: Array<{ relative_path: string; sha256: string }>;
    };
    expect(receipt.object_id).toBe(encoded.media_object_id);
    const media = receipt.files.find((file) => file.relative_path === encoded.files.find((f) => f.role === "media")?.relative_path);
    expect(media?.sha256).toBe(encoded.media_ref.sha256);
  });

  it("reads the durable receipt of an object through the anchored resolver", async () => {
    const built = await harness({ label: "mp04-read-receipt" });
    const encoded = await built.phases.prepareEncoded(requestFor(built));

    const receipt = await built.phases.readObjectReceipt(encoded.media_object_id);

    expect(receipt.format).toBe("narralens.phase-object-receipt@1");
    expect(receipt.kind).toBe("encoded");
    expect(receipt.object_id).toBe(encoded.media_object_id);
    expect(receipt.project_id).toBe(encoded.project_id);
    expect(receipt.files.find((file) => file.role === "media")?.sha256).toBe(encoded.media_ref.sha256);
    expect(receipt.receipt_digest).toBe(phaseReceiptDigest(receipt));
  });

  it("keeps the object and its receipt across a restart of the service", async () => {
    const built = await harness({ label: "mp04-restart" });
    const encoded = await built.phases.prepareEncoded(requestFor(built));
    await built.phases.close();

    const restarted = new CommittedRenderPhases({
      snapshots: { async readSnapshot() { return built.closure; } },
      fence: { async claimAttempt() { return true; }, async checkAttempt() { return "proceed"; }, async releaseAttempt() { /* executor owns it */ } },
      packages: built.packages,
      native_renderer: fakeRenderer(),
      upstream_root: join(built.objectRoot, "no-checkout-here"),
      object_root: built.objectRoot,
      workspace_root: built.workspace,
      qc_runner: runnerOf({}),
      pin_verifier: async () => ({
        ok: true, reason: "stated", checked: [], missing: [], mismatched: [],
        upstream_root: built.objectRoot, observed_sha: RENDER_PIN.upstream_sha,
        expected_sha: RENDER_PIN.upstream_sha, worker_sha256: RENDER_PIN.worker_sha256,
      }),
    });

    const media = encoded.files.find((file) => file.role === "media");
    if (media === undefined) throw new Error("the encoded object holds no media");
    const handle = await restarted.openPhaseObject({
      object_id: encoded.media_object_id,
      relative_path: media.relative_path,
      sha256: media.sha256,
      bytes: media.bytes,
    });
    const bytes = await handle.read({ offset: 0, length: media.bytes });
    expect(bytes.byteLength).toBe(media.bytes);
    await handle.close();

    // The receipt of the object survived the restart and still describes it.
    const objectDir = resolve(built.objectRoot, "objects", encoded.media_object_id);
    const receipt = JSON.parse(await readFile(resolve(objectDir, "receipt.json"), "utf8")) as {
      object_id: string; files: Array<{ relative_path: string; sha256: string; bytes: number }>;
    };
    expect(receipt.object_id).toBe(encoded.media_object_id);
    expect(receipt.files.find((file) => file.relative_path === media.relative_path)?.sha256).toBe(media.sha256);
    await restarted.close();
  });

  it("reports a cleanup failure instead of swallowing it", async () => {
    const built = await harness({ label: "mp04-cleanup" });
    const locking = new CommittedRenderPhases({
      snapshots: { async readSnapshot() { return built.closure; } },
      fence: { async claimAttempt() { return true; }, async checkAttempt() { return "proceed"; }, async releaseAttempt() { /* executor owns it */ } },
      packages: built.packages,
      native_renderer: {
        async render(request: NativeRenderRequest) {
          await writeFile(request.out_path, "the rendered film", "utf8");
          // The attempt's own staging can no longer be emptied afterwards.
          await import("node:fs/promises").then((fs) => fs.chmod(request.staging_root, 0o500));
          return { out_path: request.out_path, lines: [], elapsed_ms: 1 };
        },
      },
      upstream_root: join(built.objectRoot, "no-checkout-here"),
      object_root: built.objectRoot,
      workspace_root: built.workspace,
      qc_runner: runnerOf({}),
      pin_verifier: async () => ({
        ok: true, reason: "stated", checked: [], missing: [], mismatched: [],
        upstream_root: built.objectRoot, observed_sha: RENDER_PIN.upstream_sha,
        expected_sha: RENDER_PIN.upstream_sha, worker_sha256: RENDER_PIN.worker_sha256,
      }),
    });

    try {
      await expect(locking.prepareEncoded(requestFor(built))).rejects.toBeTruthy();
    } finally {
      await import("node:fs/promises").then(async (fs) => {
        for (const entry of await fs.readdir(built.workspace).catch(() => [] as string[])) {
          await fs.chmod(resolve(built.workspace, entry), 0o700).catch(() => undefined);
        }
      });
    }
  });

  it("waits for the phases that are still running when it closes", async () => {
    const built = await harness({ label: "mp04-close-waits" });
    const order: string[] = [];

    const phase = built.phases.prepareEncoded(requestFor(built))
      .then(() => { order.push("phase"); }, () => { order.push("phase"); });
    const closing = built.phases.close().then(() => { order.push("close"); });
    await Promise.all([phase, closing]);

    expect(order).toEqual(["phase", "close"]);
  });
});

/**
 * The real tools.
 *
 * Everything above this block fakes the renderer and the media tools, and the cases
 * above are therefore *module* checks: they prove the boundaries, not the bytes. This
 * block is the other thing: the pinned OpenFilm checkout, the real renderer and the
 * real `ffprobe`/`ffmpeg` against a real committed closure.
 *
 * It is not part of the ordinary run. A real OpenFilm render drives a headless
 * browser, so it belongs to a MAIN heavy slot, and it is selected explicitly:
 *
 * ```
 * NARRALENS_PHASE_REAL_TOOLS=1 corepack pnpm exec vitest run --config vitest.config.ts \
 *   tests/agent-driven/media/committed-render-phases.test.ts --maxWorkers=1 --minWorkers=1 \
 *   -t "the real tools"
 * ```
 *
 * Nothing is installed and nothing is fetched: the pinned checkout is the read-only
 * one that is already on this machine, and the media is generated locally with the
 * `ffmpeg` that is already installed.
 */
const REAL_TOOLS = process.env.NARRALENS_PHASE_REAL_TOOLS === "1";

describe.skipIf(!REAL_TOOLS)("the real tools (NARRALENS_PHASE_REAL_TOOLS=1)", () => {
  it("encodes, inspects and publishes with the pinned renderer and the real ffprobe and ffmpeg", async () => {
    const { execFileSync } = await import("node:child_process");
    const { mkdir } = await import("node:fs/promises");
    const { vendorRoot } = await import("../integration/helpers/created-project-fixture.js");
    const { PinnedNativeDraftAssembler } = await import("../../../src/host/render/native-draft-assembler.js");
    const { NativeRenderer } = await import("../../../src/host/render/native-renderer.js");
    const { sha256Of } = await import("./support.js");
    const ffmpeg = (args: string[]): void => {
      execFileSync("ffmpeg", ["-nostdin", "-hide_banner", "-v", "error", ...args], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
    };

    const source = await directory("phase-real-source");
    const objectRoot = await directory("phase-real-objects");
    const workspace = await directory("phase-real-workspace");
    const deliveryRoot = await directory("phase-real-delivery");
    const inputs = join(source, "inputs");
    await mkdir(inputs, { recursive: true, mode: 0o700 });
    const videoPath = join(inputs, "video.mp4");
    const audioPath = join(inputs, "voice.wav");
    ffmpeg(["-f", "lavfi", "-i", "color=c=0x185a88:s=320x180:r=30:d=3", "-threads", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", videoPath]);
    ffmpeg(["-f", "lavfi", "-i", "sine=frequency=430:sample_rate=48000:duration=3", "-threads", "1", "-c:a", "pcm_s16le", audioPath]);

    const videoBytes = await readFile(videoPath);
    const audioBytes = await readFile(audioPath);
    const projectId = "proj_phase_real";
    const assets = [
      {
        project_id: projectId,
        asset_id: "asset_video",
        absolute_path: videoPath,
        sha256: sha256Of(videoBytes),
        bytes: videoBytes.byteLength,
        duration_frames: 90,
        kind: "video" as const,
        mime_type: "video/mp4",
        source: { kind: "generated" as const, label: "Locally generated diagnostic media" },
        license: { status: "cleared" as const, label: "Diagnostic fixture only", commercial_use: true },
        rights_ref: "rights_diagnostic",
        recording_origin: null,
      },
      {
        project_id: projectId,
        asset_id: "asset_voice",
        absolute_path: audioPath,
        sha256: sha256Of(audioBytes),
        bytes: audioBytes.byteLength,
        duration_frames: 90,
        kind: "audio" as const,
        mime_type: "audio/wav",
        source: { kind: "generated" as const, label: "Locally generated diagnostic media" },
        license: { status: "cleared" as const, label: "Diagnostic fixture only", commercial_use: true },
        rights_ref: "rights_diagnostic",
        recording_origin: "synthetic" as const,
      },
    ];

    // The real native draft, built by the pinned assembler from the real media.
    const assembler = new PinnedNativeDraftAssembler(vendorRoot);
    const draft = await assembler.prepare({
      project_id: projectId,
      script: { kind: "script", paragraphs: [{ paragraph_id: "p1", text: "第一条诊断内容。" }, { paragraph_id: "p2", text: "第二条诊断内容。" }, { paragraph_id: "p3", text: "原生概念说明。" }] },
      storyboard: {
        kind: "storyboard",
        fps: 30,
        shots: [
          { shot_id: "s1", paragraph_id: "p1", asset_id: "asset_video", duration_frames: 31, caption: "第一条诊断字幕。", concept_text: "" },
          { shot_id: "s2", paragraph_id: "p2", asset_id: "asset_video", duration_frames: 29, caption: "第二条诊断字幕。", concept_text: "" },
          { shot_id: "s3", paragraph_id: "p3", asset_id: null, duration_frames: 30, caption: "概念说明字幕。", concept_text: "可编辑概念" },
        ],
      },
      assets,
      narration_asset_id: "asset_voice",
      target_root: join(workspace, "native"),
      protected_roots: [source, objectRoot, deliveryRoot, vendorRoot],
      width: 320,
      height: 180,
    });

    // The committed closure of that draft. The subtitles and the licence are the two
    // supplements an A delivery always carries.
    const entries = draft.files.map((file) => {
      const isSubtitle = file.relative_path.endsWith(".vtt");
      const isRights = file.relative_path === "rights.json";
      const isAsset = file.relative_path.startsWith("assets/") && !isSubtitle;
      return {
        relative_path: file.relative_path,
        absolute_path: resolve(draft.root, file.relative_path),
        sha256: file.sha256,
        bytes: file.bytes,
        kind: isAsset ? "asset" as const : (isSubtitle || isRights) ? "supplement" as const : "native_source" as const,
        rights_ref: isAsset || isSubtitle || isRights ? "rights_diagnostic" : null,
        role: isSubtitle ? "subtitles" : isRights ? "rights" : null,
      };
    });
    const closure: SnapshotClosure = {
      project_id: projectId,
      snapshot_id: "snap_phase_real",
      source_digest: "a".repeat(64),
      project_revision: 1,
      expected_frames: draft.frame_count,
      expected_duration_seconds: draft.frame_count / 30,
      native_root: draft.root,
      native_entry: "film.html",
      entries,
      rights: [{ asset_id: "rights_diagnostic", status: "cleared", commercial_use: true, ref: "rights_diagnostic" }],
    };

    const spec = renderSpec({
      engine_version: RENDER_PIN.upstream_sha,
      width: 320,
      height: 180,
      config_digest: computeRenderConfigDigest({
        render_spec: renderSpec({ engine_version: RENDER_PIN.upstream_sha, width: 320, height: 180 }),
        upstream_sha: RENDER_PIN.upstream_sha,
        worker_sha256: RENDER_PIN.worker_sha256,
      }),
    });
    const request: RenderRequest = {
      project_id: projectId,
      job_id: "job_phase_render",
      snapshot_id: closure.snapshot_id,
      source_digest: closure.source_digest,
      render_spec: spec,
      execution: {
        run_id: "run_phase_real",
        plan_version: 1,
        step_id: "snapshot.render",
        attempt: 1,
        input_digest: closure.source_digest,
        run_scope_digest: "0".repeat(64),
        authorization_id: "auth_phase_real",
      },
      attempt: 1,
      qc_dispositions: ["output_space"],
      required_supplements: ["rights"],
      signal: undefined,
    };
    const deliveryRequest: RenderRequest = {
      ...request,
      job_id: "job_phase_delivery",
      execution: { ...request.execution, step_id: "delivery.package" },
    };

    const packages = new PublishedPackageStore({ root: deliveryRoot });
    const phases = new CommittedRenderPhases({
      snapshots: { async readSnapshot() { return closure; } },
      fence: {
        async claimAttempt() { return true; },
        async checkAttempt() { return "proceed"; },
        async releaseAttempt() { /* the executor owns the claim */ },
      },
      packages,
      // The real renderer against the pinned checkout, and no qc_runner at all, so the
      // inspection uses the real ffprobe and the real full decode.
      native_renderer: new NativeRenderer({ upstream_root: vendorRoot }),
      upstream_root: vendorRoot,
      object_root: objectRoot,
      workspace_root: workspace,
      render_timeout_ms: 600000,
      qc_timeout_ms: 600000,
    });

    const encoded = await phases.prepareEncoded(request);
    expect(encoded.frame_count).toBe(draft.frame_count);
    expect(encoded.files.find((file) => file.role === "media")?.bytes).toBeGreaterThan(0);

    const qc = await phases.inspectEncoded({ request: deliveryRequest, encoded });
    expect(qc.qc_items.find((item) => item.id === "media_container")?.status).toBe("pass");
    expect(qc.qc_items.find((item) => item.id === "media_full_decode")?.status).toBe("pass");
    expect(qc.qc_items.find((item) => item.id === "supplements")?.status).toBe("pass");

    const published = await phases.publishValidated({ request: deliveryRequest, encoded, qc });
    const names = published.package_receipt.files.map((file) => file.file);
    expect(names).toContain("media.mp4");
    expect(names).toContain("ffprobe.json");
    expect(names).toContain("full_decode.log");
    expect(published.package_receipt.files.find((file) => file.file === "media.mp4")?.sha256).toBe(encoded.media_ref.sha256);

    await phases.close();
  }, 900000);
});
