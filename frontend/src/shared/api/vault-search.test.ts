import { afterEach, expect, it, vi } from 'vitest';
import { requestAt, resetApiTestStorage, writeApiTestStorage } from '../../../tests/api-request';
import { searchVaultContent } from './vault-search';

afterEach(() => { resetApiTestStorage(); vi.unstubAllGlobals(); });

it('pins all scope headers to the captured search context', async () => {
  writeApiTestStorage('gnosi_workspace_id', 'changed-workspace');
  writeApiTestStorage('gnosi_user_id', 'changed-user');
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ results: [], total: 0, offset: 0, limit: 50 }));
  vi.stubGlobal('fetch', fetchMock);
  await searchVaultContent('body', {
    context: { workspaceId: 'original-workspace', userId: 'original-user', userEmail: 'test@example.invalid', vaultId: 'original-vault' },
  });
  const headers = requestAt(fetchMock.mock.calls, 0).headers;
  expect(headers.get('X-Workspace-ID')).toBe('original-workspace');
  expect(headers.get('X-User-ID')).toBe('original-user');
  expect(headers.get('X-Vault-ID')).toBe('original-vault');
});
