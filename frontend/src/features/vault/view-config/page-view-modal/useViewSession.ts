import { useRef } from 'react';
import type { SavedView, PersistView } from './types';

export function useViewSession() {
    const panelRef = useRef<HTMLDivElement>(null);
    const existingViewsRequestRef = useRef(0);
    const createdViewIdRef = useRef<string | null>(null);
    const initializedRef = useRef(false);
    const pendingSaveRef = useRef<(() => Promise<void>) | null>(null);
    const skipNextAutosaveRef = useRef(false);
    const lastSavedViewRef = useRef<SavedView | null>(null);
    const closeWithFlushRef = useRef<() => void>(() => { });
    const requestCloseRef = useRef<() => void>(() => { });
    const persistViewRef = useRef<PersistView>(() => Promise.resolve(null));
    return {
        panelRef, existingViewsRequestRef, createdViewIdRef, initializedRef,
        pendingSaveRef, skipNextAutosaveRef, lastSavedViewRef, closeWithFlushRef,
        requestCloseRef, persistViewRef
    };
}
export type useViewSessionResult = ReturnType<typeof useViewSession>;
