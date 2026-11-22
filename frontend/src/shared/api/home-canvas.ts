import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';
import { currentRequestContext, requestContextHeaders, type RequestContext } from './request-context';

type CanvasWire = components['schemas']['HomeCanvasState'];
export type StoredHomeBlock = Required<components['schemas']['HomeCanvasBlock']>;
export interface HomePreferences {
    readonly revision: string | null;
    readonly start_mode: CanvasWire['start_mode'];
    readonly blocks: readonly StoredHomeBlock[] | null;
}

export const homePreferencesKey = (scope: RequestContext) =>
    ['home-canvas', scope.workspaceId, scope.vaultId, scope.userId, scope.userEmail] as const;

function preferences(data: CanvasWire): HomePreferences {
    return {
        revision: data.revision ?? null,
        start_mode: data.start_mode,
        blocks: data.blocks?.map(block => ({ ...block, settings: block.settings ?? {} })) ?? null,
    };
}

export async function fetchHomePreferences(scope: RequestContext, signal?: AbortSignal): Promise<HomePreferences> {
    return preferences(unwrapApiResult(await apiClient.GET('/api/vault/home-canvas', {
        headers: requestContextHeaders(scope), signal,
    })));
}

export async function saveHomePreferences(scope: RequestContext, value: HomePreferences): Promise<HomePreferences> {
    const current = currentRequestContext();
    if (current.vaultId !== scope.vaultId || current.workspaceId !== scope.workspaceId
        || current.userId !== scope.userId || current.userEmail !== scope.userEmail) {
        throw new DOMException('Home canvas scope changed', 'AbortError');
    }
    return preferences(unwrapApiResult(await apiClient.PUT('/api/vault/home-canvas', {
        body: { ...value, blocks: value.blocks ? [...value.blocks] : null },
        headers: requestContextHeaders(scope),
    })));
}
