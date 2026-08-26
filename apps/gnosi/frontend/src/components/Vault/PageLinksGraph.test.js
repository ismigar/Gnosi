import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageLinksGraph } from './PageLinksGraph';
import { buildPageLinksGraphModel, truncateGraphLabel } from './pageLinksGraphModel';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const labels = {
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
    let container;
    let root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('updates nodes live when direct-link props change', () => {
        const onOpenPage = vi.fn();
        const renderGraph = (outgoingLinks) => {
            act(() => {
                root.render(React.createElement(PageLinksGraph, {
                    currentTitle: 'Current page',
                    outgoingLinks,
                    incomingLinks: [],
                    relatedPages: [],
                    onOpenPage,
                    labels,
                }));
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

        act(() => {
            container.querySelector('svg g[role="button"]')?.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
            );
        });
        expect(onOpenPage).toHaveBeenCalledWith('page-a');
    });

    it('renders compact single-circle nodes without a core-and-sphere layer', () => {
        act(() => {
            root.render(React.createElement(PageLinksGraph, {
                currentTitle: 'Current page',
                outgoingLinks: [{ id: 'page-a', title: 'Connected page' }],
                incomingLinks: [],
                relatedPages: [],
                onOpenPage: vi.fn(),
                labels,
            }));
        });

        const connectedNode = container.querySelector('[data-graph-node="connected"]');
        const centerNode = container.querySelector('[data-graph-node="center"]');
        expect(connectedNode?.querySelectorAll('circle')).toHaveLength(1);
        expect(connectedNode?.querySelector('circle')?.getAttribute('r')).toBe('8');
        expect(centerNode?.querySelectorAll('circle')).toHaveLength(1);
        expect(centerNode?.querySelector('circle')?.getAttribute('r')).toBe('14');
    });
});
