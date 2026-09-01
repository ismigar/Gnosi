import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';

export type WorkspaceCatalogEntry = components['schemas']['WorkspaceResponse'];

export async function fetchWorkspaces(
    signal?: AbortSignal,
): Promise<WorkspaceCatalogEntry[]> {
    return unwrapApiResult<WorkspaceCatalogEntry[], unknown>(
        await apiClient.GET('/api/workspaces', { signal }),
    );
}
