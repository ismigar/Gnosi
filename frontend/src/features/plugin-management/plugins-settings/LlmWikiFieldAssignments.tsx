import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
import type { PluginLlmWikiSettingsResponse } from '../../../shared/api/plugins';
import { GnosiToggle } from '../../../shared/ui/settings/SettingsPrimitives';
import { sortFieldItems } from '../../../shared/schema/fieldOrdering';
import type { DimensionMapping, DimensionMode, LlmWikiDraft, LlmWikiSource } from './llmWikiModel';
import { SELECT_STYLE, type VaultProperty, type VaultTable } from './pluginSettingsModel';

const SCALAR_TYPES = ['text', 'rich_text', 'url', 'email', 'phone', 'number', 'currency', 'percent', 'checkbox', 'date', 'datetime'];
const CATEGORY_TYPES = ['select', 'multi_select', 'status', 'relation'];
const COPY_TYPES = ['files', 'file', 'attachment', 'attachments', 'image', 'autoria', 'zotero', 'period'];
const NUMERIC_TYPES = ['number', 'currency', 'percent'];

function compatibleAssignment(source: VaultProperty, target: VaultProperty): boolean {
    if (source.type === 'relation' && target.type === 'relation') return source.relation_database_id === target.relation_database_id;
    return source.type === target.type || (['select', 'multi_select', 'status'].includes(source.type) && ['select', 'multi_select', 'status'].includes(target.type));
}

interface Props {
    readonly brainTable: VaultTable;
    readonly draft: LlmWikiDraft;
    readonly source: LlmWikiSource;
    readonly properties: readonly VaultProperty[];
    readonly serverState: PluginLlmWikiSettingsResponse | null;
    readonly updateSource: (updater: (source: LlmWikiSource) => LlmWikiSource) => void;
}

export function LlmWikiFieldAssignments({ brainTable, draft, source, properties, serverState, updateSource }: Props) {
    const { t } = useTranslation();
    const tp = (key: string, fallback: string): string => t(`settings.plugins.${key}`, { defaultValue: fallback });
    const ids = source.assignment_field_ids ?? draft.index_field_ids;
    const protectedIds = new Set(['note_type', 'position', 'verification', 'last_reviewed'].map(role => draft.brain_roles[role]));
    draft.source_tables.forEach(item => { protectedIds.add(item.relation_property_id); });
    const available = sortFieldItems(brainTable.properties.filter(prop => !protectedIds.has(prop.id)
        && !(prop.type === 'relation' && draft.source_tables.some(item => item.table_id === prop.relation_database_id))
        && !['id', 'title', 'table_id', 'parent_id', 'note_type'].includes(prop.name.toLowerCase()) && !prop.name.toLowerCase().startsWith('llm_wiki_')
        && [...SCALAR_TYPES, ...CATEGORY_TYPES, ...COPY_TYPES].includes(prop.type)));
    const change = (id: string, mapping: DimensionMapping): void => {
        updateSource(item => ({ ...item, assignment_field_ids: [...ids], dimension_mappings: { ...item.dimension_mappings, [id]: mapping } }));
    };
    return <section style={{ marginTop: 16 }}>
        <h4 style={{ fontSize: 13 }}>{tp('llm_wiki_assign_fields', 'Fields to fill in reading notes')}</h4>
        <p style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{tp('llm_wiki_assign_help', 'Choose fields from the Brain table and how to fill them. This is independent of index creation. Calculated and system fields are filled automatically.')}</p>
        <select style={SELECT_STYLE} aria-label={tp('llm_wiki_add_field', 'Add field')} value="" onChange={event => {
            const fieldId = event.target.value;
            const prop = available.find(item => item.id === fieldId);
            if (!prop) return;
            const copied = properties.find(item => compatibleAssignment(item, prop));
            const mapping: DimensionMapping = COPY_TYPES.includes(prop.type)
                ? { mode: copied ? 'source' : 'empty', source_property_id: copied?.id ?? '', fixed_value: null }
                : { mode: 'ai', source_property_id: '', fixed_value: null };
            updateSource(item => ({ ...item, assignment_field_ids: [...ids, fieldId], dimension_mappings: { ...item.dimension_mappings, [fieldId]: mapping } }));
        }}>
            <option value="">{tp('llm_wiki_add_field', 'Add field')}</option>
            {available.filter(prop => !ids.includes(prop.id)).map(prop => <option key={prop.id} value={prop.id}>{prop.name}</option>)}
        </select>
        {ids.map(id => {
            const prop = brainTable.properties.find(item => item.id === id);
            const mapping = source.dimension_mappings[id] ?? { mode: 'ai', source_property_id: '', fixed_value: null };
            const copyOnly = !!prop && COPY_TYPES.includes(prop.type);
            return <div key={id} style={{ borderTop: '1px solid var(--border-primary)', paddingTop: 10, marginTop: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <strong style={{ flex: 1, fontSize: 12 }}>{prop?.name ?? id}</strong>
                    <button type="button" className="btn-gnosi" aria-label={`${tp('llm_wiki_remove_field', 'Remove field')}: ${prop?.name ?? id}`} onClick={() => {
                        updateSource(item => ({ ...item, assignment_field_ids: ids.filter(value => value !== id), dimension_mappings: Object.fromEntries(Object.entries(item.dimension_mappings).filter(([key]) => key !== id)) }));
                    }}><Trash2 size={14} /></button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
                    <select style={SELECT_STYLE} aria-label={`${prop?.name ?? id}: ${tp('llm_wiki_assignment_mode', 'Assignment')}`} value={mapping.mode} onChange={event => {
                        const mode = event.target.value as DimensionMode;
                        const sourceId = properties.find(item => prop && compatibleAssignment(item, prop))?.id ?? '';
                        const fixedValue = prop?.type === 'checkbox' ? false : NUMERIC_TYPES.includes(prop?.type ?? '') ? 0 : null;
                        change(id, { ...mapping, mode, source_property_id: mapping.source_property_id || sourceId, fixed_value: mapping.fixed_value ?? fixedValue });
                    }}>
                        {!copyOnly && <option value="ai">{tp('llm_wiki_map_ai', 'Infer with AI')}</option>}
                        <option value="source">{tp('llm_wiki_map_source', 'Copy source field')}</option>
                        {!copyOnly && <option value="fixed">{tp('llm_wiki_map_fixed', 'Fixed value')}</option>}
                        <option value="empty">{tp('llm_wiki_map_empty', 'Leave empty')}</option>
                    </select>
                    {mapping.mode === 'source' && <select style={SELECT_STYLE} aria-label={`${prop?.name ?? id}: ${tp('llm_wiki_map_source', 'Copy source field')}`} value={mapping.source_property_id} onChange={event => { change(id, { ...mapping, source_property_id: event.target.value }); }}>
                        <option value="">—</option>
                        {properties.filter(item => prop && compatibleAssignment(item, prop)).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>}
                    {mapping.mode === 'fixed' && prop && <FixedValue property={prop} mapping={mapping} options={serverState?.index_options[id] ?? []} onChange={value => { change(id, { ...mapping, fixed_value: value }); }} />}
                </div>
                {copyOnly && <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{tp('llm_wiki_copy_only', 'This field copies an existing value from the resource.')}</p>}
            </div>;
        })}
    </section>;
}

function FixedValue({ property, mapping, options, onChange }: {
    readonly property: VaultProperty;
    readonly mapping: DimensionMapping;
    readonly options: readonly { readonly value: string; readonly label: string }[];
    readonly onChange: (value: DimensionMapping['fixed_value']) => void;
}) {
    const value = mapping.fixed_value;
    if (property.type === 'checkbox') return <GnosiToggle active={value === true} onChange={() => { onChange(value !== true); }} label={property.name} />;
    if (CATEGORY_TYPES.includes(property.type)) {
        const multiple = ['relation', 'multi_select'].includes(property.type);
        const values: readonly string[] = typeof value === 'string' ? [value] : typeof value === 'object' && value !== null ? value : [];
        return <select style={SELECT_STYLE} aria-label={property.name} multiple={multiple} value={multiple ? values : values[0] ?? ''} onChange={event => {
            onChange(multiple ? Array.from(event.target.selectedOptions, option => option.value) : event.target.value);
        }}>
            {!multiple && <option value="">—</option>}
            {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>;
    }
    const type = NUMERIC_TYPES.includes(property.type) ? 'number' : property.type === 'datetime' ? 'datetime-local' : property.type === 'date' ? 'date' : 'text';
    return <input style={SELECT_STYLE} aria-label={property.name} type={type} step="any" value={typeof value === 'string' || typeof value === 'number' ? value : ''} onChange={event => {
        onChange(type === 'number' && event.target.value !== '' ? Number(event.target.value) : event.target.value);
    }} />;
}
