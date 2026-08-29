import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    VisualizationSection,
    type VisualizationSectionProps,
} from './VisualizationSection';

interface ReactTestGlobal {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
}

const reactTestGlobal = globalThis as typeof globalThis & ReactTestGlobal;

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, fallback: string): string => fallback || key,
    }),
}));

function changeInput(input: HTMLInputElement, value: string): void {
    act(() => {
        const setValue = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            'value',
        )?.set?.bind(input);
        if (!setValue) throw new Error('Missing native input value setter');
        setValue(value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

describe('VisualizationSection', () => {
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

    it('preserves controlled toggles and numeric visualization callbacks', () => {
        const onShowArrowsChange = vi.fn<VisualizationSectionProps['onShowArrowsChange']>();
        const onLabelThresholdChange = vi.fn<VisualizationSectionProps['onLabelThresholdChange']>();
        const onNodeSizeChange = vi.fn<VisualizationSectionProps['onNodeSizeChange']>();
        const onEdgeThicknessChange = vi.fn<VisualizationSectionProps['onEdgeThicknessChange']>();
        act(() => {
            root.render(
                <VisualizationSection
                    showArrows
                    onShowArrowsChange={onShowArrowsChange}
                    labelThreshold={12}
                    onLabelThresholdChange={onLabelThresholdChange}
                    nodeSize={1.2}
                    onNodeSizeChange={onNodeSizeChange}
                    edgeThickness={1.5}
                    onEdgeThicknessChange={onEdgeThicknessChange}
                />,
            );
        });

        const arrowToggle = container.querySelector('button[aria-label="Arrows"]');
        const threshold = container.querySelector('#graph-label-threshold');
        const nodeSize = container.querySelector('#graph-node-size');
        const edgeThickness = container.querySelector('#graph-edge-thickness');
        if (!(arrowToggle instanceof HTMLButtonElement)) throw new Error('Missing arrows toggle');
        if (!(threshold instanceof HTMLInputElement)) throw new Error('Missing label threshold');
        if (!(nodeSize instanceof HTMLInputElement)) throw new Error('Missing node size');
        if (!(edgeThickness instanceof HTMLInputElement)) throw new Error('Missing edge thickness');

        act(() => {
            arrowToggle.click();
        });
        changeInput(threshold, '20');
        changeInput(nodeSize, '1.75');
        changeInput(edgeThickness, '2.25');

        expect(onShowArrowsChange).toHaveBeenCalledWith(false);
        expect(onLabelThresholdChange).toHaveBeenCalledWith(20);
        expect(onNodeSizeChange).toHaveBeenCalledWith(1.75);
        expect(onEdgeThicknessChange).toHaveBeenCalledWith(2.25);
    });
});
