import { resetApiTestStorage } from '../../../tests/api-request';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchIdentity, saveIdentity } from './identity';

afterEach(() => {
  resetApiTestStorage();
  vi.unstubAllGlobals();
});

describe('identity API', () => {
  it('loads the typed vault-local identity profile', async () => {
    const payload = { email: 'ada@example.test', full_name: 'Ada Lovelace' };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchIdentity()).resolves.toEqual(payload);
    expect(fetchMock.mock.calls[0]?.[0]).toBeInstanceOf(Request);
  });

  it('saves identity fields through the generated body contract', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ status: 'success' }));
    vi.stubGlobal('fetch', fetchMock);

    await saveIdentity({ email: 'ada@example.test', full_name: 'Ada Lovelace' });

    const input: RequestInfo | URL | undefined = fetchMock.mock.calls[0]?.[0];
    if (!(input instanceof Request)) throw new Error('Expected a Request instance');
    expect(input.method).toBe('POST');
    await expect(input.clone().json()).resolves.toEqual({
      address: '',
      city: '',
      dni_nie: '',
      email: 'ada@example.test',
      first_name: '',
      full_name: 'Ada Lovelace',
      last_name: '',
      notes: '',
      phone: '',
      zip_code: '',
    });
  });
});
