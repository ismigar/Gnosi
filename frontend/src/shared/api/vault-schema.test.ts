import { resetApiTestStorage } from '../../test/api-request';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fetchAvailableAgentSkills,
  fetchDrupalContentTypes,
  fetchDrupalFields,
  fetchOptionCatalogs,
  fetchTableOptionUsage,
  fetchVirtualFields,
  generateButtonAction,
  matchDrupalRows,
  removeTableOption,
  renameTableOption,
  saveVaultFolderSchema,
  updateOptionCatalog,
} from './vault-schema';


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


describe('Vault schema API', () => {
  it('loads skills and generates an action with the exact JSON body', async () => {
    const catalog = {
      catalog_revision: 'rev-1',
      issues: [],
      skills: [{ id: 'core.example', name: 'Example' }],
    };
    const generated = {
      result: {
        button_action: 'set_fields',
        button_config: { assignments: [] },
        button_label: 'Set status',
      },
      status: 'ok',
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(catalog))
      .mockResolvedValueOnce(Response.json(generated));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchAvailableAgentSkills()).resolves.toEqual(catalog);
    await expect(
      generateButtonAction({
        fields: [{ name: 'Status', type: 'status' }],
        prompt: 'Mark it as done',
      }),
    ).resolves.toEqual(generated);

    const catalogRequest = requestAt(fetchMock.mock.calls, 0);
    expect(catalogRequest.method).toBe('GET');
    expect(new URL(catalogRequest.url).pathname).toBe('/api/ai/skills');

    const generationRequest = requestAt(fetchMock.mock.calls, 1);
    expect(generationRequest.method).toBe('POST');
    expect(new URL(generationRequest.url).pathname).toBe(
      '/api/vault/skills/generate-button-action',
    );
    await expect(generationRequest.json()).resolves.toEqual({
      fields: [{ name: 'Status', type: 'status' }],
      prompt: 'Mark it as done',
    });
  });


  it('preserves option catalog paths, query parameters, and mutation bodies', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ catalogs: { status: [] } }))
      .mockResolvedValueOnce(Response.json({ computers: [] }))
      .mockResolvedValueOnce(Response.json({ counts: { Done: 2 } }))
      .mockResolvedValueOnce(Response.json({ files_changed: 2, status: 'ok' }))
      .mockResolvedValueOnce(Response.json({ files_changed: 1, status: 'ok' }))
      .mockResolvedValueOnce(
        Response.json({ name: 'Shared status', options: [], status: 'ok' }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await fetchOptionCatalogs();
    await fetchVirtualFields();
    await fetchTableOptionUsage('table/one', 'field one');
    await renameTableOption('table/one', 'field one', 'Todo', 'Done');
    await removeTableOption('table/one', 'field one', 'Blocked');
    await updateOptionCatalog('Shared status', [
      { color: 'green', name: 'Done' },
    ]);

    expect(new URL(requestAt(fetchMock.mock.calls, 0).url).pathname).toBe(
      '/api/vault/option-catalogs',
    );
    expect(new URL(requestAt(fetchMock.mock.calls, 1).url).pathname).toBe(
      '/api/vault/virtual-fields',
    );

    const usage = new URL(requestAt(fetchMock.mock.calls, 2).url);
    expect(usage.pathname).toBe(
      '/api/vault/tables/table%2Fone/options/usage',
    );
    expect(usage.searchParams.get('field_id')).toBe('field one');

    const rename = requestAt(fetchMock.mock.calls, 3);
    expect(rename.method).toBe('POST');
    expect(new URL(rename.url).pathname).toBe(
      '/api/vault/tables/table%2Fone/options/rename',
    );
    await expect(rename.json()).resolves.toEqual({
      field_id: 'field one',
      new: 'Done',
      old: 'Todo',
    });

    const remove = requestAt(fetchMock.mock.calls, 4);
    await expect(remove.json()).resolves.toEqual({
      field_id: 'field one',
      value: 'Blocked',
    });

    const catalog = requestAt(fetchMock.mock.calls, 5);
    expect(catalog.method).toBe('PUT');
    expect(new URL(catalog.url).pathname).toBe(
      '/api/vault/option-catalogs/Shared%20status',
    );
    await expect(catalog.json()).resolves.toEqual({
      options: [{ color: 'green', name: 'Done' }],
    });
  });


  it('preserves Drupal requests and schema autosave query/body', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ counts: { matched: 1 }, status: 'ok' }),
      )
      .mockResolvedValueOnce(
        Response.json({
          content_types: [{ label: 'Article', machine: 'article', uuid: 'u1' }],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          bundle: 'article/news',
          fields: [{ field_name: 'title', field_type: 'string', label: 'Title' }],
        }),
      )
      .mockResolvedValueOnce(Response.json({ status: 'success' }));
    vi.stubGlobal('fetch', fetchMock);

    await matchDrupalRows('table-1');
    await fetchDrupalContentTypes();
    await fetchDrupalFields('article/news');
    await saveVaultFolderSchema('BD/News', {
      Status: 'status',
      Status_config: { options: ['Draft'] },
    });

    const match = requestAt(fetchMock.mock.calls, 0);
    await expect(match.json()).resolves.toEqual({
      dry_run: false,
      table_id: 'table-1',
    });

    const types = requestAt(fetchMock.mock.calls, 1);
    expect(new URL(types.url).pathname).toBe(
      '/api/vault/drupal/content-types',
    );

    const fields = requestAt(fetchMock.mock.calls, 2);
    expect(new URL(fields.url).pathname).toBe(
      '/api/vault/drupal/content-types/article%2Fnews/fields',
    );

    const save = requestAt(fetchMock.mock.calls, 3);
    const saveUrl = new URL(save.url);
    expect(save.method).toBe('POST');
    expect(saveUrl.pathname).toBe('/api/vault/schema');
    expect(saveUrl.searchParams.get('folder')).toBe('BD/News');
    await expect(save.json()).resolves.toEqual({
      Status: 'status',
      Status_config: { options: ['Draft'] },
    });
  });
});
