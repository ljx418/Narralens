import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CommittedRenderPhases, closureDigestOf, rightsDigestOf } from "../../../src/host/render/committed-render-phases.js";
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
    expect(encoded.closure_digest).toBe(closureDigestOf(built.closure));
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
    expect(qcFiles.sort()).toEqual(["ffprobe.json", "full_decode.log"]);
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
