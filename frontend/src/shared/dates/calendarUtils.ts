interface CalendarEventMeta {
  [key: string]: unknown;
  all_day?: unknown;
  date?: string | null;
}

type CalendarDay = string | number | boolean | null | undefined;

/** Generates a consistent occurrence key for EXDATE and instance identity. */
export const buildOccurrenceKey = (
  instanceStart: string | null | undefined,
  dateOnly: string | null | undefined,
  allDay: boolean | null | undefined,
  eventMeta?: CalendarEventMeta | null,
): string => {
  const eventIsAllDay =
    allDay ||
    Boolean(eventMeta?.all_day) ||
    !(eventMeta?.date || '').includes('T');
  const sourceValue = instanceStart || dateOnly || '';
  if (!sourceValue) return '';

  if (eventIsAllDay) {
    return sourceValue.split('T')[0] ?? '';
  }

  const dt = new Date(sourceValue);
  if (Number.isNaN(dt.getTime())) {
    // Robust fallback if startStr is already local without a timezone.
    const withoutOffset = sourceValue.split('+')[0] ?? '';
    const base = withoutOffset.split('Z')[0] ?? '';
    const hhmm = base.includes('T')
      ? (base.split('T')[1]?.slice(0, 5) ?? '00:00')
      : '00:00';
    const day = base.split('T')[0] ?? '';
    return `${day}T${hhmm}:00`;
  }

  const y = String(dt.getFullYear());
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  const h = String(dt.getHours()).padStart(2, '0');
  const min = String(dt.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d}T${h}:${min}:00`;
};

const DAY_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Shifts a date-only value without crossing through UTC. */
export const shiftCalendarDay = <T extends CalendarDay>(
  day: T,
  delta: number,
): string | T => {
  const value = String(day || '').trim();
  if (!DAY_ONLY_RE.test(value)) return day;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return day;
  date.setDate(date.getDate() + delta);
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const dateOfMonth = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${dateOfMonth}`;
};

/** Converts a user-facing inclusive all-day end into a provider-exclusive end. */
export const inclusiveToExclusiveAllDayEnd = <T extends CalendarDay>(
  end: T,
): string | T => shiftCalendarDay(end, 1);

/** Converts a provider-exclusive all-day end into a user-facing inclusive end. */
export const exclusiveToInclusiveAllDayEnd = <T extends CalendarDay>(
  end: T,
): string | T => shiftCalendarDay(end, -1);

/** Truncates an RRULE so it ends right before the cutoff date. */
export const truncateRruleBefore = (
  rrule: string | null | undefined,
  splitDate: string,
): string | null => {
  if (!rrule) return null;

  const parts = rrule
    .split(';')
    .filter((part) => !part.startsWith('UNTIL=') && !part.startsWith('COUNT='));

  // Calculate the day before splitDate in UTC so local offsets cannot shift it.
  const dt = new Date(splitDate);
  dt.setUTCDate(dt.getUTCDate() - 1);

  const y = String(dt.getUTCFullYear());
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');

  const compactUntil = `${y}${m}${d}T235959Z`;
  parts.push(`UNTIL=${compactUntil}`);

  return parts.join(';');
};
