import React from 'react';
import { useTranslation } from 'react-i18next';
import type { SortableFieldProps } from './types';
import { ROLLUP_AGGREGATIONS } from './constants';
export function DerivedFieldConfig({ field, idx, allFields, handleUpdateField, virtualComputers, allTables, currentTableName }: SortableFieldProps) {
    const { t } = useTranslation();
    // Sorted alphabetically: these pickers are for finding a field, unlike the
    // schema list itself, whose (drag-and-drop) order is the user's column order.
    const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });

    const relationFieldOptions = allFields
        .filter((candidate) => candidate.id !== field.id && candidate.type === 'relation' && candidate.name.trim())
        .map((candidate) => candidate.name.trim())
        .sort(byName);

    const targetPropertyOptions = allFields
        .filter((candidate) => candidate.id !== field.id && candidate.name.trim())
        .map((candidate) => candidate.name.trim())
        .sort(byName);

    return <>
            {/* Specific Configuration Section (Formula, Rollup, Relation, Virtual) */}
            {(field.type === 'relation' || field.type === 'rollup' || field.type === 'formula' || field.type === 'virtual') && (
                <div className="px-3 pb-3 pt-1 border-t border-[var(--border-primary)] bg-[var(--gnosi-primary)]/5 animate-in fade-in slide-in-from-top-1 duration-200">
                    <div className="p-3 bg-[var(--bg-primary)] rounded-lg border border-[var(--gnosi-primary)]/20 shadow-inner">
                        {field.type === 'virtual' && (
                            <div className="space-y-2">
                                <label className="text-[10px] uppercase tracking-wider text-[var(--gnosi-primary)] font-bold ml-1">
                                    {t('schema.virtual_compute', "Derived computer")}
                                </label>
                                <select
                                    value={field.compute || ''}
                                    onChange={(e) => { handleUpdateField(idx, 'compute', e.target.value); }}
                                    className="w-full text-sm bg-transparent text-[var(--text-primary)] outline-none border-none focus:ring-0"
                                >
                                    <option value="">{t('schema.virtual_pick', "— Pick a computer —")}</option>
                                    {virtualComputers.map(c => (
                                        <option key={c.compute} value={c.compute}>
                                            {c.label} ({c.compute})
                                        </option>
                                    ))}
                                </select>
                                {field.compute && (
                                    <p className="text-[10px] text-[var(--text-secondary)]/80 px-1 border-t border-[var(--border-primary)] pt-1">
                                        {virtualComputers.find(c => c.compute === field.compute)?.description || ''}
                                    </p>
                                )}
                                <p className="text-[10px] text-[var(--text-secondary)]/60 px-1">
                                    {t('schema.virtual_hint', "Derived (read-only) field. The backend computes it from the graph or other indexes.")}
                                </p>
                            </div>
                        )}
                        {field.type === 'formula' && (
                            <div className="space-y-2">
                                <label className="text-[10px] uppercase tracking-wider text-[var(--gnosi-primary)] font-bold ml-1">{t('schema.formula_expression')}</label>
                                <input
                                    type="text"
                                    value={field.formula || ''}
                                    onChange={(e) => { handleUpdateField(idx, 'formula', e.target.value); }}
                                    placeholder={t('schema.formula_placeholder')}
                                    className="w-full text-sm border-none focus:ring-0 bg-transparent font-mono text-[var(--text-primary)] outline-none"
                                />
                                <p className="text-[10px] text-[var(--text-secondary)]/60 px-1 border-t border-[var(--border-primary)] pt-1">
                                    {t('schema.formula_hint')}
                                </p>
                            </div>
                        )}

                        {field.type === 'rollup' && (
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <div className="space-y-1">
                                    <label className="text-[10px] uppercase tracking-wider text-[var(--gnosi-primary)] font-bold ml-1">{t('schema.relation')}</label>
                                    <select
                                        value={field.relationField || ''}
                                        onChange={(e) => { handleUpdateField(idx, 'relationField', e.target.value); }}
                                        className="w-full text-xs border border-[var(--border-primary)] rounded-md p-1.5 focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 outline-none bg-[var(--bg-primary)] text-[var(--text-primary)]"
                                    >
                                        <option value="">{t('schema.relation_fields_placeholder')}</option>
                                        {relationFieldOptions.map((name) => (
                                            <option key={name} value={name}>{name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[10px] uppercase tracking-wider text-[var(--gnosi-primary)] font-bold ml-1">{t('schema.target_property')}</label>
                                    <select
                                        value={field.targetProperty || ''}
                                        onChange={(e) => { handleUpdateField(idx, 'targetProperty', e.target.value); }}
                                        className="w-full text-xs border border-[var(--border-primary)] rounded-md p-1.5 focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 outline-none bg-[var(--bg-primary)] text-[var(--text-primary)]"
                                    >
                                        <option value="">{t('schema.select_property_placeholder')}</option>
                                        <option value="title">title</option>
                                        {targetPropertyOptions.map((name) => (
                                            <option key={name} value={name}>{name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="space-y-1 text-xs">
                                    <label className="text-[10px] uppercase tracking-wider text-[var(--gnosi-primary)] font-bold ml-1">{t('schema.aggregation')}</label>
                                    <select
                                        value={field.aggregation || 'count_values'}
                                        onChange={(e) => { handleUpdateField(idx, 'aggregation', e.target.value); }}
                                        className="w-full text-xs border border-[var(--border-primary)] rounded-md p-1.5 focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 outline-none bg-[var(--bg-primary)] text-[var(--text-primary)]"
                                    >
                                        {ROLLUP_AGGREGATIONS.map((option) => (
                                            <option key={option.value} value={option.value}>{t(`schema.rollup_${option.value}`, option.label)}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        )}

                        {field.type === 'relation' && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <label className="text-[10px] uppercase tracking-wider text-[var(--gnosi-primary)] font-bold ml-1">{t('schema.related_table')}</label>
                                    <select
                                        value={field.relation_database_id || ''}
                                        onChange={(e) => { handleUpdateField(idx, 'relation_database_id', e.target.value); }}
                                        className="w-full text-xs border border-[var(--border-primary)] rounded-md px-3 py-2 focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 focus:border-[var(--gnosi-primary)] outline-none bg-[var(--bg-primary)] text-[var(--text-primary)]"
                                    >
                                        <option value="">{t('schema.select_table_placeholder')}</option>
                                        {allTables.map((t) => (
                                            <option key={t.id} value={t.id}>{t.name || t.title || t.id}</option>
                                        ))}
                                    </select>
                                </div>
                                {(() => {
                                    const relatedTable = allTables.find(tt => tt.id === field.relation_database_id);
                                    const relatedName = relatedTable ? (relatedTable.name || relatedTable.title || relatedTable.id) : '';
                                    const srcName = currentTableName || '';
                                    // Readable label: "[Current table] <cardinality> [Related table]".
                                    // E.g.: "Resources many-to-one Areas" = each resource belongs to one area, but an area has many resources.
                                    const cardLabel = (key: string) => {
                                        const base = t(`schema.${key}`);
                                        if (srcName && relatedName) return `${srcName} ${base.toLowerCase()} ${relatedName}`;
                                        return base;
                                    };
                                    return (
                                        <div className="space-y-1">
                                            <label className="text-[10px] uppercase tracking-wider text-[var(--gnosi-primary)] font-bold ml-1">{t('schema.relation_cardinality')}</label>
                                            <select
                                                value={field.cardinality || 'one-to-many'}
                                                onChange={(e) => { handleUpdateField(idx, 'cardinality', e.target.value); }}
                                                className="w-full text-xs border border-[var(--border-primary)] rounded-md px-3 py-2 focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 focus:border-[var(--gnosi-primary)] outline-none bg-[var(--bg-primary)] text-[var(--text-primary)]"
                                            >
                                                <option value="one-to-one">{cardLabel('one_to_one')}</option>
                                                <option value="one-to-many">{cardLabel('one_to_many')}</option>
                                                <option value="many-to-one">{cardLabel('many_to_one')}</option>
                                                <option value="many-to-many">{cardLabel('many_to_many')}</option>
                                            </select>
                                        </div>
                                    );
                                })()}
                            </div>
                        )}
                    </div>
                </div>
            )}

    </>;
}
