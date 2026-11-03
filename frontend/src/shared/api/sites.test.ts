import { afterEach, expect, it, vi } from 'vitest';
import { requestAt, resetApiTestStorage } from '../../../tests/api-request';
import { removeSite, saveSite, type SiteConfig } from './sites';

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

it.each([{ actions: null }, { actions: [] }, { actions: [{ label: 'Hero', href: '/ca/hero' }] }])('normalizes legacy website defaults without changing null or cleared hero actions ($actions)', async ({ actions }) => {
  const site: SiteConfig = {
    id: 'website', name: 'Legacy website', schema_version: 1, revision: 1, default_language: 'ca', languages: ['ca'], origin: 'https://example.invalid', legacy_pilot: false,
    theme: { schema_version: 1, name: 'Theme', tokens: {}, logo: '', logo_alt: '', favicon: '', advanced_css: '' },
    navigation: [{ label: 'Menu', href: '/ca' }], footer: [{ label: 'Footer', href: '/ca/footer', appearance: 'outline' }], social_links: [], header_actions: [{ label: 'Support', href: '/ca/support', appearance: 'button' }], redirects: {}, targets: [], forms: [],
    sources: [{ id: 'articles', kind: 'table', source_id: 'articles', enabled: true, title: 'Articles', field_ids: [], include_body: true, attachment_field_ids: [], filters: [], sort_descending: false, presentation: 'cards', path_prefix: '/blog', page_ids: [], selection_mode: 'all', withdrawn_ids: [], withdrawn_versions: {} }],
    pages: [{ id: 'home', language: 'ca', title: 'Home', path: '/ca', enabled: true, description: '', template: 'home', css: '', blocks: [{ id: 'hero', type: 'split', title: '', body: '', image: '', alt: '', image_position: 'right', href: '', columns: 3, limit: 3, css: '', actions }] }],
  };
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json(site));
  vi.stubGlobal('fetch', fetchMock);
  await saveSite(site, { userId: 'owner', workspaceId: 'workspace', vaultId: 'vault', userEmail: 'owner@example.invalid' });
  const request = requestAt(fetchMock.mock.calls, 0);
  expect(await request.json()).toMatchObject({
    navigation: [{ label: 'Menu', href: '/ca', appearance: 'link' }], footer: [{ appearance: 'outline' }], header_actions: [{ appearance: 'button' }],
    sources: [{ page_size: 16, show_tag_filter: false }],
    pages: [{ blocks: [{ actions: actions?.map(action => ({ ...action, appearance: 'link' })) ?? null }] }],
  });
  expect(site).not.toHaveProperty('navigation.0.appearance');
  expect(site).not.toHaveProperty('sources.0.page_size');
});
