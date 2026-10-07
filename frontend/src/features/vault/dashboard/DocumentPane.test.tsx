import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountTestComponent } from '../../../../tests/mount-react';
import { DocumentPane } from './DocumentPane';

afterEach(() => { vi.restoreAllMocks(); });

describe('document pane position', () => {
  it('ignores queued layout scrolls on return and yields immediately to keyboard navigation', () => {
    const frames = new Map<number, FrameRequestCallback>();
    let id = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.set(++id, callback); return id; });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(frame => { frames.delete(frame); });
    const tree = (visible: boolean) => <DocumentPane paneId="page" visible={visible} active={visible} style={{ width: '100%' }}><input /><div data-nested-scroll /></DocumentPane>;
    const mounted = mountTestComponent(tree(true));
    const input = mounted.container.querySelector('input');
    const scroll = mounted.container.querySelector<HTMLElement>('[data-nested-scroll]');
    if (!input || !scroll) throw new Error('Missing pane controls');
    act(() => { input.focus(); scroll.scrollTop = 500; scroll.dispatchEvent(new Event('scroll')); });
    mounted.render(tree(false));
    mounted.render(tree(true));
    // A hidden layout can clamp scroll and queue its event until the pane is visible.
    act(() => { scroll.scrollTop = 0; scroll.dispatchEvent(new Event('scroll')); });
    act(() => { for (const callback of frames.values()) callback(0); frames.clear(); });
    expect(scroll.scrollTop).toBe(500);
    mounted.render(tree(false));
    mounted.render(tree(true));
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      scroll.scrollTop = 620; scroll.dispatchEvent(new Event('scroll'));
    });
    expect(frames.size).toBe(0);
    expect(scroll.scrollTop).toBe(620);
  });

  it('restores an input cursor without jumping scroll, including a deliberate return to zero', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    const tree = (visible: boolean, active = visible) => <DocumentPane paneId="page" visible={visible} active={active} style={{ width: '100%' }}>
      <input defaultValue="Unfinished text" /><div data-nested-scroll />
    </DocumentPane>;
    const mounted = mountTestComponent(tree(true));
    const input = mounted.container.querySelector('input');
    const scroller = mounted.container.querySelector<HTMLElement>('[data-nested-scroll]');
    if (!input || !scroller) throw new Error('Missing pane controls');
    act(() => {
      input.focus(); input.setSelectionRange(4, 4);
      scroller.scrollTop = 500; scroller.dispatchEvent(new Event('scroll'));
      scroller.scrollTop = 0; scroller.dispatchEvent(new Event('scroll'));
    });
    mounted.render(tree(false));
    act(() => { input.blur(); scroller.scrollTop = 999; });
    const focus = vi.spyOn(input, 'focus');
    mounted.render(tree(true));
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(4);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(scroller.scrollTop).toBe(0);
  });

  it('keeps a split pane visible without taking focus from the primary document', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    const tree = (visible: boolean, active: boolean) => <DocumentPane paneId="split" visible={visible} active={active} style={{ width: '50%' }}><input /></DocumentPane>;
    const mounted = mountTestComponent(tree(true, true));
    const input = mounted.container.querySelector('input');
    if (!input) throw new Error('Missing input');
    act(() => { input.focus(); });
    mounted.render(tree(false, false));
    act(() => { input.blur(); });
    mounted.render(tree(true, false));
    expect(document.activeElement).not.toBe(input);
    mounted.render(tree(true, true));
    expect(document.activeElement).toBe(input);
  });
});
