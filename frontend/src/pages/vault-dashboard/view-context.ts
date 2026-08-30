import { buildSchemaFromTableProperties } from '../../components/Vault/schemaUtils';
import type { View, Table } from './types';
export function prepareDashboardViewContext(cv: View, table: Table | undefined, allTables: readonly Table[]) {
    const rawVisible = cv.visibleProperties || cv.visible_properties || cv.columns || ['title'];
    const stringColumns = Array.isArray(rawVisible)
        ? rawVisible.map(column => typeof column === 'string' ? column : (column.fieldKey || 'title'))
        : ['title'];
    const mergedView = { ...cv, visibleProperties: stringColumns };
    const properties = [...(table?.properties || [])];
    if (cv.joins && Array.isArray(cv.joins)) {
        cv.joins.forEach(join => {
            const joined = allTables.find(candidate => candidate.id === join.tableId);
            if (!joined?.properties)
                return;
            joined.properties.forEach(property => {
                if (!properties.some(existing => existing.name === property.name))
                    properties.push(property);
            });
        });
    }
    return { mergedView, mergedSchema: buildSchemaFromTableProperties(properties) };
}
export const VIEW_WRAPPERS: Readonly<Record<string, string>> = {
    board: 'p-0 h-full overflow-y-auto w-full custom-scrollbar bg-[var(--bg-primary)]',
    calendar: 'p-6 h-full',
    gallery: 'p-0 h-full overflow-hidden w-full',
    timeline: 'p-0 h-full overflow-hidden w-full bg-[var(--bg-primary)]',
    feed: 'p-0 h-full overflow-y-auto w-full custom-scrollbar bg-[var(--bg-primary)]',
};
