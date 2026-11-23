import { afterEach, expect, it, vi } from 'vitest';
import { requestAt, resetApiTestStorage, writeApiTestStorage } from '../../../tests/api-request';
import { fetchVaultLinkNeighborhood } from './vault-neighborhood';

afterEach(() => { resetApiTestStorage(); vi.unstubAllGlobals(); });

it('sends the originating scope and abort signal after the active Vault has changed', async () => {
  writeApiTestStorage('gnosi_active_vault', 'new-vault');
  const result = { incoming: [], outgoing: ['target'], incoming_complete: false };
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(result));
  vi.stubGlobal('fetch', fetch);
  const controller = new AbortController();
  const scope = { vaultId: 'original-vault', workspaceId: 'workspace', userId: 'reader', userEmail: 'reader@example.test' };
  await expect(fetchVaultLinkNeighborhood('note / one', controller.signal, scope)).resolves.toEqual(result);
  const request = requestAt(fetch.mock.calls, 0);
  const url = new URL(request.url);
  expect([url.pathname, url.searchParams.get('page_id')]).toEqual(['/api/vault/link-neighborhood', 'note / one']);
  expect(request.headers.get('X-Vault-ID')).toBe(scope.vaultId);
  expect(request.headers.get('X-Workspace-ID')).toBe(scope.workspaceId);
  expect(request.headers.get('X-User-ID')).toBe(scope.userId);
  expect(request.headers.get('X-User-Email')).toBe(scope.userEmail);
  controller.abort();
  expect(request.signal.aborted).toBe(true);
});
