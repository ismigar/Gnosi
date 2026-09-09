import {useEffect, useRef, useState, type RefObject} from 'react';

interface ViewportObserver {
    readonly observer: IntersectionObserver;
    readonly listeners: Map<Element, () => void>;
}

const observers = new Map<Element | null, ViewportObserver>();

function releaseObserver(root: Element | null, entry: ViewportObserver) {
    if (entry.listeners.size || observers.get(root) !== entry) return;
    entry.observer.disconnect();
    observers.delete(root);
}

function observeThumbnail(target: Element, root: Element | null, visible: () => void) {
    let entry = observers.get(root);
    if (!entry) {
        const listeners = new Map<Element, () => void>();
        const observer = new IntersectionObserver(changes => {
            for (const change of changes) {
                if (!change.isIntersecting) continue;
                const notify = listeners.get(change.target);
                if (!notify) continue;
                listeners.delete(change.target);
                observer.unobserve(change.target);
                notify();
            }
            if (entry) releaseObserver(root, entry);
        }, {root, rootMargin: '160px 0px', threshold: 0});
        entry = {observer, listeners};
        observers.set(root, entry);
    }
    const registration = entry;
    registration.listeners.set(target, visible);
    registration.observer.observe(target);
    return () => {
        if (registration.listeners.get(target) !== visible) return;
        registration.listeners.delete(target);
        registration.observer.unobserve(target);
        releaseObserver(root, registration);
    };
}

/** Native lazy loading can fetch several screens ahead; share one close viewport observer. */
export function useThumbnailVisibility(scrollRoot?: RefObject<Element | null>) {
    const targetRef = useRef<HTMLDivElement>(null);
    const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined');
    useEffect(() => {
        if (visible || !targetRef.current) return;
        return observeThumbnail(targetRef.current, scrollRoot?.current ?? null, () => {setVisible(true);});
    }, [scrollRoot, visible]);
    return {targetRef, visible};
}
