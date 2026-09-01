import { ChevronLeft } from 'lucide-react';
import { ChevronRight } from 'lucide-react';
import { BlockEditor } from '../editor/BlockEditor';
import { ZoteroReaderTab } from '../../reader/zotero/ZoteroReaderTab';
import { getTableIdFromTab } from './tab-model';
import { shiftDay } from './tab-model';
import { TablePane } from './TablePane';
import { record, text } from './readers';
import type { DashboardController } from './useDashboardController';
import type { PublicBlockEditorProps } from '../editor/block-editor/page-editor/types';
import { editorMetadata, editorNote, editorTable } from './editor-readers';
export function EditorPane({ dashboard, tabId }: {
  dashboard: DashboardController;
  tabId: string;
}) {
  const context = dashboard;
  const {
    activeTabId,
    aliasIndex,
    codeViewByTabId,
    editLockedByPageId,
    fetchPages,
    globalIndex,
    handleAddNewNote,
    handleAddSchemaOption,
    handleConfigureView,
    handleDeletePage,
    handleEditSchema,
    handleEditorUpdate,
    handleOpenDailyNote,
    handleOpenInCurrentTab,
    handleOpenParallel,
    handleTabClose,
    historyOpenSignal,
    isPluginEnabled,
    loadPage,
    pageActions,
    pages,
    refTableId,
    registry,
    setCreateSourceTableId,
    setPromptModal,
    t,
    tabs,
    updatePageMetadataLocal,
  } = context;
  const tab = tabs.find(t => t.id === tabId);
  if (!tab)
    return null;
  // PDF tabs: integrated viewer. It has no Markdown content or
  // Vault metadata — only the file path. It behaves like
  // any tab (it can be closed, reordered, split-view).
  if (tab.isPdf) {
    return (<ZoteroReaderTab
      key={tab.id}
      src={tab.src || ''}
      title={tab.title}
      kind={tab.kind || 'pdf'}
      location={tab.location || null}
      // "Back" button of the viewer → closes the document and returns to
      // it was opened from (handleTabClose honors `tab.origin`).

      onClose={() => { handleTabClose(tab.id); }}
    />);
  }
  if (tab.isTable) {
    const tableId = getTableIdFromTab(tab);
    return tableId ? <TablePane
      dashboard={dashboard}
      tableId={tableId}
      mode="tab"
    /> : null;
  }
  // Daily notes: day navigation bar (← previous day · Today · next day →),
  // Obsidian style. Only shown if the active page is a daily note.
  const dailyDate = isPluginEnabled('daily-notes') && tab.metadata?.note_type === 'daily'
    ? (tab.metadata.date || tab.title)
    : null;
  const dailyBar = dailyDate ? (<div className="flex items-center justify-center gap-1 px-4 py-1.5 border-b border-[var(--border-primary)] bg-[var(--bg-primary)] text-sm">
    <button
      type="button"
      onClick={() => {
        const p = shiftDay(dailyDate, -1); if (p)
          void handleOpenDailyNote(p);
      }}
      className="p-1 rounded hover:bg-[var(--bg-primary)] text-[var(--text-secondary)]"
      title={t('vault.daily_prev', "Previous daily note")}
    >
      <ChevronLeft size={16} />
    </button>
    <button
      type="button"
      onClick={() => { void handleOpenDailyNote(); }}
      className="px-2 py-0.5 rounded hover:bg-[var(--bg-primary)] text-[var(--text-primary)] font-medium"
    >
      {t('vault.daily_today', "Today's daily note")}
    </button>
    <button
      type="button"
      onClick={() => {
        const n = shiftDay(dailyDate, 1); if (n)
          void handleOpenDailyNote(n);
      }}
      className="p-1 rounded hover:bg-[var(--bg-primary)] text-[var(--text-secondary)]"
      title={t('vault.daily_next', "Next daily note")}
    >
      <ChevronRight size={16} />
    </button>
  </div>) : null;
  const editorCallbacks = {
    onAddSchemaOption: handleAddSchemaOption,
    onRefreshNotes: fetchPages,
    onOpenParallel: handleOpenParallel,
    onOpenPage: loadPage,
    onOpenInCurrentTab: handleOpenInCurrentTab,
    onOpenInNewTab: loadPage,
    onDeletePage: handleDeletePage,
  };
  const editorEl = (
    // key MUST be the page id so React unmounts the BlockEditor (and
    // resets all its refs and timers) when the user navigates to a
    // different note. Otherwise the spurious-autosave + unmount-save
    // logic in BlockEditor can fire a final PATCH against the wrong
    // note when reconciliation reuses the component instance.
    <BlockEditor
      {...editorCallbacks}
      key={tab.id}
      noteFilename={tab.id}
      referenceTableId={refTableId}
      onCreateFromSource={(tableId: unknown) => { setCreateSourceTableId(text(tableId) || null); }}
      initialContent={tab.content}
      initialMetadata={editorMetadata(tab.metadata)}
      isCodeView={Boolean(codeViewByTabId[tab.id])}
      isEditLocked={Boolean(editLockedByPageId[tab.id])}
      onUpdate={((id, content, patch) => { handleEditorUpdate(id, typeof content === 'string' ? content : undefined, patch); }) satisfies PublicBlockEditorProps['onUpdate']}
      historyOpenSignal={tab.id === activeTabId ? historyOpenSignal : 0}
      allNotes={pages.map(editorNote)}
      allTables={registry.tables.map(editorTable)}
      registry={registry}
      idToTitle={globalIndex}
      aliasIndex={aliasIndex}
      onUpdatePageMetadata={updatePageMetadataLocal}
      onEditSchema={(table: unknown) => { handleEditSchema(record(table), tab.metadata); }}
      onCreateRecord={(tableId: string, templateId?: unknown) => handleAddNewNote(tableId, typeof templateId === 'string' ? templateId : null)}
      onCreateTemplate={(tableId: unknown) => { setPromptModal({ isOpen: true, defaultTitle: t('common.new_template'), parentId: null, isDatabase: false, isDrawing: false, isView: false, isTemplate: true, templateTableId: text(tableId) || null, inputValue: t('common.new_template'), isLoading: false }); }}
      onOpenViewConfig={handleConfigureView}
      pageActions={pageActions}
      isActivePage={tab.id === activeTabId}
    />);
  if (!dailyBar)
    return editorEl;
  return (<div className="h-full flex flex-col min-h-0">
    {dailyBar}
    <div className="flex-1 min-h-0 overflow-hidden">{editorEl}</div>
  </div>);
}
