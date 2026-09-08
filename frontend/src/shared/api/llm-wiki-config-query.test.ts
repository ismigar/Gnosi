import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { resetApiTestStorage } from '../../../tests/api-request';
import { fetchLlmWikiConfigResult } from './llm-wiki-config-query';
import { queryClient } from './query-client';

const defaults = queryClient.getDefaultOptions();

beforeEach(() => {
  queryClient.clear();
  queryClient.setDefaultOptions({ ...defaults, queries: { ...defaults.queries, retry: false } });
});

afterEach(() => {
  queryClient.clear();
  queryClient.setDefaultOptions(defaults);
  resetApiTestStorage();
  vi.unstubAllGlobals();
});

it.each([400, 500, 503])('does not cache a failed configuration response (%i)', async (status) => {
  const config = { brain_table_id: 'brain', source_tables: [] };
  const fetchMock = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status }))
    .mockResolvedValueOnce(Response.json({ config }));
  vi.stubGlobal('fetch', fetchMock);

  await expect(fetchLlmWikiConfigResult()).rejects.toMatchObject({ status });
  await expect(fetchLlmWikiConfigResult()).resolves.toMatchObject({ data: { config } });
  expect(fetchMock).toHaveBeenCalledTimes(2);

  await expect(fetchLlmWikiConfigResult()).resolves.toMatchObject({ data: { config } });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
