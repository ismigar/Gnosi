import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestAt, resetApiTestStorage, writeApiTestStorage } from '../../../tests/api-request';
import { fetchVaultPage, resolveVaultTitle } from './vaults';

afterEach(() => { resetApiTestStorage(); vi.unstubAllGlobals(); });

describe('scoped transclusion reads', () => {
    it('pins title and page reads to the captured vault/workspace/user while preserving cancellation', async () => {
        writeApiTestStorage('gnosi_active_vault', 'new-vault');
        writeApiTestStorage('gnosi_workspace_id', 'new-workspace');
        writeApiTestStorage('gnosi_user_id', 'new-user');
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ id: 'page' }))
            .mockResolvedValueOnce(Response.json({ id: 'page', content: 'Source', metadata: {} }));
        vi.stubGlobal('fetch', fetchMock);
        const context = { vaultId: 'source-vault', workspaceId: 'source-workspace', userId: 'source-user', userEmail: 'source@example.invalid' };
        const controller = new AbortController();
        await resolveVaultTitle('A title', controller.signal, context);
        await fetchVaultPage('page', controller.signal, context);
        const requests = [requestAt(fetchMock.mock.calls, 0), requestAt(fetchMock.mock.calls, 1)];
        for (const request of requests) {
            expect(request.headers.get('X-Vault-ID')).toBe('source-vault');
            expect(request.headers.get('X-Workspace-ID')).toBe('source-workspace');
            expect(request.headers.get('X-User-ID')).toBe('source-user');
            expect(request.headers.get('X-User-Email')).toBe('source@example.invalid');
        }
        controller.abort();
        expect(requests.every(request => request.signal.aborted)).toBe(true);
    });
});
