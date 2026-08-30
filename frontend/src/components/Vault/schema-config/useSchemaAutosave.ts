import { useEffect, useEffectEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from '../../../lib/toast';
import { saveVaultFolderSchema } from '../../../shared/api/vault-schema';
import { buildPayload } from './schema-payload';
import type { SchemaState } from './useSchemaState';
import type { ResolvedProps } from './props';
export function useSchemaAutosave(state: SchemaState, props: ResolvedProps, validationError: string | null) {
    const { t } = useTranslation();
    const { isOpen, onSave, onSchemaUpdated, folder } = props;
    const {
        initializedRef, isInitializedForSave, pendingSaveRef, fields, functionalities, enableSubitems,
        enableTranslation, enableDrupalSync, drupalBundle, drupalFieldMapping,
    } = state;
    const scheduleSave = useEffectEvent(() => {
        if (!isOpen) return;
        if (!initializedRef.current) return; // first render: no autosave
        if (!isInitializedForSave) return;
        if (validationError) {
            // Invalid state: nothing is sent (the banner above tells the user why).
            // We also drop any pending save: it belongs to an earlier render and
            // flushing it on unmount would silently persist an outdated payload.
            pendingSaveRef.current = null;
            return;
        }
        // Saves the current state. We save it in a ref so we can trigger it
        // also on unmount (flush) if the debounce hasn't fired yet.
        const doSave = async () => {
            pendingSaveRef.current = null;
            try {
                const { newSchemaObj, visibleProperties } = buildPayload(fields, enableTranslation);
                if (onSave) {
                    await onSave(newSchemaObj, { enableSubitems, visibleProperties, enableTranslation, enableDrupalSync, drupalBundle, drupalFieldMapping, functionalities });
                } else {
                    await saveVaultFolderSchema(folder, newSchemaObj);
                }
                void onSchemaUpdated?.(newSchemaObj);
            } catch (err) {
                console.error(err);
                toast.error(t('schema.error_saving'));
            }
        };
        pendingSaveRef.current = doSave;
        const handle = setTimeout(() => { void doSave(); }, 600);
        return () => { clearTimeout(handle); };

    });
    useEffect(() => scheduleSave(), [isOpen, isInitializedForSave, fields, functionalities, enableSubitems, enableTranslation, enableDrupalSync, drupalBundle, drupalFieldMapping]);

    // Flush the pending save on unmounting the modal (e.g. closing with Esc or the X
    // right after editing, before the debounce's 600ms). Fire-and-forget:
    // the POST completes even if the component is no longer there. Without this,
    // the autosave effect's `clearTimeout` would cancel the last change.
    const registerSaveFlush = useEffectEvent(() => {
        return () => { void pendingSaveRef.current?.(); };
    });
    useEffect(() => registerSaveFlush(), []);
}
