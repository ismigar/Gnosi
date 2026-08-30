import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearWikilinkResolutionCache,
  resolveWikilinkTarget,
  resolveWikilinkTargetLocal,
} from './wikilinkInlineModel';


describe('wikilinkInlineModel', () => {
  beforeEach(() => {
    clearWikilinkResolutionCache();
  });

  it('strips a section from UUID targets', () => {
    expect(resolveWikilinkTargetLocal(
      '123e4567-e89b-12d3-a456-426614174000#Details',
      {},
    )).toBe('123e4567-e89b-12d3-a456-426614174000');
  });

  it('resolves titles case-insensitively from the local index', () => {
    expect(resolveWikilinkTargetLocal('  research  ', {
      'page-1': 'Research',
    })).toBe('page-1');
  });

  it('keeps an unknown title without its section suffix', () => {
    expect(resolveWikilinkTargetLocal('Unknown#Section', {})).toBe('Unknown');
  });

  it('caches successful backend title resolutions', async () => {
    const resolveTitle = vi.fn(() => Promise.resolve({ id: 'page-2' }));

    await expect(resolveWikilinkTarget('Remote title', {}, resolveTitle))
      .resolves.toBe('page-2');
    await expect(resolveWikilinkTarget('remote title', {}, resolveTitle))
      .resolves.toBe('page-2');
    expect(resolveTitle).toHaveBeenCalledOnce();
  });

  it('caches backend misses and keeps the original title', async () => {
    const resolveTitle = vi.fn(() => Promise.reject(new Error('offline')));

    await expect(resolveWikilinkTarget('Offline title', {}, resolveTitle))
      .resolves.toBe('Offline title');
    await expect(resolveWikilinkTarget('offline title', {}, resolveTitle))
      .resolves.toBe('offline title');
    expect(resolveTitle).toHaveBeenCalledOnce();
  });
});
