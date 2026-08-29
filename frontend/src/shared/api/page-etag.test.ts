import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearPageEtag, getCachedPageEtag } from './page-etag';
import { fetchVaultPage, patchVaultPage, saveVaultPage } from './vaults';


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


function pageResponse(etag: string): Response {
  return Response.json({
    content: '# Page',
    etag,
    folder: '',
    id: 'page-1',
    message: 'ok',
    metadata: {},
    status: 'ok',
    title: 'Page',
  });
}


function conflictResponse(
  currentEtag: string,
  expectedEtag: string,
): Response {
  return Response.json(
    {
      detail: {
        current_etag: currentEtag,
        error: 'etag_mismatch',
        expected_etag: expectedEtag,
        message: 'The page changed',
      },
    },
    { status: 409, statusText: 'Conflict' },
  );
}


afterEach(() => {
  clearPageEtag('page-1');
  localStorage.clear();
  vi.unstubAllGlobals();
});


describe('page ETag middleware', () => {
  it('captures GET ETags, protects mutations and invalidates previews', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(pageResponse('etag-1'))
      .mockResolvedValueOnce(pageResponse('etag-2'));
    vi.stubGlobal('fetch', fetchMock);
    const invalidations: CustomEvent<{ pageId: string }>[] = [];
    const onInvalidate = (event: Event) => {
      invalidations.push(event as CustomEvent<{ pageId: string }>);
    };
    window.addEventListener('gnosi:invalidatePreview', onInvalidate);

    await fetchVaultPage('page-1');
    await patchVaultPage('page-1', { title: 'Updated' });

    expect(getCachedPageEtag('page-1')).toBe('etag-2');
    const mutation = requestAt(fetchMock.mock.calls, 1);
    await expect(mutation.json()).resolves.toEqual({
      expected_etag: 'etag-1',
      force: false,
      title: 'Updated',
    });
    expect(invalidations).toHaveLength(1);
    expect(invalidations[0]?.detail).toEqual({ pageId: 'page-1' });
    window.removeEventListener('gnosi:invalidatePreview', onInvalidate);
  });


  it('preserves explicit ETags and the force escape hatch', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(pageResponse('etag-1'))
      .mockResolvedValueOnce(pageResponse('etag-2'))
      .mockResolvedValueOnce(pageResponse('etag-3'));
    vi.stubGlobal('fetch', fetchMock);

    await fetchVaultPage('page-1');
    await patchVaultPage('page-1', {
      expected_etag: 'caller-etag',
      title: 'Explicit',
    });
    await saveVaultPage('page-1', {
      content: '# Forced',
      force: true,
      title: 'Forced',
    });

    await expect(requestAt(fetchMock.mock.calls, 1).json()).resolves.toMatchObject({
      expected_etag: 'caller-etag',
    });
    await expect(requestAt(fetchMock.mock.calls, 2).json()).resolves.not.toHaveProperty(
      'expected_etag',
    );
  });


  it('blocks autosaves after a conflict until the user resolves it', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(pageResponse('etag-1'))
      .mockResolvedValueOnce(conflictResponse('etag-2', 'etag-1'))
      .mockResolvedValueOnce(pageResponse('etag-3'));
    vi.stubGlobal('fetch', fetchMock);
    const conflicts: CustomEvent[] = [];
    const onConflict = (event: Event) => conflicts.push(event as CustomEvent);
    window.addEventListener('pageEtagConflict', onConflict);

    await fetchVaultPage('page-1');
    await expect(
      patchVaultPage('page-1', { title: 'Concurrent edit' }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      patchVaultPage('page-1', { title: 'Automatic retry' }),
    ).rejects.toMatchObject({ status: 409 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(conflicts).toHaveLength(2);
    expect(conflicts[0]?.detail).toMatchObject({
      currentEtag: 'etag-2',
      expectedEtag: 'etag-1',
      pageId: 'page-1',
    });
    expect(getCachedPageEtag('page-1')).toBe('etag-2');

    await expect(
      patchVaultPage('page-1', { force: true, title: 'Overwrite explicitly' }),
    ).resolves.toMatchObject({ etag: 'etag-3' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await expect(requestAt(fetchMock.mock.calls, 2).json()).resolves.not.toHaveProperty(
      'expected_etag',
    );
    window.removeEventListener('pageEtagConflict', onConflict);
  });
});
