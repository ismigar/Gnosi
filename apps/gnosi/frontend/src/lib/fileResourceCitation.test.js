import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    documentResourceKey,
    documentTabId,
    documentWindowName,
    openCitation,
    openFileResource,
} from './fileResource';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('openCitation', () => {
    it('opens persisted PDF evidence at its page with transient highlight text', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    kind: 'pdf',
                    source_url: 'file:///tmp/source.pdf',
                    segment: {
                        text: 'Exact persisted evidence.',
                        locator: { page: 7, paragraph: 2 },
                    },
                }),
            })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ metadata: {} }) });
        vi.stubGlobal('fetch', fetchMock);
        let opened;
        const listener = (event) => {
            opened = event.detail;
            event.preventDefault();
        };
        window.addEventListener('gnosi:open-pdf', listener, { once: true });

        await openCitation('resource-1', '3', {
            citation: { snapshot: 'snapshot-1', segment: 'segment-1' },
        });

        expect(opened).toMatchObject({
            src: 'file:///tmp/source.pdf',
            kind: 'pdf',
            location: {
                pageNumber: '7',
                highlightText: 'Exact persisted evidence.',
            },
        });
    });

    it('keeps the citation page as fallback when evidence is unavailable', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({ ok: false })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ metadata: { 'Arxiu/s': '/api/vault/library/source.pdf' } }),
            });
        vi.stubGlobal('fetch', fetchMock);
        let opened;
        const listener = (event) => {
            opened = event.detail;
            event.preventDefault();
        };
        window.addEventListener('gnosi:open-pdf', listener, { once: true });

        await openCitation('resource-1', '3', {
            citation: {
                snapshot: 'missing',
                segment: 'missing',
                highlightText: 'Visible citation fallback.',
            },
        });

        expect(opened).toMatchObject({
            src: '/api/vault/library/source.pdf',
            location: {
                pageNumber: '3',
                highlightText: 'Visible citation fallback.',
            },
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
        const openMock = vi.fn(() => readerWindow);
        vi.stubGlobal('open', openMock);

        openFileResource('/tmp/repeated.pdf');
        openFileResource('/tmp/repeated.pdf');

        expect(openMock).toHaveBeenCalledTimes(2);
        expect(openMock.mock.calls[0][1]).toBe(documentWindowName('/tmp/repeated.pdf'));
        expect(openMock.mock.calls[1][1]).toBe(openMock.mock.calls[0][1]);
        expect(readerWindow.focus).toHaveBeenCalledTimes(2);
        expect(readerWindow.opener).toBeNull();
    });
});
