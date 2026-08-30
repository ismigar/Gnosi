import { useTranslation } from 'react-i18next';

import ConfirmModal from '../../../shared/ui/dialogs/ConfirmModal';
import { sortFieldItems } from '../../../shared/schema/fieldOrdering';
import { LlmWikiSourceCard } from './LlmWikiSourceCard';
import { LlmWikiStatus } from './LlmWikiStatus';
import {
    detectLlmWikiSource,
    normalizeFieldName,
    type DimensionMapping,
    type LlmWikiSource,
} from './llmWikiModel';
import { SELECT_STYLE } from './pluginSettingsModel';
import { useLlmWikiController } from './useLlmWikiController';

export function LlmWikiConfig() {
    const { t } = useTranslation();
    const controller = useLlmWikiController();
    const { draft, brainTable, tables } = controller;
    const tp = (key: string, fallback: string, values: Readonly<Record<string, unknown>> = {}): string => (
        t(`settings.plugins.${key}`, { defaultValue: fallback, ...values })
    );
    const selectedSourceIds = new Set(draft.source_tables.map((source) => source.table_id));
    const categoricalProperties = sortFieldItems(brainTable?.properties.filter((property) => (
        ['relation', 'select', 'multi_select', 'status'].includes(property.type)
        && !/tipus de nota|note type/i.test(property.name)
        && !(property.type === 'relation' && selectedSourceIds.has(property.relation_database_id ?? ''))
    )));

    const pickBrain = (tableId: string): void => {
        controller.setDraft((current) => ({
            ...current,
            brain_table_id: tableId,
            index_field_ids: [],
            source_tables: current.source_tables.filter((source) => source.table_id !== tableId),
            target_table: tableId,
        }));
    };

    const toggleSource = (tableId: string): void => {
        const table = tables.find((candidate) => candidate.id === tableId);
        if (!table) return;
        controller.setDraft((current) => {
            const exists = current.source_tables.some((source) => source.table_id === table.id);
            return {
                ...current,
                source_tables: exists
                    ? current.source_tables.filter((source) => source.table_id !== table.id)
                    : [...current.source_tables, detectLlmWikiSource(table, brainTable, current.index_field_ids)],
            };
        });
    };

    const toggleIndexField = (fieldId: string): void => {
        controller.setDraft((current) => {
            const enabled = current.index_field_ids.includes(fieldId);
            const nextIds = enabled
                ? current.index_field_ids.filter((id) => id !== fieldId)
                : [...current.index_field_ids, fieldId];
            const brainProperty = brainTable?.properties.find((property) => property.id === fieldId);
            const nextSources = current.source_tables.map((source): LlmWikiSource => {
                const sourceTable = tables.find((table) => table.id === source.table_id);
                const sourceProperty = sourceTable?.properties.find((property) => (
                    normalizeFieldName(property.name) === normalizeFieldName(brainProperty?.name)
                ));
                const retainedMappings = Object.fromEntries(Object.entries(source.dimension_mappings)
                    .filter(([key]) => key !== fieldId));
                const newMapping: DimensionMapping = sourceProperty
                    ? { fixed_value: null, mode: 'source', source_property_id: sourceProperty.id }
                    : { fixed_value: null, mode: 'ai', source_property_id: '' };
                return {
                    ...source,
                    dimension_mappings: enabled
                        ? retainedMappings
                        : { ...retainedMappings, [fieldId]: newMapping },
                };
            });
            return { ...current, index_field_ids: nextIds, source_tables: nextSources };
        });
    };

    if (controller.loading) {
        return <div style={{ color: 'var(--text-tertiary)', fontSize: 12, padding: 14 }}>{tp('llm_wiki_loading', 'Loading configuration…')}</div>;
    }

    return (
        <>
            <div style={{
                background: 'var(--bg-primary, #fff)', border: '1px dashed var(--border-primary, #e2e8f0)',
                borderRadius: 10, display: 'flex', flexDirection: 'column', gap: 14,
                marginTop: 8, padding: '12px 14px',
            }}>
                <div style={{ color: 'var(--text-tertiary, #94a3b8)', fontSize: 12 }}>{tp('llm_wiki_intro_v2', 'Choose the Brain, one or more source tables, and the categorical fields that will maintain indexes.')}</div>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ color: 'var(--text-secondary, #475569)', fontSize: 12, fontWeight: 600 }}>{tp('llm_wiki_table', 'Brain table')}</span>
                    <select style={SELECT_STYLE} value={draft.brain_table_id} disabled={controller.busy} onChange={(event) => { pickBrain(event.target.value); }}>
                        <option value="">{tp('llm_wiki_none', 'None (disabled)')}</option>
                        {sortFieldItems(tables, (table) => table.name).map((table) => <option key={table.id} value={table.id}>{table.name || table.id}</option>)}
                    </select>
                </label>
                <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                    <button type="button" onClick={() => { controller.setConfirmCreate(true); }} disabled={controller.busy} style={{
                        background: 'var(--bg-secondary, #f8fafc)', border: '1px solid var(--border-primary, #e2e8f0)',
                        borderRadius: 8, color: 'var(--text-primary, #0f172a)', cursor: controller.busy ? 'default' : 'pointer',
                        fontSize: 13, fontWeight: 600, opacity: controller.busy ? 0.6 : 1, padding: '8px 14px',
                    }}>{tp('llm_wiki_create', 'Create a Brain table')}</button>
                    <span style={{ color: 'var(--text-tertiary, #94a3b8)', fontSize: 12 }}>
                        {controller.serverState?.brain.configured
                            ? tp('llm_wiki_active', 'Active in «{{name}}»', { name: controller.serverState.brain.name ?? '' })
                            : tp('llm_wiki_inactive', 'No table designated yet.')}
                        {controller.serverState?.brain.configured && controller.pendingSuggestions > 0 && (
                            <span style={{ color: 'var(--gnosi-primary, #6366f1)', fontWeight: 700, marginLeft: 8 }}>
                                {tp('llm_wiki_pending_connections', '{{count}} pending connections', { count: controller.pendingSuggestions })}
                            </span>
                        )}
                    </span>
                </div>
                {brainTable && (
                    <>
                        <div style={{ borderTop: '1px solid var(--border-primary)', paddingTop: 12 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>{tp('llm_wiki_sources', 'Source tables')}</div>
                            <div style={{ display: 'grid', gap: 7, gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
                                {tables.filter((table) => table.id !== draft.brain_table_id).map((table) => (
                                    <label key={table.id} style={{ alignItems: 'center', border: '1px solid var(--border-primary)', borderRadius: 8, display: 'flex', fontSize: 12, gap: 7, padding: '7px 9px' }}>
                                        <input type="checkbox" checked={selectedSourceIds.has(table.id)} onChange={() => { toggleSource(table.id); }} />{table.name || table.id}
                                    </label>
                                ))}
                            </div>
                        </div>
                        <div>
                            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>{tp('llm_wiki_index_fields', 'Indexed categorical fields')}</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                                {categoricalProperties.map((property) => (
                                    <label key={property.id} style={{ alignItems: 'center', border: '1px solid var(--border-primary)', borderRadius: 999, display: 'flex', fontSize: 12, gap: 6, padding: '6px 9px' }}>
                                        <input type="checkbox" checked={draft.index_field_ids.includes(property.id)} onChange={() => { toggleIndexField(property.id); }} />{property.name || property.id}
                                    </label>
                                ))}
                                {categoricalProperties.length === 0 && <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>{tp('llm_wiki_no_index_fields', 'This table has no indexable categorical fields.')}</span>}
                            </div>
                        </div>
                        {sortFieldItems(draft.source_tables, (source) => tables.find((table) => table.id === source.table_id)?.name || source.table_id).map((source) => (
                            <LlmWikiSourceCard key={source.table_id} brainTable={brainTable} draft={draft} serverState={controller.serverState} setDraft={controller.setDraft} source={source} sourceTable={tables.find((table) => table.id === source.table_id)} />
                        ))}
                    </>
                )}
                {controller.error && <div style={{ color: 'var(--status-error, #dc2626)', fontSize: 12 }}>{controller.error}</div>}
                <div style={{ borderTop: '1px solid var(--border-primary)', display: 'flex', flexWrap: 'wrap', gap: 10, paddingTop: 12 }}>
                    <span style={{ alignSelf: 'center', color: 'var(--text-tertiary, #94a3b8)', fontSize: 12 }}>{controller.busy ? tp('llm_wiki_saving', 'Saving…') : tp('llm_wiki_autosave', 'Changes save automatically.')}</span>
                    <button type="button" onClick={() => { void controller.runLint(); }} disabled={controller.lintBusy || !controller.serverState?.validation.valid} className="btn-gnosi">{controller.lintBusy ? tp('llm_wiki_lint_running', 'Reviewing…') : tp('llm_wiki_lint_run', 'Review the Brain (lint)')}</button>
                    <button type="button" onClick={() => { void controller.runSemanticAudit(); }} disabled={controller.semanticBusy || !controller.serverState?.validation.valid} className="btn-gnosi">{controller.semanticBusy ? tp('llm_wiki_semantic_running', 'Analyzing connections…') : tp('llm_wiki_semantic_run', 'Propose connections with AI')}</button>
                </div>
                <LlmWikiStatus controller={controller} />
            </div>
            <ConfirmModal
                isOpen={controller.confirmCreate}
                onClose={() => { controller.setConfirmCreate(false); }}
                onConfirm={controller.createBrain}
                isDestructive={false}
                title={tp('llm_wiki_create_confirm_title', 'Create a standard Brain?')}
                message={tp('llm_wiki_create_confirm_message', 'A table will be created with note type, areas, tags, position, and verification fields, plus the General index, Schema, and Log. No existing table will be removed or modified.')}
                confirmText={tp('llm_wiki_create_confirm', 'Create Brain')}
            />
        </>
    );
}
