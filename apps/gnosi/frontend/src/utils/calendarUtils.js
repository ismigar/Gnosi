/**
 * Genera una clau d'ocurrència consistent per a EXDATES i identificació d'instàncies.
 * @param {string} instanceStart - Data/hora de l'instància (format ISO o FullCalendar startStr)
 * @param {string} dateOnly - Data alternativa si no hi ha instanceStart
 * @param {boolean} allDay - Si l'event és de tot el dia
 * @param {object} eventMeta - Metadades de l'event (opcional)
 * @returns {string} - Clau formatada (YYYY-MM-DD o YYYY-MM-DDTHH:mm:ss)
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
        // Fallback robust si startStr ja és local sense timezone
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
 * Trunca una RRULE perquè acabi just abans de la data de tall.
 * @param {string} rrule - El string RRULE original
 * @param {string} splitDate - La data de tall (format ISO o YYYY-MM-DD)
 * @returns {string} - La nova RRULE amb UNTIL configurat
 */
export const truncateRruleBefore = (rrule, splitDate) => {
    if (!rrule) return null;

    // Eliminem qualsevol UNTIL o COUNT existent
    let parts = rrule.split(';').filter(p => !p.startsWith('UNTIL=') && !p.startsWith('COUNT='));

    // Calculem el dia anterior a splitDate (en UTC).
    // Abans s'usaven mètodes de data locals (getFullYear/getMonth/getDate)
    // i s'afegia el sufix Z, generant UNTIL invàlids quan la zona horària
    // de l'usuari estava prou lluny de UTC perquè el dia local i UTC no
    // coincidissin (a EST, fins ~5h podia retrocedir un dia extra).
    const dt = new Date(splitDate);
    dt.setUTCDate(dt.getUTCDate() - 1);

    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dt.getUTCDate()).padStart(2, '0');

    const compactUntil = `${y}${m}${d}T235959Z`;
    parts.push(`UNTIL=${compactUntil}`);

    return parts.join(';');
};
