import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestAt, resetApiTestStorage, writeApiTestStorage } from '../../../../tests/api-request';
import { rememberAppPreview, readAppPreview } from '../../../shared/api/app-previews';
import { currentRequestContext } from '../../../shared/api/request-context';
import { fetchScheduledSocialPosts } from '../../../shared/api/social';
import { cacheBookmarkCollection } from '../../../shared/bookmarks/bookmark-migration';
import { subscribeAppEvent } from '../../../shared/platform/app-events';
import { makeBlock } from '../model';
import { livePreviewItems } from './live';
import OptionalBlock from './OptionalBlock';
import type { OptionalBlockKind } from './catalog';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
vi.mock('../../../shared/plugins/usePlugins', () => ({
    usePlugins: () => ({ isEnabled: () => true, getPluginSettings: () => ({ project_table_id: 'projects' }) }),
}));
vi.mock('../../../shared/auth/auth-context', () => ({
    useAuth: () => ({ requireAuth: false, gnosiMode: 'personal', user: null }),
}));

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    resetApiTestStorage();
    writeApiTestStorage('gnosi_active_vault', 'vault-a');
    writeApiTestStorage('gnosi_active_vault_slug', 'a');
    writeApiTestStorage('gnosi_user_id', 'member-a');
    host = document.createElement('div'); root = createRoot(host);
});

afterEach(() => {
    act(() => { root.unmount(); });
    vi.unstubAllGlobals(); resetApiTestStorage();
});

function render(kind: OptionalBlockKind) {
    act(() => { root.render(<MemoryRouter><OptionalBlock block={makeBlock(kind, kind)} editing={false} onConfigure={() => {}} /></MemoryRouter>); });
}

describe('optional home previews', () => {
    it('reads a small article list, pins the initiating identity and asks for no bodies', async () => {
        const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json([{ id: 2, title: 'A paper', source_name: 'Lab' }]));
        vi.stubGlobal('fetch', transport);
        const scope = currentRequestContext();
        writeApiTestStorage('gnosi_active_vault', 'different');
        expect(await livePreviewItems('feeds', scope, new AbortController().signal)).toEqual([{ id: '2', title: 'A paper', detail: 'Lab' }]);
        const request = requestAt(transport.mock.calls, 0);
        expect(request.method).toBe('GET');
        expect(request.headers.get('X-Vault-ID')).toBe('vault-a');
        expect(request.headers.get('X-User-ID')).toBe('member-a');
        expect(new URL(request.url).searchParams).toEqual(new URLSearchParams('include_content=false&limit=5&unread_only=true'));
    });

    it('opens every device-backed block without network reads or writes, including on a cold device', () => {
        const transport = vi.fn<typeof fetch>(); vi.stubGlobal('fetch', transport);
        const write = vi.spyOn(Storage.prototype, 'setItem');
        try {
            for (const kind of ['mail', 'media', 'planning', 'social', 'websites', 'bookmarks', 'assistant', 'settings'] as const) {
                render(kind);
                expect(host.textContent).toContain(`home_canvas.apps.${kind}.`);
            }
            expect(transport).not.toHaveBeenCalled();
            expect(write).not.toHaveBeenCalled();
        } finally { write.mockRestore(); }
    });

    it('uses the bounded local source lists and only shows automations with a scheduled next run', async () => {
        const transport = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(Response.json([{ id: 'person', name: 'Ada', company: 'Lab' }]))
            .mockResolvedValueOnce(Response.json({ searches: [{ id: 'lookup', query: 'botany', state: 'complete', result_count: 2 }] }))
            .mockResolvedValueOnce(Response.json({ items: [{ id: 'book', title: 'Field notes', resource_count: 7 }] }))
            .mockResolvedValueOnce(Response.json([
                { name: 'disabled', enabled: false, next_run: '2026-11-24T09:00:00Z' },
                { name: 'archive_feeds', enabled: true, next_run: '2026-11-24T10:00:00Z' },
            ]));
        vi.stubGlobal('fetch', transport);
        const scope = currentRequestContext(); const { signal } = new AbortController();
        expect(await livePreviewItems('contacts', scope, signal)).toEqual([{ id: 'person', title: 'Ada', detail: 'Lab' }]);
        expect(await livePreviewItems('resources', scope, signal)).toEqual([{ id: 'lookup', title: 'botany', count: 2 }]);
        expect(await livePreviewItems('notebooks', scope, signal)).toEqual([{ id: 'book', title: 'Field notes', count: 7 }]);
        expect(await livePreviewItems('automations', scope, signal)).toEqual([{ id: 'archive_feeds', title: 'archive feeds', date: '2026-11-24T10:00:00Z' }]);
        const requests = transport.mock.calls.map((_, index) => requestAt(transport.mock.calls, index));
        expect(requests.every(request => request.method === 'GET' && request.headers.get('X-Vault-ID') === scope.vaultId)).toBe(true);
        const urls = requests.map(request => new URL(request.url));
        expect(urls.map(url => url.pathname)).toEqual(['/api/contacts', '/api/vault/literature/searches', '/api/notebooks', '/api/schedulers']);
        expect(urls.map(url => url.searchParams.get('limit') ?? url.searchParams.get('page_size'))).toEqual(['5', '5', '5', null]);
    });

    it('bounds a saved project summary and rejects late results after a member or vault changes', () => {
        const scope = currentRequestContext();
        const projects = Array.from({ length: 12 }, (_, i) => ({ id: String(i), title: 'Project ' + String(i) }));
        rememberAppPreview('planning', scope, projects, 'projects');
        render('planning');
        expect(host.querySelectorAll('li')).toHaveLength(5);
        expect(host.querySelector('a')?.getAttribute('href')).toContain('/planning?project=0');
        expect(host.textContent).toContain('home_canvas.apps.last_seen');
        writeApiTestStorage('gnosi_user_id', 'another-member');
        rememberAppPreview('planning', scope, [{ id: 'late', title: 'Late result' }], 'projects');
        expect(readAppPreview('planning', scope)?.items[0]?.title).toBe('Project 0');
        expect(readAppPreview('planning', currentRequestContext())).toBeUndefined();
        writeApiTestStorage('gnosi_user_id', 'member-a');
        writeApiTestStorage('gnosi_active_vault', 'another-vault');
        expect(readAppPreview('planning', currentRequestContext())).toBeUndefined();
    });

    it('uses the validated cached bookmarks and builds links in the active vault', () => {
        cacheBookmarkCollection(currentRequestContext(), { sort_mode: 'manual', entries: [
            { id: 'saved', kind: 'page', target: 'record-4', label: 'Reading notes', group: 'Research', created_at: 12345 },
        ] });
        const transport = vi.fn<typeof fetch>(); vi.stubGlobal('fetch', transport);
        render('bookmarks');
        expect(host.textContent).toContain('Reading notes');
        expect(host.querySelector('a')?.getAttribute('href')).toContain('/knowledge/page/record-4');
        expect(transport).not.toHaveBeenCalled();
    });

    it('captures the actual social calendar read and displays it without another request', async () => {
        const post = { id: '7', content: 'Community event', networks: ['Mastodon'], scheduled_time: '2026-11-30T09:00:00Z', status: 'pending' };
        const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json([post]));
        vi.stubGlobal('fetch', transport);
        await fetchScheduledSocialPosts();
        render('social');
        expect(host.textContent).toContain('Community event');
        expect(host.textContent).toContain('Mastodon');
        expect(host.querySelector('time')?.dateTime).toBe('2026-11-30T09:00:00.000Z');
        expect(transport).toHaveBeenCalledTimes(1);
    });

    it('opens the selected local conversation only on activation and omits conversations outside the active vault', () => {
        const session = { id: 'topic', title: 'Reading group', updatedAt: 1234, messages: [{ role: 'user', content: 'Private contents' }] };
        writeApiTestStorage('agent_chat_sessions_v2:vault-a:personal:personal', JSON.stringify([session]));
        writeApiTestStorage('agent_chat_sessions_v2:other:personal:personal', JSON.stringify([{ ...session, title: 'Other vault' }]));
        const open = vi.fn();
        const stop = subscribeAppEvent('gnosi:open-assistant', open);
        try {
            render('assistant');
            expect(host.textContent).toContain('Reading group');
            expect(host.textContent).not.toContain('Other vault');
            expect(host.textContent).not.toContain('Private contents');
            expect(open).not.toHaveBeenCalled();
            act(() => { host.querySelector('li button')?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
            expect(open.mock.calls[0]?.[0]).toEqual({ sessionId: 'topic' });
        } finally { stop(); }
    });
});
