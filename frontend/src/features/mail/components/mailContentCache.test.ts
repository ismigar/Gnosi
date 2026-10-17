import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMailContentCache } from './mailContentCache';


afterEach(() => { vi.useRealTimers(); });

describe('reader-owned content cache', () => {
  it('evicts the least recently used entry at its count limit', () => {
    const cache = createMailContentCache({ maxEntries: 2 });
    cache.set('one', { id: 'one' });
    cache.set('two', { id: 'two' });
    expect(cache.get('one')?.id).toBe('one');
    cache.set('three', { id: 'three' });
    expect(cache.get('two')).toBeNull();
    expect(cache.get('one')?.id).toBe('one');
    expect(cache.get('three')?.id).toBe('three');
  });

  it('counts attachment metadata in its size bound and skips oversized messages', () => {
    const cache = createMailContentCache({ maxBytes: 180 });
    cache.set('one', { id: 'one', body_text: 'a'.repeat(20) });
    cache.set('two', { id: 'two', body_text: 'b'.repeat(20) });
    expect(cache.get('one')).toBeNull();
    expect(cache.get('two')?.id).toBe('two');
    cache.set('large', { id: 'large', attachments: [{ filename: 'x'.repeat(100) }] });
    expect(cache.get('large')).toBeNull();
    expect(cache.get('two')?.id).toBe('two');
  });

  it('expires content and discards all entries on clear', () => {
    vi.useFakeTimers();
    const cache = createMailContentCache({ ttlMs: 100 });
    cache.set('one', { id: 'one' });
    vi.advanceTimersByTime(50);
    expect(cache.get('one')?.id).toBe('one');
    vi.advanceTimersByTime(50);
    expect(cache.get('one')).toBeNull();
    cache.set('two', { id: 'two' });
    cache.clear();
    expect(cache.get('two')).toBeNull();
  });
});
