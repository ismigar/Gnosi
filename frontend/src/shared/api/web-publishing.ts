import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';
import type { RequestContext } from './request-context';

export type WebStatus = components['schemas']['WebStatus'];
export type WebPreview = components['schemas']['WebPreview'];
export type NewsletterStatus = components['schemas']['NewsletterStatus'];
export type NewsletterPreview = components['schemas']['NewsletterPreview'];

function scope(context: RequestContext) {
    return {
        headers: { 'X-Vault-ID': context.vaultId, 'X-Workspace-ID': context.workspaceId,
            'X-User-ID': context.userId, 'X-User-Email': context.userEmail },
        params: { header: { 'X-Gnosi-Web-Expected-User-ID': context.userId } },
    };
}
export async function webStatus(context: RequestContext, signal?: AbortSignal): Promise<WebStatus> {
    return unwrapApiResult(await apiClient.GET('/api/vault/web-publishing/status', { ...scope(context), signal }));
}
export async function webPreview(pageIds: string[], withdrawIds: string[], context: RequestContext, signal?: AbortSignal): Promise<WebPreview> {
    return unwrapApiResult(await apiClient.POST('/api/vault/web-publishing/preview', { body: { page_ids: pageIds, withdraw_ids: withdrawIds }, ...scope(context), signal }));
}
export async function webPublish(previewId: string, context: RequestContext, signal?: AbortSignal) {
    return unwrapApiResult(await apiClient.POST('/api/vault/web-publishing/publish', { body: { preview_id: previewId }, ...scope(context), signal }));
}
export async function webRollback(releaseId: string, context: RequestContext, signal?: AbortSignal) {
    return unwrapApiResult(await apiClient.POST('/api/vault/web-publishing/rollback', { body: { release_id: releaseId }, ...scope(context), signal }));
}
export async function newsletterStatus(context: RequestContext, signal?: AbortSignal): Promise<NewsletterStatus> {
    return unwrapApiResult(await apiClient.GET('/api/vault/web-publishing/newsletter', { ...scope(context), signal }));
}
export async function newsletterPreview(draft: components['schemas']['NewsletterDraft'], context: RequestContext, signal?: AbortSignal): Promise<NewsletterPreview> {
    return unwrapApiResult(await apiClient.POST('/api/vault/web-publishing/newsletter/preview', { body: draft, ...scope(context), signal }));
}
export async function newsletterSend(previewId: string, context: RequestContext, signal?: AbortSignal) {
    return unwrapApiResult(await apiClient.POST('/api/vault/web-publishing/newsletter/send', { body: { preview_id: previewId }, ...scope(context), signal }));
}
