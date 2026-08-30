import { useCallback, useMemo } from 'react';
import { resolveViewFilters, resolveViewSorts } from '../schemaUtils';
import { useVaultViewData } from '../../../hooks/useVaultViewData';
import { requireFilterNodes } from '../../../utils/filterContracts';
import { buildTableRowTree } from './rowTree';
import type { TableInputs } from './tableInputs';
import type { TableNote } from './types';
import type { useTableOptimistic } from './useTableOptimistic';
import type { useTableState } from './useTableState';

type Inputs = Pick<TableInputs, 'activeView' | 'schema'>
  & Pick<ReturnType<typeof useTableState>, 'searchTerm'>
  & Pick<ReturnType<typeof useTableOptimistic>, 'datedNotes' | 'safeNotes'>;

export function useTableData({ activeView, searchTerm, datedNotes, schema, safeNotes }: Inputs) {
  const effectiveSorts = useMemo(
    () => resolveViewSorts(activeView, { field: "last_modified", direction: "desc" }),
    [activeView]
  );
  const activeSort = effectiveSorts[0] || { field: '', direction: '' };
  const sortSignature = effectiveSorts.map(s => `${s.field}:${s.direction}`).join(',');
  const viewConfig = useMemo(() => ({
    filters: requireFilterNodes(resolveViewFilters(activeView)),
    sort: effectiveSorts,
    search: searchTerm
  }), [activeView, effectiveSorts, searchTerm]);
  const { sortedPages: sortedAndFilteredNotes } = useVaultViewData({ pages: datedNotes, schema, view: viewConfig, searchTerm });
  const resolveNoteTableId = useCallback((note: TableNote | undefined) => note?.resolved_table_id || note?.metadata?.table_id || note?.metadata?.database_table_id || null, []);
  const enableSubitems = !!activeView?.enableSubitems;
  const { childrenMap, allChildrenByParent, sortedNotes } = buildTableRowTree(
    safeNotes, sortedAndFilteredNotes, enableSubitems,
  );
  return { activeSort, sortSignature, resolveNoteTableId, enableSubitems, childrenMap, allChildrenByParent, sortedNotes };
}
