import type { EventApi } from '@fullcalendar/core';

import { logError } from '../../../../shared/notifications/notifyError';
import { toast } from '../../../../shared/notifications/toast';
import { updateCalendarEvent } from '../../../../shared/api/calendar';
import { patchVaultPage, type VaultPagePatchInput } from '../../../../shared/api/vaults';
import { exclusiveToInclusiveAllDayEnd } from '../../../../shared/dates/calendarUtils';
import { parsePeriod, withPeriodBoundaries } from '../../../../shared/dates/projectPlanning';
import { calendarEventDetails, localCalendarDateTime } from './calendarEventModel';
import { calendarPeriodInput, calendarText, isCalendarPeriod } from './calendarPeriod';
import type { CalendarMetadata, DigitalBrainCalendarProps } from './calendarTypes';

export interface CalendarChange {
  readonly event: Pick<EventApi, 'id' | 'extendedProps' | 'allDay' | 'start' | 'end' | 'startStr' | 'endStr'>;
  readonly oldEvent?: Pick<EventApi, 'startStr'>;
  readonly revert: () => void;
}

export type CalendarMutationOptions = Pick<DigitalBrainCalendarProps,
  'onEventEdit' | 'onRefresh' | 'dateField' | 'endDateField'>;
type CalendarTranslate = (key: string, fallback: string) => string;

export function calendarMetadataPatch(
  metadata: CalendarMetadata,
  start: string,
  end: string | null,
  mode: 'move' | 'resize',
  options: CalendarMutationOptions,
): VaultPagePatchInput {
  const startKey = options.dateField || 'date';
  const endKey = options.endDateField || 'end_date';
  const current = metadata[startKey];
  if (isCalendarPeriod(current)) {
    const input = calendarPeriodInput(current);
    const nextStart = mode === 'resize' ? parsePeriod(input).start : start;
    return { metadata: { [startKey]: withPeriodBoundaries(
      input, nextStart, end || nextStart,
      mode === 'move' ? { startMode: 'manual', endMode: 'manual' } : { endMode: 'manual' },
    ) } };
  }
  if (mode === 'resize') return { metadata: { [endKey]: end } };
  return { metadata: { [startKey]: start, ...(end ? { [endKey]: end } : {}) } };
}

export async function persistCalendarChange(
  change: CalendarChange,
  mode: 'move' | 'resize',
  options: CalendarMutationOptions,
  t: CalendarTranslate,
): Promise<void> {
  const { event } = change;
  const { id, readonly, metadata } = calendarEventDetails(event);
  if (readonly) {
    change.revert();
    toast.error(mode === 'move'
      ? t('calendar.external_move_error', "You can't move an external event (Read-Only).")
      : t('calendar.external_resize_error', "You can't resize an external event."));
    return;
  }
  const failure = (): void => {
    change.revert();
    toast.error(mode === 'move'
      ? t('calendar.move_event_error', 'Error moving the event.')
      : t('calendar.resize_event_error', 'Error resizing the event.'));
  };
  if ((!event.allDay && !event.start) || (mode === 'resize' && !event.end)) {
    failure();
    return;
  }
  const start = event.allDay || !event.start ? event.startStr : localCalendarDateTime(event.start);
  const end = event.end
    ? event.allDay ? exclusiveToInclusiveAllDayEnd(event.endStr) : localCalendarDateTime(event.end)
    : null;
  if (metadata.rrule || metadata.recurrence) {
    change.revert();
    if (options.onEventEdit) {
      options.onEventEdit(id, {
        ...(mode === 'move' ? { date: start } : {}),
        end_date: end,
        instanceStart: mode === 'move' ? change.oldEvent?.startStr || event.startStr : event.startStr,
      }, mode);
    } else {
      toast.error(t('calendar.recurrent_edit_elsewhere', 'Recurring events are edited from the main calendar.'));
    }
    return;
  }
  try {
    const isGoogle = (metadata._provider === 'google' || Boolean(metadata._account)) && !metadata._vault_path;
    if (isGoogle) {
      const calendarId = calendarText(metadata._calendar_id) || 'primary';
      await updateCalendarEvent({
        calendarId, email: calendarText(metadata._account), eventId: id,
        event: { start: event.startStr, end: event.endStr || event.startStr, calendar_id: calendarId },
      });
    } else {
      await patchVaultPage(id, calendarMetadataPatch(metadata, start, end, mode, options));
    }
    toast.success(mode === 'move'
      ? t('calendar.date_updated', 'Date updated!')
      : t('calendar.duration_updated', 'Duration updated!'));
    options.onRefresh?.();
  } catch (error) {
    logError(`calendar.${mode}`, error);
    failure();
  }
}
