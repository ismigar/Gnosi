// @vitest-environment node
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterEach, expect, it, vi } from 'vitest';
import { offlineShellPlugin } from './build-plugin.mjs';

const template = readFileSync(new URL('../../../public/gnosi-offline-worker.js', import.meta.url), 'utf8');
const origin = 'https://gnosi.example.invalid';
const temporary: string[] = [];
afterEach(() => { for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true }); });

interface WaitEvent { waitUntil(promise: Promise<unknown>): void }
interface FetchEvent { readonly request: Request; respondWith(promise: Promise<Response>): void }
function required<T>(value: T | undefined): T {
    if (value === undefined) throw new Error('Missing worker fixture value');
    return value;
}

function worker() {
    const handlers = new Map<string, (event: WaitEvent | FetchEvent) => void>();
    const entries = new Map<string, Response>();
    const cache = { put: vi.fn((url: string, response: Response) => { entries.set(url, response); return Promise.resolve(); }),
        match: vi.fn((url: string) => Promise.resolve(entries.get(url))) };
    const caches = { open: vi.fn(() => Promise.resolve(cache)), delete: vi.fn(() => Promise.resolve(true)), keys: vi.fn(() => Promise.resolve([])) };
    const fetch = vi.fn((request: Request) => {
        const response = new Response(request.url.endsWith('.html') ? '<html>public shell</html>' : 'public script', {
            headers: { 'Content-Type': request.url.endsWith('.html') ? 'text/html' : 'text/javascript' },
        });
        Object.defineProperty(response, 'url', { value: request.url });
        return Promise.resolve(response);
    });
    const source = template.replace('/* GNOSI_OFFLINE_FILES */ []', JSON.stringify(['/offline.html', '/assets/offline-1234abcd.js']));
    runInNewContext(source, { self: { location: { origin }, clients: { claim: vi.fn() },
        addEventListener: (type: string, handler: (event: WaitEvent | FetchEvent) => void) => { handlers.set(type, handler); } },
        URL, Request, Response, Set, Error, fetch, caches });
    return { handlers, entries, cache, caches, fetch };
}

it('pre-caches only the public allowlist using credential-free requests', async () => {
    const instance = worker();
    let pending: Promise<unknown> | undefined;
    required(instance.handlers.get('install'))({ waitUntil(promise) { pending = promise; } });
    await required(pending);
    expect([...instance.entries.keys()]).toEqual([`${origin}/offline.html`, `${origin}/assets/offline-1234abcd.js`]);
    for (const [request] of instance.fetch.mock.calls) {
        expect(request.credentials).toBe('omit');
        expect(request.redirect).toBe('error');
        expect([...request.headers]).toEqual([]);
    }
});

it('never intercepts authenticated APIs, main-app navigation, queries, external URLs or unreviewed assets', () => {
    const { handlers, cache, fetch } = worker();
    for (const url of ['/api/auth/me', '/api/vault/pages/private', '/', '/@vault/knowledge', '/offline.html?token=private', '/assets/other.js', 'https://external.example.invalid/offline.html']) {
        const respondWith = vi.fn();
        required(handlers.get('fetch'))({ request: new Request(new URL(url, origin)), respondWith });
        expect(respondWith).not.toHaveBeenCalled();
    }
    expect(cache.put).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
});

it('serves the compiled offline entry without network and drops a failed partial installation', async () => {
    const { handlers, entries, fetch, caches } = worker();
    entries.set(`${origin}/offline.html`, new Response('cached shell'));
    let response: Promise<Response> | undefined;
    required(handlers.get('fetch'))({ request: new Request(`${origin}/offline.html`), respondWith(promise) { response = promise; } });
    expect(await (await required(response)).text()).toBe('cached shell');
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockResolvedValueOnce(new Response('not found', { status: 404 }));
    let installation: Promise<unknown> | undefined;
    required(handlers.get('install'))({ waitUntil(promise) { installation = promise; } });
    await expect(required(installation)).rejects.toThrow('Offline shell asset unavailable');
    expect(caches.delete).toHaveBeenCalledWith(expect.stringContaining('gnosi-offline-static-'));
});

it('builds the exact offline dependency graph including lazy locale chunks, never the main entry', () => {
    const root = mkdtempSync(join(tmpdir(), 'gnosi-offline-worker-'));
    temporary.push(root);
    mkdirSync(join(root, 'dist', '.vite'), { recursive: true });
    mkdirSync(join(root, 'dist', 'assets'), { recursive: true });
    mkdirSync(join(root, 'public'));
    const manifest = {
        'offline.html': { file: 'assets/offline-1234.js', imports: ['react'], dynamicImports: ['locale'], css: ['assets/offline-1234.css'] },
        react: { file: 'assets/react-1234.js' }, locale: { file: 'assets/en-1234.js' },
        'index.html': { file: 'assets/main-private-test.js' },
    };
    writeFileSync(join(root, 'dist', '.vite', 'manifest.json'), JSON.stringify(manifest));
    for (const name of ['offline.html', 'manifest.json', 'favicon.svg', 'app-icon-192.png', 'app-icon-512.png', 'assets/offline-1234.js', 'assets/offline-1234.css', 'assets/react-1234.js', 'assets/en-1234.js']) writeFileSync(join(root, 'dist', name), 'public fixture');
    writeFileSync(join(root, 'public', 'gnosi-offline-worker.js'), template);
    const plugin = offlineShellPlugin();
    plugin.configResolved({ root, publicDir: join(root, 'public'), base: '/', build: { outDir: 'dist', assetsDir: 'assets' } });
    plugin.writeBundle();
    const output = readFileSync(join(root, 'dist', 'gnosi-offline-worker.js'), 'utf8');
    expect(output).toContain('/assets/en-1234.js');
    expect(output).toContain('/assets/offline-1234.css');
    expect(output).not.toContain('main-private-test.js');
    expect(output).not.toContain("/* GNOSI_OFFLINE_BUILD */ 'unbuilt'");
    manifest['offline.html'].file = 'api/vault/pages/private';
    writeFileSync(join(root, 'dist', '.vite', 'manifest.json'), JSON.stringify(manifest));
    expect(() => { plugin.writeBundle(); }).toThrow('Unexpected offline asset path');
});
