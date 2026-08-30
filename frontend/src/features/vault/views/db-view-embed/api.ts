import * as vaults from '../../../../shared/api/vaults';
import * as views from '../../../../shared/api/vault-views';
import { decodeRow, decodeRows, decodeView, decodeViews, isRecord, text } from './decode';
import type { EmbedView, Metadata } from './types';
export const deleteVaultPage = vaults.deleteVaultPage;
export const applyVaultTemplate = views.applyVaultTemplate;
export const deleteVaultView = views.deleteVaultView;
export const fetchVaultViewUsage = views.fetchVaultViewUsage;
export const createEmbeddedVaultPage = views.createEmbeddedVaultPage;
export const patchEmbeddedVaultPageMetadata = views.patchEmbeddedVaultPageMetadata;
export const upsertPageView = views.upsertPageView;
export async function fetchVaultPage(id: string) { return decodeRow(await vaults.fetchVaultPage(id)); }
export async function fetchVaultPagesByTable(id: string) { return decodeRows(await vaults.fetchVaultPagesByTable(id)); }
export async function fetchVaultViews() { return decodeViews(await views.fetchVaultViews()); }
export async function fetchPageViews(id: string) { const result = await views.fetchPageViews(id); return { ...result, sections: result.sections.map(decodeView) }; }
export function createVaultView(input: EmbedView) { return views.createVaultView(input); }
export function updateVaultView(id: string, input: views.VaultViewInput) { return views.updateVaultView(id, input); }
export function apiErrorDetail(error: unknown, fallback: string): string {
    const e = isRecord(error) ? error : {};
    const payload = isRecord(e.payload) ? e.payload : {};
    const response = isRecord(e.response) ? e.response : {};
    const data = isRecord(response.data) ? response.data : {};
    return text(payload.detail) || text(data.detail) || text(e.message) || fallback;
}
export function apiErrorStatus(error: unknown): unknown {
    const e = isRecord(error) ? error : {};
    return e.status ?? (isRecord(e.response) ? e.response.status : undefined);
}
export async function createPageInTable({ tableId, title = 'Nou registre', content = '', extraMetadata = {} }: { tableId: string; title?: string; content?: string; extraMetadata?: Metadata; }) {
    const body = {
        title,
        content,
        metadata: { table_id: tableId, ...extraMetadata },
    };
    return createEmbeddedVaultPage(body);
}

export async function patchPageMetadata(pageId: string, partialMetadata: Metadata) {
    // Direct partial PATCH: the backend does `metadata.update(request.metadata)`
    // and keeps title/content/other fields intact. We used to do GET +
    // PATCH (2 round-trips serialized, 400-700 ms) to build a
    // full payload "for safety"; the current backend accepts partials
    // so we save the GET and its corresponding latency.
    await patchEmbeddedVaultPageMetadata(pageId, partialMetadata);
    return partialMetadata;
}

export async function patchSectionConfig(pageId: string, section: EmbedView | null, patch: EmbedView) {
    // The POST /api/pages/{page_id}/views does an upsert by heading. We send the
    // the full section (preserving all legacy fields) with the patch
    // applied. Requires ConfigDict(extra='allow') on the ViewSection model.
    const next = { ...section, ...patch };
    await upsertPageView(pageId, next);
    return next;
}
