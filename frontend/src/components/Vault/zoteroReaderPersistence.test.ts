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

vi.mock('../../shared/api/transports', () => ({
  transportFetch: mocks.transportFetch,
}));
vi.mock('../../lib/notifyError', () => ({ logError: vi.fn() }));

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
