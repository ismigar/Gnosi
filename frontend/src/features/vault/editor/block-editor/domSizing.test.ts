import { afterEach, describe, expect, it, vi } from 'vitest';
import { autoGrowTextarea, getScrollableAncestor } from './domSizing';

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

describe('editor textarea sizing', () => {
    it('finds the nearest scrollable ancestor or falls back to the document', () => {
        const outer = document.createElement('div'); const inner = document.createElement('div');
        const textarea = document.createElement('textarea');
        outer.appendChild(inner); inner.appendChild(textarea); document.body.appendChild(outer);
        outer.style.overflowY = 'auto';
        Object.defineProperties(outer, { scrollHeight: { value: 900 }, clientHeight: { value: 300 } });
        expect(getScrollableAncestor(textarea)).toBe(outer);
        expect(getScrollableAncestor(null)).toBe(document.scrollingElement || document.documentElement);
    });
    it('restores scrollTop in the same tick after measuring a collapsing textarea', () => {
        const scroller = document.createElement('div'); const textarea = document.createElement('textarea');
        scroller.appendChild(textarea); document.body.appendChild(scroller); scroller.style.overflowY = 'scroll';
        Object.defineProperties(scroller, { scrollHeight: { value: 900 }, clientHeight: { value: 300 } });
        scroller.scrollTop = 123;
        Object.defineProperty(textarea, 'scrollHeight', { get: () => { scroller.scrollTop = 0; return 240; } });
        autoGrowTextarea(textarea);
        expect(textarea.style.height).toBe('240px');
        expect(scroller.scrollTop).toBe(123);
        expect(() => { autoGrowTextarea(null); }).not.toThrow();
    });
});
