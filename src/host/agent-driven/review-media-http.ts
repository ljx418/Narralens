import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { validateAgentDefinition } from '../../contracts/agent-driven-validator.js';
import type { ReviewPart } from '../../contracts/agent-driven-types.js';
import type { AgentPrincipal, ScopedAgentAuth } from './scoped-auth.js';
import { createTrustedCallerContext } from '../creative/trusted-context.js';
import { AgentRouteError } from './agent-http-router.js';
import { agentErrorCode } from './agent-error-alias.js';
import registry from '../../../contracts/agent-driven-a.registry.json' with { type: 'json' };
import {
  PREPARED_REVIEW_MAX_READ_BYTES,
  type PreparedPreviewReceiptV1,
  type PreparedReviewMediaHandleV1,
  type PreparedReviewMediaReader,
  type PreviewMediaDescriptorV1,
} from '../render/assembly-ports.js';

const statuses = new Map(registry.errorMapping.map((row) => [row.code, row.http_status]));
const REF = /^[A-Za-z0-9_-]{1,200}$/;
const PART_KINDS = ['preview', 'narration', 'subtitles', 'shot_summary', 'rights_quality'] as const;

/**
 * One reviewable part of the current package, bound to the immutable preview receipt
 * and to the exact object inside it.
 *
 * The binding is established when the real package is established. It is never taken
 * from a request: a caller names an opaque reference and the Host resolves it.
 */
export interface ReviewMediaBinding {
  readonly project_id: string;
  readonly run_id: string;
  readonly package_id: string;
  readonly package_version: number;
  readonly package_digest: string;
  readonly part: ReviewPart;
  readonly receipt: PreparedPreviewReceiptV1;
  readonly object_id: string;
  /** The slot of the receipt that carries this part's object. */
  readonly slot: (typeof PART_KINDS)[number];
}

/**
 * The private registry of the reviewable media bindings.
 *
 * It is written by the Host when a real package is established and read by the
 * transport. It holds no bytes of its own and it never accepts a path.
 */
export class ReviewMediaRegistry {
  readonly #byRef = new Map<string, ReviewMediaBinding>();
  readonly #byPackage = new Map<string, ReviewMediaBinding[]>();

  /** The opaque reference of one part. It contains no path and no identifier. */
  static referenceFor(binding: ReviewMediaBinding): string {
    return `rm_${createHash('sha256').update([
      binding.project_id,
      binding.run_id,
      binding.package_id,
      String(binding.package_version),
      binding.package_digest,
      binding.slot,
      binding.object_id,
    ].join('|')).digest('hex').slice(0, 48)}`;
  }

  register(binding: ReviewMediaBinding): string {
    const reference = ReviewMediaRegistry.referenceFor(binding);
    this.#byRef.set(reference, binding);
    const key = `${binding.project_id}|${binding.run_id}|${binding.package_id}|${binding.package_version}`;
    const existing = this.#byPackage.get(key) ?? [];
    if (!existing.some((row) => row.object_id === binding.object_id && row.slot === binding.slot)) {
      existing.push(binding);
      this.#byPackage.set(key, existing);
    }
    return reference;
  }

  /** The binding of one opaque reference inside a project. */
  resolve(projectId: string, reference: string): ReviewMediaBinding | null {
    const binding = this.#byRef.get(reference);
    if (!binding || binding.project_id !== projectId) return null;
    return binding;
  }

  /** The binding of one part of one package. */
  resolvePart(input: {
    readonly project_id: string;
    readonly run_id: string;
    readonly package_id: string;
    readonly package_version: number;
    readonly part_kind: string;
    readonly artifact_ref: { readonly id: string; readonly version: number; readonly sha256: string };
  }): ReviewMediaBinding | null {
    const key = `${input.project_id}|${input.run_id}|${input.package_id}|${input.package_version}`;
    const rows = this.#byPackage.get(key) ?? [];
    return rows.find((row) =>
      row.part.kind === input.part_kind &&
      row.part.artifact_ref.id === input.artifact_ref.id &&
      row.part.artifact_ref.version === input.artifact_ref.version &&
      row.part.artifact_ref.sha256 === input.artifact_ref.sha256) ?? null;
  }
}

export interface ReviewMediaHttpOptions {
  readonly auth: ScopedAgentAuth;
  readonly origin: () => string;
  readonly registry: ReviewMediaRegistry;
  /**
   * The real MEDIA reader. Without it the transport answers 503: a preview that has no
   * producer is unavailable, never a fabricated one.
   */
  readonly reader?: PreparedReviewMediaReader;
}

/**
 * The read-only review media transport.
 *
 * One reviewed read route plus the closed-set describe operation of the same RPC
 * alias. It serves bytes that the real MEDIA reader verified; it never renders, never
 * registers and never starts a producer.
 */
export class ReviewMediaHttp {
  readonly #auth: ScopedAgentAuth;
  readonly #origin: () => string;
  readonly #registry: ReviewMediaRegistry;
  readonly #reader: PreparedReviewMediaReader | undefined;

  constructor(options: ReviewMediaHttpOptions) {
    this.#auth = options.auth;
    this.#origin = options.origin;
    this.#registry = options.registry;
    this.#reader = options.reader;
  }

  /** The descriptor of one part, bound to the verified receipt and object. */
  async describe(
    input: {
      readonly run_id: string;
      readonly package_id: string;
      readonly package_version: number;
      readonly part_kind: string;
      readonly artifact_ref: { readonly id: string; readonly version: number; readonly sha256: string };
    },
    projectId: string,
    caller: { readonly principal_id: string; readonly channel: string; readonly session_ref: string },
    signal?: AbortSignal,
  ): Promise<PreviewMediaDescriptorV1> {
    if (!PART_KINDS.includes(input.part_kind as (typeof PART_KINDS)[number]))
      throw new AgentRouteError('INVALID_REQUEST');
    const binding = this.#registry.resolvePart({ project_id: projectId, ...input });
    if (!binding) throw new AgentRouteError('NOT_FOUND');
    if (!this.#reader) throw new AgentRouteError('CAPABILITY_UNAVAILABLE');
    // The reader opens the verified object of the immutable receipt. The handle is
    // closed on every path, including the failure paths.
    let handle: PreparedReviewMediaHandleV1 | undefined;
    try {
      handle = await this.#reader.open(binding.receipt, binding.object_id, signal ? { signal } : {});
      if (handle.bytes < 0 || !/^[a-f0-9]{64}$/.test(handle.sha256)) throw new AgentRouteError('REVISION_CONFLICT');
      return {
        format: 'narralens.review-media-descriptor@1',
        project_id: binding.project_id,
        run_id: binding.run_id,
        package_id: binding.package_id,
        package_version: binding.package_version,
        package_digest: binding.package_digest,
        part: binding.part,
        receipt_digest: binding.receipt.receipt_digest,
        object_id: binding.object_id,
        content_type: handle.content_type,
        bytes: handle.bytes,
        sha256: handle.sha256,
        timeline: handle.timeline,
        media_facts: handle.media_facts,
      };
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  async handle(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    const url = new URL(request.url ?? '/', this.#origin());
    if (!url.pathname.startsWith('/api/ui/v1/')) return false;
    const match = url.pathname.match(/^\/api\/ui\/v1\/projects\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})\/review-media\/([A-Za-z0-9_-]{1,200})$/);
    if (!match) return false;
    const send = (status: number, body: unknown) => {
      if (response.destroyed || response.writableEnded) return;
      response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      });
      response.end(JSON.stringify(body));
    };
    let handle: PreparedReviewMediaHandleV1 | undefined;
    try {
      if (url.origin !== this.#origin() || request.headers.host !== new URL(this.#origin()).host)
        throw new AgentRouteError('ORIGIN_REJECTED');
      let hosts = 0;
      for (let i = 0; i < request.rawHeaders.length; i += 2)
        if (request.rawHeaders[i]!.toLowerCase() === 'host') hosts++;
      if (hosts !== 1) throw new AgentRouteError('ORIGIN_REJECTED');
      if (request.method !== 'GET') throw new AgentRouteError('NOT_FOUND');
      if (url.search || request.headers['transfer-encoding'] || Number(request.headers['content-length'] ?? 0) !== 0)
        throw new AgentRouteError('INVALID_REQUEST');
      const headers = {
        method: request.method,
        origin: request.headers.origin,
        authorization: request.headers.authorization,
        ...(request.headers.cookie ? { cookie: request.headers.cookie } : {}),
        ...(typeof request.headers['x-narralens-csrf'] === 'string' ? { csrf: request.headers['x-narralens-csrf'] } : {}),
        ...(request.headers.referer ? { referer: request.headers.referer } : {}),
        ...(typeof request.headers['sec-fetch-site'] === 'string' ? { secFetchSite: request.headers['sec-fetch-site'] } : {}),
        rawHeaders: request.rawHeaders,
      };
      // The native bridge never reads this surface, and the driver reads it only as an
      // owner of the project.
      const principal: AgentPrincipal = this.#auth.authenticate(headers, 'authenticated');
      if (principal.channel === 'native_bridge') throw new AgentRouteError('ORIGIN_REJECTED');
      const projectId = match[1]!;
      const reference = match[2]!;
      if (!REF.test(reference)) throw new AgentRouteError('NOT_FOUND');
      const binding = this.#registry.resolve(projectId, reference);
      if (!binding) throw new AgentRouteError('NOT_FOUND');
      if (!this.#reader) throw new AgentRouteError('CAPABILITY_UNAVAILABLE');
      const controller = new AbortController();
      request.once('aborted', () => controller.abort(Error('The media request was aborted')));
      response.once('close', () => controller.abort(Error('The media response closed')));
      handle = await this.#reader.open(binding.receipt, binding.object_id, { signal: controller.signal });
      const total = handle.bytes;
      const etag = `"${handle.sha256}"`;
      const range = this.#range(request.headers.range, total);
      if (range === 'invalid') {
        response.writeHead(416, { 'Content-Range': `bytes */${total}`, 'Accept-Ranges': 'bytes' });
        response.end();
        return true;
      }
      const start = range === null ? 0 : range.start;
      const end = range === null ? Math.min(total, PREPARED_REVIEW_MAX_READ_BYTES) - 1 : range.end;
      const chunk = await handle.read({ offset: start, length: end - start + 1 });
      // The bytes must be the verified bytes.
      if (chunk.length !== end - start + 1) throw new AgentRouteError('REVISION_CONFLICT');
      response.writeHead(range === null ? 200 : 206, {
        'Content-Type': handle.content_type,
        'Content-Length': chunk.length,
        'ETag': etag,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        ...(range === null ? {} : { 'Content-Range': `bytes ${start}-${end}/${total}` }),
      });
      response.end(Buffer.from(chunk));
      return true;
    } catch (error) {
      const code = agentErrorCode(error);
      const status = statuses.get(code) ?? 500;
      send(status, validateAgentDefinition('Error', {
        schema_version: 'agent.v1',
        correlation_id: randomUUID(),
        code,
        http_status: status,
        message: '无法读取审阅媒体，请确认会话、包与媒体状态。',
        retryable: code === 'HOST_RESOURCE_EXHAUSTED',
        next_actions: ['open_trusted_workbench'],
      }));
      return true;
    } finally {
      // Every opened descriptor is closed exactly once, on success and on failure.
      await handle?.close().catch(() => undefined);
    }
  }

  #range(value: string | undefined, total: number): { readonly start: number; readonly end: number } | null | 'invalid' {
    if (value === undefined) return null;
    const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
    if (!match) return 'invalid';
    const start = match[1] === '' ? null : Number(match[1]);
    const end = match[2] === '' ? null : Number(match[2]);
    if (start === null && end === null) return 'invalid';
    const from = start === null ? Math.max(0, total - (end ?? 0)) : start;
    const to = end === null || start === null ? total - 1 : Math.min(end, total - 1);
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to < from || from >= total) return 'invalid';
    return { start: from, end: to };
  }
}

/** The caller a review media read may act for. The body never names one. */
export function reviewMediaCaller(principal: AgentPrincipal) {
  return createTrustedCallerContext({
    principal_id: principal.principal_id,
    channel: principal.channel === 'trusted_ui' ? 'trusted_ui' : 'authenticated',
    source: principal.channel === 'trusted_ui' ? 'trusted_ui' : 'driver_relay',
    session_ref: principal.session_ref,
  });
}
