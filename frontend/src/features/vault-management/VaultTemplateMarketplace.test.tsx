import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
    createVaultFromTemplate,
    fetchVaultTemplateCatalog,
    fetchVaultTemplateExportPreview,
} from '../../shared/api/vault-templates';

import VaultTemplateMarketplace from './VaultTemplateMarketplace';
import type { VaultTemplateMarketplaceProps } from './VaultTemplateMarketplace';

vi.mock('../../shared/api/vault-templates', () => ({
    createVaultFromTemplate: vi.fn(),
    downloadVaultTemplate: vi.fn(),
    fetchVaultTemplateCatalog: vi.fn(),
    fetchVaultTemplateExportPreview: vi.fn(),
    submitVaultTemplate: vi.fn(),
}));
const translate = vi.hoisted(() => (
    key: string,
    values: Readonly<Record<string, unknown>> = {},
) => Object.entries(values).reduce(
    (text, [name, value]) => text.replace(`{{${name}}}`, String(value)),
    key,
));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: translate }),
}));

let container: HTMLDivElement | null;
let root: Root | null;

beforeAll(() => {
    const testGlobal = globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
    };
    testGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
    if (root) {
        act(() => {
            root?.unmount();
        });
    }
    container?.remove();
    root = null;
    container = null;
    vi.clearAllMocks();
});

async function renderMarketplace(
    props: Partial<VaultTemplateMarketplaceProps> = {},
): Promise<void> {
    container = document.createElement('div');
    document.body.appendChild(container);
    const currentRoot = createRoot(container);
    root = currentRoot;
    await act(async () => {
        currentRoot.render(
            <VaultTemplateMarketplace
                vaults={[{ id: 'vault-1', name: 'Main Vault', active: true }]}
                onClose={() => {}}
                {...props}
            />,
        );
        await Promise.resolve();
    });
}

describe('VaultTemplateMarketplace', () => {
    it('creates a Vault from a verified catalog selection', async () => {
        vi.mocked(fetchVaultTemplateCatalog).mockResolvedValueOnce({
            templates: [{
                id: 'starter-vault', version: '1.0.0', name: 'Starter Vault',
                description: 'Verified starter', verified: true,
            }],
            submissionConfigured: false,
        });
        vi.mocked(createVaultFromTemplate).mockResolvedValueOnce({
            id: 'created-vault',
            name: 'Starter Vault',
            path: '/vaults/starter',
            signedBy: 'gnosi',
            template: { id: 'starter-vault', version: '1.0.0' },
        });
        const onCreated = vi.fn();

        await renderMarketplace({ onCreated });
        await act(async () => {
            await Promise.resolve();
        });
        if (!container) throw new Error('Marketplace container is missing');
        const templateButton = [...container.querySelectorAll('button')]
            .find((button) => button.textContent.includes('Starter Vault'));
        if (!templateButton) throw new Error('Catalog template was not rendered');
        act(() => {
            templateButton.click();
        });
        const createButton = [...container.querySelectorAll('button')]
            .find((button) => button.textContent.includes('vault_templates.create'));
        if (!createButton) throw new Error('Create button was not rendered');
        act(() => {
            createButton.click();
        });
        await act(async () => {
            await Promise.resolve();
        });

        expect(vi.mocked(createVaultFromTemplate)).toHaveBeenCalledWith({
            name: 'Starter Vault',
            template_id: 'starter-vault',
            version: '1.0.0',
        });
        expect(onCreated).toHaveBeenCalledOnce();
    });

    it('shows the privacy preview before publishing', async () => {
        vi.mocked(fetchVaultTemplateCatalog).mockResolvedValueOnce({
            templates: [],
            submissionConfigured: false,
        });
        vi.mocked(fetchVaultTemplateExportPreview).mockResolvedValueOnce({
            included: [{ path: 'Wiki/Note.md', size: 12 }],
            excluded: [{ path: '.gnosi/plugins.json', reason: 'private-root' }],
            findings: [{ path: 'Wiki/Note.md', kind: 'credential-assignment' }],
            totalSize: 12,
        });

        await renderMarketplace({ initialSection: 'publish' });
        await act(async () => {
            await Promise.resolve();
        });

        if (!container) throw new Error('Marketplace container is missing');
        expect(vi.mocked(fetchVaultTemplateExportPreview)).toHaveBeenCalledWith(
            'vault-1',
            expect.any(AbortSignal),
        );
        expect(container.textContent).toContain('vault_templates.included_count');
        expect(container.textContent).toContain('vault_templates.findings_ack');
        const submit = [...container.querySelectorAll('button')]
            .find((button) => button.textContent.includes('vault_templates.submit'));
        if (!(submit instanceof HTMLButtonElement)) {
            throw new Error('Submit button was not rendered');
        }
        expect(submit.disabled).toBe(true);
    });

    it('keeps publishing actions disabled when the preview is rejected', async () => {
        vi.mocked(fetchVaultTemplateCatalog).mockResolvedValueOnce({
            templates: [],
            submissionConfigured: true,
        });
        vi.mocked(fetchVaultTemplateExportPreview).mockRejectedValueOnce(
            new Error('Vault export exceeds the template limits'),
        );

        await renderMarketplace({ initialSection: 'publish' });
        await act(async () => {
            await Promise.resolve();
        });

        if (!container) throw new Error('Marketplace container is missing');
        expect(container.textContent).toContain('Vault export exceeds the template limits');
        const download = [...container.querySelectorAll('button')]
            .find((button) => button.textContent.includes('vault_templates.download_package'));
        const submit = [...container.querySelectorAll('button')]
            .find((button) => button.textContent.includes('vault_templates.submit'));
        if (!(download instanceof HTMLButtonElement)
            || !(submit instanceof HTMLButtonElement)) {
            throw new Error('Publishing buttons were not rendered');
        }
        expect(download.disabled).toBe(true);
        expect(submit.disabled).toBe(true);
    });
});
