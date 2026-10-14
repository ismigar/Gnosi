import { afterEach, expect, it, vi } from 'vitest';
import { resetApiTestStorage, writeApiTestStorage } from '../../../tests/api-request';
import { fetchPublicForm, submitPublicForm } from './forms';

afterEach(() => { resetApiTestStorage(); vi.unstubAllGlobals(); });

it('reads and submits the public form without forwarding a signed-in visitor context', async () => {
  resetApiTestStorage();
  writeApiTestStorage('gnosi_active_vault', 'private-visitor-vault');
  writeApiTestStorage('gnosi_workspace_id', 'private-visitor-workspace');
  writeApiTestStorage('gnosi_user_id', 'private-visitor');
  writeApiTestStorage('gnosi_user_email', 'private@example.test');
  const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(Response.json({ title: 'Survey', description: '', fields: [] })));
  vi.stubGlobal('fetch', fetchMock);
  await fetchPublicForm('public-token');
  fetchMock.mockResolvedValueOnce(Response.json({ status: 'accepted' }));
  const input = { request_id: 'stable-public-response', values: { field_0: 'Guest' }, website: '' };
  await submitPublicForm('public-token', input);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  for (const [index, [request]] of fetchMock.mock.calls.entries()) {
    if (!(request instanceof Request)) throw new Error('Expected a generated client Request');
    expect(new URL(request.url).pathname).toBe(`/api/forms/public/public-token${index ? '/submissions' : ''}`);
    expect(request.credentials).toBe('omit');
    expect(request.cache).toBe('no-store');
    expect(request.referrerPolicy).toBe('no-referrer');
    for (const header of ['Authorization', 'Cookie', 'X-Vault-ID', 'X-Workspace-ID', 'X-User-ID', 'X-User-Email']) {
      expect(request.headers.has(header)).toBe(false);
    }
    if (index) {
      expect(request.method).toBe('POST');
      await expect(request.clone().json()).resolves.toEqual(input);
    } else expect(request.method).toBe('GET');
  }
});
