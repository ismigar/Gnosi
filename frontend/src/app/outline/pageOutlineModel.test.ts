import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    collectOutlineHeadings,
    isOutlineRoute,
    outlineHeadingId,
    outlineHeadingText,
} from './pageOutlineModel';

afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
});

function makeVisible(element: HTMLElement, offsetParent: HTMLElement): void {
    Object.defineProperty(element, 'offsetParent', {
        configurable: true,
        value: offsetParent,
    });
}

describe('page outline model', () => {
    it('enables only long-content application routes', () => {
        expect(isOutlineRoute('/vault/page-1')).toBe(true);
        expect(isOutlineRoute('/mail/inbox')).toBe(true);
        expect(isOutlineRoute('/reader/article-1')).toBe(true);
        expect(isOutlineRoute('/graph')).toBe(false);
    });

    it('creates stable bounded identifiers from heading text', () => {
        expect(outlineHeadingId('Àrea / Research Notes', 3))
            .toBe('pout-3-rea-research-notes');
        expect(outlineHeadingId('x'.repeat(80), 0)).toHaveLength(47);
    });

    it('keeps direct heading text and removes nested actions from fallbacks', () => {
        const direct = document.createElement('h2');
        direct.append('Project status');
        direct.appendChild(document.createElement('button')).textContent = 'Edit';
        expect(outlineHeadingText(direct)).toBe('Project status');

        const nested = document.createElement('h3');
        nested.innerHTML = '<span>Evidence</span><a>Open</a>';
        expect(outlineHeadingText(nested)).toBe('Evidence');
    });

    it('collects only visible headings inside a genuinely scrollable region', () => {
        const container = document.createElement('main');
        const scroller = document.createElement('section');
        scroller.style.overflowY = 'auto';
        Object.defineProperty(scroller, 'scrollHeight', { value: 600 });
        Object.defineProperty(scroller, 'clientHeight', { value: 100 });
        const heading = document.createElement('h2');
        heading.textContent = 'Methods';
        makeVisible(heading, scroller);
        scroller.appendChild(heading);
        container.appendChild(scroller);
        document.body.appendChild(container);

        const snapshot = collectOutlineHeadings(container);

        expect(snapshot.headings).toEqual([
            { id: 'pout-0-methods', level: 2, text: 'Methods' },
        ]);
        expect(snapshot.nodes[0]?.element).toBe(heading);
    });
});
