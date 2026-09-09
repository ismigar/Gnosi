import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applicationRouteLoaders, preloadApplicationRoute } from './routePreload';

beforeEach(() => {
  for (const key of Object.keys(applicationRouteLoaders) as (keyof typeof applicationRouteLoaders)[]) {
    vi.spyOn(applicationRouteLoaders, key).mockImplementation(
      vi.fn().mockResolvedValue({ default: () => null }),
    );
  }
});

describe('application route preload', () => {
  it.each([
    ['/@principal/knowledge', 'knowledge'],
    ['/vault/page/123', 'knowledge'],
    ['/dashboard?tab=history', 'dashboard'],
    ['/@principal/calendar', 'calendar'],
    ['/reader', 'reader'],
    ['/@principal/mail', 'mail'],
    ['/graph', 'graph'],
    ['/notebooks/123', 'notebooks'],
    ['/literature', 'resources'],
    ['/scheduler', 'automations'],
    ['/social-dashboard', 'social'],
    ['/@principal/social/compose/draft', 'composer'],
    ['/composer', 'composer'],
    ['/media', 'media'],
    ['/contacts', 'contacts'],
    ['/planning', 'planning'],
    ['/@principal/knowledge/document?file=123', 'document'],
    ['/vault/pdf', 'document'],
  ] as const)('preloads only the screen for %s', async (path, selected) => {
    await preloadApplicationRoute(path);
    for (const [key, loader] of Object.entries(applicationRouteLoaders)) {
      expect(loader).toHaveBeenCalledTimes(key === selected ? 1 : 0);
    }
  });

  it.each(['/', '/missing', '/@principal/toString'])('leaves unrelated path %s alone', async path => {
    await preloadApplicationRoute(path);
    for (const loader of Object.values(applicationRouteLoaders)) {
      expect(loader).not.toHaveBeenCalled();
    }
  });

  it('allows startup to continue and navigation to retry after a failed preload', async () => {
    vi.mocked(applicationRouteLoaders.knowledge).mockRejectedValueOnce(new Error('Offline'));
    await expect(preloadApplicationRoute('/vault')).resolves.toBeUndefined();
    await preloadApplicationRoute('/vault');
    expect(applicationRouteLoaders.knowledge).toHaveBeenCalledTimes(2);
  });
});
