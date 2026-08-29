import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { logError } from '../../lib/notifyError';
import { usePlugins } from '../../plugins/usePlugins';
import { fetchVaultTables } from '../../shared/api/vaults';
import { sortFieldItems } from '../../utils/fieldOrdering';
import {
    normalizeVaultTables,
    SELECT_STYLE,
    settingsRecord,
    stringArraySetting,
    stringSetting,
    type VaultTable,
} from './pluginSettingsModel';

const PROMPTABLE_TYPES = new Set([
    'text', 'rich_text', 'number', 'select', 'multi_select',
    'status', 'date', 'datetime', 'checkbox', 'url',
]);
const NO_MAPPING = '__none__';

export function WebClipperConfig() {
    const { t, i18n } = useTranslation();
    const { getPluginSettings, setPluginSettings } = usePlugins();
    const config = settingsRecord(getPluginSettings('web-clipper'));
    const [tables, setTables] = useState<readonly VaultTable[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let alive = true;
        void fetchVaultTables()
            .then((records) => {
                if (alive) setTables(normalizeVaultTables(records));
            })
            .catch((error: unknown) => {
                logError('web-clipper.load-tables', error);
                if (alive) setTables([]);
            })
            .finally(() => {
                if (alive) setLoading(false);
            });
        return () => {
            alive = false;
        };
    }, []);

    const tableId = stringSetting(config, 'table_id');
    const table = tables.find((candidate) => candidate.id === tableId) ?? null;
    const selectedFields = stringArraySetting(config, 'fields');
    const sortedTables = sortFieldItems(tables, (candidate) => candidate.name, i18n.language);
    const properties = sortFieldItems(
        table?.properties.filter((property) => PROMPTABLE_TYPES.has(property.type)),
        (property) => property.name,
        i18n.language,
    );

    const update = (patch: Readonly<Record<string, unknown>>): void => {
        void setPluginSettings('web-clipper', patch);
    };

    const roleSelect = (
        key: string,
        label: string,
        types: readonly string[],
        unmappedLabel?: string,
    ) => (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ color: 'var(--text-secondary, #475569)', fontSize: 12, fontWeight: 600 }}>{label}</span>
            <select
                style={SELECT_STYLE}
                value={stringSetting(config, key)}
                onChange={(event) => {
                    update({ [key]: event.target.value });
                }}
            >
                <option value="">{t('settings.plugins.clipper_auto', 'Automatic')}</option>
                <option value={NO_MAPPING}>
                    {unmappedLabel ?? t('settings.plugins.clipper_unmapped', 'No column')}
                </option>
                {sortFieldItems(
                    table?.properties.filter((property) => types.includes(property.type)),
                    (property) => property.name,
                    i18n.language,
                ).map((property) => (
                    <option key={property.id} value={property.id}>{property.name || property.id}</option>
                ))}
            </select>
        </label>
    );

    return (
        <div style={{
            background: 'var(--bg-primary, #fff)', border: '1px dashed var(--border-primary, #e2e8f0)',
            borderRadius: 10, display: 'flex', flexDirection: 'column', gap: 12,
            marginTop: 8, padding: '12px 14px',
        }}>
            <div style={{ color: 'var(--text-tertiary, #94a3b8)', fontSize: 12 }}>
                {t('settings.plugins.clipper_intro', 'Choose which table the browser extension saves into. The fields you tick show up in the extension form so you can fill them before saving.')}
            </div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ color: 'var(--text-secondary, #475569)', fontSize: 12, fontWeight: 600 }}>
                    {t('settings.plugins.clipper_table', 'Destination table')}
                </span>
                <select
                    style={SELECT_STYLE}
                    value={tableId}
                    disabled={loading}
                    onChange={(event) => {
                        update({
                            content_property: '', fields: [], table_id: event.target.value,
                            tags_property: '', url_property: '',
                        });
                    }}
                >
                    <option value="">{t('settings.plugins.clipper_table_none', 'None (note in the Clips/ folder)')}</option>
                    {sortedTables.map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>{candidate.name || candidate.id}</option>
                    ))}
                </select>
            </label>
            {table && (
                <>
                    {roleSelect('url_property', t('settings.plugins.clipper_url_column', 'URL column'), ['url', 'text'])}
                    {roleSelect('tags_property', t('settings.plugins.clipper_tags_column', 'Tags column'), ['multi_select'], t('settings.plugins.clipper_tags_frontmatter', 'No column (tags in the frontmatter)'))}
                    {roleSelect('content_property', t('settings.plugins.clipper_content_column', 'Note column'), ['text', 'rich_text'], t('settings.plugins.clipper_content_body', 'Page body'))}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <span style={{ color: 'var(--text-secondary, #475569)', fontSize: 12, fontWeight: 600 }}>
                            {t('settings.plugins.clipper_fields', 'Fields the extension asks for')}
                        </span>
                        {properties.length === 0 ? (
                            <span style={{ color: 'var(--text-tertiary, #94a3b8)', fontSize: 12 }}>
                                {t('settings.plugins.clipper_no_fields', 'This table has no columns that can be filled from the browser.')}
                            </span>
                        ) : (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                {properties.map((property) => {
                                    const checked = selectedFields.includes(property.id);
                                    return (
                                        <label key={property.id} style={{
                                            alignItems: 'center', background: checked ? '#eef2ff' : 'var(--bg-secondary, #f8fafc)',
                                            border: '1px solid var(--border-primary, #e2e8f0)', borderRadius: 999,
                                            color: checked ? '#4338ca' : 'var(--text-secondary, #475569)', cursor: 'pointer',
                                            display: 'flex', fontSize: 12, gap: 6, padding: '5px 9px',
                                        }}>
                                            <input
                                                type="checkbox"
                                                checked={checked}
                                                onChange={() => {
                                                    update({ fields: checked
                                                        ? selectedFields.filter((id) => id !== property.id)
                                                        : [...selectedFields, property.id] });
                                                }}
                                                style={{ margin: 0 }}
                                            />
                                            {property.name || property.id}
                                        </label>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
