import { describe, expect, it } from 'vitest';

import {
    adaptiveHoverPreviewStyle,
    isHoverPreviewScrollable,
    positionHoverPreview,
    scrollHoverPreviewByKey,
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

    it('detects vertical overflow without depending on width', () => {
        expect(isHoverPreviewScrollable({ scrollHeight: 401, clientHeight: 400 })).toBe(true);
        expect(isHoverPreviewScrollable({ scrollHeight: 400, clientHeight: 400 })).toBe(false);
        expect(isHoverPreviewScrollable(null)).toBe(false);
    });

    it.each([
        ['ArrowDown', 100, 140],
        ['ArrowUp', 100, 60],
        ['PageDown', 100, 340],
        ['PageUp', 300, 60],
        ['Home', 300, 0],
        ['End', 100, 700],
    ])('scrolls an overflowing preview with %s', (key, initial, expected) => {
        const element = {
            scrollTop: initial,
            scrollHeight: 1000,
            clientHeight: 300,
        };

        expect(scrollHoverPreviewByKey(element, key)).toBe(true);
        expect(element.scrollTop).toBe(expected);
    });

    it('clamps at the vertical boundaries and ignores unrelated keys', () => {
        const element = {
            scrollTop: 690,
            scrollHeight: 1000,
            clientHeight: 300,
        };

        expect(scrollHoverPreviewByKey(element, 'ArrowDown')).toBe(true);
        expect(element.scrollTop).toBe(700);
        expect(scrollHoverPreviewByKey(element, 'Enter')).toBe(false);
        expect(element.scrollTop).toBe(700);
    });

    it('does not consume cursor keys when the preview has no vertical overflow', () => {
        const element = {
            scrollTop: 0,
            scrollHeight: 300,
            clientHeight: 300,
        };

        expect(scrollHoverPreviewByKey(element, 'ArrowDown')).toBe(false);
        expect(element.scrollTop).toBe(0);
    });
});
