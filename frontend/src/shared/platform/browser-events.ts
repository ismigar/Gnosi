export type WindowEventHandler<K extends keyof WindowEventMap> = (
    event: WindowEventMap[K],
) => void;

export type DocumentEventHandler<K extends keyof DocumentEventMap> = (
    event: DocumentEventMap[K],
) => void;

export type ElementEventHandler<K extends keyof HTMLElementEventMap> = (
    event: HTMLElementEventMap[K],
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

export function subscribeElementEvent<K extends keyof HTMLElementEventMap>(
    element: HTMLElement,
    type: K,
    handler: ElementEventHandler<K>,
    options?: boolean | AddEventListenerOptions,
): () => void {
    element.addEventListener(type, handler, options);
    return () => {
        element.removeEventListener(type, handler, options);
    };
}

export interface BrowserViewportSize {
    readonly height: number;
    readonly width: number;
}

export function browserViewportSize(): BrowserViewportSize {
    return {
        height: window.innerHeight,
        width: window.innerWidth,
    };
}

export function browserDocumentBody(): HTMLElement {
    return document.body;
}

export function eventTargetIsWithin(
    container: Element,
    target: EventTarget | null,
): boolean {
    return target instanceof Node && container.contains(target);
}

export function eventTargetClosest(
    target: EventTarget | null,
    selector: string,
): Element | null {
    return target instanceof Element ? target.closest(selector) : null;
}

export function observeElementResize(
    element: Element,
    callback: ResizeObserverCallback,
): () => void {
    const observer = new ResizeObserver(callback);
    observer.observe(element);
    return () => {
        observer.disconnect();
    };
}

export function currentBrowserOrigin(): string {
    return window.location.origin;
}

export function browserHasTouchPoints(): boolean {
    return navigator.maxTouchPoints > 0;
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
