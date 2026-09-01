import type { SchemaState } from './useSchemaState';
import type { ResolvedProps } from './props';
import { useEffect, useEffectEvent } from 'react';
import { hydrateFields } from './hydrate-fields';
import { normalizeTableFunctionalities } from '../../properties/tableFunctionalityUtils';
import { readActionConfig, readCatalogs, readString } from './readers';
import { fetchVaultTables } from '../../../../shared/api/vaults';
import { fetchOptionCatalogs, fetchVirtualFields } from '../../../../shared/api/vault-schema';
export function useSchemaInitialization(state: SchemaState, props: ResolvedProps) {
    const {
        setFields, setFunctionalities, setIsInitializedForSave, setAllTables, setVirtualComputers,
        setEnableSubitems, setEnableTranslation, setSharedCatalogs, setEnableDrupalSync,
        setDrupalBundle, setDrupalFieldMapping, setEnableSocialPublish, initializedRef,
    } = state;
    const {
        isOpen, currentSchema, initialEnableSubitems, initialVisibleProperties,
        initialEnableTranslation, initialEnableDrupalSync, initialDrupalBundle,
        initialDrupalFieldMapping, initialFunctionalities, availableTables,
    } = props;
    const initialize = useEffectEvent(() => {
        if (!isOpen) {
            initializedRef.current = false;
            setIsInitializedForSave(false);
            return;
        }
        if (initializedRef.current) return;
        initializedRef.current = true;
        {
            // Transform object to array for editing.
            const fieldsArray = hydrateFields(currentSchema, initialVisibleProperties);
            setFields(fieldsArray.filter((field) => field.type !== 'button'));
            setFunctionalities(normalizeTableFunctionalities(initialFunctionalities, currentSchema).map((item) => ({ ...item, config: readActionConfig(item.config) })));
            setEnableSubitems(initialEnableSubitems);
            setEnableTranslation(initialEnableTranslation);
            setEnableDrupalSync(initialEnableDrupalSync);
            setDrupalBundle(initialDrupalBundle || '');
            setDrupalFieldMapping(initialDrupalFieldMapping || {});
            setEnableSocialPublish(fieldsArray.some((f) => f.system && /xxss|social/i.test(f.name || '')));
            // The autosave effect runs after this initialization effect on the
            // opening commit. Keep it blocked until React applies this complete
            // state batch; otherwise it can briefly persist `fields=[]` and
            // remove the table schema before hydration finishes.
            setIsInitializedForSave(true);

            // Candidate tables for relation fields. If the parent passes a list of them
            // (e.g. Notion Import: the Notion workspace's DBs, not the vault's
            // local one), it takes precedence; otherwise, the active vault's tables are loaded.
            if (Array.isArray(availableTables)) {
                setAllTables(availableTables);
            } else {
                const fetchTables = async () => {
                    try {
                        const tables = await fetchVaultTables();
                        setAllTables(tables.map((table) => ({ ...table, id: readString(table.id), name: readString(table.name), title: readString(table.title) })));
                    } catch (err) {
                        console.error('Error loading tables for the modal:', err);
                    }
                };
                void fetchTables();
            }

            // Shared option catalogs (root registry `option_catalogs`).
            const fetchSharedCatalogs = async () => {
                try {
                    const data = await fetchOptionCatalogs();
                    setSharedCatalogs(readCatalogs(data.catalogs));
                } catch (err) {
                    console.error('Error loading shared catalogs:', err);
                }
            };
            void fetchSharedCatalogs();

            // Load virtual computers catalogue for "type: virtual" properties
            const fetchVirtualComputers = async () => {
                try {
                    const data = await fetchVirtualFields();
                    setVirtualComputers(data.computers.map((computer) => ({ ...computer, compute: readString(computer.compute), label: readString(computer.label), description: readString(computer.description) })));
                } catch (err) {
                    console.error('Error loading virtual computers catalog:', err);
                }
            };
            void fetchVirtualComputers();
        }
    });
    useEffect(() => { initialize(); }, [isOpen, currentSchema, initialEnableSubitems, initialVisibleProperties, initialEnableTranslation, initialEnableDrupalSync, initialDrupalBundle, initialDrupalFieldMapping, initialFunctionalities, availableTables]);
}
