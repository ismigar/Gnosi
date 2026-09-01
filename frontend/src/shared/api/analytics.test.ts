import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  deleteDirective,
  fetchDirectiveAnalytics,
  fetchTrapAnalytics,
  saveDirectiveContent,
} from './analytics';

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

interface RecordedFetchMock {
  readonly mock: {
    readonly calls: ReadonlyArray<readonly [RequestInfo | URL, RequestInit?]>;
  };
}

function requestAt(fetchMock: RecordedFetchMock, index = 0): Request {
  const input = fetchMock.mock.calls[index]?.[0];
  if (!(input instanceof Request)) throw new Error('Expected a Request instance');
  return input;
}

describe('analytics API', () => {
  it('queries directive and trap pages with typed pagination', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          directives: [],
          has_more: false,
          limit: 12,
          offset: 24,
          total: 0,
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          has_more: false,
          limit: 15,
          offset: 30,
          total: 0,
          traps: [],
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await fetchDirectiveAnalytics({ limit: 12, offset: 24 });
    await fetchTrapAnalytics({ limit: 15, offset: 30 });

    const directiveUrl = new URL(requestAt(fetchMock).url);
    const trapUrl = new URL(requestAt(fetchMock, 1).url);
    expect(directiveUrl.searchParams.get('limit')).toBe('12');
    expect(directiveUrl.searchParams.get('offset')).toBe('24');
    expect(trapUrl.searchParams.get('limit')).toBe('15');
    expect(trapUrl.searchParams.get('offset')).toBe('30');
  });

  it('sends directive replacement content as the generated request body', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ message: 'Updated successfully', path: '/tmp/a.md' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await saveDirectiveContent({ content: 'Updated', path: '/tmp/a.md' });

    const request = requestAt(fetchMock);
    expect(request.method).toBe('POST');
    await expect(request.clone().json()).resolves.toEqual({
      content: 'Updated',
      path: '/tmp/a.md',
    });
  });

  it('deletes a directive through a URL-encoded typed query', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ message: 'Deleted successfully' }));
    vi.stubGlobal('fetch', fetchMock);

    await deleteDirective('/tmp/space name.md');

    const request = requestAt(fetchMock);
    expect(request.method).toBe('DELETE');
    expect(new URL(request.url).searchParams.get('path')).toBe('/tmp/space name.md');
  });
});
