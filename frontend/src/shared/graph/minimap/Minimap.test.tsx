import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Minimap } from './Minimap';

interface ReactTestGlobal {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
}

const reactTestGlobal = globalThis as typeof globalThis & ReactTestGlobal;

describe('Minimap', () => {
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

    it('preserves the minimap canvas and viewport shell without active graph data', () => {
        act(() => {
            root.render(
                <Minimap
                    graph={null}
                    isDarkMode
                    mainRenderer={null}
                />,
            );
        });

        const minimap = container.querySelector('[data-testid="graph-minimap"]');
        const viewport = container.querySelector(
            '[data-testid="graph-minimap-viewport"]',
        );
        expect(minimap).toBeInstanceOf(HTMLDivElement);
        expect(viewport).toBeInstanceOf(HTMLDivElement);
        if (!(minimap instanceof HTMLDivElement)) return;
        if (!(viewport instanceof HTMLDivElement)) return;
        expect(minimap.style.background).toBe('rgba(30, 30, 30, 0.95)');
        expect(minimap.querySelector('canvas')).toBeInstanceOf(HTMLCanvasElement);
        expect(viewport.style.display).toBe('none');
    });
});
