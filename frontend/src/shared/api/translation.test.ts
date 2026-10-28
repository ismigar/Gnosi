import { resetApiTestStorage } from '../../../tests/api-request';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  translateVaultPage,
  translateVaultRow,
  translateVaultRows,
  type TranslatePageInput,
  type TranslatePageResult,
  type TranslateRowInput,
  type TranslateRowResult,
  type TranslateRowsInput,
  type TranslateRowsResult,
} from './translation';


afterEach(() => {
  resetApiTestStorage();
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


describe('translation API', () => {
  it('sends all three operations as POST requests with unchanged payloads', async () => {
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
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(rowResult))
      .mockResolvedValueOnce(Response.json(rowsResult))
      .mockResolvedValueOnce(Response.json(pageResult));
    vi.stubGlobal('fetch', fetchMock);

    await expect(translateVaultRow(rowInput)).resolves.toEqual(rowResult);
    await expect(translateVaultRows(rowsInput)).resolves.toEqual(rowsResult);
    await expect(translateVaultPage(pageInput)).resolves.toEqual(pageResult);

    expect(
      fetchMock.mock.calls.map((_, index) => {
        const request = requestAt(fetchMock, index);
        return [request.method, new URL(request.url).pathname];
      }),
    ).toEqual([
      ['POST', '/api/vault/skills/translate-row'],
      ['POST', '/api/vault/skills/translate-rows'],
      ['POST', '/api/vault/skills/translate-page'],
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
});
