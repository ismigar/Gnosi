import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  cancelLiteratureSynchronization,
  clearReferenceTable,
  createLiteratureRepository,
  createReferenceTable,
  deleteLiteratureRepository,
  fetchLiteratureConfiguration,
  fetchReferenceTable,
  resumeLiteratureSynchronization,
  setReferenceTable,
  startLiteratureSynchronization,
  testLiteratureRepository,
  updateLiteratureConfiguration,
  updateLiteratureRepository,
  type LiteratureRepositoryInput,
} from './literature-resources';


afterEach(() => {
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


const configuration = {
  ai_agent_id: 'research-agent',
  ai_agents: [{
    id: 'research-agent',
    model: 'test-model',
    name: 'Research agent',
    provider: 'local',
  }],
  contact_email: 'researcher@example.org',
  hidden_sources: [],
  source_defaults: { crossref: true },
  sources: [{
    automated: true,
    available: true,
    enabled: true,
    hidden: false,
    id: 'crossref',
    kind: 'api',
    name: 'Crossref',
  }],
};


const repositoryInput: LiteratureRepositoryInput = {
  base_url: 'https://repository.example.org/oai',
  cursor_parameter: 'cursor',
  default_enabled: true,
  kind: 'oai',
  limit_parameter: 'limit',
  mapping: {},
  metadata_prefix: 'oai_dc',
  name: 'Institutional repository',
  next_cursor_path: 'next_cursor',
  offset_parameter: 'offset',
  page_parameter: 'page',
  pagination: 'none',
  query_parameter: 'q',
  results_path: 'results',
  set: '',
  static_filters: {},
  sync_mode: 'incremental',
  tombstones: true,
};


function resourceResponse(input: RequestInfo | URL, init?: RequestInit): Response {
  const request = input instanceof Request
    ? input
    : new Request(new URL(String(input), window.location.origin), init);
  const { pathname } = new URL(request.url);

  if (pathname.endsWith('/repositories/test')) {
    return Response.json({ count: 2, latency_ms: 17, ok: true, sample: [] });
  }
  if (pathname.includes('/repositories/')) {
    if (request.method === 'DELETE') {
      return Response.json({
        deleted: true,
        index_records_deleted: 4,
        repository_id: 'repository-1',
      });
    }
    return Response.json({
      ...repositoryInput,
      id: 'repository-1',
    });
  }
  if (pathname.endsWith('/repositories')) {
    return Response.json({ ...repositoryInput, id: 'repository-1' }, { status: 201 });
  }
  if (pathname.includes('/synchronizations/')) {
    return Response.json({ source_id: 'repository-1', state: 'queued' }, {
      status: request.method === 'POST' ? 202 : 200,
    });
  }
  if (pathname.endsWith('/reference-table/create')) {
    return Response.json({ configured: true, created: true, table_id: 'resources' });
  }
  if (pathname.endsWith('/reference-table')) {
    return Response.json({
      configured: request.method !== 'DELETE',
      table_id: request.method === 'DELETE' ? null : 'resources',
    });
  }
  if (pathname.endsWith('/configuration')) {
    return Response.json(configuration);
  }
  return Response.json({ detail: 'Unexpected test request' }, { status: 500 });
}


describe('literature Resources API', () => {
  it('preserves configuration and repository methods, bodies and delete query', async () => {
    const fetchMock = vi.fn<typeof fetch>((input, init) =>
      Promise.resolve(resourceResponse(input, init)));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchLiteratureConfiguration()).resolves.toEqual(configuration);
    await expect(updateLiteratureConfiguration({
      source_defaults: { crossref: false },
    })).resolves.toEqual(configuration);
    await expect(createLiteratureRepository(repositoryInput)).resolves.toMatchObject({
      id: 'repository-1',
    });
    await expect(updateLiteratureRepository(
      'repository-1',
      repositoryInput,
    )).resolves.toMatchObject({ id: 'repository-1' });
    await expect(testLiteratureRepository({
      ...repositoryInput,
      id: 'draft-id',
      query: 'open science',
    })).resolves.toMatchObject({ count: 2, latency_ms: 17 });
    await expect(deleteLiteratureRepository(
      'repository-1',
      true,
    )).resolves.toMatchObject({ index_records_deleted: 4 });

    const updateRequest = requestAt(fetchMock.mock.calls, 1);
    expect(updateRequest.method).toBe('PUT');
    await expect(updateRequest.json()).resolves.toEqual({
      source_defaults: { crossref: false },
    });

    const createRequest = requestAt(fetchMock.mock.calls, 2);
    expect(createRequest.method).toBe('POST');
    expect(new URL(createRequest.url).pathname).toBe(
      '/api/vault/literature/repositories',
    );
    await expect(createRequest.json()).resolves.toEqual(repositoryInput);

    const updateRepositoryRequest = requestAt(fetchMock.mock.calls, 3);
    expect(updateRepositoryRequest.method).toBe('PUT');
    expect(new URL(updateRepositoryRequest.url).pathname).toBe(
      '/api/vault/literature/repositories/repository-1',
    );

    const testRequest = requestAt(fetchMock.mock.calls, 4);
    await expect(testRequest.json()).resolves.toMatchObject({
      id: 'draft-id',
      query: 'open science',
    });

    const deleteRequest = requestAt(fetchMock.mock.calls, 5);
    const deleteUrl = new URL(deleteRequest.url);
    expect(deleteRequest.method).toBe('DELETE');
    expect(deleteUrl.searchParams.get('confirm')).toBe('true');
    expect(deleteUrl.searchParams.get('delete_index')).toBe('true');
    expect(deleteRequest.credentials).toBe('include');
  });


  it('keeps synchronization payloads and reference-table mutations explicit', async () => {
    const fetchMock = vi.fn<typeof fetch>((input, init) =>
      Promise.resolve(resourceResponse(input, init)));
    vi.stubGlobal('fetch', fetchMock);

    await startLiteratureSynchronization('repository-1', true);
    await cancelLiteratureSynchronization('repository-1');
    await resumeLiteratureSynchronization('repository-1');
    await fetchReferenceTable();
    await setReferenceTable('resources');
    await clearReferenceTable();
    await createReferenceTable();

    const startRequest = requestAt(fetchMock.mock.calls, 0);
    expect(startRequest.method).toBe('POST');
    await expect(startRequest.json()).resolves.toEqual({ full: true });

    const cancelRequest = requestAt(fetchMock.mock.calls, 1);
    expect(cancelRequest.method).toBe('DELETE');
    expect(new URL(cancelRequest.url).pathname).toBe(
      '/api/vault/literature/synchronizations/repository-1',
    );

    const resumeRequest = requestAt(fetchMock.mock.calls, 2);
    expect(resumeRequest.method).toBe('POST');
    expect(new URL(resumeRequest.url).pathname).toBe(
      '/api/vault/literature/synchronizations/repository-1/resume',
    );

    const designateRequest = requestAt(fetchMock.mock.calls, 4);
    await expect(designateRequest.json()).resolves.toEqual({
      table_id: 'resources',
    });
    expect(requestAt(fetchMock.mock.calls, 5).method).toBe('DELETE');
    await expect(requestAt(fetchMock.mock.calls, 6).json()).resolves.toEqual({});
  });
});
