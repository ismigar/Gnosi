import type { VaultGraphNode } from '../../../shared/api/graph';
import { transportAttributes } from '../../../shared/graph/viewer/graphViewerModel';
import { getEffectiveTableId } from '../../../shared/graph/filtering/graphFilters';

function identifier(value: unknown): string | null {
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : null;
}

/** Read-only projection: API identifiers may be scalar; graph categories are strings. */
export function settingsGraphNode(node: VaultGraphNode) {
    const metadata = transportAttributes(node.metadata);
    const tableId = getEffectiveTableId({
        database_id: identifier(node.database_id), table_id: identifier(node.table_id),
        database_table_id: identifier(node.database_table_id), kind: node.kind, path: node.path,
        metadata: {
            database_id: identifier(metadata.database_id), table_id: identifier(metadata.table_id),
            database_table_id: identifier(metadata.database_table_id), account_id: identifier(metadata.account_id),
            calendar_id: identifier(metadata.calendar_id), source: identifier(metadata.source),
        },
    });
    return { tableId, metadata };
}
