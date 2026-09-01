import type { SchemaState } from './useSchemaState';
import type { ResolvedProps } from './props';
import { useEffect, useEffectEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from '../../../../shared/notifications/toast';
import { fetchDrupalContentTypes, fetchDrupalFields, matchDrupalRows } from '../../../../shared/api/vault-schema';
import { apiErrorDetail, readCounts, readString } from './readers';
export function useDrupalCatalogs(state: SchemaState, props: ResolvedProps) {
    const { t } = useTranslation();
    const {
        enableDrupalSync, drupalBundle, drupalContentTypes, setDrupalContentTypes, setDrupalFields,
        setDrupalLoading, setDrupalError, setMatching,
    } = state;
    const { isOpen, tableId } = props;
    const handleMatchExisting = async () => {
        if (!tableId || !drupalBundle) return;
        setMatching(true);
        try {
            const data = await matchDrupalRows(tableId);
            const c = readCounts(data.counts);
            toast.success(t('schema.drupal_match_done', { matched: c.matched || 0, unmatched: c.unmatched || 0, defaultValue: "{{matched}} linked · {{unmatched}} unmatched." }));
        } catch (err) {
            toast.error(apiErrorDetail(err, t('schema.drupal_match_error', "Error linking with Drupal.")));
        } finally {
            setMatching(false);
        }
    };

    // Discovers Drupal content types when enabling synchronization.
    const discoverContentTypes = useEffectEvent(() => {
        if (!isOpen || !enableDrupalSync || drupalContentTypes.length > 0) return;
        let cancelled = false;
        setDrupalLoading(true);
        setDrupalError('');
        fetchDrupalContentTypes()
            .then((data) => { if (!cancelled) setDrupalContentTypes(data.content_types.map((item) => ({ ...item, machine: readString(item.machine), label: readString(item.label) }))); })
            .catch((err: unknown) => { if (!cancelled) setDrupalError(apiErrorDetail(err, t('schema.drupal_load_error', "Could not connect to Drupal."))); })
            .finally(() => { if (!cancelled) setDrupalLoading(false); });
        return () => { cancelled = true; };

    });
    useEffect(() => discoverContentTypes(), [isOpen, enableDrupalSync]);

    // Discovers the fields of the chosen content type.
    const discoverFields = useEffectEvent(() => {
        if (!isOpen || !enableDrupalSync || !drupalBundle) { setDrupalFields([]); return; }
        let cancelled = false;
        setDrupalLoading(true);
        setDrupalError('');
        fetchDrupalFields(drupalBundle)
            .then((data) => { if (!cancelled) setDrupalFields(data.fields.map((item) => ({ ...item, field_name: readString(item.field_name), label: readString(item.label), field_type: readString(item.field_type) }))); })
            .catch((err: unknown) => { if (!cancelled) setDrupalError(apiErrorDetail(err, t('schema.drupal_fields_error', "Could not load the fields."))); })
            .finally(() => { if (!cancelled) setDrupalLoading(false); });
        return () => { cancelled = true; };

    });
    useEffect(() => discoverFields(), [isOpen, enableDrupalSync, drupalBundle]);

    return { handleMatchExisting };
}
