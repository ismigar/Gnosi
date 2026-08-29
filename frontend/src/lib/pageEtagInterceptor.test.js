import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import axios from '../shared/api/legacy-http';
import {
    clearPageEtag,
    getCachedEtag,
    installPageEtagInterceptor,
} from './pageEtagInterceptor';


function pageResponse(etag) {
    return Response.json({ etag, id: 'page-1', title: 'Page' });
}


function conflictResponse(currentEtag, expectedEtag) {
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


beforeAll(() => {
    installPageEtagInterceptor();
});


afterEach(() => {
    clearPageEtag('page-1');
    localStorage.clear();
    vi.unstubAllGlobals();
});


describe('legacy page ETag interceptor', () => {
    it('keeps the stale ETag and never retries a conflict automatically', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(pageResponse('etag-1'))
            .mockResolvedValueOnce(conflictResponse('etag-2', 'etag-1'))
            .mockResolvedValueOnce(conflictResponse('etag-2', 'etag-1'))
            .mockResolvedValueOnce(pageResponse('etag-3'));
        vi.stubGlobal('fetch', fetchMock);
        const conflicts = [];
        const onConflict = (event) => conflicts.push(event);
        window.addEventListener('pageEtagConflict', onConflict);

        await axios.get('/api/vault/pages/page-1');
        await expect(
            axios.patch('/api/vault/pages/page-1', { title: 'Concurrent edit' }),
        ).rejects.toMatchObject({ response: { status: 409 } });
        await expect(
            axios.patch('/api/vault/pages/page-1', { title: 'Autosave retry' }),
        ).rejects.toMatchObject({ response: { status: 409 } });

        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
            expected_etag: 'etag-1',
        });
        expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toMatchObject({
            expected_etag: 'etag-1',
        });
        expect(getCachedEtag('page-1')).toBe('etag-1');
        expect(conflicts).toHaveLength(2);

        await expect(
            axios.patch('/api/vault/pages/page-1', {
                force: true,
                title: 'Overwrite explicitly',
            }),
        ).resolves.toMatchObject({ data: { etag: 'etag-3' } });
        expect(JSON.parse(fetchMock.mock.calls[3][1].body)).not.toHaveProperty(
            'expected_etag',
        );
        window.removeEventListener('pageEtagConflict', onConflict);
    });
});
