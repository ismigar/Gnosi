// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

const loaded = vi.hoisted(() => vi.fn());
vi.mock('./SharedPage', () => { loaded('SharedPage'); return { default: () => null }; });

import { SharedPage } from './index';

describe('sharing feature public entry', () => {
  it('keeps route implementations deferred until their screen is mounted', () => {
    expect(SharedPage).toBeDefined();
    expect(loaded).not.toHaveBeenCalled();
  });
});
