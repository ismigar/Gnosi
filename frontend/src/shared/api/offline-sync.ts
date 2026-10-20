import createClient from 'openapi-fetch';
import type { components, paths } from '../../generated/openapi';
import { MAX_NOTE_LENGTH, OfflineError, requireScope, sameScope, type OfflineScope, type RemoteNote } from '../offline/model';
import { currentRequestContext } from './request-context';
import { GnosiApiError, unwrapApiResult } from './errors';
import { transportFetch } from './transports';

export interface OfflineNoteChoice { readonly id: string; readonly title: string }
export interface OfflineRemote {
    verify(scope: OfflineScope, signal: AbortSignal): Promise<void>;
    list(scope: OfflineScope, signal: AbortSignal): Promise<OfflineNoteChoice[]>;
    read(scope: OfflineScope, id: string, signal: AbortSignal): Promise<RemoteNote>;
    write(scope: OfflineScope, id: string, content: string, etag: string, signal: AbortSignal): Promise<RemoteNote>;
}

export function currentOfflineScope(): OfflineScope {
    return { origin: location.origin, ...currentRequestContext() };
}

export function assertCurrentOfflineScope(scope: OfflineScope): void {
    requireScope(scope);
    if (!sameScope(scope, currentOfflineScope())) throw new OfflineError('scope');
}

/** Own client: no mutable page-only ETag cache, response cache or current-Vault middleware. */
function client(scope: OfflineScope) {
    assertCurrentOfflineScope(scope);
    return createClient<paths>({
        baseUrl: scope.origin, credentials: 'same-origin', cache: 'no-store', redirect: 'error', fetch: transportFetch,
        headers: {
            'X-User-ID': scope.userId, 'X-User-Email': scope.userEmail,
            'X-Workspace-ID': scope.workspaceId, 'X-Vault-ID': scope.vaultId,
            'X-Gnosi-Expected-User-ID': scope.userId,
        },
    });
}

function isMarkdown(metadata: Record<string, unknown>): boolean {
    return metadata.is_database !== true && metadata.is_dashboard !== true
        && metadata.is_drawing !== true && metadata.is_canvas !== true
        && (!metadata.content_format || metadata.content_format === 'markdown' || metadata.content_format === 'md');
}

function parseNote(page: components['schemas']['PageDetailResponse'] | components['schemas']['PageMutationResponse'],
    id: string): RemoteNote {
    if (page.id !== id || !isMarkdown(page.metadata)) throw new OfflineError('format');
    if (!page.etag) throw new OfflineError('etag');
    if (page.content.length > MAX_NOTE_LENGTH) throw new OfflineError('limit');
    return { id, title: typeof page.title === 'string' ? page.title : id, content: page.content, etag: page.etag };
}

async function guarded<T>(scope: OfflineScope, signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    assertCurrentOfflineScope(scope);
    signal.throwIfAborted();
    try {
        const result = await work();
        signal.throwIfAborted();
        assertCurrentOfflineScope(scope);
        return result;
    } catch (error) {
        if (error instanceof GnosiApiError) {
            if (error.status === 401) throw new OfflineError('session');
            if (error.status === 403 || (error.status === 409 && typeof error.payload === 'object'
                && error.payload !== null && 'detail' in error.payload && typeof error.payload.detail === 'object'
                && error.payload.detail !== null && 'code' in error.payload.detail
                && error.payload.detail.code === 'account_changed')) throw new OfflineError('scope');
            if (error.status === 404) throw new OfflineError('missing');
        }
        throw error;
    }
}

export const offlineRemote: OfflineRemote = {
    verify(scope, signal) {
        return guarded(scope, signal, async () => {
            const api = client(scope);
            const user = unwrapApiResult(await api.GET('/api/auth/me', { signal }));
            if (user.id !== scope.userId || user.email !== scope.userEmail
                || !(user.workspaces ?? []).some(workspace => workspace.id === scope.workspaceId)) {
                throw new OfflineError('scope');
            }
            const catalog = unwrapApiResult(await api.GET('/api/vaults', { signal }));
            if (!catalog.vaults.some(vault => vault.id === scope.vaultId)) throw new OfflineError('scope');
        });
    },
    list(scope, signal) {
        return guarded(scope, signal, async () => {
            const pages = unwrapApiResult(await client(scope).GET('/api/vault/sidebar/tree', { signal }));
            return pages.filter(page => !page.is_database && isMarkdown(page.metadata ?? {}))
                .map(page => ({ id: page.id, title: page.title }));
        });
    },
    read(scope, id, signal) {
        return guarded(scope, signal, async () => parseNote(unwrapApiResult(await client(scope).GET('/api/vault/pages/{page_id}', {
            params: { path: { page_id: id } }, signal,
        })), id));
    },
    write(scope, id, content, etag, signal) {
        if (!etag) return Promise.reject(new OfflineError('etag'));
        if (content.length > MAX_NOTE_LENGTH) return Promise.reject(new OfflineError('limit'));
        return guarded(scope, signal, async () => parseNote(unwrapApiResult(await client(scope).PATCH('/api/vault/pages/{page_id}', {
            params: { path: { page_id: id } }, body: { content, expected_etag: etag, force: false }, signal,
        })), id));
    },
};

export function isOfflineEtagConflict(error: unknown): boolean {
    return error instanceof GnosiApiError && error.status === 409
        && typeof error.payload === 'object' && error.payload !== null && 'detail' in error.payload
        && typeof error.payload.detail === 'object' && error.payload.detail !== null && 'error' in error.payload.detail
        && error.payload.detail.error === 'etag_mismatch';
}
