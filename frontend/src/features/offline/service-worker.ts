/** Only the compiled same-origin shell can guarantee a complete offline cache. */
export async function registerOfflineWorker(): Promise<boolean> {
    if (!import.meta.env.PROD || !window.isSecureContext || !('serviceWorker' in navigator)
        || !(globalThis as { crypto?: Crypto }).crypto?.subtle) return false;
    try {
        const existing = await navigator.serviceWorker.getRegistration('/offline.html');
        if (existing?.active?.scriptURL === new URL('/gnosi-offline-worker.js', location.origin).href) {
            void existing.update().catch(() => undefined);
            return true;
        }
        const registration = await navigator.serviceWorker.register('/gnosi-offline-worker.js', {
            scope: '/', updateViaCache: 'none',
        });
        if (registration.active) return true;
        const worker = registration.installing ?? registration.waiting;
        if (!worker) return false;
        return await new Promise<boolean>(resolve => {
            const finish = (ready: boolean) => { clearTimeout(timeout); worker.removeEventListener('statechange', change); resolve(ready); };
            const change = () => {
                if (worker.state === 'activated') finish(true);
                else if (worker.state === 'redundant') finish(false);
            };
            const timeout = setTimeout(() => { finish(false); }, 30_000);
            worker.addEventListener('statechange', change);
            change();
        });
    } catch { return false; }
}
