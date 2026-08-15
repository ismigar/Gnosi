import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import axios from 'axios';

import VaultTemplateMarketplace from './VaultTemplateMarketplace';

vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const translate = vi.hoisted(() => (key, values = {}) => Object.entries(values || {}).reduce(
    (text, [name, value]) => text.replace(`{{${name}}}`, value),
    key,
));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: translate }),
}));

let container;
let root;

beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
    if (root) await act(async () => root.unmount());
    container?.remove();
    root = null;
    container = null;
    vi.clearAllMocks();
});

async function renderMarketplace(props = {}) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(
        <VaultTemplateMarketplace
            vaults={[{ id: 'vault-1', name: 'Main Vault', active: true }]}
            onClose={() => {}}
            {...props}
        />,
    ));
}

describe('VaultTemplateMarketplace', () => {
    it('creates a Vault from a verified catalog selection', async () => {
        axios.get.mockResolvedValueOnce({ data: {
            templates: [{
                id: 'starter-vault', version: '1.0.0', name: 'Starter Vault',
                description: 'Verified starter', verified: true,
            }],
        } });
        axios.post.mockResolvedValueOnce({ data: { id: 'created-vault' } });
        const onCreated = vi.fn();

        await renderMarketplace({ onCreated });
        await act(async () => {});
        const templateButton = [...container.querySelectorAll('button')]
            .find((button) => button.textContent.includes('Starter Vault'));
        await act(async () => templateButton.click());
        const createButton = [...container.querySelectorAll('button')]
            .find((button) => button.textContent.includes('vault_templates.create'));
        await act(async () => createButton.click());

        expect(axios.post).toHaveBeenCalledWith('/api/vaults/from-template', {
            name: 'Starter Vault',
            template_id: 'starter-vault',
            version: '1.0.0',
        });
        expect(onCreated).toHaveBeenCalledOnce();
    });

    it('shows the privacy preview before publishing', async () => {
        axios.get
            .mockResolvedValueOnce({ data: { templates: [], submissionConfigured: false } })
            .mockResolvedValueOnce({ data: {
                included: [{ path: 'Wiki/Note.md', size: 12 }],
                excluded: [{ path: '.gnosi/plugins.json', reason: 'private-root' }],
                findings: [{ path: 'Wiki/Note.md', kind: 'credential-assignment' }],
                totalSize: 12,
            } });

        await renderMarketplace({ initialSection: 'publish' });
        await act(async () => {});

        expect(axios.get).toHaveBeenCalledWith('/api/vaults/vault-1/template-export/preview');
        expect(container.textContent).toContain('vault_templates.included_count');
        expect(container.textContent).toContain('vault_templates.findings_ack');
        const submit = [...container.querySelectorAll('button')]
            .find((button) => button.textContent.includes('vault_templates.submit'));
        expect(submit.disabled).toBe(true);
    });

    it('keeps publishing actions disabled when the preview is rejected', async () => {
        axios.get
            .mockResolvedValueOnce({ data: { templates: [], submissionConfigured: true } })
            .mockRejectedValueOnce({ response: { data: { detail: 'Vault export exceeds the template limits' } } });

        await renderMarketplace({ initialSection: 'publish' });
        await act(async () => {});

        expect(container.textContent).toContain('Vault export exceeds the template limits');
        const download = [...container.querySelectorAll('button')]
            .find((button) => button.textContent.includes('vault_templates.download_package'));
        const submit = [...container.querySelectorAll('button')]
            .find((button) => button.textContent.includes('vault_templates.submit'));
        expect(download.disabled).toBe(true);
        expect(submit.disabled).toBe(true);
    });
});
