import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ForcesSection, type ForcesSectionProps } from './ForcesSection';

interface ReactTestGlobal {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
}

const reactTestGlobal = globalThis as typeof globalThis & ReactTestGlobal;

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, fallback: string): string => fallback || key,
    }),
}));

function setRangeValue(input: HTMLInputElement, value: string): void {
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

function requireInput(container: HTMLElement, selector: string): HTMLInputElement {
    const input = container.querySelector(selector);
    if (!(input instanceof HTMLInputElement)) {
        throw new Error(`Missing force control: ${selector}`);
    }
    return input;
}

describe('ForcesSection', () => {
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

    it('preserves numeric force values and boolean simulation modes', () => {
        const onGravityChange = vi.fn<ForcesSectionProps['onGravityChange']>();
        const onRepulsionChange = vi.fn<ForcesSectionProps['onRepulsionChange']>();
        const onFrictionChange = vi.fn<ForcesSectionProps['onFrictionChange']>();
        const onEdgeInfluenceChange = vi.fn<NonNullable<ForcesSectionProps['onEdgeInfluenceChange']>>();
        const onLinLogModeChange = vi.fn<NonNullable<ForcesSectionProps['onLinLogModeChange']>>();
        const onStrongGravityModeChange = vi.fn<NonNullable<ForcesSectionProps['onStrongGravityModeChange']>>();
        const onOutboundAttractionDistributionChange = vi.fn<NonNullable<ForcesSectionProps['onOutboundAttractionDistributionChange']>>();
        act(() => {
            root.render(
                <ForcesSection
                    gravity={1}
                    onGravityChange={onGravityChange}
                    repulsion={1000}
                    onRepulsionChange={onRepulsionChange}
                    friction={2}
                    onFrictionChange={onFrictionChange}
                    edgeInfluence={0.5}
                    onEdgeInfluenceChange={onEdgeInfluenceChange}
                    linLogMode={false}
                    onLinLogModeChange={onLinLogModeChange}
                    strongGravityMode={false}
                    onStrongGravityModeChange={onStrongGravityModeChange}
                    outboundAttractionDistribution={false}
                    onOutboundAttractionDistributionChange={onOutboundAttractionDistributionChange}
                />,
            );
        });

        const gravity = requireInput(container, '#graph-force-gravity');
        const repulsion = requireInput(container, '#graph-force-repulsion');
        const friction = requireInput(container, '#graph-force-friction');
        const edgeInfluence = requireInput(container, '#graph-force-edge-influence');
        const linLog = requireInput(container, '#graph-force-linlog');
        const strongGravity = requireInput(container, '#graph-force-strong-gravity');
        const outbound = requireInput(container, '#graph-force-outbound');

        setRangeValue(gravity, '1.25');
        setRangeValue(repulsion, '2500');
        setRangeValue(friction, '3.5');
        setRangeValue(edgeInfluence, '0.8');
        act(() => {
            linLog.click();
            strongGravity.click();
            outbound.click();
        });

        expect(onGravityChange).toHaveBeenCalledWith(1.25);
        expect(onRepulsionChange).toHaveBeenCalledWith(2500);
        expect(onFrictionChange).toHaveBeenCalledWith(3.5);
        expect(onEdgeInfluenceChange).toHaveBeenCalledWith(0.8);
        expect(onLinLogModeChange).toHaveBeenCalledWith(true);
        expect(onStrongGravityModeChange).toHaveBeenCalledWith(true);
        expect(onOutboundAttractionDistributionChange).toHaveBeenCalledWith(true);
    });
});
