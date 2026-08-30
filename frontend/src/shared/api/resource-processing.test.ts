import { resetApiTestStorage } from '../../../tests/api-request';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fetchResourceProcessingStatus,
  startResourceProcessing,
} from './resource-processing';


afterEach(() => {
  resetApiTestStorage();
  vi.unstubAllGlobals();
});


describe('resource processing API', () => {
  it('starts a durable Brain ingest with the typed request body', async () => {
    const job = {
      job_id: 'job-1',
      phase: 'reading',
      progress: 0,
      resource_id: 'resource-1',
      running: true,
      source_table_id: 'resources',
    };
    const started = {
      item_id: 'resource-1',
      job,
      job_id: 'job-1',
      resource_id: 'resource-1',
      source_table_id: 'resources',
      status: 'started',
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(started),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      startResourceProcessing({
        force: true,
        resource_id: 'resource-1',
        source_table_id: 'resources',
      }),
    ).resolves.toEqual(started);

    const [input] = fetchMock.mock.calls[0] || [];
    if (!(input instanceof Request)) throw new Error('Expected a Request');
    expect(input.method).toBe('POST');
    await expect(input.json()).resolves.toEqual({
      force: true,
      resource_id: 'resource-1',
      source_table_id: 'resources',
    });
  });

  it('polls one encoded job with its optional source table', async () => {
    const job = {
      created: ['Atomic note'],
      phase: 'done',
      progress: 100,
      resource_id: 'resource/1',
      running: false,
      updated: [],
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(job),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchResourceProcessingStatus('resource/1', 'resources'),
    ).resolves.toEqual(job);

    const [input] = fetchMock.mock.calls[0] || [];
    if (!(input instanceof Request)) throw new Error('Expected a Request');
    const url = new URL(input.url);
    expect(url.pathname).toBe('/api/vault/llm-wiki/status/resource%2F1');
    expect(url.searchParams.get('source_table_id')).toBe('resources');
  });
});
