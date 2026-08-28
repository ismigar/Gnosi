import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiClient } from './client';
import { GnosiApiError, unwrapApiResult } from './errors';


afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});


describe('apiClient', () => {
  it('adds the current workspace, user and Vault context', async () => {
    localStorage.setItem('gnosi_workspace_id', 'workspace-1');
    localStorage.setItem('gnosi_user_id', 'user-1');
    localStorage.setItem('gnosi_user_email', 'user@example.test');
    localStorage.setItem('gnosi_active_vault', 'vault-1');
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(JSON.stringify({ status: 'healthy' }), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        })),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await apiClient.GET('/api/health');

    expect(result.error).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledOnce();
    const request = fetchMock.mock.calls[0]?.[0];
    expect(request).toBeInstanceOf(Request);
    if (!(request instanceof Request)) throw new Error('Expected a Request instance');
    expect(request.credentials).toBe('include');
    expect(request.headers.get('X-Workspace-ID')).toBe('workspace-1');
    expect(request.headers.get('X-User-ID')).toBe('user-1');
    expect(request.headers.get('X-User-Email')).toBe('user@example.test');
    expect(request.headers.get('X-Vault-ID')).toBe('vault-1');
  });
});


describe('unwrapApiResult', () => {
  it('normalizes typed API failures', () => {
    const response = new Response(null, { status: 409, statusText: 'Conflict' });

    expect(() =>
      unwrapApiResult({
        error: { detail: { message: 'The page changed' } },
        response,
      }),
    ).toThrowError(new GnosiApiError(response, { detail: { message: 'The page changed' } }));
  });
});
