export type WindowEventHandler<K extends keyof WindowEventMap> = (
    event: WindowEventMap[K],
) => void;

export type DocumentEventHandler<K extends keyof DocumentEventMap> = (
    event: DocumentEventMap[K],
) => void;

export function subscribeWindowEvent<K extends keyof WindowEventMap>(
    type: K,
    handler: WindowEventHandler<K>,
    options?: boolean | AddEventListenerOptions,
): () => void {
    window.addEventListener(type, handler, options);
    return () => {
        window.removeEventListener(type, handler, options);
    };
}

export function subscribeDocumentEvent<K extends keyof DocumentEventMap>(
    type: K,
    handler: DocumentEventHandler<K>,
    options?: boolean | AddEventListenerOptions,
): () => void {
    document.addEventListener(type, handler, options);
    return () => {
        document.removeEventListener(type, handler, options);
    };
}

export function currentBrowserOrigin(): string {
    return window.location.origin;
}

export function openBrowserWindow(
    url: string,
    target?: string,
    features?: string,
): Window | null {
    return window.open(url, target, features);
}

export function dispatchWindowEvent(event: Event): boolean {
    return window.dispatchEvent(event);
}

export function postWindowMessage(
    target: Window,
    message: Readonly<Record<string, unknown>>,
    targetOrigin: string,
): void {
    target.postMessage(message, targetOrigin);
}
