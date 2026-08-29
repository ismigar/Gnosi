import { describe, expect, it, vi } from 'vitest';

import { emitAppEvent, subscribeAppEvent } from './app-events';


describe('typed application events', () => {
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
});
