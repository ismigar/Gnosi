// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

const loaded = vi.hoisted(() => vi.fn());
vi.mock('./ProjectPlanningPage', () => { loaded(); return { default: () => null }; });

import { ProjectPlanningPage } from './index';

describe('planning feature public entry', () => {
  it('defers the screen implementation until it is rendered', () => {
    expect(ProjectPlanningPage).toBeDefined();
    expect(loaded).not.toHaveBeenCalled();
  });
});
