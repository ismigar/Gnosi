import { useEffect, useMemo } from 'react';
import { getFieldType, getLanguageFieldName, getSchemaFieldEntries, resolveFieldRef, resolveViewSorts } from '../../../../shared/records/model/schemaUtils';
import type { TableInputs } from './tableInputs';
import type { useTableState } from './useTableState';

type Inputs = Pick<TableInputs, 'activeView' | 'onUpdateView' | 'schema'>
  & Pick<ReturnType<typeof useTableState>, 'setColumnWidths'>;

export function useTableColumns({ activeView, onUpdateView, schema, setColumnWidths }: Inputs) {
  const handleSort = (field: string) => {
    if (!activeView || !onUpdateView) return;
    const primary = resolveViewSorts(activeView)[0];
    const isCurrentField = primary?.field === field;
    let newDirection = 'asc';
    if (isCurrentField) {
      newDirection = primary.direction === 'asc' ? 'desc' : 'asc';
    }
    const newSorts = [{ field, direction: newDirection }];
    const updatedView = { ...activeView, sort: newSorts, sorts: newSorts };
    onUpdateView(updatedView);
  };
  const dynamicColumns = useMemo(() => {
    const titleFieldName = Object.entries(schema).find(([, t]) => t === 'title')?.[0];
    const baseFields = activeView?.visibleProperties?.length
      ? activeView.visibleProperties.map((key): [string, string] => [key, getFieldType(schema, key)]).filter(([key, type]) => key && type)
      : getSchemaFieldEntries(schema).filter(([, type]) => type !== 'title');

    return baseFields.filter(([key, type]) => key !== titleFieldName && key !== 'title' && type !== 'title' && type !== 'button');
  }, [activeView, schema]);
  const canReorderColumns = !!onUpdateView && !!activeView;
  const showModifiedColumn = useMemo(() => {
    const vp = activeView?.visibleProperties;
    if (!vp || vp.length === 0) return true;
    return vp.some(k => k === 'last_modified' || k === 'modified' || k === 'last_edited_time');
  }, [activeView]);
  const hasVisibleLanguageColumn = useMemo(() => {
    const langFieldName = getLanguageFieldName(schema);
    if (!langFieldName) return false;
    return dynamicColumns.some(([key]) => resolveFieldRef(schema, key).name === langFieldName);
  }, [dynamicColumns, schema]);
  useEffect(() => {
    setColumnWidths(prev => {
      const newWidths = { ...prev };
      let changed = false;
      for (const [key] of dynamicColumns) {
        if (!newWidths[key]) {
          newWidths[key] = 180;
          changed = true;
        }
      }
      return changed ? newWidths : prev;
    });
  }, [dynamicColumns, schema, setColumnWidths]);
  const gridColumns = useMemo(
    () => [{ key: 'title', type: 'title' }, ...dynamicColumns.map(([key, type]) => ({ key, type }))],
    [dynamicColumns]
  );
  return { handleSort, dynamicColumns, canReorderColumns, showModifiedColumn, hasVisibleLanguageColumn, gridColumns };
}
