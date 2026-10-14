import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { lstat, mkdir, realpath, rm } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { resolve, sep } from "node:path";
import type { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";

import Busboy from "busboy";

import { contractIds, validatorFor } from "../../contracts/validator.js";
import type { AssetImportMetadata } from "../../contracts/types.js";
import { HttpError } from "../api-error.js";

const metadataLimit = 16 * 1024;
const transportOverhead = 64 * 1024;

export interface AssetUploadLimits {
  fileBytes: number;
  totalBytes?: number;
}

export interface AssetUploadDependencies {
  createStagingWrite?: (path: string) => Writable;
}

export interface StagedAssetUpload {
  metadata: AssetImportMetadata;
  stagingDirectory: string;
  filePath: string;
  bytesSha256: string;
  byteLength: number;
}

export async function receiveAssetUpload(request: IncomingMessage, projectRoot: string,
  limits: AssetUploadLimits, dependencies: AssetUploadDependencies = {}): Promise<StagedAssetUpload> {
  const totalLimit = limits.totalBytes ?? limits.fileBytes + transportOverhead;
  if (!Number.isSafeInteger(limits.fileBytes) || limits.fileBytes < 1 || limits.fileBytes >= Number.MAX_SAFE_INTEGER
    || !Number.isSafeInteger(totalLimit)
    || totalLimit < limits.fileBytes) throw new Error("INVALID_ASSET_UPLOAD_LIMITS");
  validateLengthHeaders(request, totalLimit);
  const root = await realpath(projectRoot);
  const stagingRoot = await secureDirectory(root, [".narralens", "staging"]);
  const stagingDirectory = await secureDirectory(root, [".narralens", "staging", `import-${randomUUID()}`]);
  const filePath = resolve(stagingDirectory, "source.mp4.part");
  try {
    return await parseMultipart(request, root, stagingRoot, stagingDirectory, filePath, limits.fileBytes, totalLimit,
      dependencies.createStagingWrite ?? ((path) => createWriteStream(path, { flags: "wx", mode: 0o600 })));
  } catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true });
    throw normalizeUploadError(error);
  }
}

export async function cleanupStagedAsset(upload: Pick<StagedAssetUpload, "stagingDirectory">): Promise<void> {
  await rm(upload.stagingDirectory, { recursive: true, force: true });
}

async function parseMultipart(request: IncomingMessage, root: string, stagingRoot: string, stagingDirectory: string,
  filePath: string, fileLimit: number, totalLimit: number, createStagingWrite: (path: string) => Writable): Promise<StagedAssetUpload> {
  let parser: ReturnType<typeof Busboy>;
  try {
    parser = Busboy({ headers: request.headers, limits: {
      files: 1, fields: 1, parts: 3, fileSize: fileLimit + 1, fieldSize: metadataLimit + 1,
      fieldNameSize: 32, headerPairs: 32,
    } });
  } catch {
    throw new HttpError(400, "INVALID_REQUEST", "Expected a valid multipart/form-data request");
  }

  let metadataText: string | undefined;
  let metadataType: string | undefined;
  let fileSeen = false;
  let fileLimited = false;
  let activeFileStream: Readable | undefined;
  let byteLength = 0;
  let rawBytes = 0;
  const digest = createHash("sha256");
  let fileWrite: Promise<void> | undefined;
  const onRawData = (chunk: Buffer): void => {
    rawBytes += chunk.length;
    if (rawBytes > totalLimit) uploadFail?.(new HttpError(413, "INVALID_REQUEST", "Multipart request exceeds the configured limit"));
  };
  let uploadFail: ((error: unknown) => void) | undefined;

  const onAborted = (): void => uploadFail?.(new HttpError(400, "INVALID_REQUEST", "Asset upload was aborted"));
  const onRequestError = (): void => uploadFail?.(new HttpError(400, "INVALID_REQUEST", "Asset upload stream failed"));
  const parsed = new Promise<void>((resolvePromise, reject) => {
    let settled = false;
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      request.unpipe(parser);
      activeFileStream?.destroy(error instanceof Error ? error : new Error(String(error)));
      request.resume();
      reject(error);
    };
    uploadFail = fail;
    const done = (): void => { if (!settled) { settled = true; resolvePromise(); } };
    request.on("data", onRawData);
    request.once("aborted", onAborted);
    request.once("error", onRequestError);
    parser.on("error", () => fail(new HttpError(400, "INVALID_REQUEST", "Asset multipart body is malformed")));
    parser.once("partsLimit", () => fail(new HttpError(400, "INVALID_REQUEST", "Asset upload has too many parts")));
    parser.once("filesLimit", () => fail(new HttpError(400, "INVALID_REQUEST", "Asset upload has too many files")));
    parser.once("fieldsLimit", () => fail(new HttpError(400, "INVALID_REQUEST", "Asset upload has too many fields")));
    parser.on("field", (name, value, info) => {
      if (name !== "metadata" || metadataText !== undefined || info.valueTruncated
        || Buffer.byteLength(value, "utf8") > metadataLimit || info.mimeType !== "application/json") {
        fail(new HttpError(info.valueTruncated || Buffer.byteLength(value, "utf8") > metadataLimit ? 413 : 400,
          "INVALID_REQUEST", "Expected exactly one bounded metadata field"));
        return;
      }
      metadataText = value;
      metadataType = info.mimeType;
    });
    parser.on("file", (name, stream, info) => {
      if (name !== "file" || fileSeen || info.mimeType !== "video/mp4") {
        stream.resume();
        fail(new HttpError(400, "INVALID_REQUEST", "Expected exactly one video/mp4 file part"));
        return;
      }
      fileSeen = true;
      activeFileStream = stream;
      stream.once("limit", () => {
        fileLimited = true;
        fail(new HttpError(413, "INVALID_REQUEST", "Asset file exceeds the configured limit"));
      });
      stream.on("data", (chunk: Buffer) => { byteLength += chunk.length; digest.update(chunk); });
      fileWrite = pipeline(stream, createStagingWrite(filePath)).then(() => undefined);
      void fileWrite.catch(fail);
    });
    parser.once("close", done);
    request.pipe(parser);
  });
  try {
    await parsed;
    await fileWrite;
  } catch (error) {
    await fileWrite?.catch(() => undefined);
    throw error;
  } finally {
    request.off("data", onRawData);
    request.off("aborted", onAborted);
    request.off("error", onRequestError);
    uploadFail = undefined;
  }
  if (!fileSeen || fileWrite === undefined || metadataText === undefined) {
    throw new HttpError(400, "INVALID_REQUEST", "Expected exactly one metadata field and one file part");
  }
  if (fileLimited || byteLength > fileLimit) throw new HttpError(413, "INVALID_REQUEST", "Asset file exceeds the configured limit");
  if (byteLength === 0) throw new HttpError(422, "INVALID_MEDIA", "Asset file is empty");
  if (metadataType !== "application/json") throw new HttpError(400, "INVALID_REQUEST", "Metadata must use application/json");
  let metadata: unknown;
  try { metadata = JSON.parse(metadataText); }
  catch { throw new HttpError(400, "INVALID_REQUEST", "Asset metadata is not valid JSON"); }
  if (!validatorFor(contractIds.assetImportMetadata)(metadata)) {
    throw new HttpError(400, "INVALID_REQUEST", "Asset metadata does not satisfy the contract");
  }
  if (!stagingDirectory.startsWith(`${stagingRoot}${sep}`) || !stagingRoot.startsWith(`${root}${sep}`)) {
    throw new HttpError(500, "INTERNAL_ERROR", "Asset staging escaped the project root");
  }
  return { metadata: metadata as AssetImportMetadata, stagingDirectory, filePath,
    bytesSha256: digest.digest("hex"), byteLength };
}

function validateLengthHeaders(request: IncomingMessage, limit: number): void {
  const length = request.headers["content-length"];
  if (length !== undefined) {
    if (!/^(0|[1-9][0-9]*)$/u.test(length)) throw new HttpError(400, "INVALID_REQUEST", "Content-Length is invalid");
    const parsed = Number(length);
    if (!Number.isSafeInteger(parsed) || parsed > limit) throw new HttpError(413, "INVALID_REQUEST", "Multipart request exceeds the configured limit");
    return;
  }
  const encoding = request.headers["transfer-encoding"];
  if (typeof encoding !== "string" || !encoding.toLowerCase().split(",").map((item) => item.trim()).includes("chunked")) {
    throw new HttpError(400, "INVALID_REQUEST", "Multipart upload requires Content-Length or chunked transfer encoding");
  }
}

async function secureDirectory(root: string, segments: string[]): Promise<string> {
  let current = root;
  for (const segment of segments) {
    current = resolve(current, segment);
    if (!current.startsWith(`${root}${sep}`)) throw new HttpError(500, "INTERNAL_ERROR", "Asset staging escaped the project root");
    try {
      const facts = await lstat(current);
      if (!facts.isDirectory() || facts.isSymbolicLink()) throw new Error("unsafe staging component");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new HttpError(500, "INTERNAL_ERROR", "Asset staging path is unsafe");
      try { await mkdir(current, { mode: 0o700 }); }
      catch (mkdirError) {
        if ((mkdirError as NodeJS.ErrnoException).code !== "EEXIST") throw mkdirError;
        const facts = await lstat(current);
        if (!facts.isDirectory() || facts.isSymbolicLink()) throw new HttpError(500, "INTERNAL_ERROR", "Asset staging path is unsafe");
      }
    }
    current = await realpath(current);
    if (!current.startsWith(`${root}${sep}`)) throw new HttpError(500, "INTERNAL_ERROR", "Asset staging path is unsafe");
  }
  return current;
}

function normalizeUploadError(error: unknown): unknown {
  if (error instanceof HttpError) return error;
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === "ENOSPC" || code === "EDQUOT") return new HttpError(500, "TRANSACTION_FAILED", "Asset staging storage is unavailable");
  return error;
}
