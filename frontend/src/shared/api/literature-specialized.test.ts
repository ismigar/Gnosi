import { resetApiTestStorage } from '../../test/api-request';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { downloadLiteratureReview } from './literature-specialized';


afterEach(() => {
  resetApiTestStorage();
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


describe('literature specialized transport', () => {
  it('downloads binary review exports with credentials and response filename', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      new TextEncoder().encode('review body'),
      {
        headers: {
          'content-disposition': 'attachment; filename="review.csv"',
          'content-type': 'text/csv',
        },
      },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const download = await downloadLiteratureReview('review / 1', 'csv');

    const request = requestAt(fetchMock.mock.calls, 0);
    expect(request.method).toBe('GET');
    expect(new URL(request.url).pathname).toBe(
      '/api/vault/literature/reviews/review%20%2F%201/exports/csv',
    );
    expect(request.credentials).toBe('include');
    expect(download.contentDisposition).toBe(
      'attachment; filename="review.csv"',
    );
    expect(download.blob.type).toBe('text/csv');
    expect(download.blob.size).toBe(11);
    await expect(download.blob.text()).resolves.toBe('review body');
  });
});
