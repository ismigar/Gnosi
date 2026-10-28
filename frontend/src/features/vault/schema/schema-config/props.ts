import type { SchemaConfigModalProps } from './types';
export function resolveProps({ isOpen, onClose, folder, tableName = '', currentSchema, onSchemaUpdated, onSave, initialEnableSubitems = false, initialVisibleProperties = null, initialEnableTranslation = false, initialFunctionalities = null, tableId = null, availableTables = null }: SchemaConfigModalProps) {
    return {
        isOpen, onClose, folder, tableName, currentSchema, onSchemaUpdated, onSave,
        initialEnableSubitems, initialVisibleProperties, initialEnableTranslation,
        initialFunctionalities,
        tableId, availableTables,
    };
}
export type ResolvedProps = ReturnType<typeof resolveProps>;
