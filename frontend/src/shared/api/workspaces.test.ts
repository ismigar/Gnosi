import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchWorkspaces } from './workspaces';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('workspaces API', () => {
    it('loads the typed workspace catalog through the generated client', async () => {
        const payload = [{
            created_at: '2026-08-29T10:00:00Z',
            id: 'workspace-1',
            name: 'Research',
            role: 'owner',
            slug: 'research',
        }];
        const fetchMock = vi.fn<typeof fetch>(() => (
            Promise.resolve(Response.json(payload, { status: 200 }))
        ));
        vi.stubGlobal('fetch', fetchMock);

        await expect(fetchWorkspaces()).resolves.toEqual(payload);
        const request = fetchMock.mock.calls[0]?.[0];
        if (!(request instanceof Request)) throw new Error('Expected a Request instance');
        expect(request.method).toBe('GET');
        expect(new URL(request.url).pathname).toBe('/api/workspaces');
    });
});
