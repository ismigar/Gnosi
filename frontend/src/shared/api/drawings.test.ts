import { resetApiTestStorage } from '../../../tests/api-request';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  deleteDrawing,
  fetchDrawing,
  listDrawings,
  recognizeHandwriting,
  saveDrawing,
  warmupHandwriting,
} from './drawings';
import { GnosiApiError } from './errors';


afterEach(() => {
  resetApiTestStorage();
  vi.unstubAllGlobals();
});


function requestAt(mock: ReturnType<typeof vi.fn<typeof fetch>>, index: number): Request {
  const input = mock.mock.calls[index]?.[0];
  if (!(input instanceof Request)) throw new Error('Expected a Request');
  return input;
}


describe('Drawings API', () => {
  it('lists, loads, saves, and soft-deletes drawings through typed JSON routes', async () => {
    const summary = {
      id: 'drawing-1',
      last_modified: '2026-08-29T12:00:00',
      size: 4096,
      title: 'Architecture',
    };
    const document = {
      schema: { schemaVersion: 2 },
      store: { 'shape:1': { type: 'draw', typeName: 'shape' } },
    };
    const saved = { id: 'drawing-1', status: 'success' };
    const deleted = {
      deleted_at: '2026-08-29T12:30:00',
      id: 'drawing-1',
      status: 'soft_deleted',
      title: 'Architecture',
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json([summary]))
      .mockResolvedValueOnce(Response.json(document))
      .mockResolvedValueOnce(Response.json(saved))
      .mockResolvedValueOnce(Response.json(deleted));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    await expect(listDrawings()).resolves.toEqual([summary]);
    await expect(fetchDrawing('drawing-1', controller.signal)).resolves.toEqual(document);
    await expect(saveDrawing('drawing-1', {
      data: document,
      title: 'Architecture',
    })).resolves.toEqual(saved);
    await expect(deleteDrawing('drawing-1')).resolves.toEqual(deleted);

    const listRequest = requestAt(fetchMock, 0);
    const getRequest = requestAt(fetchMock, 1);
    const saveRequest = requestAt(fetchMock, 2);
    const deleteRequest = requestAt(fetchMock, 3);
    expect(new URL(listRequest.url).pathname).toBe('/api/vault/drawings');
    expect(new URL(getRequest.url).pathname).toBe('/api/vault/drawings/drawing-1');
    expect(saveRequest.method).toBe('PUT');
    expect(await saveRequest.json()).toEqual({
      data: document,
      metadata: {},
      title: 'Architecture',
    });
    expect(deleteRequest.method).toBe('DELETE');
    controller.abort();
    expect(getRequest.signal.aborted).toBe(true);
  });

  it('warms up and recognizes handwriting while preserving multipart options', async () => {
    const warmup = { loaded: false, warming: true };
    const recognition = {
      corrected: true,
      lines: ['Hola mon'],
      model: 'local-trocr',
      raw: 'Hola mon',
      text: 'Hola món',
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(warmup))
      .mockResolvedValueOnce(Response.json(recognition));
    vi.stubGlobal('fetch', fetchMock);
    const image = new Blob(['png'], { type: 'image/png' });

    await expect(warmupHandwriting()).resolves.toEqual(warmup);
    await expect(recognizeHandwriting(image, {
      correct: true,
      language: 'ca',
    })).resolves.toEqual(recognition);

    expect(requestAt(fetchMock, 0).method).toBe('POST');
    const [recognizeInput, recognizeInit] = fetchMock.mock.calls[1] || [];
    expect(recognizeInput).toBe('/api/vault/handwriting/recognize');
    expect(recognizeInit?.method).toBe('POST');
    expect(recognizeInit?.body).toBeInstanceOf(FormData);
    const body = recognizeInit?.body as FormData;
    expect(body.get('image')).toBeInstanceOf(File);
    expect(body.get('correct')).toBe('true');
    expect(body.get('language')).toBe('ca');
  });

  it('normalizes API failures and rejects malformed success payloads', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ invalid: true }))
      .mockResolvedValueOnce(Response.json(
        { detail: 'The local recognition engine is unavailable' },
        { status: 503, statusText: 'Service Unavailable' },
      ));
    vi.stubGlobal('fetch', fetchMock);

    await expect(listDrawings()).rejects.toMatchObject({
      name: 'GnosiApiError',
    } satisfies Partial<GnosiApiError>);
    await expect(recognizeHandwriting(new Blob(['png']))).rejects.toMatchObject({
      message: 'The local recognition engine is unavailable',
      name: 'GnosiApiError',
      status: 503,
    } satisfies Partial<GnosiApiError>);
  });
});
