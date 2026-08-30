import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Sidebar } from './Sidebar';


vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, fallback?: string | { readonly defaultValue?: string }) => (
            typeof fallback === 'string' ? fallback : fallback?.defaultValue ?? key
        ),
    }),
}));
const reactTestGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
};


describe('graph Sidebar', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => {
            root.unmount();
        });
        container.remove();
        vi.clearAllMocks();
        delete reactTestGlobal.IS_REACT_ACT_ENVIRONMENT;
    });

    it('preserves search, pathfinding, semantic and timeline controls', () => {
        const onSearchSubmit = vi.fn();
        const onPathfindingModeChange = vi.fn();
        const onClearPath = vi.fn();
        const onShowSemanticSuggestionsChange = vi.fn();
        act(() => {
            root.render(<Sidebar
                colorMode="cluster"
                getNodeLabel={(nodeId) => `Node ${nodeId}`}
                hasClusterData
                hasSemanticData
                hideIsolated={false}
                isPathfindingMode
                maxDate={200}
                minDate={100}
                onClearPath={onClearPath}
                onColorModeChange={vi.fn()}
                onHideIsolatedChange={vi.fn()}
                onOnlyIsolatedChange={vi.fn()}
                onPathfindingModeChange={onPathfindingModeChange}
                onSearchChange={vi.fn()}
                onSearchSubmit={onSearchSubmit}
                onShowSemanticSuggestionsChange={onShowSemanticSuggestionsChange}
                onTimelineChange={vi.fn()}
                onlyIsolated={false}
                pathResult={{ fullPath: ['a', 'b'] }}
                pathSource="a"
                pathTarget="b"
                searchTerm="research"
                showSemanticSuggestions={false}
                timelineDate={150}
            />);
        });

        const search = container.querySelector<HTMLInputElement>('#search-input');
        const semantic = container.querySelector<HTMLInputElement>('#semantic-suggestions-toggle');
        const pathButton = Array.from(container.querySelectorAll('button'))
            .find((button) => button.textContent.includes('Stop search'));
        const clearButton = Array.from(container.querySelectorAll('button'))
            .find((button) => button.textContent.includes('Clear selection'));
        if (!search || !semantic || !pathButton || !clearButton) {
            throw new Error('Expected graph sidebar controls were not rendered');
        }

        act(() => {
            search.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
            pathButton.click();
            clearButton.click();
            semantic.click();
        });

        expect(onSearchSubmit).toHaveBeenCalledWith('research');
        expect(onPathfindingModeChange).toHaveBeenCalledWith(false);
        expect(onClearPath).toHaveBeenCalledOnce();
        expect(onShowSemanticSuggestionsChange).toHaveBeenCalledWith(true);
        expect(container.textContent).toContain('Node a');
        expect(container.textContent).toContain('Node b');
        expect(container.querySelector('#timeline-slider')).not.toBeNull();
    });
});
