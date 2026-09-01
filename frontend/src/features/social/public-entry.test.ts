// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

const loaded = vi.hoisted(() => vi.fn());
vi.mock('./SocialDashboard', () => { loaded('SocialDashboard'); return { default: () => null }; });
vi.mock('./ComposerPage', () => { loaded('ComposerPage'); return { default: () => null }; });

import { SocialDashboard, ComposerPage } from './index';

describe('social feature public entry', () => {
  it('keeps route implementations deferred until their screen is mounted', () => {
    expect(SocialDashboard).toBeDefined();
    expect(ComposerPage).toBeDefined();
    expect(SocialDashboard).not.toBe(ComposerPage);
    expect(loaded).not.toHaveBeenCalled();
  });
});
