import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConfigurationDocument } from '../../../shared/api/configuration';
import type { VaultGraphData } from '../../../shared/api/graph';
import { VaultGraph, type VaultGraphViewerHandle } from './VaultGraph';

interface ReactTestGlobal {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
}

interface MockGraphFilters {
    readonly activeTableId?: string | null;
    readonly isVaultMode?: boolean;
    readonly searchTerm?: string;
    readonly vaultFilters?: readonly unknown[];
}

interface MockGraphViewerProps {
    readonly filters: MockGraphFilters;
}

const reactTestGlobal = globalThis as typeof globalThis & ReactTestGlobal;
const graphData: VaultGraphData = {
    edges: [],
    legend: { clusters: [], kinds: [] },
    nodes: [],
    partial: true,
    skipped_dirs: ['Cloud/Unavailable'],
};
const testState = vi.hoisted(() => ({
    center: vi.fn<() => void>(),
    fetchConfiguration: vi.fn<() => Promise<ConfigurationDocument>>(),
    refetch: vi.fn<() => Promise<unknown>>(),
    zoomIn: vi.fn<() => void>(),
    zoomOut: vi.fn<() => void>(),
}));

vi.mock('../../../shared/graph/viewer/GraphViewer', async () => {
    const { createElement, forwardRef, useImperativeHandle } = await import('react');
    return {
        GraphViewer: forwardRef<VaultGraphViewerHandle, MockGraphViewerProps>(
            ({ filters }, ref) => {
                useImperativeHandle(ref, () => ({
                    center: testState.center,
                    zoomIn: testState.zoomIn,
                    zoomOut: testState.zoomOut,
                }));
                return createElement('div', {
                    'data-active-table': filters.activeTableId ?? '',
                    'data-search-term': filters.searchTerm ?? '',
                    'data-testid': 'graph-viewer',
                    'data-vault-filter-count': String(filters.vaultFilters?.length ?? 0),
                    'data-vault-mode': String(filters.isVaultMode === true),
                });
            },
        ),
    };
});

vi.mock('../../../shared/api/useGraphData', () => ({
    useVaultGraphData: () => ({
        data: graphData,
        isLoading: false,
        refetch: testState.refetch,
    }),
}));

vi.mock('../../../shared/api/configuration', () => ({
    fetchConfiguration: testState.fetchConfiguration,
}));

vi.mock('../../../shared/platform/configEvents', () => ({
    useConfigChanged: () => undefined,
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, fallback: string): string => fallback || key,
    }),
}));

describe('VaultGraph', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        testState.center.mockReset();
        testState.fetchConfiguration.mockReset();
        testState.refetch.mockReset();
        testState.zoomIn.mockReset();
        testState.zoomOut.mockReset();
        testState.fetchConfiguration.mockResolvedValue({});
        testState.refetch.mockResolvedValue({});
    });

    afterEach(() => {
        act(() => {
            root.unmount();
        });
        container.remove();
        delete reactTestGlobal.IS_REACT_ACT_ENVIRONMENT;
    });

    it('preserves filters, viewer controls, and partial-graph retry', async () => {
        await act(async () => {
            root.render(
                <VaultGraph
                    tableId="projects"
                    view={{ filters: [{ field: 'status', value: 'Open' }] }}
                    searchTerm="alpha"
                    isDarkMode
                />,
            );
            await Promise.resolve();
        });

        const viewer = container.querySelector('[data-testid="graph-viewer"]');
        if (!(viewer instanceof HTMLDivElement)) throw new Error('Missing graph viewer');
        expect(viewer.dataset.activeTable).toBe('projects');
        expect(viewer.dataset.searchTerm).toBe('alpha');
        expect(viewer.dataset.vaultFilterCount).toBe('1');
        expect(viewer.dataset.vaultMode).toBe('true');

        const zoomIn = container.querySelector('button[title="Zoom In"]');
        const zoomOut = container.querySelector('button[title="Zoom Out"]');
        const center = container.querySelector('button[title="Center"]');
        if (!(zoomIn instanceof HTMLButtonElement)) throw new Error('Missing zoom-in control');
        if (!(zoomOut instanceof HTMLButtonElement)) throw new Error('Missing zoom-out control');
        if (!(center instanceof HTMLButtonElement)) throw new Error('Missing center control');
        act(() => {
            zoomIn.click();
            zoomOut.click();
            center.click();
        });
        expect(testState.zoomIn).toHaveBeenCalledOnce();
        expect(testState.zoomOut).toHaveBeenCalledOnce();
        expect(testState.center).toHaveBeenCalledOnce();

        const retry = [...container.querySelectorAll('button')]
            .find((button) => button.textContent.includes('Retry'));
        if (!(retry instanceof HTMLButtonElement)) throw new Error('Missing retry control');
        await act(async () => {
            retry.click();
            await Promise.resolve();
        });
        expect(testState.refetch).toHaveBeenCalledOnce();
        expect(testState.fetchConfiguration).toHaveBeenCalledTimes(2);
    });
});
