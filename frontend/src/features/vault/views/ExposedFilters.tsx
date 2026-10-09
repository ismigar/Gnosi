import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GnosiToggle } from '../../../shared/ui/settings/SettingsPrimitives';
import type { VaultSchema } from '../../../shared/records/model/schemaTypes';
import type { ExposedFilterControls } from '../../../shared/filtering/useExposedFilters';
import { resolveFieldRef } from '../../../shared/records/model/schemaUtils';
import { fetchVaultPagesByTable } from '../../../shared/api/vaults';
import { FilterValueControl } from '../view-config/page-view-modal/FilterValueControl';
import { decodeView, isRecord } from '../view-config/page-view-modal/decode';
import type { Field, RelationOption } from '../view-config/page-view-modal/types';

function fieldFor(schema: VaultSchema, name: string): Field {
    name = resolveFieldRef(schema, name).name || name;
    const value = schema[name];
    const config = schema[`${name}_config`];
    const meta = { ...(isRecord(config) ? config : {}), ...(isRecord(value) ? value : {}) };
    return { name, type: typeof value === 'string' ? value : typeof meta.type === 'string' ? meta.type : 'text',
        options: meta.options,
        relation_database_id: typeof meta.relation_database_id === 'string' ? meta.relation_database_id : undefined };
}

export function ExposedFilters({ controls, schema, disabled = false }: {
    controls: ExposedFilterControls; schema: VaultSchema; disabled?: boolean;
}) {
    const { t } = useTranslation();
    const id = useId();
    const [relations, setRelations] = useState<Record<string, RelationOption[]>>({});
    const targets = JSON.stringify([...new Set(controls.entries.map(entry => fieldFor(schema, entry.rule.field || '').relation_database_id).filter(Boolean))]);
    useEffect(() => {
        let cancelled = false;
        const parsed: unknown = JSON.parse(targets);
        const tables = Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
        for (const table of tables) {
            void fetchVaultPagesByTable(table).then(rows => {
                if (!cancelled) setRelations(previous => ({ ...previous, [table]: rows.filter(row => !row.metadata.is_template)
                    .map(row => ({ value: row.id, label: row.title || row.id })) }));
            }).catch(() => { if (!cancelled) setRelations(previous => ({ ...previous, [table]: [] })); });
        }
        return () => { cancelled = true; };
    }, [targets]);
    if (!controls.entries.length) return null;
    return <div className="mb-2 flex flex-wrap items-end gap-3 text-xs text-[var(--text-secondary)]" role="group" aria-label={t('view.exposed_filters')}>
        {controls.entries.map(entry => {
            const field = entry.rule.field || '';
            const meta = fieldFor(schema, field);
            const rule = decodeView({ filters: [entry.rule] }).filters?.[0];
            if (!rule) return null;
            const label = `${id}-${entry.key}`;
            return <div key={entry.key} className="flex flex-col gap-1">
                <div className="flex items-center gap-1.5">
                    <GnosiToggle active={entry.enabled} disabled={disabled} label={meta.name === 'title' ? t('common.title', 'Title') : meta.name}
                        onChange={() => { controls.update(entry.key, { enabled: !entry.enabled, value: entry.rule.value }); }} />
                    <span id={label}>{meta.name === 'title' ? t('common.title', 'Title') : meta.name} · {t(`view.op_${rule.operator}`, rule.operator)}</span>
                </div>
                <fieldset className="min-w-0 border-0 p-0 disabled:opacity-50" disabled={disabled || !entry.enabled} inert={disabled || !entry.enabled} aria-labelledby={label}>
                    <FilterValueControl rule={rule} meta={meta} t={t}
                        relOpts={meta.relation_database_id ? relations[meta.relation_database_id] : undefined}
                        onValue={value => { controls.update(entry.key, { enabled: true, value }); }} />
                </fieldset>
            </div>;
        })}
        {controls.changed && <button type="button" className="btn-gnosi btn-gnosi-secondary text-xs" onClick={controls.reset}>{t('view.reset_exposed_filters')}</button>}
    </div>;
}
