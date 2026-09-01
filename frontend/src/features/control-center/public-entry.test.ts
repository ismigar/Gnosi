// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

const loaded = vi.hoisted(() => vi.fn());
vi.mock('./Dashboard', () => { loaded('Dashboard'); return { default: () => null }; });

import { Dashboard } from './index';

describe('control-center feature public entry', () => {
  it('keeps route implementations deferred until their screen is mounted', () => {
    expect(Dashboard).toBeDefined();
    expect(loaded).not.toHaveBeenCalled();
  });
});
