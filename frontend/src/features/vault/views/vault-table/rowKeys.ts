import type { TableRowDescriptor, TableRowRecord } from './rowTypes';

/** Stable occurrence keys distinguish multi-group rows and nested subitems. */
export function tableRowKeys<Note extends TableRowRecord>(rows: readonly TableRowDescriptor<Note>[]): string[] {
  let group = '';
  let ancestry: string[] = [];
  return rows.map(row => {
    if (row.kind === 'group-header') { group = row.groupKey; ancestry = []; }
    if (row.kind === 'group-header' || row.kind === 'group-footer') return JSON.stringify([row.kind, row.groupKey]);
    if (row.kind === 'new-subitem') return JSON.stringify([row.kind, group, ...ancestry.slice(0, row.depth), row.parentNote.id]);
    ancestry = [...ancestry.slice(0, row.depth), row.note.id];
    return JSON.stringify([row.kind, group, ...ancestry]);
  });
}
