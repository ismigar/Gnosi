import { useRef } from 'react';
import { createVaultTable, type VaultRegistryRecord } from '../../../shared/api/vaults';
import { SchemaConfigModal } from '../schema/SchemaConfigModal';
import { MAIN_VIEW_NAME } from '../views/viewConstants';
import { buildTablePropertiesFromSchema, getSchemaFieldNames } from '../../../shared/records/model/schemaUtils';
import type { DashboardController } from './useDashboardController';

type Context = Pick<DashboardController, 'activeTableId' | 'activeViewId' | 'registry' | 'getTableViews' | 'getSchemaFromTableId' | 'setIsSchemaModalOpen' | 't' | 'setSchema' | 'handleUpdateView' | 'fetchRegistry'>;

export function TableSchemaDialog({ dashboard }: { dashboard: Context }) {
  const { activeTableId, activeViewId, registry, getTableViews, getSchemaFromTableId, setIsSchemaModalOpen, t, setSchema, handleUpdateView, fetchRegistry } = dashboard;
  // Queued autosaves can retain an earlier callback before the registry rerenders.
  // Use the revision acknowledged by the last write from this editor session.
  const savedTableRef = useRef<VaultRegistryRecord | null>(null);
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

      // 1. Update table schema (Backend registry).
      // `translation_enabled` is metadata of the table
      // (not of the view) because it defines what can be
      // translated, not how it's displayed.
      const savedTable = await createVaultTable({
        ...activeTable,
        schema_revision: savedTableRef.current?.schema_revision ?? activeTable?.schema_revision,
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
      savedTableRef.current = savedTable;
      setSchema(newSchemaObj);
      // 2. Update view configuration if it exists.
      // The user's REAL field selection is saved
      // also for the main view (previously it was
      // rewritten to the whole schema and the selection was
      // perdia en silenci).
      const originalVisible = cv.visibleProperties?.length
        ? cv.visibleProperties.filter((property): property is string => typeof property === 'string')
        : getSchemaFieldNames(currentSchemaObj);
      const viewChanged = Boolean(cv.enableSubitems) !== viewConfig.enableSubitems
        || JSON.stringify(originalVisible) !== JSON.stringify(viewConfig.visibleProperties);
      if (cv.id && viewChanged) {
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
    }}
  />);
}
