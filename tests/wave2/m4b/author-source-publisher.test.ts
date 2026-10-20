import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AuthorSourcePublisher, type PublishBoundary } from "../../../src/host/adoption/author-source-publisher.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const sha = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "narralens-m4b-publish-"));
  roots.push(root);
  const active = resolve(root, "active");
  const staged = resolve(root, "staged");
  const before = "before-film";
  const after = "after-film";
  const asset = Buffer.from("asset-bytes");
  const digest = sha(asset);
  const token = `assets/${digest}/source.mp4`;
  await mkdir(resolve(staged, "assets", digest), { recursive: true });
  await mkdir(active, { recursive: true });
  await writeFile(resolve(active, "film.html"), before);
  await writeFile(resolve(staged, "film.html"), after);
  await writeFile(resolve(staged, token), asset);
  return { active, staged, before, after, token, digest };
}

describe("M4B AuthorSourcePublisher", () => {
  it("installs content first and atomically switches only film.html", async () => {
    const f = await fixture();
    const seen: PublishBoundary[] = [];
    await new AuthorSourcePublisher({ fault: (boundary) => { seen.push(boundary); } }).publish({
      activeRoot: f.active, stagedRoot: f.staged, transactionId: "txn_1",
      filmTempToken: ".narralens-txn_1.film.tmp",
      installedAssets: [{ token: f.token, sha256: f.digest }],
      expectedFilmBeforeSha256: sha(f.before), expectedFilmAfterSha256: sha(f.after),
    });
    expect(await readFile(resolve(f.active, "film.html"), "utf8")).toBe(f.after);
    expect(await readFile(resolve(f.active, f.token), "utf8")).toBe("asset-bytes");
    expect(seen).toEqual(["asset_temp_fsynced", "asset_installed", "film_temp_fsynced", "film_renamed", "parent_fsynced"]);
  });

  it.each(["asset_temp_fsynced", "asset_installed", "film_temp_fsynced"] as const)(
    "keeps the before film when failure occurs at %s", async (failure) => {
      const f = await fixture();
      const publisher = new AuthorSourcePublisher({ fault: (boundary) => {
        if (boundary === failure) throw new Error(`FAULT:${failure}`);
      } });
      await expect(publisher.publish({ activeRoot: f.active, stagedRoot: f.staged, transactionId: "txn_2",
        filmTempToken: ".narralens-txn_2.film.tmp",
        installedAssets: [{ token: f.token, sha256: f.digest }],
        expectedFilmBeforeSha256: sha(f.before), expectedFilmAfterSha256: sha(f.after) })).rejects.toThrow(`FAULT:${failure}`);
      expect(await readFile(resolve(f.active, "film.html"), "utf8")).toBe(f.before);
    });

  it("leaves a provable after film when failure occurs after rename", async () => {
    const f = await fixture();
    const publisher = new AuthorSourcePublisher({ fault: (boundary) => {
      if (boundary === "film_renamed") throw new Error("FAULT:film_renamed");
    } });
    await expect(publisher.publish({ activeRoot: f.active, stagedRoot: f.staged, transactionId: "txn_3",
      filmTempToken: ".narralens-txn_3.film.tmp",
      installedAssets: [{ token: f.token, sha256: f.digest }],
      expectedFilmBeforeSha256: sha(f.before), expectedFilmAfterSha256: sha(f.after) })).rejects.toThrow("FAULT:film_renamed");
    expect(await readFile(resolve(f.active, "film.html"), "utf8")).toBe(f.after);
  });

  it("fails closed on path escape and corrupted pre-existing content", async () => {
    const f = await fixture();
    const publisher = new AuthorSourcePublisher();
    await expect(publisher.publish({ activeRoot: f.active, stagedRoot: f.staged, transactionId: "txn_4",
      filmTempToken: ".narralens-txn_4.film.tmp",
      installedAssets: [{ token: "../escape.mp4", sha256: f.digest }],
      expectedFilmBeforeSha256: sha(f.before), expectedFilmAfterSha256: sha(f.after) }))
      .rejects.toMatchObject({ status: 422, code: "UNSUPPORTED_EDIT" });
    await mkdir(resolve(f.active, "assets", f.digest), { recursive: true });
    await writeFile(resolve(f.active, f.token), "corrupt");
    await expect(publisher.publish({ activeRoot: f.active, stagedRoot: f.staged, transactionId: "txn_5",
      filmTempToken: ".narralens-txn_5.film.tmp",
      installedAssets: [{ token: f.token, sha256: f.digest }],
      expectedFilmBeforeSha256: sha(f.before), expectedFilmAfterSha256: sha(f.after) }))
      .rejects.toMatchObject({ status: 423, code: "PROJECT_ATTENTION_REQUIRED" });
  });
});
