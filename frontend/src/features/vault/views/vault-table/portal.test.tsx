import { act, createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchWindowEvent } from '../../../../shared/platform/browser-events';
import { mountTestComponent } from '../../../../../tests/mount-react';
import { CellDropdownPortal } from './CellDropdownPortal';
import { InfiniteLoadSentinel } from './InfiniteLoadSentinel';

beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function dropdown() {
  const element = document.querySelector<HTMLElement>('[data-cell-dropdown]');
  if (!element) throw new Error('Missing dropdown portal');
  return element;
}

describe('table dropdown layout and cleanup', () => {
  it('anchors below the cell, flips up near the bottom and follows capture scroll', () => {
    const anchor = document.createElement('div');
    let rect = new DOMRect(10, 20, 150, 30);
    vi.spyOn(anchor, 'getBoundingClientRect').mockImplementation(() => rect);
    const { container, unmount } = mountTestComponent(<CellDropdownPortal anchorRef={{ current: anchor }} maxHeight={160}>
      <span>Options</span>
    </CellDropdownPortal>);
    expect(container.querySelector('[data-cell-dropdown]')).toBeNull();
    expect(dropdown().parentElement).toBe(document.body);
    expect(dropdown().style).toMatchObject({ left: '10px', width: '150px', top: '54px', position: 'fixed' });
    rect = new DOMRect(10, window.innerHeight - 40, 150, 30);
    act(() => { dispatchWindowEvent(new Event('resize')); });
    expect(dropdown().style.top).toBe('');
    expect(dropdown().style.bottom).toBe('44px');
    rect = new DOMRect(23, 20, 180, 30);
    act(() => { document.body.dispatchEvent(new Event('scroll', { bubbles: false })); });
    expect(dropdown().style.left).toBe('23px');
    expect(dropdown().style.width).toBe('180px');
    unmount();
    expect(document.querySelector('[data-cell-dropdown]')).toBeNull();
    expect(() => { dispatchWindowEvent(new Event('resize')); }).not.toThrow();
  });

  it('retries a missing parent anchor on the next frame and cancels pending frames on unmount', () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextId = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      frames.set(++nextId, callback); return nextId;
    });
    const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id); });
    const anchorRef = createRef<HTMLDivElement>();
    const { unmount } = mountTestComponent(<CellDropdownPortal anchorRef={anchorRef}>Options</CellDropdownPortal>);
    expect(document.querySelector('[data-cell-dropdown]')).toBeNull();
    expect(frames.size).toBe(1);
    const scheduled = [...frames.keys()];
    unmount();
    expect(cancel).toHaveBeenCalledWith(scheduled[0]);
    expect(frames.size).toBe(0);
  });
});

describe('table infinite loading sentinel', () => {
  it('loads once per intersecting notification, retains the fallback button and disconnects', () => {
    const load = vi.fn(); const observe = vi.fn(); const disconnect = vi.fn();
    let notify: (() => void) | undefined;
    class Observer {
      constructor(callback: IntersectionObserverCallback) {
        notify = () => {
          callback([{ isIntersecting: true }, { isIntersecting: true }] as IntersectionObserverEntry[], this as unknown as IntersectionObserver);
        };
      }
      observe = observe;
      disconnect = disconnect;
    }
    vi.stubGlobal('IntersectionObserver', Observer);
    const { container, unmount } = mountTestComponent(<InfiniteLoadSentinel visibleCount={50} total={72}
      batchSize={50} onLoadMore={load} label="50 de 72" />);
    expect(observe).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('50 de 72');
    const button = container.querySelector('button');
    expect(button?.textContent).toBe('+22');
    act(() => { notify?.(); });
    expect(load).toHaveBeenCalledOnce();
    act(() => { button?.click(); });
    expect(load).toHaveBeenCalledTimes(2);
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
