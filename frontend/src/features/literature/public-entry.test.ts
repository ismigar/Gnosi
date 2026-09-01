// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

const loaded = vi.hoisted(() => vi.fn());
vi.mock('./LiteraturePage', () => { loaded(); return { default: () => null }; });

import { LiteraturePage } from './index';

describe('literature feature public entry', () => {
  it('defers the screen implementation until it is rendered', () => {
    expect(LiteraturePage).toBeDefined();
    expect(loaded).not.toHaveBeenCalled();
  });
});
