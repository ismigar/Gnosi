import { resetApiTestStorage, writeApiTestStorage } from '../../../tests/api-request';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchConfiguration, fetchEditorConfiguration, fetchGraphConfiguration, fetchInterfaceSettings, updateConfiguration } from './configuration';
import { queryClient } from './query-client';


afterEach(() => {
  queryClient.clear();
  resetApiTestStorage();
  vi.unstubAllGlobals();
});


describe('configuration API', () => {
  it('shares simultaneous editor reads and revalidates later openings', async () => {
    let workspaceName = 'first';
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const request = new Request(input);
      expect(new URL(request.url).pathname).toBe('/api/config/editor');
      return Promise.resolve(Response.json({ settings: { workspace_name: workspaceName } }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const [first, second] = await Promise.all([fetchEditorConfiguration(), fetchEditorConfiguration()]);
    expect(first).toEqual(second);
    expect(fetchMock).toHaveBeenCalledOnce();
    workspaceName = 'changed externally';
    expect(await fetchEditorConfiguration()).toEqual({ settings: { workspace_name: 'changed externally' } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps pending editor documents separate for different vaults', async () => {
    const pending: { vault: string | null; resolve: (response: Response) => void }[] = [];
    vi.stubGlobal('fetch', vi.fn<typeof fetch>((input) => {
      const request = new Request(input);
      return new Promise(resolve => { pending.push({ vault: request.headers.get('X-Vault-Id'), resolve }); });
    }));
    writeApiTestStorage('gnosi_active_vault', 'vault-a');
    const first = fetchEditorConfiguration();
    await vi.waitFor(() => { expect(pending).toHaveLength(1); });
    writeApiTestStorage('gnosi_active_vault', 'vault-b');
    const second = fetchEditorConfiguration();
    await vi.waitFor(() => { expect(pending).toHaveLength(2); });
    for (const item of pending) item.resolve(Response.json({ settings: { workspace_name: item.vault } }));
    expect(await first).toEqual({ settings: { workspace_name: 'vault-a' } });
    expect(await second).toEqual({ settings: { workspace_name: 'vault-b' } });
  });

  it('reads only graph preferences for the requested vault', async () => {
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const request = new Request(input);
      expect(new URL(request.url).pathname).toBe('/api/config/graph');
      return Promise.resolve(Response.json({ graph: { color_mode: request.headers.get('X-Vault-Id') } }));
    });
    vi.stubGlobal('fetch', fetchMock);
    writeApiTestStorage('gnosi_active_vault', 'vault-a');
    expect(await fetchGraphConfiguration()).toEqual({ graph: { color_mode: 'vault-a' } });
    writeApiTestStorage('gnosi_active_vault', 'vault-b');
    expect(await fetchGraphConfiguration()).toEqual({ graph: { color_mode: 'vault-b' } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shares the small display preference request across consumers', async () => {
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const request = new Request(input);
      expect(new URL(request.url).pathname).toBe('/api/config/interface');
      return Promise.resolve(Response.json({ language: 'ca', currency: 'EUR' }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const [first, preferences] = await Promise.all([
      fetchInterfaceSettings(),
      fetchInterfaceSettings(),
    ]);

    expect(first.language).toBe('ca');
    expect(preferences.currency).toBe('EUR');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('refreshes display preferences after saving and keeps different vaults separate', async () => {
    let language = 'ca';
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const request = new Request(input);
      return Promise.resolve(Response.json(request.method === 'POST'
        ? { status: 'success', message: 'Configuration updated' }
        : { language }));
    });
    vi.stubGlobal('fetch', fetchMock);

    writeApiTestStorage('gnosi_active_vault', 'vault-a');
    expect((await fetchInterfaceSettings()).language).toBe('ca');
    language = 'fr';
    await updateConfiguration({ settings: { language } });
    expect((await fetchInterfaceSettings()).language).toBe('fr');
    language = 'es';
    writeApiTestStorage('gnosi_active_vault', 'vault-b');
    expect((await fetchInterfaceSettings()).language).toBe('es');
    writeApiTestStorage('gnosi_active_vault', 'vault-a');
    expect((await fetchInterfaceSettings()).language).toBe('fr');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

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
