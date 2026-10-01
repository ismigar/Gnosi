import { TableSchemaDialog } from './TableSchemaDialog';
import { PageViewModal } from '../view-config/PageViewModal';
import { PageComments } from '../comments/PageComments';
import { ShareModal } from '../../sharing/dialogs/ShareModal';
import { stringValue } from './readers';
import type { DashboardController } from './useDashboardController';
import { viewTables } from './consumer-readers';
export function ConfigurationDialogs(dashboard: DashboardController) {
  const context = dashboard;
  const {
    activeTableId,
    commentsOpen,
    currentOpenPage,
    fetchRegistry,
    isPluginEnabled,
    isSchemaModalOpen,
    isViewConfigOpen,
    onViewConfigSavedRef,
    registry,
    setActiveViewId,
    setActiveTableId,
    setCommentsOpen,
    setIsViewConfigOpen,
    setShareOpen,
    setViewToConfigure,
    shareOpen,
    viewConfigTab,
    viewToConfigure,
  } = context;
  return <>
    {isSchemaModalOpen && activeTableId && <TableSchemaDialog key={activeTableId} dashboard={context} />}
    {isViewConfigOpen && viewToConfigure && (
      // The SAME modal as for the embed (PageViewModal), in mode
      // "table": configures/creates a table view with fewer
      // options (fixed source table when supplied, no heading, scope, or "save
      // to views"). `editingView` with id → updates; without
      // id (e.g. {type}) → creates a new view.
      <PageViewModal
        isOpen={isViewConfigOpen}
        mode="table"
        // Table mode never reads or persists a page ID; the empty sentinel
        // represents the same absent page as the legacy null value.
        pageId=""
        allTables={viewTables(registry.tables)}
        preselectedTableId={activeTableId || undefined}
        editingView={viewToConfigure}
        initialTab={viewConfigTab}
        onClose={(saved, savedView) => {
          setIsViewConfigOpen(false);
          setViewToConfigure(null);
          if (saved && savedView) {
            void fetchRegistry();
            if (!viewToConfigure.id && typeof savedView.table_id === 'string' && savedView.table_id) {
              setActiveTableId(savedView.table_id);
            }
            if (savedView.id)
              setActiveViewId(stringValue(savedView.id));
            if (onViewConfigSavedRef.current) {
              onViewConfigSavedRef.current(savedView);
            }
          }
          onViewConfigSavedRef.current = null;
        }}
      />)}
    <PageComments
      pageId={currentOpenPage?.id || ''}
      pageTitle={currentOpenPage?.title}
      open={isPluginEnabled('page-comments') && commentsOpen && Boolean(currentOpenPage)}
      onClose={() => { setCommentsOpen(false); }}
    />
    <ShareModal
      pageId={currentOpenPage?.id}
      pageTitle={currentOpenPage?.title}
      open={isPluginEnabled('share-links') && shareOpen && Boolean(currentOpenPage)}
      onClose={() => { setShareOpen(false); }}
    />

  </>;
}
