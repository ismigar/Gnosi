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
