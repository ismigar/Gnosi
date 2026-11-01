import { afterEach, expect, it, vi } from 'vitest';
import { requestAt, resetApiTestStorage } from '../../../tests/api-request';
import { removeSite } from './sites';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); resetApiTestStorage(); });

it('removes a website with its revision and captured scope, accepting an empty 204', async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
  const context = { userId: 'owner', workspaceId: 'workspace', vaultId: 'vault', userEmail: 'owner@example.invalid' };
  await expect(removeSite('website', 7, context, new AbortController().signal)).resolves.toBeUndefined();
  const request = requestAt(fetchMock.mock.calls, 0);
  expect(request.method).toBe('DELETE');
  expect(new URL(request.url).searchParams.get('revision')).toBe('7');
  expect(request.headers.get('X-Workspace-ID')).toBe('workspace');
  expect(request.headers.get('X-Vault-ID')).toBe('vault');
  expect(request.headers.get('X-User-ID')).toBe('owner');
});

it('propagates a rejected website removal', async () => {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(Response.json({ detail: 'The website changed' }, { status: 409 })));
  const context = { userId: 'owner', userEmail: 'owner@example.invalid', workspaceId: 'workspace', vaultId: 'vault' };
  await expect(removeSite('website', 7, context)).rejects.toThrow('The website changed');
});
