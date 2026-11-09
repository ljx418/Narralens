import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { SnapshotClosure, SnapshotEntry } from "./ports.js";

/**
 * The immutable copy of a snapshot's closure.
 *
 * A render must not read the live project. The project's files belong to the user's
 * working copy: they change while a render runs, they are not what the committed
 * snapshot contains, and a renderer that reads them produces a film that nobody asked
 * for and cannot reproduce. So the closure is copied into a staging directory that
 * belongs to this attempt alone, and every byte is checked against the digest the
 * snapshot recorded before it is copied and again after the render is over.
 *
 * The copy is writable, because the upstream renderer keeps its own cache (fast-seeking
 * copies of videos, the parts of a render) inside the film folder it is given. What
 * matters is not that the folder is read-only, but that the bytes a render *reads* are
 * the bytes that were committed — which is what the two digest passes establish.
 */

/** One file of the copy. */
export interface CopiedFile {
  readonly relative_path: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly kind: SnapshotEntry["kind"];
}

/** The result of copying a snapshot's closure. */
export interface SnapshotCopy {
  /** The attempt's own staging directory. Nothing else lives here. */
  readonly staging_root: string;
  /** The copied film folder. It holds the film's own layout. */
  readonly project_root: string;
  /** The film document's path relative to `project_root`. */
  readonly native_entry: string;
  readonly files: readonly CopiedFile[];
}

export class SnapshotCopyError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "SnapshotCopyError";
  }
}

/**
 * A relative path that cannot leave the folder it is joined to.
 *
 * The check is on the path itself, not on the result of joining it: a path that is
 * absolute, that names a drive, that uses a backslash, or that contains a `.` or `..`
 * segment is refused before it can reach the filesystem.
 */
export function assertSafeRelativePath(value: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) {
    throw new SnapshotCopyError("RELATIVE_PATH_REJECTED", "a snapshot entry has no usable relative path");
  }
  if (value.startsWith("/") || value.includes("\\") || /^[A-Za-z]:/u.test(value)) {
    throw new SnapshotCopyError("RELATIVE_PATH_REJECTED", `a snapshot entry names an absolute path: ${value}`);
  }
  const parts = value.split("/");
  for (const part of parts) {
    if (part === "" || part === "." || part === "..") {
      throw new SnapshotCopyError("RELATIVE_PATH_REJECTED", `a snapshot entry names a path that walks out of the film: ${value}`);
    }
  }
  return parts.join("/");
}

async function sha256File(path: string): Promise<string | null> {
  try {
    return createHash("sha256").update(await readFile(path)).digest("hex");
  } catch {
    return null;
  }
}

/**
 * Copy the closure into a fresh staging directory.
 *
 * Every file is checked twice: its digest is verified before it is copied, and the
 * copy's own digest is verified after it is written. A file that changed between the
 * two, or a file that is a link rather than a regular file, fails the copy.
 */
export async function copySnapshotClosure(input: {
  readonly closure: SnapshotClosure;
  /** The attempt's own staging directory. The copied film is created inside it. */
  readonly staging_root: string;
}): Promise<SnapshotCopy> {
  const { closure } = input;
  if (closure.entries.length === 0) {
    throw new SnapshotCopyError("CLOSURE_EMPTY", "the snapshot's closure is empty");
  }

  const stagingRoot = resolve(input.staging_root);
  const projectRoot = resolve(stagingRoot, "project");
  await mkdir(projectRoot, { recursive: true, mode: 0o700 });

  const files: CopiedFile[] = [];
  try {
    for (const entry of closure.entries) {
      const relative = assertSafeRelativePath(entry.relative_path);
      const source = resolve(entry.absolute_path);
      const target = resolve(projectRoot, relative);
      if (!target.startsWith(`${projectRoot}${sep}`)) {
        throw new SnapshotCopyError("TARGET_ESCAPES_PROJECT", `a snapshot entry would be written outside the film: ${relative}`);
      }

      const info = await lstat(source).catch(() => null);
      if (info === null) {
        throw new SnapshotCopyError("SOURCE_MISSING", `a snapshot entry is not there: ${relative}`);
      }
      if (!info.isFile()) {
        // A link is not a file. Following one would read bytes the snapshot never named.
        throw new SnapshotCopyError("SOURCE_NOT_A_FILE", `a snapshot entry is not a regular file: ${relative}`);
      }
      const actual = await sha256File(source);
      if (actual === null) {
        throw new SnapshotCopyError("SOURCE_UNREADABLE", `a snapshot entry could not be read: ${relative}`);
      }
      if (actual !== entry.sha256) {
        throw new SnapshotCopyError("SOURCE_CHANGED", `a snapshot entry no longer matches the bytes its snapshot recorded: ${relative}`);
      }

      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await copyFile(source, target);
      const copied = await sha256File(target);
      if (copied !== entry.sha256) {
        throw new SnapshotCopyError("COPY_DIGEST_MISMATCH", `the copy of a snapshot entry does not match: ${relative}`);
      }
      const copiedSize = (await stat(target)).size;
      if (copiedSize !== entry.bytes) {
        throw new SnapshotCopyError("COPY_SIZE_MISMATCH", `the copy of a snapshot entry has ${copiedSize} bytes, not ${entry.bytes}: ${relative}`);
      }
      files.push({ relative_path: relative, sha256: entry.sha256, bytes: entry.bytes, kind: entry.kind });
    }

    const nativeEntry = assertSafeRelativePath(closure.native_entry);
    if (!files.some((file) => file.relative_path === nativeEntry)) {
      throw new SnapshotCopyError("FILM_DOCUMENT_NOT_IN_CLOSURE", "the film's entry document is not part of the snapshot's closure");
    }

    return { staging_root: stagingRoot, project_root: projectRoot, native_entry: nativeEntry, files };
  } catch (error) {
    // Only this attempt's own copy. Nothing else is touched, and nothing that was
    // published is reachable from here.
    await rm(projectRoot, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

/**
 * Check the copy again, after the renderer has been through it.
 *
 * A renderer that changed an input byte would have produced a film that does not match
 * the snapshot it claims to render. The check is cheap next to a render and it is the
 * only thing that turns "the copy was right when it was made" into "the copy was right
 * when it was used".
 */
export async function verifySnapshotCopy(copy: SnapshotCopy): Promise<void> {
  for (const file of copy.files) {
    const path = resolve(copy.project_root, file.relative_path);
    const actual = await sha256File(path);
    if (actual === null) {
      throw new SnapshotCopyError("COPY_UNREADABLE", `a copied snapshot entry could not be read: ${file.relative_path}`);
    }
    if (actual !== file.sha256) {
      throw new SnapshotCopyError("COPY_CHANGED", `a copied snapshot entry changed while it was being rendered: ${file.relative_path}`);
    }
  }
}
