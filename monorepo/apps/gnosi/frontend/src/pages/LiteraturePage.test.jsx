import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import axios from 'axios';

import LiteraturePage from './LiteraturePage';

vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock('../plugins/usePlugins', () => ({ usePlugins: () => ({ isEnabled: () => true }) }));
vi.mock('../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const translate = vi.hoisted(() => (key, values = {}) => Object.entries(values).reduce(
    (text, [name, value]) => text.replace(`{{${name}}}`, String(value)), key,
));
vi.mock('react-i18next', () => ({ useTranslation: () => ({
    t: translate,
}) }));

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

const work = {
    id: 'work-1', title: 'Federated evidence synthesis', authors: [{ literal: 'Ada Riu' }], year: 2025,
    abstract: 'A complete abstract.', publication: { container_title: 'Journal of Evidence' },
    language: 'en', identifiers: { doi: '10.1000/evidence', isbn13: [] },
    open_access: { is_oa: true }, metrics: { citations: { crossref: 4, openaire: 3 } },
    sources: [
        { provider: 'crossref', provider_id: '10.1000/evidence', url: 'https://doi.org/10.1000/evidence' },
        { provider: 'openaire', provider_id: 'oa-1', url: 'https://explore.openaire.eu/result/oa-1' },
    ],
    locations: [{ url: 'https://example.org/article', is_oa: true, license: 'CC BY' }],
    provenance: { title: ['crossref'], abstract: ['openaire'] },
    conflicts: { publication: [{ provider: 'crossref', value: 'Journal A' }, { provider: 'openaire', value: 'Journal B' }] },
    possible_duplicates: [], in_resources: false,
};

async function renderPage() {
    axios.get.mockImplementation((url) => {
        if (url === '/api/vault/literature/configuration') return Promise.resolve({ data: { sources: [{ id: 'crossref', name: 'Crossref', automated: true, enabled: true, available: true, hidden: false, kind: 'api' }] } });
        if (url === '/api/vault/literature/searches') return Promise.resolve({ data: { searches: [] } });
        if (url === '/api/vault/literature/reviews') return Promise.resolve({ data: { reviews: [] } });
        if (url.startsWith('/api/vault/literature/searches/')) return Promise.resolve({ data: { id: 'search-1', state: 'completed', result_count: 1, source_status: { crossref: { state: 'completed', count: 1 } }, results: [work], errors: [] } });
        return Promise.resolve({ data: {} });
    });
    axios.post.mockImplementation((url) => {
        if (url === '/api/vault/literature/searches') return Promise.resolve({ data: { id: 'search-1', state: 'completed', result_count: 1, source_status: { crossref: { state: 'completed', count: 1 } }, results: [work], errors: [] } });
        if (url === '/api/vault/literature/imports') return Promise.resolve({ data: { resources: [{ id: 'resource-1' }] } });
        return Promise.resolve({ data: {} });
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<LiteraturePage />));
    await act(async () => {});
}

async function typeInto(input, value) {
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

async function typeIntoTextarea(input, value) {
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

describe('LiteraturePage', () => {
    it('shows deduplicated source provenance and a non-persistent preview', async () => {
        await renderPage();
        const input = container.querySelector('input[aria-label="literature.search.query"]');
        await typeInto(input, 'open science');
        const submit = [...container.querySelectorAll('button')].find((button) => button.textContent.includes('literature.search.submit'));
        await act(async () => submit.closest('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));

        expect(container.textContent).toContain('Federated evidence synthesis');
        expect(container.textContent).toContain('crossref');
        expect(container.textContent).toContain('openaire');
        expect(container.textContent).toContain('literature.result.occurrences');

        const preview = [...container.querySelectorAll('button')].find((button) => button.textContent.includes('literature.result.view'));
        await act(async () => preview.click());
        expect(container.querySelector('[role="dialog"]')).not.toBeNull();
        expect(container.textContent).toContain('literature.preview.conflicts');
        expect(axios.post).toHaveBeenCalledTimes(1);
    });

    it('imports one result through the shared Resources endpoint', async () => {
        await renderPage();
        const input = container.querySelector('input[aria-label="literature.search.query"]');
        await typeInto(input, 'evidence');
        await act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
        const add = [...container.querySelectorAll('button')].find((button) => button.textContent.includes('literature.result.add'));
        await act(async () => add.click());
        expect(axios.post).toHaveBeenCalledWith('/api/vault/literature/imports', { works: [work] });
    });

    it('sends an editable source-specific query to the federated search', async () => {
        await renderPage();
        const input = container.querySelector('input[aria-label="literature.search.query"]');
        await typeInto(input, 'climate adaptation');
        const sourceQuery = container.querySelector('.literature-source-queries textarea');
        await typeIntoTextarea(sourceQuery, 'TITLE(climate) AND adaptation');
        await act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
        expect(axios.post).toHaveBeenCalledWith('/api/vault/literature/searches', expect.objectContaining({
            query: 'climate adaptation', source_queries: { crossref: 'TITLE(climate) AND adaptation' },
        }));
    });

    it('uses server-sent events, supports cancellation, and falls back to the same paginated contract', async () => {
        const streams = [];
        class FakeEventSource {
            constructor(url) { this.url = url; this.listeners = {}; this.closed = false; streams.push(this); }
            addEventListener(name, listener) { this.listeners[name] = listener; }
            close() { this.closed = true; }
        }
        window.EventSource = FakeEventSource;
        await renderPage();
        let state = 'running';
        axios.post.mockResolvedValue({ data: { id: 'search-live', state: 'queued' } });
        axios.get.mockImplementation((url, config) => {
            if (url.includes('/searches/search-live')) return Promise.resolve({ data: { id: 'search-live', query: 'live evidence', state, result_count: 60, results: [work], source_status: {}, errors: [], offset: config?.params?.offset || 0 } });
            return Promise.resolve({ data: { searches: [] } });
        });
        axios.delete.mockImplementation(() => { state = 'cancelled'; return Promise.resolve({ data: {} }); });
        const input = container.querySelector('input[aria-label="literature.search.query"]');
        await typeInto(input, 'live evidence');
        await act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
        expect(streams[0].url).toContain('/searches/search-live/events?after=0');
        await act(async () => streams[0].listeners['source.completed']({ lastEventId: '2' }));
        expect(axios.get).toHaveBeenCalledWith('/api/vault/literature/searches/search-live', { params: { offset: 0, limit: 50 } });
        const next = [...container.querySelectorAll('button')].find((button) => button.textContent.includes('common.next'));
        await act(async () => next.click());
        expect(axios.get).toHaveBeenCalledWith('/api/vault/literature/searches/search-live', { params: { offset: 50, limit: 50 } });
        const cancel = [...container.querySelectorAll('button')].find((button) => button.textContent.includes('literature.search.cancel'));
        await act(async () => cancel.click());
        expect(axios.delete).toHaveBeenCalledWith('/api/vault/literature/searches/search-live');
        expect(streams[0].closed).toBe(true);
    });

    it('creates a review with a recorded protocol and explicit eligibility criteria', async () => {
        await renderPage();
        const reviewTab = [...container.querySelectorAll('button')].find((button) => button.textContent.includes('literature.tabs.reviews'));
        await act(async () => reviewTab.click());
        const fields = container.querySelectorAll('.literature-review-list textarea');
        await typeIntoTextarea(fields[0], 'Which interventions work?');
        await typeIntoTextarea(fields[1], 'Search all configured academic repositories.');
        await typeIntoTextarea(fields[2], 'Adults\nPeer reviewed');
        await typeIntoTextarea(fields[3], 'Wrong population');
        const create = [...container.querySelectorAll('button')].find((button) => button.textContent.includes('literature.review.create'));
        await act(async () => create.click());
        expect(axios.post).toHaveBeenCalledWith('/api/vault/literature/reviews', expect.objectContaining({
            protocol: 'Search all configured academic repositories.',
            criteria: { include: ['Adults', 'Peer reviewed'], exclude: ['Wrong population'] },
        }));
    });
});
