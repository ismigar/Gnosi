// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

const loaded = vi.hoisted(() => vi.fn());
vi.mock('./GraphPage', () => { loaded(); return { default: () => null }; });

import { GraphPage } from './index';

describe('graph feature public entry', () => {
  it('defers the screen implementation until it is rendered', () => {
    expect(GraphPage).toBeDefined();
    expect(loaded).not.toHaveBeenCalled();
  });
});
