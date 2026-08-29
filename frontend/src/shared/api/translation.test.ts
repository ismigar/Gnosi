import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DRUPAL_SYNC_TIMEOUT_MS,
  syncDrupalRow,
  translateVaultPage,
  translateVaultRow,
  translateVaultRows,
  type SyncDrupalRowInput,
  type SyncDrupalRowResult,
  type TranslatePageInput,
  type TranslatePageResult,
  type TranslateRowInput,
  type TranslateRowResult,
  type TranslateRowsInput,
  type TranslateRowsResult,
} from './translation';


afterEach(() => {
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});


interface RecordedFetchMock {
  readonly mock: {
    readonly calls: ReadonlyArray<readonly [RequestInfo | URL, RequestInit?]>;
  };
}


function requestAt(fetchMock: RecordedFetchMock, index = 0): Request {
  const input = fetchMock.mock.calls[index]?.[0];
  if (!(input instanceof Request)) throw new Error('Expected a Request instance');
  return input;
}


describe('translation and Drupal API', () => {
  it('sends all four operations as POST requests with unchanged payloads', async () => {
    const rowInput: TranslateRowInput = {
      button_action: 'translate_custom_fields',
      item_id: 'row-1',
      target_languages: ['ca', 'en'],
    };
    const rowsInput: TranslateRowsInput = {
      button_action: 'translate_row',
      item_ids: ['row-1', 'row-2'],
      target_languages: ['fr'],
    };
    const pageInput: TranslatePageInput = {
      button_action: 'translate_page',
      page_id: 'page-1',
      target_languages: ['de'],
    };
    const drupalInput: SyncDrupalRowInput = {
      button_action: 'sync_drupal',
      item_id: 'row-1',
      push_media: true,
      scope: 'lang_only',
    };
    const rowResult: TranslateRowResult = {
      created: [],
      item_id: 'row-1',
      skipped: [],
      source_lang: 'es',
      status: 'ok',
      updated: [],
    };
    const rowsResult: TranslateRowsResult = {
      count: 2,
      errors: [],
      results: [],
      status: 'ok',
    };
    const pageResult: TranslatePageResult = {
      created: [],
      page_id: 'page-1',
      skipped: [],
      source_lang: 'ca',
      status: 'ok',
      updated: [],
    };
    const drupalResult: SyncDrupalRowResult = {
      created: false,
      item_id: 'row-1',
      languages: ['ca'],
      media_pushed: true,
      nid: 42,
      scope: 'lang_only',
      skipped_fields: [],
      source_lang: 'ca',
      status: 'ok',
      translations: [{ status: 'ok' }],
      url: 'https://example.test/node/42',
      uuid: 'drupal-uuid',
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(rowResult))
      .mockResolvedValueOnce(Response.json(rowsResult))
      .mockResolvedValueOnce(Response.json(pageResult))
      .mockResolvedValueOnce(Response.json(drupalResult));
    vi.stubGlobal('fetch', fetchMock);

    await expect(translateVaultRow(rowInput)).resolves.toEqual(rowResult);
    await expect(translateVaultRows(rowsInput)).resolves.toEqual(rowsResult);
    await expect(translateVaultPage(pageInput)).resolves.toEqual(pageResult);
    await expect(syncDrupalRow(drupalInput)).resolves.toEqual(drupalResult);

    expect(
      fetchMock.mock.calls.map((_, index) => {
        const request = requestAt(fetchMock, index);
        return [request.method, new URL(request.url).pathname];
      }),
    ).toEqual([
      ['POST', '/api/vault/skills/translate-row'],
      ['POST', '/api/vault/skills/translate-rows'],
      ['POST', '/api/vault/skills/translate-page'],
      ['POST', '/api/vault/skills/sync-drupal-row'],
    ]);

    await expect(requestAt(fetchMock, 0).clone().json()).resolves.toEqual(
      rowInput,
    );
    await expect(requestAt(fetchMock, 1).clone().json()).resolves.toEqual(
      rowsInput,
    );
    await expect(requestAt(fetchMock, 2).clone().json()).resolves.toEqual(
      pageInput,
    );
    await expect(requestAt(fetchMock, 3).clone().json()).resolves.toEqual(
      drupalInput,
    );
  });

  it('normalizes backend detail errors through the shared API boundary', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          { detail: 'Translation provider unavailable' },
          { status: 503, statusText: 'Service Unavailable' },
        ),
      ),
    );

    await expect(translateVaultRow({
      button_action: 'translate_row',
      item_id: 'row-1',
      target_languages: ['en'],
    })).rejects.toMatchObject({
      message: 'Translation provider unavailable',
      name: 'GnosiApiError',
      payload: { detail: 'Translation provider unavailable' },
      status: 503,
    });
  });

  it('keeps the Drupal sync timeout at 180 seconds', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const request = input instanceof Request ? input : new Request(input);
      return new Promise<Response>((_resolve, reject) => {
        const rejectWithAbortReason = () => {
          reject(new Error('Request aborted'));
        };
        if (request.signal.aborted) rejectWithAbortReason();
        else request.signal.addEventListener('abort', rejectWithAbortReason, {
          once: true,
        });
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const pending = syncDrupalRow({
      button_action: 'sync_drupal',
      item_id: 'row-1',
      push_media: false,
      scope: 'all',
    });
    const rejection = expect(pending).rejects.toThrow(
      `timeout of ${String(DRUPAL_SYNC_TIMEOUT_MS)}ms exceeded`,
    );

    await vi.advanceTimersByTimeAsync(DRUPAL_SYNC_TIMEOUT_MS);
    await rejection;
  });
});
