import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { validateAgentDefinition } from '../../contracts/agent-driven-validator.js';
import type { ReviewPart } from '../../contracts/agent-driven-types.js';
import type { AgentPrincipal, ScopedAgentAuth } from './scoped-auth.js';
import { AgentRouteError } from './agent-http-router.js';
import { agentErrorCode } from './agent-error-alias.js';
import registry from '../../../contracts/agent-driven-a.registry.json' with { type: 'json' };
import {
  PREPARED_REVIEW_MAX_READ_BYTES,
  type PreparedPreviewPartKind,
  type PreparedPreviewReceiptV1,
  type PreparedReviewMediaHandleV1,
  type PreparedReviewMediaReader,
  type PreviewMediaDescriptorV1,
} from '../render/assembly-ports.js';

const statuses = new Map(registry.errorMapping.map((row) => [row.code, row.http_status]));
const REF = /^[A-Za-z0-9_-]{1,200}$/;
const PART_KINDS: readonly PreparedPreviewPartKind[] = ['preview', 'narration', 'subtitles', 'shot_summary', 'rights_quality'];

/**
 * One reviewable part of the CURRENT package, bound to the immutable preview receipt
 * and to the exact object inside it.
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
  readonly slot: PreparedPreviewPartKind;
}

/**
 * The binding port of the review media transport.
 *
 * It resolves the CURRENT package, the CURRENT run and the IMMUTABLE receipt linkage
 * of one part. It is supplied by the real publication producer; an in-memory map is
 * not an authority for it, so the transport refuses to serve anything while the real
 * producer is absent.
 */
export interface ReviewMediaBindingPort {
  /** The current binding of one part of the current package of the current run. */
  currentPart(input: {
    readonly project_id: string;
    readonly run_id: string;
    readonly part_kind: string;
    readonly artifact_ref: { readonly id: string; readonly version: number; readonly sha256: string };
  }): Promise<ReviewMediaBinding | null>;
  /** The current binding behind one opaque reference. */
  currentByReference(project_id: string, reference: string): Promise<ReviewMediaBinding | null>;
}

export interface ReviewMediaHttpOptions {
  readonly auth: ScopedAgentAuth;
  readonly origin: () => string;
  /** The owner authority of the project. The transport never serves another project. */
  readonly assertOwner: (project_id: string, principal_id: string) => void;
  /** The real binding producer. Without it the whole surface is unavailable. */
  readonly bindings?: ReviewMediaBindingPort;
  /** The real MEDIA reader. Without it the whole surface is unavailable. */
  readonly reader?: PreparedReviewMediaReader;
}

/** The closed describe input of CR-R1-001 §8. */
export interface ReviewPartDescribeInput {
  readonly run_id: string;
  readonly package_id: string;
  readonly package_version: number;
  readonly part_kind: string;
  readonly artifact_ref: { readonly id: string; readonly version: number; readonly sha256: string };
}

/**
 * The read-only review media transport.
 *
 * One reviewed read route plus the closed-set describe operation of the same RPC
 * alias. It serves bytes that the real MEDIA reader verified; it never renders, never
 * registers and never starts a producer. Every check that can be invalidated by an
 * await is repeated after that await.
 */
export class ReviewMediaHttp {
  readonly #auth: ScopedAgentAuth;
  readonly #origin: () => string;
  readonly #assertOwner: (project_id: string, principal_id: string) => void;
  readonly #bindings: ReviewMediaBindingPort | undefined;
  readonly #reader: PreparedReviewMediaReader | undefined;

  constructor(options: ReviewMediaHttpOptions) {
    this.#auth = options.auth;
    this.#origin = options.origin;
    this.#assertOwner = options.assertOwner;
    this.#bindings = options.bindings;
    this.#reader = options.reader;
  }

  /** The producer side must both exist. Neither one is ever faked. */
  #producer(): { readonly bindings: ReviewMediaBindingPort; readonly reader: PreparedReviewMediaReader } {
    if (!this.#bindings || !this.#reader) throw new AgentRouteError('CAPABILITY_UNAVAILABLE');
    return { bindings: this.#bindings, reader: this.#reader };
  }

  /** The binding must really be the current package's part of the current run. */
  #verify(binding: ReviewMediaBinding, input: { readonly project_id: string; readonly run_id: string; readonly part_kind?: string; readonly artifact_ref?: { readonly id: string; readonly version: number; readonly sha256: string } }): void {
    if (binding.project_id !== input.project_id || binding.run_id !== input.run_id)
      throw new AgentRouteError('NOT_FOUND');
    if (input.part_kind !== undefined && binding.part.kind !== input.part_kind)
      throw new AgentRouteError('NOT_FOUND');
    const ref = input.artifact_ref ?? binding.part.artifact_ref;
    if (binding.part.artifact_ref.id !== ref.id || binding.part.artifact_ref.version !== ref.version || binding.part.artifact_ref.sha256 !== ref.sha256)
      throw new AgentRouteError('REVISION_CONFLICT');
    // The immutable linkage: the receipt belongs to this project and run, carries this
    // exact object, and the object's own digest and size are the receipt's facts.
    const receipt = binding.receipt;
    if (receipt.project_id !== binding.project_id || receipt.run_id !== binding.run_id)
      throw new AgentRouteError('REVISION_CONFLICT');
    const part = receipt.parts.find((row) => row.slot === binding.slot);
    if (!part || part.object_id !== binding.object_id) throw new AgentRouteError('REVISION_CONFLICT');
    if (part.bytes < 0 || !/^[a-f0-9]{64}$/.test(part.sha256)) throw new AgentRouteError('REVISION_CONFLICT');
  }

  /**
   * The descriptor of one part, bound to the verified receipt and object.
   *
   * The caller is the real principal, the owner is checked, and the binding is
   * re-read after the open: a package that moved while the object was opening is
   * refused rather than described.
   */
  async describe(
    input: ReviewPartDescribeInput,
    projectId: string,
    caller: { readonly principal_id: string; readonly channel: string; readonly session_ref: string },
    signal?: AbortSignal,
  ): Promise<PreviewMediaDescriptorV1> {
    if (caller.channel === 'native_bridge') throw new AgentRouteError('ORIGIN_REJECTED');
    if (!PART_KINDS.includes(input.part_kind as PreparedPreviewPartKind))
      throw new AgentRouteError('INVALID_REQUEST');
    if (!Number.isSafeInteger(input.package_version) || input.package_version < 1)
      throw new AgentRouteError('INVALID_REQUEST');
    this.#assertOwner(projectId, caller.principal_id);
    const { bindings, reader } = this.#producer();
    const binding = await bindings.currentPart({
      project_id: projectId,
      run_id: input.run_id,
      part_kind: input.part_kind,
      artifact_ref: input.artifact_ref,
    });
    if (!binding) throw new AgentRouteError('NOT_FOUND');
    this.#verify(binding, { project_id: projectId, run_id: input.run_id, part_kind: input.part_kind, artifact_ref: input.artifact_ref });
    if (binding.package_id !== input.package_id || binding.package_version !== input.package_version)
      throw new AgentRouteError('NOT_FOUND');
    let handle: PreparedReviewMediaHandleV1 | undefined;
    try {
      handle = await reader.open(binding.receipt, binding.object_id, signal ? { signal } : {});
      // After the await: the owner is still the owner, the binding is still current and
      // the handle still describes the very object of the receipt.
      this.#assertOwner(projectId, caller.principal_id);
      const current = await bindings.currentPart({
        project_id: projectId,
        run_id: input.run_id,
        part_kind: input.part_kind,
        artifact_ref: input.artifact_ref,
      });
      if (!current || current.receipt.receipt_digest !== binding.receipt.receipt_digest || current.object_id !== binding.object_id)
        throw new AgentRouteError('REVISION_CONFLICT');
      const part = binding.receipt.parts.find((row) => row.slot === binding.slot)!;
      if (handle.sha256 !== part.sha256 || handle.bytes !== part.bytes)
        throw new AgentRouteError('REVISION_CONFLICT');
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

  /**
   * Open one prepared object for the workbench delegate.
   *
   * The supplied signal is forwarded into the real reader, and the owner and the
   * current binding are checked before and after the open.
   */
  async openMedia(
    projectId: string,
    reference: string,
    caller: { readonly principal_id: string; readonly channel: string; readonly session_ref: string },
    options: { readonly range?: { readonly offset: number; readonly length: number }; readonly signal?: AbortSignal } = {},
  ): Promise<{ readonly content_type: string; readonly bytes: number; readonly sha256: string; readonly etag: string; readonly read: (range: { readonly offset: number; readonly length: number }) => Promise<Uint8Array>; readonly close: () => Promise<void> }> {
    if (caller.channel === 'native_bridge') throw new AgentRouteError('ORIGIN_REJECTED');
    if (!REF.test(reference)) throw new AgentRouteError('INVALID_REQUEST');
    this.#assertOwner(projectId, caller.principal_id);
    const { bindings, reader } = this.#producer();
    const binding = await bindings.currentByReference(projectId, reference);
    if (!binding) throw new AgentRouteError('NOT_FOUND');
    this.#verify(binding, { project_id: projectId, run_id: binding.run_id });
    options.signal?.throwIfAborted();
    let handle: PreparedReviewMediaHandleV1 | undefined;
    try {
      handle = await reader.open(binding.receipt, binding.object_id, options.signal ? { signal: options.signal } : {});
      this.#assertOwner(projectId, caller.principal_id);
      const current = await bindings.currentByReference(projectId, reference);
      if (!current || current.receipt.receipt_digest !== binding.receipt.receipt_digest)
        throw new AgentRouteError('REVISION_CONFLICT');
      const part = binding.receipt.parts.find((row) => row.slot === binding.slot)!;
      if (handle.sha256 !== part.sha256 || handle.bytes !== part.bytes)
        throw new AgentRouteError('REVISION_CONFLICT');
      const opened = handle;
      let closing = false;
      return {
        content_type: opened.content_type,
        bytes: opened.bytes,
        sha256: opened.sha256,
        etag: `"${opened.sha256}"`,
        read: async (window) => {
          if (closing) throw new AgentRouteError('CAPABILITY_UNAVAILABLE');
          options.signal?.throwIfAborted();
          if (!Number.isSafeInteger(window?.offset) || !Number.isSafeInteger(window?.length) || window.offset < 0 || window.length < 1 || window.length > PREPARED_REVIEW_MAX_READ_BYTES)
            throw new AgentRouteError('INVALID_REQUEST');
          const bytes = await opened.read({ offset: window.offset, length: window.length });
          options.signal?.throwIfAborted();
          return bytes;
        },
        close: async () => {
          if (closing) return;
          closing = true;
          await opened.close();
        },
      };
    } catch (error) {
      await handle?.close().catch(() => undefined);
      throw error;
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
      // The native bridge never reads this surface. The driver reads it only as the
      // owner of the project, and the trusted UI reads it with its own proof.
      const principal: AgentPrincipal = this.#auth.authenticate(headers, 'authenticated');
      if (principal.channel === 'native_bridge') throw new AgentRouteError('ORIGIN_REJECTED');
      const projectId = match[1]!;
      const reference = match[2]!;
      this.#assertOwner(projectId, principal.principal_id);
      const { bindings, reader } = this.#producer();
      const binding = await bindings.currentByReference(projectId, reference);
      if (!binding) throw new AgentRouteError('NOT_FOUND');
      this.#verify(binding, { project_id: projectId, run_id: binding.run_id });
      const controller = new AbortController();
      const abort = () => controller.abort(Error('The media request was aborted'));
      request.once('aborted', abort);
      response.once('close', abort);
      handle = await reader.open(binding.receipt, binding.object_id, { signal: controller.signal });
      // After the open: the owner is still the owner and the binding is still current.
      this.#assertOwner(projectId, principal.principal_id);
      const current = await bindings.currentByReference(projectId, reference);
      if (!current || current.receipt.receipt_digest !== binding.receipt.receipt_digest)
        throw new AgentRouteError('REVISION_CONFLICT');
      const part = binding.receipt.parts.find((row) => row.slot === binding.slot)!;
      if (handle.sha256 !== part.sha256 || handle.bytes !== part.bytes)
        throw new AgentRouteError('REVISION_CONFLICT');
      const total = handle.bytes;
      const etag = `"${handle.sha256}"`;
      const window = this.#range(request.headers.range, total);
      if (window === 'invalid') {
        response.writeHead(416, { 'Content-Range': `bytes */${total}`, 'Accept-Ranges': 'bytes' });
        response.end();
        return true;
      }
      const from = window === null ? 0 : window.start;
      const to = window === null ? total - 1 : window.end;
      const length = to - from + 1;
      response.writeHead(window === null ? 200 : 206, {
        'Content-Type': handle.content_type,
        'Content-Length': length,
        'ETag': etag,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        ...(window === null ? {} : { 'Content-Range': `bytes ${from}-${to}/${total}` }),
      });
      // The whole requested window is streamed in bounded reads, with the socket's
      // backpressure awaited before the next read.
      let offset = from;
      let remaining = length;
      while (remaining > 0) {
        controller.signal.throwIfAborted();
        const size = Math.min(remaining, PREPARED_REVIEW_MAX_READ_BYTES);
        const chunk = await handle.read({ offset, length: size });
        controller.signal.throwIfAborted();
        if (chunk.length !== size) throw new AgentRouteError('REVISION_CONFLICT');
        if (!response.write(Buffer.from(chunk))) await this.#drain(response);
        offset += size;
        remaining -= size;
      }
      response.end();
      return true;
    } catch (error) {
      const code = agentErrorCode(error);
      const status = statuses.get(code) ?? 500;
      if (response.headersSent) {
        response.destroy();
        return true;
      }
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

  /** Wait for the socket to accept the bytes that were already written. */
  #drain(response: ServerResponse): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        response.off('drain', onDrain);
        response.off('close', onClose);
        response.off('error', onError);
      };
      const onDrain = () => { cleanup(); resolve(); };
      const onClose = () => { cleanup(); reject(Error('The media response closed')); };
      const onError = () => { cleanup(); reject(Error('The media response failed')); };
      response.once('drain', onDrain);
      response.once('close', onClose);
      response.once('error', onError);
    });
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
