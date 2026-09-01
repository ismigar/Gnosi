import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatchWindowEvent, subscribeDocumentEvent, subscribeElementEvent, subscribeWindowEvent } from './browser-events';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.body.replaceChildren();
});

describe('typed native event subscriptions', () => {
  it('preserves capture order, element delivery, bubbling and cancellation', () => {
    const button = document.createElement('button'); document.body.appendChild(button);
    const order: string[] = [];
    cleanups.push(
      subscribeWindowEvent('click', () => { order.push('window capture'); }, true),
      subscribeDocumentEvent('click', () => { order.push('document capture'); }, { capture: true }),
      subscribeElementEvent(button, 'click', (event) => { order.push('element'); event.preventDefault(); }),
      subscribeDocumentEvent('click', () => { order.push('document bubble'); }),
      subscribeWindowEvent('click', () => { order.push('window bubble'); }),
    );
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    expect(button.dispatchEvent(event)).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(order).toEqual(['window capture', 'document capture', 'element', 'document bubble', 'window bubble']);
    for (const cleanup of cleanups) { cleanup(); cleanup(); }
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(order).toHaveLength(5);
  });

  it('passes through once and abort options and never retains a released listener', () => {
    const once = vi.fn(); const aborted = vi.fn(); const released = vi.fn();
    const controller = new AbortController();
    cleanups.push(subscribeWindowEvent('resize', once, { once: true }));
    cleanups.push(subscribeWindowEvent('resize', aborted, { signal: controller.signal }));
    const release = subscribeWindowEvent('resize', released);
    cleanups.push(release);
    controller.abort(); release();
    dispatchWindowEvent(new Event('resize')); dispatchWindowEvent(new Event('resize'));
    expect(once).toHaveBeenCalledOnce();
    expect(aborted).not.toHaveBeenCalled(); expect(released).not.toHaveBeenCalled();
  });

  it('keeps a capture listener reachable when a child stops bubbling', () => {
    const button = document.createElement('button'); document.body.appendChild(button);
    const capture = vi.fn(); const bubble = vi.fn();
    cleanups.push(subscribeWindowEvent('keydown', capture, true));
    cleanups.push(subscribeWindowEvent('keydown', bubble));
    cleanups.push(subscribeElementEvent(button, 'keydown', (event) => { event.stopPropagation(); }));
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(capture).toHaveBeenCalledOnce(); expect(bubble).not.toHaveBeenCalled();
  });
});
