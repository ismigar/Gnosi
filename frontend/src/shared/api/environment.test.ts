import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchEnvironment, updateEnvironment } from './environment';

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('environment API', () => {
  it('loads masked local settings', async () => {
    const payload = { GROQ_API_KEY: '********', SOFTCATALA_API_URL: 'local' };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchEnvironment()).resolves.toEqual(payload);
  });

  it('updates only explicitly supplied environment settings', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        message: 'Environment variables updated',
        secure_updates: 0,
        status: 'success',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await updateEnvironment({ SOFTCATALA_API_URL: 'http://localhost:8000' });

    const input: RequestInfo | URL | undefined = fetchMock.mock.calls[0]?.[0];
    if (!(input instanceof Request)) throw new Error('Expected a Request instance');
    await expect(input.clone().json()).resolves.toEqual({
      SOFTCATALA_API_URL: 'http://localhost:8000',
    });
  });
});
