/**
 * Generates a consistent occurrence key for EXDATES and instance identification.
 * @param {string} instanceStart - Instance date/time (ISO format or FullCalendar startStr)
 * @param {string} dateOnly - Alternative date if there is no instanceStart
 * @param {boolean} allDay - Whether the event is all-day
 * @param {object} eventMeta - Event metadata (optional)
 * @returns {string} - Formatted key (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss)
 */
export const buildOccurrenceKey = (instanceStart, dateOnly, allDay, eventMeta) => {
    const eventIsAllDay = allDay || !!eventMeta?.all_day || !(eventMeta?.date || '').includes('T');
    const sourceValue = instanceStart || dateOnly || '';
    if (!sourceValue) return '';
    
    if (eventIsAllDay) {
        return sourceValue.split('T')[0];
    }
    
    const dt = new Date(sourceValue);
    if (Number.isNaN(dt.getTime())) {
        // Robust fallback if startStr is already local without a timezone
        const base = sourceValue.split('+')[0].split('Z')[0];
        const hhmm = base.includes('T') ? base.split('T')[1]?.slice(0, 5) : '00:00';
        const day = base.split('T')[0];
        return `${day}T${hhmm}:00`;
    }
    
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    const h = String(dt.getHours()).padStart(2, '0');
    const min = String(dt.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${d}T${h}:${min}:00`;
};

const DAY_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Shifts a date-only calendar value without crossing through UTC.
 * @param {string} day - Date in YYYY-MM-DD format.
 * @param {number} delta - Number of local calendar days to add.
 * @returns {string} Shifted date, or the original value when it is not date-only.
 */
export const shiftCalendarDay = (day, delta) => {
    const value = String(day || '').trim();
    if (!DAY_ONLY_RE.test(value)) return day;
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return day;
    date.setDate(date.getDate() + delta);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const dateOfMonth = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${dateOfMonth}`;
};

/** Converts a user-facing inclusive all-day end into a provider-exclusive end. */
export const inclusiveToExclusiveAllDayEnd = (end) => shiftCalendarDay(end, 1);

/** Converts a provider-exclusive all-day end into a user-facing inclusive end. */
export const exclusiveToInclusiveAllDayEnd = (end) => shiftCalendarDay(end, -1);

/**
 * Truncates an RRULE so it ends right before the cutoff date.
 * @param {string} rrule - The original RRULE string
 * @param {string} splitDate - The cutoff date (ISO format or YYYY-MM-DD)
 * @returns {string} - The new RRULE with UNTIL set
 */
export const truncateRruleBefore = (rrule, splitDate) => {
    if (!rrule) return null;

    // Remove any existing UNTIL or COUNT
    let parts = rrule.split(';').filter(p => !p.startsWith('UNTIL=') && !p.startsWith('COUNT='));

    // We calculate the day before splitDate (in UTC).
    // Local date methods (getFullYear/getMonth/getDate) used to be used
    // and the Z suffix was appended, producing invalid UNTIL values when the user's
    // timezone was far enough from UTC that the local day and UTC did not
    // matched (in EST, it could roll back an extra day until ~5h).
    const dt = new Date(splitDate);
    dt.setUTCDate(dt.getUTCDate() - 1);

    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dt.getUTCDate()).padStart(2, '0');

    const compactUntil = `${y}${m}${d}T235959Z`;
    parts.push(`UNTIL=${compactUntil}`);

    return parts.join(';');
};
