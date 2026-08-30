// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

const loaded = vi.hoisted(() => vi.fn());
vi.mock('./SchedulerPage', () => { loaded('SchedulerPage'); return { default: () => null }; });

import { SchedulerPage } from './index';

describe('automations feature public entry', () => {
  it('keeps route implementations deferred until their screen is mounted', () => {
    expect(SchedulerPage).toBeDefined();
    expect(loaded).not.toHaveBeenCalled();
  });
});
