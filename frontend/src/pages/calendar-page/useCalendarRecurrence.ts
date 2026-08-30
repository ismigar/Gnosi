import { useTranslation } from 'react-i18next';
import { createVaultPage, deleteVaultPage, patchVaultPage } from '../../shared/api/vaults';
import { buildOccurrenceKey, truncateRruleBefore } from '../../utils/calendarUtils';
import { toast } from '../../lib/toast';
import { textValue } from '../../components/Vault/calendar-sidebar-right/calendarBoundary';
import type { useCalendarSources } from './useCalendarSources';
import type { useCalendarEventActions } from './useCalendarEventActions';

export function useCalendarRecurrence(sources: ReturnType<typeof useCalendarSources>, actions: ReturnType<typeof useCalendarEventActions>) {
    const { t } = useTranslation();
    const { pages, fetchPages } = sources;
    const { pendingDeleteId, selectedEvent, contextMenu, pendingModify, setSelectedEventId, setSelectedEvent, setEventPanel, setIsConfirmDeleteOpen, setIsRecurrenceChoiceOpen, setPendingDeleteId, setIsRecurrenceModifyOpen, setPendingModify } = actions;
    const executeDelete = async (isSeries = false, isInstanceOnly = false, isFollowing = false) => {
        const targetEventId = pendingDeleteId;
        if (!targetEventId) return;

        const eventData = pages.find(p => p.id === targetEventId) || selectedEvent;
        if (!eventData) return;

        try {
            if (isInstanceOnly) {
                const occurrenceKey = buildOccurrenceKey(
                    contextMenu.instanceStart,
                    contextMenu.date,
                    contextMenu.allDay,
                    eventData.metadata
                );
                if (!occurrenceKey) {
                    toast.error(t('calendar.error_identifying_instance'));
                    return;
                }

                const existingExdates = Array.isArray(eventData.metadata.exdates)
                    ? eventData.metadata.exdates
                    : (typeof eventData.metadata.exdates === 'string'
                        ? eventData.metadata.exdates.split(',').filter(Boolean)
                        : []);

                const patchedMetadata = {
                    ...(eventData.metadata),
                    exdates: [...new Set([...existingExdates, occurrenceKey])],
                };
                await patchVaultPage(targetEventId, {
                    metadata: patchedMetadata,
                });
                toast.success(t('calendar.instance_deleted'));
            } else if (isFollowing) {
                // Split: Truncate the master's rrule so it ends before today
                const newRrule = truncateRruleBefore(textValue(eventData.metadata.rrule), contextMenu.instanceStart);
                await patchVaultPage(targetEventId, {
                    metadata: { rrule: newRrule }
                });
                toast.success(t('calendar.following_deleted', "Series truncated from today."));
            } else {
                // Delete full series
                await deleteVaultPage(targetEventId);
                toast.success(isSeries ? t('calendar.series_deleted') : t('calendar.event_deleted'));
            }

            setSelectedEventId(null);
            setSelectedEvent(null);
            setEventPanel(null);
            setIsConfirmDeleteOpen(false);
            setIsRecurrenceChoiceOpen(false);
            setPendingDeleteId(null);
            await fetchPages();
        } catch {
            toast.error(t('calendar.error_deleting_event'));
        }
    };

    const executeModify = async ( isInstanceOnly = false, isFollowing = false) => {
        if (!pendingModify) return;
        const { id, patchData, instanceStart } = pendingModify;
        if (!id) return;

        const eventData = pages.find(p => p.id === id) || selectedEvent;
        if (!eventData) return;

        try {
            if (isInstanceOnly) {
                // 1. Add the current instance to EXDATE
                const occurrenceKey = buildOccurrenceKey(
                    instanceStart,
                    null,
                    eventData.metadata.all_day,
                    eventData.metadata
                );

                const existingExdates = Array.isArray(eventData.metadata.exdates)
                    ? eventData.metadata.exdates
                    : (typeof eventData.metadata.exdates === 'string'
                        ? eventData.metadata.exdates.split(',').filter(Boolean)
                        : []);

                await patchVaultPage(id, {
                    metadata: {
                        exdates: [...new Set([...existingExdates, occurrenceKey])],
                    }
                });

                // 2. Create a new single appointment with the new data
                const newMetadata: Record<string, unknown> = {
                    ...(eventData.metadata),
                    ...patchData,
                    rrule: null,
                    exdates: [],
                };
                delete newMetadata.id;

                await createVaultPage({
                    title: eventData.title,
                    content: eventData.content || '',
                    metadata: newMetadata,
                });

                toast.success(t('calendar.instance_updated', "Instance updated!"));
            } else if (isFollowing) {
                // 1. Truncate the old master's rrule
                const newRruleOldMaster = truncateRruleBefore(textValue(eventData.metadata.rrule), instanceStart);
                await patchVaultPage(id, {
                    metadata: { rrule: newRruleOldMaster }
                });

                // 2. Create a new master that starts on the new date
                const newMetadata: Record<string, unknown> = {
                    ...(eventData.metadata),
                    ...patchData, // Includes the new date and end_date
                    exdates: [],
                    // rrule stays the same (without the truncation)
                };
                delete newMetadata.id;

                await createVaultPage({
                    title: eventData.title,
                    content: eventData.content || '',
                    metadata: newMetadata,
                });

                toast.success(t('calendar.series_split_updated', "Series split and updated!"));
            } else {
                // Modify the whole series (the master)
                await patchVaultPage(id, {
                    metadata: {...patchData}
                });
                toast.success(t('calendar.series_updated', "Series updated!"));
            }

            setIsRecurrenceModifyOpen(false);
            setPendingModify(null);
            await fetchPages();
        } catch {
            toast.error(t('calendar.event_save_error'));
        }
    };


    return { executeDelete, executeModify };
}
