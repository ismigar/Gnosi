export type WindowEventHandler<K extends keyof WindowEventMap> = (
    event: WindowEventMap[K],
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
