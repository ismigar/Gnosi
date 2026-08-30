import { resetApiTestStorage } from '../../../tests/api-request';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fetchSocialFeed,
  fetchSocialNetworks,
  scheduleSocialPosts,
} from './social';


afterEach(() => {
  resetApiTestStorage();
  vi.unstubAllGlobals();
});


describe('social API', () => {
  it('loads configured networks through the generated client', async () => {
    const networks = [
      {
        char_limit: 500,
        configured: true,
        enabled: true,
        icon: 'mastodon',
        id: 'mastodon',
        implemented: true,
        name: 'Mastodon',
      },
    ];
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json(networks)),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchSocialNetworks()).resolves.toEqual(networks);
    const request = fetchMock.mock.calls[0]?.[0];
    expect(request).toBeInstanceOf(Request);
    if (!(request instanceof Request)) throw new Error('Expected a Request instance');
    expect(new URL(request.url).pathname).toBe('/api/social/networks');
  });


  it('encodes the stream path and bounded feed query', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json([])),
    );
    vi.stubGlobal('fetch', fetchMock);

    await fetchSocialFeed('mastodon/home', 10);
    const request = fetchMock.mock.calls[0]?.[0];
    expect(request).toBeInstanceOf(Request);
    if (!(request instanceof Request)) throw new Error('Expected a Request instance');
    const url = new URL(request.url);
    expect(url.pathname).toBe('/api/social/feed/mastodon%2Fhome');
    expect(url.searchParams.get('limit')).toBe('10');
  });


  it('schedules per-network posts with the typed request shape', async () => {
    const result = {
      id: 'post-1',
      networks: ['mastodon'],
      scheduled_time: '2030-01-02T10:00:00Z',
      status: 'scheduled',
    };
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json(result)),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      scheduleSocialPosts({
        posts: { mastodon: { text: 'Hello' } },
        scheduled_time: '2030-01-02T10:00:00Z',
      }),
    ).resolves.toEqual(result);
    const request = fetchMock.mock.calls[0]?.[0];
    expect(request).toBeInstanceOf(Request);
    if (!(request instanceof Request)) throw new Error('Expected a Request instance');
    expect(request.method).toBe('POST');
    await expect(request.clone().json()).resolves.toEqual({
      posts: { mastodon: { text: 'Hello' } },
      scheduled_time: '2030-01-02T10:00:00Z',
      source_title: '',
    });
  });
});
