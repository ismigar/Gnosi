import type { SchemaState } from './useSchemaState';
import type { ResolvedProps } from './props';
import { useTranslation } from 'react-i18next';
import { toast } from '../../../../shared/notifications/toast';
import { fetchTableOptionUsage, renameTableOption, removeTableOption, updateOptionCatalog } from '../../../../shared/api/vault-schema';
import { STATUS_CATALOG_REF, normalizeOptions } from '../../../../shared/records/model/optionCatalogUtils';
import { apiErrorDetail, readCounts } from './readers';
import type { OptionTools } from './types';
export function useOptionTools(state: SchemaState, props: ResolvedProps) {
    const { t } = useTranslation();
    const { sharedCatalogs, setSharedCatalogs } = state;
    const { tableId } = props;
    const optionTools: OptionTools = {
        sharedCatalogs,
        fetchUsage: tableId ? async (fieldId) => {
            const data = await fetchTableOptionUsage(tableId, fieldId);
            return readCounts(data.counts);
        } : null,
        renameEverywhere: tableId ? async (fieldId, oldVal, newVal) => {
            if (!fieldId) return;
            try {
                const data = await renameTableOption(tableId, fieldId, oldVal, newVal);
                const n = typeof data.files_changed === 'number' ? data.files_changed : 0;
                if (Array.isArray(data.options)) {
                    setSharedCatalogs((prev) => ({ ...prev, [STATUS_CATALOG_REF]: normalizeOptions(data.options) }));
                }
                if (n > 0) toast.success(t('schema.option_renamed', { count: n, defaultValue: "{{count}} records updated" }));
                return data;
            } catch (err) {
                toast.error(apiErrorDetail(err, t('schema.option_rename_error', "Could not rename the option in the records")));
            }
        } : null,
        removeEverywhere: tableId ? async (fieldId, value, reassignTo) => {
            if (!fieldId) return;
            try {
                const data = await removeTableOption(tableId, fieldId, value, reassignTo || undefined);
                const n = typeof data.files_changed === 'number' ? data.files_changed : 0;
                if (Array.isArray(data.options)) {
                    setSharedCatalogs((prev) => ({ ...prev, [STATUS_CATALOG_REF]: normalizeOptions(data.options) }));
                }
                if (n > 0) toast.success(t('schema.option_removed_rows', { count: n, defaultValue: "{{count}} records updated" }));
                return data;
            } catch (err) {
                toast.error(apiErrorDetail(err, t('schema.option_remove_error', "Could not remove the option from the records")));
            }
        } : null,
        updateSharedCatalog: async (name, options) => {
            try {
                const data = await updateOptionCatalog(name, options);
                setSharedCatalogs((prev) => ({ ...prev, [name]: data.options ? normalizeOptions(data.options) : options }));
            } catch (err) {
                toast.error(apiErrorDetail(err, t('schema.shared_catalog_save_error', "Could not save the shared catalog")));
            }
        },
    };

    return { optionTools };
}
