import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestAt, resetApiTestStorage, writeApiTestStorage } from '../../../tests/api-request';
import { commitPublication, fetchPublication, fetchPublicationPages, fetchPublications, previewPublication, revokePublication, type PublicationSummary } from './vault-publishing';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); resetApiTestStorage(); });
const context = { userId: 'owner', workspaceId: 'workspace', vaultId: 'vault', userEmail: 'owner@example.invalid' };
const token = 'a'.repeat(43);

describe('publication API boundary', () => {
    it('reads public bundles without credentials, context, cache or redirects', async () => {
        writeApiTestStorage('gnosi_active_vault', 'private-vault');
        writeApiTestStorage('gnosi_workspace_id', 'private-workspace');
        writeApiTestStorage('gnosi_user_id', 'private-user');
        writeApiTestStorage('gnosi_user_email', 'private@example.invalid');
        const storageRead = vi.spyOn(Storage.prototype, 'getItem');
        const cookieWrite = vi.spyOn(Document.prototype, 'cookie', 'set');
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ title: 'Public', pages: [] }));
        vi.stubGlobal('fetch', fetchMock);
        await fetchPublication(token);
        const request = requestAt(fetchMock.mock.calls, 0);
        expect(new URL(request.url).pathname).toBe(`/api/published/${token}`);
        expect(request.credentials).toBe('omit');
        expect(request.cache).toBe('no-store');
        expect(request.redirect).toBe('error');
        expect(request.referrerPolicy).toBe('no-referrer');
        expect([...request.headers.keys()]).not.toContain('x-vault-id');
        expect([...request.headers.keys()]).not.toContain('x-user-id');
        expect([...request.headers.keys()]).not.toContain('x-workspace-id');
        expect([...request.headers.keys()]).not.toContain('x-user-email');
        expect([...request.headers.keys()]).not.toContain('x-gnosi-expected-user-id');
        expect([...request.headers.keys()]).not.toContain('authorization');
        expect([...request.headers.keys()]).not.toContain('cookie');
        expect(storageRead).not.toHaveBeenCalled();
        expect(cookieWrite).not.toHaveBeenCalled();
        await expect(fetchPublication('../private')).rejects.toThrow('Invalid publication token');
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('binds every management action to the captured scope and reviewed preview', async () => {
        const fetchMock = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(Response.json({})));
        vi.stubGlobal('fetch', fetchMock);
        await fetchPublicationPages(context);
        await fetchPublications(context);
        await previewPublication({ title: 'Site', page_ids: ['one'], expires_in_days: 5 }, context);
        await commitPublication(token, context);
        await revokePublication({ id: 'site', revision: 3 } as PublicationSummary, context);
        const calls = fetchMock.mock.calls.map((_, index) => requestAt(fetchMock.mock.calls, index));
        for (const request of calls) {
            expect(request.headers.get('X-Vault-ID')).toBe('vault');
            expect(request.headers.get('X-Workspace-ID')).toBe('workspace');
            expect(request.headers.get('X-User-ID')).toBe('owner');
            expect(request.headers.get('X-Gnosi-Expected-User-ID')).toBe('owner');
        }
        await expect(calls[2]?.json()).resolves.toEqual({ title: 'Site', page_ids: ['one'], expires_in_days: 5 });
        await expect(calls[3]?.json()).resolves.toEqual({ preview_id: token });
        await expect(calls[4]?.json()).resolves.toEqual({ expected_revision: 3 });
        expect(calls[4]?.method).toBe('POST');
    });
});
