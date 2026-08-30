import React from 'react';
import { Suspense, lazy } from 'react';
import { FileText } from 'lucide-react';
import { VaultDocumentTabs } from '../../components/Vault/VaultDocumentTabs';
import VaultDrawings from '../../components/Vault/VaultDrawings';
import { VaultTrashView } from '../../components/Vault/VaultTrashView';
import { VaultTagsView } from '../../components/Vault/VaultTagsView';
import { reorderTabs } from './tab-model';
import { TablePane } from './TablePane';
import { EditorPane } from './EditorPane';
import type { DashboardController } from './useDashboardController';
const TldrawEditor = lazy(() => import('../../components/Vault/TldrawEditor'));
export function DashboardContent(dashboard: DashboardController) {
  const context = dashboard;
  const {
    activeTabId,
    activeTableId,
    fetchPages,
    fetchPagesByTable,
    handleDividerMouseDown,
    handleOpenCreatePrompt,
    handleOpenParallel,
    handleOpenTableAsTab,
    handleOpenTableParallel,
    handleTabClose,
    handleTabSelect,
    handleToggleSplit,
    loadPage,
    openPaneEntries,
    pages,
    paneContainerRef,
    paneSizes,
    quickOpenItems,
    registry,
    setActiveTabId,
    setTabs,
    setViewMode,
    splitTabIds,
    t,
    tabs,
    viewMode,
  } = context;
  return (<div className="h-full bg-[var(--bg-primary)] flex flex-col min-w-0">
    {(viewMode === 'editor' || viewMode === 'drawing') && (<VaultDocumentTabs
      tabs={tabs}
      activeTabId={activeTabId}
      splitTabIds={splitTabIds}
      onTabSelect={handleTabSelect}
      onTabClose={handleTabClose}
      onToggleSplit={handleToggleSplit}
      quickOpenItems={quickOpenItems}
      onQuickOpenItem={(item) => {
        if (item.type === 'table') {
          void handleOpenTableAsTab(item.id);
          return;
        }
        void loadPage(item.id);
      }}
      onQuickOpenParallel={(item) => {
        if (item.type === 'table') {
          handleOpenTableParallel(item.id);
          return;
        }
        if (item.type === 'page') {
          void handleOpenParallel(item.id);
        }
      }}
      onReorderTabs={(reordered) => { setTabs(reorderTabs(tabs, reordered)); }}
    />)}

    <div
      className="flex-1 flex overflow-hidden min-w-0"
      ref={paneContainerRef}
    >
      {viewMode === 'editor' && activeTabId ? (<>
        {openPaneEntries.map((pane, index) => (<React.Fragment key={`${pane.type}-${pane.id}-${index === 0 ? 'primary' : 'split'}`}>
          <div
            className={`flex flex-col overflow-hidden min-w-0 ${index > 0 ? 'bg-[var(--bg-primary)]' : ''}`}
            style={{ width: paneSizes[index] != null ? `${String(paneSizes[index])}%` : `${String(100 / openPaneEntries.length)}%`, flexShrink: 0 }}
          >
            <div className="flex-1 overflow-y-auto w-full min-w-0 h-full">
              {pane.type === 'table' && tabs.find(tab => tab.id === pane.id)?.isTable
                ? <EditorPane
                  dashboard={dashboard}
                  tabId={pane.id}
                />
                : pane.type === 'table'
                  ? <TablePane
                    dashboard={dashboard}
                    tableId={pane.id}
                    mode="split"
                  />
                  : <EditorPane
                    dashboard={dashboard}
                    tabId={pane.id}
                  />}
            </div>
          </div>
          {index < openPaneEntries.length - 1 && (<div
            className="w-1 shrink-0 bg-[var(--border-primary)] hover:bg-indigo-300 cursor-col-resize transition-colors active:bg-indigo-400 z-10 select-none"
            onMouseDown={(e) => { handleDividerMouseDown(index, e); }}
            title={t('common.drag_resize')}
          />)}
        </React.Fragment>))}
      </>) : viewMode === 'drawing' ? (<div className="flex-1 flex flex-col overflow-hidden min-w-0 bg-[var(--bg-primary)]">
        {activeTabId ? (<Suspense fallback={<div className="flex-1 flex items-center justify-center text-sm text-[var(--text-secondary)] animate-pulse">{t('editor.loading_drawing_editor')}</div>}>
          <TldrawEditor
            key={activeTabId}
            drawingId={activeTabId}
            allNotes={pages}
            tables={registry.tables}
            title={tabs.find(t => t.id === activeTabId)?.title}
            onClose={() => {
              handleTabClose(activeTabId);
              setViewMode('editor');
            }}
            onSaveSuccess={() => { }}
            onOpenPage={(pageId) => { setViewMode('editor'); void loadPage(pageId); }}
          />
        </Suspense>) : (<VaultDrawings onDrawingSelect={(id, title) => {
          if (!tabs.find(t => t.id === id)) {
            setTabs(prev => [...prev, { id, title: title, isDrawing: true }]);
          }
          setActiveTabId(id);
        }} />)}
      </div>) : viewMode === 'trash' ? (<div className="flex-1 flex flex-col overflow-hidden min-w-0 bg-[var(--bg-primary)]">
        <VaultTrashView onAfterChange={() => {
          if (activeTableId)
            void fetchPagesByTable(activeTableId);
          else
            void fetchPages();
        }} />
      </div>) : viewMode === 'tags' ? (<VaultTagsView onPageSelect={(...args: Parameters<typeof loadPage>) => { void loadPage(...args); }} />) : viewMode === 'table' && activeTableId ? (<TablePane
        dashboard={dashboard}
        tableId={activeTableId}
        mode="inline"
      />) : (<div className="flex flex-col items-center justify-center w-full h-[80vh] text-[var(--text-tertiary)] px-4">
        <FileText
          size={64}
          className="mb-4 text-[var(--bg-tertiary)]"
          strokeWidth={1}
        />
        <h2 className="text-xl font-medium text-[var(--text-secondary)]">{t('vault_welcome_title', "Welcome")}</h2>
        <p className="mt-2 max-w-md text-center">{t('vault_welcome_subtitle', "Select a knowledge page or")}</p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button
            onClick={() => { handleOpenCreatePrompt(null, false); }}
            className="btn btn-gnosi-primary"
          >
            {t('vault_welcome_create_page', "Create a page")}
          </button>
          <button
            onClick={() => { handleOpenCreatePrompt(null, true); }}
            className="btn btn-gnosi-primary"
          >
            {t('vault_welcome_create_db', "Create a DB")}
          </button>
        </div>
      </div>)}
    </div>
  </div>);
}
