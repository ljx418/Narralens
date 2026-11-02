import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NarralensHost } from "../../../src/host/server.js";
import type { ProposalComparison } from "../../../src/contracts/types.js";
import { ProposalAdapter } from "../../../src/adapters/openmontage/proposal-adapter.js";
import { ProposalComparisonAdapter } from "../../../src/adapters/openmontage/proposal-comparison-adapter.js";
import { CdpSession } from "./cdp.js";
import { findChrome, launchChrome, makeProfile, type ChromeHandle } from "./chrome.js";
import { buildFixtures, type FixtureSet } from "./fixtures.js";

/**
 * M5C's headless environment (Wave 3 `04` §7).
 *
 * Everything the harness needs is started here and closed here: the Host, the Studio and
 * its Gateway, the browser and its isolated profile, and the temporary working tree. The
 * `close()` is the `finally` of the whole run — a browser that outlives its evidence is
 * a window somebody has to close by hand, which is exactly what this stage forbids.
 */
export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export interface HeadlessEnvironment {
  readonly host: NarralensHost;
  /** The recorded D4.1 comparison the page replays. It is a recording, not a generation. */
  readonly sourceComparisonId: string;
  readonly origin: string;
  readonly token: string;
  readonly projectId: string;
  readonly gatewayOrigin: string;
  readonly pageUrl: string;
  readonly fixtures: FixtureSet;
  readonly base: string;
  close(): Promise<void>;
}

/**
 * The browser, started once for a whole run.
 *
 * The browser is the *instrument*, not the subject: the subject is each case's own Host,
 * its own migration and its own Studio. One browser drives all of them, and it is closed
 * in the runner's `finally`.
 */
export interface HeadlessBrowser {
  readonly chrome: ChromeHandle;
  readonly session: CdpSession;
  readonly profileRoot: string;
  close(): Promise<void>;
}

export async function startBrowser(options: {
  width?: number; height?: number;
  /** An existing profile to reuse. The zoom run writes its preferences into one. */
  profileRoot?: string;
} = {}): Promise<HeadlessBrowser> {
  const executable = await findChrome();
  const profileRoot = options.profileRoot ?? await makeProfile(executable);
  const chrome = await launchChrome({
    profileRoot, width: options.width ?? 1440, height: options.height ?? 900,
  });
  const session = await CdpSession.open(chrome.endpoint);
  return {
    chrome, session, profileRoot,
    close: async (): Promise<void> => {
      session.close();
      await chrome.close();
      await rm(profileRoot, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}

export interface StartOptions {
  readonly width?: number;
  readonly height?: number;
}

/**
 * Start everything, in the order the experience needs it.
 *
 * The order matters: the Host first (it owns the database), then the migration (the
 * target has to exist before the Studio can open it), then the workbench read (which
 * starts the Studio and the Gateway), then the fixtures, and only then the browser.
 */
export async function startEnvironment(options: StartOptions = {}): Promise<HeadlessEnvironment> {
  const base = await mkdtemp(join(tmpdir(), "narralens-m5-headless-"));

  process.env.NARRALENS_OPENFILM_VENDOR = process.env.NARRALENS_OPENFILM_VENDOR
    ?? "/mnt/c/workspace/videoworkline/Narralens-openfilm-m1b";

  // The fixtures: real media, built locally from the repository's verified bytes. They
  // are built *before* the Host, because the Gateway serves them by name from a
  // directory the Host is given at composition time.
  // The fixture set is cached in the repository's own `var/`, so a second run does not
  // spend minutes rebuilding identical bytes. The manifest records what was built.
  const fixtures = await buildFixtures(resolve(REPO, "var/m5-fixtures"),
    resolve(REPO, "fixtures/d1-30s/assets/generated/visual-10s.mp4"),
    resolve(REPO, "fixtures/d1-30s/assets/generated/visual-alt-10s.mp4"));

  const host = new NarralensHost({
    migrationsRoot: join(base, "migrations"), dbPath: join(base, "narralens.sqlite"),
    derivedRoot: join(base, "derived"), snapshotsRoot: join(base, "snapshots"),
    adoptionStagingRoot: join(base, "adoption-stage"),
    mediaRoot: resolve(REPO, "var/m5-fixtures"),
    proposals: new ProposalAdapter(join(base, "proposals")),
    comparisons: new ProposalComparisonAdapter(join(base, "proposal-comparisons")),
  });
  const port = await host.listen(0);
  const origin = `http://127.0.0.1:${port}`;
  const token = (await (await fetch(`${origin}/api/session`, { headers: { origin } })).json() as
    { token: string }).token;

  // The migration: the real route, over the real fixture, against the pinned upstream.
  const migrated = await fetch(`${origin}/api/migration/v1/projects/d1-30s/migrate-copy`, {
    method: "POST", headers: { origin, authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ idempotency_key: "m5-headless-migrate-1" }),
  });
  if (migrated.status !== 200) {
    const text = await migrated.text();
    await host.close();
    await rm(base, { recursive: true, force: true });
    throw new Error(`M5_BLOCKED_ENV:MIGRATION_FAILED:${migrated.status}:${text.slice(0, 300)}`);
  }
  const report = await migrated.json() as { plan: { target_project_id: string } };
  const projectId = report.plan.target_project_id;

  // A recorded D4.1 comparison of the source project, at the migration's own baseline.
  // The page replays this recording; it never asks a provider for a new one.
  const migrationId = (report as { plan: { migration_id?: string } }).plan.migration_id
    ?? host.revisions.migrations.all().find((row) => row.target_project_id === projectId)?.migration_id
    ?? "";
  const plan = host.revisions.migrations.plan(migrationId);
  const sourceComparisonId = "comparison_m5_recorded_1";
  if (plan !== undefined) {
    // The recording covers the whole film, because a plan that adopts must replace the
    // target's visual track: the plan builder refuses a plan whose clip count differs from
    // the target's, and the fixture's target has three clips.
    await host.comparisons.save(recordedComparison(sourceComparisonId, "d1-30s", plan.source_revision,
      { shot_id: "shot-001", start_frame: 0, end_frame_exclusive: 900 }));
  }

  // The workbench read starts the Studio and the Gateway.
  const workbench = await fetch(`${origin}/api/migration/v1/projects/${projectId}/workbench`, {
    headers: { origin, authorization: `Bearer ${token}` },
  });
  if (workbench.status !== 200) {
    const text = await workbench.text();
    await host.close();
    await rm(base, { recursive: true, force: true });
    throw new Error(`M5_BLOCKED_ENV:WORKBENCH_FAILED:${workbench.status}:${text.slice(0, 300)}`);
  }
  const projection = await workbench.json() as { preview: { url: string } };
  const pageUrl = projection.preview.url;
  const gatewayOrigin = new URL(pageUrl).origin;

  // The fixtures are already built; the browser comes last.
  const close = async (): Promise<void> => {
    await host.close();
    await rm(base, { recursive: true, force: true });
  };

  return {
    host, sourceComparisonId, origin, token, projectId, gatewayOrigin, pageUrl,
    fixtures, base,
    close,
  };
}

/**
 * A recorded D4.1 comparison.
 *
 * Three structurally distinct proposals, each with its own strategy, so the store's own
 * rules accept it — and the original generation audit, because the replay copies it
 * verbatim and the page says "已录制提案（原始生成审计）".
 */
function recordedComparison(comparisonId: string, projectId: string, baseRevision: number,
  selection: { shot_id: string; start_frame: number; end_frame_exclusive: number }): ProposalComparison {
  return {
    schema_version: "1.0" as const,
    kind: "narralens.proposal_comparison" as const,
    comparison_id: comparisonId,
    project_id: projectId,
    base_revision: baseRevision,
    selection,
    intent_sha256: "a".repeat(64),
    preserve: ["narration" as const],
    proposal_count: 3,
    proposals: [
      { count: 3, roles: ["anchor", "context", "evidence"], kind: "chronology" as const },
      { count: 3, roles: ["anchor", "contrast", "conclusion"], kind: "contrast" as const },
      { count: 3, roles: ["anchor", "transition", "evidence"], kind: "evidence-led" as const },
    ].map((shape, index) => ({
      proposal_id: `proposal_${comparisonId}_${index + 1}`,
      title: `方案 ${index + 1}`,
      strategy: { kind: shape.kind, rationale: "recorded" },
      summary: "recorded summary",
      segments: shape.roles.map((role, segmentIndex) => ({
        segment_id: `segment_${index + 1}_${segmentIndex + 1}`,
        duration_frames: 900 / shape.count,
        role: role as "anchor" | "context" | "evidence",
        intent: "recorded",
        asset_requirement_ids: [] as string[],
      })),
      assets_needed: [],
      source_refs: [],
      requires_materialization: true as const,
      renderable: false as const,
      materialization_cost: { status: "unknown" as const, currency: null, amount: null },
    })),
    generation_audit: {
      stdout_sha256: "b".repeat(64), model_names: ["recorded-model"], total_cost_usd: 0,
      duration_ms: 1234, num_turns: 3, service_tier: null,
    },
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

/** Write one evidence file, creating its directory. */
export async function writeEvidence(root: string, relative: string, body: string): Promise<string> {
  const path = resolve(root, relative);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body, "utf8");
  return path;
}
