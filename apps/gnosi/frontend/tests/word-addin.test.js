/* Word add-in task pane logic.
 *
 * taskpane.js is an IIFE: nothing escapes it, so there is no seam to import.
 * Each test loads the real index.html body into jsdom, stubs the host surface
 * (Office.js) and `fetch`, then evaluates the script. Behaviour is asserted
 * through what a user or the backend would actually see — the DOM, the
 * requests sent, and the Office calls made — rather than internals.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = path.dirname(fileURLToPath(import.meta.url));

const ADDIN = path.resolve(here, '../public/word-addin');
const source = fs.readFileSync(path.join(ADDIN, 'taskpane.js'), 'utf-8');
const html = fs.readFileSync(path.join(ADDIN, 'index.html'), 'utf-8');

const TOKEN_KEY = 'gnosi.wordAddin.apiToken';

/** Mount the add-in's real markup so the ids match production. */
function mountDom() {
    const body = html.replace(/[\s\S]*<body[^>]*>/i, '').replace(/<\/body>[\s\S]*/i, '');
    document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/gi, '');
}

/** Stub Office.js; `host` null models running outside Word. */
function stubOffice({ host = 'Word', settings } = {}) {
    const office = {
        onReady: vi.fn((cb) => { office._ready = cb; }),
        AsyncResultStatus: { Succeeded: 'succeeded' },
        context: {
            document: {
                settings: settings ?? {
                    get: vi.fn(() => undefined),
                    set: vi.fn(),
                    saveAsync: vi.fn((cb) => cb({ status: 'succeeded' })),
                },
            },
        },
    };
    office._host = host;
    globalThis.Office = office;
    window.Office = office;
    return office;
}

/** Evaluate taskpane.js, then fire Office.onReady as the host would. */
async function boot(office) {
    const ctx = {
        window, document, console,
        Office: office,
        Word: { run: vi.fn() },
        localStorage: window.localStorage,
        fetch: globalThis.fetch,
        URL, setTimeout, clearTimeout,
    };
    ctx.globalThis = ctx;
    vm.createContext(ctx);
    vm.runInContext(source, ctx);
    await office._ready({ host: office._host });
    // Let the promise chain in onReady settle.
    await new Promise((r) => setTimeout(r, 0));
    return ctx;
}

/** A fetch stub: /api/health ok, search returns `items`. */
function stubFetch({ searchStatus = 200, items = [] } = {}) {
    return vi.fn(async (input) => {
        const url = String(input);
        if (url.includes('/api/health')) return { ok: true, status: 200 };
        if (url.includes('search-citations')) {
            return {
                ok: searchStatus === 200,
                status: searchStatus,
                json: async () => items,
            };
        }
        return { ok: true, status: 200, json: async () => ({}) };
    });
}

const statusText = () => document.getElementById('connection-status').textContent;
const footer = () => document.getElementById('status-line').textContent;

describe('word add-in task pane', () => {
    beforeEach(() => {
        mountDom();
        window.localStorage.clear();
        // The add-in derives the backend from wherever it is served.
        Object.defineProperty(window, 'location', {
            value: { origin: 'https://localhost:5173' },
            writable: true,
        });
    });

    afterEach(() => {
        delete globalThis.Office;
        delete globalThis.fetch;
    });

    it('reports the host it is running in', async () => {
        globalThis.fetch = stubFetch();
        await boot(stubOffice({ host: 'Word' }));
        expect(footer()).toContain('Word');
    });

    it('says "browser" when Office reports no host', async () => {
        globalThis.fetch = stubFetch();
        await boot(stubOffice({ host: null }));
        expect(footer()).toContain('browser');
    });

    it('sends no Authorization header when no token is stored', async () => {
        globalThis.fetch = stubFetch();
        await boot(stubOffice());
        const search = globalThis.fetch.mock.calls.find((c) =>
            String(c[0]).includes('search-citations'));
        expect(search[1]?.headers?.Authorization).toBeUndefined();
    });

    it('sends the stored token as a bearer credential', async () => {
        window.localStorage.setItem(TOKEN_KEY, 'gnosi_pat_secret');
        globalThis.fetch = stubFetch();
        await boot(stubOffice());
        const search = globalThis.fetch.mock.calls.find((c) =>
            String(c[0]).includes('search-citations'));
        expect(search[1].headers.Authorization).toBe('Bearer gnosi_pat_secret');
    });

    it('targets the origin it is served from, not a hard-coded host', async () => {
        globalThis.fetch = stubFetch();
        await boot(stubOffice());
        expect(String(globalThis.fetch.mock.calls[0][0]))
            .toContain('https://localhost:5173');
    });

    it('distinguishes a missing token from a rejected one', async () => {
        globalThis.fetch = stubFetch({ searchStatus: 401 });
        await boot(stubOffice());
        // No token stored: the user has to create one, not replace one.
        expect(statusText()).toMatch(/token/i);

        mountDom();
        window.localStorage.setItem(TOKEN_KEY, 'gnosi_pat_revoked');
        globalThis.fetch = stubFetch({ searchStatus: 401 });
        await boot(stubOffice());
        expect(statusText()).toMatch(/vàlid|valid/i);
    });

    it('reports a 401 instead of rendering it as "no results"', async () => {
        globalThis.fetch = stubFetch({ searchStatus: 401 });
        await boot(stubOffice());
        // The regression this guards: a 401 used to look exactly like an
        // empty vault, which sent users hunting for missing references.
        expect(statusText()).not.toMatch(/connectat/i);
    });

    it('escapes markup from vault fields instead of injecting it', async () => {
        globalThis.fetch = stubFetch({
            items: [{
                citation_key: 'x1',
                title: '<img src=x onerror="window.__pwned=1">',
                author: 'A', year: '2020',
            }],
        });
        await boot(stubOffice());
        const results = document.getElementById('results');
        expect(results.querySelector('img')).toBeNull();
        expect(window.__pwned).toBeUndefined();
        expect(results.textContent).toContain('<img');
    });

    it('tags the document so Word reopens the pane by itself', async () => {
        const settings = {
            get: vi.fn(() => undefined),
            set: vi.fn(),
            saveAsync: vi.fn((cb) => cb({ status: 'succeeded' })),
        };
        globalThis.fetch = stubFetch();
        await boot(stubOffice({ host: 'Word', settings }));
        expect(settings.set).toHaveBeenCalledWith('Office.AutoShowTaskpaneWithDocument', true);
        expect(settings.saveAsync).toHaveBeenCalled();
    });

    it('does not re-tag a document that is already tagged', async () => {
        const settings = {
            get: vi.fn(() => true),
            set: vi.fn(),
            saveAsync: vi.fn((cb) => cb({ status: 'succeeded' })),
        };
        globalThis.fetch = stubFetch();
        await boot(stubOffice({ host: 'Word', settings }));
        expect(settings.set).not.toHaveBeenCalled();
    });

    it('does not tag anything when running outside a real host', async () => {
        const settings = {
            get: vi.fn(() => undefined),
            set: vi.fn(),
            saveAsync: vi.fn((cb) => cb({ status: 'succeeded' })),
        };
        globalThis.fetch = stubFetch();
        await boot(stubOffice({ host: null, settings }));
        expect(settings.set).not.toHaveBeenCalled();
    });

    it('survives a settings API that throws', async () => {
        const settings = {
            get: vi.fn(() => { throw new Error('no settings here'); }),
            set: vi.fn(),
            saveAsync: vi.fn(),
        };
        globalThis.fetch = stubFetch();
        // Tagging is a convenience; it must never take the pane down with it.
        await expect(boot(stubOffice({ host: 'Word', settings }))).resolves.toBeTruthy();
        expect(footer()).toContain('Word');
    });

    it('stays usable when the backend is unreachable', async () => {
        globalThis.fetch = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
        await boot(stubOffice());
        expect(statusText()).toMatch(/connexió|connection/i);
    });
});
