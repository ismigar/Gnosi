import { resetApiTestStorage } from '../../test/api-request';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GnosiApiError } from './errors';
import {
  clearPluginHostPageEtag,
  createPluginHostPage,
  exportPluginPackage,
  fetchForUiPlugin,
  fetchPluginAssetText,
  fetchPluginHostPage,
  fetchPluginSettings,
  patchPluginHostPage,
  updatePluginSettings,
  uploadPluginZip,
} from './plugin-runtime';
import {
  addPluginTrustedKey,
  createPluginLlmWikiBrain,
  fetchInstalledPlugins,
  fetchPluginCatalog,
  fetchPluginLlmWikiConfig,
  fetchPluginPermissionsCatalog,
  fetchPluginRegistryUrl,
  fetchPluginState,
  fetchPluginTrustedKeys,
  installPluginFromCatalog,
  removePluginTrustedKey,
  runPluginLlmWikiMaintenance,
  savePluginLlmWikiConfig,
  setPluginLifecycle,
  setPluginPermissions,
  setPluginRegistryUrl,
  submitPluginPackage,
  uninstallPlugin,
} from './plugins';


afterEach(() => {
  clearPluginHostPageEtag('page/one');
  clearPluginHostPageEtag('page/conflict');
  resetApiTestStorage();
  vi.unstubAllGlobals();
});


function recordedRequest(fetchMock: ReturnType<typeof vi.fn>, index: number): Request {
  const input: unknown = fetchMock.mock.calls[index]?.[0];
  if (!(input instanceof Request)) throw new Error('Expected a generated Request');
  return input;
}


describe('plugin API client', () => {
  it('preserves plugin state, lifecycle, settings, and network contracts', async () => {
    const state = {
      builtins: [{ id: 'daily-notes' }],
      disabled: [],
      enabled_builtin: ['daily-notes'],
      enabled_third_party: ['example'],
      granted: {},
      settings: {},
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(state))
      .mockResolvedValueOnce(Response.json(state))
      .mockResolvedValueOnce(Response.json({ settings: { accent: 'violet' } }))
      .mockResolvedValueOnce(Response.json({ settings: { accent: 'blue' } }))
      .mockResolvedValueOnce(
        Response.json({ status: 200, body: 'ok', contentType: 'text/plain' }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    await expect(fetchPluginState(controller.signal)).resolves.toEqual(state);
    await expect(
      setPluginLifecycle('example/plugin', {
        confirm_dependencies: true,
        confirm_disable: false,
        enabled: true,
      }),
    ).resolves.toEqual(state);
    await expect(fetchPluginSettings('example/plugin')).resolves.toEqual({
      settings: { accent: 'violet' },
    });
    await expect(
      updatePluginSettings('example/plugin', { accent: 'blue' }),
    ).resolves.toEqual({ settings: { accent: 'blue' } });
    await expect(
      fetchForUiPlugin('example/plugin', 'https://example.test/data', {
        method: 'POST',
      }),
    ).resolves.toEqual({ status: 200, body: 'ok', contentType: 'text/plain' });

    const stateRequest = recordedRequest(fetchMock, 0);
    expect(new URL(stateRequest.url).pathname).toBe('/api/vault/plugins');
    expect(stateRequest.signal.aborted).toBe(false);

    const lifecycleRequest = recordedRequest(fetchMock, 1);
    expect(new URL(lifecycleRequest.url).pathname).toBe(
      '/api/vault/plugins/example%2Fplugin/lifecycle',
    );
    expect(lifecycleRequest.method).toBe('POST');
    await expect(lifecycleRequest.json()).resolves.toEqual({
      confirm_dependencies: true,
      confirm_disable: false,
      enabled: true,
    });

    const settingsRequest = recordedRequest(fetchMock, 3);
    expect(settingsRequest.method).toBe('PUT');
    await expect(settingsRequest.json()).resolves.toEqual({
      settings: { accent: 'blue' },
    });

    const networkRequest = recordedRequest(fetchMock, 4);
    await expect(networkRequest.json()).resolves.toEqual({
      opts: { method: 'POST' },
      url: 'https://example.test/data',
    });
  });

  it('preserves host page payloads and successful ETag behavior', async () => {
    const page = {
      content: 'Original',
      etag: 'etag-1',
      id: 'page/one',
      metadata: {},
      title: 'Page',
    };
    const created = { etag: 'created-etag', id: 'created', title: 'Created' };
    const saved = { etag: 'etag-3', id: 'page/one', title: 'Page' };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(page))
      .mockResolvedValueOnce(Response.json(created))
      .mockResolvedValueOnce(Response.json(saved));
    vi.stubGlobal('fetch', fetchMock);
    const invalidated = vi.fn<(event: Event) => void>();
    const conflicted = vi.fn<(event: Event) => void>();
    window.addEventListener('gnosi:invalidatePreview', invalidated);
    window.addEventListener('pageEtagConflict', conflicted);

    try {
      await expect(fetchPluginHostPage('page/one')).resolves.toEqual(page);
      await expect(
        createPluginHostPage({
          content: '',
          metadata: {},
          parent_id: 'parent',
          title: 'Created',
        }),
      ).resolves.toEqual(created);
      await expect(
        patchPluginHostPage('page/one', { content: 'Updated' }),
      ).resolves.toEqual(saved);
    } finally {
      window.removeEventListener('gnosi:invalidatePreview', invalidated);
      window.removeEventListener('pageEtagConflict', conflicted);
    }

    const createRequest = recordedRequest(fetchMock, 1);
    await expect(createRequest.json()).resolves.toEqual({
      content: '',
      metadata: {},
      parent_id: 'parent',
      title: 'Created',
    });

    const firstSave = recordedRequest(fetchMock, 2);
    await expect(firstSave.json()).resolves.toEqual({
      content: 'Updated',
      expected_etag: 'etag-1',
    });
    expect(invalidated).toHaveBeenCalledTimes(1);
    expect(conflicted).not.toHaveBeenCalled();
  });

  it('broadcasts the existing conflict event without replaying the mutation', async () => {
    const conflict = {
      detail: {
        current_etag: 'etag-2',
        error: 'etag_mismatch',
        expected_etag: 'etag-1',
        message: 'Page changed',
      },
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(() =>
        Promise.resolve(Response.json(conflict, { status: 409 })),
      );
    vi.stubGlobal('fetch', fetchMock);
    const conflicted = vi.fn<(event: Event) => void>();
    window.addEventListener('pageEtagConflict', conflicted);

    try {
      await expect(
        patchPluginHostPage(
          'page/conflict',
          { content: 'Updated' },
          { knownEtag: 'etag-1' },
        ),
      ).rejects.toMatchObject({ status: 409 });
    } finally {
      window.removeEventListener('pageEtagConflict', conflicted);
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(conflicted).toHaveBeenCalledTimes(1);
    const event = conflicted.mock.calls[0]?.[0];
    expect(event).toBeInstanceOf(CustomEvent);
    expect((event as CustomEvent).detail).toMatchObject({
      currentEtag: 'etag-2',
      expectedEtag: 'etag-1',
      pageId: 'page/conflict',
    });
  });

  it('preserves plugin catalog and management URLs, methods, and payloads', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ plugins: [] }))
      .mockResolvedValueOnce(
        Response.json({ apiVersion: 2, permissions: { settings: 'Configure' } }),
      )
      .mockResolvedValueOnce(Response.json({ catalog: [] }))
      .mockResolvedValueOnce(Response.json({ keys: [] }))
      .mockResolvedValueOnce(Response.json({ url: 'https://registry.test/index.json' }))
      .mockImplementation(() => Promise.resolve(Response.json({ ok: true })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchInstalledPlugins()).resolves.toEqual({ plugins: [] });
    await expect(fetchPluginPermissionsCatalog()).resolves.toEqual({
      apiVersion: 2,
      permissions: { settings: 'Configure' },
    });
    await expect(fetchPluginCatalog()).resolves.toEqual({ catalog: [] });
    await expect(fetchPluginTrustedKeys()).resolves.toEqual({ keys: [] });
    await expect(fetchPluginRegistryUrl()).resolves.toEqual({
      url: 'https://registry.test/index.json',
    });
    await expect(
      setPluginRegistryUrl('https://registry.test/next.json'),
    ).resolves.toBeUndefined();
    await expect(
      addPluginTrustedKey({ name: 'publisher', public_key: 'base64' }),
    ).resolves.toBeUndefined();
    await expect(removePluginTrustedKey('publisher/name')).resolves.toBeUndefined();
    await expect(
      setPluginPermissions('example/plugin', ['settings', 'network']),
    ).resolves.toBeUndefined();
    await expect(installPluginFromCatalog('catalog-plugin')).resolves.toBeUndefined();
    await expect(uninstallPlugin('example/plugin')).resolves.toBeUndefined();
    await expect(submitPluginPackage('example/plugin')).resolves.toBeUndefined();

    const registryRequest = recordedRequest(fetchMock, 5);
    expect(registryRequest.method).toBe('PUT');
    await expect(registryRequest.json()).resolves.toEqual({
      url: 'https://registry.test/next.json',
    });

    const trustRequest = recordedRequest(fetchMock, 6);
    expect(trustRequest.method).toBe('POST');
    await expect(trustRequest.json()).resolves.toEqual({
      name: 'publisher',
      public_key: 'base64',
    });

    const removeRequest = recordedRequest(fetchMock, 7);
    expect(removeRequest.method).toBe('DELETE');
    expect(new URL(removeRequest.url).pathname).toBe(
      '/api/vault/plugins/trust/publisher%2Fname',
    );

    const permissionRequest = recordedRequest(fetchMock, 8);
    await expect(permissionRequest.json()).resolves.toEqual({
      permissions: ['settings', 'network'],
    });

    const catalogInstallRequest = recordedRequest(fetchMock, 9);
    await expect(catalogInstallRequest.json()).resolves.toEqual({
      id: 'catalog-plugin',
    });
    expect(recordedRequest(fetchMock, 10).method).toBe('DELETE');
    expect(recordedRequest(fetchMock, 11).method).toBe('POST');
  });

  it('preserves LLM Wiki configuration, maintenance query, and create body', async () => {
    const settings = {
      brain: { table_id: 'brain', name: 'Brain', configured: true },
      capabilities: {
        ocr: true,
        ocr_missing_languages: [],
        streaming: true,
        transcription: true,
      },
      config: {
        brain_table_id: 'brain',
        source_tables: [{ table_id: 'resources' }],
      },
      index_options: {},
      validation: { valid: true },
    };
    const maintenance = {
      indexes: {},
      lint: { counts: { orphans: 0 }, note_count: 1 },
      suggestions_pending: 2,
      suggestions_queued: 1,
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(settings))
      .mockResolvedValueOnce(Response.json(settings))
      .mockResolvedValueOnce(Response.json(maintenance))
      .mockResolvedValueOnce(Response.json(settings));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchPluginLlmWikiConfig()).resolves.toEqual(settings);
    await expect(
      savePluginLlmWikiConfig({
        brain_table_id: 'brain',
        source_tables: [{ table_id: 'resources' }],
        ui_locale: 'ca',
      }),
    ).resolves.toEqual(settings);
    await expect(runPluginLlmWikiMaintenance(true)).resolves.toEqual(maintenance);
    await expect(createPluginLlmWikiBrain('ca')).resolves.toEqual(settings);

    const saveRequest = recordedRequest(fetchMock, 1);
    expect(saveRequest.method).toBe('PUT');
    await expect(saveRequest.json()).resolves.toEqual({
      brain_table_id: 'brain',
      source_tables: [{ table_id: 'resources' }],
      ui_locale: 'ca',
    });

    const maintenanceUrl = new URL(recordedRequest(fetchMock, 2).url);
    expect(maintenanceUrl.searchParams.get('semantic')).toBe('true');

    const createRequest = recordedRequest(fetchMock, 3);
    await expect(createRequest.json()).resolves.toEqual({ ui_locale: 'ca' });
  });

  it('uses specialized transports only for assets, upload, and export', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('export const ready = true;'))
      .mockResolvedValueOnce(Response.json({ installed: { id: 'example' } }))
      .mockResolvedValueOnce(
        new Response('zip-data', {
          headers: { 'Content-Type': 'application/zip' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchPluginAssetText('example/plugin', 'dist/main.js'),
    ).resolves.toBe('export const ready = true;');
    const file = new File(['zip'], 'plugin.zip', { type: 'application/zip' });
    await expect(uploadPluginZip(file)).resolves.toBeUndefined();
    const exported = await exportPluginPackage('example/plugin');
    const exportedText = new TextDecoder().decode(await exported.arrayBuffer());
    expect(exportedText).toBe('zip-data');

    const [assetInput, assetInit] = fetchMock.mock.calls[0] || [];
    expect(assetInput).toBe(
      '/api/vault/plugins/example%2Fplugin/asset/dist/main.js',
    );
    expect(assetInit?.method).toBe('GET');

    const [uploadInput, uploadInit] = fetchMock.mock.calls[1] || [];
    expect(uploadInput).toBe('/api/vault/plugins/install');
    expect(uploadInit?.method).toBe('POST');
    expect(uploadInit?.headers).not.toEqual(
      expect.objectContaining({ 'Content-Type': 'multipart/form-data' }),
    );
    if (!(uploadInit?.body instanceof FormData)) {
      throw new Error('Expected plugin upload FormData');
    }
    expect(uploadInit.body.get('file')).toBe(file);

    const [exportInput, exportInit] = fetchMock.mock.calls[2] || [];
    expect(exportInput).toBe('/api/vault/plugins/example%2Fplugin/export');
    expect(exportInit?.method).toBe('POST');
    expect(exportInit?.body).toBe('{}');
    expect(new Headers(exportInit?.headers).get('Content-Type')).toBe(
      'application/json',
    );
  });

  it('normalizes JSON error details without losing status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({ detail: 'Plugin permission denied' }, { status: 403 }),
      ),
    );

    const request = fetchForUiPlugin(
      'example',
      'https://example.test/private',
    );

    await expect(request).rejects.toBeInstanceOf(GnosiApiError);
    await expect(request).rejects.toMatchObject({
      message: 'Plugin permission denied',
      status: 403,
    });
  });
});
