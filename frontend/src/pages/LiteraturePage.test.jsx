import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { TestApiProvider } from '../test/TestApiProvider';
import {
    cancelLiteratureSearch,
    createLiteratureReview,
    createLiteratureSearch,
    fetchLiteratureReviews,
    fetchLiteratureSearch,
    fetchLiteratureSearches,
    importLiteratureWorks,
    runLiteratureAi,
} from '../shared/api/literature';
import { fetchLiteratureConfiguration } from '../shared/api/literature-resources';

import LiteraturePage from './LiteraturePage';

vi.mock('../shared/api/literature', () => ({
    addLiteratureCandidates: vi.fn(),
    cancelLiteratureSearch: vi.fn(),
    captureLiteratureWork: vi.fn(),
    createLiteratureActivity: vi.fn(),
    createLiteratureReview: vi.fn(),
    createLiteratureSearch: vi.fn(),
    discoverLiteratureCitations: vi.fn(),
    fetchLiteratureReview: vi.fn(),
    fetchLiteratureReviews: vi.fn(),
    fetchLiteratureSearch: vi.fn(),
    fetchLiteratureSearches: vi.fn(),
    importLiteratureWorks: vi.fn(),
    resolveLiteratureConflict: vi.fn(),
    runLiteratureAi: vi.fn(),
    submitLiteratureDecision: vi.fn(),
    updateLiteratureFullText: vi.fn(),
    updateLiteratureReviewSchedule: vi.fn(),
}));
vi.mock('../shared/api/literature-resources', () => ({
    fetchLiteratureConfiguration: vi.fn(),
    updateLiteratureConfiguration: vi.fn(),
}));
vi.mock('../shared/api/literature-specialized', () => ({
    downloadLiteratureReview: vi.fn(),
}));
vi.mock('../plugins/usePlugins', () => ({ usePlugins: () => ({ isEnabled: () => true }) }));
vi.mock('../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { toast } from '../lib/toast';
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
    const configuration = { ai_agent_id: 'research-agent', ai_agents: [{ id: 'research-agent', name: 'Research agent', model: 'test-model' }], sources: [{ id: 'crossref', name: 'Crossref', automated: true, enabled: true, available: true, hidden: false, kind: 'api' }] };
    const search = { id: 'search-1', state: 'completed', result_count: 1, source_status: { crossref: { state: 'completed', count: 1 } }, results: [work], errors: [] };
    fetchLiteratureConfiguration.mockResolvedValue(configuration);
    fetchLiteratureSearches.mockResolvedValue([]);
    fetchLiteratureReviews.mockResolvedValue([]);
    fetchLiteratureSearch.mockResolvedValue(search);
    createLiteratureSearch.mockResolvedValue(search);
    createLiteratureReview.mockResolvedValue({ id: 'review-1' });
    importLiteratureWorks.mockResolvedValue({ imported: [], existing: [], resource_ids: [], imported_count: 0, existing_count: 0 });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(
        <TestApiProvider>
            <LiteraturePage />
        </TestApiProvider>,
    ));
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
        expect(createLiteratureSearch).toHaveBeenCalledTimes(1);
    });

    it('imports one result through the shared Resources endpoint', async () => {
        await renderPage();
        const input = container.querySelector('input[aria-label="literature.search.query"]');
        await typeInto(input, 'evidence');
        await act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
        const add = [...container.querySelectorAll('button')].find((button) => button.textContent.includes('literature.result.add'));
        await act(async () => add.click());
        expect(importLiteratureWorks).toHaveBeenCalledWith([work]);
    });

    it('sends an editable source-specific query to the federated search', async () => {
        await renderPage();
        const input = container.querySelector('input[aria-label="literature.search.query"]');
        await typeInto(input, 'climate adaptation');
        const sourceQuery = container.querySelector('.literature-source-queries textarea');
        await typeIntoTextarea(sourceQuery, 'TITLE(climate) AND adaptation');
        await act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
        expect(createLiteratureSearch).toHaveBeenCalledWith(expect.objectContaining({
            query: 'climate adaptation', source_queries: { crossref: 'TITLE(climate) AND adaptation' },
        }));
    });

    it('uses the shared app header, exposes controlled filters, and explains a blank AI request', async () => {
        await renderPage();
        expect(container.querySelector('.app-header')).not.toBeNull();
        expect(container.querySelector('.literature-page__header')).toBeNull();

        const filters = [...container.querySelectorAll('button')].find((button) => button.textContent.includes('literature.search.filters'));
        await act(async () => filters.click());
        expect(container.querySelector('select')).not.toBeNull();
        expect(container.textContent).toContain('literature.search.full_text_only');

        const ai = [...container.querySelectorAll('button')].find((button) => button.textContent.includes('literature.ai.assist'));
        await act(async () => ai.click());
        expect(toast.error).toHaveBeenCalledWith('literature.ai.enter_question');
        expect(document.activeElement).toBe(container.querySelector('input[aria-label="literature.search.query"]'));
    });

    it('allows combining several language filters in one search', async () => {
        await renderPage();
        const filters = [...container.querySelectorAll('button')].find((button) => button.textContent.includes('literature.search.filters'));
        await act(async () => filters.click());
        await act(async () => container.querySelector('.literature-language-filter summary').click());
        const languageLabels = [...container.querySelectorAll('.literature-language-filter label')];
        await act(async () => languageLabels.find((label) => label.textContent.includes('Español')).querySelector('input').click());
        await act(async () => languageLabels.find((label) => label.textContent.includes('English')).querySelector('input').click());
        const input = container.querySelector('input[aria-label="literature.search.query"]');
        await typeInto(input, 'historical periodization');
        await act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
        expect(createLiteratureSearch).toHaveBeenCalledWith(expect.objectContaining({
            filters: expect.objectContaining({ languages: ['es', 'en'] }),
        }));
    });

    it('renders AI strategy help as editable research controls rather than raw JSON', async () => {
        await renderPage();
        const input = container.querySelector('input[aria-label="literature.search.query"]');
        await typeInto(input, 'historical periodization');
        runLiteratureAi.mockResolvedValueOnce({
            operation: 'query_strategy',
            audit: { model: 'test-model' },
            result: {
                framework: 'PICO', concepts: { P: { en: 'historical periodization' } },
                synonyms: { P: ['historical periods', 'historical stages'] },
                boolean_query: '"historical periodization" OR "historical stages"', cautions: ['Narrow the scope if necessary'],
            },
        });

        const ai = [...container.querySelectorAll('button')].find((button) => button.textContent.includes('literature.ai.assist'));
        await act(async () => ai.click());
        const proposal = container.querySelector('.literature-ai-proposal');
        expect(proposal.querySelector('textarea')).not.toBeNull();
        expect(proposal.textContent).toContain('historical periodization');
        expect(proposal.querySelector('details').hasAttribute('open')).toBe(false);
        expect(runLiteratureAi).toHaveBeenCalledWith(expect.objectContaining({ agent_id: 'research-agent', payload: expect.objectContaining({ framework: 'AUTO' }) }));
        const searchProposal = [...proposal.querySelectorAll('button')].find((button) => button.textContent.includes('literature.ai.search_with_query'));
        await act(async () => searchProposal.click());
        expect(createLiteratureSearch).toHaveBeenCalledWith(expect.objectContaining({ query: '"historical periodization" OR "historical stages"' }));
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
        createLiteratureSearch.mockResolvedValue({ id: 'search-live', state: 'queued' });
        fetchLiteratureSearch.mockImplementation((searchId, offset) => {
            if (searchId === 'search-live') return Promise.resolve({ id: 'search-live', query: 'live evidence', state, result_count: 60, results: [work], source_status: {}, errors: [], offset: offset || 0 });
            return Promise.resolve({ id: searchId, state: 'completed', results: [] });
        });
        cancelLiteratureSearch.mockImplementation(() => { state = 'cancelled'; return Promise.resolve({ id: 'search-live', state }); });
        const input = container.querySelector('input[aria-label="literature.search.query"]');
        await typeInto(input, 'live evidence');
        await act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
        expect(streams[0].url).toContain('/searches/search-live/events?after=0');
        await act(async () => streams[0].listeners['source.completed']({ lastEventId: '2' }));
        expect(fetchLiteratureSearch).toHaveBeenCalledWith('search-live', 0, 50);
        const next = [...container.querySelectorAll('button')].find((button) => button.textContent.includes('common.next'));
        await act(async () => next.click());
        expect(fetchLiteratureSearch).toHaveBeenCalledWith('search-live', 50, 50);
        const cancel = [...container.querySelectorAll('button')].find((button) => button.textContent.includes('literature.search.cancel'));
        await act(async () => cancel.click());
        expect(cancelLiteratureSearch).toHaveBeenCalledWith('search-live');
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
        expect(createLiteratureReview).toHaveBeenCalledWith(expect.objectContaining({
            protocol: 'Search all configured academic repositories.',
            criteria: { include: ['Adults', 'Peer reviewed'], exclude: ['Wrong population'] },
        }));
    });

    it('opens the resources plugin configuration when clicking configure sources', async () => {
        const listener = vi.fn();
        window.addEventListener('open-settings', listener);
        fetchLiteratureConfiguration.mockResolvedValue({ ai_agent_id: '', ai_agents: [], sources: [
                { id: 'crossref', name: 'Crossref', automated: true, enabled: true, available: true, hidden: false, kind: 'api' },
                { id: 'dialnet-articles', name: 'Dialnet Articles', automated: true, enabled: true, available: false, hidden: false, kind: 'oai' },
            ] });
        fetchLiteratureSearches.mockResolvedValue([]);
        fetchLiteratureReviews.mockResolvedValue([]);
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        await act(async () => root.render(
            <TestApiProvider>
                <LiteraturePage />
            </TestApiProvider>,
        ));
        await act(async () => {});

        const configure = [...container.querySelectorAll('button')].find((button) => button.textContent.includes('literature.search.configure_sources'));
        expect(configure).not.toBeNull();
        await act(async () => configure.click());
        expect(listener).toHaveBeenCalledWith(expect.objectContaining({
            detail: { tab: 'plugins', pluginId: 'resources' },
        }));
        window.removeEventListener('open-settings', listener);
    });
});
