import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchConfiguration, updateConfiguration } from './configuration';


afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});


describe('configuration API', () => {
  it('loads the sanitized configuration document', async () => {
    const payload = { graph: { visible_tables: ['notes'] }, settings: {} };
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload)),
    );

    await expect(fetchConfiguration()).resolves.toEqual(payload);
  });

  it('sends only the partial configuration supplied by the caller', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ message: 'Configuration updated', status: 'success' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await updateConfiguration({
      graph: { sources_initialized: true, visible_tables: ['notes'] },
    });

    const input: RequestInfo | URL | undefined = fetchMock.mock.calls[0]?.[0];
    if (!(input instanceof Request)) throw new Error('Expected a Request instance');
    await expect(input.clone().json()).resolves.toEqual({
      graph: { sources_initialized: true, visible_tables: ['notes'] },
    });
  });
});
