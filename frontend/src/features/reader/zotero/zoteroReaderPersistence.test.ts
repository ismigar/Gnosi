import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchPersistedAnnotations,
  persistDeleteAnnotations,
  persistSaveAnnotations,
  type AnnotationPersistenceState,
} from './zoteroReaderPersistence';
import type { ZoteroAnnotation } from './zoteroReaderModel';

const mocks = vi.hoisted(() => ({
  transportFetch: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(),
}));

vi.mock('../../../shared/api/transports', () => ({
  transportFetch: mocks.transportFetch,
}));
vi.mock('../../../shared/notifications/notifyError', () => ({ logError: vi.fn() }));
vi.mock('../../../shared/api/vault-context', () => ({
  getActiveVaultId: () => '',
  getActiveVaultSlug: () => 'principal',
}));

function persistenceState(): AnnotationPersistenceState {
  return {
    annotations: { current: [] },
    idMap: { current: new Map() },
  };
}

beforeEach(() => {
  mocks.transportFetch.mockReset();
});

describe('reader annotation persistence', () => {
  it('loads generated and manual highlights across the two routes without duplicates', async () => {
    const generated = { id: 12, type: 'highlight', text: 'Generated idea', page: 3 };
    const manual = { id: 13, type: 'highlight', text: 'Manual note', page: 4 };
    mocks.transportFetch
      .mockResolvedValueOnce(Response.json([generated]))
      .mockResolvedValueOnce(Response.json([generated, manual]));
    const state = persistenceState();

    const annotations = await fetchPersistedAnnotations(
      '/api/v1/vaults/principal/knowledge/library/Book.pdf', undefined, state,
    );

    expect(annotations?.map((item) => item.id)).toEqual(['gnosi:12', 'gnosi:13']);
    expect(mocks.transportFetch.mock.calls.map(([url]) => url)).toEqual([
      '/api/vault/pdf-annotations?source_uri=%2Fapi%2Fvault%2Flibrary%2FBook.pdf',
      '/api/vault/pdf-annotations?source_uri=%2Fapi%2Fv1%2Fvaults%2Fprincipal%2Fknowledge%2Flibrary%2FBook.pdf',
    ]);
  });

  it('saves new highlights under the same identity used by source processing', async () => {
    mocks.transportFetch.mockResolvedValueOnce(Response.json({ id: 14 }));
    await persistSaveAnnotations(
      [{ id: 'new', type: 'highlight', position: { pageIndex: 2 }, text: 'An idea' }],
      '/api/v1/vaults/principal/knowledge/library/Book.pdf', persistenceState(), vi.fn(),
    );
    const body = mocks.transportFetch.mock.calls[0]?.[1]?.body;
    if (typeof body !== 'string') throw new Error('Expected a JSON request body');
    const saved: unknown = JSON.parse(body);
    expect(saved).toMatchObject({ source_uri: '/api/vault/library/Book.pdf', page: 3 });
  });

  it('restores native Zotero blobs and their database identity', async () => {
    const state = persistenceState();
    mocks.transportFetch.mockResolvedValueOnce(Response.json([{
      comment: '__ZOTERO_JSON__{"id":"old","type":"highlight"}',
      id: 12,
    }]));

    const annotations = await fetchPersistedAnnotations('file:///paper.pdf', undefined, state);

    expect(annotations).toEqual([expect.objectContaining({ id: 'gnosi:12', type: 'highlight' })]);
    expect(state.idMap.current.get('gnosi:12')).toBe(12);
  });

  it('creates one annotation, remaps its id and later deletes it', async () => {
    const state = persistenceState();
    const postToReader = vi.fn<(message: Readonly<Record<string, unknown>>) => void>();
    const annotation: ZoteroAnnotation = {
      id: 'zotero-1',
      position: { pageIndex: 2, rects: [] },
      text: 'Selected text',
      type: 'highlight',
    };
    mocks.transportFetch
      .mockResolvedValueOnce(Response.json({ id: 21 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await persistSaveAnnotations([annotation], 'file:///paper.pdf', state, postToReader);
    await persistDeleteAnnotations(['zotero-1'], state);

    const createCall = mocks.transportFetch.mock.calls[0];
    expect(createCall?.[0]).toBe('/api/vault/pdf-annotations');
    expect(createCall?.[1]?.method).toBe('POST');
    expect(postToReader).toHaveBeenCalledWith({
      idMap: [{ newId: 'gnosi:21', oldId: 'zotero-1' }],
      target: 'zotero-reader',
      type: 'update-annotation-ids',
    });
    expect(mocks.transportFetch).toHaveBeenLastCalledWith(
      '/api/vault/pdf-annotations/21',
      { method: 'DELETE' },
    );
    expect(state.idMap.current.size).toBe(0);
  });
});
