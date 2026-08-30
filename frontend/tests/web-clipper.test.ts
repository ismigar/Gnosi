/* Web Clipper popup logic.
 *
 * popup.js is a plain browser script that declares globals and wires itself up
 * on DOMContentLoaded — there is nothing to import. Each test builds the popup
 * DOM and evaluates the real script in an isolated VM with local `chrome.*`
 * doubles and mocked HTTP. Each instance releases its DOMContentLoaded listener.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadPopup, mountPopup, stubChrome } from './helpers/clipper';
import { button, input, node, option, select, textarea } from './helpers/dom';
import { installFetch, jsonResponse, request, requestBody, requestUrl, type FetchMock } from './helpers/network';

let fetchMock: FetchMock;
let popup: ReturnType<typeof loadPopup> | undefined;

beforeEach(() => {
    mountPopup();
    fetchMock = installFetch();
});

afterEach(() => {
    try {
        popup?.dispose();
    } finally {
        popup = undefined;
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        document.body.replaceChildren();
    }
});

const status = () => node('status').textContent;
const statusClass = () => node('status').className;

describe('web clipper popup', () => {
    it('falls back to the documented default backend when storage is empty', async () => {
        const chrome = stubChrome({});
        popup = loadPopup(chrome);
        await popup.loadConfig();
        expect(input('backend').value).toBe('https://localhost:5173');
        expect(input('token').value).toBe('');
    });

    it('restores a stored backend and token', async () => {
        const chrome = stubChrome({ backend: 'https://gnosi.example.com', token: 'gnosi_pat_abc' });
        popup = loadPopup(chrome);
        await popup.loadConfig();
        expect(input('backend').value).toBe('https://gnosi.example.com');
        expect(input('token').value).toBe('gnosi_pat_abc');
    });

    it('trims whitespace when saving config', async () => {
        const store = {};
        const chrome = stubChrome(store);
        const warning = vi.spyOn(console, 'warn');
        fetchMock.mockResolvedValue(jsonResponse({ enabled: true, table: null, fields: [] }));
        popup = loadPopup(chrome);
        input('backend').value = '  https://x.test  ';
        input('token').value = '  gnosi_pat_z  ';
        await popup.saveConfig();
        expect(store).toEqual({ backend: 'https://x.test', token: 'gnosi_pat_z' });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const configRequest = request(fetchMock);
        expect(configRequest.url).toBe('https://x.test/api/public/clip/config');
        expect(configRequest.init?.method ?? 'GET').toBe('GET');
        expect(configRequest.headers.get('Authorization')).toBe('Bearer gnosi_pat_z');
        expect(warning).not.toHaveBeenCalled();
    });

    it('refuses to clip before it is configured, and does not call the network', async () => {
        const chrome = stubChrome({});
        popup = loadPopup(chrome);
        await popup.clip(false);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(statusClass()).toBe('err');
    });

    it('posts to /api/public/clip with the bearer token and page metadata', async () => {
        const chrome = stubChrome(
            { backend: 'https://gnosi.example.com', token: 'gnosi_pat_abc' },
            { tab: { id: 3, url: 'https://example.org/p', title: 'Title' }, selection: 'picked text' },
        );
        fetchMock.mockResolvedValue(jsonResponse({ path: 'Clips/Title.md' }));
        popup = loadPopup(chrome);
        textarea('note').value = 'my note';
        input('tags').value = ' a , b ,, c ';
        await popup.clip(false);

        const { url, init, headers } = request(fetchMock);
        expect(url).toBe('https://gnosi.example.com/api/public/clip');
        expect(init?.method).toBe('POST');
        expect(headers.get('Authorization')).toBe('Bearer gnosi_pat_abc');
        expect(headers.get('Content-Type')).toBe('application/json');
        const body = requestBody(fetchMock);
        expect(body.url).toBe('https://example.org/p');
        expect(body.title).toBe('Title');
        // Empty tag fragments must not become empty tags.
        expect(body.tags).toEqual(['a', 'b', 'c']);
        expect(status()).toContain('Clips/Title.md');
    });

    it('strips a trailing slash off the backend instead of double-slashing', async () => {
        const chrome = stubChrome({ backend: 'https://gnosi.example.com/', token: 't' });
        fetchMock.mockResolvedValue(jsonResponse());
        popup = loadPopup(chrome);
        await popup.clip(false);
        expect(request(fetchMock).url).toBe('https://gnosi.example.com/api/public/clip');
    });

    it('combines note and selection for a full clip', async () => {
        const chrome = stubChrome({ backend: 'https://b.test', token: 't' }, { selection: 'sel' });
        fetchMock.mockResolvedValue(jsonResponse());
        popup = loadPopup(chrome);
        textarea('note').value = 'note';
        await popup.clip(false);
        expect(requestBody(fetchMock).content).toBe('note\n\nsel');
    });

    it('sends only the selection when clipping a selection', async () => {
        const chrome = stubChrome({ backend: 'https://b.test', token: 't' }, { selection: 'sel' });
        fetchMock.mockResolvedValue(jsonResponse());
        popup = loadPopup(chrome);
        textarea('note').value = 'note';
        await popup.clip(true);
        expect(requestBody(fetchMock).content).toBe('sel');
    });

    it('falls back to the note when clipping a selection that is empty', async () => {
        const chrome = stubChrome({ backend: 'https://b.test', token: 't' }, { selection: '' });
        fetchMock.mockResolvedValue(jsonResponse());
        popup = loadPopup(chrome);
        textarea('note').value = 'note';
        await popup.clip(true);
        expect(requestBody(fetchMock).content).toBe('note');
    });

    it('names a revoked token instead of reporting a generic failure', async () => {
        const chrome = stubChrome({ backend: 'https://b.test', token: 'bad' });
        fetchMock.mockResolvedValue(jsonResponse({}, 401));
        popup = loadPopup(chrome);
        await popup.clip(false);
        expect(status()).toContain('401');
        expect(statusClass()).toBe('err');
    });

    it('reports a transport failure without throwing out of clip()', async () => {
        const chrome = stubChrome({ backend: 'https://b.test', token: 't' });
        fetchMock.mockRejectedValue(new Error('refused'));
        popup = loadPopup(chrome);
        await expect(popup.clip(false)).resolves.toBeUndefined();
        expect(status()).toContain('refused');
        expect(statusClass()).toBe('err');
    });

    it('names a disabled clipper plugin instead of a generic 403', async () => {
        const chrome = stubChrome({ backend: 'https://b.test', token: 't' });
        fetchMock.mockResolvedValue(jsonResponse({}, 403));
        popup = loadPopup(chrome);
        await popup.clip(false);
        expect(status()).toContain('disabled');
        expect(statusClass()).toBe('err');
    });

    it('survives a page where the selection script cannot run', async () => {
        const chrome = stubChrome({ backend: 'https://b.test', token: 't' });
        chrome.scripting.executeScript.mockRejectedValue(new Error('blocked on this page'));
        fetchMock.mockResolvedValue(jsonResponse());
        popup = loadPopup(chrome);
        textarea('note').value = 'note';
        await popup.clip(false);
        expect(requestBody(fetchMock).content).toBe('note');
    });
});

/* The destination table and its columns come from the backend, so the popup has
 * no hardcoded schema: it renders whatever /api/public/clip/config returns. */
describe('destination table form', () => {
    interface ClipSchema {
        enabled: boolean;
        table: { id: string; name: string } | null;
        fields: {
            id: string;
            name: string;
            type: 'number' | 'select' | 'multi_select' | 'checkbox';
            options?: string[];
        }[];
    }

    /** Stub only the configuration and clip endpoints; reject unexpected URLs. */
    function stubConfig(config: ClipSchema): void {
        fetchMock.mockImplementation((url) => {
            const address = requestUrl(url);
            if (address === 'https://b.test/api/public/clip/config') {
                return Promise.resolve(jsonResponse(config));
            }
            if (address === 'https://b.test/api/public/clip') {
                return Promise.resolve(jsonResponse({ table: 'Recursos' }));
            }
            return Promise.reject(new Error(`Unexpected fixture request: ${address}`));
        });
    }

    const SCHEMA: ClipSchema = {
        enabled: true,
        table: { id: 'resources', name: 'Recursos' },
        fields: [
            { id: 'fld_rating', name: 'Valoració', type: 'number' },
            { id: 'fld_state', name: 'Estat', type: 'select', options: ['Esborrany', 'Revisat'] },
            { id: 'fld_topics', name: 'Temes', type: 'multi_select', options: ['IA', 'Ètica'] },
            { id: 'fld_done', name: 'Fet', type: 'checkbox' },
        ],
    };

    it('renders one control per configured column and shows the destination', async () => {
        const chrome = stubChrome({ backend: 'https://b.test', token: 't' });
        stubConfig(SCHEMA);
        popup = loadPopup(chrome);
        await popup.loadClipSchema();

        expect(node('target').textContent).toContain('Recursos');
        expect(input('fld:fld_rating').type).toBe('number');
        expect(input('fld:fld_done').type).toBe('checkbox');
        const state = select('fld:fld_state');
        // Leading blank option: an untouched column must stay empty.
        expect([...state.options].map((o) => o.value)).toEqual(['', 'Esborrany', 'Revisat']);
        expect(select('fld:fld_topics').multiple).toBe(true);
    });

    it('sends the filled columns and omits the untouched ones', async () => {
        const chrome = stubChrome({ backend: 'https://b.test', token: 't' });
        stubConfig(SCHEMA);
        popup = loadPopup(chrome);
        await popup.loadClipSchema();

        input('fld:fld_rating').value = '5';
        input('fld:fld_done').checked = true;
        const topics = select('fld:fld_topics');
        option(topics, 1).selected = true; // 'IA' (index 0 is the blank option)
        await popup.clip(false);

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(request(fetchMock, 1).url).toBe('https://b.test/api/public/clip');
        // 'fld_state' was left untouched, so it must not appear at all: sending
        // it empty would overwrite the column's default value on the record.
        expect(requestBody(fetchMock, 1).fields).toEqual({
            fld_rating: '5', fld_done: true, fld_topics: ['IA'],
        });
    });

    it('says so when the plugin is disabled, and blocks clipping', async () => {
        const chrome = stubChrome({ backend: 'https://b.test', token: 't' });
        stubConfig({ enabled: false, table: null, fields: [] });
        popup = loadPopup(chrome);
        await popup.loadClipSchema();

        expect(node('target').textContent).toContain('disabled');
        expect(button('clip').disabled).toBe(true);
        expect(button('clipSelection').disabled).toBe(true);
    });

    it('keeps clipping usable when the schema cannot be loaded', async () => {
        const chrome = stubChrome({ backend: 'https://b.test', token: 't' });
        const offline = new Error('offline');
        const warning = vi.spyOn(console, 'warn');
        fetchMock.mockRejectedValue(offline);
        popup = loadPopup(chrome);
        await expect(popup.loadClipSchema()).resolves.toBeUndefined();
        expect(button('clip').disabled).toBe(false);
        expect(warning).toHaveBeenCalledExactlyOnceWith('Could not load the clipper configuration', offline);
    });

    it('does not call the config endpoint before it is configured', async () => {
        const chrome = stubChrome({});
        popup = loadPopup(chrome);
        await popup.loadClipSchema();
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
