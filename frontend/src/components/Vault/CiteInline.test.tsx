import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CiteInline } from './CiteInline';
import {
    VaultEditorContext,
    type VaultEditorContextValue,
} from './VaultEditorContext';


const mocks = vi.hoisted(() => ({
    renderInlineCitation: vi.fn(),
    resolveCitationKey: vi.fn(),
}));
const reactTestGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
};


vi.mock('./cite-inline/citationResolver', () => ({
    resolveCitationKey: mocks.resolveCitationKey,
}));

vi.mock('./cslEngine', () => ({
    renderInlineCitation: mocks.renderInlineCitation,
}));

vi.mock('./WikilinkHoverPreview', () => ({
    WikilinkHoverPreview: ({ pageId }: { readonly pageId: string }) => (
        <div data-testid="citation-preview">Preview {pageId}</div>
    ),
}));


function contextValue(
    overrides: Partial<VaultEditorContextValue> = {},
): VaultEditorContextValue {
    return {
        allTables: [],
        idToTitle: {},
        onCreateRecord: null,
        onDeletePage: null,
        onEditSchema: null,
        onOpenParallel: null,
        pageId: null,
        registry: { databases: [], tables: [], views: [] },
        ...overrides,
    };
}


describe('CiteInline', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
        mocks.resolveCitationKey.mockResolvedValue({
            cslItem: { id: 'weber1905', title: 'The Protestant Ethic', type: 'book' },
            id: 'page-1',
            page: { title: 'The Protestant Ethic' },
        });
        mocks.renderInlineCitation.mockResolvedValue('(Weber, 1905)');
    });

    afterEach(() => {
        act(() => {
            root.unmount();
        });
        container.remove();
        vi.useRealTimers();
        vi.clearAllMocks();
        delete reactTestGlobal.IS_REACT_ACT_ENVIRONMENT;
    });

    it('formats the citation and opens the resolved page', async () => {
        const onOpenInCurrentTab = vi.fn();
        await act(async () => {
            root.render(
                <VaultEditorContext.Provider value={contextValue({ onOpenInCurrentTab })}>
                    <CiteInline citationKey="weber1905" />
                </VaultEditorContext.Provider>,
            );
            await Promise.resolve();
            await Promise.resolve();
        });
        const citation = container.querySelector<HTMLElement>('[data-citation-key]');
        if (!citation) throw new Error('Citation chip did not render');
        expect(citation.textContent).toBe('(Weber, 1905)');
        act(() => {
            citation.click();
        });

        expect(onOpenInCurrentTab).toHaveBeenCalledWith('page-1');
    });

    it('routes modified clicks and opens the hover preview after the delay', async () => {
        vi.useFakeTimers();
        const onOpenInNewTab = vi.fn();
        const onOpenParallel = vi.fn();
        await act(async () => {
            root.render(
                <VaultEditorContext.Provider value={contextValue({
                    onOpenInNewTab,
                    onOpenParallel,
                })}>
                    <CiteInline citationKey="weber1905" />
                </VaultEditorContext.Provider>,
            );
            await Promise.resolve();
            await Promise.resolve();
        });
        const citation = container.querySelector<HTMLElement>('[data-citation-key]');
        if (!citation) throw new Error('Citation chip did not render');
        act(() => {
            citation.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
        });
        act(() => {
            citation.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        });
        act(() => {
            vi.advanceTimersByTime(450);
        });

        expect(onOpenInNewTab).toHaveBeenCalledWith('page-1');
        expect(container.textContent).toContain('Preview page-1');

        act(() => {
            citation.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
        });
        expect(onOpenParallel).toHaveBeenCalledWith('page-1');
    });

    it('renders a missing citation without opening a page', async () => {
        mocks.resolveCitationKey.mockResolvedValue(null);
        const onOpenInCurrentTab = vi.fn();
        await act(async () => {
            root.render(
                <VaultEditorContext.Provider value={contextValue({ onOpenInCurrentTab })}>
                    <CiteInline citationKey="missing" />
                </VaultEditorContext.Provider>,
            );
            await Promise.resolve();
        });
        const citation = container.querySelector<HTMLElement>('[data-citation-key]');
        if (!citation) throw new Error('Citation chip did not render');
        expect(citation.title).toContain('Citació no trobada');
        act(() => {
            citation.click();
        });
        expect(onOpenInCurrentTab).not.toHaveBeenCalled();
    });
});
