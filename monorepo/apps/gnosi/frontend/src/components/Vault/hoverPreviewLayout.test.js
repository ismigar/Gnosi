import { describe, expect, it } from 'vitest';

import {
    adaptiveHoverPreviewStyle,
    positionHoverPreview,
} from './hoverPreviewLayout';

describe('adaptive hover preview layout', () => {
    it('sizes to content while enforcing viewport-safe limits and no horizontal overflow', () => {
        expect(adaptiveHoverPreviewStyle({
            minWidth: 280,
            maxWidth: 520,
            maxHeight: 500,
        })).toEqual({
            width: 'max-content',
            minWidth: 'min(280px, calc(100vw - 16px))',
            maxWidth: 'min(520px, calc(100vw - 16px))',
            maxHeight: 'min(500px, calc(100vh - 16px))',
            overflowX: 'hidden',
        });
    });

    it('places a large preview inside the viewport above a bottom-right anchor', () => {
        expect(positionHoverPreview(
            { top: 560, bottom: 580, left: 760 },
            { width: 420, height: 300 },
            { width: 900, height: 600 },
        )).toEqual({
            top: 252,
            left: 472,
        });
    });

    it('pins a viewport-height preview to the safe top margin', () => {
        expect(positionHoverPreview(
            { top: 240, bottom: 260, left: -12 },
            { width: 360, height: 584 },
            { width: 640, height: 600 },
        )).toEqual({
            top: 8,
            left: 8,
        });
    });
});
