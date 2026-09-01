import type { SchemaConfigModalProps } from './types';
export function resolveProps({ isOpen, onClose, folder, tableName = '', currentSchema, onSchemaUpdated, onSave, initialEnableSubitems = false, initialVisibleProperties = null, initialEnableTranslation = false, initialEnableDrupalSync = false, initialDrupalBundle = '', initialDrupalFieldMapping = null, initialFunctionalities = null, tableId = null, availableTables = null }: SchemaConfigModalProps) {
    return {
        isOpen, onClose, folder, tableName, currentSchema, onSchemaUpdated, onSave,
        initialEnableSubitems, initialVisibleProperties, initialEnableTranslation,
        initialEnableDrupalSync, initialDrupalBundle, initialDrupalFieldMapping, initialFunctionalities,
        tableId, availableTables,
    };
}
export type ResolvedProps = ReturnType<typeof resolveProps>;
