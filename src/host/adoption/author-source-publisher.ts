import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, link, mkdir, open, readFile, realpath, rename, unlink } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { HttpError } from "../api-error.js";
import type { InstalledAdoptionAsset } from "./adoption-store.js";

export type PublishBoundary = "asset_temp_fsynced" | "asset_installed" | "film_temp_fsynced" | "film_renamed" | "parent_fsynced";

export interface AuthorSourcePublisherDeps {
  readonly fault?: (boundary: PublishBoundary) => void | Promise<void>;
}

export interface PublishAuthorSourceInput {
  readonly activeRoot: string;
  readonly stagedRoot: string;
  readonly transactionId: string;
  readonly installedAssets: readonly InstalledAdoptionAsset[];
  readonly expectedFilmBeforeSha256: string;
  readonly expectedFilmAfterSha256: string;
}

export interface PublishedAuthorSource {
  readonly source_before_sha256: string;
  readonly source_after_sha256: string;
  readonly installed_assets: readonly InstalledAdoptionAsset[];
}

const SHA256 = /^[a-f0-9]{64}$/u;
const ASSET_TOKEN = /^assets\/[a-f0-9]{64}\/source\.mp4$/u;

const hashFile = async (path: string): Promise<string> =>
  createHash("sha256").update(await readFile(path)).digest("hex");

async function fsync(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}

function inside(root: string, token: string): string {
  const path = resolve(root, token);
  if (path === root || !path.startsWith(`${root}${sep}`)) throw new Error(`SOURCE_PATH_ESCAPE:${token}`);
  return path;
}

/**
 * Publishes only M4B's two allowed source changes: immutable content-addressed assets,
 * followed by one same-directory atomic replacement of film.html.
 */
export class AuthorSourcePublisher {
  readonly #fault: (boundary: PublishBoundary) => void | Promise<void>;

  constructor(deps: AuthorSourcePublisherDeps = {}) {
    this.#fault = deps.fault ?? (() => undefined);
  }

  async publish(input: PublishAuthorSourceInput): Promise<PublishedAuthorSource> {
    if (!SHA256.test(input.expectedFilmBeforeSha256) || !SHA256.test(input.expectedFilmAfterSha256)
      || input.expectedFilmBeforeSha256 === input.expectedFilmAfterSha256) {
      throw new HttpError(422, "UNSUPPORTED_EDIT", "M4B requires distinct proven before and after film bytes");
    }
    const activeRoot = await realpath(input.activeRoot);
    const stagedRoot = await realpath(input.stagedRoot);
    const activeFilm = inside(activeRoot, "film.html");
    const stagedFilm = inside(stagedRoot, "film.html");
    if (await hashFile(activeFilm) !== input.expectedFilmBeforeSha256) {
      throw new HttpError(409, "SOURCE_CHANGED", "Active film changed before publication");
    }
    if (await hashFile(stagedFilm) !== input.expectedFilmAfterSha256) {
      throw new HttpError(422, "SOURCE_CHANGED", "Staged film does not match its validated publication fact");
    }

    const assets = [...input.installedAssets].sort((left, right) => left.token.localeCompare(right.token));
    if (new Set(assets.map((asset) => asset.token)).size !== assets.length) {
      throw new HttpError(422, "UNSUPPORTED_EDIT", "Adoption contains duplicate installed asset tokens");
    }
    for (const asset of assets) await this.#installAsset(activeRoot, stagedRoot, asset);

    const filmTemp = inside(activeRoot, `.narralens-${input.transactionId}-${randomUUID()}.film.tmp`);
    try {
      await copyFile(stagedFilm, filmTemp, constants.COPYFILE_EXCL);
      await fsync(filmTemp);
      await this.#fault("film_temp_fsynced");
      // Recheck immediately before the only author-source replacement point.
      if (await hashFile(activeFilm) !== input.expectedFilmBeforeSha256) {
        throw new HttpError(409, "SOURCE_CHANGED", "Active film changed at the publication boundary");
      }
      await rename(filmTemp, activeFilm);
      await this.#fault("film_renamed");
      await fsync(activeRoot);
      await this.#fault("parent_fsynced");
    } catch (error) {
      await unlink(filmTemp).catch(() => undefined);
      throw error;
    }
    if (await hashFile(activeFilm) !== input.expectedFilmAfterSha256) {
      throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED", "Published film bytes cannot be proven");
    }
    return { source_before_sha256: input.expectedFilmBeforeSha256,
      source_after_sha256: input.expectedFilmAfterSha256, installed_assets: assets };
  }

  async #installAsset(activeRoot: string, stagedRoot: string, asset: InstalledAdoptionAsset): Promise<void> {
    if (!ASSET_TOKEN.test(asset.token) || !SHA256.test(asset.sha256)
      || asset.token.split("/")[1] !== asset.sha256) {
      throw new HttpError(422, "UNSUPPORTED_EDIT", "Installed asset token is not content addressed");
    }
    const source = inside(stagedRoot, asset.token);
    const destination = inside(activeRoot, asset.token);
    if (await hashFile(source) !== asset.sha256) {
      throw new HttpError(422, "INVALID_MEDIA", "Staged asset does not match its content address");
    }
    await mkdir(dirname(destination), { recursive: true });
    const temp = `${destination}.${randomUUID()}.tmp`;
    try {
      await copyFile(source, temp, constants.COPYFILE_EXCL);
      await fsync(temp);
      await this.#fault("asset_temp_fsynced");
      try {
        await link(temp, destination);
      } catch (error) {
        if ((error as { code?: unknown }).code !== "EEXIST") throw error;
        if (await hashFile(destination) !== asset.sha256) {
          throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED", "Existing content-addressed asset has the wrong bytes");
        }
      }
      await unlink(temp).catch(() => undefined);
      await fsync(dirname(destination));
      await this.#fault("asset_installed");
    } catch (error) {
      await unlink(temp).catch(() => undefined);
      throw error;
    }
  }
}
