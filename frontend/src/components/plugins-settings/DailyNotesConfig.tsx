import { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { usePlugins } from '../../plugins/usePlugins';
import { fetchVaultTables } from '../../shared/api/vaults';
import { sortFieldItems } from '../../utils/fieldOrdering';
import {
    normalizeVaultTables,
    SELECT_STYLE,
    settingsRecord,
    stringSetting,
    type VaultTable,
} from './pluginSettingsModel';

export function DailyNotesConfig() {
    const { t } = useTranslation();
    const { getPluginSettings, setPluginSettings } = usePlugins();
    const config = settingsRecord(getPluginSettings('daily-notes'));
    const [tables, setTables] = useState<readonly VaultTable[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let alive = true;
        void fetchVaultTables()
            .then((records) => {
                if (alive) setTables(normalizeVaultTables(records));
            })
            .catch(() => {
                if (alive) setTables([]);
            })
            .finally(() => {
                if (alive) setLoading(false);
            });
        return () => {
            alive = false;
        };
    }, []);

    const tableId = stringSetting(config, 'source_table_id');
    const dateProperty = stringSetting(config, 'date_property');
    const sortedTables = sortFieldItems(tables, (table) => table.name || table.id);
    const selectedTable = tables.find((table) => table.id === tableId) ?? null;
    const dateProperties = sortFieldItems(
        selectedTable?.properties.filter((property) => property.type === 'date'),
    );

    const pickTable = (nextTableId: string): void => {
        if (!nextTableId) {
            void setPluginSettings('daily-notes', {
                date_property: '',
                source_table_id: '',
            });
            return;
        }
        const table = tables.find((candidate) => candidate.id === nextTableId);
        const firstDate = sortFieldItems(
            table?.properties.filter((property) => property.type === 'date'),
        ).at(0);
        void setPluginSettings('daily-notes', {
            date_property: firstDate?.id ?? '',
            source_table_id: nextTableId,
        });
    };

    return (
        <div style={{
            background: 'var(--bg-primary, #fff)',
            border: '1px dashed var(--border-primary, #e2e8f0)',
            borderRadius: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            marginTop: 8,
            padding: '12px 14px',
        }}>
            <div style={{ color: 'var(--text-tertiary, #94a3b8)', fontSize: 12 }}>
                <Trans i18nKey="settings.plugins.daily_intro" components={{ code: <code /> }} />
            </div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ color: 'var(--text-secondary, #475569)', fontSize: 12, fontWeight: 600 }}>
                    {t('settings.plugins.source_db')}
                </span>
                <select
                    style={SELECT_STYLE}
                    value={tableId}
                    disabled={loading}
                    onChange={(event) => {
                        pickTable(event.target.value);
                    }}
                >
                    <option value="">{t('settings.plugins.source_none')}</option>
                    {sortedTables.map((table) => (
                        <option key={table.id} value={table.id}>{table.name || table.id}</option>
                    ))}
                </select>
            </label>
            {selectedTable && (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ color: 'var(--text-secondary, #475569)', fontSize: 12, fontWeight: 600 }}>
                        {t('settings.plugins.date_column')}
                    </span>
                    {dateProperties.length === 0 ? (
                        <span style={{ color: '#dc2626', fontSize: 12 }}>
                            {t('settings.plugins.no_date_column')}
                        </span>
                    ) : (
                        <select
                            style={SELECT_STYLE}
                            value={dateProperty || dateProperties.at(0)?.id || ''}
                            onChange={(event) => {
                                void setPluginSettings('daily-notes', {
                                    date_property: event.target.value,
                                });
                            }}
                        >
                            {dateProperties.map((property) => (
                                <option key={property.id} value={property.id}>
                                    {property.name || property.id}
                                </option>
                            ))}
                        </select>
                    )}
                </label>
            )}
        </div>
    );
}
