import { useTranslation } from 'react-i18next';
import type { EventFormProps } from './calendarTypes';
import { useEventFields } from './useEventFields';
import { useEventSuggestions } from './useEventSuggestions';
import { useEventAutosave } from './useEventAutosave';
import { eventSaveActions } from './eventSaveActions';
import { eventDeleteActions } from './eventDeleteActions';
import { eventFormOptions } from './eventFormOptions';
import { padTime } from './eventFormModel';
export function useEventForm(props: EventFormProps) {
 const { t } = useTranslation();
 const state = useEventFields(props);
 const suggestions = useEventSuggestions(state);
 const handleSubmit = eventSaveActions(props, state, t);
 const handleDelete = eventDeleteActions(props, state, t);
 const flushSave = useEventAutosave(props, state, handleSubmit);
 const { mode, eventData } = props;
 const handleFieldBlur = () => {};
    const isViewMode = mode === 'view';
    // A Google event that already exists (reopened) can be deleted if it's not read-only
    const _gmeta = eventData?.metadata || {};
    const isDeletableGoogleEvent = !!((_gmeta._provider === 'google' || _gmeta._account) && !_gmeta._vault_path && !_gmeta.readonly && eventData?.id);
    const inputClass = `w-full bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg px-2.5 py-1.5 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--gnosi-primary)]/30 focus:border-[var(--gnosi-primary)] transition-all ${isViewMode ? 'disabled:cursor-not-allowed disabled:opacity-60 disabled:bg-[var(--bg-tertiary)]' : ''}`;
    const labelClass = "flex items-center gap-1.5 text-[11px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wide mb-1";


 return { ...props, ...state, ...suggestions, ...eventFormOptions(t), t, handleSubmit, handleDelete, flushSave, handleFieldBlur, padTime, isViewMode, isDeletableGoogleEvent, inputClass, labelClass };
}
export type EventFormController = ReturnType<typeof useEventForm>;
