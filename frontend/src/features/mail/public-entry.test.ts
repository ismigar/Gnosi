// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

const loaded = vi.hoisted(() => vi.fn());
vi.mock('./MailPage', () => { loaded(); return { default: () => null }; });

import { MailPage } from './index';

describe('mail feature public entry', () => {
  it('keeps the mailbox, composer and providers deferred', () => {
    expect(MailPage).toBeDefined();
    expect(loaded).not.toHaveBeenCalled();
  });
});
