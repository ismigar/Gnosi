// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

const loaded = vi.hoisted(() => vi.fn());
vi.mock('./ReaderDashboard', () => { loaded(); return { default: () => null }; });

import { ReaderDashboard } from './index';

describe('reader feature public entry', () => {
  it('defers the screen implementation until it is rendered', () => {
    expect(ReaderDashboard).toBeDefined();
    expect(loaded).not.toHaveBeenCalled();
  });
});
