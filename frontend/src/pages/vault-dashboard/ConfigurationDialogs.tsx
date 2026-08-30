import { createVaultTable } from '../../shared/api/vaults';
import { toast } from '../../lib/toast';
import { SchemaConfigModal } from '../../components/Vault/SchemaConfigModal';
import { PageViewModal } from '../../components/Vault/PageViewModal';
import { PageComments } from '../../components/Vault/PageComments';
import { ShareModal } from '../../components/Vault/ShareModal';
import { MAIN_VIEW_NAME } from '../../components/Vault/viewConstants';
import { buildTablePropertiesFromSchema } from '../../components/Vault/schemaUtils';
import { getSchemaFieldNames } from '../../components/Vault/schemaUtils';
import { stringValue } from './readers';
import type { DashboardController } from './useDashboardController';
import { viewTables } from './consumer-readers';
export function ConfigurationDialogs(dashboard: DashboardController) {
  const context = dashboard;
  const {
    activeTableId,
    activeViewId,
    commentsOpen,
    currentOpenPage,
    fetchRegistry,
    getSchemaFromTableId,
    getTableViews,
    handleUpdateView,
    isPluginEnabled,
    isSchemaModalOpen,
    isViewConfigOpen,
    onViewConfigSavedRef,
    registry,
    setActiveViewId,
    setCommentsOpen,
    setIsSchemaModalOpen,
    setIsViewConfigOpen,
    setSchema,
    setShareOpen,
    setViewToConfigure,
    shareOpen,
    t,
    viewConfigTab,
    viewToConfigure,
  } = context;
  return <>
    {isSchemaModalOpen && activeTableId && (() => {
      const activeTable = registry.tables.find(t => t.id === activeTableId);
      const cv = getTableViews(activeTableId).find(v => v.id === activeViewId) || { id: 'default', table_id: activeTableId, name: activeTable?.name || MAIN_VIEW_NAME, type: 'table', is_main: true };
      const currentSchemaObj = getSchemaFromTableId(activeTableId);
      return (<SchemaConfigModal
        isOpen={true}
        onClose={() => { setIsSchemaModalOpen(false); }}
        folder={activeTable?.name || t('common.table')}
        currentSchema={currentSchemaObj}
        initialEnableSubitems={cv.enableSubitems}
        initialEnableTranslation={!!activeTable?.translation_enabled}
        initialVisibleProperties={cv.visibleProperties?.length ? cv.visibleProperties.filter((property): property is string => typeof property === 'string') : getSchemaFieldNames(currentSchemaObj)}
        initialEnableDrupalSync={!!activeTable?.drupal_sync_enabled}
        initialDrupalBundle={activeTable?.drupal_bundle || ''}
        initialDrupalFieldMapping={activeTable?.drupal_field_mapping || {}}
        initialFunctionalities={activeTable?.functionalities || []}
        tableId={activeTableId}
        onSchemaUpdated={(newSchema) => { setSchema(newSchema); }}
        onSave={async (newSchemaObj, viewConfig) => {
          const newProperties = buildTablePropertiesFromSchema(newSchemaObj);
          try {
            // 1. Update table schema (Backend registry).
            // `translation_enabled` is metadata of the table
            // (not of the view) because it defines what can be
            // translated, not how it's displayed.
            await createVaultTable({
              ...activeTable,
              properties: newProperties,
              translation_enabled: viewConfig.enableTranslation,
              drupal_sync_enabled: viewConfig.enableDrupalSync,
              // We keep bundle and mapping even though the
              // sync is disabled: disabling
              // must not destroy the mapping (it's recovered if
              // re-enabled). Previously '' / {} used to be sent, and an autosave
              // with the toggle off would erase the entire mapping.
              drupal_bundle: viewConfig.drupalBundle || '',
              drupal_field_mapping: viewConfig.drupalFieldMapping,
              functionalities: viewConfig.functionalities,
            });
            setSchema(newSchemaObj);
            // 2. Update view configuration if it exists.
            // The user's REAL field selection is saved
            // also for the main view (previously it was
            // rewritten to the whole schema and the selection was
            // perdia en silenci).
            if (cv.id) {
              await handleUpdateView({
                ...cv,
                enableSubitems: viewConfig.enableSubitems,
                visibleProperties: viewConfig.visibleProperties
              });
            }
            await fetchRegistry();
            // We don't close the modal or show a toast: the modal
            // does continuous autosave — closing it on every save
            // would kick it out on the user's first change.
          }
          catch (err) {
            console.error("Error saving structure:", err);
            toast.error(t('errors.save_config'));
          }
        }}
      />);
    })()}
    {isViewConfigOpen && viewToConfigure && (
      // The SAME modal as for the embed (PageViewModal), in mode
      // "table": configures/creates a table view with fewer
      // options (no source table, heading, scope, or "save
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
