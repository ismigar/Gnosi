import { beforeEach, describe, expect, it, vi } from 'vitest';


const mocks = vi.hoisted(() => ({ dashboard: vi.fn() }));

vi.mock('../features/vault/VaultDashboard', () => {
  mocks.dashboard();
  return { default: () => null };
});

import { preloadApplicationRoute } from './routePreload';


beforeEach(() => {
  mocks.dashboard.mockClear();
});


describe('initial route preload', () => {
  it('loads Knowledge for the canonical route', async () => {
    await preloadApplicationRoute('/@principal/knowledge');
    expect(mocks.dashboard).toHaveBeenCalledOnce();
  });

  it('does not load Knowledge for another product route', async () => {
    await preloadApplicationRoute('/@principal/calendar');
    expect(mocks.dashboard).not.toHaveBeenCalled();
  });
});
