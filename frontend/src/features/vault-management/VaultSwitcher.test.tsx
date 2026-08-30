import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import VaultSwitcher from './VaultSwitcher';


const mocks = vi.hoisted(() => ({
    activateVault: vi.fn(() => true),
    fetchCatalog: vi.fn(),
    navigate: vi.fn(),
    persistCatalog: vi.fn(),
    storageSet: vi.fn(),
}));


vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, fallback?: string) => fallback ?? key,
    }),
}));


vi.mock('react-router-dom', () => ({
    useLocation: () => ({ pathname: '/vault' }),
    useNavigate: () => mocks.navigate,
}));


vi.mock('../../shared/routing/vaultRouting', () => ({
    activateVault: mocks.activateVault,
    canonicalVaultSwitchPath: (_path: string, slug: string) => `/@${slug}/knowledge`,
    persistVaultCatalog: mocks.persistCatalog,
}));


vi.mock('../../shared/api/vault-context', () => ({
    ACTIVE_VAULT_NAME_KEY: 'gnosi_active_vault_name',
}));


vi.mock('../../shared/platform/browser-storage', () => ({
    defineStorageKey: (name: string) => ({ name }),
    stringStorageCodec: {},
    writeStorage: (key: { name: string }, value: string) => {
        mocks.storageSet(key.name, value);
        return true;
    },
}));


vi.mock('../../shared/api/vaults', () => ({
    createVault: vi.fn(),
    deleteVault: vi.fn(),
    fetchVaultCatalog: mocks.fetchCatalog,
}));


vi.mock('../../shared/ui/dialogs/ConfirmModal', () => ({ default: () => null }));


vi.mock('./VaultTemplateMarketplace', () => ({
    default: ({ initialSection }: { initialSection: string }) => (
        <div data-testid="marketplace">{initialSection}</div>
    ),
}));


const reactTestGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
};
reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;


let container: HTMLDivElement;
let root: Root;
let resolveCatalog: ((value: {
    active_path: string;
    vaults: Array<{
        active: boolean;
        id: string;
        name: string;
        path: string;
        slug: string;
    }>;
}) => void) | null;


beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    resolveCatalog = null;
    vi.resetAllMocks();
    mocks.activateVault.mockReturnValue(true);
    mocks.fetchCatalog.mockImplementation(() => new Promise((resolve) => {
        resolveCatalog = resolve;
    }));
});


afterEach(() => {
    act(() => {
        root.unmount();
    });
    container.remove();
});


describe('VaultSwitcher', () => {
    it('loads, persists, and switches through canonical vault routing', async () => {
        await act(async () => {
            root.render(<VaultSwitcher />);
            await Promise.resolve();
        });
        const finishCatalog = resolveCatalog;
        if (!finishCatalog) throw new Error('Vault catalog request did not start');
        await act(async () => {
            finishCatalog({
                active_path: '/vaults/main',
                vaults: [
                    {
                        active: true,
                        id: 'vault-1',
                        name: 'Main',
                        path: '/vaults/main',
                        slug: 'main',
                    },
                    {
                        active: false,
                        id: 'vault-2',
                        name: 'Second',
                        path: '/vaults/second',
                        slug: 'second',
                    },
                ],
            });
            await Promise.resolve();
        });

        expect(mocks.persistCatalog).toHaveBeenCalledOnce();
        expect(mocks.storageSet).toHaveBeenCalledWith(
            'gnosi_active_vault_name',
            'Main',
        );
        const second = [...container.querySelectorAll('button')]
            .find((button) => button.textContent.includes('Second'));
        if (!second) throw new Error('Second vault was not rendered');
        act(() => {
            second.click();
        });
        expect(mocks.activateVault).toHaveBeenCalledWith(expect.objectContaining({
            id: 'vault-2',
            slug: 'second',
        }));
        expect(mocks.navigate).toHaveBeenCalledWith('/@second/knowledge');

        const marketplace = [...container.querySelectorAll('button')]
            .find((button) => button.textContent.includes('vault_templates.from_repository'));
        if (!marketplace) throw new Error('Marketplace action was not rendered');
        act(() => {
            marketplace.click();
        });
        expect(container.querySelector('[data-testid="marketplace"]')?.textContent)
            .toBe('catalog');
    });
});
