import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  dismissBrainSuggestion,
  fetchBrainSuggestions,
  fetchBrainTableStatus,
  fetchLlmWikiConfig,
} from './brain';


afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});


describe('Brain inbox API', () => {
  it('loads the migrated LLM Wiki configuration and runtime maps', async () => {
    const response = {
      config: { brain_table_id: 'brain-1', source_tables: [] },
      brain: { table_id: 'brain-1', name: 'Brain', configured: true },
      eligible_index_properties: [],
      index_options: {},
      capabilities: { pdf: true },
      validation: { valid: true, missing: [] },
      processed_resources: {},
      resource_statuses: {},
      enabled: true,
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json(response));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchLlmWikiConfig()).resolves.toEqual(response);

    const request = fetchMock.mock.calls[0]?.[0];
    if (!(request instanceof Request)) throw new Error('Expected a Request');
    expect(new URL(request.url).pathname).toBe('/api/vault/llm-wiki/config');
  });

  it('loads the configured Brain table through the generated contract', async () => {
    const status = {
      table_id: 'brain-1',
      configured: true,
      name: 'Brain',
      source_table_ids: ['references'],
      index_field_ids: ['areas'],
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json(status));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchBrainTableStatus()).resolves.toEqual(status);

    const request = fetchMock.mock.calls[0]?.[0];
    if (!(request instanceof Request)) throw new Error('Expected a Request');
    expect(new URL(request.url).pathname).toBe('/api/vault/brain-table');
  });

  it('lists and dismisses read-only connection proposals', async () => {
    const suggestion = {
      evidence: ['Excerpt'],
      id: 'proposal/1',
      kind: 'connection',
      member_ids: ['page-1', 'page-2'],
      member_titles: ['One', 'Two'],
      title: 'Connect both notes',
      why: 'Shared evidence',
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ suggestions: [suggestion] }))
      .mockResolvedValueOnce(Response.json({ rejected: 'proposal/1' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchBrainSuggestions()).resolves.toEqual({
      suggestions: [suggestion],
    });
    await expect(dismissBrainSuggestion('proposal/1')).resolves.toEqual({
      rejected: 'proposal/1',
    });

    const second = fetchMock.mock.calls[1]?.[0];
    if (!(second instanceof Request)) throw new Error('Expected a Request');
    expect(second.method).toBe('POST');
    expect(new URL(second.url).pathname).toBe(
      '/api/vault/llm-wiki/suggestions/proposal%2F1/dismiss',
    );
  });
});
