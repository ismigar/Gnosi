import { useEffect, useEffectEvent } from 'react';
import type { ModalInput } from './useViewController';
import type { useViewStateResult } from './useViewState';
import type { useViewSessionResult } from './useViewSession';
import type { useViewSnapshotResult } from './useViewSnapshot';
import type { useViewPersistenceResult } from './useViewPersistence';

export function useViewClosing({
    flushing, setFlushing, pendingSaveRef, persistView,
    onClose, setAutosaveStatus, setDiscardConfirmOpen, formBaselineSnapshot,
    formSnapshot, isTableMode, closeWithFlushRef, requestCloseRef,
    persistViewRef
}: Pick<
    useViewStateResult & useViewSessionResult & useViewPersistenceResult & ModalInput & useViewSnapshotResult,
    'flushing'
    | 'setFlushing'
    | 'pendingSaveRef'
    | 'persistView'
    | 'onClose'
    | 'setAutosaveStatus'
    | 'setDiscardConfirmOpen'
    | 'formBaselineSnapshot'
    | 'formSnapshot'
    | 'isTableMode'
    | 'closeWithFlushRef'
    | 'requestCloseRef'
    | 'persistViewRef'
>) {
    const closeWithFlush = async () => {
        if (flushing) return;
        setFlushing(true);
        // Clear a pending debounce so we don't double-save.
        pendingSaveRef.current = null;
        try {
            const result = await persistView({ closeAfter: true });
            // result is null only on validation failure → stay open so the user
            // can fix it. Otherwise close and hand back the saved data.
            if (result !== null) {
                onClose(true, result);
            }
        } catch {
            // Network/error already surfaced in the banner; stay open.
            setAutosaveStatus('error');
        } finally {
            setFlushing(false);
        }
    };
    const discardChanges = () => {
        pendingSaveRef.current = null;
        setDiscardConfirmOpen(false);
        onClose(false);
    };
    const requestDiscardChanges = () => {
        if (flushing) return;
        const hasUnsavedChanges = Boolean(formBaselineSnapshot)
            && formSnapshot !== formBaselineSnapshot;
        if (hasUnsavedChanges) {
            setDiscardConfirmOpen(true);
            return;
        }
        discardChanges();
    };
    const flushLatest = useEffectEvent(() => { void closeWithFlush(); });
    const requestLatest = useEffectEvent(() => { if (isTableMode) void closeWithFlush(); else requestDiscardChanges(); });
    const persistLatest = useEffectEvent(persistView);
    const requestClose = () => { if (isTableMode) void closeWithFlush(); else requestDiscardChanges(); };
    useEffect(() => {
        closeWithFlushRef.current = () => { flushLatest(); };
        requestCloseRef.current = () => { requestLatest(); };
        persistViewRef.current = options => persistLatest(options);
    }, [closeWithFlushRef, requestCloseRef, persistViewRef]);
    return { closeWithFlush, discardChanges, requestDiscardChanges, requestClose };
}
export type useViewClosingResult = ReturnType<typeof useViewClosing>;
