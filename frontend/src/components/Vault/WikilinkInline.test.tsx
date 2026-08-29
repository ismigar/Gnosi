import { act } from 'react';
import type { ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { WikilinkInline } from './WikilinkInline';
import { clearWikilinkResolutionCache } from './wikilinkInlineModel';


interface ContextMenuStubProps {
    readonly isOpen: boolean;
}


const resolveTitleMock = vi.hoisted(() => vi.fn());


vi.mock('../../shared/api/vaults', () => ({
    resolveVaultTitle: resolveTitleMock,
}));

vi.mock('./WikilinkHoverPreview', () => ({
    WikilinkHoverPreview: () => <div data-testid="hover-preview" />,
}));

vi.mock('./WikilinkContextMenu', () => ({
    WikilinkContextMenu: ({ isOpen }: ContextMenuStubProps) => (
        isOpen ? <div data-testid="context-menu" /> : null
    ),
}));


const reactTestGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
};


describe('WikilinkInline', () => {
    let container: HTMLDivElement;
    let root: Root;

    const renderWikilink = async (
        props: Partial<ComponentProps<typeof WikilinkInline>> = {},
    ): Promise<HTMLSpanElement> => {
        await act(async () => {
            root.render(
                <WikilinkInline
                    target="Research"
                    title="Research"
                    {...props}
                />,
            );
            await Promise.resolve();
        });
        const wikilink = container.querySelector<HTMLSpanElement>(
            '[data-wikilink-target]',
        );
        if (!wikilink) throw new Error('Wikilink was not rendered');
        return wikilink;
    };

    const dispatchMouse = async (
        element: HTMLElement,
        type: string,
        init: MouseEventInit = {},
    ): Promise<void> => {
        await act(async () => {
            element.dispatchEvent(new MouseEvent(type, {
                bubbles: true,
                ...init,
            }));
            await Promise.resolve();
        });
    };

    beforeAll(() => {
        reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
    });

    beforeEach(() => {
        clearWikilinkResolutionCache();
        resolveTitleMock.mockReset();
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => {
            root.unmount();
            await Promise.resolve();
        });
        container.remove();
    });

    it('routes regular, modified and middle clicks to the correct destination', async () => {
        const pageId = '123e4567-e89b-12d3-a456-426614174000';
        const onOpenInCurrentTab = vi.fn();
        const onOpenInNewTab = vi.fn();
        const onOpenParallel = vi.fn();
        const wikilink = await renderWikilink({
            idToTitle: { [pageId]: 'Research' },
            onOpenInCurrentTab,
            onOpenInNewTab,
            onOpenParallel,
        });

        await dispatchMouse(wikilink, 'click');
        await dispatchMouse(wikilink, 'click', { metaKey: true });
        await dispatchMouse(wikilink, 'click', { shiftKey: true });
        await dispatchMouse(wikilink, 'auxclick', { button: 1 });

        expect(onOpenInCurrentTab).toHaveBeenCalledWith(pageId);
        expect(onOpenInNewTab).toHaveBeenCalledTimes(2);
        expect(onOpenInNewTab).toHaveBeenCalledWith(pageId);
        expect(onOpenParallel).toHaveBeenCalledWith(pageId);
        expect(resolveTitleMock).not.toHaveBeenCalled();
    });

    it('ignores right-button auxiliary navigation and opens the context menu', async () => {
        const onOpenInCurrentTab = vi.fn();
        const wikilink = await renderWikilink({ onOpenInCurrentTab });

        await dispatchMouse(wikilink, 'auxclick', { button: 2 });
        expect(onOpenInCurrentTab).not.toHaveBeenCalled();

        await dispatchMouse(wikilink, 'contextmenu', { clientX: 12, clientY: 24 });
        expect(container.querySelector('[data-testid="context-menu"]')).not.toBeNull();
    });

    it('uses the backend resolver for a title absent from the local index', async () => {
        const pageId = '123e4567-e89b-12d3-a456-426614174001';
        resolveTitleMock.mockResolvedValue({ id: pageId });
        const onOpenInCurrentTab = vi.fn();
        const wikilink = await renderWikilink({ onOpenInCurrentTab });

        await dispatchMouse(wikilink, 'click');

        expect(resolveTitleMock).toHaveBeenCalledWith('Research');
        expect(onOpenInCurrentTab).toHaveBeenCalledWith(pageId);
    });
});
