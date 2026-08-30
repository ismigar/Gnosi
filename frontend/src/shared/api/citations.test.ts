import { resetApiTestStorage } from '../../../tests/api-request';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createPdfAnnotation,
  deletePdfAnnotation,
  fetchPdfAnnotations,
  resolveCitationKey,
  searchCitations,
  updatePdfAnnotation,
} from './citations';


afterEach(() => {
  resetApiTestStorage();
  vi.unstubAllGlobals();
});


function requestAt(calls: [RequestInfo | URL, RequestInit?][], index: number): Request {
  const call = calls[index];
  if (!call) throw new Error(`Expected fetch call ${String(index)}`);
  const [input, init] = call;
  return input instanceof Request
    ? input
    : new Request(new URL(String(input), window.location.origin), init);
}


const annotation = {
  color: '#ffeb3b',
  comment: null,
  created_at: null,
  id: 7,
  page: 2,
  rects: [],
  source_uri: 'file:///paper.pdf',
  tags: null,
  text: 'Quoted text',
  type: 'highlight',
  updated_at: null,
};


describe('citations API', () => {
  it('searches and resolves citation keys with encoded queries', async () => {
    const item = {
      author: 'Ada',
      citation_key: 'ada2026',
      folder: 'Resources',
      id: 'page-1',
      title: 'Research',
      year: '2026',
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json([item]))
      .mockResolvedValueOnce(Response.json(item));
    vi.stubGlobal('fetch', fetchMock);

    await expect(searchCitations('Ada & Bob', 12)).resolves.toEqual([item]);
    await expect(resolveCitationKey('ada2026')).resolves.toEqual(item);

    const searchUrl = new URL(requestAt(fetchMock.mock.calls, 0).url);
    expect(searchUrl.searchParams.get('q')).toBe('Ada & Bob');
    expect(searchUrl.searchParams.get('limit')).toBe('12');
    expect(new URL(requestAt(fetchMock.mock.calls, 1).url).searchParams.get('key')).toBe(
      'ada2026',
    );
  });

  it('lists and mutates PDF annotations through typed routes', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json([annotation]))
      .mockResolvedValueOnce(Response.json(annotation))
      .mockResolvedValueOnce(Response.json({ ...annotation, comment: 'Keep' }))
      .mockResolvedValueOnce(Response.json({ id: 7, status: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);

    await fetchPdfAnnotations('file:///paper.pdf');
    await createPdfAnnotation({
      page: 2,
      source_uri: 'file:///paper.pdf',
      text: 'Quoted text',
      type: 'highlight',
    });
    await updatePdfAnnotation(7, { comment: 'Keep' });
    await deletePdfAnnotation(7);

    expect(new URL(requestAt(fetchMock.mock.calls, 0).url).searchParams.get('source_uri')).toBe(
      'file:///paper.pdf',
    );
    await expect(requestAt(fetchMock.mock.calls, 1).clone().json()).resolves.toMatchObject({
      color: '#ffeb3b',
      source_uri: 'file:///paper.pdf',
    });
    expect(requestAt(fetchMock.mock.calls, 2).method).toBe('PATCH');
    expect(requestAt(fetchMock.mock.calls, 3).method).toBe('DELETE');
  });
});
