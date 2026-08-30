import { describe, expect, it } from 'vitest';

import {
    getHoverEdgeStyle,
    getRenderedEdgeThickness,
} from './graphEdgeStyles';

describe('graph edge styles', () => {
    it('normalizes the new visual baseline to 1.0x', () => {
        expect(getRenderedEdgeThickness(1)).toBe(0.48);
        expect(getRenderedEdgeThickness(2)).toBe(0.96);
    });

    it('overrides raw backend size for edges outside the one-hop neighborhood', () => {
        const attributes = Object.assign(
            { size: 1.5 },
            getHoverEdgeStyle({
                isHovered: false,
                isDark: false,
                multiplier: 1,
            }),
        );

        expect(attributes.size).toBe(0.48);
        expect(attributes.zIndex).toBe(0);
        expect(attributes.color).toBe('rgba(0, 0, 0, 0.02)');
    });

    it('keeps direct edges visually above the dimmed graph', () => {
        const attributes = getHoverEdgeStyle({
            isHovered: true,
            isDark: false,
            multiplier: 1,
        });

        expect(attributes.size).toBe(0.65);
        expect(attributes.zIndex).toBe(10);
        expect(attributes.opacity).toBe(1);
    });
});
