/* Web Clipper popup logic.
 *
 * popup.js is a plain browser script that declares globals and wires itself up
 * on DOMContentLoaded — there is nothing to import. Each test builds the popup
 * DOM, stubs the `chrome.*` surface and `fetch`, then evaluates the script so
 * its globals land on the jsdom window, which is how it runs in the browser.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = path.dirname(fileURLToPath(import.meta.url));

const POPUP_JS = path.resolve(here, '../../web-clipper/popup.js');
const source = fs.readFileSync(POPUP_JS, 'utf-8');

/** Minimal popup DOM: the ids popup.js reaches for by getElementById. */
function mountDom() {
    document.body.innerHTML = `
        <input id="backend" /><input id="token" />
        <textarea id="note"></textarea><input id="tags" />
        <div id="status"></div>
        <button id="save"></button><button id="clip"></button>
        <button id="clipSelection"></button>`;
}

/** Install a chrome stub; `store` is the backing storage.local state. */
function stubChrome(store = {}, { tab, selection = '' } = {}) {
    const chrome = {
        storage: {
            local: {
                get: vi.fn(async (keys) =>
                    Object.fromEntries(keys.map((k) => [k, store[k]]))),
                set: vi.fn(async (patch) => Object.assign(store, patch)),
            },
        },
        tabs: {
            query: vi.fn(async () => [tab ?? {
                id: 7, url: 'https://example.org/a', title: 'A page',
            }]),
        },
        scripting: {
            executeScript: vi.fn(async () => [{ result: selection }]),
        },
    };
    globalThis.chrome = chrome;
    window.chrome = chrome;
    return chrome;
}

/** Evaluate popup.js against the current window and return its globals. */
function loadPopup() {
    const ctx = { window, document, chrome: globalThis.chrome, fetch: globalThis.fetch, console };
    ctx.globalThis = ctx;
    vm.createContext(ctx);
    vm.runInContext(source, ctx);
    return ctx;
}

const status = () => document.getElementById('status').textContent;
const statusClass = () => document.getElementById('status').className;

describe('web clipper popup', () => {
    beforeEach(() => {
        mountDom();
        globalThis.fetch = vi.fn();
    });

    it('falls back to the documented default backend when storage is empty', async () => {
        stubChrome({});
        const popup = loadPopup();
        await popup.loadConfig();
        expect(document.getElementById('backend').value).toBe('https://localhost:5173');
        expect(document.getElementById('token').value).toBe('');
    });

    it('restores a stored backend and token', async () => {
        stubChrome({ backend: 'https://gnosi.example.com', token: 'gnosi_pat_abc' });
        const popup = loadPopup();
        await popup.loadConfig();
        expect(document.getElementById('backend').value).toBe('https://gnosi.example.com');
        expect(document.getElementById('token').value).toBe('gnosi_pat_abc');
    });

    it('trims whitespace when saving config', async () => {
        const store = {};
        stubChrome(store);
        const popup = loadPopup();
        document.getElementById('backend').value = '  https://x.test  ';
        document.getElementById('token').value = '  gnosi_pat_z  ';
        await popup.saveConfig();
        expect(store).toEqual({ backend: 'https://x.test', token: 'gnosi_pat_z' });
    });

    it('refuses to clip before it is configured, and does not call the network', async () => {
        stubChrome({});
        const popup = loadPopup();
        await popup.clip(false);
        expect(globalThis.fetch).not.toHaveBeenCalled();
        expect(statusClass()).toBe('err');
    });

    it('posts to /api/public/clip with the bearer token and page metadata', async () => {
        stubChrome(
            { backend: 'https://gnosi.example.com', token: 'gnosi_pat_abc' },
            { tab: { id: 3, url: 'https://example.org/p', title: 'Title' }, selection: 'picked text' },
        );
        globalThis.fetch = vi.fn(async () => ({
            ok: true, status: 200, json: async () => ({ path: 'Clips/Title.md' }),
        }));
        const popup = loadPopup();
        document.getElementById('note').value = 'my note';
        document.getElementById('tags').value = ' a , b ,, c ';
        await popup.clip(false);

        const [url, init] = globalThis.fetch.mock.calls[0];
        expect(url).toBe('https://gnosi.example.com/api/public/clip');
        expect(init.headers.Authorization).toBe('Bearer gnosi_pat_abc');
        const body = JSON.parse(init.body);
        expect(body.url).toBe('https://example.org/p');
        expect(body.title).toBe('Title');
        // Empty tag fragments must not become empty tags.
        expect(body.tags).toEqual(['a', 'b', 'c']);
        expect(status()).toContain('Clips/Title.md');
    });

    it('strips a trailing slash off the backend instead of double-slashing', async () => {
        stubChrome({ backend: 'https://gnosi.example.com/', token: 't' });
        globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
        const popup = loadPopup();
        await popup.clip(false);
        expect(globalThis.fetch.mock.calls[0][0]).toBe('https://gnosi.example.com/api/public/clip');
    });

    it('combines note and selection for a full clip', async () => {
        stubChrome({ backend: 'https://b.test', token: 't' }, { selection: 'sel' });
        globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
        const popup = loadPopup();
        document.getElementById('note').value = 'note';
        await popup.clip(false);
        expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body).content).toBe('note\n\nsel');
    });

    it('sends only the selection when clipping a selection', async () => {
        stubChrome({ backend: 'https://b.test', token: 't' }, { selection: 'sel' });
        globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
        const popup = loadPopup();
        document.getElementById('note').value = 'note';
        await popup.clip(true);
        expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body).content).toBe('sel');
    });

    it('falls back to the note when clipping a selection that is empty', async () => {
        stubChrome({ backend: 'https://b.test', token: 't' }, { selection: '' });
        globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
        const popup = loadPopup();
        document.getElementById('note').value = 'note';
        await popup.clip(true);
        expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body).content).toBe('note');
    });

    it('names a revoked token instead of reporting a generic failure', async () => {
        stubChrome({ backend: 'https://b.test', token: 'bad' });
        globalThis.fetch = vi.fn(async () => ({ ok: false, status: 401 }));
        const popup = loadPopup();
        await popup.clip(false);
        expect(status()).toContain('401');
        expect(statusClass()).toBe('err');
    });

    it('reports a transport failure without throwing out of clip()', async () => {
        stubChrome({ backend: 'https://b.test', token: 't' });
        globalThis.fetch = vi.fn(async () => { throw new Error('refused'); });
        const popup = loadPopup();
        await expect(popup.clip(false)).resolves.toBeUndefined();
        expect(status()).toContain('refused');
        expect(statusClass()).toBe('err');
    });

    it('survives a page where the selection script cannot run', async () => {
        stubChrome({ backend: 'https://b.test', token: 't' });
        globalThis.chrome.scripting.executeScript = vi.fn(async () => {
            throw new Error('blocked on this page');
        });
        globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
        const popup = loadPopup();
        document.getElementById('note').value = 'note';
        await popup.clip(false);
        expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body).content).toBe('note');
    });
});
