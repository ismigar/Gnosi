import { act, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { vi } from 'vitest';
import * as vault from '../../../shared/api/vaults';
import * as views from '../../../shared/api/vault-views';
import { useDashboardActions, type DashboardActions } from './useDashboardActions';
import type { VaultPage, VaultPageSummary, VaultPageMutation } from '../../../shared/api/vaults';
import type { Registry } from './types';
const plugins = vi.hoisted(() => ({ isEnabled: () => false }));
vi.mock('../../../shared/plugins/usePlugins', () => ({ usePlugins: () => plugins }));
vi.mock('../../../shared/notifications/toast', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }) }));
vi.mock('../../../shared/notifications/notifyError', () => ({ notifyError: vi.fn(), logError: vi.fn() }));
export const PAGE_ID = '00000000-0000-4000-8000-000000000001';
export const OTHER_ID = '00000000-0000-4000-8000-000000000002';
export const CATALOG: Registry = { databases: [{ id: 'db', name: 'App' }], tables: [{ id: 'table', name: 'Table', database_id: 'db', properties: [{ id: 'fld_status', name: 'Status', type: 'select' }] }], views: [{ id: 'main', name: 'Table', type: 'table', table_id: 'table', is_main: true }] };
export const PAGE: VaultPageSummary = { id: PAGE_ID, title: 'Page', folder: '', is_database: false, last_modified: '2026-01-01', metadata: { table_id: 'table' }, size: 1 };
export const DETAIL: VaultPage = { id: PAGE_ID, title: 'Page', content: 'body', metadata: { table_id: 'table' }, etag: 'etag-1', folder: '' };
export const CREATED: VaultPageMutation = { ...DETAIL, status: 'created', message: 'created', id: OTHER_ID };
export function installApiDefaults() {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.mocked(vault.fetchVaultPages).mockResolvedValue([PAGE]);
    vi.mocked(vault.fetchVaultPage).mockResolvedValue(DETAIL);
    vi.mocked(vault.fetchVaultPagesByTable).mockResolvedValue([PAGE]);
    vi.mocked(vault.fetchVaultRegistry).mockResolvedValue({ ...CATALOG });
    vi.mocked(vault.fetchVaultGlobalIndex).mockResolvedValue({ [PAGE_ID]: 'Page' });
    vi.mocked(vault.fetchVaultAliasIndex).mockResolvedValue({});
    vi.mocked(vault.fetchVaultTablePagesSnapshot).mockResolvedValue({ table_id: 'table', pages: [PAGE], raw_count: 1, visible_count: 1 });
    vi.mocked(vault.createVaultPage).mockResolvedValue(CREATED);
    vi.mocked(vault.patchVaultPage).mockResolvedValue(CREATED);
    vi.mocked(vault.saveVaultPage).mockResolvedValue(CREATED);
    vi.mocked(views.createVaultView).mockResolvedValue({ id: 'created-view', table_id: 'table', name: 'View', type: 'table' });
    vi.mocked(views.updateVaultView).mockResolvedValue({ status: 'updated' });
}
export async function renderActions() {
    const i18n = createInstance();
    await i18n.init({ lng: 'en', resources: {}, initImmediate: false, showSupportNotice: false });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    let current: DashboardActions | undefined;
    const capture = (value: DashboardActions) => { current = value; };
    function ActionHarness() {
        const result = useDashboardActions();
        useLayoutEffect(() => { capture(result); });
        return null;
    }
    await act(async () => { root.render(<I18nextProvider i18n={i18n}><MemoryRouter><ActionHarness /></MemoryRouter></I18nextProvider>); await Promise.resolve(); });
    return {
        get current() {
            if (!current)
                throw new Error('Dashboard hook was not mounted');
            return current;
        },
        async run(callback: (value: DashboardActions) => unknown) {
            await act(async () => { await callback(this.current); await Promise.resolve(); });
        },
        async unmount() { await act(async () => { root.unmount(); await Promise.resolve(); }); container.remove(); },
    };
}
