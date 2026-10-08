import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { mountTestComponent } from '../../../../../tests/mount-react';
import { dispatchWindowEvent } from '../../../../shared/platform/browser-events';
import { PaneVisibilityContext } from '../../../../shared/ui/PaneVisibility';
import { EmbedTabMenu } from './EmbedTabMenu';

afterEach(() => { vi.restoreAllMocks(); });

it('escapes editor clipping and follows its anchor on scroll and resize', () => {
    const anchor = document.createElement('button');
    let rect = new DOMRect(100, window.innerHeight - 80, 20, 20);
    const geometry = vi.spyOn(anchor, 'getBoundingClientRect').mockImplementation(() => rect);
    const { container, unmount } = mountTestComponent(
        <EmbedTabMenu anchorRef={{ current: anchor }} opensUpward onClose={vi.fn()}>Configure</EmbedTabMenu>,
    );
    const menu = document.querySelector<HTMLElement>('[data-embed-tab-menu]');
    expect(menu?.parentElement).toBe(document.body);
    expect(container.contains(menu)).toBe(false);
    expect(menu?.className).toContain('z-[var(--z-popover)]');
    expect(menu?.style).toMatchObject({ left: '100px', bottom: '84px' });
    rect = new DOMRect(window.innerWidth - 10, window.innerHeight - 100, 20, 20);
    act(() => { dispatchWindowEvent(new Event('scroll')); });
    expect(menu?.style.bottom).toBe('104px');
    expect(menu?.style.left).toBe(`${String(window.innerWidth - 232)}px`);
    rect = new DOMRect(30, 100, 20, 20);
    act(() => { dispatchWindowEvent(new Event('resize')); });
    expect(menu?.style.left).toBe('30px');
    const reads = geometry.mock.calls.length;
    unmount();
    act(() => { dispatchWindowEvent(new Event('resize')); });
    expect(geometry).toHaveBeenCalledTimes(reads);
    expect(document.querySelector('[data-embed-tab-menu]')).toBeNull();
});

it('dismisses on outside click and hides with its owning document pane', () => {
    const onClose = vi.fn();
    const anchor = document.createElement('button');
    const renderMenu = (visible: boolean) => <PaneVisibilityContext.Provider value={visible}>
        <EmbedTabMenu anchorRef={{ current: anchor }} opensUpward={false} onClose={onClose}>Configure</EmbedTabMenu>
    </PaneVisibilityContext.Provider>;
    const { render } = mountTestComponent(renderMenu(true));
    const overlay = document.querySelector<HTMLElement>('[data-document-pane-portal] > div');
    act(() => { overlay?.click(); });
    expect(onClose).toHaveBeenCalledOnce();
    render(renderMenu(false));
    const pane = document.querySelector<HTMLElement>('[data-document-pane-portal]');
    expect(pane?.style.display).toBe('none');
    expect(pane?.getAttribute('aria-hidden')).toBe('true');
});
