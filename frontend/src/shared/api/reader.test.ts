import { resetApiTestStorage } from '../../test/api-request';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createReaderSource,
  fetchReaderArticles,
  fetchReaderSources,
  importReaderOpml,
  markReaderArticleRead,
} from './reader';


afterEach(() => {
  resetApiTestStorage();
  vi.unstubAllGlobals();
});


function requestFrom(mock: ReturnType<typeof vi.fn<typeof fetch>>): Request {
  const request = mock.mock.calls[0]?.[0];
  expect(request).toBeInstanceOf(Request);
  if (!(request instanceof Request)) throw new Error('Expected a Request instance');
  return request;
}


describe('reader API', () => {
  it('loads sources and materializes source defaults through the generated client', async () => {
    const source = {
      category: 'Research',
      created_at: '2026-01-01T00:00:00Z',
      id: 7,
      name: 'Example',
      type: 'rss',
      url: 'https://example.test/feed.xml',
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json([source]))
      .mockResolvedValueOnce(Response.json(source));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchReaderSources()).resolves.toEqual([source]);
    await expect(
      createReaderSource({ name: 'Example', url: source.url }),
    ).resolves.toEqual(source);

    expect(new URL(requestFrom(fetchMock).url).pathname).toBe('/api/reader/sources');
    const createRequest = fetchMock.mock.calls[1]?.[0];
    expect(createRequest).toBeInstanceOf(Request);
    if (!(createRequest instanceof Request)) throw new Error('Expected a Request instance');
    await expect(createRequest.clone().json()).resolves.toEqual({
      category: 'Uncategorized',
      name: 'Example',
      type: 'rss',
      url: source.url,
    });
  });


  it('serializes article filters and read-state mutations from typed parameters', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(Response.json({ message: 'Article marked as read' }));
    vi.stubGlobal('fetch', fetchMock);

    await fetchReaderArticles({ sourceIds: [2, 3], unreadOnly: true });
    await markReaderArticleRead(9);

    const articlesUrl = new URL(requestFrom(fetchMock).url);
    expect(articlesUrl.searchParams.getAll('source_id')).toEqual(['2', '3']);
    expect(articlesUrl.searchParams.get('unread_only')).toBe('true');
    const readRequest = fetchMock.mock.calls[1]?.[0];
    expect(readRequest).toBeInstanceOf(Request);
    if (!(readRequest instanceof Request)) throw new Error('Expected a Request instance');
    expect(readRequest.method).toBe('PATCH');
    expect(new URL(readRequest.url).pathname).toBe('/api/reader/articles/9/read');
  });


  it('sends OPML imports as multipart form data', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ message: 'Imported 1 feed' })),
    );
    vi.stubGlobal('fetch', fetchMock);
    const file = new File(['<opml />'], 'feeds.opml', { type: 'text/xml' });

    await importReaderOpml(file);

    const request = requestFrom(fetchMock);
    expect(request.method).toBe('POST');
    expect(request.headers.get('content-type')).toMatch(/^multipart\/form-data; boundary=/);
  });
});
