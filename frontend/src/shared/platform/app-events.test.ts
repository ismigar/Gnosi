import { describe, expect, it, vi } from 'vitest';

import { emitAppEvent, emitCancelableAppEvent, isAppEvent, subscribeAppEvent, subscribeAppSignal } from './app-events';
import { dispatchWindowEvent } from './browser-events';


describe('typed application events', () => {
  it('distinguishes typed payload envelopes from native signals and wrong names', () => {
    const events: Event[] = [];
    const stop = subscribeAppEvent('gnosi:invalidatePreview', (_detail, event) => { events.push(event); });
    try {
      dispatchWindowEvent(new Event('gnosi:invalidatePreview'));
      expect(events).toHaveLength(0);
      emitAppEvent('gnosi:invalidatePreview', { pageId: 'exact' });
      const event = events[0];
      expect(isAppEvent('gnosi:invalidatePreview', event)).toBe(true);
      expect(isAppEvent('pageEtagConflict', event)).toBe(false);
      expect(isAppEvent('gnosi:invalidatePreview', undefined)).toBe(false);
      expect(isAppEvent('gnosi:invalidatePreview', new Event('gnosi:invalidatePreview'))).toBe(false);
    } finally { stop(); }
  });

  it('preserves cancelable event return values', () => {
    const stop = subscribeAppEvent('gnosi:open-settings', (_detail, event) => { event.preventDefault(); });
    try {
      expect(emitCancelableAppEvent('gnosi:open-settings')).toBe(false);
      expect(emitAppEvent('gnosi:open-settings')).toBe(true);
    } finally { stop(); }
    expect(emitCancelableAppEvent('gnosi:open-settings')).toBe(true);
  });

  it('supports legacy native signals and typed signals without leaking listeners', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAppSignal('gnosi-mail-dark-body-changed', listener);
    dispatchWindowEvent(new Event('gnosi-mail-dark-body-changed'));
    emitAppEvent('gnosi-mail-dark-body-changed');
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    emitAppEvent('gnosi-mail-dark-body-changed');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('delivers typed details and unsubscribes deterministically', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAppEvent('gnosi:invalidatePreview', listener);

    expect(emitAppEvent('gnosi:invalidatePreview', { pageId: 'page-1' })).toBe(true);
    expect(listener).toHaveBeenCalledWith(
      { pageId: 'page-1' },
      expect.objectContaining({ type: 'gnosi:invalidatePreview' }),
    );

    unsubscribe();
    emitAppEvent('gnosi:invalidatePreview', { pageId: 'page-2' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('supports events without a detail payload', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAppEvent('gnosi:config-changed', listener);

    emitAppEvent('gnosi:config-changed');

    expect(listener).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ type: 'gnosi:config-changed' }),
    );
    unsubscribe();
  });

  it('carries module context and notebook resources through typed shell events', () => {
    const contextListener = vi.fn();
    const notebookListener = vi.fn();
    const unsubscribeContext = subscribeAppEvent('gnosi:module-context', contextListener);
    const unsubscribeNotebook = subscribeAppEvent('gnosi:create-notebook', notebookListener);
    const refs = [{
      id: 'route-mail',
      type: 'internal',
      ref: 'mail',
      label: 'Mail',
      scope: {},
    }];

    emitAppEvent('gnosi:module-context', refs);
    emitAppEvent('gnosi:create-notebook', { resourceIds: ['resource-1'] });

    expect(contextListener).toHaveBeenCalledWith(
      refs,
      expect.objectContaining({ type: 'gnosi:module-context' }),
    );
    expect(notebookListener).toHaveBeenCalledWith(
      { resourceIds: ['resource-1'] },
      expect.objectContaining({ type: 'gnosi:create-notebook' }),
    );
    unsubscribeContext();
    unsubscribeNotebook();
  });
});
