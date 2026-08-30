import { toast } from '../../../lib/toast';
import type { TFunction } from 'i18next';
import { createCalendarEvent, deleteCalendarEvent, updateCalendarEvent } from '../../../shared/api/calendar';
import { createVaultPage, deleteVaultPage, patchVaultPage } from '../../../shared/api/vaults';
import { buildOccurrenceKey, inclusiveToExclusiveAllDayEnd, truncateRruleBefore } from '../../../utils/calendarUtils';
import type { EventFormProps } from './calendarTypes';
import type { EventFieldState } from './useEventFields';
import { calendarEntry } from './calendarBoundary';
import { buildDatetime, buildExternalEventData, buildLocalMetadata, recurrenceText } from './eventFormModel';
export function eventSaveActions(props: EventFormProps, state: EventFieldState, t: TFunction) {
 const {mode, eventData, calendars, onSaved, onClose} = props;
 const { fields, lastSavedDataRef, createdIdRef, isCreatingRef, googleRef, setSaving, setSaveError, setCreatedId, setIsRecurrenceModifyOpen } = state;
 const {title, allDay, startDate, endDate, startTime, endTime, calendarId, location, locationLat, locationLon, reminder, recurrence, selectedDays, endType, endCount, untilDate, description, attendees, travelTime} = fields;
    const handleSubmit = async (e: {preventDefault: () => void} | null = null, silent = true, snapshot: string | null = null, isSeries = false, isInstanceOnly = false, isFollowing = false) => {
        if (e) e.preventDefault();
        if (!title.trim() || !startDate) return;

        // Prevents a second creation (POST) while the first one is still in flight
        if (!eventData?.id && !createdIdRef.current && isCreatingRef.current) return;

        // If it's a manual save (not silent) of a recurring event and we haven't chosen yet
        const isRecurrent = !!(eventData?.metadata.rrule || eventData?.metadata.recurrence);
        if (!silent && isRecurrent && !isSeries && !isInstanceOnly && !isFollowing) {
            setIsRecurrenceModifyOpen(true);
            return;
        }

        setSaving(true);
        setSaveError(false);

        const fullStart = buildDatetime(startDate, startTime, allDay);
        const fullEnd = buildDatetime(endDate, endTime, allDay);
        const googleEnd = allDay
            ? inclusiveToExclusiveAllDayEnd(endDate || startDate)
            : (fullEnd || fullStart);

        // ─── Editing a Google event that ALREADY EXISTS (reopened in edit mode) → PATCH to Google ───
        const existGm = eventData?.metadata || {};
        const isExistingGoogle = mode === 'edit' && eventData?.id && (existGm._provider === 'google' || existGm._account) && !existGm._vault_path;
        if (isExistingGoogle) {
            const formSnap = snapshot || JSON.stringify({
                title, allDay, startDate, endDate, startTime, endTime,
                calendarId, location, locationLat, locationLon, reminder, recurrence, selectedDays,
                endType, endCount, untilDate, description, attendees, travelTime
            });
            try {
                await updateCalendarEvent({
                    calendarId: existGm._calendar_id || 'primary',
                    email: existGm._account || '',
                    eventId: eventData.id,
                    event: {
                        summary: title.trim(),
                        location: location.trim(),
                        description: description.trim() || '',
                        start: fullStart,
                        end: googleEnd,
                        calendar_id: existGm._calendar_id || 'primary',
                        attendees,
                    },
                });
                lastSavedDataRef.current = formSnap;
                if (!silent) toast.success(t('calendar.event_updated', "Appointment updated!"));
                // Optimistic update (without refetch) so as not to reload the whole calendar on
                // every keystroke: we pass the updated event so only this one is refreshed.
                onSaved?.({
                    id: eventData.id,
                    title: title.trim(),
                    content: description.trim() || '',
                    metadata: {
                        ...existGm,
                        date: fullStart,
                        end_date: googleEnd,
                        all_day: allDay,
                        location: location.trim(),
                        description: description.trim() || '',
                        attendees,
                    },
                });
                if (!silent) onClose?.();
            } catch {
                /* Preserve the existing best-effort cleanup behavior. */
                setSaveError(true);
                if (!silent) toast.error(t('calendar.event_save_error', "Error sending the appointment."));
                if (silent && snapshot) lastSavedDataRef.current = snapshot;
            } finally {
                setSaving(false);
            }
            return;
        }

        // ─── Google Calendar: actually create/edit the event in Google (not in the Vault) ───
        const selCal = calendars.find(c => c.id === calendarId);
        const isGoogleCal = !!(selCal && selCal.kind === 'external' && selCal.google_calendar_id && selCal.account);
        if (isGoogleCal && mode !== 'edit') {
            const formSnap = snapshot || JSON.stringify({
                title, allDay, startDate, endDate, startTime, endTime,
                calendarId, location, locationLat, locationLon, reminder, recurrence, selectedDays,
                endType, endCount, untilDate, description, attendees, travelTime
            });
            try {
                if (googleRef.current?.id) {
                    // Updates the event we already created in Google during this session
                    await updateCalendarEvent({
                        calendarId: googleRef.current.calendar_id,
                        email: googleRef.current.account,
                        eventId: googleRef.current.id,
                        event: {
                            summary: title.trim(),
                            location: location.trim(),
                            description: description.trim() || '',
                            start: fullStart,
                            end: googleEnd,
                            calendar_id: googleRef.current.calendar_id,
                            attendees,
                        },
                    });
                } else if (!isCreatingRef.current) {
                    // Creates the new event in Google (we store the id to avoid duplicating it)
                    isCreatingRef.current = true;
                    const created = await createCalendarEvent({
                        calendarId: selCal.google_calendar_id || 'primary',
                        email: selCal.account || '',
                        event: buildExternalEventData(fields),
                    });
                    if (created.id) {
                        googleRef.current = { id: created.id, account: selCal.account || '', calendar_id: selCal.google_calendar_id || 'primary' };
                        setCreatedId(created.id);
                        // If the appointment already existed in the Vault (calendar change Tasks→Google),
                        // delete it so it doesn't remain duplicated.
                        if (createdIdRef.current) {
                            try { await deleteVaultPage(createdIdRef.current); }
                            catch { /* Preserve the existing best-effort cleanup behavior. */ }
                            createdIdRef.current = null;
                        }
                    }
                }
                lastSavedDataRef.current = formSnap;
                if (!silent) toast.success(t('calendar.event_created', "Appointment created!"));
                onSaved?.();
                if (!silent) onClose?.();
            } catch {
                /* Preserve the existing best-effort cleanup behavior. */
                setSaveError(true);
                if (!silent) toast.error(t('calendar.event_save_error', "Error sending the appointment."));
                if (silent && snapshot) lastSavedDataRef.current = snapshot;
            } finally {
                setSaving(false);
                isCreatingRef.current = false;
            }
            return;
        }

        const {metadata, removeMetaKeys} = buildLocalMetadata(fields, props);

        try {
            if (mode === 'edit' && eventData?.id) {
                if (isInstanceOnly) {
                    // 1. Add EXDATE to the master
                    const instanceDate = eventData.metadata.date;
                    const occurrenceKey = buildOccurrenceKey(instanceDate, null, eventData.metadata.all_day, eventData.metadata);

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

                    // 2. Creates a new single appointment
                    const newMetadata = { ...metadata, rrule: null, exdates: [] };
                    const response = await createVaultPage({
                        title: title.trim(),
                        content: description.trim() || '',
                        metadata: newMetadata,
                    });
                    onSaved?.(calendarEntry(response));
                    onClose?.();
                    toast.success(t('calendar.instance_updated'));
                } else if (isFollowing) {
                    // 1. Truncate the old master's rrule
                    const newRruleOldMaster = truncateRruleBefore(recurrenceText(eventData.metadata.rrule), eventData.metadata.date || '');
                    await patchVaultPage(eventData.id, {
                        metadata: { rrule: newRruleOldMaster }
                    });

                    // 2. Create a new master that starts on the new date
                    const newMetadata: Record<string, unknown> = {
                        ...(eventData.metadata),
                        ...metadata,
                        exdates: [],
                    };
                    delete newMetadata.id;

                    const response = await createVaultPage({
                        title: title.trim(),
                        content: description.trim() || '',
                        metadata: newMetadata,
                    });
                    onSaved?.(calendarEntry(response));
                    onClose?.();
                    toast.success(t('calendar.series_split_updated'));
                } else {
                    // Normal patch (or the whole series)
                    const response = await patchVaultPage(eventData.id, {
                        title: title.trim(),
                        content: description.trim() || undefined,
                        metadata,
                        ...(removeMetaKeys.length ? { remove_metadata_keys: removeMetaKeys } : {}),
                    });

                    if (!silent) toast.success(t('calendar.event_updated', "Appointment updated!"));
                    onSaved?.(calendarEntry(response));
                    if (!silent) onClose?.();
                }
            } else if (createdIdRef.current) {
                // Appointment already created in this same session: PATCH (we continue editing it)
                const response = await patchVaultPage(createdIdRef.current, {
                    title: title.trim(),
                    content: description.trim() || undefined,
                    metadata,
                    ...(removeMetaKeys.length ? { remove_metadata_keys: removeMetaKeys } : {}),
                });
                if (!silent) toast.success(t('calendar.event_updated', "Appointment updated!"));
                onSaved?.(calendarEntry(response));
                if (!silent) onClose?.();
            } else {
                // First creation: POST. Stores the id so subsequent autosaves do a
                // PATCH (not duplicate) and the UI switches to "edit" mode.
                isCreatingRef.current = true;
                const response = await createVaultPage({
                    title: title.trim(),
                    content: description.trim() || '',
                    metadata,
                });
                createdIdRef.current = response.id || null;
                setCreatedId(createdIdRef.current);
                // If the appointment already existed in Google (calendar change Google→table),
                // delete it from Google so it doesn't remain duplicated.
                if (googleRef.current?.id) {
                    try {
                        await deleteCalendarEvent({
                            calendarId: googleRef.current.calendar_id,
                            email: googleRef.current.account,
                            eventId: googleRef.current.id,
                        });
                    } catch { /* Preserve the existing best-effort cleanup behavior. */ }
                    googleRef.current = null;
                }
                if (!silent) toast.success(t('calendar.event_created', "Appointment created!"));
                onSaved?.(calendarEntry(response));
                if (!silent) onClose?.();
            }

            lastSavedDataRef.current = snapshot || JSON.stringify({
                title, allDay, startDate, endDate, startTime, endTime,
                calendarId, location, locationLat, locationLon, reminder, recurrence, selectedDays,
                endType, endCount, untilDate, description, attendees, travelTime
            });
        } catch {
            /* Preserve the existing best-effort cleanup behavior. */
            setSaveError(true);
            if (!silent) toast.error(t('calendar.event_save_error', "Error sending the appointment."));
            if (silent && snapshot) lastSavedDataRef.current = snapshot;
        } finally {
            setSaving(false);
            setIsRecurrenceModifyOpen(false);
            isCreatingRef.current = false;
        }
    };


 return handleSubmit;
}
export type SaveEvent = ReturnType<typeof eventSaveActions>;
