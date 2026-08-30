import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useTranslation } from 'react-i18next';

import { useLocaleSettings } from '../../hooks/useLocaleSettings';
import { useVaultSelection } from '../../hooks/useVaultSelection';
import { useVaultSelectionShortcuts } from '../../hooks/useVaultSelectionShortcuts';
import { useVaultViewData } from '../../hooks/useVaultViewData';
import { logError } from '../../lib/notifyError';
import { toast } from '../../lib/toast';
import {
  fetchVaultSummarySettings,
  summarizeVaultRecord,
  updateVaultSummarySettings,
} from '../../shared/api/vault-summary';
import { subscribeWindowEvent } from '../../shared/platform/browser-events';
import { requireFilterNodes } from '../../utils/filterContracts';
import { getFieldType, resolveViewFilters, resolveViewSorts, withResolvedSystemDates } from './schemaUtils';
import { useTitlePreview } from './useTitlePreview';
import {
  feedMetadataString,
  feedNoteTitle,
  feedValueString,
  prepareFeedBody,
  readFeedDocked,
  readFeedPaneWidth,
  readFeedReadIds,
  readLastFeedRecord,
  resolveVaultFeedSettings,
  visibleFeedColumns,
  writeFeedDocked,
  writeFeedPaneWidth,
  writeFeedReadIds,
  writeLastFeedRecord,
} from './vaultFeedModel';
import type {
  VaultFeedBulkChange,
  VaultFeedBulkProposal,
  VaultFeedProps,
  VaultFeedSaveState,
  VaultFeedSummaryState,
} from './vaultFeedTypes';
import { useVaultFeedPills } from './useVaultFeedPills';


function isUnknownArray(
  value: unknown,
): value is readonly unknown[] {
  return Array.isArray(value);
}


export function useVaultFeedController({
  activeView = {},
  allNotes = [],
  density = 'comfortable',
  groupMode = 'none',
  idToTitle = {},
  isEmbedded = false,
  notes = [],
  onApplyTemplate,
  onClearSearch,
  onCreateRecord,
  onDeletePage,
  onDeleteSelected,
  onNoteSelect,
  onOpenConfig,
  onSearchChange,
  onUpdateNote,
  schema = {},
  searchTerm = '',
  templates = [],
}: VaultFeedProps) {
  const { i18n, t } = useTranslation();
  const localeSettings = useLocaleSettings();
  const settings = resolveVaultFeedSettings(activeView);
  const [previewId, setPreviewId] = useState('');
  const [paneWidth, setPaneWidth] = useState(readFeedPaneWidth);
  const [cleanReading, setCleanReading] = useState(false);
  const [dockReadingPane, setDockReadingPane] = useState(readFeedDocked);
  const [fallbackSummaryModel, setFallbackSummaryModel] = useState('');
  const [summaryText, setSummaryText] = useState('');
  const [summaryState, setSummaryState] = useState<VaultFeedSummaryState>('idle');
  const [summaryForId, setSummaryForId] = useState('');
  const [readIds, setReadIds] = useState(() => readFeedReadIds(activeView));
  const [bulkProposal, setBulkProposal] = useState<VaultFeedBulkProposal | null>(null);
  const [isCommandOpen, setIsCommandOpen] = useState(false);
  const [bulkSaveState, setBulkSaveState] = useState<VaultFeedSaveState>('idle');
  const [pendingBulkUndo, setPendingBulkUndo] = useState<readonly VaultFeedBulkChange[] | null>(null);
  const [lastRecordId, setLastRecordId] = useState(() => readLastFeedRecord(activeView));
  const titlePreview = useTitlePreview({ onOpenPage: onNoteSelect });
  const summaryModel = settings.summaryModel || fallbackSummaryModel;

  const datedNotes = useMemo(
    () => notes.map((note) => withResolvedSystemDates(note, schema)),
    [notes, schema],
  );
  const columns = useMemo(
    () => visibleFeedColumns(schema, activeView),
    [activeView, schema],
  );
  const viewConfig = useMemo(() => ({
    filters: requireFilterNodes(resolveViewFilters(activeView)),
    search: searchTerm,
    sorts: resolveViewSorts(activeView, {
      direction: 'desc',
      field: 'last_modified',
    }),
  }), [activeView, searchTerm]);
  const { sortedPages: sortedNotes } = useVaultViewData({
    pages: datedNotes,
    schema,
    searchTerm,
    view: viewConfig,
  });
  const selection = useVaultSelection(sortedNotes);
  const buildPills = useVaultFeedPills({
    allNotes,
    columns,
    idToTitle,
    localeSettings,
    onNoteSelect,
    onUpdateNote,
    schema,
  });
  const previewIndex = sortedNotes.findIndex((note) => note.id === previewId);
  const previewNote = previewIndex >= 0 ? sortedNotes[previewIndex] ?? null : null;
  const bulkSelectFields = columns.filter(([, type]) => (
    type === 'status' || type === 'select' || type === 'multi_select'
  ));

  useEffect(() => subscribeWindowEvent('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'k') {
      event.preventDefault();
      setIsCommandOpen(true);
    }
  }), []);

  useEffect(() => {
    if (settings.summaryModel) return undefined;
    let cancelled = false;
    void fetchVaultSummarySettings()
      .then((response) => {
        if (cancelled) return;
        const model = response.settings.model;
        setFallbackSummaryModel(typeof model === 'string' ? model : '');
      })
      .catch((error: unknown) => {
        logError('vault-feed.summary-settings', error);
        if (!cancelled) setFallbackSummaryModel('');
      });
    return () => { cancelled = true; };
  }, [settings.summaryModel]);

  const markRead = useCallback((id: string): void => {
    setReadIds((current) => {
      if (current.has(id)) return current;
      const next = new Set(current).add(id);
      writeFeedReadIds(activeView, next);
      return next;
    });
  }, [activeView]);

  const openFeedRecord = useCallback((id: string): void => {
    markRead(id);
    setLastRecordId(id);
    writeLastFeedRecord(activeView, id);
    onNoteSelect?.(id);
  }, [activeView, markRead, onNoteSelect]);

  const movePreview = useCallback((offset: number): void => {
    const next = sortedNotes[previewIndex + offset];
    if (next) setPreviewId(next.id);
  }, [previewIndex, sortedNotes]);

  useEffect(() => {
    if (!previewNote) return undefined;
    return subscribeWindowEvent('keydown', (event) => {
      if (
        event.target instanceof HTMLInputElement
        || event.target instanceof HTMLTextAreaElement
      ) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        movePreview(-1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        movePreview(1);
      } else if (event.key === 'Escape') {
        setPreviewId('');
      }
    });
  }, [movePreview, previewNote]);

  const summarizePreview = async (): Promise<void> => {
    if (!previewNote || !summaryModel) return;
    setSummaryState('loading');
    setSummaryText('');
    setSummaryForId(previewNote.id);
    try {
      await updateVaultSummarySettings({ model: summaryModel });
      const response = await summarizeVaultRecord({
        content: `${feedNoteTitle(previewNote)}\n\n${prepareFeedBody(feedMetadataString(previewNote, 'description'))}`,
        language: i18n.resolvedLanguage || i18n.language || 'en',
      });
      setSummaryText(response.summary || '');
      setSummaryState('success');
    } catch (error) {
      logError('vault-feed.summarize', error);
      setSummaryState('error');
      toast.error(error instanceof Error && error.message
        ? error.message
        : t('feed.summary_error', 'Could not create the summary'));
    }
  };

  const returnToLastRecord = (): void => {
    [...document.querySelectorAll<HTMLElement>('[data-feed-note-id]')]
      .find((element) => element.dataset.feedNoteId === lastRecordId)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const handleBulkDelete = useCallback((): void => {
    if (selection.selectedIds.size === 0) return;
    if (onDeleteSelected) {
      onDeleteSelected(new Set(selection.selectedIds));
    } else if (onDeletePage) {
      for (const id of selection.selectedIds) {
        const note = notes.find((candidate) => candidate.id === id);
        if (note) onDeletePage(id, feedNoteTitle(note));
      }
    }
    selection.clearSelection();
  }, [notes, onDeletePage, onDeleteSelected, selection]);

  const applyBulkField = useCallback((
    field: string,
    value: string,
    append = false,
  ): void => {
    if (!field || !value || !onUpdateNote) return;
    const type = getFieldType(schema, field);
    const changes = [...selection.selectedIds].map((id) => {
      const note = notes.find((candidate) => candidate.id === id);
      const previous = note?.metadata?.[field];
      const existing: readonly unknown[] = isUnknownArray(previous)
        ? previous
        : previous === undefined || previous === null || previous === ''
          ? []
          : [previous];
      const next = append || type === 'multi_select'
        ? [...new Set([...existing, value])]
        : value;
      return { field, id, next, previous };
    });
    setBulkProposal({ changes, field, value });
  }, [notes, onUpdateNote, schema, selection.selectedIds]);

  const confirmBulkField = useCallback(async (): Promise<void> => {
    const changes = bulkProposal?.changes ?? [];
    if (changes.length === 0 || !onUpdateNote) return;
    setBulkSaveState('saving');
    try {
      await Promise.all(changes.map((change) => onUpdateNote(change.id, {
        metadata: { [change.field]: change.next },
      })));
      setPendingBulkUndo(changes);
      setBulkSaveState('saved');
      toast.success(t('feed.bulk_saved', 'Changes saved'));
    } catch (error) {
      logError('vault-feed.bulk-save', error);
      setBulkSaveState('error');
      toast.error(t('feed.bulk_save_error', 'Some changes could not be saved'));
    }
    selection.clearSelection();
    setBulkProposal(null);
  }, [bulkProposal, onUpdateNote, selection, t]);

  const undoBulkField = useCallback(async (): Promise<void> => {
    if (!pendingBulkUndo || !onUpdateNote) return;
    setBulkSaveState('saving');
    try {
      await Promise.all(pendingBulkUndo.map((change) => onUpdateNote(change.id, {
        metadata: { [change.field]: change.previous },
      })));
      setPendingBulkUndo(null);
      setBulkSaveState('saved');
      toast.success(t('feed.bulk_undone', 'Changes undone'));
    } catch (error) {
      logError('vault-feed.bulk-undo', error);
      setBulkSaveState('error');
      toast.error(t('feed.bulk_save_error', 'Some changes could not be saved'));
    }
  }, [onUpdateNote, pendingBulkUndo, t]);

  const toggleDockReadingPane = (): void => {
    setDockReadingPane((current) => {
      const next = !current;
      writeFeedDocked(next);
      return next;
    });
  };

  const startPaneResize = (event: ReactPointerEvent): void => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = paneWidth;
    let currentWidth = startWidth;
    const stopMove = subscribeWindowEvent('pointermove', (moveEvent) => {
      currentWidth = Math.max(
        320,
        Math.min(760, startWidth + startX - moveEvent.clientX),
      );
      setPaneWidth(currentWidth);
    });
    let stopUp = (): void => undefined;
    stopUp = subscribeWindowEvent('pointerup', () => {
      writeFeedPaneWidth(currentWidth);
      stopMove();
      stopUp();
    }, { once: true });
  };

  useVaultSelectionShortcuts({
    clearSelection: selection.clearSelection,
    enabled: selection.selectedIds.size > 0,
    onDeleteSelected: handleBulkDelete,
  });

  const resetKey = `${searchTerm}|${feedValueString(activeView.id)}|${JSON.stringify(viewConfig.filters)}|${JSON.stringify(viewConfig.sorts)}`;

  return {
    activeView,
    applyBulkField,
    bulkProposal,
    bulkSaveState,
    bulkSelectFields,
    buildPills,
    cleanReading,
    columns,
    confirmBulkField,
    density,
    dockReadingPane,
    groupMode,
    handleBulkDelete,
    isCommandOpen,
    isEmbedded,
    lastRecordId,
    movePreview,
    onApplyTemplate,
    onClearSearch,
    onCreateRecord,
    onDeletePage,
    onDeleteSelected,
    onOpenConfig,
    onSearchChange,
    onUpdateNote,
    openFeedRecord,
    paneWidth,
    pendingBulkUndo,
    previewIndex,
    previewNote,
    readIds,
    resetKey,
    returnToLastRecord,
    searchTerm,
    selection,
    setBulkProposal,
    setCleanReading,
    setIsCommandOpen,
    setPreviewId,
    settings,
    sortedNotes,
    startPaneResize,
    summarizePreview,
    summaryForId,
    summaryModel,
    summaryState,
    summaryText,
    t,
    templates,
    titlePreview,
    toggleDockReadingPane,
    undoBulkField,
  };
}


export type VaultFeedController = ReturnType<typeof useVaultFeedController>;
