import './unified-date-editor.css';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GnosiToggle } from '../../../../shared/ui/settings/SettingsPrimitives';
import { dateBoundary, dateDuration, dateWithDuration, unifiedDate } from '../../../../shared/dates/unifiedDate';
import { parseVaultDate } from '../../../../shared/records/model/dateUtils';
import { VaultScalarDateEditor } from './VaultScalarDateEditor';
import { PlanningPeriodEditor } from './PlanningPeriodEditor';
import type { VaultDatePropertyProps } from './types';

export function UnifiedDateEditor(props: VaultDatePropertyProps) {
    const { t } = useTranslation();
    const [advanced, setAdvanced] = useState(false);
    const [error, setError] = useState('');
    const legacyType = props.type === 'date' ? (props.fieldConfig?.date_default_kind === 'period' ? 'period'
        : props.fieldConfig?.date_default_with_time ? 'datetime' : 'date') : props.type;
    const date = unifiedDate(props.value, legacyType);
    const duration = dateDuration(date);
    const commit = (next: typeof date): void => { setError(''); props.onChange(next); };
    const updateBoundary = (part: 'start' | 'end', input: unknown): void => {
        const raw = typeof input === 'string' ? input : '';
        // A hidden clock survives date-only edits as well as mode toggles.
        const clock = !date.withTime && date[part].includes('T') ? date[part].slice(date[part].indexOf('T')) : '';
        const next = { ...date, [part]: raw ? raw + clock : '', mode: 'manual',
            [part === 'start' ? 'startMode' : 'endMode']: 'manual' };
        if (next.kind === 'period' && next.start && next.end
            && parseVaultDate(dateBoundary(next, 'end')) < parseVaultDate(dateBoundary(next, 'start'))) {
            setError(t('vault_date.end_before_start')); return;
        }
        commit(next);
    };
    const scalarType = date.withTime ? 'datetime' : 'date';
    return (
        <div className="unified-date-editor flex w-full min-w-0 flex-col gap-2 text-sm" data-unified-date>
            <div className="unified-date-editor__toolbar flex flex-wrap items-center gap-3">
                <select aria-label={t('vault_date.modality')} value={date.kind}
                    onChange={event => { commit({ ...date, kind: event.target.value === 'period' ? 'period' : 'point' }); }}
                    className="rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 py-1 text-xs text-[var(--text-primary)]">
                    <option value="point">{t('vault_date.point')}</option>
                    <option value="period">{t('schema.type_period')}</option>
                </select>
                <span className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                    <GnosiToggle active={date.withTime} label={t('vault_date.include_time')}
                        onChange={() => { commit({ ...date, withTime: !date.withTime }); }} />
                    {t('vault_date.include_time')}
                </span>
            </div>
            <label className="unified-date-editor__boundary flex min-w-0 flex-col gap-1">
                {date.kind === 'period' && <span className="text-xs text-[var(--text-tertiary)]">{t('vault_date.period_calculation_start')}</span>}
                <VaultScalarDateEditor type={scalarType} value={dateBoundary(date, 'start')}
                    onChange={value => { updateBoundary('start', value); }}
                    onRruleChange={props.onRruleChange} rruleValue={props.rruleValue} />
            </label>
            {date.kind === 'period' && <>
                <label className="unified-date-editor__boundary flex min-w-0 flex-col gap-1">
                    <span className="text-xs text-[var(--text-tertiary)]">{t('vault_date.period_calculation_finish')}</span>
                    <VaultScalarDateEditor type={scalarType} value={dateBoundary(date, 'end')}
                        onChange={value => { updateBoundary('end', value); }} />
                </label>
                {!date.end && <span className="text-xs text-[var(--text-tertiary)]">{t('vault_date.end_pending')}</span>}
                <label className="unified-date-editor__duration flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                    {t('vault_date.period_calculation_duration')}
                    <input type="number" min={date.withTime ? 0 : 1} step={date.withTime ? '0.25' : '1'}
                        aria-label={t('vault_date.period_calculation_duration')} value={duration === null ? '' : Number(duration.toFixed(4))}
                        disabled={!date.start} onChange={event => {
                            if (event.target.value === '') { commit({ ...date, end: '', endMode: 'manual', mode: 'manual' }); return; }
                            commit(dateWithDuration(date, Number(event.target.value)));
                        }} className="w-20 rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 py-1 disabled:opacity-40" />
                    {t(`vault_date.period_duration_${date.withTime ? 'hours' : 'days'}`)}
                </label>
                {date.end && <button type="button" onClick={() => { commit({ ...date, end: '', endMode: 'manual', mode: 'manual' }); }}
                    className="w-fit text-xs text-[var(--text-tertiary)] hover:text-[var(--gnosi-primary)]">{t('vault_date.clear_end')}</button>}
                {props.planningEnabled && <>
                    <button type="button" aria-expanded={advanced} onClick={() => { setAdvanced(!advanced); }}
                        className="w-fit text-xs text-[var(--gnosi-primary)]">{t('schema.period_planning')}</button>
                    {advanced && <PlanningPeriodEditor fieldConfig={{ ...props.fieldConfig,
                        period_unit: date.withTime ? 'hours' : (props.fieldConfig?.period_unit === 'years' ? 'years' : 'days') }}
                        fieldName={props.fieldName ?? ''} idToTitle={props.idToTitle ?? {}}
                        noteId={props.noteId ?? ''} notes={props.notes ?? []} planningEnabled
                        planningSettings={props.planningSettings ?? {}} value={date}
                        onChange={next => { commit(unifiedDate({ ...date, ...(next && typeof next === 'object' && !(next instanceof Date) ? next : {}) })); }} />}
                </>}
            </>}
            {(date.start || date.end) && <button type="button" onClick={() => { commit({ ...date, start: '', end: '', startMode: 'manual', endMode: 'manual', mode: 'manual' }); }}
                className="w-fit text-xs text-[var(--text-tertiary)] hover:text-[var(--gnosi-primary)]">{t('vault_date.clear_date')}</button>}
            {error && <span role="alert" className="text-xs text-red-500">{error}</span>}
        </div>
    );
}
