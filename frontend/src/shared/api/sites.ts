import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { assertApiSuccess, unwrapApiResult } from './errors';
import type { RequestContext } from './request-context';

type Identified<T> = Omit<T, 'id'> & { id: string };
export type SiteSource = Omit<Identified<components['schemas']['SiteSource']>, 'page_size' | 'show_tag_filter'> & { page_size?: number; show_tag_filter?: boolean };
type BlockLayout = 'heading_level' | 'body_format' | 'width' | 'alignment' | 'image_width' | 'image_frame' | 'spacing';
export type SiteBlock = Omit<Identified<components['schemas']['SiteBlock']>, 'actions' | 'links' | 'children' | BlockLayout> & Partial<Pick<components['schemas']['SiteBlock'], BlockLayout>> & { actions?: NavigationLink[] | null; links?: NavigationLink[]; children?: SiteBlock[] };
export type SitePage = Omit<Identified<components['schemas']['SitePage']>, 'blocks'> & { blocks?: SiteBlock[] };

export async function editableSitePages(siteId: string, context: RequestContext, signal?: AbortSignal): Promise<SitePage[]> {
  return unwrapApiResult(await apiClient.GET('/api/vault/sites/{site_id}/editable-pages', { params: { path: { site_id: siteId } }, ...scope(context, signal) })).map(page => ({ ...identity(page), blocks: (page.blocks ?? []).map(identifiedBlock) }));
}
export type FormField = Identified<components['schemas']['FormField']>;
export type SiteForm = Omit<Identified<components['schemas']['SiteForm']>, 'fields'> & { fields?: FormField[] };
export type SiteFooterColumn = Omit<Identified<components['schemas']['SiteFooterColumn']>, 'blocks'> & { blocks?: SiteBlock[] };
export type SiteRegion = SiteFooterColumn & { position: 'header' | 'before_content' | 'after_content' | 'footer' };
export type SiteConfig = Omit<Identified<components['schemas']['SiteConfig']>, 'newsletter_names_required' | 'sources' | 'pages' | 'forms' | 'targets' | 'header_actions' | 'navigation' | 'footer' | 'social_links' | 'footer_columns' | 'footer_blocks' | 'footer_bottom_links' | 'footer_copyright' | 'regions'> & { newsletter_names_required?: boolean; regions?: SiteRegion[]; sources?: SiteSource[]; pages?: SitePage[]; forms?: SiteForm[]; targets?: SiteTarget[]; header_actions?: NavigationLink[]; navigation?: NavigationLink[]; footer?: NavigationLink[]; social_links?: NavigationLink[]; footer_columns?: SiteFooterColumn[] | null; footer_blocks?: SiteBlock[] | null; footer_bottom_links?: NavigationLink[] | null; footer_copyright?: string | null };
export type SiteTheme = components['schemas']['SiteTheme'];
export type SiteThemeAsset = components['schemas']['SiteThemeAsset'];
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
export type NavigationLink = Omit<components['schemas']['NavigationLink'], 'appearance'> & { appearance?: 'link' | 'button' | 'outline' };
export type SourceFilter = components['schemas']['SourceFilter'];
export type TargetConnection = components['schemas']['TargetConnection'];
export type WebsiteImportPreview = components['schemas']['WebsiteImportPreview'];
export type ServiceRequest = components['schemas']['PrivateServiceRequest'];
export type ServiceResponse = components['schemas']['PrivateServiceResponse'];
export type NewsletterDraft = NewsletterReview['draft'];
export type NewsletterState = components['schemas']['SiteNewsletterState'];
export type NewsletterReview = components['schemas']['SiteNewsletterReview'];
export type NewsletterQueue = components['schemas']['SiteNewsletterQueue'];

export async function removeSite(siteId: string, revision: number, context: RequestContext, signal?: AbortSignal) {
  assertApiSuccess(await apiClient.DELETE('/api/vault/sites/{site_id}', { params: { path: { site_id: siteId }, query: { revision } }, ...scope(context, signal) }));
}

export async function getNewsletter(siteId: string, targetId: string, context: RequestContext, signal?: AbortSignal) {
  return unwrapApiResult(await apiClient.GET('/api/vault/sites/{site_id}/newsletter', { params: { path: { site_id: siteId }, query: { target_id: targetId } }, ...scope(context, signal) }));
}
export async function saveNewsletter(siteId: string, targetId: string, draft: NewsletterDraft, context: RequestContext, signal?: AbortSignal) {
  return unwrapApiResult(await apiClient.PUT('/api/vault/sites/{site_id}/newsletter', { params: { path: { site_id: siteId }, query: { target_id: targetId } }, body: draft, ...scope(context, signal) }));
}
export async function reviewNewsletter(siteId: string, targetId: string, review: NewsletterReview, context: RequestContext, signal?: AbortSignal) {
  return unwrapApiResult(await apiClient.POST('/api/vault/sites/{site_id}/newsletter/preview', { params: { path: { site_id: siteId }, query: { target_id: targetId } }, body: review, ...scope(context, signal) }));
}
export async function queueNewsletter(siteId: string, targetId: string, request: NewsletterQueue, context: RequestContext, signal?: AbortSignal) {
  return unwrapApiResult(await apiClient.POST('/api/vault/sites/{site_id}/newsletter/queue', { params: { path: { site_id: siteId }, query: { target_id: targetId } }, body: request, ...scope(context, signal) }));
}

function identity<T extends { id?: string }>(value: T): T & { id: string } {
  if (!value.id) throw new Error('Website response has no stable identity');
  return { ...value, id: value.id };
}
function configuration(value: components['schemas']['SiteConfig']): SiteConfig {
  return { ...identity(value), regions: (value.regions ?? []).map(region => ({ ...identity(region), blocks: (region.blocks ?? []).map(identifiedBlock) })), footer_columns: value.footer_columns == null ? value.footer_columns : value.footer_columns.map(column => ({ ...identity(column), blocks: (column.blocks ?? []).map(identifiedBlock) })), footer_blocks: value.footer_blocks == null ? value.footer_blocks : value.footer_blocks.map(identifiedBlock), sources: (value.sources ?? []).map(identity), targets: (value.targets ?? []).map(identity), pages: (value.pages ?? []).map(page => ({ ...identity(page), blocks: (page.blocks ?? []).map(identifiedBlock) })), forms: (value.forms ?? []).map(form => ({ ...identity(form), fields: (form.fields ?? []).map(identity) })) };
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
export async function previewWebsiteImport(url: string, maxPages: number, context: RequestContext, signal?: AbortSignal) {
  return unwrapApiResult(await apiClient.POST('/api/vault/sites/import/preview', { body: { url, max_pages: maxPages }, ...scope(context, signal) }));
}
export async function createWebsiteImport(previewId: string, name: string, pageIds: string[], context: RequestContext, signal?: AbortSignal) {
  return configuration(unwrapApiResult(await apiClient.POST('/api/vault/sites/import/create', { body: { preview_id: previewId, name, selected_page_ids: pageIds }, ...scope(context, signal) })));
}
export async function siteCatalogue(context: RequestContext, signal?: AbortSignal, onStatus?: (pagesReady: boolean) => void) {
  const result = unwrapApiResult(await apiClient.GET('/api/vault/sites/catalogue/snapshot', scope(context, signal)));
  onStatus?.(result.pages_ready);
  return result.items;
}
export async function getSite(siteId: string, context: RequestContext, signal?: AbortSignal) {
  const result = unwrapApiResult(await apiClient.GET('/api/vault/sites/{site_id}', { params: { path: { site_id: siteId } }, ...scope(context, signal) }));
  return { ...result, site: configuration(result.site) };
}
function requestLinks(links: NavigationLink[] | undefined): components['schemas']['NavigationLink'][] | undefined {
  return links?.map(link => ({ ...link, appearance: link.appearance ?? 'link' }));
}

function identifiedBlock(block: components['schemas']['SiteBlock']): SiteBlock { return { ...identity(block), children: (block.children ?? []).map(identifiedBlock) }; }

function requestBlock(block: SiteBlock): components['schemas']['SiteBlock'] {
  return { ...block, heading_level: block.heading_level ?? 2, children: block.children?.map(requestBlock), body_format: block.body_format ?? 'markdown', width: block.width ?? 100, alignment: block.alignment ?? 'left', image_width: block.image_width ?? 100, image_frame: block.image_frame ?? 'none', spacing: block.spacing ?? 'compact', actions: block.actions === null ? null : requestLinks(block.actions), links: requestLinks(block.links) };
}

function requestConfiguration(site: SiteConfig): components['schemas']['SiteConfig'] {
  return {
    ...site,
    newsletter_names_required: site.newsletter_names_required ?? true,
    header_actions: requestLinks(site.header_actions), navigation: requestLinks(site.navigation),
    footer: requestLinks(site.footer), social_links: requestLinks(site.social_links),
    regions: site.regions?.map(region => ({ ...region, blocks: region.blocks?.map(requestBlock) })),
    footer_columns: site.footer_columns == null ? site.footer_columns : site.footer_columns.map(column => ({ ...column, blocks: column.blocks?.map(requestBlock) })),
    footer_blocks: site.footer_blocks == null ? site.footer_blocks : site.footer_blocks.map(requestBlock),
    footer_bottom_links: site.footer_bottom_links == null ? site.footer_bottom_links : requestLinks(site.footer_bottom_links),
    sources: site.sources?.map(source => ({ ...source, page_size: source.page_size ?? 16, show_tag_filter: source.show_tag_filter ?? false })),
    pages: site.pages?.map(page => ({ ...page, blocks: page.blocks?.map(requestBlock) })),
  };
}

export async function saveSite(site: SiteConfig, context: RequestContext, signal?: AbortSignal) {
  return configuration(unwrapApiResult(await apiClient.PUT('/api/vault/sites/{site_id}', { params: { path: { site_id: site.id } }, body: requestConfiguration(site), ...scope(context, signal) })));
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
export async function saveTargetPassword(siteId: string, targetId: string, password: string | null, context: RequestContext, signal?: AbortSignal) {
  return unwrapApiResult(await apiClient.PUT('/api/vault/sites/{site_id}/targets/{target_id}/credentials', { params: { path: { site_id: siteId, target_id: targetId } }, body: { password, clear: password === null }, ...scope(context, signal) }));
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

export async function uploadSiteThemeAsset(siteId: string, file: File, kind: 'image' | 'font' | 'file', context: RequestContext, signal?: AbortSignal) {
  const body = new FormData(); body.append('file', file);
  return unwrapApiResult(await apiClient.POST('/api/vault/sites/{site_id}/theme/assets', {
    params: { path: { site_id: siteId }, query: { kind } }, body: { file: '' }, bodySerializer: () => body, ...scope(context, signal),
  }));
}
export async function previewSiteImage(siteId: string, source: string, context: RequestContext, signal?: AbortSignal): Promise<Blob> {
  return unwrapApiResult<Blob, unknown>(await apiClient.GET('/api/vault/sites/{site_id}/theme/image', {
    params: { path: { site_id: siteId }, query: { source } }, parseAs: 'blob', ...scope(context, signal),
  }));
}

export async function previewSiteAsset(siteId: string, source: string, context: RequestContext, signal?: AbortSignal): Promise<Blob> {
  return unwrapApiResult<Blob, unknown>(await apiClient.GET('/api/vault/sites/{site_id}/theme/file', {
    params: { path: { site_id: siteId }, query: { source } }, parseAs: 'blob', ...scope(context, signal),
  }));
}

export async function siteFontCatalogue(context: RequestContext, signal?: AbortSignal) {
  return unwrapApiResult(await apiClient.GET('/api/vault/sites/fonts/catalogue', { ...scope(context, signal) }));
}
export async function previewCatalogueFont(catalogueId: string, context: RequestContext, signal?: AbortSignal): Promise<Blob> {
  return unwrapApiResult<Blob, unknown>(await apiClient.GET('/api/vault/sites/fonts/catalogue/preview', {
    params: { query: { catalogue_id: catalogueId } }, parseAs: 'blob', ...scope(context, signal),
  }));
}
export async function importSiteFonts(siteId: string, body: { url?: string; catalogue_id?: string }, context: RequestContext, signal?: AbortSignal) {
  return unwrapApiResult(await apiClient.POST('/api/vault/sites/{site_id}/theme/fonts/import', { params: { path: { site_id: siteId } }, body: { url: body.url ?? '', catalogue_id: body.catalogue_id ?? '' }, ...scope(context, signal) }));
}
