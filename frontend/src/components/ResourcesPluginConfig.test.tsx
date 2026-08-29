import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CredentialStatus } from '../shared/api/credentials';
import type {
    LiteratureConfiguration,
    LiteratureConfigurationPatch,
    LiteratureSource,
    LiteratureSynchronization,
    ReferenceTableStatus,
} from '../shared/api/literature-resources';
import type { VaultRegistryRecord } from '../shared/api/vaults';
import ResourcesPluginConfig from './ResourcesPluginConfig';

interface ReactTestGlobal {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
}

const testState = vi.hoisted(() => ({
    cancelSynchronization: vi.fn<(
        sourceId: string,
    ) => Promise<LiteratureSynchronization>>(),
    fetchCredentials: vi.fn<() => Promise<CredentialStatus[]>>(),
    fetchConfiguration: vi.fn<() => Promise<LiteratureConfiguration>>(),
    fetchReferenceTable: vi.fn<() => Promise<ReferenceTableStatus>>(),
    fetchVaultTables: vi.fn<() => Promise<VaultRegistryRecord[]>>(),
    updateConfiguration: vi.fn<(
        patch: LiteratureConfigurationPatch,
    ) => Promise<LiteratureConfiguration>>(),
    translate: (key: string): string => key,
}));

vi.mock('../shared/api/credentials', () => ({
    deleteCredential: vi.fn(),
    fetchCredentials: testState.fetchCredentials,
    saveCredential: vi.fn(),
}));

vi.mock('../shared/api/literature-resources', () => ({
    cancelLiteratureSynchronization: testState.cancelSynchronization,
    clearReferenceTable: vi.fn(),
    createLiteratureRepository: vi.fn(),
    createReferenceTable: vi.fn(),
    deleteLiteratureRepository: vi.fn(),
    fetchLiteratureConfiguration: testState.fetchConfiguration,
    fetchReferenceTable: testState.fetchReferenceTable,
    resumeLiteratureSynchronization: vi.fn(),
    setReferenceTable: vi.fn(),
    startLiteratureSynchronization: vi.fn(),
    testLiteratureRepository: vi.fn(),
    updateLiteratureConfiguration: testState.updateConfiguration,
    updateLiteratureRepository: vi.fn(),
}));

vi.mock('../shared/api/vaults', () => ({
    fetchVaultTables: testState.fetchVaultTables,
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: testState.translate }),
}));

const reactTestGlobal = globalThis as typeof globalThis & ReactTestGlobal;

const baseSources: readonly LiteratureSource[] = [
    {
        automated: true,
        available: true,
        enabled: true,
        group: 'open',
        hidden: false,
        id: 'crossref',
        implemented: true,
        kind: 'api',
        name: 'Crossref',
    },
    {
        automated: false,
        available: false,
        enabled: false,
        group: 'external',
        hidden: false,
        id: 'google-scholar',
        implemented: false,
        kind: 'external',
        name: 'Google Scholar',
        search_url: 'https://scholar.google.com/scholar?q={query}',
    },
];

function configurationWith(
    extraSources: readonly LiteratureSource[] = [],
): LiteratureConfiguration {
    return {
        ai_agent_id: '',
        ai_agents: [],
        contact_email: '',
        hidden_sources: [],
        source_defaults: {},
        sources: [...baseSources, ...extraSources],
    };
}

function findButton(label: string): HTMLButtonElement {
    const button = [...document.querySelectorAll('button')]
        .find((candidate) => candidate.textContent.includes(label));
    if (!(button instanceof HTMLButtonElement)) {
        throw new TypeError(`Missing button: ${label}`);
    }
    return button;
}

describe('ResourcesPluginConfig', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        testState.cancelSynchronization.mockReset();
        testState.fetchCredentials.mockReset();
        testState.fetchConfiguration.mockReset();
        testState.fetchReferenceTable.mockReset();
        testState.fetchVaultTables.mockReset();
        testState.updateConfiguration.mockReset();
        testState.fetchCredentials.mockResolvedValue([]);
        testState.fetchReferenceTable.mockResolvedValue({
            configured: true,
            table_id: 'resources',
        });
        testState.fetchVaultTables.mockResolvedValue([
            { id: 'resources', name: 'Resources' },
        ]);
    });

    afterEach(() => {
        act(() => {
            root.unmount();
        });
        container.remove();
        delete reactTestGlobal.IS_REACT_ACT_ENVIRONMENT;
        vi.useRealTimers();
    });

    async function renderConfig(
        extraSources: readonly LiteratureSource[] = [],
    ): Promise<void> {
        const configuration = configurationWith(extraSources);
        testState.fetchConfiguration.mockResolvedValue(configuration);
        testState.updateConfiguration.mockImplementation(async (patch) => {
            const hiddenSources = new Set(
                patch.hidden_sources ?? configuration.hidden_sources,
            );
            const sourceDefaults = patch.source_defaults
                ?? configuration.source_defaults;
            return {
                ...configuration,
                ai_agent_id: patch.ai_agent_id ?? configuration.ai_agent_id,
                contact_email: patch.contact_email ?? configuration.contact_email,
                hidden_sources: [...hiddenSources],
                source_defaults: sourceDefaults,
                sources: configuration.sources.map((source) => ({
                    ...source,
                    enabled: source.id in sourceDefaults
                        ? sourceDefaults[source.id]
                        : source.enabled,
                    hidden: hiddenSources.has(source.id),
                })),
            };
        });
        await act(async () => {
            root.render(<ResourcesPluginConfig />);
        });
        await act(async () => {
            await Promise.resolve();
        });
    }

    it('changes source activation without hiding external links', async () => {
        await renderConfig();
        const toggle = container.querySelector('[role="switch"]');
        expect(toggle?.getAttribute('aria-checked')).toBe('true');
        if (!(toggle instanceof HTMLButtonElement)) throw new TypeError('Missing switch');
        await act(async () => {
            toggle.click();
        });
        expect(testState.updateConfiguration).toHaveBeenCalledWith({
            source_defaults: { crossref: false },
        });
        expect(container.querySelector('a[href^="https://scholar.google.com"]'))
            .not.toBeNull();
    });

    it('shows live OAI progress and requests cancellation', async () => {
        testState.cancelSynchronization.mockResolvedValue({
            source_id: 'dialnet-articles',
            state: 'cancelled',
        });
        await renderConfig([{
            automated: true,
            available: true,
            enabled: true,
            group: 'open',
            hidden: false,
            id: 'dialnet-articles',
            implemented: true,
            kind: 'oai',
            name: 'Dialnet Articles',
            sync: {
                deleted_count: 2,
                index_size: 120,
                indexed_count: 120,
                received_count: 150,
                state: 'running',
            },
        }]);
        expect(container.textContent).toContain('literature.settings.sync_progress');
        const cancelButton = container.querySelector(
            '[aria-label="literature.settings.cancel_sync"]',
        );
        if (!(cancelButton instanceof HTMLButtonElement)) {
            throw new TypeError('Missing cancel button');
        }
        await act(async () => {
            cancelButton.click();
        });
        expect(testState.cancelSynchronization).toHaveBeenCalledWith(
            'dialnet-articles',
        );
    });

    it('uses shared styles and keeps the add action content together', async () => {
        await renderConfig();
        const addButton = findButton('literature.settings.add_repository');
        await act(async () => {
            addButton.click();
        });
        container.querySelectorAll('button').forEach((button) => {
            expect(
                button.classList.contains('btn-gnosi')
                || button.classList.contains('gnosi-icon-button')
                || button.classList.contains('gnosi-toggle'),
            ).toBe(true);
        });
        expect(addButton.classList.contains('resources-plugin-config__action')).toBe(true);
        expect(addButton.classList.contains('resources-plugin-config__add-button')).toBe(true);
        expect(addButton.querySelector('svg')).not.toBeNull();
    });

    it('toggles the inline academic credentials section', async () => {
        await renderConfig();
        const credentialsButton = findButton(
            'literature.settings.manage_credentials',
        );
        await act(async () => {
            credentialsButton.click();
        });
        expect(container.querySelector('.resources-plugin-config__credentials-box'))
            .not.toBeNull();
        expect(container.textContent).toContain(
            'literature.settings.credentials_modal_title',
        );
    });

    it('restores all hidden sources and reports how many changed', async () => {
        await renderConfig([{
            automated: true,
            available: true,
            enabled: true,
            group: 'open',
            hidden: true,
            id: 'hidden-source',
            implemented: true,
            kind: 'api',
            name: 'Hidden source',
        }]);
        const restoreButton = findButton(
            'literature.settings.restore_hidden_sources',
        );
        await act(async () => {
            restoreButton.click();
        });
        expect(testState.updateConfiguration).toHaveBeenCalledWith({
            hidden_sources: [],
        });
        expect(container.textContent).toContain('literature.settings.sources_restored');
        expect(container.textContent).toContain('Hidden source');
    });

    it('disables restoration when there are no hidden sources', async () => {
        await renderConfig();
        const restoreButton = findButton(
            'literature.settings.no_hidden_sources',
        );
        expect(restoreButton.disabled).toBe(true);
    });
});
