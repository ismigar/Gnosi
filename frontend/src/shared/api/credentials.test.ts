import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  deleteCredential,
  fetchCredentials,
  fetchCredentialStatus,
  migrateCredentials,
  saveCredential,
} from './credentials';


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


describe('credentials API', () => {
  it('reads status and mutates a credential without a value-returning endpoint', async () => {
    const statuses = [{
      description: 'API key',
      has_value: true,
      key: 'deepl_api_key',
      name: 'DeepL',
    }];
    const mutation = {
      key: 'deepl_api_key',
      message: 'Credential saved',
      status: 'success',
    };
    const migration = {
      failed: [],
      migrated: ['deepl_api_key'],
      source_modified: false,
      status: 'success',
      total: 1,
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(statuses))
      .mockResolvedValueOnce(Response.json(statuses[0]))
      .mockResolvedValueOnce(Response.json(mutation))
      .mockResolvedValueOnce(Response.json({
        ...mutation,
        message: 'Credential deleted',
      }))
      .mockResolvedValueOnce(Response.json(migration));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchCredentials()).resolves.toEqual(statuses);
    await expect(fetchCredentialStatus('deepl_api_key')).resolves.toEqual(statuses[0]);
    await expect(
      saveCredential({ key: 'deepl_api_key', value: 'fake-secret' }),
    ).resolves.toEqual(mutation);
    await expect(deleteCredential('deepl_api_key')).resolves.toMatchObject({
      message: 'Credential deleted',
    });
    await expect(migrateCredentials()).resolves.toEqual(migration);

    const saveRequest = requestAt(fetchMock.mock.calls, 2);
    expect(saveRequest.method).toBe('POST');
    await expect(saveRequest.json()).resolves.toEqual({
      key: 'deepl_api_key',
      value: 'fake-secret',
    });

    const deleteRequest = requestAt(fetchMock.mock.calls, 3);
    expect(deleteRequest.method).toBe('DELETE');
    expect(new URL(deleteRequest.url).pathname).toBe(
      '/api/credentials/deepl_api_key',
    );
    expect(new URL(requestAt(fetchMock.mock.calls, 4).url).pathname).toBe(
      '/api/credentials/migrate',
    );
  });
});
