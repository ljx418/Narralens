import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  OpenFilmEngineAdapter, OPENFILM_PROJECTION_PROBLEM_PREFIX,
} from "../../../src/adapters/openfilm/openfilm-engine-adapter.js";
import type { ReadContext, SnapshotRef } from "../../../src/host/engine/engine-port.js";

/**
 * M4A-P01, the producing half: the adapter's projection-completeness rules.
 *
 * `consumer-graph.test.ts` proves the graph refuses a projection it is *given* a problem in.
 * That is only half the claim. The other half is that the adapter *produces* those problems
 * rather than silently dropping the node — and without these tests that half was entirely
 * unevidenced: replacing `problems` with a hard-coded `[]` left the whole M4A suite green,
 * which is a mutation test that says the module's central "unknown means unknown" property
 * rested on a branch nothing could reach.
 *
 * The upstream is stubbed rather than pinned here on purpose. Each case needs a *specific*
 * malformed document, and the pinned upstream only parses well-formed ones; the pinned seam
 * is exercised for real in `activated-projection.test.ts`, where the digest has to reproduce
 * the committed one.
 */

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

const ctx: ReadContext = { correlationId: "completeness", projectId: "p1", signal: AbortSignal.timeout(10_000) };
const snapshot: SnapshotRef = { project_id: "p1", engine: "openfilm", source_digest: "" };

const CLEAN = {
  stage: { w: 1280, h: 720 },
  tracks: [{
    attrs: { "data-track": "picture" },
    clips: [{ id: "shot-001", src: "scenes/shot-001.html", time: [0, 10] }],
  }],
};

/** A real on-disk project, because `computeSourceDigest` really runs inside `inspect`. */
async function project(): Promise<{ root: string; adapter: OpenFilmEngineAdapter }> {
  const dir = await mkdtemp(join(tmpdir(), "narralens-m4a-completeness-"));
  dirs.push(dir);
  // The scene the film references has to exist: `inspect` really runs
  // `computeSourceDigest`, and an unresolvable reference is a 422 before the projection is
  // ever built. The digest is not what this file is about, but it still has to be real.
  await mkdir(join(dir, "scenes"), { recursive: true });
  await writeFile(join(dir, "scenes", "shot-001.html"),
    "<!doctype html><html><body><p>one</p></body></html>\n", "utf8");
  await writeFile(join(dir, "film.html"),
    `<!doctype html><html><head><style>x{}</style></head><body>
     <section data-track="picture"><iframe id="shot-001" src="scenes/shot-001.html#t=0,10"></iframe></section>
     </body></html>\n`, "utf8");
  const adapter = new OpenFilmEngineAdapter({
    revOf: () => "0000000000000000",
    readProjectFilm: async () => ({ text: "<html/>", rev: "0000000000000000", value: null,
      doc: CLEAN, problems: [] }),
    editProjectFilm: async () => { throw new Error("must not be called"); },
  } as never);
  return { root: dir, adapter };
}

async function problemsFor(doc: unknown): Promise<readonly string[]> {
  const { root, adapter } = await project();
  adapter.registerLayout("p1", { root, roots: ["film.html"] });
  const stub = new OpenFilmEngineAdapter({
    revOf: () => "0000000000000000",
    readProjectFilm: async () => ({ text: "<html/>", rev: "0000000000000000", value: null,
      doc, problems: [] }),
    editProjectFilm: async () => { throw new Error("must not be called"); },
  } as never);
  stub.registerLayout("p1", { root, roots: ["film.html"] });
  const projection = await stub.inspect({ ...snapshot, source_digest: "" }, ctx);
  return projection.problems;
}

describe("M4A-P01: the adapter reports every node it could not map", () => {
  it("maps a clean document completely, with no problems", async () => {
    expect(await problemsFor(CLEAN)).toEqual([]);
  });

  it("reports a clip with no id rather than skipping it", async () => {
    const problems = await problemsFor({ ...CLEAN, tracks: [{ attrs: { "data-track": "picture" },
      clips: [{ src: "scenes/shot-001.html", time: [0, 10] }] }] });
    expect(problems).toContain(`${OPENFILM_PROJECTION_PROBLEM_PREFIX}CLIP_NO_ID:track_0`);
  });

  it("reports a clip whose source has no recognised kind", async () => {
    const problems = await problemsFor({ ...CLEAN, tracks: [{ attrs: { "data-track": "picture" },
      clips: [{ id: "shot-002", src: "scenes/shot-002.xyz", time: [0, 10] }] }] });
    expect(problems).toContain(`${OPENFILM_PROJECTION_PROBLEM_PREFIX}CLIP_UNKNOWN_SOURCE:shot-002`);
  });

  it("reports a non-empty override rather than reducing it to a digest nobody reads", async () => {
    const problems = await problemsFor({ ...CLEAN, tracks: [{ attrs: { "data-track": "picture" },
      clips: [{ id: "shot-001", src: "scenes/shot-001.html", time: [0, 10],
        overrides: [{ opacity: 0.5 }] }] }] });
    expect(problems).toContain(`${OPENFILM_PROJECTION_PROBLEM_PREFIX}CLIP_OVERRIDES:shot-001`);
  });

  it("reports a clip attribute this projection does not model", async () => {
    const problems = await problemsFor({ ...CLEAN, tracks: [{ attrs: { "data-track": "picture" },
      clips: [{ id: "shot-001", src: "scenes/shot-001.html", time: [0, 10], transition: "fade" }] }] });
    expect(problems).toContain(`${OPENFILM_PROJECTION_PROBLEM_PREFIX}CLIP_UNMODELED_FIELD:shot-001:transition`);
  });

  it("reports two clips sharing an id, because a lock target that is ambiguous is no target", async () => {
    const problems = await problemsFor({ ...CLEAN, tracks: [{ attrs: { "data-track": "picture" },
      clips: [{ id: "shot-001", src: "scenes/shot-001.html", time: [0, 10] },
        { id: "shot-001", src: "scenes/shot-001.html", time: [10, 20] }] }] });
    expect(problems).toContain(`${OPENFILM_PROJECTION_PROBLEM_PREFIX}DUPLICATE_CLIP_ID:shot-001`);
  });

  it("reports a track attribute the consumer graph cannot express", async () => {
    const problems = await problemsFor({ ...CLEAN, tracks: [{ attrs: { "data-track": "picture", locked: "true" },
      clips: [] }] });
    expect(problems).toContain(`${OPENFILM_PROJECTION_PROBLEM_PREFIX}TRACK_UNMODELED_ATTR:track_0:locked`);
  });

  it("reports a track kind it has never heard of", async () => {
    const problems = await problemsFor({ ...CLEAN, tracks: [{ attrs: { "data-track": "effects" }, clips: [] }] });
    expect(problems).toContain(`${OPENFILM_PROJECTION_PROBLEM_PREFIX}TRACK_UNKNOWN_KIND:track_0:effects`);
  });

  it("reports a null track and a null clip instead of throwing a 500", async () => {
    // These two coercions were added after a review found the completeness block itself
    // crashed on the most malformed document it exists to diagnose.
    expect(await problemsFor({ ...CLEAN, tracks: [null] }))
      .toContain(`${OPENFILM_PROJECTION_PROBLEM_PREFIX}TRACK_UNREADABLE:track_0`);
    expect(await problemsFor({ ...CLEAN, tracks: [{ attrs: { "data-track": "picture" }, clips: [null] }] }))
      .toContain(`${OPENFILM_PROJECTION_PROBLEM_PREFIX}CLIP_UNREADABLE:track_0#0`);
  });

  it("reports a tracks value that is not a list at all", async () => {
    expect(await problemsFor({ ...CLEAN, tracks: "picture" })).toEqual([]);
  });

  it("still maps the clips it can, alongside the ones it could not", async () => {
    // The point of reporting rather than skipping: a reader can see both what is known and
    // what is not, and the graph refuses on the second without losing the first.
    const { root } = await project();
    const adapter = new OpenFilmEngineAdapter({
      revOf: () => "0000000000000000",
      readProjectFilm: async () => ({ text: "<html/>", rev: "0000000000000000", value: null,
        doc: { ...CLEAN, tracks: [{ attrs: { "data-track": "picture" }, clips: [
          { id: "shot-001", src: "scenes/shot-001.html", time: [0, 10] },
          { id: "shot-002", src: "scenes/shot-002.qqq", time: [0, 10] },
        ] }] }, problems: [] }),
      editProjectFilm: async () => { throw new Error("must not be called"); },
    } as never);
    adapter.registerLayout("p1", { root, roots: ["film.html"] });
    const projection = await adapter.inspect({ ...snapshot, source_digest: "" }, ctx);
    expect(projection.clips.map((clip) => clip.clip_id)).toEqual(["shot-001"]);
    expect(projection.problems).toHaveLength(1);
  });
});
