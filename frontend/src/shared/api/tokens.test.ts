import { resetApiTestStorage } from '../../test/api-request';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApiToken, fetchApiTokens, revokeApiToken } from './tokens';


afterEach(() => {
  resetApiTestStorage();
  vi.unstubAllGlobals();
});


function requestAt(calls: [RequestInfo | URL, RequestInit?][], index: number): Request {
  const call = calls[index];
  if (!call) throw new Error(`Expected fetch call ${String(index)}`);
  const [input, init] = call;
  return input instanceof Request
    ? input
    : new Request(new URL(String(input), window.location.origin), init);
}


describe('API tokens', () => {
  it('lists, creates and revokes personal access tokens', async () => {
    const summary = {
      created_at: '2026-08-29T00:00:00Z',
      id: 'token-1',
      last_used_at: null,
      name: 'Web clipper',
      prefix: 'gnosi_pat_abcd',
      scopes: 'read,write',
    };
    const created = { ...summary, token: 'gnosi_pat_secret' };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json([summary]))
      .mockResolvedValueOnce(Response.json(created))
      .mockResolvedValueOnce(Response.json({ id: 'token-1', status: 'revoked' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchApiTokens()).resolves.toEqual([summary]);
    await expect(createApiToken('Web clipper')).resolves.toEqual(created);
    await expect(revokeApiToken('token-1')).resolves.toEqual({
      id: 'token-1',
      status: 'revoked',
    });

    expect(requestAt(fetchMock.mock.calls, 0).method).toBe('GET');
    await expect(requestAt(fetchMock.mock.calls, 1).clone().json()).resolves.toEqual({
      name: 'Web clipper',
      scopes: 'read,write',
    });
    expect(requestAt(fetchMock.mock.calls, 2).method).toBe('DELETE');
    expect(new URL(requestAt(fetchMock.mock.calls, 2).url).pathname).toBe(
      '/api/tokens/token-1',
    );
  });
});
