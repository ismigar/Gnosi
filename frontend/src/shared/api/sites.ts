import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';
import type { RequestContext } from './request-context';

type Identified<T> = Omit<T, 'id'> & { id: string };
export type SiteSource = Identified<components['schemas']['SiteSource']>;
export type SiteBlock = Identified<components['schemas']['SiteBlock']>;
export type SitePage = Omit<Identified<components['schemas']['SitePage']>, 'blocks'> & { blocks?: SiteBlock[] };
export type FormField = Identified<components['schemas']['FormField']>;
export type SiteForm = Omit<Identified<components['schemas']['SiteForm']>, 'fields'> & { fields?: FormField[] };
export type SiteConfig = Omit<Identified<components['schemas']['SiteConfig']>, 'sources' | 'pages' | 'forms' | 'targets'> & { sources?: SiteSource[]; pages?: SitePage[]; forms?: SiteForm[]; targets?: SiteTarget[] };
export type SiteTheme = components['schemas']['SiteTheme'];
export type SiteFont = components['schemas']['SiteFont'];
export type SiteTarget = Identified<components['schemas']['SiteTarget']>;
export type SiteStatus = Omit<components['schemas']['SiteStatus'], 'site'> & { site: SiteConfig };
export type SitePreview = components['schemas']['SitePreview'];
export type SiteJob = components['schemas']['SiteJob'];
export type SiteRelease = components['schemas']['SiteRelease'];
export type CatalogueItem = components['schemas']['CatalogueItem'];
export type ServiceSettings = components['schemas']['ServiceSettings'];
export type ServiceSettingsResponse = components['schemas']['ServiceSettingsResponse'];
export type FormDeliverySettings = components['schemas']['FormDeliverySettings'];
export type NavigationLink = components['schemas']['NavigationLink'];
export type SourceFilter = components['schemas']['SourceFilter'];
export type TargetConnection = components['schemas']['TargetConnection'];
export type ServiceRequest = components['schemas']['PrivateServiceRequest'];
export type ServiceResponse = components['schemas']['PrivateServiceResponse'];

function identity<T extends { id?: string }>(value: T): T & { id: string } {
  if (!value.id) throw new Error('Website response has no stable identity');
  return { ...value, id: value.id };
}
function configuration(value: components['schemas']['SiteConfig']): SiteConfig {
  return { ...identity(value), sources: (value.sources ?? []).map(identity), targets: (value.targets ?? []).map(identity), pages: (value.pages ?? []).map(page => ({ ...identity(page), blocks: (page.blocks ?? []).map(identity) })), forms: (value.forms ?? []).map(form => ({ ...identity(form), fields: (form.fields ?? []).map(identity) })) };
}

function scope(context: RequestContext, signal?: AbortSignal) {
  return { signal, headers: { 'X-Vault-ID': context.vaultId, 'X-Workspace-ID': context.workspaceId, 'X-User-ID': context.userId, 'X-User-Email': context.userEmail } };
}
export async function listSites(context: RequestContext, signal?: AbortSignal) {
  return unwrapApiResult(await apiClient.GET('/api/vault/sites', scope(context, signal))).map(configuration);
}
export async function createSite(name: string, importPilot: boolean, context: RequestContext, signal?: AbortSignal) {
  return configuration(unwrapApiResult(await apiClient.POST('/api/vault/sites', { body: { name, import_pilot: importPilot }, ...scope(context, signal) })));
}
export async function siteCatalogue(context: RequestContext, signal?: AbortSignal) {
  return unwrapApiResult(await apiClient.GET('/api/vault/sites/catalogue', scope(context, signal)));
}
export async function getSite(siteId: string, context: RequestContext, signal?: AbortSignal) {
  const result = unwrapApiResult(await apiClient.GET('/api/vault/sites/{site_id}', { params: { path: { site_id: siteId } }, ...scope(context, signal) }));
  return { ...result, site: configuration(result.site) };
}
export async function saveSite(site: SiteConfig, context: RequestContext, signal?: AbortSignal) {
  return configuration(unwrapApiResult(await apiClient.PUT('/api/vault/sites/{site_id}', { params: { path: { site_id: site.id } }, body: site, ...scope(context, signal) })));
}
export async function previewSite(siteId: string, targetId: string, context: RequestContext, signal?: AbortSignal) {
  return unwrapApiResult(await apiClient.POST('/api/vault/sites/{site_id}/preview', { params: { path: { site_id: siteId } }, body: { target_id: targetId }, ...scope(context, signal) }));
}
export async function publishSite(siteId: string, previewId: string, scheduledAt: string | null, context: RequestContext, signal?: AbortSignal) {
  return unwrapApiResult(await apiClient.POST('/api/vault/sites/{site_id}/publish', { params: { path: { site_id: siteId } }, body: { preview_id: previewId, scheduled_at: scheduledAt }, ...scope(context, signal) }));
}
export async function siteJobs(siteId: string, context: RequestContext, signal?: AbortSignal) {
  return unwrapApiResult(await apiClient.GET('/api/vault/sites/{site_id}/jobs', { params: { path: { site_id: siteId } }, ...scope(context, signal) }));
}
export async function cancelJob(siteId: string, jobId: string, context: RequestContext, signal?: AbortSignal) {
  return unwrapApiResult(await apiClient.POST('/api/vault/sites/{site_id}/jobs/{job_id}/cancel', { params: { path: { site_id: siteId, job_id: jobId } }, ...scope(context, signal) }));
}
export async function rollbackSite(siteId: string, releaseId: string, context: RequestContext, signal?: AbortSignal) {
  return unwrapApiResult(await apiClient.POST('/api/vault/sites/{site_id}/rollback/{release_id}', { params: { path: { site_id: siteId, release_id: releaseId } }, ...scope(context, signal) }));
}
export async function exportTheme(siteId: string, context: RequestContext, signal?: AbortSignal) {
  return unwrapApiResult(await apiClient.GET('/api/vault/sites/{site_id}/theme/export', { params: { path: { site_id: siteId } }, ...scope(context, signal) }));
}
export async function importTheme(siteId: string, theme: SiteTheme, context: RequestContext, signal?: AbortSignal) {
  return configuration(unwrapApiResult(await apiClient.POST('/api/vault/sites/{site_id}/theme/import', { params: { path: { site_id: siteId } }, body: theme, ...scope(context, signal) })));
}
export async function themeHistory(siteId: string, context: RequestContext, signal?: AbortSignal) {
  return unwrapApiResult(await apiClient.GET('/api/vault/sites/{site_id}/theme/history', { params: { path: { site_id: siteId } }, ...scope(context, signal) }));
}
export async function getServiceSettings(siteId: string, context: RequestContext, signal?: AbortSignal, targetId = 'local') {
  return unwrapApiResult(await apiClient.GET('/api/vault/sites/{site_id}/service-settings', { params: { path: { site_id: siteId }, query: { target_id: targetId } }, ...scope(context, signal) }));
}
export async function saveServiceSettings(siteId: string, settings: ServiceSettings, context: RequestContext, signal?: AbortSignal, targetId = 'local') {
  return unwrapApiResult(await apiClient.PUT('/api/vault/sites/{site_id}/service-settings', { params: { path: { site_id: siteId }, query: { target_id: targetId } }, body: settings, ...scope(context, signal) }));
}
export async function serviceAction(siteId: string, action: string, request: ServiceRequest['request'], context: RequestContext, signal?: AbortSignal, targetId = 'local') {
  return unwrapApiResult(await apiClient.POST('/api/vault/sites/{site_id}/service', { params: { path: { site_id: siteId } }, body: { action, request, target_id: targetId }, ...scope(context, signal) }));
}
export async function getTargetConnection(siteId: string, targetId: string, context: RequestContext, signal?: AbortSignal) {
  return unwrapApiResult(await apiClient.GET('/api/vault/sites/{site_id}/targets/{target_id}/connection', { params: { path: { site_id: siteId, target_id: targetId } }, ...scope(context, signal) }));
}
export async function saveTargetConnection(siteId: string, targetId: string, connection: TargetConnection, context: RequestContext, signal?: AbortSignal) {
  return unwrapApiResult(await apiClient.PUT('/api/vault/sites/{site_id}/targets/{target_id}/connection', { params: { path: { site_id: siteId, target_id: targetId } }, body: connection, ...scope(context, signal) }));
}
export async function probeTarget(siteId: string, targetId: string, context: RequestContext, signal?: AbortSignal) {
  return unwrapApiResult(await apiClient.POST('/api/vault/sites/{site_id}/targets/{target_id}/probe', { params: { path: { site_id: siteId, target_id: targetId } }, ...scope(context, signal) }));
}
export async function serveTarget(siteId: string, targetId: string, context: RequestContext, signal?: AbortSignal) {
  return unwrapApiResult(await apiClient.POST('/api/vault/sites/{site_id}/targets/{target_id}/serve', { params: { path: { site_id: siteId, target_id: targetId } }, ...scope(context, signal) }));
}
export async function localTargetStatus(siteId: string, targetId: string, context: RequestContext, signal?: AbortSignal) {
  return unwrapApiResult(await apiClient.GET('/api/vault/sites/{site_id}/targets/{target_id}/serve', { params: { path: { site_id: siteId, target_id: targetId } }, ...scope(context, signal) }));
}
export async function stopLocalTarget(siteId: string, targetId: string, context: RequestContext, signal?: AbortSignal) {
  return unwrapApiResult(await apiClient.POST('/api/vault/sites/{site_id}/targets/{target_id}/stop', { params: { path: { site_id: siteId, target_id: targetId } }, ...scope(context, signal) }));
}

export async function previewSiteFont(siteId: string, source: string, context: RequestContext, signal?: AbortSignal): Promise<Blob> {
  return unwrapApiResult<Blob, unknown>(await apiClient.GET('/api/vault/sites/{site_id}/theme/font', {
    params: { path: { site_id: siteId }, query: { source } }, parseAs: 'blob', ...scope(context, signal),
  }));
}
