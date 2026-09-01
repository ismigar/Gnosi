import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import NotionImportSettings from './NotionImportSettings';


const notionMocks = vi.hoisted(() => ({
    fetchNotionCloneProgress: vi.fn(),
    fetchNotionImportConfig: vi.fn(),
    fetchNotionOAuthStatus: vi.fn(),
    fetchNotionStatus: vi.fn(),
}));
const vaultMocks = vi.hoisted(() => ({
    fetchVaultCatalog: vi.fn(),
}));
const reactTestGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
};


vi.mock('react-i18next', () => ({
    Trans: ({ i18nKey }: { readonly i18nKey: string }) => i18nKey,
    useTranslation: () => ({
        t: (key: string, fallback?: string | Record<string, unknown>) => {
            if (typeof fallback === 'string') return fallback;
            return typeof fallback?.defaultValue === 'string'
                ? fallback.defaultValue
                : key;
        },
    }),
}));


vi.mock('../../shared/api/notion-import', () => ({
    abortNotionClone: vi.fn(),
    connectNotionToken: vi.fn(),
    disconnectNotionToken: vi.fn(),
    fetchNotionCloneProgress: notionMocks.fetchNotionCloneProgress,
    fetchNotionDatabaseSchema: vi.fn(),
    fetchNotionDatabases: vi.fn(),
    fetchNotionImportConfig: notionMocks.fetchNotionImportConfig,
    fetchNotionLinkedDatabases: vi.fn(),
    fetchNotionLoosePages: vi.fn(),
    fetchNotionOAuthStatus: notionMocks.fetchNotionOAuthStatus,
    fetchNotionStatus: notionMocks.fetchNotionStatus,
    fetchNotionVaultRegistry: vi.fn(),
    saveNotionImportConfig: vi.fn(() => Promise.resolve({ status: 'ok' })),
    startNotionClone: vi.fn(),
    verifyNotionClone: vi.fn(),
}));


vi.mock('../../shared/api/vaults', () => ({
    createVault: vi.fn(),
    deleteVault: vi.fn(),
    fetchVaultCatalog: vaultMocks.fetchVaultCatalog,
}));


vi.mock('../../shared/platform/browser-storage', () => ({
    defineStorageKey: (name: string) => ({ name }),
    jsonStorageCodec: () => ({}),
    readStorage: () => undefined,
    writeStorage: () => true,
}));


vi.mock('../../shared/ui/dialogs/ConfirmModal', () => ({ ConfirmModal: () => null }));
vi.mock('../vault/schema/SchemaConfigModal', () => ({ SchemaConfigModal: () => null }));


describe('NotionImportSettings', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
        notionMocks.fetchNotionImportConfig.mockResolvedValue({ config: null });
        notionMocks.fetchNotionStatus.mockResolvedValue({ connected: false });
        notionMocks.fetchNotionOAuthStatus.mockResolvedValue({ connected: false });
        notionMocks.fetchNotionCloneProgress.mockResolvedValue({
            attachments: 0,
            collected: 0,
            done: 0,
            pages: 0,
            pages_total: 0,
            phase: 'idle',
            running: false,
            tables: 0,
            tables_total: 0,
            total: 0,
            vault_id: null,
            views: 0,
        });
        vaultMocks.fetchVaultCatalog.mockResolvedValue({ vaults: [] });
    });

    afterEach(() => {
        act(() => {
            root.unmount();
        });
        container.remove();
        delete reactTestGlobal.IS_REACT_ACT_ENVIRONMENT;
        vi.clearAllMocks();
    });

    it('loads connection status and presents the token form', async () => {
        await act(async () => {
            root.render(<NotionImportSettings />);
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(container.textContent).toContain('Clone from Notion');
        expect(container.querySelector('input[type="password"]')).not.toBeNull();
        expect(notionMocks.fetchNotionStatus).toHaveBeenCalledOnce();
        expect(vaultMocks.fetchVaultCatalog).toHaveBeenCalledOnce();
    });
});
