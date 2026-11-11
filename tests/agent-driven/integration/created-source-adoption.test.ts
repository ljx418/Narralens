import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RevisionStore } from "../../../src/host/projects/revision-store.js";
import {
  CreatedSourcePublisher,
  createdSourceTreeDigest,
  isCreatedSourcePublicationProof,
} from "../../../src/host/agent-driven/created-source-publisher.js";
import type { PreparedSourceFileFact } from "../../../src/host/agent-driven/created-source-ports.js";

const HASH = "a".repeat(64);

let root = "";
let revisions: RevisionStore;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "narralens-r2-publisher-"));
  revisions = new RevisionStore(":memory:");
});

afterEach(async () => {
  revisions.close();
  await rm(root, { recursive: true, force: true });
});

async function writeTree(base: string, files: Record<string, string>): Promise<PreparedSourceFileFact[]> {
  const out: PreparedSourceFileFact[] = [];
  for (const [relativePath, content] of Object.entries(files)) {
    const target = join(base, relativePath);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, content);
    const bytes = Buffer.from(content, "utf8");
    out.push({
      relative_path: relativePath,
      bytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  return out.sort((left, right) => (left.relative_path < right.relative_path ? -1 : 1));
}

function publisher(authorRoot: string, privateRoot: string): CreatedSourcePublisher {
  return new CreatedSourcePublisher({ revisions, authorRoot, privateRoot });
}

describe("the created source publisher", () => {
  it("publishes the whole tree and issues a proof that verifies", async () => {
    const authorRoot = join(root, "author");
    const privateRoot = join(root, "private");
    const stageRoot = join(root, "stage");
    await mkdir(authorRoot, { recursive: true });
    await mkdir(stageRoot, { recursive: true });
    const original = await writeTree(authorRoot, { "film.html": "<html>old</html>" });
    const published = await writeTree(stageRoot, {
      "film.html": "<html>new</html>",
      "settings.json": '{"a":1}',
    });

    const instance = publisher(authorRoot, privateRoot);
    const proof = await instance.publish({
      project_id: "project-1",
      transaction_id: "txn-1",
      prepared_source_id: "ps_1",
      stage_root: stageRoot,
      files: published,
      original_source_digest: createdSourceTreeDigest(original),
      published_source_digest: createdSourceTreeDigest(published),
      target_snapshot_id: "snapshot-1",
    });

    expect(isCreatedSourcePublicationProof(proof)).toBe(true);
    await instance.verify(proof, {
      project_id: "project-1",
      transaction_id: "txn-1",
      prepared_source_id: "ps_1",
      target_snapshot_id: "snapshot-1",
      original_source_digest: createdSourceTreeDigest(original),
      published_source_digest: createdSourceTreeDigest(published),
    });

    // The author root really holds the new tree, and the old one is in the backup.
    expect(await readFile(join(authorRoot, "film.html"), "utf8")).toBe("<html>new</html>");
    expect(await readFile(join(authorRoot, "settings.json"), "utf8")).toBe('{"a":1}');
    const journal = instance.journalOf("txn-1");
    expect(journal.map((row) => row.phase)).toEqual(["prepared", "published"]);
    expect(await readFile(join(journal[1]!.backup_root, "film.html"), "utf8")).toBe("<html>old</html>");
  });

  it("refuses a publication whose live author root is not the prepared source", async () => {
    const authorRoot = join(root, "author");
    const privateRoot = join(root, "private");
    const stageRoot = join(root, "stage");
    await mkdir(authorRoot, { recursive: true });
    await mkdir(stageRoot, { recursive: true });
    const original = await writeTree(authorRoot, { "film.html": "<html>old</html>" });
    const published = await writeTree(stageRoot, { "film.html": "<html>new</html>" });

    const instance = publisher(authorRoot, privateRoot);
    await expect(instance.publish({
      project_id: "project-1",
      transaction_id: "txn-1",
      prepared_source_id: "ps_1",
      stage_root: stageRoot,
      files: published,
      // The live author root does not hash to this: the world moved.
      original_source_digest: HASH,
      published_source_digest: createdSourceTreeDigest(published),
      target_snapshot_id: "snapshot-1",
    })).rejects.toThrow();
    // Nothing was moved.
    expect(await readFile(join(authorRoot, "film.html"), "utf8")).toBe("<html>old</html>");
    expect(createdSourceTreeDigest(original)).not.toBe(HASH);
  });

  it("refuses a proof that is only structurally identical, and a proof of another publisher", async () => {
    const authorRoot = join(root, "author");
    const privateRoot = join(root, "private");
    const stageRoot = join(root, "stage");
    await mkdir(authorRoot, { recursive: true });
    await mkdir(stageRoot, { recursive: true });
    const original = await writeTree(authorRoot, { "film.html": "<html>old</html>" });
    const published = await writeTree(stageRoot, { "film.html": "<html>new</html>" });
    const instance = publisher(authorRoot, privateRoot);
    const proof = await instance.publish({
      project_id: "project-1",
      transaction_id: "txn-1",
      prepared_source_id: "ps_1",
      stage_root: stageRoot,
      files: published,
      original_source_digest: createdSourceTreeDigest(original),
      published_source_digest: createdSourceTreeDigest(published),
      target_snapshot_id: "snapshot-1",
    });

    const forged = { facts: { ...proof.facts }, verify: () => undefined };
    expect(isCreatedSourcePublicationProof(forged)).toBe(false);
    await expect(instance.verify(forged, {
      project_id: "project-1",
      transaction_id: "txn-1",
      prepared_source_id: "ps_1",
      target_snapshot_id: "snapshot-1",
      original_source_digest: createdSourceTreeDigest(original),
      published_source_digest: createdSourceTreeDigest(published),
    })).rejects.toThrow();

    // Another publisher instance does not honour a proof it did not issue.
    const other = publisher(authorRoot, privateRoot);
    await expect(other.verify(proof, {
      project_id: "project-1",
      transaction_id: "txn-1",
      prepared_source_id: "ps_1",
      target_snapshot_id: "snapshot-1",
      original_source_digest: createdSourceTreeDigest(original),
      published_source_digest: createdSourceTreeDigest(published),
    })).rejects.toThrow();
  });

  it("refuses a proof whose author root moved after the publication", async () => {
    const authorRoot = join(root, "author");
    const privateRoot = join(root, "private");
    const stageRoot = join(root, "stage");
    await mkdir(authorRoot, { recursive: true });
    await mkdir(stageRoot, { recursive: true });
    const original = await writeTree(authorRoot, { "film.html": "<html>old</html>" });
    const published = await writeTree(stageRoot, { "film.html": "<html>new</html>" });
    const instance = publisher(authorRoot, privateRoot);
    const proof = await instance.publish({
      project_id: "project-1",
      transaction_id: "txn-1",
      prepared_source_id: "ps_1",
      stage_root: stageRoot,
      files: published,
      original_source_digest: createdSourceTreeDigest(original),
      published_source_digest: createdSourceTreeDigest(published),
      target_snapshot_id: "snapshot-1",
    });
    // The world moved: the author root holds something else now.
    await writeFile(join(authorRoot, "film.html"), "<html>tampered</html>");
    await expect(instance.verify(proof, {
      project_id: "project-1",
      transaction_id: "txn-1",
      prepared_source_id: "ps_1",
      target_snapshot_id: "snapshot-1",
      original_source_digest: createdSourceTreeDigest(original),
      published_source_digest: createdSourceTreeDigest(published),
    })).rejects.toThrow();
  });

  it("refuses a closure that contains a symbolic link", async () => {
    const authorRoot = join(root, "author");
    const privateRoot = join(root, "private");
    const stageRoot = join(root, "stage");
    await mkdir(authorRoot, { recursive: true });
    await mkdir(stageRoot, { recursive: true });
    const original = await writeTree(authorRoot, { "film.html": "<html>old</html>" });
    await writeFile(join(stageRoot, "real.html"), "<html>real</html>");
    await symlink(join(stageRoot, "real.html"), join(stageRoot, "link.html"));
    const published: PreparedSourceFileFact[] = [{
      relative_path: "link.html",
      bytes: 11,
      sha256: createHash("sha256").update("<html>real</html>").digest("hex"),
    }];
    const instance = publisher(authorRoot, privateRoot);
    await expect(instance.publish({
      project_id: "project-1",
      transaction_id: "txn-1",
      prepared_source_id: "ps_1",
      stage_root: stageRoot,
      files: published,
      original_source_digest: createdSourceTreeDigest(original),
      published_source_digest: createdSourceTreeDigest(published),
      target_snapshot_id: "snapshot-1",
    })).rejects.toThrow();
    expect(await readFile(join(authorRoot, "film.html"), "utf8")).toBe("<html>old</html>");
  });

  it("issues nothing once the publisher is closed", async () => {
    const authorRoot = join(root, "author");
    const privateRoot = join(root, "private");
    const stageRoot = join(root, "stage");
    await mkdir(authorRoot, { recursive: true });
    await mkdir(stageRoot, { recursive: true });
    const original = await writeTree(authorRoot, { "film.html": "<html>old</html>" });
    const published = await writeTree(stageRoot, { "film.html": "<html>new</html>" });
    const instance = publisher(authorRoot, privateRoot);
    instance.close();
    await expect(instance.publish({
      project_id: "project-1",
      transaction_id: "txn-1",
      prepared_source_id: "ps_1",
      stage_root: stageRoot,
      files: published,
      original_source_digest: createdSourceTreeDigest(original),
      published_source_digest: createdSourceTreeDigest(published),
      target_snapshot_id: "snapshot-1",
    })).rejects.toThrow();
  });
});
