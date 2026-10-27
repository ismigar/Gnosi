import { afterEach, expect, it, vi } from 'vitest';
import { requestAt, resetApiTestStorage } from '../../../tests/api-request';
import * as api from './web-publishing';
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); resetApiTestStorage(); });
it('sends every staging operation with the captured account scope and abort signal', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(Response.json({})));
    vi.stubGlobal('fetch', fetchMock);
    const context = { userId: 'owner', workspaceId: 'workspace', vaultId: 'vault', userEmail: 'owner@example.invalid' };
    const signal = new AbortController().signal;
    await api.webStatus(context, signal);
    await api.webPreview(['one'], ['legacy'], context, signal);
    await api.webPublish('preview', context, signal);
    await api.webRollback('release', context, signal);
    await api.newsletterStatus(context, signal);
    await api.newsletterPreview({ subject: 'Test', body_markdown: 'Test body', language: 'ca' }, context, signal);
    await api.newsletterSend('mail-preview', context, signal);
    const requests = fetchMock.mock.calls.map((_, index) => requestAt(fetchMock.mock.calls, index));
    for (const request of requests) {
        expect(request.credentials).toBe('include');
        expect(request.headers.get('X-Vault-ID')).toBe('vault');
        expect(request.headers.get('X-Workspace-ID')).toBe('workspace');
        expect(request.headers.get('X-Gnosi-Web-Expected-User-ID')).toBe('owner');
        expect(request.headers.has('X-Gnosi-Expected-User-ID')).toBe(false);
    }
    await expect(requests[1]?.json()).resolves.toEqual({ page_ids: ['one'], withdraw_ids: ['legacy'] });
    await expect(requests[2]?.json()).resolves.toEqual({ preview_id: 'preview' });
    await expect(requests[6]?.json()).resolves.toEqual({ preview_id: 'mail-preview' });
});
