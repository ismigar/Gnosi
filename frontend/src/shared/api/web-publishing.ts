import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';
import type { RequestContext } from './request-context';

export type WebStatus = components['schemas']['WebStatus'];
export type WebPreview = components['schemas']['WebPreview'];
export type NewsletterStatus = components['schemas']['NewsletterStatus'];
export type NewsletterPreview = components['schemas']['NewsletterPreview'];

function headers(context: RequestContext) {
    return { 'X-Vault-ID': context.vaultId, 'X-Workspace-ID': context.workspaceId,
        'X-User-ID': context.userId, 'X-User-Email': context.userEmail,
        'X-Gnosi-Expected-User-ID': context.userId };
}
export async function webStatus(context: RequestContext, signal?: AbortSignal): Promise<WebStatus> {
    return unwrapApiResult(await apiClient.GET('/api/vault/web-publishing/status', { headers: headers(context), signal }));
}
export async function webPreview(pageIds: string[], withdrawIds: string[], context: RequestContext, signal?: AbortSignal): Promise<WebPreview> {
    return unwrapApiResult(await apiClient.POST('/api/vault/web-publishing/preview', { body: { page_ids: pageIds, withdraw_ids: withdrawIds }, headers: headers(context), signal }));
}
export async function webPublish(previewId: string, context: RequestContext, signal?: AbortSignal) {
    return unwrapApiResult(await apiClient.POST('/api/vault/web-publishing/publish', { body: { preview_id: previewId }, headers: headers(context), signal }));
}
export async function webRollback(releaseId: string, context: RequestContext, signal?: AbortSignal) {
    return unwrapApiResult(await apiClient.POST('/api/vault/web-publishing/rollback', { body: { release_id: releaseId }, headers: headers(context), signal }));
}
export async function newsletterStatus(context: RequestContext, signal?: AbortSignal): Promise<NewsletterStatus> {
    return unwrapApiResult(await apiClient.GET('/api/vault/web-publishing/newsletter', { headers: headers(context), signal }));
}
export async function newsletterPreview(draft: components['schemas']['NewsletterDraft'], context: RequestContext, signal?: AbortSignal): Promise<NewsletterPreview> {
    return unwrapApiResult(await apiClient.POST('/api/vault/web-publishing/newsletter/preview', { body: draft, headers: headers(context), signal }));
}
export async function newsletterSend(previewId: string, context: RequestContext, signal?: AbortSignal) {
    return unwrapApiResult(await apiClient.POST('/api/vault/web-publishing/newsletter/send', { body: { preview_id: previewId }, headers: headers(context), signal }));
}
