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

async function renderConfig() {
    const configuration = { contact_email: '', source_defaults: {}, hidden_sources: [], sources: [
        { id: 'crossref', name: 'Crossref', kind: 'api', group: 'open', automated: true, implemented: true, available: true, enabled: true, hidden: false },
        { id: 'google-scholar', name: 'Google Scholar', kind: 'external', group: 'external', automated: false, implemented: false, available: false, enabled: false, hidden: false, search_url: 'https://scholar.google.com/scholar?q={query}' },
    ] };
    axios.get.mockImplementation((url) => {
        if (url === '/api/vault/literature/configuration') return Promise.resolve({ data: configuration });
        if (url === '/api/vault/tables') return Promise.resolve({ data: [{ id: 'resources', name: 'Resources' }] });
        return Promise.resolve({ data: { table_id: 'resources', configured: true } });
    });
    axios.put.mockResolvedValue({ data: { ...configuration, source_defaults: { crossref: false }, sources: [{ ...configuration.sources[0], enabled: false }, configuration.sources[1]] } });
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
});
