import { useEffect, useEffectEvent, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { subscribeWindowEvent } from '../../../shared/platform/browser-events';
import { toast } from '../../../lib/toast';
import type { EventFormProps } from './calendarTypes';
import type { EventFieldState } from './useEventFields';
import type { SaveEvent } from './eventSaveActions';

export function useEventAutosave(props: EventFormProps, state: EventFieldState, handleSubmit: SaveEvent) {
    const { mode, eventData, onClose } = props;
    const { fields, saving, deleting, createdId, isInitializingRef, lastSavedDataRef, autoSaveTimeoutRef, setIsDeleteConfirmOpen } = state;
    const { t } = useTranslation();
    const snapshot = JSON.stringify(fields);
    const save = useEffectEvent((snap: string) => { void handleSubmit(null, true, snap); });
    const flushSaveRef = useRef<() => void>(() => {});
    useLayoutEffect(() => {
        flushSaveRef.current = () => {
            if (autoSaveTimeoutRef.current) {
                clearTimeout(autoSaveTimeoutRef.current);
                autoSaveTimeoutRef.current = null;
            }
            if (mode === 'view' || !fields.title.trim() || !fields.startDate) return;
            if (lastSavedDataRef.current !== snapshot) void handleSubmit(null, true, snapshot);
        };
    }, [autoSaveTimeoutRef, fields.title, fields.startDate, handleSubmit, lastSavedDataRef, mode, snapshot]);
    useEffect(() => {
        if (saving || deleting || mode === 'view' || !fields.title.trim() || !fields.startDate) return;
        if (lastSavedDataRef.current === null && mode === 'edit' && eventData?.id) {
            lastSavedDataRef.current = snapshot;
            return;
        }
        if (isInitializingRef.current || lastSavedDataRef.current === snapshot) return;
        if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current);
        autoSaveTimeoutRef.current = setTimeout(() => { save(snapshot); }, 450);
        return () => { if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current); };
    }, [saving, deleting, mode, fields.title, fields.startDate, eventData, snapshot, lastSavedDataRef, isInitializingRef, autoSaveTimeoutRef]);
    useEffect(() => subscribeWindowEvent('keydown', (event) => {
        if (event.key === 'Escape') { flushSaveRef.current(); onClose?.(); return; }
        if (event.key !== 'Delete' && !(event.key === 'Backspace' && (event.metaKey || event.ctrlKey))) return;
        const active = document.activeElement;
        if (active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA') return;
        const meta = eventData?.metadata;
        const external = (meta?._provider === 'google' || !!meta?._account) && !meta._vault_path && eventData?.id;
        if ((mode === 'edit' && eventData?.id) || createdId || (external && !meta.readonly)) setIsDeleteConfirmOpen(true);
        else if (external && meta.readonly) toast.error(t('calendar.external_event_delete_warning', 'External events cannot be deleted from Gnosi.'));
    }), [mode, eventData, onClose, createdId, setIsDeleteConfirmOpen, t]);
    useEffect(() => () => { flushSaveRef.current(); }, []);
    return () => { flushSaveRef.current(); };
}
