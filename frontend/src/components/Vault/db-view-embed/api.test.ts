import { describe, expect, it, vi } from 'vitest';
import * as shared from '../../../shared/api/vault-views';
import { createPageInTable, patchPageMetadata, patchSectionConfig, apiErrorDetail, apiErrorStatus } from './api';
import { decodeNavApi } from './decode';
vi.mock('../../../shared/api/vault-views', async (importOriginal) => ({ ...await importOriginal<typeof shared>(), createEmbeddedVaultPage: vi.fn(), patchEmbeddedVaultPageMetadata: vi.fn(), upsertPageView: vi.fn() }));

describe('embedded persistence boundary', () => {
    it('creates with exactly the original body and permits explicit metadata overrides', async () => {
        await createPageInTable({ tableId: 'base', extraMetadata: { table_id: 'override', custom: { enabled: true } } });
        expect(shared.createEmbeddedVaultPage).toHaveBeenCalledWith({ title: 'Nou registre', content: '', metadata: { table_id: 'override', custom: { enabled: true } } });
    });
    it('patches metadata once and preserves all section/plugin keys during upsert', async () => {
        const meta = { tags: ['a'] };
        expect(await patchPageMetadata('page', meta)).toBe(meta);
        expect(shared.patchEmbeddedVaultPageMetadata).toHaveBeenCalledWith('page', meta);
        const source = { view_id: 'v', heading: 'H', plugin: { x: 1 }, joins: [{ tableId: 'joined' }], row_height: 'tall' };
        const next = await patchSectionConfig('page', source, { columnWidths: { title: 220 } });
        expect(next).toEqual({ ...source, columnWidths: { title: 220 } });
        expect(shared.upsertPageView).toHaveBeenCalledWith('page', next);
        expect(source).not.toHaveProperty('columnWidths');
    });
    it('keeps error-message/status precedence for shared and legacy clients', () => {
        expect(apiErrorDetail({ payload: { detail: 'shared' }, response: { data: { detail: 'legacy' } }, message: 'message' }, 'fallback')).toBe('shared');
        expect(apiErrorDetail({ response: { data: { detail: 'legacy' } } }, 'fallback')).toBe('legacy');
        expect(apiErrorDetail(null, 'fallback')).toBe('fallback');
        expect(apiErrorStatus({ status: 404, response: { status: 500 } })).toBe(404);
        expect(apiErrorStatus({ response: { status: 403 } })).toBe(403);
    });
    it('preserves navigation method receivers and rejects non-callable entries', () => {
        const source = { focus: 'cell', focusFirstCell() { return this.focus; }, focusLastCell: false };
        const nav = decodeNavApi(source);
        expect(nav?.focusFirstCell?.()).toBe('cell'); expect(nav?.focusLastCell).toBeUndefined();
        expect(decodeNavApi(null)).toBeNull();
    });
});
