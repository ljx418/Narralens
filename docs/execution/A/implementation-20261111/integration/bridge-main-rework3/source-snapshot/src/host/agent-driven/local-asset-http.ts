import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { validateAgentDefinition } from '../../contracts/agent-driven-validator.js';
import type { AgentPrincipal, ScopedAgentAuth } from './scoped-auth.js';
import { createTrustedCallerContext } from '../creative/trusted-context.js';
import { AgentRouteError } from './agent-http-router.js';
import { agentErrorCode } from './agent-error-alias.js';
import registry from '../../../contracts/agent-driven-a.registry.json' with { type: 'json' };
import type { AssetInventory } from './asset-inventory.js';

const statuses = new Map(registry.errorMapping.map((row) => [row.code, row.http_status]));
const MAX_BODY_BYTES = 64 * 1024;
const PROJECT = '([A-Za-z0-9][A-Za-z0-9_-]{0,63})';

/**
 * The adjunct local-material transport.
 *
 * Four reviewed routes, counted separately from the frozen 31: the trusted UI lists
 * the safe source files, the trusted UI registers one selected file, the trusted UI
 * reads its own inventory, and an owner-scoped driver reads the same inventory.
 *
 * The transport owns validation, identity and channel separation only. The business
 * authority stays with the registry, and a read never registers or encodes anything.
 */
export class LocalAssetHttp {
  constructor(
    private readonly auth: ScopedAgentAuth,
    private readonly origin: () => string,
    private readonly inventory: AssetInventory,
  ) {}

  async handle(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    const url = new URL(request.url ?? '/', this.origin());
    if (!url.pathname.startsWith('/api/ui/v1/')) return false;
    const match = url.pathname.match(
      new RegExp(`^/api/ui/v1/projects/${PROJECT}/(local-source-files|local-assets|asset-inventory)$`),
    );
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
    try {
      if (url.origin !== this.origin() || request.headers.host !== new URL(this.origin()).host)
        throw new AgentRouteError('ORIGIN_REJECTED');
      let hosts = 0;
      for (let i = 0; i < request.rawHeaders.length; i += 2)
        if (request.rawHeaders[i]!.toLowerCase() === 'host') hosts++;
      if (hosts !== 1) throw new AgentRouteError('ORIGIN_REJECTED');
      const headers = {
        method: request.method ?? '',
        origin: request.headers.origin,
        authorization: request.headers.authorization,
        ...(request.headers.cookie ? { cookie: request.headers.cookie } : {}),
        ...(typeof request.headers['x-narralens-csrf'] === 'string' ? { csrf: request.headers['x-narralens-csrf'] } : {}),
        ...(request.headers.referer ? { referer: request.headers.referer } : {}),
        ...(typeof request.headers['sec-fetch-site'] === 'string' ? { secFetchSite: request.headers['sec-fetch-site'] } : {}),
        rawHeaders: request.rawHeaders,
      };
      const projectId = match[1]!;
      const route = match[2]!;
      const isPost = request.method === 'POST';
      // The channel is decided by the route, never by the request body. The
      // asset-inventory read is the owner-scoped one: a driver may read it, the
      // source listing and the registration stay trusted-UI only.
      const channel = route === 'asset-inventory' ? 'authenticated' : 'trusted_ui';
      if (route === 'local-source-files' && isPost) throw new AgentRouteError('NOT_FOUND');
      if (route === 'local-assets' && !isPost && request.method !== 'GET') throw new AgentRouteError('NOT_FOUND');
      if (route === 'asset-inventory' && isPost) throw new AgentRouteError('NOT_FOUND');
      if (isPost && request.method !== 'POST') throw new AgentRouteError('NOT_FOUND');
      const principal = this.auth.authenticate(headers, channel);
      // A trusted UI session proves itself with the UI proof; a driver proves itself
      // with its bearer credential. Neither one borrows the other's authority.
      if (channel === 'trusted_ui' && !headers.csrf) throw new AgentRouteError('ORIGIN_REJECTED');
      let body: unknown = undefined;
      if (isPost) {
        if (url.search || request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json'
          || (request.headers['content-encoding'] && request.headers['content-encoding'] !== 'identity'))
          throw new AgentRouteError('INVALID_REQUEST');
        const chunks: Buffer[] = [];
        let size = 0;
        const timer = setTimeout(() => request.destroy(), 5000);
        timer.unref();
        try {
          for await (const chunk of request) {
            const data = Buffer.from(chunk);
            size += data.length;
            if (size > MAX_BODY_BYTES) throw new AgentRouteError('PAYLOAD_TOO_LARGE');
            chunks.push(data);
          }
        } finally {
          clearTimeout(timer);
        }
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          throw new AgentRouteError('INVALID_REQUEST');
        }
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AgentRouteError('INVALID_REQUEST');
      } else {
        if (request.headers['transfer-encoding'] || Number(request.headers['content-length'] ?? 0) !== 0)
          throw new AgentRouteError('INVALID_REQUEST');
        for (const key of url.searchParams.keys())
          if (key !== 'limit' && key !== 'cursor') throw new AgentRouteError('INVALID_REQUEST');
        if (url.searchParams.getAll('limit').length > 1 || url.searchParams.getAll('cursor').length > 1)
          throw new AgentRouteError('INVALID_REQUEST');
      }
      const limit = url.searchParams.get('limit');
      if (limit !== null && !/^[0-9]{1,3}$/.test(limit)) throw new AgentRouteError('INVALID_REQUEST');
      const cursor = url.searchParams.get('cursor');
      const caller = createTrustedCallerContext({
        principal_id: principal.principal_id,
        channel: principal.channel,
        source: principal.channel === 'trusted_ui' ? 'trusted_ui' : 'driver_relay',
        session_ref: principal.session_ref,
      });
      let result: unknown;
      if (route === 'local-source-files') {
        result = await this.inventory.listSourceFiles(projectId, caller, {
          ...(limit === null ? {} : { limit: Number(limit) }),
          ...(cursor === null ? {} : { cursor }),
        });
      } else if (route === 'local-assets' && isPost) {
        result = await this.inventory.importAsset(projectId, body, caller);
      } else if (route === 'local-assets') {
        result = await this.inventory.readInventory(projectId, caller, {
          ...(limit === null ? {} : { limit: Number(limit) }),
          ...(cursor === null ? {} : { cursor }),
        });
      } else {
        result = await this.inventory.readInventory(projectId, caller, {
          ...(limit === null ? {} : { limit: Number(limit) }),
          ...(cursor === null ? {} : { cursor }),
        });
      }
      // A valid header is not a reservation of authority across an awaited read.
      const current = this.auth.authenticate(headers, channel);
      if (current.principal_id !== principal.principal_id || current.session_ref !== principal.session_ref
        || current.channel !== principal.channel) throw new AgentRouteError('UNAUTHORIZED');
      send(200, result);
    } catch (error) {
      const code = agentErrorCode(error);
      const status = statuses.get(code) ?? 500;
      send(status, validateAgentDefinition('Error', {
        schema_version: 'agent.v1',
        correlation_id: randomUUID(),
        code,
        http_status: status,
        message: '无法读取或登记本地素材，请确认会话、权限与素材状态。',
        retryable: code === 'HOST_RESOURCE_EXHAUSTED',
        next_actions: ['open_trusted_workbench'],
      }));
    }
    return true;
  }
}

/** The principal a route may act for. The body never names one. */
export type LocalAssetPrincipal = AgentPrincipal;
