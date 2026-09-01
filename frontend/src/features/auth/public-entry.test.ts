// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

const implementation = vi.hoisted(() => vi.fn(() => null));
vi.mock('./LoginPage', () => ({ LoginPage: implementation }));
import { LoginPage } from './index';

describe('authentication public entry', () => {
  it('exports the original login component without changing the authentication gate', () => {
    expect(LoginPage).toBe(implementation);
  });
});
