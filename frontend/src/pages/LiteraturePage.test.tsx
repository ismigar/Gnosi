import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { toast } from '../lib/toast';
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
import {
    subscribeAppEvent,
    type OpenSettingsEventDetail,
} from '../shared/platform/app-events';
import { TestApiProvider } from '../test/TestApiProvider';

import LiteraturePage from './LiteraturePage';
import {
    buttonContaining,
    configurationFixture,
    createdReview,
    emptyImport,
    FakeEventStream,
    labelContaining,
    requiredForm,
    requiredInput,
    requiredItem,
    requiredTextarea,
    search,
    source,
    work,
} from './LiteraturePage.test-helpers';


type OpenEventStream = typeof import('../shared/api/specialized-transports').openEventStream;
type SupportsEventStreams = typeof import('../shared/api/specialized-transports').supportsEventStreams;
type TranslationValues = Readonly<Record<string, string | number>>;


const streamMocks = vi.hoisted(() => ({
    openEventStream: vi.fn<OpenEventStream>(),
    supportsEventStreams: vi.fn<SupportsEventStreams>(),
}));

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
vi.mock('../shared/api/specialized-transports', () => streamMocks);
vi.mock('../plugins/usePlugins', () => ({
    usePlugins: vi.fn(() => ({ isEnabled: () => true })),
}));
vi.mock('../lib/toast', () => ({
    toast: { error: vi.fn(), success: vi.fn() },
}));

const translate = vi.hoisted(() => (
    key: string,
    values: TranslationValues = {},
): string => Object.entries(values).reduce((text, [name, value]) => {
    const replacement = typeof value === 'string' ? value : value.toString();
    return text.replace(`{{${name}}}`, replacement);
}, key));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: translate }),
}));


const mockedCancelLiteratureSearch = vi.mocked(cancelLiteratureSearch);
const mockedCreateLiteratureReview = vi.mocked(createLiteratureReview);
const mockedCreateLiteratureSearch = vi.mocked(createLiteratureSearch);
const mockedFetchLiteratureConfiguration = vi.mocked(fetchLiteratureConfiguration);
const mockedFetchLiteratureReviews = vi.mocked(fetchLiteratureReviews);
const mockedFetchLiteratureSearch = vi.mocked(fetchLiteratureSearch);
const mockedFetchLiteratureSearches = vi.mocked(fetchLiteratureSearches);
const mockedImportLiteratureWorks = vi.mocked(importLiteratureWorks);
const mockedRunLiteratureAi = vi.mocked(runLiteratureAi);
const mockedToastError = vi.mocked(toast.error);

const reactTestGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
};

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeAll(() => {
    reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
    if (root) {
        const mountedRoot = root;
        await act(async () => {
            mountedRoot.unmount();
            await Promise.resolve();
        });
    }
    container?.remove();
    root = null;
    container = null;
    vi.clearAllMocks();
});


function requiredContainer(): HTMLDivElement {
    if (!container) throw new Error('Literature page container is missing.');
    return container;
}

async function renderPage(): Promise<void> {
    streamMocks.supportsEventStreams.mockReturnValue(true);
    mockedFetchLiteratureConfiguration.mockResolvedValue(configurationFixture());
    mockedFetchLiteratureSearches.mockResolvedValue([]);
    mockedFetchLiteratureReviews.mockResolvedValue([]);
    mockedFetchLiteratureSearch.mockResolvedValue(search);
    mockedCreateLiteratureSearch.mockResolvedValue(search);
    mockedCreateLiteratureReview.mockResolvedValue(createdReview);
    mockedImportLiteratureWorks.mockResolvedValue(emptyImport);

    const mountedContainer = document.createElement('div');
    document.body.appendChild(mountedContainer);
    const mountedRoot = createRoot(mountedContainer);
    container = mountedContainer;
    root = mountedRoot;
    await act(async () => {
        mountedRoot.render(
            <TestApiProvider>
                <LiteraturePage />
            </TestApiProvider>,
        );
        await Promise.resolve();
    });
    await act(async () => {
        await Promise.resolve();
    });
}

async function typeInto(
    input: HTMLInputElement | HTMLTextAreaElement,
    value: string,
): Promise<void> {
    const prototype = input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    if (!descriptor?.set) throw new Error('Native control value setter is missing.');
    const setValue = descriptor.set.bind(input);
    await act(async () => {
        setValue(value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await Promise.resolve();
    });
}

async function click(element: HTMLElement): Promise<void> {
    await act(async () => {
        element.click();
        await Promise.resolve();
    });
}

async function submit(form: HTMLFormElement): Promise<void> {
    await act(async () => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await Promise.resolve();
    });
}

describe('LiteraturePage', () => {
    it('shows deduplicated source provenance and a non-persistent preview', async () => {
        await renderPage();
        const page = requiredContainer();
        await typeInto(requiredInput(page, 'input[aria-label="literature.search.query"]'), 'open science');
        const submitButton = buttonContaining(page, 'literature.search.submit');
        const form = submitButton.closest('form');
        if (!(form instanceof HTMLFormElement)) throw new Error('Search form is missing.');
        await submit(form);

        expect(page.textContent).toContain('Federated evidence synthesis');
        expect(page.textContent).toContain('crossref');
        expect(page.textContent).toContain('openaire');
        expect(page.textContent).toContain('literature.result.occurrences');

        await click(buttonContaining(page, 'literature.result.view'));
        expect(page.querySelector('[role="dialog"]')).not.toBeNull();
        expect(page.textContent).toContain('literature.preview.conflicts');
        expect(mockedCreateLiteratureSearch).toHaveBeenCalledTimes(1);
    });

    it('imports one result through the shared Resources endpoint', async () => {
        await renderPage();
        const page = requiredContainer();
        await typeInto(requiredInput(page, 'input[aria-label="literature.search.query"]'), 'evidence');
        await submit(requiredForm(page));
        await click(buttonContaining(page, 'literature.result.add'));
        expect(mockedImportLiteratureWorks).toHaveBeenCalledWith([work]);
    });

    it('sends an editable source-specific query to the federated search', async () => {
        await renderPage();
        const page = requiredContainer();
        await typeInto(requiredInput(page, 'input[aria-label="literature.search.query"]'), 'climate adaptation');
        await typeInto(
            requiredTextarea(page, '.literature-source-queries textarea'),
            'TITLE(climate) AND adaptation',
        );
        await submit(requiredForm(page));
        const call = mockedCreateLiteratureSearch.mock.calls.at(-1);
        if (!call) throw new Error('Literature search call is missing.');
        expect(call[0]).toMatchObject({
            query: 'climate adaptation',
            source_queries: { crossref: 'TITLE(climate) AND adaptation' },
        });
    });

    it('uses the shared app header, exposes controlled filters, and explains a blank AI request', async () => {
        await renderPage();
        const page = requiredContainer();
        expect(page.querySelector('.app-header')).not.toBeNull();
        expect(page.querySelector('.literature-page__header')).toBeNull();

        await click(buttonContaining(page, 'literature.search.filters'));
        expect(page.querySelector('select')).not.toBeNull();
        expect(page.textContent).toContain('literature.search.full_text_only');

        await click(buttonContaining(page, 'literature.ai.assist'));
        expect(mockedToastError).toHaveBeenCalledWith('literature.ai.enter_question');
        expect(document.activeElement).toBe(
            requiredInput(page, 'input[aria-label="literature.search.query"]'),
        );
    });

    it('allows combining several language filters in one search', async () => {
        await renderPage();
        const page = requiredContainer();
        await click(buttonContaining(page, 'literature.search.filters'));
        const summary = page.querySelector('.literature-language-filter summary');
        if (!(summary instanceof HTMLElement)) throw new Error('Language summary is missing.');
        await click(summary);
        await click(requiredInput(labelContaining(page, 'Español'), 'input'));
        await click(requiredInput(labelContaining(page, 'English'), 'input'));
        await typeInto(
            requiredInput(page, 'input[aria-label="literature.search.query"]'),
            'historical periodization',
        );
        await submit(requiredForm(page));
        const call = mockedCreateLiteratureSearch.mock.calls.at(-1);
        if (!call) throw new Error('Filtered literature search call is missing.');
        expect(call[0].filters).toMatchObject({ languages: ['es', 'en'] });
    });

    it('renders AI strategy help as editable research controls rather than raw JSON', async () => {
        await renderPage();
        const page = requiredContainer();
        await typeInto(
            requiredInput(page, 'input[aria-label="literature.search.query"]'),
            'historical periodization',
        );
        mockedRunLiteratureAi.mockResolvedValueOnce({
            audit: { model: 'test-model' },
            operation: 'query_strategy',
            result: {
                boolean_query: '"historical periodization" OR "historical stages"',
                cautions: ['Narrow the scope if necessary'],
                concepts: { P: { en: 'historical periodization' } },
                framework: 'PICO',
                synonyms: { P: ['historical periods', 'historical stages'] },
            },
        });

        await click(buttonContaining(page, 'literature.ai.assist'));
        const proposal = page.querySelector('.literature-ai-proposal');
        if (!(proposal instanceof HTMLElement)) throw new Error('AI proposal is missing.');
        expect(proposal.querySelector('textarea')).not.toBeNull();
        expect(proposal.textContent).toContain('historical periodization');
        const details = proposal.querySelector('details');
        if (!(details instanceof HTMLDetailsElement)) throw new Error('AI details are missing.');
        expect(details.hasAttribute('open')).toBe(false);
        const aiCall = mockedRunLiteratureAi.mock.calls.at(-1);
        if (!aiCall) throw new Error('Literature AI call is missing.');
        expect(aiCall[0]).toMatchObject({
            agent_id: 'research-agent',
            payload: { framework: 'AUTO' },
        });
        await click(buttonContaining(proposal, 'literature.ai.search_with_query'));
        const searchCall = mockedCreateLiteratureSearch.mock.calls.at(-1);
        if (!searchCall) throw new Error('AI literature search call is missing.');
        expect(searchCall[0]).toMatchObject({
            query: '"historical periodization" OR "historical stages"',
        });
    });

    it('uses server-sent events, supports cancellation, and falls back to the same paginated contract', async () => {
        const streams: FakeEventStream[] = [];
        streamMocks.openEventStream.mockImplementation((url) => {
            const stream = new FakeEventStream(url);
            streams.push(stream);
            return stream as unknown as EventSource;
        });
        await renderPage();
        let state: 'cancelled' | 'running' = 'running';
        mockedCreateLiteratureSearch.mockResolvedValue({ id: 'search-live', state: 'queued' });
        mockedFetchLiteratureSearch.mockImplementation((searchId, offset) => {
            if (searchId === 'search-live') {
                return Promise.resolve({
                    errors: [],
                    id: 'search-live',
                    offset,
                    query: 'live evidence',
                    result_count: 60,
                    results: [work],
                    source_status: {},
                    state,
                });
            }
            return Promise.resolve({ id: searchId, results: [], state: 'completed' });
        });
        mockedCancelLiteratureSearch.mockImplementation(() => {
            state = 'cancelled';
            return Promise.resolve({ id: 'search-live', state });
        });
        const page = requiredContainer();
        await typeInto(requiredInput(page, 'input[aria-label="literature.search.query"]'), 'live evidence');
        await submit(requiredForm(page));
        const firstStream = requiredItem(streams, 0, 'Event stream');
        expect(firstStream.url).toContain('/searches/search-live/events?after=0');
        await act(async () => {
            firstStream.emit(
                'source.completed',
                new MessageEvent('source.completed', { lastEventId: '2' }),
            );
            await Promise.resolve();
        });
        expect(mockedFetchLiteratureSearch).toHaveBeenCalledWith('search-live', 0, 50);
        await click(buttonContaining(page, 'common.next'));
        expect(mockedFetchLiteratureSearch).toHaveBeenCalledWith('search-live', 50, 50);
        await click(buttonContaining(page, 'literature.search.cancel'));
        expect(mockedCancelLiteratureSearch).toHaveBeenCalledWith('search-live');
        expect(firstStream.closed).toBe(true);
    });

    it('creates a review with a recorded protocol and explicit eligibility criteria', async () => {
        await renderPage();
        const page = requiredContainer();
        await click(buttonContaining(page, 'literature.tabs.reviews'));
        const fields = [...page.querySelectorAll<HTMLTextAreaElement>(
            '.literature-review-list textarea',
        )];
        await typeInto(requiredItem(fields, 0, 'Review field'), 'Which interventions work?');
        await typeInto(
            requiredItem(fields, 1, 'Review field'),
            'Search all configured academic repositories.',
        );
        await typeInto(requiredItem(fields, 2, 'Review field'), 'Adults\nPeer reviewed');
        await typeInto(requiredItem(fields, 3, 'Review field'), 'Wrong population');
        await click(buttonContaining(page, 'literature.review.create'));
        const call = mockedCreateLiteratureReview.mock.calls.at(-1);
        if (!call) throw new Error('Literature review call is missing.');
        expect(call[0]).toMatchObject({
            criteria: {
                exclude: ['Wrong population'],
                include: ['Adults', 'Peer reviewed'],
            },
            protocol: 'Search all configured academic repositories.',
        });
    });

    it('opens the resources plugin configuration when clicking configure sources', async () => {
        const listener = vi.fn<(detail: OpenSettingsEventDetail) => void>();
        const unsubscribe = subscribeAppEvent('open-settings', listener);
        mockedFetchLiteratureConfiguration.mockResolvedValue(configurationFixture([
            source,
            {
                automated: true,
                available: false,
                enabled: true,
                hidden: false,
                id: 'dialnet-articles',
                kind: 'oai',
                name: 'Dialnet Articles',
            },
        ], ''));
        mockedFetchLiteratureSearches.mockResolvedValue([]);
        mockedFetchLiteratureReviews.mockResolvedValue([]);

        const mountedContainer = document.createElement('div');
        document.body.appendChild(mountedContainer);
        const mountedRoot = createRoot(mountedContainer);
        container = mountedContainer;
        root = mountedRoot;
        await act(async () => {
            mountedRoot.render(
                <TestApiProvider>
                    <LiteraturePage />
                </TestApiProvider>,
            );
            await Promise.resolve();
        });
        await act(async () => {
            await Promise.resolve();
        });

        await click(buttonContaining(mountedContainer, 'literature.search.configure_sources'));
        const call = listener.mock.calls.at(-1);
        if (!call) throw new Error('Open settings event is missing.');
        expect(call[0]).toEqual({ tab: 'plugins', pluginId: 'resources' });
        unsubscribe();
    });
});
