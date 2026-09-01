import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createShareLink,
  fetchSharedPage,
  fetchShareLinks,
  revokeShareLink,
} from './sharing';


afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});


function requestAt(
  calls: [RequestInfo | URL, RequestInit?][],
  index: number,
): Request {
  const call = calls[index];
  if (!call) throw new Error(`Expected fetch call ${String(index)}`);
  const [input, init] = call;
  return input instanceof Request
    ? input
    : new Request(new URL(String(input), window.location.origin), init);
}


describe('sharing API', () => {
  it('creates, lists, revokes and anonymously reads share links', async () => {
    const link = {
      created_at: null,
      created_by: null,
      expires_at: null,
      page_id: 'page-1',
      permission: 'view',
      revoked: false,
      token: 'share-1',
      url: '/s/share-1',
    };
    const shared = {
      page: { content: '# Shared', id: 'page-1', metadata: {}, title: 'Shared' },
      permission: 'view',
      token: 'share-1',
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(link))
      .mockResolvedValueOnce(Response.json({ shares: [link] }))
      .mockResolvedValueOnce(Response.json({ status: 'revoked', token: 'share-1' }))
      .mockResolvedValueOnce(Response.json(shared));
    vi.stubGlobal('fetch', fetchMock);

    await createShareLink('page-1');
    await fetchShareLinks('page-1');
    await revokeShareLink('share-1');
    await fetchSharedPage('share-1');

    await expect(requestAt(fetchMock.mock.calls, 0).json()).resolves.toEqual({
      permission: 'view',
    });
    expect(new URL(requestAt(fetchMock.mock.calls, 1).url).pathname).toBe(
      '/api/vault/pages/page-1/shares',
    );
    expect(requestAt(fetchMock.mock.calls, 2).method).toBe('DELETE');
    expect(new URL(requestAt(fetchMock.mock.calls, 3).url).pathname).toBe(
      '/api/share/share-1',
    );
  });
});
