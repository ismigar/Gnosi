import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fetchBlockEditorBacklinks,
  fetchBlockEditorOutlinks,
  fetchBlockEditorUnlinkedMentions,
  linkBlockEditorUnlinkedMentions,
} from './block-editor';


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


afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});


describe('BlockEditor links API', () => {
  it('loads typed backlinks and outgoing link groups', async () => {
    const backlinks = [
      { id: 'source-1', kind: 'link', title: 'Source' },
      { id: 'source-2', kind: 'relation', title: 'Related source' },
    ];
    const outlinks = {
      links: [{ id: 'target-1', title: 'Target' }],
      relations: [{ id: 'target-2', title: 'Related target' }],
      unresolved: [{ title: 'Missing page' }],
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(backlinks))
      .mockResolvedValueOnce(Response.json(outlinks));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchBlockEditorBacklinks('page/1')).resolves.toEqual(backlinks);
    await expect(fetchBlockEditorOutlinks('page/1')).resolves.toEqual(outlinks);

    const backlinksRequest = requestAt(fetchMock.mock.calls, 0);
    expect(new URL(backlinksRequest.url).pathname).toBe('/api/vault/backlinks');
    expect(new URL(backlinksRequest.url).searchParams.get('id')).toBe('page/1');
    const outlinksRequest = requestAt(fetchMock.mock.calls, 1);
    expect(new URL(outlinksRequest.url).pathname).toBe('/api/vault/outlinks');
    expect(new URL(outlinksRequest.url).searchParams.get('id')).toBe('page/1');
  });


  it('loads and links unlinked mentions without changing the payload', async () => {
    const mentions = [
      {
        count: 2,
        id: 'source-1',
        snippet: 'A plain Target mention',
        title: 'Source',
      },
    ];
    const linked = {
      changed_notes: [
        { id: 'source-1', replacements: 2, title: 'Source' },
      ],
      notes_changed: 1,
      status: 'success',
      target_id: 'target-1',
      target_title: 'Target',
      total_replacements: 2,
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(mentions))
      .mockResolvedValueOnce(Response.json(linked));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchBlockEditorUnlinkedMentions('target-1'),
    ).resolves.toEqual(mentions);
    await expect(
      linkBlockEditorUnlinkedMentions({
        source_id: null,
        target_id: 'target-1',
      }),
    ).resolves.toEqual(linked);

    const mentionsRequest = requestAt(fetchMock.mock.calls, 0);
    expect(new URL(mentionsRequest.url).pathname).toBe(
      '/api/vault/unlinked-mentions',
    );
    expect(new URL(mentionsRequest.url).searchParams.get('id')).toBe('target-1');
    const linkRequest = requestAt(fetchMock.mock.calls, 1);
    expect(linkRequest.method).toBe('POST');
    expect(new URL(linkRequest.url).pathname).toBe(
      '/api/vault/link-unlinked-mentions',
    );
    await expect(linkRequest.clone().json()).resolves.toEqual({
      source_id: null,
      target_id: 'target-1',
    });
  });


  it('forwards AbortSignal cancellation to openapi-fetch', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((input, init) => {
      const request = input instanceof Request
        ? input
        : new Request(new URL(String(input), window.location.origin), init);
      return new Promise<Response>((_resolve, reject) => {
        const rejectAbort = () => {
          reject(new DOMException('The operation was aborted', 'AbortError'));
        };
        if (request.signal.aborted) {
          rejectAbort();
          return;
        }
        request.signal.addEventListener(
          'abort',
          rejectAbort,
          { once: true },
        );
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    const pending = fetchBlockEditorBacklinks('page-1', controller.signal);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(requestAt(fetchMock.mock.calls, 0).signal.aborted).toBe(true);
  });


  it('rejects malformed legacy response bodies at the domain boundary', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json([{ id: 'source-1', kind: 'other' }]));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchBlockEditorBacklinks('page-1')).rejects.toThrow(
      'Invalid backlink.kind',
    );
  });
});
