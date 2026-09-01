import { X, Trash2 } from 'lucide-react';
import { ConfirmModal } from '../../../../shared/ui/dialogs/ConfirmModal';
import { RecurrenceChoiceModal } from '../RecurrenceChoiceModal';
import type { EventFormProps } from './calendarTypes';
import { useEventForm } from './useEventForm';
import { EventDates } from './EventDates';
import { EventLocation } from './EventLocation';
import { EventDetails } from './EventDetails';
import { EventAttendees } from './EventAttendees';
import { EventRecurrence } from './EventRecurrence';
import { EventDescription } from './EventDescription';
export function EventForm(props: EventFormProps) {
 const controller = useEventForm(props);
 const { saving, deleting, saveError, createdId, isDeleteConfirmOpen, setIsDeleteConfirmOpen, isRecurrenceDeleteOpen, setIsRecurrenceDeleteOpen, isRecurrenceModifyOpen, setIsRecurrenceModifyOpen, t, mode, eventData, onClose, handleSubmit, handleDelete, flushSave, isDeletableGoogleEvent} = controller;
    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-primary)] bg-[var(--bg-tertiary)]">
                <div className="flex items-center gap-2">
                    <button onClick={() => { flushSave(); onClose?.(); }} className="gnosi-close-btn" aria-label={t('calendar.close_panel', "Close panel")}>
                        <X />
                    </button>
                    <span className="text-[13px] font-semibold text-[var(--text-primary)]">
                        {mode === 'create' && !createdId ? t('calendar.new_event', "New appointment") : t('calendar.edit_event', "Edit appointment")}
                    </span>
                </div>
                <div className="flex items-center gap-1" />
            </div>

            {/* Form */}
            <form onSubmit={(event) => { void handleSubmit(event); }} className="flex-1 overflow-y-auto p-4 space-y-3">
                <EventDates controller={controller} />
                <EventLocation controller={controller} />
                <EventDetails controller={controller} />
                <EventAttendees controller={controller} />
                <EventRecurrence controller={controller} />
                <EventDescription controller={controller} />
            </form>

            {/* Footer */}
            <div className="px-4 py-2 border-t border-[var(--border-primary)] bg-[var(--bg-tertiary)] flex items-center justify-between gap-2">
                <div className={`text-[10px] italic ${saveError ? 'text-red-500' : 'text-[var(--text-tertiary)]'}`}>
                    {saving ? t('calendar.saving', "Saving...") : deleting ? t('calendar.deleting', "Deleting...") : saveError ? '⚠ Error desant' : t('calendar.saved', "Saved")}
                </div>
                <div className="flex gap-1.5">
                    {((mode === 'edit' && eventData?.id) || createdId || isDeletableGoogleEvent) && (
                        <button
                            type="button"
                            onClick={() => { setIsDeleteConfirmOpen(true); }}
                            disabled={deleting || saving}
                            className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold rounded-lg border border-red-500/40 text-red-500 hover:bg-red-500/10 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                        >
                            <Trash2 size={12} />
                            {t('common.delete', "Delete")}
                        </button>
                    )}
                </div>
            </div>

            <ConfirmModal
                isOpen={isDeleteConfirmOpen}
                onClose={() => { setIsDeleteConfirmOpen(false); }}
                onConfirm={() => handleDelete(false, false)} // By default deletes everything if confirmed here (if it's not recurring)
                title={t('calendar.confirm_delete_event_title', "Delete event")}
                message={t('calendar.confirm_delete_event', "Are you sure you want to delete this appointment?")}
                confirmText={t('common.delete', "Delete")}
                isDestructive={true}
            />

            <RecurrenceChoiceModal
                isOpen={isRecurrenceDeleteOpen}
                onClose={() => { setIsRecurrenceDeleteOpen(false); }}
                onConfirm={handleDelete}
                title={t('calendar.recurrent_delete_title', "Delete recurring event")}
                message={t('calendar.recurrent_delete_msg', "This is a recurring event. What do you want to delete?")}
                actionType="delete"
            />

            <RecurrenceChoiceModal
                isOpen={isRecurrenceModifyOpen}
                onClose={() => { setIsRecurrenceModifyOpen(false); }}
                onConfirm={(isSeries, isInstanceOnly, isFollowing) => handleSubmit(null, false, null, isSeries, isInstanceOnly, isFollowing)}
                title={t('calendar.recurrent_modify_title', "Modify recurring event")}
                message={t('calendar.recurrent_modify_msg', "This is a recurring event. How do you want to apply the changes?")}
                actionType="modify"
            />
        </div>
    );
};
