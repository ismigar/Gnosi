import { Suspense, lazy } from 'react';
import { DocumentPanes } from './DocumentPanes';
import { VaultDocumentTabs } from '../navigation/VaultDocumentTabs';
import { reorderTabs } from './tab-model';
import { DashboardWelcome } from './DashboardWelcome';
import type { DashboardController } from './useDashboardController';

const VaultDrawings = lazy(() => import('../drawings/VaultDrawings'));
const VaultTrashView = lazy(() => import('../navigation/VaultTrashView').then(module => ({ default: module.VaultTrashView })));
const VaultTagsView = lazy(() => import('../navigation/VaultTagsView').then(module => ({ default: module.VaultTagsView })));
const TablePane = lazy(() => import('./TablePane').then(module => ({ default: module.TablePane })));
const TldrawEditor = lazy(() => import('../drawings/TldrawEditor'));

function ContentFallback({ label }: { readonly label: string }) {
  return <div className="flex-1 flex items-center justify-center text-sm text-[var(--text-secondary)] animate-pulse">{label}</div>;
}
export function DashboardContent(dashboard: DashboardController) {
  const context = dashboard;
  const {
    activeTabId,
    activeTableId,
    fetchPages,
    fetchPagesByTable,
    handleOpenCreateDatabaseGroup,
    handleOpenCreatePrompt,
    handleOpenParallel,
    handleOpenTableAsTab,
    handleOpenTableParallel,
    handleTabClose,
    handleTabSelect,
    handleToggleSplit,
    loadPage,
    pages,
    paneContainerRef,
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
      <DocumentPanes dashboard={dashboard} />
      {viewMode === 'editor' && activeTabId ? null : viewMode === 'drawing' ? (<div className="flex-1 flex flex-col overflow-hidden min-w-0 bg-[var(--bg-primary)]">
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
        </Suspense>) : (<Suspense fallback={<ContentFallback label={t('common.loading')} />}><VaultDrawings onDrawingSelect={(id, title) => {
          if (!tabs.find(t => t.id === id)) {
            setTabs(prev => [...prev, { id, title: title, isDrawing: true }]);
          }
          setActiveTabId(id);
        }} /></Suspense>)}
      </div>) : viewMode === 'trash' ? (<div className="flex-1 flex flex-col overflow-hidden min-w-0 bg-[var(--bg-primary)]">
        <Suspense fallback={<ContentFallback label={t('common.loading')} />}><VaultTrashView onAfterChange={() => {
          if (activeTableId)
            void fetchPagesByTable(activeTableId);
          else
            void fetchPages();
        }} /></Suspense>
      </div>) : viewMode === 'tags' ? (<Suspense fallback={<ContentFallback label={t('common.loading')} />}><VaultTagsView onPageSelect={(...args: Parameters<typeof loadPage>) => { void loadPage(...args); }} /></Suspense>) : viewMode === 'table' && activeTableId ? (<Suspense fallback={<ContentFallback label={t('common.loading')} />}><TablePane
        dashboard={dashboard}
        tableId={activeTableId}
        mode="inline"
      /></Suspense>) : <DashboardWelcome
        t={t}
        onCreatePage={() => { handleOpenCreatePrompt(null, false); }}
        onCreateDatabase={handleOpenCreateDatabaseGroup}
      />}
    </div>
  </div>);
}
