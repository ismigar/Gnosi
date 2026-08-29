import { useCallback, useEffect, useRef, useState } from 'react';
import { getSnapshot, loadSnapshot, type TLStore } from 'tldraw';

import {
    fetchDrawing,
    saveDrawing,
} from '../../../shared/api/drawings';
import { GnosiApiError } from '../../../shared/api/errors';
import { logError } from '../../../lib/notifyError';
import { subscribeWindowEvent } from '../../../shared/platform/browser-events';
import {
    assessDrawingSnapshot,
    drawingDocumentFromSnapshot,
    isAbortError,
} from './tldrawEditorModel';
import type { DrawingLoadState } from './tldrawEditorTypes';

const MAX_LOAD_RETRIES = 5;
const AUTOSAVE_DELAY_MS = 1000;

interface DrawingStatus {
    readonly drawingId: string | null;
    readonly state: DrawingLoadState;
}

interface UseTldrawPersistenceOptions {
    readonly drawingId: string | null;
    readonly onSaveSuccess?: (() => void) | null;
    readonly store: TLStore;
    readonly title: string | null;
}

export interface TldrawPersistence {
    readonly loadState: DrawingLoadState;
    readonly retryLoad: () => void;
    readonly save: () => Promise<void>;
}

function initialStatus(drawingId: string | null): DrawingStatus {
    return { drawingId, state: drawingId ? 'loading' : 'ready' };
}

export function useTldrawPersistence({
    drawingId,
    onSaveSuccess,
    store,
    title,
}: UseTldrawPersistenceOptions): TldrawPersistence {
    const [status, setStatus] = useState(() => initialStatus(drawingId));
    const [retryTick, setRetryTick] = useState(0);
    const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    if (status.drawingId !== drawingId) {
        setStatus(initialStatus(drawingId));
    }
    const loadState = status.drawingId === drawingId
        ? status.state
        : initialStatus(drawingId).state;

    useEffect(() => {
        if (!drawingId) return undefined;
        const controller = new AbortController();
        let retryTimer: ReturnType<typeof setTimeout> | null = null;
        let retries = 0;

        const loadDrawing = async (): Promise<void> => {
            try {
                const data = await fetchDrawing(drawingId, controller.signal);
                if (controller.signal.aborted) return;
                const assessment = assessDrawingSnapshot(data);
                if (assessment.kind === 'incompatible') {
                    setStatus({ drawingId, state: 'incompatible' });
                    return;
                }
                if (assessment.kind === 'loadable') {
                    try {
                        loadSnapshot(store, assessment.snapshot);
                    } catch (error) {
                        logError('tldraw.snapshot-load', error);
                        setStatus({ drawingId, state: 'incompatible' });
                        return;
                    }
                }
                setStatus({ drawingId, state: 'ready' });
            } catch (error) {
                if (controller.signal.aborted || isAbortError(error)) return;
                if (error instanceof GnosiApiError && error.status === 404) {
                    setStatus({ drawingId, state: 'ready' });
                    return;
                }
                if (retries < MAX_LOAD_RETRIES) {
                    const delay = 500 * (2 ** retries);
                    retries += 1;
                    retryTimer = setTimeout(() => {
                        void loadDrawing();
                    }, delay);
                    return;
                }
                logError('tldraw.drawing-load', error);
                setStatus({ drawingId, state: 'error' });
            }
        };

        void loadDrawing();
        return () => {
            controller.abort();
            if (retryTimer !== null) clearTimeout(retryTimer);
        };
    }, [drawingId, retryTick, store]);

    const save = useCallback(async (): Promise<void> => {
        if (!drawingId || loadState !== 'ready') return;
        try {
            const snapshot = drawingDocumentFromSnapshot(getSnapshot(store));
            await saveDrawing(drawingId, {
                data: snapshot,
                metadata: {},
                title: title || 'Dibuix sense títol',
            });
            onSaveSuccess?.();
        } catch (error) {
            logError('tldraw.drawing-save', error);
        }
    }, [drawingId, loadState, onSaveSuccess, store, title]);

    const latestSaveRef = useRef(save);
    useEffect(() => {
        latestSaveRef.current = save;
    }, [save]);

    useEffect(() => {
        if (!drawingId || loadState !== 'ready') return undefined;
        const unsubscribe = store.listen(() => {
            if (autosaveTimerRef.current !== null) return;
            autosaveTimerRef.current = setTimeout(() => {
                autosaveTimerRef.current = null;
                void latestSaveRef.current();
            }, AUTOSAVE_DELAY_MS);
        }, { scope: 'document', source: 'user' });

        return () => {
            unsubscribe();
            if (autosaveTimerRef.current !== null) {
                clearTimeout(autosaveTimerRef.current);
                autosaveTimerRef.current = null;
                void latestSaveRef.current();
            }
        };
    }, [drawingId, loadState, store]);

    useEffect(() => subscribeWindowEvent('keydown', (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 's') {
            event.preventDefault();
            void save();
        }
    }), [save]);

    return {
        loadState,
        retryLoad: () => {
            setStatus({ drawingId, state: drawingId ? 'loading' : 'ready' });
            setRetryTick((value) => value + 1);
        },
        save,
    };
}
