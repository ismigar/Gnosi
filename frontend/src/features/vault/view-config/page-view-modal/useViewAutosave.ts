import { useRef, useState } from 'react';
import { useDraftAutosave } from '../../../../shared/hooks/useDraftAutosave';
import type { SavedView } from './types';
import type { ModalInput } from './useViewController';
import type { useViewPersistenceResult } from './useViewPersistence';
import type { useViewStateResult } from './useViewState';
import type { useViewSnapshotResult } from './useViewSnapshot';

export function useViewAutosave({
    sourceTableId, visibleProperties, viewLoadStatus, formSnapshot, formBaselineSnapshot,
    isTableMode, editingView, editingBlock, persistView, onSave, onClose, setError, setActiveTab, t,
}: Pick<ModalInput & useViewPersistenceResult & useViewStateResult & useViewSnapshotResult,
    'sourceTableId' | 'visibleProperties' | 'viewLoadStatus' | 'formSnapshot' | 'formBaselineSnapshot'
    | 'isTableMode' | 'editingView' | 'editingBlock' | 'persistView' | 'onSave' | 'onClose' | 'setError' | 'setActiveTab' | 't'>) {
    const saved = useRef<SavedView | null>(null);
    const closing = useRef(false);
    const [flushing, setFlushing] = useState(false);
    const ready = viewLoadStatus === 'ready' && Boolean(formBaselineSnapshot);
    const valid = ready && Boolean(sourceTableId) && visibleProperties.length > 0;
    const isNewEmbed = !isTableMode && !editingBlock;
    // null identifies the hydrated draft. Returning to it after an acknowledged
    // edit must restore that configuration too.
    const draft = ready && formSnapshot !== formBaselineSnapshot ? formSnapshot : null;
    const save = async () => {
        try {
            const result = await persistView();
            if (!isTableMode) await onSave(result);
            saved.current = result;
        } catch (error) {
            setError(error instanceof Error ? error.message : t('view.error_create', 'Unknown error creating the view'));
            throw error;
        }
    };
    const { flush, status } = useDraftAutosave(draft, valid, save);
    const closeWithFlush = async () => {
        if (closing.current) return;
        if (!ready || (!sourceTableId && (isNewEmbed || (isTableMode && !editingView?.id)) && !saved.current)) { onClose(false); return; }
        if (!valid) {
            setError(sourceTableId ? t('view.error_no_fields', 'At least one visible field is required') : t('view.error_no_table', 'You must select a source table'));
            setActiveTab(sourceTableId ? 'properties' : 'general');
            return;
        }
        closing.current = true;
        setFlushing(true);
        try {
            const acceptDefault = !saved.current && (isNewEmbed || (isTableMode && !editingView?.id));
            if (!await flush(acceptDefault)) return;
            if (saved.current) onClose(true, saved.current);
            else onClose(false);
        } catch {
            // Keep the draft and error visible for retry.
        } finally {
            closing.current = false;
            setFlushing(false);
        }
    };
    return { autosaveStatus: status, flushing, closeWithFlush, requestClose: () => { void closeWithFlush(); } };
}
export type useViewAutosaveResult = ReturnType<typeof useViewAutosave>;
