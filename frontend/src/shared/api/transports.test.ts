import { resetApiTestStorage, writeApiTestStorage } from '../../../tests/api-request';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { transportFetch } from './transports';
import { persistVaultCatalog } from './vault-context';


beforeEach(() => {
  resetApiTestStorage();
  persistVaultCatalog([
    { id: 'vault-a', name: 'Història', slug: 'historia' },
  ]);
  writeApiTestStorage('gnosi_active_vault', 'vault-a');
  writeApiTestStorage('gnosi_active_vault_slug', 'historia');
  writeApiTestStorage('gnosi_workspace_id', 'workspace-a');
  writeApiTestStorage('gnosi_user_id', 'user-a');
});


afterEach(() => {
  resetApiTestStorage();
  vi.unstubAllGlobals();
});


describe('transportFetch', () => {
  it('canonicalizes same-origin Vault APIs and carries request context', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(null, { status: 204 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    await transportFetch('/api/vault/pages/page-1?full=true');

    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(input).toBe('/api/v1/vaults/historia/knowledge/pages/page-1?full=true');
    expect(init?.credentials).toBe('include');
    const headers = new Headers(init?.headers);
    expect(headers.get('X-Vault-ID')).toBe('vault-a');
    expect(headers.get('X-Workspace-ID')).toBe('workspace-a');
    expect(headers.get('X-User-ID')).toBe('user-a');
  });


  it('keeps an explicit unknown Vault on the legacy URL', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(null, { status: 204 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    await transportFetch('/api/vault/pages/page-1', {
      headers: { 'X-Vault-ID': 'vault-not-in-catalog' },
    });

    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(input).toBe('/api/vault/pages/page-1');
    expect(new Headers(init?.headers).get('X-Vault-ID')).toBe('vault-not-in-catalog');
  });


  it('does not leak Gnosi context to third-party URLs', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(null, { status: 204 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    await transportFetch('https://example.test/catalog.json');

    expect(fetchMock).toHaveBeenCalledWith('https://example.test/catalog.json', undefined);
  });


  it('preserves Request instances without cloning one-shot bodies', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(null, { status: 204 })),
    );
    vi.stubGlobal('fetch', fetchMock);
    const request = new Request(`${location.origin}/api/health`);

    await transportFetch(request);

    expect(fetchMock).toHaveBeenCalledWith(request, undefined);
  });
});
