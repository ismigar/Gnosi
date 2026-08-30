import { resetApiTestStorage } from '../../../tests/api-request';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fetchVaultPageHistory,
  fetchVaultPageHistoryVersion,
  purgeVaultPageHistory,
  restoreVaultPageHistoryVersion,
} from './vault-history';


afterEach(() => {
  resetApiTestStorage();
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


describe('vault page history API', () => {
  it('lists, reads, restores and purges immutable versions', async () => {
    const versions = [{ id: '20260829_040000', size: 42, timestamp: '2026-08-29' }];
    const content = {
      content: '# Previous',
      id: 'page-1',
      metadata: {},
      version_id: '20260829_040000',
    };
    const mutation = { message: 'ok', status: 'success' };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(versions))
      .mockResolvedValueOnce(Response.json(content))
      .mockResolvedValueOnce(Response.json(mutation))
      .mockResolvedValueOnce(Response.json(mutation));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchVaultPageHistory('page-1')).resolves.toEqual(versions);
    await expect(
      fetchVaultPageHistoryVersion('page-1', '20260829_040000'),
    ).resolves.toEqual(content);
    await expect(
      restoreVaultPageHistoryVersion('page-1', '20260829_040000'),
    ).resolves.toEqual(mutation);
    await expect(purgeVaultPageHistory('page-1')).resolves.toEqual(mutation);

    expect(new URL(requestAt(fetchMock.mock.calls, 0).url).pathname).toBe(
      '/api/vault/pages/page-1/history',
    );
    expect(new URL(requestAt(fetchMock.mock.calls, 1).url).pathname).toBe(
      '/api/vault/pages/page-1/history/20260829_040000',
    );
    expect(requestAt(fetchMock.mock.calls, 2).method).toBe('POST');
    expect(requestAt(fetchMock.mock.calls, 3).method).toBe('DELETE');
  });
});
