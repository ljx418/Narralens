import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { HttpError } from "../api-error.js";

/**
 * SourceDigestV1 (`03_M2_M4_MODULE_DESIGN.md` §1.5, AC-006).
 *
 * The digest covers the whole referenced closure of a project — entry film, scenes,
 * their html/js/css, subtitles, settings, fonts and the content of referenced media —
 * not just one entry file. Closure resolution is deterministic per
 * `docs/migration/M2/M2.1-development-and-acceptance-plan.md` §5.4.1–§5.4.3 so two
 * implementations produce byte-identical canonical bytes.
 *
 * Every failure throws. There is no partial manifest and no silent skip.
 */

export const SOURCE_DIGEST_DOMAIN = "narralens-source-v1\n";

import type { EngineKind, Sha256, SourceDigestManifest, SourceFileRole } from "../../contracts/engine-types.js";

export type { SourceDigestManifest, SourceFileRole };

/** Returned only on complete success; any error throws instead. */
export interface SourceDigestResult {
  readonly manifest: SourceDigestManifest;
  readonly source_digest: Sha256;
  readonly external_reference_count: number;
}

export interface DeclaredAsset {
  readonly path: string;
  readonly asset_id: string;
}

export interface SourceDigestInput {
  readonly root: string;
  readonly roots: readonly string[];
  readonly engine: EngineKind;
  readonly engineUpstreamSha: string;
  readonly declaredAssets?: readonly DeclaredAsset[] | undefined;
}

const ASSET_EXTENSIONS = new Set([
  "wav", "mp3", "m4a", "aac", "ogg", "oga", "opus", "flac", "aif", "aiff", "weba",
  "mp4", "m4v", "mov", "webm", "mkv", "avi", "ogv",
  "png", "jpg", "jpeg", "webp", "gif", "avif",
]);

const ROLE_BY_EXTENSION = new Map<string, SourceFileRole>([
  ["html", "html"], ["htm", "html"], ["js", "js"], ["mjs", "js"], ["cjs", "js"],
  ["css", "css"], ["vtt", "subtitle"], ["srt", "subtitle"], ["json", "settings"],
  ["woff", "font"], ["woff2", "font"], ["ttf", "font"], ["otf", "font"], ["eot", "font"],
]);

const EXTERNAL_SCHEME = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/iu;

function fail(code: "SOURCE_PATH_ESCAPE" | "SOURCE_REFERENCE_UNRESOLVED" | "SOURCE_REFERENCE_UNSUPPORTED"
  | "SOURCE_FILE_ROLE_UNKNOWN", message: string, correlationId?: string): HttpError {
  return new HttpError(422, "UNSUPPORTED_EDIT", `${code}: ${message}`, { source_error: code }, correlationId);
}

function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot + 1).toLowerCase();
}

/** Reject absolute paths, traversal and backslash separators before touching the filesystem. */
function normalizeRelative(input: string, correlationId?: string): string {
  const value = input.trim();
  if (value === "") throw fail("SOURCE_PATH_ESCAPE", "empty relative path", correlationId);
  if (value.includes("\\")) throw fail("SOURCE_PATH_ESCAPE", `backslash separator in ${value}`, correlationId);
  if (value.startsWith("/") || /^[a-z]:/iu.test(value)) {
    throw fail("SOURCE_PATH_ESCAPE", `absolute path ${value}`, correlationId);
  }
  const segments = value.split("/").filter((segment) => segment !== "" && segment !== ".");
  if (segments.includes("..")) throw fail("SOURCE_PATH_ESCAPE", `traversal in ${value}`, correlationId);
  if (segments.length === 0) throw fail("SOURCE_PATH_ESCAPE", `empty relative path ${value}`, correlationId);
  return segments.join("/");
}

/** UTF-8 byte-order comparison. `localeCompare` is deliberately not used. */
export function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

/**
 * Canonical JSON: object keys in UTF-8 byte order, integers only, no whitespace.
 * This is the single serialization used for the digest; no module may hand-roll a variant.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => compareUtf8(a, b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error(`CANONICAL_NON_INTEGER:${value}`);
    return String(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  throw new Error(`CANONICAL_UNSUPPORTED_TYPE:${typeof value}`);
}

interface Candidate { readonly offset: number; readonly raw: string }

function pushMatches(candidates: Candidate[], pattern: RegExp, group: (match: RegExpExecArray) => string | undefined,
  base: number, text: string): void {
  pattern.lastIndex = 0;
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    const value = group(match);
    if (value !== undefined && value !== "") candidates.push({ offset: base + match.index, raw: value });
  }
}

const ATTRIBUTE = /(?:^|[\s"'/])(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)')/giu;
const URL_FUNCTION = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"]*?))\s*\)/giu;
const STYLE_BLOCK = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/giu;
const STYLE_ATTRIBUTE = /\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/giu;
const CSS_IMPORT = /@import\s+(?:"([^"]*)"|'([^']*)')/giu;
const JS_STATIC_FROM = /\bimport\b[^;'"]*?\bfrom\s*(?:"([^"]*)"|'([^']*)')/gu;
const JS_DYNAMIC = /\bimport\(\s*(?:"([^"]*)"|'([^']*)')\s*\)/gu;
const VTT_URI = /^URI:[ \t]+(\S+)[ \t]*$/gmu;

function firstGroup(match: RegExpExecArray): string | undefined { return match[1] ?? match[2] ?? match[3]; }

/**
 * Reference extraction per file role (plan §5.4.1a). Attributes outside this table are
 * deliberately not extracted, so two implementations cannot disagree about what counts.
 */
export function extractReferences(role: SourceFileRole, text: string): string[] {
  const candidates: Candidate[] = [];
  switch (role) {
    case "entry":
    case "scene":
    case "html": {
      pushMatches(candidates, ATTRIBUTE, firstGroup, 0, text);
      STYLE_BLOCK.lastIndex = 0;
      for (let block = STYLE_BLOCK.exec(text); block !== null; block = STYLE_BLOCK.exec(text)) {
        const start = block.index + block[0]!.indexOf(block[1] ?? "");
        pushMatches(candidates, URL_FUNCTION, firstGroup, start, block[1] ?? "");
      }
      STYLE_ATTRIBUTE.lastIndex = 0;
      for (let attribute = STYLE_ATTRIBUTE.exec(text); attribute !== null; attribute = STYLE_ATTRIBUTE.exec(text)) {
        const start = attribute.index + attribute[0].indexOf(attribute[1] ?? attribute[2] ?? "");
        pushMatches(candidates, URL_FUNCTION, firstGroup, start, attribute[1] ?? attribute[2] ?? "");
      }
      break;
    }
    case "css":
      pushMatches(candidates, CSS_IMPORT, firstGroup, 0, text);
      pushMatches(candidates, URL_FUNCTION, firstGroup, 0, text);
      break;
    case "js":
      pushMatches(candidates, JS_STATIC_FROM, firstGroup, 0, text);
      pushMatches(candidates, JS_DYNAMIC, firstGroup, 0, text);
      break;
    case "subtitle": {
      const body = text.replace(/^﻿/, "");
      const headerEnd = body.search(/\r?\n\r?\n/u);
      const cueBody = headerEnd === -1 ? body : body.slice(headerEnd);
      pushMatches(candidates, VTT_URI, firstGroup, headerEnd === -1 ? 0 : headerEnd, cueBody);
      break;
    }
    case "settings":
    case "font":
      break;
  }
  candidates.sort((left, right) => left.offset - right.offset);
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.raw)) continue;
    seen.add(candidate.raw);
    ordered.push(candidate.raw);
  }
  return ordered;
}

interface ResolvedFile {
  readonly relative: string;
  readonly bytes: Buffer;
  readonly sha256: Sha256;
}

/**
 * Resolve, realpath, then test containment — in that order (plan §5.4.2 step 7).
 * Any failure throws immediately; nothing is collected or degraded.
 */
async function loadFile(rootAbsolute: string, resolved: string, label: string, correlationId?: string): Promise<ResolvedFile> {
  let canonical: string;
  try { canonical = await realpath(resolved); }
  catch { throw fail("SOURCE_REFERENCE_UNRESOLVED", label, correlationId); }
  if (canonical !== rootAbsolute && !canonical.startsWith(`${rootAbsolute}${sep}`)) {
    throw fail("SOURCE_PATH_ESCAPE", label, correlationId);
  }
  const bytes = await readFile(canonical);
  return {
    relative: canonical.slice(rootAbsolute.length + 1).split(sep).join("/"),
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function roleFor(extension: string, referencedByEntry: boolean, correlationId?: string): SourceFileRole {
  const role = ROLE_BY_EXTENSION.get(extension);
  if (role === undefined) throw fail("SOURCE_FILE_ROLE_UNKNOWN", `.${extension}`, correlationId);
  return role === "html" && referencedByEntry ? "scene" : role;
}

export async function computeSourceDigest(input: SourceDigestInput, correlationId?: string): Promise<SourceDigestResult> {
  const rootAbsolute = await realpath(input.root);
  const declaredByPath = new Map<string, string>();
  for (const asset of input.declaredAssets ?? []) {
    declaredByPath.set(normalizeRelative(asset.path, correlationId), asset.asset_id);
  }

  const roles = new Map<string, SourceFileRole>();
  const visited = new Set<string>();
  const queue: Array<{ relative: string; referrer: string }> = [];
  const files: Array<{ path: string; role: SourceFileRole; sha256: Sha256; size: number }> = [];
  const assets: Array<{ path: string; asset_id: string | null; sha256: Sha256; size: number }> = [];
  let externalReferenceCount = 0;

  // Declared roots: sorted, deduplicated, roles fixed before any traversal (§5.4.2 step 2).
  const normalizedRoots = [...new Set(input.roots.map((root) => normalizeRelative(root, correlationId)))];
  // The entry is the root the Host declared first. Sorting fixes traversal order only; it
  // must never promote some other root to `entry` just because it sorts earlier.
  const entryRelative = normalizedRoots[0];
  if (entryRelative === undefined) {
    return {
      manifest: { format: "narralens.source-digest-manifest@1.0", engine: input.engine,
        engine_upstream_sha: input.engineUpstreamSha, files: [], assets: [] },
      source_digest: createHash("sha256").update(SOURCE_DIGEST_DOMAIN)
        .update(canonicalJson({ format: "narralens.source-digest-manifest@1.0", engine: input.engine,
          engine_upstream_sha: input.engineUpstreamSha, files: [], assets: [] })).digest("hex"),
      external_reference_count: 0,
    };
  }
  for (const relative of [...normalizedRoots].sort(compareUtf8)) {
    const extension = extensionOf(relative);
    if (ASSET_EXTENSIONS.has(extension)) { queue.push({ relative, referrer: "" }); continue; }
    const role: SourceFileRole = relative === entryRelative ? "entry" : roleFor(extension, false, correlationId);
    roles.set(relative, role);
    queue.push({ relative, referrer: "" });
  }
  while (queue.length > 0) {
    const item = queue.shift()!;
    if (visited.has(item.relative)) continue;
    visited.add(item.relative);

    const extension = extensionOf(item.relative);
    const isAsset = ASSET_EXTENSIONS.has(extension);
    const loaded = await loadFile(rootAbsolute, resolve(rootAbsolute, item.relative), item.relative, correlationId);
    if (isAsset) {
      assets.push({ path: loaded.relative, asset_id: declaredByPath.get(loaded.relative) ?? null,
        sha256: loaded.sha256, size: loaded.bytes.length });
      continue;
    }

    const role = roles.get(item.relative)
      ?? roleFor(extension, item.referrer === entryRelative, correlationId);
    roles.set(item.relative, role);
    files.push({ path: loaded.relative, role, sha256: loaded.sha256, size: loaded.bytes.length });

    for (const reference of extractReferences(role, loaded.bytes.toString("utf8"))) {
      const withoutFragment = reference.split("#")[0] ?? "";
      if (withoutFragment === "") continue;
      if (withoutFragment.includes("?")) {
        throw fail("SOURCE_REFERENCE_UNSUPPORTED", `query string in ${reference} (from ${item.relative})`, correlationId);
      }
      if (EXTERNAL_SCHEME.test(withoutFragment)) { externalReferenceCount += 1; continue; }
      const resolvedRelative = resolveReference(item.relative, withoutFragment, correlationId);
      if (visited.has(resolvedRelative)) continue;
      const targetExtension = extensionOf(resolvedRelative);
      if (!ASSET_EXTENSIONS.has(targetExtension) && !ROLE_BY_EXTENSION.has(targetExtension)) {
        throw fail("SOURCE_FILE_ROLE_UNKNOWN", `.${targetExtension} (${resolvedRelative})`, correlationId);
      }
      // Existence and containment are proven now so the queue only holds real files.
      await loadFile(rootAbsolute, resolve(rootAbsolute, resolvedRelative),
        `${resolvedRelative} (from ${item.relative})`, correlationId);
      queue.push({ relative: resolvedRelative, referrer: item.relative });
    }
  }

  for (const asset of input.declaredAssets ?? []) {
    const relative = normalizeRelative(asset.path, correlationId);
    if (assets.some((entry) => entry.path === relative)) continue;
    const loaded = await loadFile(rootAbsolute, resolve(rootAbsolute, relative), relative, correlationId);
    assets.push({ path: loaded.relative, asset_id: asset.asset_id, sha256: loaded.sha256, size: loaded.bytes.length });
  }

  files.sort((left, right) => compareUtf8(left.path, right.path));
  const manifest: SourceDigestManifest = {
    format: "narralens.source-digest-manifest@1.0",
    engine: input.engine,
    engine_upstream_sha: input.engineUpstreamSha,
    files,
    assets,
  };
  return {
    manifest,
    source_digest: createHash("sha256")
      .update(SOURCE_DIGEST_DOMAIN)
      .update(canonicalJson(manifest))
      .digest("hex"),
    external_reference_count: externalReferenceCount,
  };
}

/**
 * Resolve a reference found inside `referrer` against its directory. `..` is legitimate
 * inside a project (a scene referencing `../assets/theme.css`), so it is resolved here and
 * the result must still land inside the root — proven lexically first, then by realpath
 * containment in `loadFile`. Absolute and backslash references are refused outright.
 */
function resolveReference(referrer: string, raw: string, correlationId?: string): string {
  if (raw.includes("\\")) throw fail("SOURCE_PATH_ESCAPE", `backslash separator in ${raw}`, correlationId);
  if (raw.startsWith("/") || /^[a-z]:/iu.test(raw)) {
    throw fail("SOURCE_PATH_ESCAPE", `absolute path ${raw}`, correlationId);
  }
  const joined = joinRelative(referrer, raw);
  if (joined === "" || joined === ".." || joined.startsWith("../")) {
    throw fail("SOURCE_PATH_ESCAPE", `${raw} (from ${referrer}) escapes the project root`, correlationId);
  }
  return joined;
}

function dirnameSlash(path: string): string {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "" : path.slice(0, index);
}

function joinRelative(from: string, target: string): string {
  const base = dirnameSlash(from);
  const segments = (base === "" ? [] : base.split("/")).concat(target.split("/"));
  const stack: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (stack.length === 0) return "..";  // climbed above the project root
      stack.pop();
      continue;
    }
    stack.push(segment);
  }
  return stack.join("/");
}
