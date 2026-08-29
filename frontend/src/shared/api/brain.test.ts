import { afterEach, describe, expect, it, vi } from 'vitest';

import { dismissBrainSuggestion, fetchBrainSuggestions } from './brain';


afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});


describe('Brain inbox API', () => {
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
