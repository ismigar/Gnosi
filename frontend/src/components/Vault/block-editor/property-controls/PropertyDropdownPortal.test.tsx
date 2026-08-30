import { act, createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountTestComponent } from '../../../../test/mount-react';
import { dispatchWindowEvent } from '../../../../shared/platform/browser-events';
import { PropertyDropdownPortal } from './PropertyDropdownPortal';
import { portal } from './test-support';

afterEach(() => { vi.restoreAllMocks(); });

describe('editor property portal', () => {
    it('escapes its parent, clamps horizontal bounds and flips upward with an 8px gap on resize', () => {
        const anchor = document.createElement('div');
        let rect = new DOMRect(-20, 20, 150, 30);
        const geometry = vi.spyOn(anchor, 'getBoundingClientRect').mockImplementation(() => rect);
        const { container, unmount } = mountTestComponent(<PropertyDropdownPortal anchorRef={{ current: anchor }}>
            <span>Opcions</span>
        </PropertyDropdownPortal>);
        expect(container.querySelector('[data-property-dropdown]')).toBeNull();
        expect(portal().parentElement).toBe(document.body);
        expect(portal().style).toMatchObject({ left: '8px', width: '150px', top: '58px', position: 'fixed', maxHeight: '300px' });
        expect(portal().style.zIndex).toBe('var(--z-popover)');
        rect = new DOMRect(window.innerWidth - 50, window.innerHeight - 40, 150, 30);
        act(() => { dispatchWindowEvent(new Event('resize')); });
        expect(portal().style.top).toBe('');
        expect(portal().style.bottom).toBe('48px');
        expect(portal().style.left).toBe(`${String(window.innerWidth - 158)}px`);
        rect = new DOMRect(23, 20, 180, 30);
        act(() => { document.body.dispatchEvent(new Event('scroll', { bubbles: false })); });
        expect(portal().style).toMatchObject({ left: '23px', width: '180px', top: '58px', bottom: '' });
        const previousReads = geometry.mock.calls.length;
        unmount();
        act(() => { dispatchWindowEvent(new Event('resize')); document.body.dispatchEvent(new Event('scroll')); });
        expect(geometry).toHaveBeenCalledTimes(previousReads);
        expect(document.querySelector('[data-property-dropdown]')).toBeNull();
    });

    it('retains the 80px minimum when there is not enough space on either side', () => {
        const anchor = document.createElement('div');
        vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 20, 150, window.innerHeight - 40));
        mountTestComponent(<PropertyDropdownPortal anchorRef={{ current: anchor }}>Opcions</PropertyDropdownPortal>);
        expect(portal().style.maxHeight).toBe('80px');
        expect(portal().style.bottom).toBe('');
    });

    it('retries a child-first missing anchor on the next frame and renders when the parent ref appears', () => {
        let frame: FrameRequestCallback | undefined;
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frame = callback; return 42; });
        const cancel = vi.spyOn(window, 'cancelAnimationFrame');
        const anchorRef = createRef<HTMLDivElement>();
        const { unmount } = mountTestComponent(<PropertyDropdownPortal anchorRef={anchorRef}>Opcions</PropertyDropdownPortal>);
        expect(document.querySelector('[data-property-dropdown]')).toBeNull();
        anchorRef.current = document.createElement('div');
        act(() => { frame?.(0); });
        expect(portal().textContent).toBe('Opcions');
        unmount();
        expect(cancel).toHaveBeenCalledWith(42);
    });

    it('cancels a pending retry when unmounted before the anchor exists', () => {
        vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(73);
        const cancel = vi.spyOn(window, 'cancelAnimationFrame');
        const { unmount } = mountTestComponent(<PropertyDropdownPortal anchorRef={{ current: null }}>Opcions</PropertyDropdownPortal>);
        unmount();
        expect(cancel).toHaveBeenCalledWith(73);
    });
});
