import { useEffect, useRef, useState } from 'react';
import { subscribeWindowEvent } from '../../../shared/platform/browser-events';
import type { TitlePreviewController } from '../useTitlePreview';
import { useTitlePreview } from '../useTitlePreview';
import type { TableInputs } from './tableInputs';
import type { EditingCell, FileDeletePrompt, MediaPickerCell, TableCell } from './types';
import { useLatestRef } from './useLatestRef';

type Inputs = Pick<TableInputs, 'activeView' | 'onNoteSelect' | 'searchTermProp'>;

export function useTableState({ activeView, onNoteSelect, searchTermProp }: Inputs) {
  const ROWS_BATCH_SIZE = 50;
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => ({
    title: 250,
    last_modified: 150,
    ...(activeView?.columnWidths || {}),
  }));
  const columnWidthsRef = useLatestRef<Record<string, number>>(columnWidths);
  const viewWidthsRef = useLatestRef(activeView?.columnWidths);
  useEffect(() => {
    setColumnWidths({ title: 250, last_modified: 150, ...(viewWidthsRef.current || {}) });
  }, [activeView?.id, viewWidthsRef]);
  const rowHeight = activeView?.rowHeight || 'normal';
  const rowPadClass = rowHeight === 'compact' ? 'py-1' : (rowHeight === 'tall' ? 'py-4' : 'py-2.5');
  const groupByField = activeView?.groupBy || '';
  const [, setIsDropdownOpen] = useState(false);
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [activeCell, setActiveCell] = useState<TableCell | null>(null);
  const [anchorCell, setAnchorCell] = useState<TableCell | null>(null);
  const [editInitial, setEditInitial] = useState<string | null>(null);
  const clipboardRef = useRef<{ matrix: unknown[][]; } | null>(null);
  const activeCellRef = useLatestRef<TableCell | null>(activeCell);
  const anchorCellRef = useLatestRef<TableCell | null>(anchorCell);
  const editingCellRef = useLatestRef<EditingCell | null>(editingCell);
  const titlePreview = useTitlePreview({ onOpenPage: onNoteSelect });
  const titlePreviewRef = useLatestRef<TitlePreviewController | null>(titlePreview);
  const [mediaPickerCell, setMediaPickerCell] = useState<MediaPickerCell | null>(null);
  const [fileDeletePrompt, setFileDeletePrompt] = useState<FileDeletePrompt | null>(null);
  const [fileDeleteBusy, setFileDeleteBusy] = useState(false);
  useEffect(() => {
    if (!fileDeletePrompt) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !fileDeleteBusy) setFileDeletePrompt(null); };
    const unsubscribeonKey = subscribeWindowEvent('keydown', onKey);
    return () => { unsubscribeonKey(); };
  }, [fileDeletePrompt, fileDeleteBusy]);
  const [aggregations, setAggregations] = useState<Record<string, string>>({});
  const [internalSearchTerm] = useState('');
  const searchTerm = searchTermProp !== undefined ? searchTermProp : internalSearchTerm;
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const [newSubitemTitle, setNewSubitemTitle] = useState('');
  const [addingSubitemFor, setAddingSubitemFor] = useState<string | null>(null);
  const [openingResourceId, setOpeningResourceId] = useState<string | null>(null);
  const [visibleRowsCount, setVisibleRowsCount] = useState(ROWS_BATCH_SIZE);
  const [bulkTranslateIds, setBulkTranslateIds] = useState<string[] | null>(null);
  const [openHeaderHelp, setOpenHeaderHelp] = useState<Record<string, boolean>>({});
  return { ROWS_BATCH_SIZE, columnWidths, setColumnWidths, columnWidthsRef, rowHeight, rowPadClass, groupByField, setIsDropdownOpen, editingCell, setEditingCell, activeCell, setActiveCell, anchorCell, setAnchorCell, editInitial, setEditInitial, clipboardRef, activeCellRef, anchorCellRef, editingCellRef, titlePreview, titlePreviewRef, mediaPickerCell, setMediaPickerCell, fileDeletePrompt, setFileDeletePrompt, fileDeleteBusy, setFileDeleteBusy, aggregations, setAggregations, searchTerm, expandedRows, setExpandedRows, expandedGroups, setExpandedGroups, newSubitemTitle, setNewSubitemTitle, addingSubitemFor, setAddingSubitemFor, openingResourceId, setOpeningResourceId, visibleRowsCount, setVisibleRowsCount, bulkTranslateIds, setBulkTranslateIds, openHeaderHelp, setOpenHeaderHelp };
}
