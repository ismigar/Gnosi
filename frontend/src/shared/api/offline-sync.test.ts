// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { currentRequestContext } from './request-context';
import { offlineRemote } from './offline-sync';

vi.mock('./request-context', () => ({ currentRequestContext: vi.fn() }));
vi.mock('./transports', () => ({ transportFetch: (...args: Parameters<typeof fetch>) => fetch(...args) }));
const scope = { origin: 'https://gnosi.example.invalid', userId: 'account-a', userEmail: 'a@example.invalid', workspaceId: 'workspace-a', vaultId: 'vault-a' };
const page = { id: 'note-a', title: 'Private title', content: '# Content', etag: 'v1', metadata: {}, folder: '' };
const requests: Request[] = [];
beforeEach(() => {
    vi.stubGlobal('location', { origin: scope.origin });
    vi.mocked(currentRequestContext).mockReturnValue(scope);
    requests.length = 0;
    vi.stubGlobal('fetch', vi.fn((request: Request) => {
        requests.push(request);
        return Promise.resolve(new Response(JSON.stringify(page), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }));
});

it('uses pinned scope, expectation-only identity, no-store requests and a conditional PATCH', async () => {
    await offlineRemote.write(scope, 'note-a', 'Local text', 'base-v1', new AbortController().signal);
    const request = requests[0];
    expect(request?.url).toBe(`${scope.origin}/api/vault/pages/note-a`);
    expect(request?.cache).toBe('no-store');
    expect(request?.credentials).toBe('same-origin');
    expect(request?.redirect).toBe('error');
    expect(request?.headers.get('X-Gnosi-Expected-User-ID')).toBe(scope.userId);
    expect(request?.headers.get('X-Workspace-ID')).toBe(scope.workspaceId);
    expect(request?.headers.get('X-Vault-ID')).toBe(scope.vaultId);
    expect(await request?.json()).toEqual({ content: 'Local text', expected_etag: 'base-v1', force: false });
});

it('rejects unversioned writes, scope switches and cross-origin scopes before network access', async () => {
    const signal = new AbortController().signal;
    await expect(offlineRemote.write(scope, 'note-a', 'Local', '', signal)).rejects.toMatchObject({ code: 'etag' });
    await expect(offlineRemote.read({ ...scope, origin: 'https://other.example.invalid' }, 'note-a', signal)).rejects.toMatchObject({ code: 'scope' });
    vi.mocked(currentRequestContext).mockReturnValue({ ...scope, vaultId: 'vault-b' });
    await expect(offlineRemote.read(scope, 'note-a', signal)).rejects.toMatchObject({ code: 'scope' });
    expect(fetch).not.toHaveBeenCalled();
});

it('rejects server account-switch guards and non-Markdown pages', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ detail: { code: 'account_changed' } }), { status: 409 }));
    await expect(offlineRemote.read(scope, 'note-a', new AbortController().signal)).rejects.toMatchObject({ code: 'scope' });
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ...page, metadata: { is_dashboard: true } }), { status: 200 }));
    await expect(offlineRemote.read(scope, 'note-a', new AbortController().signal)).rejects.toMatchObject({ code: 'format' });
});

it('verifies authenticated user, workspace membership and the selected Vault before sync', async () => {
    vi.mocked(fetch)
        .mockResolvedValueOnce(new Response(JSON.stringify({ id: scope.userId, email: scope.userEmail, workspaces: [{ id: scope.workspaceId }] })))
        .mockResolvedValueOnce(new Response(JSON.stringify({ vaults: [{ id: 'other-vault' }] })));
    await expect(offlineRemote.verify(scope, new AbortController().signal)).rejects.toMatchObject({ code: 'scope' });
    expect(vi.mocked(fetch).mock.calls).toHaveLength(2);
});
