import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    PageLinksGraph,
    type PageLinksGraphLabels,
    type PageLinksGraphProps,
} from './PageLinksGraph';
import { buildPageLinksGraphModel, truncateGraphLabel } from './pageLinksGraphModel';

interface ReactTestGlobal {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
}

const reactTestGlobal = globalThis as typeof globalThis & ReactTestGlobal;

const labels: PageLinksGraphLabels = {
    untitled: 'Untitled',
    empty: 'No links',
    ariaLabel: 'Direct page links',
    outgoing: 'Outgoing',
    incoming: 'Incoming',
    relation: 'Relations',
};

describe('page links graph model', () => {
    it('deduplicates a page connected through multiple direct link types', () => {
        const model = buildPageLinksGraphModel({
            outgoingLinks: [{ id: 'page-a', title: 'Alpha' }],
            incomingLinks: [{ id: 'page-a', title: 'Alpha' }],
            relatedPages: [{ id: 'page-b', title: 'Beta' }],
        });

        expect(model).toHaveLength(2);
        expect(model.find((node) => node.id === 'page-a')).toMatchObject({
            kinds: ['outgoing', 'incoming'],
            visualKind: 'mixed',
        });
    });

    it('keeps unresolved outgoing titles as non-canonical nodes', () => {
        const model = buildPageLinksGraphModel({
            outgoingLinks: [{ id: '', title: 'Missing page' }],
        });

        expect(model).toMatchObject([
            {
                id: '',
                title: 'Missing page',
                kinds: ['outgoing'],
            },
        ]);
    });

    it('truncates only labels that exceed the visual limit', () => {
        expect(truncateGraphLabel('Short title', 12)).toBe('Short title');
        expect(truncateGraphLabel('A deliberately long title', 12)).toBe('A deliberat…');
    });
});

describe('PageLinksGraph', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => {
            root.unmount();
        });
        container.remove();
        delete reactTestGlobal.IS_REACT_ACT_ENVIRONMENT;
    });

    it('updates nodes live when direct-link props change', () => {
        const onOpenPage = vi.fn<PageLinksGraphProps['onOpenPage']>();
        const renderGraph = (outgoingLinks: unknown): void => {
            act(() => {
                root.render(
                    <PageLinksGraph
                        currentTitle="Current page"
                        outgoingLinks={outgoingLinks}
                        incomingLinks={[]}
                        relatedPages={[]}
                        onOpenPage={onOpenPage}
                        labels={labels}
                    />,
                );
            });
        };

        renderGraph([{ id: 'page-a', title: 'A very long direct page title that needs truncation' }]);
        expect(container.querySelectorAll('svg line')).toHaveLength(1);
        expect(container.querySelector('svg g[role="button"] title')?.textContent)
            .toBe('A very long direct page title that needs truncation — Outgoing');

        renderGraph([
            { id: 'page-a', title: 'A very long direct page title that needs truncation' },
            { id: 'page-b', title: 'Second page' },
        ]);
        expect(container.querySelectorAll('svg line')).toHaveLength(2);
        expect(container.querySelectorAll('svg g[role="button"]')).toHaveLength(2);

        const firstNode = container.querySelector('svg g[role="button"]');
        if (!(firstNode instanceof SVGElement)) {
            throw new Error('Missing interactive graph node');
        }
        act(() => {
            firstNode.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
            );
        });
        expect(onOpenPage).toHaveBeenCalledWith('page-a');
    });

    it('renders compact single-circle nodes without a core-and-sphere layer', () => {
        act(() => {
            root.render(
                <PageLinksGraph
                    currentTitle="Current page"
                    outgoingLinks={[{ id: 'page-a', title: 'Connected page' }]}
                    incomingLinks={[]}
                    relatedPages={[]}
                    onOpenPage={vi.fn<PageLinksGraphProps['onOpenPage']>()}
                    labels={labels}
                />,
            );
        });

        const connectedNode = container.querySelector('[data-graph-node="connected"]');
        const centerNode = container.querySelector('[data-graph-node="center"]');
        expect(connectedNode?.querySelectorAll('circle')).toHaveLength(1);
        expect(connectedNode?.querySelector('circle')?.getAttribute('r')).toBe('8');
        expect(centerNode?.querySelectorAll('circle')).toHaveLength(1);
        expect(centerNode?.querySelector('circle')?.getAttribute('r')).toBe('14');
    });
});
