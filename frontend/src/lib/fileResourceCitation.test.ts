import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { subscribeAppEvent, type OpenDocumentEventDetail } from '../shared/platform/app-events';
import {
  documentResourceKey,
  documentTabId,
  documentWindowName,
  openCitation,
  openFileResource,
} from './fileResource';

const apiMocks = vi.hoisted(() => ({
  fetchNotebookEvidence: vi.fn<(
    notebookId: string,
    chunkId: string,
    revision?: number,
  ) => Promise<unknown>>(),
  transportFetch: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(),
}));

vi.mock('../shared/api/notebooks', () => ({
  fetchNotebookEvidence: apiMocks.fetchNotebookEvidence,
}));

vi.mock('../shared/api/transports', () => ({
  transportFetch: apiMocks.transportFetch,
}));

vi.mock('./notifyError', () => ({ logError: vi.fn() }));
vi.mock('./toast', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

beforeEach(() => {
  apiMocks.fetchNotebookEvidence.mockReset();
  apiMocks.transportFetch.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function captureOpenedDocument(): {
  readonly opened: () => OpenDocumentEventDetail | undefined;
  readonly unsubscribe: () => void;
} {
  let detail: OpenDocumentEventDetail | undefined;
  const unsubscribe = subscribeAppEvent('gnosi:open-pdf', (nextDetail, event) => {
    detail = nextDetail;
    event.preventDefault();
  });
  return { opened: () => detail, unsubscribe };
}

describe('openCitation', () => {
  it('opens notebook evidence from its pinned revision and exact attachment', async () => {
    apiMocks.fetchNotebookEvidence.mockResolvedValueOnce({
        locator: { page: 9, paragraph: 3 },
        source_kind: 'pdf',
        source_url: 'file:///tmp/notebook-source.pdf',
        text: 'Exact notebook evidence.',
      });
    apiMocks.transportFetch.mockResolvedValueOnce(Response.json({ metadata: {} }));
    const capture = captureOpenedDocument();

    await openCitation('resource-1', '3', {
      citation: {
        chunk: 'chunk-1',
        notebook: 'notebook-1',
        revision: '4',
      },
    });

    capture.unsubscribe();
    expect(apiMocks.fetchNotebookEvidence).toHaveBeenCalledWith(
      'notebook-1',
      'chunk-1',
      4,
    );
    expect(capture.opened()).toMatchObject({
      kind: 'pdf',
      location: {
        highlightText: 'Exact notebook evidence.',
        pageNumber: '9',
      },
      src: 'file:///tmp/notebook-source.pdf',
    });
  });

  it('opens persisted PDF evidence at its page with transient highlight text', async () => {
    apiMocks.transportFetch
      .mockResolvedValueOnce(Response.json({
        kind: 'pdf',
        segment: {
          locator: { page: 7, paragraph: 2 },
          text: 'Exact persisted evidence.',
        },
        source_url: 'file:///tmp/source.pdf',
      }))
      .mockResolvedValueOnce(Response.json({ metadata: {} }));
    const capture = captureOpenedDocument();

    await openCitation('resource-1', '3', {
      citation: { segment: 'segment-1', snapshot: 'snapshot-1' },
    });

    capture.unsubscribe();
    expect(capture.opened()).toMatchObject({
      kind: 'pdf',
      location: {
        highlightText: 'Exact persisted evidence.',
        pageNumber: '7',
      },
      src: 'file:///tmp/source.pdf',
    });
  });

  it('keeps the citation page as fallback when evidence is unavailable', async () => {
    apiMocks.transportFetch
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(Response.json({
        metadata: { 'Arxiu/s': '/api/vault/library/source.pdf' },
      }));
    const capture = captureOpenedDocument();

    await openCitation('resource-1', '3', {
      citation: {
        highlightText: 'Visible citation fallback.',
        segment: 'missing',
        snapshot: 'missing',
      },
    });

    capture.unsubscribe();
    expect(capture.opened()).toMatchObject({
      location: {
        highlightText: 'Visible citation fallback.',
        pageNumber: '3',
      },
      src: '/api/vault/library/source.pdf',
    });
  });
});

describe('document reader identity', () => {
  it('uses one integrated tab for equivalent document URI forms', () => {
    const fileUrl = 'file:///Users/first/Library/Research/Source.pdf';
    const localPath = '/Users/second/Library/Research/Source.pdf';
    const servedUrl = '/api/vault/library/Research/Source.pdf?vault=principal';

    expect(documentResourceKey(fileUrl)).toBe('library/research/source.pdf');
    expect(documentTabId(fileUrl)).toBe(documentTabId(localPath));
    expect(documentTabId(localPath)).toBe(documentTabId(servedUrl));
  });

  it('reuses a stable standalone window for repeated opens of one document', () => {
    const readerWindow = { focus: vi.fn(), opener: window };
    const openMock = vi.fn<(
      url?: string | URL,
      target?: string,
      features?: string,
    ) => typeof readerWindow>(() => readerWindow);
    vi.stubGlobal('open', openMock);

    openFileResource('/tmp/repeated.pdf');
    openFileResource('/tmp/repeated.pdf');

    expect(openMock).toHaveBeenCalledTimes(2);
    expect(openMock.mock.calls[0]?.[1]).toBe(documentWindowName('/tmp/repeated.pdf'));
    expect(openMock.mock.calls[1]?.[1]).toBe(openMock.mock.calls[0]?.[1]);
    expect(readerWindow.focus).toHaveBeenCalledTimes(2);
    expect(readerWindow.opener).toBeNull();
  });
});
