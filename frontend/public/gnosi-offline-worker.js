/* This worker never stores API responses, credentials, note content or main-app HTML.
 * The build replaces the two markers with the exact offline shell dependency graph.
 */
const STATIC_FILES = /* GNOSI_OFFLINE_FILES */ [];
const BUILD_ID = /* GNOSI_OFFLINE_BUILD */ 'unbuilt';
const CACHE_PREFIX = 'gnosi-offline-static-';
const CACHE_NAME = CACHE_PREFIX + BUILD_ID;
const STATIC_URLS = new Set(STATIC_FILES.map(path => new URL(path, self.location.origin).href));

function isStaticRequest(request) {
    const url = new URL(request.url);
    return request.method === 'GET' && url.origin === self.location.origin
        && !url.search && !url.pathname.startsWith('/api/') && STATIC_URLS.has(url.href);
}

function publicRequest(url) {
    return new Request(url, { credentials: 'omit', cache: 'reload', redirect: 'error' });
}

self.addEventListener('install', event => {
    event.waitUntil((async () => {
        if (!STATIC_FILES.includes('/offline.html')) throw new Error('Offline shell was not built');
        const cache = await caches.open(CACHE_NAME);
        try {
            for (const url of STATIC_URLS) {
                const response = await fetch(publicRequest(url));
                if (!response.ok || response.type === 'opaque' || response.redirected || response.url !== url) {
                    throw new Error('Offline shell asset unavailable');
                }
                const mime = response.headers.get('content-type') || '';
                const path = new URL(url).pathname;
                if ((path.endsWith('.js') && !/javascript/u.test(mime))
                    || (path.endsWith('.css') && !/text\/css/u.test(mime))
                    || (path.endsWith('.html') && !/text\/html/u.test(mime))) {
                    throw new Error('Offline shell asset has an unexpected type');
                }
                await cache.put(url, response);
            }
        } catch (error) {
            await caches.delete(CACHE_NAME);
            throw error;
        }
    })());
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        for (const name of await caches.keys()) {
            if (name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME) await caches.delete(name);
        }
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', event => {
    if (!isStaticRequest(event.request)) return;
    event.respondWith((async () => {
        const cache = await caches.open(CACHE_NAME);
        return await cache.match(event.request.url) || fetch(publicRequest(event.request.url));
    })());
});
