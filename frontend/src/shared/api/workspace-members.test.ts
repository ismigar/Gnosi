import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fetchWorkspaceMembers,
  fetchWorkspaceMemberVaults,
  fetchWorkspaceVaults,
  grantWorkspaceMemberVault,
  inviteWorkspaceMember,
  removeWorkspaceMember,
  revokeWorkspaceMemberVault,
  updateWorkspaceMemberRole,
} from './workspace-members';


interface RecordedFetch {
  readonly mock: {
    readonly calls: readonly (readonly [RequestInfo | URL, RequestInit?])[];
  };
}


function toRequest(input: RequestInfo | URL, init?: RequestInit): Request {
  return input instanceof Request ? input : new Request(input, init);
}


function requestAt(fetchMock: RecordedFetch, index = 0): Request {
  const call = fetchMock.mock.calls[index];
  if (!call) throw new Error(`Missing fetch call ${String(index)}`);
  return toRequest(call[0], call[1]);
}


function stubJson(payload: unknown) {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockImplementation(() => Promise.resolve(Response.json(payload)));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}


afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});


describe('workspace members API', () => {
  it('loads members, workspace Vaults and member Vault access', async () => {
    const member = {
      user_id: 'user-1',
      email: 'member@corp.com',
      name: 'Member',
      role: 'editor',
      permissions: { capabilities: ['read', 'write'] },
      joined_at: '2026-08-29T10:00:00+00:00',
    };
    const vault = { id: 'vault-1', name: 'Research' };
    const access = {
      vault_id: 'vault-1',
      vault_name: 'Research',
      permissions: { capabilities: ['read'] },
    };
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((input, init) => {
      const path = new URL(toRequest(input, init).url).pathname;
      if (path === '/api/workspaces/ws-1/members') {
        return Promise.resolve(Response.json([member]));
      }
      if (path === '/api/workspaces/ws-1/vaults') {
        return Promise.resolve(Response.json([vault]));
      }
      if (path === '/api/workspaces/ws-1/members/user-1/vaults') {
        return Promise.resolve(Response.json([access]));
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchWorkspaceMembers('ws-1')).resolves.toEqual([member]);
    await expect(fetchWorkspaceVaults('ws-1')).resolves.toEqual([vault]);
    await expect(fetchWorkspaceMemberVaults('ws-1', 'user-1')).resolves.toEqual([
      access,
    ]);

    expect(requestAt(fetchMock, 0).method).toBe('GET');
    expect(requestAt(fetchMock, 1).method).toBe('GET');
    expect(requestAt(fetchMock, 2).method).toBe('GET');
  });

  it('invites a member with the established body', async () => {
    const payload = { status: 'ok', message: 'Member added' };
    const fetchMock = stubJson(payload);

    await expect(
      inviteWorkspaceMember('ws-1', {
        email: 'new@corp.com',
        role: 'viewer',
      }),
    ).resolves.toEqual(payload);

    const request = requestAt(fetchMock);
    expect(request.method).toBe('POST');
    expect(new URL(request.url).pathname).toBe('/api/workspaces/ws-1/members');
    await expect(request.clone().json()).resolves.toEqual({
      email: 'new@corp.com',
      role: 'viewer',
    });
  });

  it('removes a member through the path identifiers', async () => {
    const payload = { status: 'ok', message: 'Member removed' };
    const fetchMock = stubJson(payload);

    await expect(removeWorkspaceMember('ws-1', 'user-1')).resolves.toEqual(
      payload,
    );

    const request = requestAt(fetchMock);
    expect(request.method).toBe('DELETE');
    expect(new URL(request.url).pathname).toBe(
      '/api/workspaces/ws-1/members/user-1',
    );
  });

  it('updates a role and preserves dynamic permissions', async () => {
    const payload = { status: 'ok', message: 'Member updated' };
    const fetchMock = stubJson(payload);

    await expect(
      updateWorkspaceMemberRole('ws-1', 'user-1', {
        role: 'admin',
        permissions: {
          capabilities: ['read', 'write', 'admin'],
          extension: { managed: true },
        },
      }),
    ).resolves.toEqual(payload);

    const request = requestAt(fetchMock);
    expect(request.method).toBe('PUT');
    expect(new URL(request.url).pathname).toBe(
      '/api/workspaces/ws-1/members/user-1/role',
    );
    await expect(request.clone().json()).resolves.toEqual({
      role: 'admin',
      permissions: {
        capabilities: ['read', 'write', 'admin'],
        extension: { managed: true },
      },
    });
  });

  it('grants Vault access without changing the historical JSON body', async () => {
    const payload = { status: 'ok', message: 'Vault access updated' };
    const fetchMock = stubJson(payload);

    await expect(
      grantWorkspaceMemberVault('ws-1', 'user-1', {
        vault_id: 'vault-1',
        permissions: { capabilities: ['read'] },
      }),
    ).resolves.toEqual(payload);

    const request = requestAt(fetchMock);
    expect(request.method).toBe('POST');
    expect(new URL(request.url).pathname).toBe(
      '/api/workspaces/ws-1/members/user-1/vaults',
    );
    await expect(request.clone().json()).resolves.toEqual({
      vault_id: 'vault-1',
      permissions: { capabilities: ['read'] },
    });
  });

  it('revokes Vault access through all path identifiers', async () => {
    const payload = { status: 'ok', message: 'Vault access revoked' };
    const fetchMock = stubJson(payload);

    await expect(
      revokeWorkspaceMemberVault('ws-1', 'user-1', 'vault-1'),
    ).resolves.toEqual(payload);

    const request = requestAt(fetchMock);
    expect(request.method).toBe('DELETE');
    expect(new URL(request.url).pathname).toBe(
      '/api/workspaces/ws-1/members/user-1/vaults/vault-1',
    );
  });
});
