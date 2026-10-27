import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatchWindowEvent, subscribeDocumentEvent, subscribeElementEvent, subscribeWindowEvent, subscribeKeyboardScrollFallback } from './browser-events';

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

  it('runs control handlers before scrolling regardless of registration order, with scoped scrolling before application fallback', () => {
    const order: string[] = [];
    cleanups.push(subscribeKeyboardScrollFallback(() => { order.push('application'); }, 'application'));
    cleanups.push(subscribeWindowEvent('keydown', () => { order.push('first control'); }));
    cleanups.push(subscribeKeyboardScrollFallback(() => { order.push('region'); }));
    cleanups.push(subscribeWindowEvent('keydown', () => { order.push('late control'); }));
    dispatchWindowEvent(new KeyboardEvent('keydown', { key: 'PageDown', cancelable: true }));
    expect(order).toEqual(['first control', 'late control', 'region', 'application']);
  });

  it.each(['prevent', 'immediate'])('does not scroll keys claimed by a later control using %s', mode => {
    const scroll = vi.fn();
    cleanups.push(subscribeKeyboardScrollFallback(scroll));
    cleanups.push(subscribeWindowEvent('keydown', event => {
      if (mode === 'prevent') event.preventDefault();
      else event.stopImmediatePropagation();
    }));
    dispatchWindowEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }));
    expect(scroll).not.toHaveBeenCalled();
  });

  it('preserves native same-window stopPropagation semantics without cancelling the default action', () => {
    const native = vi.fn(), fallback = vi.fn();
    const stopControl = subscribeWindowEvent('keydown', event => { event.stopPropagation(); });
    const stopNative = subscribeWindowEvent('keydown', native);
    dispatchWindowEvent(new KeyboardEvent('keydown', { key: 'PageDown', cancelable: true }));
    expect(native).toHaveBeenCalledOnce(); stopNative(); stopControl();
    cleanups.push(subscribeKeyboardScrollFallback(fallback));
    cleanups.push(subscribeWindowEvent('keydown', event => { event.stopPropagation(); }));
    dispatchWindowEvent(new KeyboardEvent('keydown', { key: 'PageDown', cancelable: true }));
    expect(fallback).toHaveBeenCalledOnce();
  });

  it('preserves scroll priorities across re-subscriptions and removes released fallbacks', () => {
    const application = vi.fn(), region = vi.fn();
    cleanups.push(subscribeKeyboardScrollFallback(application, 'application'));
    const stopRegion = subscribeKeyboardScrollFallback(event => { region(); event.preventDefault(); });
    cleanups.push(stopRegion);
    const releaseControl = subscribeWindowEvent('keydown', () => {}); cleanups.push(releaseControl);
    dispatchWindowEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }));
    expect(region).toHaveBeenCalledOnce(); expect(application).not.toHaveBeenCalled();
    stopRegion(); stopRegion(); releaseControl();
    dispatchWindowEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }));
    expect(region).toHaveBeenCalledOnce(); expect(application).toHaveBeenCalledOnce();
    for (const stop of cleanups.splice(0)) stop();
    dispatchWindowEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }));
    expect(application).toHaveBeenCalledOnce();
  });
});
