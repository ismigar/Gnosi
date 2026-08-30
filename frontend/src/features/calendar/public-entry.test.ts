// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

const loaded = vi.hoisted(() => vi.fn());
vi.mock('./CalendarPage', () => { loaded(); return { default: () => null }; });

import { CalendarPage } from './index';

describe('calendar feature public entry', () => {
  it('defers the screen implementation until it is rendered', () => {
    expect(CalendarPage).toBeDefined();
    expect(loaded).not.toHaveBeenCalled();
  });
});
