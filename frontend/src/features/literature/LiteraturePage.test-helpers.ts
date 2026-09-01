import type {
    LiteratureImportResult,
    LiteratureReview,
    LiteratureSearch,
    LiteratureWork,
} from '../../shared/api/literature';
import type {
    LiteratureConfiguration,
    LiteratureSource,
} from '../../shared/api/literature-resources';


export const source: LiteratureSource = {
    automated: true,
    available: true,
    enabled: true,
    hidden: false,
    id: 'crossref',
    kind: 'api',
    name: 'Crossref',
};

export const work: LiteratureWork = {
    abstract: 'A complete abstract.',
    authors: [{ literal: 'Ada Riu' }],
    conflicts: {
        publication: [
            { provider: 'crossref', value: 'Journal A' },
            { provider: 'openaire', value: 'Journal B' },
        ],
    },
    id: 'work-1',
    identifiers: { doi: '10.1000/evidence', isbn13: [] },
    in_resources: false,
    language: 'en',
    locations: [{ is_oa: true, license: 'CC BY', url: 'https://example.org/article' }],
    metrics: { citations: { crossref: 4, openaire: 3 } },
    open_access: { is_oa: true },
    possible_duplicates: [],
    provenance: { abstract: ['openaire'], title: ['crossref'] },
    publication: { container_title: 'Journal of Evidence' },
    sources: [
        {
            provider: 'crossref',
            provider_id: '10.1000/evidence',
            url: 'https://doi.org/10.1000/evidence',
        },
        {
            provider: 'openaire',
            provider_id: 'oa-1',
            url: 'https://explore.openaire.eu/result/oa-1',
        },
    ],
    title: 'Federated evidence synthesis',
    year: 2025,
};

export const search: LiteratureSearch = {
    errors: [],
    id: 'search-1',
    result_count: 1,
    results: [work],
    source_status: { crossref: { count: 1, state: 'completed' } },
    state: 'completed',
};

export const createdReview: LiteratureReview = {
    configuration: {},
    criteria: {},
    id: 'review-1',
    protocol: '',
    question: '',
    reviewer_mode: 'single',
    reviewers: [],
    status: 'draft',
    title: '',
};

export const emptyImport: LiteratureImportResult = {
    existing: [],
    existing_count: 0,
    imported: [],
    imported_count: 0,
    resource_ids: [],
};

export function configurationFixture(
    sources: readonly LiteratureSource[] = [source],
    aiAgentId = 'research-agent',
): LiteratureConfiguration {
    return {
        ai_agent_id: aiAgentId,
        ai_agents: [{ id: 'research-agent', model: 'test-model', name: 'Research agent' }],
        contact_email: '',
        hidden_sources: [],
        source_defaults: {},
        sources,
    };
}

export function requiredInput(scope: ParentNode, selector: string): HTMLInputElement {
    const input = scope.querySelector(selector);
    if (!(input instanceof HTMLInputElement)) {
        throw new Error(`Input ${selector} is missing.`);
    }
    return input;
}

export function requiredTextarea(scope: ParentNode, selector: string): HTMLTextAreaElement {
    const textarea = scope.querySelector(selector);
    if (!(textarea instanceof HTMLTextAreaElement)) {
        throw new Error(`Textarea ${selector} is missing.`);
    }
    return textarea;
}

export function requiredForm(scope: ParentNode): HTMLFormElement {
    const form = scope.querySelector('form');
    if (!(form instanceof HTMLFormElement)) throw new Error('Literature form is missing.');
    return form;
}

export function buttonContaining(scope: ParentNode, text: string): HTMLButtonElement {
    const button = [...scope.querySelectorAll<HTMLButtonElement>('button')]
        .find((candidate) => candidate.textContent.includes(text));
    if (!button) throw new Error(`Button containing ${text} is missing.`);
    return button;
}

export function labelContaining(scope: ParentNode, text: string): HTMLLabelElement {
    const label = [...scope.querySelectorAll<HTMLLabelElement>('label')]
        .find((candidate) => candidate.textContent.includes(text));
    if (!label) throw new Error(`Label containing ${text} is missing.`);
    return label;
}

export function requiredItem<T>(items: readonly T[], index: number, label: string): T {
    const item = items[index];
    if (item === undefined) throw new Error(`${label} at index ${index.toString()} is missing.`);
    return item;
}

export class FakeEventStream {
    readonly listeners = new Map<string, EventListenerOrEventListenerObject>();
    onerror: ((event: Event) => void) | null = null;
    closed = false;

    constructor(readonly url: string) {}

    addEventListener(name: string, listener: EventListenerOrEventListenerObject): void {
        this.listeners.set(name, listener);
    }

    close(): void {
        this.closed = true;
    }

    emit(name: string, event: Event): void {
        const listener = this.listeners.get(name);
        if (!listener) throw new Error(`Stream listener ${name} is missing.`);
        if (typeof listener === 'function') {
            listener(event);
        } else {
            listener.handleEvent(event);
        }
    }
}
