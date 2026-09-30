import { useTranslation } from 'react-i18next';

import type { PluginLlmWikiSettingsResponse } from '../../../shared/api/plugins';
import { sortFieldItems } from '../../../shared/schema/fieldOrdering';
import type { LlmWikiDraft, LlmWikiSource } from './llmWikiModel';
import { LlmWikiFieldAssignments } from './LlmWikiFieldAssignments';
import { SELECT_STYLE, type VaultTable } from './pluginSettingsModel';

interface LlmWikiSourceCardProps {
    readonly brainTable: VaultTable;
    readonly draft: LlmWikiDraft;
    readonly serverState: PluginLlmWikiSettingsResponse | null;
    readonly setDraft: (updater: (current: LlmWikiDraft) => LlmWikiDraft) => void;
    readonly source: LlmWikiSource;
    readonly sourceTable: VaultTable | undefined;
}

export function LlmWikiSourceCard({
    brainTable,
    draft,
    serverState,
    setDraft,
    source,
    sourceTable,
}: LlmWikiSourceCardProps) {
    const { t } = useTranslation();
    const tp = (key: string, fallback: string): string => t(`settings.plugins.${key}`, { defaultValue: fallback });
    const properties = sortFieldItems(sourceTable?.properties ?? []);
    // Keep existing selections visible so invalid legacy choices can be removed.
    const fileProperties = properties.filter((property) => ['files', 'file', 'attachment', 'attachments'].includes(property.type)
        || source.attachment_property_ids.includes(property.id));
    const urlProperties = properties.filter((property) => property.type === 'url'
        || (['text', 'rich_text'].includes(property.type) && /url|enllaç|link/i.test(property.name))
        || source.url_property_ids.includes(property.id));

    const updateSource = (updater: (item: LlmWikiSource) => LlmWikiSource): void => {
        setDraft((current) => ({
            ...current,
            source_tables: current.source_tables.map((item) => (
                item.table_id === source.table_id ? updater(item) : item
            )),
        }));
    };

    const toggleProperty = (
        key: 'attachment_property_ids' | 'url_property_ids',
        propertyId: string,
    ): void => {
        updateSource((item) => {
            const current = item[key];
            return {
                ...item,
                [key]: current.includes(propertyId)
                    ? current.filter((id) => id !== propertyId)
                    : [...current, propertyId],
            };
        });
    };

    return (
        <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: 9, padding: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 9 }}>{sourceTable?.name || source.table_id}</div>
            <div style={{ display: 'grid', gap: 9, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
                <label style={{ fontSize: 11 }}>
                    {tp('llm_wiki_title_field', 'Title field')}
                    <select style={{ ...SELECT_STYLE, marginTop: 3 }} value={source.title_property_id} onChange={(event) => { updateSource((item) => ({ ...item, title_property_id: event.target.value })); }}>
                        <option value="">—</option>
                        {properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}
                    </select>
                </label>
                <label style={{ fontSize: 11 }}>
                    {tp('llm_wiki_language_field', 'Language field')}
                    <select style={{ ...SELECT_STYLE, marginTop: 3 }} value={source.language_property_id} onChange={(event) => { updateSource((item) => ({ ...item, language_property_id: event.target.value })); }}>
                        <option value="">{tp('llm_wiki_auto_language', 'Automatic detection')}</option>
                        {properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}
                    </select>
                </label>
            </div>
            <div style={{ display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr', marginTop: 9 }}>
                <div>
                    <div style={{ fontSize: 11, fontWeight: 700 }}>{tp('llm_wiki_attachment_fields', 'Attachment fields')}</div>
                    {fileProperties.map((property) => (
                        <label key={property.id} style={{ display: 'block', fontSize: 11, marginTop: 4 }}>
                            <input type="checkbox" checked={source.attachment_property_ids.includes(property.id)} onChange={() => { toggleProperty('attachment_property_ids', property.id); }} /> {property.name}
                        </label>
                    ))}
                </div>
                <div>
                    <div style={{ fontSize: 11, fontWeight: 700 }}>{tp('llm_wiki_url_fields', 'URL fields')}</div>
                    {urlProperties.map((property) => (
                        <label key={property.id} style={{ display: 'block', fontSize: 11, marginTop: 4 }}>
                            <input type="checkbox" checked={source.url_property_ids.includes(property.id)} onChange={() => { toggleProperty('url_property_ids', property.id); }} /> {property.name}
                        </label>
                    ))}
                </div>
            </div>
            <LlmWikiFieldAssignments brainTable={brainTable} draft={draft} source={source}
                properties={properties} serverState={serverState} updateSource={updateSource} />
        </div>
    );
}
