// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

const loaded = vi.hoisted(() => vi.fn());
vi.mock('./ContactsPage', () => { loaded(); return { default: () => null }; });

import { ContactsPage } from './index';

describe('contacts feature public entry', () => {
  it('defers the screen implementation until it is rendered', () => {
    expect(ContactsPage).toBeDefined();
    expect(loaded).not.toHaveBeenCalled();
  });
});
