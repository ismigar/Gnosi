function isUnknownRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}


function scalarText(value: unknown): string {
    return typeof value === 'string'
        || typeof value === 'number'
        || typeof value === 'boolean'
        ? String(value)
        : '';
}


/** Match the backend calendar-entry classification at every frontend boundary. */
export function isCalendarPage(page: unknown): boolean {
    if (!isUnknownRecord(page)) return false;
    const metadata = isUnknownRecord(page.metadata) ? page.metadata : {};
    const source = scalarText(metadata.source).trim().toLowerCase();
    const hasDate = Boolean(metadata.date);
    const tableId = page.resolved_table_id
        || metadata.table_id
        || metadata.database_table_id;
    const folder = scalarText(page.folder);
    const isEntry = hasDate
        && (source === 'gnosi' || source === 'gnosi vault' || !tableId);
    const isInFolder = folder === 'Calendar' || folder.startsWith('Calendar/');
    return isEntry || isInFolder;
}
