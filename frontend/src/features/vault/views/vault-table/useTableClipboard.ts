import { useCallback, useMemo } from 'react';
import { isCellFormula, supportsCellFormula, translateFormula } from './spreadsheetFormula';
import type { useTableSelection } from './useTableSelection';
import { notifyError } from '../../../../shared/notifications/notifyError';
import { toast } from '../../../../shared/notifications/toast';
import { transportFetch } from '../../../../shared/api/transports';
import { coerceValueForField, computePasteRect, isPasteableType, parseClipboardMatrix, sameCellValue, serializeCellForClipboard } from '../../properties/cellGridUtils';
import { getFieldType } from '../../../../shared/records/model/schemaUtils';
import { displayString } from './fieldConfig';
import { getMetaKey } from './metadata';
import { tableClipboard } from './cellValues';
import type { TableInputs } from './tableInputs';
import type { CellUpdate, GridColumn, MetadataPatch, TableNote } from './types';
import type { useTableData } from './useTableData';
import type { useTableColumns } from './useTableColumns';
import type { useTableIdentity } from './useTableIdentity';
import type { useTableMedia } from './useTableMedia';
import type { useTableNavigation } from './useTableNavigation';
import type { useTableOptimistic } from './useTableOptimistic';
import type { useTableOptions } from './useTableOptions';
import type { useTableSave } from './useTableSave';
import type { useTableState } from './useTableState';

type Inputs = Pick<ReturnType<typeof useTableNavigation>,
  'selectionRect'
  | 'navRows'
  | 'noteById'
  | 'selectionRectRef'
  | 'navRowsRef'
  | 'gridColumnsRef'
>
  & Pick<ReturnType<typeof useTableColumns>, 'gridColumns'>
  & Pick<ReturnType<typeof useTableSelection>, 'selectedIds'>
  & Pick<ReturnType<typeof useTableData>, 'sortedNotes'>
  & Pick<ReturnType<typeof useTableState>, 'clipboardRef' | 'selectedCells'>
  & Pick<TableInputs, 'idToTitle' | 'schema' | 'onCellSaved' | 'onUpdateView' | 'activeView'>
  & Pick<ReturnType<typeof useTableIdentity>, 't'>
  & Pick<ReturnType<typeof useTableSave>, 'propagateToParent'>
  & Pick<ReturnType<typeof useTableOptimistic>, 'setOptimisticPatches' | 'setOptimisticTitles'>
  & Pick<ReturnType<typeof useTableOptions>, 'getAvailableOptions'>
  & Pick<ReturnType<typeof useTableMedia>, 'getRelationContext'>;

export function useTableClipboard({
  selectionRect,
  navRows,
  noteById,
  gridColumns,
  selectedIds,
  sortedNotes,
  clipboardRef,
  selectedCells,
  idToTitle,
  t,
  schema,
  propagateToParent,
  setOptimisticPatches,
  setOptimisticTitles,
  onCellSaved,
  onUpdateView,
  activeView,
  getAvailableOptions,
  getRelationContext,
  selectionRectRef,
  navRowsRef,
  gridColumnsRef,
}: Inputs) {
  const selectedTargets = useMemo(() => {
    const visibleIndexes = new Map(navRows.map((row, index) => [row.id, index]));
    const ordered = new Map([...navRows, ...sortedNotes, ...noteById.values()].map(row => [row.id, row]));
    return Array.from(ordered.values()).flatMap((row, index) => selectedIds.has(row.id)
      ? [{ id: row.id, index: visibleIndexes.get(row.id) ?? index }] : []);
  }, [navRows, sortedNotes, noteById, selectedIds]);
  const getRangeCells = useCallback(() => {
    if (!selectionRect) return [];
    const { r0, c0, r1, c1 } = selectionRect;
    const rows = [];
    for (let r = r0;r <= r1;r++) {
      const navRow = navRows[r];
      if (!navRow) continue;
      const note = noteById.get(navRow.id);
      if (!note) continue;
      const cols = [];
      for (let c = c0;c <= c1;c++) {
        const col = gridColumns[c];
        if (!col || (selectedCells.length && !selectedCells.some(cell => cell.rowId === note.id && cell.field === col.key))) continue;
        if (col.key === 'title') {
          cols.push({ rowId: note.id, field: 'title', type: 'text', value: note.title ?? '' });
          continue;
        }
        const metaKey = getMetaKey(note, col.key);
        cols.push({ rowId: note.id, field: col.key, type: col.type, value: note.metadata?.[metaKey] });
      }
      if (cols.length) rows.push(cols);
    }
    return rows;
  }, [selectionRect, navRows, gridColumns, noteById, selectedCells]);
  const handleCopyCells = useCallback(() => {
    const cells = getRangeCells();
    if (cells.length === 0 || (cells[0]?.length ?? 0) === 0) return;
    const tsv = cells.map(row => row.map(c => serializeCellForClipboard(c.value, c.type, idToTitle)).join('\t')).join('\n');
    clipboardRef.current = { matrix: cells.map(row => row.map(c => c.value)), text: tsv, origin: { row: selectionRect?.r0 ?? 0, column: selectionRect?.c0 ?? 0 } };
    const clipboard = tableClipboard();
    if (clipboard?.writeText) void clipboard.writeText(tsv).catch(() => { });
    const n = cells.length * (cells[0]?.length ?? 0);
    toast.success(t('table.cells_copied', { count: n, defaultValue: `${String(n)} cel·la(es) copiada(es)` }));
  }, [clipboardRef, getRangeCells, idToTitle, t, selectionRect]);
  const propagateBulkToParents = useCallback(async (succeeded: readonly CellUpdate[]) => {
    const groups = new Map<string, { parentId: string; field: string; overrides: Map<string, unknown>; sampleChild: string; sampleValue: unknown; }>(); // `${parentId}::${field}` → { parentId, field, overrides, sampleChild, sampleValue }
    for (const u of succeeded) {
      const note = noteById.get(u.id);
      const parentId = note?.metadata?.parent_id || note?.parent_id;
      if (!parentId) continue;
      const ftype = getFieldType(schema, u.field);
      const isStatusish = ['status', 'checkbox'].includes(ftype) || ['status', 'estat'].includes(displayString(u.field).toLowerCase());
      const isDateish = ['date', 'period', 'datetime'].includes(ftype);
      if (!isStatusish && !isDateish) continue;
      const gkey = `${parentId}::${u.field}`;
      let g = groups.get(gkey);
      if (!g) { g = { parentId, field: u.field, overrides: new Map(), sampleChild: u.id, sampleValue: u.newValue }; groups.set(gkey, g); }
      g.overrides.set(u.id, u.newValue);
    }
    for (const g of groups.values()) {
      await propagateToParent(g.parentId, g.field, g.sampleChild, g.sampleValue, g.overrides);
    }
  }, [noteById, schema, propagateToParent]);
  const applyBulkCellUpdates = useCallback(async (updates: readonly CellUpdate[]) => {
    if (updates.length === 0) return;
    const map = new Map<string, CellUpdate>();
    for (const u of updates) map.set(`${u.id}::${u.key}`, u);
    const finalUpdates = [...map.values()];

    setOptimisticPatches(prev => {
      const next = new Map(prev);
      for (const u of finalUpdates) {
        if (u.field === 'title') continue;
        const existing = next.get(u.id) || {};
        next.set(u.id, { ...existing, [u.key]: u.newValue });
      }
      return next;
    });

    const titleUpdates = finalUpdates.filter(u => u.field === 'title');
    if (titleUpdates.length) setOptimisticTitles(prev => {
      const next = new Map(prev);
      for (const u of titleUpdates) next.set(u.id, displayString(u.newValue));
      return next;
    });
    const byPage = new Map<string, { title?: string; metadata?: MetadataPatch }>();
    for (const u of finalUpdates) {
      const m = byPage.get(u.id) || {};
      if (u.field === 'title') m.title = displayString(u.newValue);
      else { m.metadata ??= {}; m.metadata[u.key] = u.newValue; }
      byPage.set(u.id, m);
    }
    const pageEntries = [...byPage.entries()];

    const CHUNK = 20;
    const failedPageIds = new Set<string>();
    for (let i = 0;i < pageEntries.length;i += CHUNK) {
      const slice = pageEntries.slice(i, i + CHUNK);
      const results = await Promise.allSettled(slice.map(([id, patch]) =>
        transportFetch(`/api/vault/pages/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        }).then(r => { if (!r.ok) throw new Error(`HTTP ${String(r.status)}`); })
      ));
      results.forEach((res, j) => { if (res.status === 'rejected') failedPageIds.add((slice[j]?.[0] ?? '')); });
    }

    if (failedPageIds.size > 0) {
      if (titleUpdates.length) setOptimisticTitles(prev => {
        const next = new Map(prev);
        for (const u of titleUpdates) if (failedPageIds.has(u.id)) next.delete(u.id);
        return next;
      });
      setOptimisticPatches(prev => {
        const next = new Map(prev);
        for (const u of finalUpdates) {
          if (u.field === 'title' || !failedPageIds.has(u.id)) continue;
          const existing = next.get(u.id);
          if (!existing) continue;
          const { [u.key]: _removed, ...rest } = existing;
          if (Object.keys(rest).length === 0) next.delete(u.id);
          else next.set(u.id, rest);
        }
        return next;
      });
      notifyError('table-bulk-paste', new Error(`${String(failedPageIds.size)} pages failed`), t('table.paste_error', { count: failedPageIds.size, defaultValue: 'Error saving {{count}} pages' }));
    }

    const succeeded = finalUpdates.filter(u => !failedPageIds.has(u.id));
    await propagateBulkToParents(succeeded.filter(u => u.field !== 'title'));

    if (onCellSaved) onCellSaved();
    else if (onUpdateView) onUpdateView(activeView);
  }, [setOptimisticPatches, setOptimisticTitles, propagateBulkToParents, onCellSaved, onUpdateView, activeView, t]);
  const coercionCtxFor = useCallback((col: GridColumn, note?: TableNote) => {
    if (col.type === 'select' || col.type === 'status' || col.type === 'multi_select') {
      return { options: getAvailableOptions(col.key, col.type), idToTitle };
    }
    if (col.type === 'relation') {
      return { relatedNotes: getRelationContext(col.key, note).relatedNotes, idToTitle };
    }
    return {};
  }, [getAvailableOptions, idToTitle, getRelationContext]);
  const handlePasteCells = useCallback(async (clipboardText?: string) => {
    if (!selectionRect) return;
    let source = clipboardRef.current;
    let srcMatrix = source?.matrix ?? null;
    try {
      const clipboard = tableClipboard();
      if (clipboardText !== undefined || clipboard?.readText) {
        const text = clipboardText ?? await clipboard?.readText?.();
        if (text !== undefined && text !== source?.text) { srcMatrix = parseClipboardMatrix(text); source = null; }
      }
    } catch { /* An internal copy still works when system clipboard access is denied. */ }
    if (!srcMatrix) return;
    const srcRows = srcMatrix.length;
    const srcCols = srcMatrix[0]?.length || 0;
    if (srcRows === 0 || srcCols === 0) return;

    const rect = computePasteRect(srcRows, srcCols, selectionRect, navRows.length, gridColumns.length);
    const updates = [];
    let skipped = 0;
    const targetRows = selectedIds.size > 0 && !selectedCells.length
      ? selectedTargets
      : Array.from({ length: rect.r1 - rect.r0 + 1 }, (_, index) => ({ id: navRows[rect.r0 + index]?.id ?? '', index: rect.r0 + index }));
    for (const [targetIndex, target] of targetRows.entries()) {
      const r = target.index;
      const note = noteById.get(target.id);
      if (!note) continue;
      for (let c = rect.c0;c <= rect.c1;c++) {
        const col = gridColumns[c];
        if (!col || (selectedCells.length && !selectedCells.some(cell => cell.rowId === note.id && cell.field === col.key))) continue;
        if (col.key !== 'title' && !isPasteableType(col.type)) continue;
        const sourceRow = targetIndex % srcRows, sourceColumn = (c - rect.c0) % srcCols;
        let raw = srcMatrix[sourceRow]?.[sourceColumn];
        if (col.key === 'title') {
          const title = displayString(raw).trim();
          if (title && title !== note.title) updates.push({ id: note.id, key: 'title', field: 'title', newValue: title });
          continue;
        }
        if (isCellFormula(raw) && source?.origin) raw = translateFormula(raw, r - source.origin.row - sourceRow, c - source.origin.column - sourceColumn);
        const res = isCellFormula(raw) && supportsCellFormula(col.type)
          ? { value: raw, skip: false } : coerceValueForField(raw, col.type, coercionCtxFor(col, note));
        if (res.skip) { skipped++; continue; }
        const metaKey = getMetaKey(note, col.key);
        if (sameCellValue(note.metadata?.[metaKey], res.value)) continue;
        updates.push({ id: note.id, key: metaKey, field: col.key, newValue: res.value });
      }
    }
    await applyBulkCellUpdates(updates);
    if (skipped > 0) toast(t('table.paste_skipped', { count: skipped, defaultValue: `${String(skipped)} cel·la(es) ometa(es) (tipus incompatible)` }));
  }, [selectionRect, clipboardRef, navRows, gridColumns, applyBulkCellUpdates, t, noteById, coercionCtxFor, selectedIds, selectedTargets, selectedCells]);
  const clearActiveCells = useCallback(() => {
    const rect = selectionRectRef.current;
    if (!rect) return;
    const rows = navRowsRef.current;
    const cols = gridColumnsRef.current;
    const updates = [];
    for (let r = rect.r0;r <= rect.r1;r++) {
      const navRow = rows[r];
      if (!navRow) continue;
      const note = noteById.get(navRow.id);
      if (!note) continue;
      for (let c = rect.c0;c <= rect.c1;c++) {
        const col = cols[c];
        if (!col || !isPasteableType(col.type) || (selectedCells.length && !selectedCells.some(cell => cell.rowId === note.id && cell.field === col.key))) continue;
        const empty = (col.type === 'multi_select' || col.type === 'relation') ? [] : (col.type === 'checkbox' ? false : '');
        const metaKey = getMetaKey(note, col.key);
        if (sameCellValue(note.metadata?.[metaKey], empty)) continue;
        updates.push({ id: note.id, key: metaKey, field: col.key, newValue: empty });
      }
    }
    void applyBulkCellUpdates(updates);
  }, [selectionRectRef, navRowsRef, gridColumnsRef, applyBulkCellUpdates, noteById, selectedCells]);
  const fillDown = useCallback(async () => {
    if (!selectionRect) return;
    const { r0, r1, c0, c1 } = selectionRect;
    const sourceRow = navRows[r0];
    const sourceNote = sourceRow ? noteById.get(sourceRow.id) : undefined;
    if (!sourceNote) return;
    const updates: CellUpdate[] = [];
    const destinations = selectedIds.size ? selectedTargets : navRows;
    for (const [index, row] of destinations.entries()) {
      const visibleIndex = navRows.findIndex(visible => visible.id === row.id);
      const r = visibleIndex < 0 ? ('index' in row ? row.index : index) : visibleIndex;
      if (row.id === sourceNote.id || (selectedIds.size ? !selectedIds.has(row.id) : r <= r0 || r > r1)) continue;
      const note = noteById.get(row.id);
      if (!note) continue;
      for (let c = c0; c <= c1; c++) {
        const column = gridColumns[c];
        if (!column || column.key === 'title' || !isPasteableType(column.type)) continue;
        const raw = sourceNote.metadata?.[getMetaKey(sourceNote, column.key)];
        const result = isCellFormula(raw) && supportsCellFormula(column.type)
          ? { value: translateFormula(raw, r - r0, 0), skip: false }
          : coerceValueForField(raw, column.type, coercionCtxFor(column, note));
        const key = getMetaKey(note, column.key);
        if (!result.skip && !sameCellValue(note.metadata?.[key], result.value)) updates.push({ id: note.id, key, field: column.key, newValue: result.value });
      }
    }
    await applyBulkCellUpdates(updates);
  }, [selectionRect, navRows, noteById, selectedIds, gridColumns, coercionCtxFor, applyBulkCellUpdates, selectedTargets]);
  return { handleCopyCells, handlePasteCells, clearActiveCells, fillDown };
}
