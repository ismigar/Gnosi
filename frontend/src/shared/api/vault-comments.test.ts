import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createVaultInlineComment,
  createVaultPageComment,
  deleteVaultInlineComment,
  deleteVaultPageComment,
  fetchVaultInlineComments,
  fetchVaultPageComments,
  updateVaultInlineComment,
  updateVaultPageComment,
} from './vault-comments';


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


describe('vault comments API', () => {
  it('manages page comment threads with typed bodies', async () => {
    const comment = {
      author: 'Ada',
      body: 'Review this',
      created_at: '2026-08-29T04:00:00Z',
      id: 'comment-1',
      resolved: false,
    };
    const deletion = { id: 'comment-1', status: 'deleted' };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ comments: [comment] }))
      .mockResolvedValueOnce(Response.json(comment))
      .mockResolvedValueOnce(Response.json({ ...comment, resolved: true }))
      .mockResolvedValueOnce(Response.json(deletion));
    vi.stubGlobal('fetch', fetchMock);

    await fetchVaultPageComments('page-1');
    await createVaultPageComment('page-1', { author: 'Ada', body: 'Review this' });
    await updateVaultPageComment('page-1', 'comment-1', { resolved: true });
    await deleteVaultPageComment('page-1', 'comment-1');

    expect(new URL(requestAt(fetchMock.mock.calls, 0).url).pathname).toBe(
      '/api/vault/pages/page-1/comments',
    );
    await expect(requestAt(fetchMock.mock.calls, 1).json()).resolves.toEqual({
      author: 'Ada',
      body: 'Review this',
    });
    expect(requestAt(fetchMock.mock.calls, 2).method).toBe('PATCH');
    expect(requestAt(fetchMock.mock.calls, 3).method).toBe('DELETE');
  });

  it('manages inline comments and materializes an empty quote', async () => {
    const comment = {
      block_id: 'block-1',
      comment: 'Clarify this',
      created_at: '2026-08-29T04:00:00Z',
      id: 'inline-1',
      quote: '',
      resolved: false,
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json([comment]))
      .mockResolvedValueOnce(Response.json(comment))
      .mockResolvedValueOnce(Response.json({ ...comment, resolved: true }))
      .mockResolvedValueOnce(Response.json({ id: 'inline-1', status: 'deleted' }));
    vi.stubGlobal('fetch', fetchMock);

    await fetchVaultInlineComments('page-1');
    await createVaultInlineComment('page-1', { comment: 'Clarify this' });
    await updateVaultInlineComment('page-1', 'inline-1', { resolved: true });
    await deleteVaultInlineComment('page-1', 'inline-1');

    await expect(requestAt(fetchMock.mock.calls, 1).json()).resolves.toEqual({
      comment: 'Clarify this',
      quote: '',
    });
    expect(requestAt(fetchMock.mock.calls, 3).method).toBe('DELETE');
  });
});
