// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

const loaded = vi.hoisted(() => vi.fn());
vi.mock('./MediaCenter', () => { loaded('MediaCenter'); return { default: () => null }; });

import { MediaCenter } from './index';

describe('media feature public entry', () => {
  it('keeps route implementations deferred until their screen is mounted', () => {
    expect(MediaCenter).toBeDefined();
    expect(loaded).not.toHaveBeenCalled();
  });
});
