import { validateLocalAssetDefinition } from '../contracts/agent-local-assets-validator.js';
import type { LocalAssetInventory } from '../contracts/agent-local-assets-types.js';
import type { HostAdjunctRoute } from './host-application-ports.js';

/** The one adjunct MCP resource of the local-material transport. It is counted
 * separately from the frozen resources and it never mutates anything. */
export const LOCAL_ASSET_INVENTORY_URI = 'narralens://projects/{id}/local-assets';
export const LOCAL_ASSET_INVENTORY_ROUTE_ID = 'asset-inventory.read';

/** An adjunct resource the façade can serve next to the frozen ones. */
export interface AdjunctResourceView {
  readonly uri: string;
  readonly output: string;
  readonly description: string;
  readonly mimeType: string;
  readonly read: (projectId: string, query: URLSearchParams) => Promise<unknown>;
}

const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/**
 * The Host route the resource projects from.
 *
 * It is an adjunct route: it is not in the frozen registry, it keeps its own path and
 * its own validator, and it uses the same client, the same credential and the same
 * endpoint policy as every frozen route.
 */
export const LOCAL_ASSET_INVENTORY_HOST_ROUTE: HostAdjunctRoute = {
  id: LOCAL_ASSET_INVENTORY_ROUTE_ID,
  method: 'GET',
  path: '/api/ui/v1/projects/:id/asset-inventory',
  bindings: { id: 'project_id' },
  output: 'Inventory',
  validateInput: (input: unknown) => {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) throw Error('invalid input');
    const value = input as Record<string, unknown>;
    if (typeof value['project_id'] !== 'string' || !PROJECT_ID.test(value['project_id'])) throw Error('invalid project_id');
    if (value['limit'] !== undefined && (!Number.isSafeInteger(value['limit']) || (value['limit'] as number) < 1 || (value['limit'] as number) > 64))
      throw Error('invalid limit');
    if (value['cursor'] !== undefined && value['cursor'] !== null && typeof value['cursor'] !== 'string')
      throw Error('invalid cursor');
  },
  validateOutput: (payload: unknown) => validateLocalAssetDefinition<LocalAssetInventory>('Inventory', payload),
};

/** The resource that reads one project's inventory through the Host. */
export function localAssetInventoryResource(options: {
  readonly read: (input: { project_id: string; limit?: number; cursor?: string | null }) => Promise<unknown>;
}): AdjunctResourceView {
  return {
    uri: LOCAL_ASSET_INVENTORY_URI,
    output: 'Inventory',
    description: 'Narralens Inventory for asset-inventory.read.',
    mimeType: 'application/json',
    read: async (projectId: string, query: URLSearchParams) => {
      if (!PROJECT_ID.test(projectId)) throw Error('invalid project_id');
      const limit = query.get('limit');
      const cursor = query.get('cursor');
      if (limit !== null && !/^[0-9]{1,3}$/.test(limit)) throw Error('invalid limit');
      return options.read({
        project_id: projectId,
        ...(limit === null ? {} : { limit: Number(limit) }),
        ...(cursor === null ? {} : { cursor }),
      });
    },
  };
}

/** Match a concrete resource URI against the adjunct templates. */
export function matchAdjunctResourceUri(
  uri: string,
  resources: readonly AdjunctResourceView[],
): { resource: AdjunctResourceView; projectId: string | null } | null {
  for (const resource of resources) {
    const pattern = new RegExp(
      `^${resource.uri.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{id\\\}/g, '([^/]+)')}$`,
    );
    const match = pattern.exec(uri);
    if (match) return { resource, projectId: match[1] ?? null };
  }
  return null;
}
