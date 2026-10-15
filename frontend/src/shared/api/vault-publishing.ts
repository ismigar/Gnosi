import createFetchClient from 'openapi-fetch';
import type { components, paths } from '../../generated/openapi';
import { unwrapApiResult } from './errors';
import type { RequestContext } from './request-context';
import { transportFetch } from './transports';

export type PublicationBundle = components['schemas']['PublicationBundle'];
export type PublicationCandidate = components['schemas']['PublicationCandidate'];
export type PublicationSelection = components['schemas']['PublicationSelection'];
export type PublicationPreview = components['schemas']['PublicationPreviewResponse'];
export type PublicationSummary = components['schemas']['PublicationSummary'];

// The public client has no account/vault middleware and never sends credentials.
// Its import graph does not initialize the authenticated application client.
const publicClient = createFetchClient<paths>({
    baseUrl: typeof location === 'undefined' ? 'http://localhost' : location.origin,
    credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
    fetch: transportFetch,
});

export async function fetchPublication(token: string, signal?: AbortSignal): Promise<PublicationBundle> {
    if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) throw new Error('Invalid publication token');
    return unwrapApiResult<PublicationBundle, unknown>(await publicClient.GET('/api/published/{token}', { params: { path: { token } }, signal }));
}

function headers(context: RequestContext) {
    return { 'X-Vault-ID': context.vaultId, 'X-Workspace-ID': context.workspaceId,
        'X-User-ID': context.userId, 'X-User-Email': context.userEmail,
        'X-Gnosi-Expected-User-ID': context.userId };
}

export async function fetchPublicationPages(context: RequestContext, signal?: AbortSignal): Promise<PublicationCandidate[]> {
    const { apiClient } = await import('./client');
    return unwrapApiResult<PublicationCandidate[], unknown>(await apiClient.GET('/api/vault/publishing/pages', { headers: headers(context), signal }));
}

export async function fetchPublications(context: RequestContext, signal?: AbortSignal): Promise<PublicationSummary[]> {
    const { apiClient } = await import('./client');
    return unwrapApiResult<PublicationSummary[], unknown>(await apiClient.GET('/api/vault/publishing', { headers: headers(context), signal }));
}

export async function previewPublication(request: PublicationSelection, context: RequestContext, signal?: AbortSignal): Promise<PublicationPreview> {
    const { apiClient } = await import('./client');
    return unwrapApiResult<PublicationPreview, unknown>(await apiClient.POST('/api/vault/publishing/preview', { body: request, headers: headers(context), signal }));
}

export async function commitPublication(previewId: string, context: RequestContext): Promise<PublicationSummary> {
    const { apiClient } = await import('./client');
    return unwrapApiResult<PublicationSummary, unknown>(await apiClient.POST('/api/vault/publishing/commit', { body: { preview_id: previewId }, headers: headers(context) }));
}

export async function revokePublication(site: PublicationSummary, context: RequestContext): Promise<PublicationSummary> {
    const { apiClient } = await import('./client');
    return unwrapApiResult<PublicationSummary, unknown>(await apiClient.POST('/api/vault/publishing/{site_id}/revoke', {
        params: { path: { site_id: site.id } }, body: { expected_revision: site.revision }, headers: headers(context),
    }));
}
