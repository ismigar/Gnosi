import type { TFunction } from 'i18next';
import { toast } from '../../../lib/toast';
import { deleteCalendarEvent } from '../../../shared/api/calendar';
import { deleteVaultPage, patchVaultPage } from '../../../shared/api/vaults';
import { buildOccurrenceKey, truncateRruleBefore } from '../../../utils/calendarUtils';
import type { EventFormProps } from './calendarTypes';
import type { EventFieldState } from './useEventFields';
import { record, textValue } from './calendarBoundary';
import { recurrenceText } from './eventFormModel';
export function eventDeleteActions({eventData, onSaved, onClose}: EventFormProps, state: EventFieldState, t: TFunction) {
 const {googleRef, createdIdRef, setDeleting, setIsRecurrenceDeleteOpen} = state;
    const handleDelete = async (isSeries = false, isInstanceOnly = false, isFollowing = false) => {
        // If the appointment was created in a Google calendar during this session, delete it in Google
        if (googleRef.current?.id) {
            setDeleting(true);
            try {
                await deleteCalendarEvent({
                    calendarId: googleRef.current.calendar_id,
                    email: googleRef.current.account,
                    eventId: googleRef.current.id,
                });
                toast.success(t('calendar.event_deleted', "Appointment deleted."));
                googleRef.current = null;
                onSaved?.();
                onClose?.();
            } catch {
                toast.error(t('calendar.event_delete_error', "Error deleting the appointment."));
            } finally {
                setDeleting(false);
                setIsRecurrenceDeleteOpen(false);
            }
            return;
        }

        // Google event that already exists (reopened in read mode): delete it in Google if it's not read-only
        const gmeta = eventData?.metadata || {};
        const gIsGoogle = (gmeta._provider === 'google' || !!gmeta._account) && !gmeta._vault_path;
        if (gIsGoogle && eventData?.id) {
            if (gmeta.readonly) {
                toast.error(t('calendar.external_event_delete_warning', "External events cannot be deleted from Gnosi."));
                return;
            }
            setDeleting(true);
            try {
                await deleteCalendarEvent({
                    calendarId: gmeta._calendar_id || 'primary',
                    email: gmeta._account || '',
                    eventId: eventData.id,
                });
                toast.success(t('calendar.event_deleted', "Appointment deleted."));
                onSaved?.();
                onClose?.();
            } catch {
                toast.error(t('calendar.event_delete_error', "Error deleting the appointment."));
            } finally {
                setDeleting(false);
                setIsRecurrenceDeleteOpen(false);
            }
            return;
        }

        const deleteId = eventData?.id || createdIdRef.current;
        if (!deleteId) return;

        // If it's recurring and we haven't chosen, open the modal (a new appointment is never recurring)
        const isRecurrent = !!(eventData?.metadata.rrule || eventData?.metadata.recurrence);
        if (isRecurrent && !isSeries && !isInstanceOnly && !isFollowing) {
            setIsRecurrenceDeleteOpen(true);
            return;
        }

        setDeleting(true);
        try {
            if (isInstanceOnly && eventData) {
                // Instance deletion logic
                const occurrenceKey = buildOccurrenceKey(
                    eventData.metadata.date,
                    null,
                    eventData.metadata.all_day,
                    eventData.metadata
                );

                const existingExdates = Array.isArray(eventData.metadata.exdates)
                    ? eventData.metadata.exdates
                    : (typeof eventData.metadata.exdates === 'string'
                        ? eventData.metadata.exdates.split(',').filter(Boolean)
                        : []);

                await patchVaultPage(eventData.id, {
                    metadata: {
                        exdates: [...new Set([...existingExdates, occurrenceKey])],
                    }
                });
                toast.success(t('calendar.instance_deleted'));
            } else if (isFollowing && eventData) {
                // Split: Truncate the master's rrule so it ends before today
                const newRrule = truncateRruleBefore(recurrenceText(eventData.metadata.rrule), eventData.metadata.date || '');
                await patchVaultPage(eventData.id, {
                    metadata: { rrule: newRrule }
                });
                toast.success(t('calendar.following_deleted', "Series truncated from today."));
            } else {
                await deleteVaultPage(deleteId);
                toast.success(t('calendar.event_deleted', "Appointment deleted."));
            }
            onSaved?.();
            onClose?.();
        } catch (err) {
                        const errorMsg = textValue(record(record(record(err).response).data).detail) || (err instanceof Error ? err.message : '');
            toast.error(`${t('calendar.event_delete_error', "Error deleting the appointment.")} ${errorMsg}`);
        } finally {
            setDeleting(false);
            setIsRecurrenceDeleteOpen(false);
        }
    };


 return handleDelete;
}
