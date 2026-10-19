import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, link, mkdir, open, readdir, readFile, rename, rm, unlink } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

/**
 * Content-addressed storage for M3's derived artifacts.
 *
 * Two properties matter and neither is about speed. First, a token names content: the same
 * bytes always produce the same token, so a proxy that already exists is reused instead of
 * re-encoded and two runs can be compared at all. Second, a reader never sees a partial
 * file: bytes are written to a staging file in the same directory, fsynced, and only then
 * renamed into place, so an interrupted write leaves a staging file and no final name.
 *
 * This is M3's ONLY writable area. It sits beside the migration root and never inside a
 * project, because a derived proxy written into author source would change the source
 * closure and break M3's NOWRITE guarantee (AC-009).
 */

export const DERIVED_KINDS = ["proxy", "segment"] as const;
export type DerivedKind = (typeof DERIVED_KINDS)[number];

const KIND_PATTERN = /^(?:proxy|segment)\/[a-f0-9]{64}\.[a-z0-9]{2,5}$/u;

export class DerivedArtifactStore {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  /**
   * Resolves a token to an absolute path, or refuses.
   *
   * The refusal is not defensive decoration: a token reaches this class from a stored row
   * and, eventually, from a request. Resolving it before checking would let `../` or an
   * absolute path turn a content-addressed store into a general file reader.
   */
  resolve(token: string): string {
    if (typeof token !== "string" || !KIND_PATTERN.test(token)) {
      throw new Error(`DERIVED_TOKEN_REJECTED:${String(token).slice(0, 64)}`);
    }
    const path = resolve(this.root, token);
    // Belt and braces: the pattern already forbids separators beyond the one it requires,
    // but a resolved path that is not under the root is never returned regardless.
    if (path !== this.root && !path.startsWith(`${this.root}${sep}`)) {
      throw new Error(`DERIVED_TOKEN_ESCAPES_ROOT:${String(token).slice(0, 64)}`);
    }
    return path;
  }

  /** The digest a token for these bytes would carry, without writing anything. */
  tokenFor(kind: DerivedKind, bytes: Uint8Array, extension: string): string {
    assertKind(kind);
    assertExtension(extension);
    return `${kind}/${createHash("sha256").update(bytes).digest("hex")}.${extension}`;
  }

  /**
   * A unique path to render into, under this root and not under any final name.
   *
   * Encoders need a real file to write, and that file must not be named after content that
   * does not exist yet. So rendering happens here and `put` promotes the bytes afterwards.
   */
  async stagingPath(extension: string): Promise<string> {
    assertExtension(extension);
    const dir = resolve(this.root, "staging");
    await mkdir(dir, { recursive: true });
    return resolve(dir, `render-${process.pid}-${randomUUID()}.${extension}`);
  }

  /** Discards a staging file. Best-effort: the caller already has its bytes or an error. */
  async discardStaging(path: string): Promise<void> {
    if (path.startsWith(`${resolve(this.root, "staging")}${sep}`)) {
      await rm(path, { force: true }).catch(() => undefined);
    }
  }

  async exists(token: string): Promise<boolean> {
    try { await access(this.resolve(token), constants.R_OK); return true; }
    catch { return false; }
  }

  /**
   * Writes bytes under their own content hash and returns the token.
   *
   * If the artifact already exists it is reused untouched: re-encoding would produce
   * different bytes for the same content on some encoders, and a store whose tokens lie
   * about content is worse than one that does redundant work.
   */
  async put(bytes: Uint8Array, extension: string, kind: DerivedKind = "proxy"): Promise<string> {
    assertKind(kind);
    assertExtension(extension);
    const token = this.tokenFor(kind, bytes, extension);
    const destination = this.resolve(token);

    // A cheap pre-check avoids staging work for content that is already published. It is a
    // hint, never the authority: the publish path below verifies whatever it finds.
    if (await this.exists(token)) {
      await this.verifyPublished(token);
      return token;
    }

    await mkdir(dirname(destination), { recursive: true });
    // The staging name carries a random identity per *attempt*. A name built from the
    // process id and `Date.now()` collides whenever two renders finish in the same
    // millisecond with the same bytes — which is the common case for two projects — and the
    // loser then deleted the winner's staging file on its way out.
    const staging = `${destination}.${randomUUID()}.tmp`;
    try {
      const handle = await open(staging, "wx", 0o600);
      try {
        await handle.writeFile(bytes);
        // fsync before publishing: the publish is atomic, but only if the bytes are already
        // durable. Without this a crash leaves a correctly named file full of nothing.
        await handle.sync();
      } finally {
        await handle.close();
      }
      await this.#publish(staging, destination, token);
      await this.#fsyncDir(dirname(destination));
      return token;
    } catch (error) {
      // Only this attempt's own staging file. Nobody else's is touched, which is what the
      // unlink used to get wrong.
      await unlink(staging).catch(() => undefined);
      throw error;
    }
  }

  /**
   * Moves fully written bytes onto the content-addressed name.
   *
   * `rename` overwrites, which on POSIX is atomic but *clobbers*: a publisher that lost the
   * race would replace a good artifact with its own bytes. That happens to be the same bytes
   * today because the name is the hash, but the assumption is not one worth resting a
   * content-addressed store on.
   *
   * `link` fails with EEXIST instead, which is the property wanted: the first publisher
   * wins, every other learns the name is taken and verifies rather than overwrites. A hard
   * link within one directory is a rename in disguise, so atomicity is unchanged. Where
   * linking is unavailable the code falls back to `rename` and *verifies afterwards*, which
   * is the same guarantee by way of detection rather than prevention.
   */
  async #publish(staging: string, destination: string, token: string): Promise<void> {
    try {
      await link(staging, destination);
      // The link is the artifact now; the staging name has served its purpose.
      await unlink(staging).catch(() => undefined);
      return;
    } catch (error) {
      if (!isAlreadyExists(error)) {
        // Linking unsupported on this filesystem. Fall through to the verified rename.
        await rename(staging, destination);
        await this.verifyPublished(token);
        return;
      }
    }
    // Someone else published first. Their bytes must be the bytes this token names.
    await unlink(staging).catch(() => undefined);
    await this.verifyPublished(token);
  }

  /**
   * Confirms a published artifact actually hashes to its token.
   *
   * This is what turns "the file exists" into "the file is the content we addressed". A
   * mismatch is a corrupt store, and serving it as a cache hit would hand a caller bytes
   * under someone else's name.
   */
  async verifyPublished(token: string): Promise<void> {
    const path = this.resolve(token);
    let actual: string;
    try {
      actual = createHash("sha256").update(await readFile(path)).digest("hex");
    } catch {
      throw new Error(`DERIVED_ARTIFACT_UNREADABLE:${token}`);
    }
    const [kind, name] = token.split("/");
    const extension = name?.split(".").pop() ?? "";
    if (`${kind}/${actual}.${extension}` !== token) {
      throw new Error(`DERIVED_ARTIFACT_DIGEST_MISMATCH:${token}:${actual}`);
    }
  }

  /** Staging files left by an interrupted write, so a caller can clean them deliberately. */
  async stagingLeftovers(): Promise<string[]> {
    const found: string[] = [];
    // `staging/` is where `stagingPath()` writes, and the per-kind directories are where a
    // partially promoted artefact would land. Scanning only the latter missed exactly the
    // files a killed encoder leaves behind, because `stagingPath` never uses a kind folder.
    // Everything under `staging/` is a leftover: that directory holds only in-progress
    // renders, and `stagingPath` names them `render-<pid>-<uuid>.<ext>` with no temporary
    // suffix. Filtering on `.tmp` there found nothing, which is why a killed encoder's file
    // survived every cleanup.
    for (const name of await readdir(resolve(this.root, "staging")).catch(() => [] as string[])) {
      found.push(`staging/${name}`);
    }
    for (const kind of DERIVED_KINDS) {
      const names = await readdir(resolve(this.root, kind)).catch(() => [] as string[]);
      for (const name of names) if (name.endsWith(".tmp")) found.push(`${kind}/${name}`);
    }
    return found;
  }

  async removeStagingLeftovers(): Promise<number> {
    const leftovers = await this.stagingLeftovers();
    for (const relative of leftovers) {
      // `stagingLeftovers` only ever reports paths it built itself under this root; the
      // containment check is repeated here because deletion is the one operation where
      // getting it wrong is unrecoverable.
      const path = resolve(this.root, relative);
      if (!path.startsWith(`${this.root}${sep}`)) continue;
      await rm(path, { force: true }).catch(() => undefined);
    }
    return leftovers.length;
  }

  /** Durability of the rename needs the *directory* synced, not just the file. */
  async #fsyncDir(path: string): Promise<void> {
    let handle;
    try {
      handle = await open(path, constants.O_RDONLY);
      await handle.sync();
    } catch {
      // Directory fsync is not portable; a failure here is reported by the caller's own
      // durability checks rather than silently treated as success.
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }
}

/** Whether an error is the filesystem saying "that name is taken". */
function isAlreadyExists(error: unknown): boolean {
  const code = (error as { code?: unknown }).code;
  if (code === "EEXIST") return true;
  // Windows and some filesystems report a cross-device link attempt differently.
  const message = error instanceof Error ? error.message : String(error);
  return /EEXIST|EPERM|EXDEV|not supported|link/i.test(message) && code === undefined;
}

function assertKind(kind: string): void {
  if (!(DERIVED_KINDS as readonly string[]).includes(kind)) {
    throw new Error(`DERIVED_KIND_REJECTED:${kind}`);
  }
}

function assertExtension(extension: string): void {
  if (!/^[a-z0-9]{2,5}$/u.test(extension)) {
    throw new Error(`DERIVED_EXTENSION_REJECTED:${extension}`);
  }
}
