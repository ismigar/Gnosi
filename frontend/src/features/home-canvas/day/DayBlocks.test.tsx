import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resetApiTestStorage, writeApiTestStorage } from '../../../../tests/api-request';
import { queryClient as sharedClient } from '../../../shared/api/query-client';
import { requestContextHeaders, currentRequestContext } from '../../../shared/api/request-context';
import type { ReaderPodcastInfo } from '../../../shared/api/reader';
import { dispatchWindowEvent } from '../../../shared/platform/browser-events';
import { ReaderPodcastPlayer } from '../../reader/ReaderPodcastPlayer';
import DayBlocks from './DayBlocks';

vi.mock('react-i18next', () => {
    const t = (key: string, options?: unknown) => key + (typeof options === 'object' ? JSON.stringify(options) : '');
    return { useTranslation: () => ({ t, i18n: { language: 'en' } }) };
});

let root: Root;
let host: HTMLDivElement;
let client: QueryClient;
let requests: Request[];
let reply: (path: string, req: Request) => Response | Promise<Response>;
const episode = { exists: true, episode_id: 'a'.repeat(64), filename: 'daily.mp3', created_at: '2026-11-23T05:00:00' };
const idle = { running: false, progress: '', error: null };
const now = new Date(2026, 10, 23, 10, 15);

async function update(action: () => void | Promise<void>) {
    await act(async () => { await action(); await new Promise(resolve => setTimeout(resolve, 10)); });
}
async function settled(check: () => void) {
    for (let attempt = 0; attempt < 55; attempt++) {
        await update(() => {});
        try { check(); return; } catch (error) { if (attempt === 54) throw error; }
    }
}
async function render(body: ReactNode) {
    await update(() => { root.render(<MemoryRouter><QueryClientProvider client={client}>{body}</QueryClientProvider></MemoryRouter>); });
}
function block(kind: 'agenda' | 'audio', width: 1 | 2 = 1) {
    return <DayBlocks block={{ id: kind, kind, width, settings: {} }} editing={false} onConfigure={() => {}} />;
}
function media() {
    const audio = host.querySelector('audio');
    if (!audio) throw new Error('Expected episode player');
    Object.defineProperty(audio, 'duration', { configurable: true, value: 900 });
    return audio;
}
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(finish => { resolve = finish; });
    return { resolve, promise };
}
beforeEach(() => {
    resetApiTestStorage();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    for (const [key, value] of Object.entries({ gnosi_active_vault: 'vault', gnosi_active_vault_slug: 'library', gnosi_workspace_id: 'workspace', gnosi_user_id: 'alex' })) {
        writeApiTestStorage(key, value);
    }
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
    client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    requests = [];
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async input => {
        if (!(input instanceof Request)) throw new Error('Expected an API client request');
        requests.push(input);
        return reply(new URL(input.url).pathname, input);
    }));
});
afterEach(async () => {
    await update(() => { root.unmount(); });
    host.remove(); client.clear(); sharedClient.clear(); resetApiTestStorage(); vi.unstubAllGlobals(); vi.useRealTimers();
});

it('loads only enabled and visible appointments, rescopes previous cached content and links to the selected day and event', async () => {
    const settings = deferred<Response>();
    const calendar = (id: string, source: string, start: string, end: string) => ({
        id, title: id, source, start, end, provider: 'google', account: 'a@example.test', calendar_id: 'work', calendar_name: 'Work', all_day: false,
    });
    reply = (path, request) => {
        if (path.endsWith('/integrations')) return request.headers.get('X-User-ID') === 'alex' ? Response.json({
            vault_calendar: { enabled_tables: ['appointments'] }, calendar_selection: { hidden_sources: ['a@example.test - Private'] },
        }) : settings.promise;
        if (path.endsWith('/tables')) return Response.json([{ id: 'appointments', name: 'Appointments' }]);
        if (path.endsWith('/pages')) return Response.json(['appointments', 'disabled'].map(table => ({
            id: table, title: table, metadata: {
                date: { kind: 'period', start: '2026-11-23T07:30:00', end: '2026-11-23T08:00:00', withTime: true }, table_id: table,
            }, path: '', folder: '',
        })));
        if (path.endsWith('/calendars')) return Response.json([]);
        if (path.endsWith('/events')) return Response.json([
            calendar('Current', 'a@example.test - Work', '2026-11-23T10:00:00', '2026-11-23T11:00:00'),
            calendar('Next', 'a@example.test - Work', '2026-11-23T11:00:00', '2026-11-23T12:00:00'),
            calendar('Hidden', 'a@example.test - Private', '2026-11-23T12:00:00', '2026-11-23T13:00:00'),
        ]);
        throw new Error(path);
    };
    await render(block('agenda'));
    await settled(() => { expect(host.querySelectorAll('li')).toHaveLength(2); });
    expect(host.querySelector('li a')?.getAttribute('href')).toBe('/@library/calendar/event/Current?date=2026-11-23&source=a%40example.test+-+Work');
    expect(host.textContent).toContain('home_canvas.day.now');
    expect(host.textContent).toContain('home_canvas.day.next');
    await render(block('agenda', 2));
    expect(host.querySelectorAll('li')).toHaveLength(3);
    expect(host.textContent).toContain('appointments');
    expect(host.textContent).not.toMatch(/disabled|Hidden/u);
    expect(requests.some(req => new URL(req.url).searchParams.get('expand_instances') === 'true')).toBe(true);
    for (const req of requests) {
        for (const [key, value] of Object.entries(requestContextHeaders(currentRequestContext()) ?? {})) expect(req.headers.get(key)).toBe(value);
    }
    await update(() => { writeApiTestStorage('gnosi_user_id', 'second-user'); dispatchWindowEvent(new StorageEvent('storage', { key: 'gnosi_user_id' })); });
    expect(host.textContent).not.toMatch(/Current|Next|appointments/u);
    settings.resolve(Response.json({ detail: 'unavailable' }, { status: 503 }));
    await settled(() => { expect(host.textContent).toContain('home_canvas.day.agenda_error'); });
    expect(host.querySelector('li')).toBeNull();
});

it('respects Calendar’s opt-in Vault table sources when an unbound dated page is present', async () => {
    reply = path => {
        if (path.endsWith('/integrations')) return Response.json({});
        if (path.endsWith('/pages')) return Response.json([{
            id: 'unbound', title: 'Unbound page', folder: 'Calendar',
            metadata: { date: { kind: 'period', start: '2026-11-23T10:00:00', end: '2026-11-23T11:00:00', withTime: true } },
        }]);
        return Response.json([]);
    };
    await render(block('agenda', 2));
    await settled(() => { expect(host.textContent).toContain('home_canvas.day.no_calendars'); });
    expect(host.textContent).not.toContain('Unbound page');
});

it('distinguishes loading, absence, generation and completion using read-only queries', async () => {
    const info = deferred<Response>();
    let metadata: ReaderPodcastInfo | null = null;
    let running = false;
    reply = path => path.endsWith('/info') ? (metadata ? Response.json(metadata) : info.promise)
        : Response.json(running ? { running, progress: '2 / 3', error: null } : idle);
    await render(block('audio'));
    expect(host.textContent).toContain('common.loading');
    metadata = { exists: false };
    info.resolve(Response.json(metadata));
    await settled(() => { expect(host.textContent).toContain('home_canvas.day.audio_empty'); });
    expect(host.querySelector('a')?.getAttribute('href')).toBe('/@library/reader');
    running = true;
    await update(async () => { await client.invalidateQueries({ queryKey: ['reader', 'podcast', 'status'] }); });
    expect(host.textContent).toContain('home_canvas.day.generation_progress');
    expect(host.textContent).not.toContain('audio_empty');
    running = false; metadata = episode;
    await update(async () => { await client.invalidateQueries({ queryKey: ['reader', 'podcast', 'status'] }); });
    await settled(() => { expect(host.querySelector('audio')).not.toBeNull(); });
    expect(host.textContent).toContain('November 23, 2026');
    expect(media().preload).toBe('none');
    expect(media().getAttribute('src')).toBe(`/api/v1/vaults/library/reader/podcast/episodes/${episode.episode_id}`);
    expect(requests.every(req => req.method === 'GET' && /\/podcast\/(info|status)$/u.test(new URL(req.url).pathname))).toBe(true);
});

it('restores progress across the Home and Reader players, independent of another episode, user and Vault', async () => {
    reply = path => Response.json(path.endsWith('/info') ? episode : idle);
    await render(block('audio'));
    await settled(() => { expect(host.querySelector('audio')).not.toBeNull(); });
    await update(() => {
        const audio = media(); audio.dispatchEvent(new Event('loadedmetadata'));
        audio.currentTime = 87.5; audio.dispatchEvent(new Event('seeked'));
    });
    const open = async (info = episode) => {
        await render(<ReaderPodcastPlayer info={info} />);
        await update(() => { media().dispatchEvent(new Event('loadedmetadata')); });
        return media().currentTime;
    };
    expect(await open()).toBe(87.5);
    expect(await open({ ...episode, episode_id: 'b'.repeat(64) })).toBe(0);
    for (const [field, other, original] of [['gnosi_user_id', 'other', 'alex'], ['gnosi_active_vault', 'other-vault', 'vault']] as const) {
        await update(() => { writeApiTestStorage(field, other); dispatchWindowEvent(new StorageEvent('storage', { key: field })); });
        expect(await open()).toBe(0);
        await update(() => { writeApiTestStorage(field, original); dispatchWindowEvent(new StorageEvent('storage', { key: field })); });
        expect(await open()).toBe(87.5);
    }
    await update(() => { const audio = media(); audio.currentTime = audio.duration; audio.dispatchEvent(new Event('ended')); });
    await render(null);
    expect(await open()).toBe(0);
});

it('retries an unavailable episode without overwriting its last saved position', async () => {
    const refresh = vi.fn();
    await render(<ReaderPodcastPlayer info={{ ...episode, episode_id: null }} onRefresh={refresh} />);
    expect(host.querySelector('audio')).toBeNull();
    expect(host.textContent).toContain('home_canvas.day.playback_error');
    await render(<ReaderPodcastPlayer info={episode} onRefresh={refresh} />);
    const audio = media();
    const reload = vi.fn();
    Object.defineProperty(audio, 'load', { configurable: true, value: reload });
    await update(() => {
        audio.dispatchEvent(new Event('loadedmetadata'));
        audio.currentTime = 35;
        audio.dispatchEvent(new Event('seeked'));
        audio.currentTime = 0;
        audio.dispatchEvent(new Event('error'));
        audio.dispatchEvent(new Event('pause'));
    });
    expect(host.textContent).toContain('home_canvas.day.playback_error');
    expect(audio.getAttribute('src')).toContain(episode.episode_id);
    await update(() => { host.querySelector('button')?.click(); });
    expect(refresh).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledOnce();
    await update(() => { audio.dispatchEvent(new Event('loadedmetadata')); });
    expect(audio.currentTime).toBe(35);
    expect(requests).toEqual([]);
});
