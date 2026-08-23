import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import axios from 'axios';

import ResourcesPluginConfig from './ResourcesPluginConfig';

vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
const translate = vi.hoisted(() => (key) => key);
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: translate }) }));

let container;
let root;

beforeAll(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(async () => {
    if (root) await act(async () => root.unmount());
    container?.remove();
    root = null;
    container = null;
    vi.clearAllMocks();
});

async function renderConfig(extraSources = []) {
    const configuration = { contact_email: '', source_defaults: {}, hidden_sources: [], sources: [
        { id: 'crossref', name: 'Crossref', kind: 'api', group: 'open', automated: true, implemented: true, available: true, enabled: true, hidden: false },
        { id: 'google-scholar', name: 'Google Scholar', kind: 'external', group: 'external', automated: false, implemented: false, available: false, enabled: false, hidden: false, search_url: 'https://scholar.google.com/scholar?q={query}' },
        ...extraSources,
    ] };
    axios.get.mockImplementation((url) => {
        if (url === '/api/vault/literature/configuration') return Promise.resolve({ data: configuration });
        if (url === '/api/vault/tables') return Promise.resolve({ data: [{ id: 'resources', name: 'Resources' }] });
        return Promise.resolve({ data: { table_id: 'resources', configured: true } });
    });
    axios.put.mockImplementation((_url, patch) => {
        const hiddenSources = new Set(patch.hidden_sources ?? configuration.hidden_sources);
        const sourceDefaults = patch.source_defaults ?? configuration.source_defaults;
        return Promise.resolve({ data: {
            ...configuration,
            ...patch,
            source_defaults: sourceDefaults,
            sources: configuration.sources.map((source) => ({
                ...source,
                enabled: source.id in sourceDefaults ? sourceDefaults[source.id] : source.enabled,
                hidden: hiddenSources.has(source.id),
            })),
        } });
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<ResourcesPluginConfig />));
    await act(async () => {});
}

describe('ResourcesPluginConfig', () => {
    it('changes the default source activation without hiding external links', async () => {
        await renderConfig();
        const toggle = container.querySelector('[role="switch"]');
        expect(toggle.getAttribute('aria-checked')).toBe('true');
        await act(async () => toggle.click());
        expect(axios.put).toHaveBeenCalledWith('/api/vault/literature/configuration', { source_defaults: { crossref: false } });
        const external = container.querySelector('a[href^="https://scholar.google.com"]');
        expect(external).not.toBeNull();
    });

    it('shows live OAI progress and requests cancellation', async () => {
        axios.delete.mockResolvedValue({ data: {} });
        await renderConfig([{ id: 'dialnet-articles', name: 'Dialnet Articles', kind: 'oai', group: 'open', automated: true, implemented: true, available: true, enabled: true, hidden: false, sync: { state: 'running', index_size: 120, received_count: 150, indexed_count: 120, deleted_count: 2 } }]);
        expect(container.textContent).toContain('literature.settings.sync_progress');
        const cancel = container.querySelector('[aria-label="literature.settings.cancel_sync"]');
        await act(async () => cancel.click());
        expect(axios.delete).toHaveBeenCalledWith('/api/vault/literature/synchronizations/dialnet-articles');
    });

    it('uses the shared application styles for every control and keeps add action content together', async () => {
        await renderConfig();
        const addButton = Array.from(container.querySelectorAll('button')).find(
            (button) => button.textContent.includes('literature.settings.add_repository'),
        );
        await act(async () => addButton.click());

        container.querySelectorAll('button').forEach((button) => {
            expect(
                button.classList.contains('btn-gnosi')
                || button.classList.contains('gnosi-icon-button')
                || button.classList.contains('gnosi-toggle'),
            ).toBe(true);
        });
        container.querySelectorAll('.btn-gnosi-secondary').forEach((button) => {
            expect(button.classList.contains('btn-gnosi')).toBe(true);
        });
        expect(addButton.classList.contains('resources-plugin-config__action')).toBe(true);
        expect(addButton.classList.contains('resources-plugin-config__add-button')).toBe(true);
        expect(addButton.querySelector('svg')).not.toBeNull();
    });

    it('toggles the inline academic credentials section when managing credentials', async () => {
        await renderConfig();
        const credentialsButton = Array.from(container.querySelectorAll('button')).find(
            (button) => button.textContent.includes('literature.settings.manage_credentials'),
        );

        await act(async () => credentialsButton.click());

        expect(container.querySelector('.resources-plugin-config__credentials-box')).not.toBeNull();
        expect(container.textContent).toContain('literature.settings.credentials_modal_title');
    });

    it('restores all hidden sources and reports how many changed', async () => {
        await renderConfig([{
            id: 'hidden-source', name: 'Hidden source', kind: 'api', group: 'open',
            automated: true, implemented: true, available: true, enabled: true, hidden: true,
        }]);
        const restoreButton = Array.from(container.querySelectorAll('button')).find(
            (button) => button.textContent.includes('literature.settings.restore_hidden_sources'),
        );

        await act(async () => restoreButton.click());

        expect(axios.put).toHaveBeenCalledWith('/api/vault/literature/configuration', { hidden_sources: [] });
        expect(container.textContent).toContain('literature.settings.sources_restored');
        expect(container.textContent).toContain('Hidden source');
    });

    it('explains when there are no hidden sources and disables restoration', async () => {
        await renderConfig();
        const restoreButton = Array.from(container.querySelectorAll('button')).find(
            (button) => button.textContent.includes('literature.settings.no_hidden_sources'),
        );

        expect(restoreButton.disabled).toBe(true);
    });
});
