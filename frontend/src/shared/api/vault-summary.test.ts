import { resetApiTestStorage } from '../../test/api-request';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fetchVaultSummarySettings,
  summarizeVaultRecord,
  updateVaultSummarySettings,
} from './vault-summary';


afterEach(() => {
  resetApiTestStorage();
  vi.unstubAllGlobals();
});


describe('Vault Summary API', () => {
  it('loads settings, selects a model, and generates a summary', async () => {
    const settings = { settings: { model: 'openai:gpt-5-mini' } };
    const summary = {
      model: 'openai:gpt-5-mini',
      summary: '# Research\n\n- One fact',
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(settings))
      .mockResolvedValueOnce(Response.json(settings))
      .mockResolvedValueOnce(Response.json(summary));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchVaultSummarySettings()).resolves.toEqual(settings);
    await expect(
      updateVaultSummarySettings({ model: 'openai:gpt-5-mini' }),
    ).resolves.toEqual(settings);
    await expect(
      summarizeVaultRecord({ content: 'Research', language: 'ca' }),
    ).resolves.toEqual(summary);

    const settingsRequest = fetchMock.mock.calls[0]?.[0];
    if (!(settingsRequest instanceof Request)) throw new Error('Expected a Request');
    expect(new URL(settingsRequest.url).pathname).toBe(
      '/api/vault/plugins/vault-summary/settings',
    );

    const updateRequest = fetchMock.mock.calls[1]?.[0];
    if (!(updateRequest instanceof Request)) throw new Error('Expected a Request');
    expect(updateRequest.method).toBe('PUT');
    await expect(updateRequest.json()).resolves.toEqual({
      settings: { model: 'openai:gpt-5-mini' },
    });

    const summaryRequest = fetchMock.mock.calls[2]?.[0];
    if (!(summaryRequest instanceof Request)) throw new Error('Expected a Request');
    expect(summaryRequest.method).toBe('POST');
    await expect(summaryRequest.json()).resolves.toEqual({
      content: 'Research',
      language: 'ca',
    });
  });
});
