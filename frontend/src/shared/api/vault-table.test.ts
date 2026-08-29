import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiClient } from './client';
import { clearPageEtag } from './page-etag';
import {
  createVaultTablePage,
  executeVaultTableButtonAction,
  patchVaultTablePage,
} from './vault-table';


afterEach(() => {
  clearPageEtag('page-1');
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


describe('VaultTable API', () => {
  it('creates a row with the exact historical wire payload', async () => {
    const created = {
      content: '',
      etag: 'etag-created',
      folder: '',
      id: 'page-1',
      message: 'Page created',
      metadata: { table_id: 'table-1' },
      status: 'ok',
      title: 'New row',
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json(created));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      createVaultTablePage({
        content: '',
        metadata: { table_id: 'table-1' },
        parent_id: 'parent-1',
        title: 'New row',
      }),
    ).resolves.toEqual(created);

    const request = requestAt(fetchMock.mock.calls, 0);
    expect(request.method).toBe('POST');
    expect(new URL(request.url).pathname).toBe('/api/vault/pages');
    await expect(request.json()).resolves.toEqual({
      content: '',
      metadata: { table_id: 'table-1' },
      parent_id: 'parent-1',
      title: 'New row',
    });
  });

  it('patches a cell through the canonical ETag middleware', async () => {
    const loaded = {
      content: '',
      etag: 'etag-current',
      folder: '',
      id: 'page-1',
      metadata: {},
      title: 'Row',
    };
    const patched = {
      ...loaded,
      etag: 'etag-next',
      message: 'Page patched',
      metadata: { Status: 'Done' },
      status: 'ok',
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(loaded))
      .mockResolvedValueOnce(Response.json(patched));
    vi.stubGlobal('fetch', fetchMock);

    await apiClient.GET('/api/vault/pages/{page_id}', {
      params: { path: { page_id: 'page-1' } },
    });
    await expect(
      patchVaultTablePage('page-1', { metadata: { Status: 'Done' } }),
    ).resolves.toEqual(patched);

    const request = requestAt(fetchMock.mock.calls, 1);
    expect(request.method).toBe('PATCH');
    expect(new URL(request.url).pathname).toBe('/api/vault/pages/page-1');
    await expect(request.json()).resolves.toEqual({
      expected_etag: 'etag-current',
      metadata: { Status: 'Done' },
    });
  });

  it('executes button actions with exact payload, abort signal and error detail', async () => {
    const succeeded = { note_id: 'page-1', status: 'ok', value: 'Summary' };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(succeeded))
      .mockResolvedValueOnce(
        Response.json({ detail: 'Skill unavailable' }, { status: 400 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    await expect(
      executeVaultTableButtonAction(
        {
          button_action: 'ai_prompt',
          button_config: { prompt: 'Summarize' },
          note_id: 'page-1',
        },
        controller.signal,
      ),
    ).resolves.toEqual(succeeded);

    const request = requestAt(fetchMock.mock.calls, 0);
    expect(request.method).toBe('POST');
    expect(new URL(request.url).pathname).toBe(
      '/api/vault/skills/execute-button-action',
    );
    await expect(request.json()).resolves.toEqual({
      button_action: 'ai_prompt',
      button_config: { prompt: 'Summarize' },
      note_id: 'page-1',
    });
    controller.abort();
    expect(request.signal.aborted).toBe(true);

    await expect(
      executeVaultTableButtonAction({
        button_action: 'run_skill',
        button_config: { skill_id: 'missing' },
        note_id: 'page-1',
      }),
    ).rejects.toMatchObject({ message: 'Skill unavailable', status: 400 });
  });
});
