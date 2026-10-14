import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestAt, resetApiTestStorage, writeApiTestStorage } from '../../../tests/api-request';
import { queryClient } from './query-client';
import { currentRequestContext } from './request-context';
import { queuePageWrite } from './page-write-queue';
import { patchVaultPage } from './vault-page-mutations';

afterEach(() => { queryClient.clear(); resetApiTestStorage(); vi.unstubAllGlobals(); });
function scope() {
    writeApiTestStorage('gnosi_active_vault', 'vault-a');
    writeApiTestStorage('gnosi_workspace_id', 'workspace-a');
    writeApiTestStorage('gnosi_user_id', 'user-a');
    writeApiTestStorage('gnosi_user_email', 'a@example.invalid');
    return currentRequestContext();
}

describe('captured page mutation context', () => {
    it('pins all scope headers, authentication expectation and abort signal', async () => {
        const context = scope();
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: 'scoped-write', etag: 'next' }));
        vi.stubGlobal('fetch', fetchMock);
        const controller = new AbortController();
        await patchVaultPage('scoped-write', { content: 'draft', expected_etag: 'original' }, { context, signal: controller.signal });
        const request = requestAt(fetchMock.mock.calls, 0);
        expect(request.headers.get('X-Vault-ID')).toBe('vault-a');
        expect(request.headers.get('X-Workspace-ID')).toBe('workspace-a');
        expect(request.headers.get('X-User-ID')).toBe('user-a');
        expect(request.headers.get('X-User-Email')).toBe('a@example.invalid');
        expect(request.headers.get('X-Gnosi-Expected-User-ID')).toBe('user-a');
        expect(await request.json()).toMatchObject({ content: 'draft', expected_etag: 'original' });
        controller.abort();
        expect(request.signal.aborted).toBe(true);
    });
    it.each(['gnosi_workspace_id', 'gnosi_user_id', 'gnosi_user_email', 'gnosi_active_vault'])('does not send a queued write after %s changes', async field => {
        const context = scope();
        const fetchMock = vi.fn<typeof fetch>();
        vi.stubGlobal('fetch', fetchMock);
        let release: () => void = () => undefined;
        const previous = queuePageWrite(`queued-${field}`, () => new Promise<void>(resolve => { release = resolve; }));
        await Promise.resolve();
        const pending = patchVaultPage(`queued-${field}`, { content: 'old draft', expected_etag: 'old' }, { context });
        const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        writeApiTestStorage(field, 'new-scope');
        release(); await previous; await rejected;
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it('does not send a queued write after its signal is aborted', async () => {
        const context = scope();
        const fetchMock = vi.fn<typeof fetch>();
        vi.stubGlobal('fetch', fetchMock);
        const controller = new AbortController();
        controller.abort();
        await expect(patchVaultPage('aborted-write', { content: 'draft' }, { context, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
