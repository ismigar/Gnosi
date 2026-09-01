import { useState } from 'react';
import { Calendar as CalendarIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { PlanningPeriodModel } from './planningModel';

interface PlanningPeriodSummaryProps {
    readonly idToTitle: Readonly<Record<string, string>>;
    readonly model: PlanningPeriodModel;
}

export function PlanningPeriodSummary({
    idToTitle,
    model,
}: PlanningPeriodSummaryProps) {
    const { t } = useTranslation();
    const [showDependencyHelp, setShowDependencyHelp] = useState(false);
    const showCalculation = Boolean(
        model.summaryStart
        || model.summaryDuration
        || model.summaryEnd
        || model.hasPredecessors,
    );

    return (
        <>
            {showCalculation && (
                <section
                    aria-label={t(
                        'vault_date.period_calculation_summary',
                        'Calculation summary',
                    )}
                    className="col-span-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)]/70 px-3 py-2 text-[11px] text-[var(--text-secondary)]"
                >
                    <div className="mb-1.5 flex items-center gap-1.5 font-semibold text-[var(--text-primary)]">
                        <CalendarIcon size={13} className="text-[var(--gnosi-primary)]" aria-hidden="true" />
                        <span>
                            {t(
                                'vault_date.period_calculation_summary',
                                'Calculation summary',
                            )}
                        </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span>
                            <span className="text-[var(--text-tertiary)]">
                                {t('vault_date.period_calculation_start', 'Start')}:
                            </span>{' '}
                            <strong className="font-semibold text-[var(--text-primary)]">
                                {model.summaryStart || '—'}
                            </strong>
                        </span>
                        <span aria-hidden="true" className="text-[var(--text-tertiary)]">→</span>
                        <span>
                            <span className="text-[var(--text-tertiary)]">
                                {t('vault_date.period_calculation_duration', 'Duration')}:
                            </span>{' '}
                            <strong className="font-semibold text-[var(--text-primary)]">
                                {model.summaryDuration || '—'}
                            </strong>
                        </span>
                        <span aria-hidden="true" className="text-[var(--text-tertiary)]">→</span>
                        <span>
                            <span className="text-[var(--text-tertiary)]">
                                {t('vault_date.period_calculation_finish', 'Finish')}:
                            </span>{' '}
                            <strong className="font-semibold text-[var(--text-primary)]">
                                {model.summaryEnd || '—'}
                            </strong>
                        </span>
                    </div>
                    {model.hasPredecessors && model.period.startMode === 'auto' && (
                        <p className="mt-1.5 border-t border-[var(--border-primary)]/70 pt-1.5 text-[var(--text-tertiary)]">
                            {t(
                                'vault_date.period_calculation_predecessor',
                                'Automatic start from',
                            )}:{' '}
                            <span className="font-medium text-[var(--text-secondary)]">
                                {model.selectedPredecessors
                                    .map(({ title }) => title)
                                    .join(', ')}
                            </span>
                        </p>
                    )}
                </section>
            )}
            {model.hasPredecessors && model.period.dependencies.length > 0 && (
                <div className="col-span-2 flex flex-col gap-1">
                    <span className="flex items-center gap-1 text-[10px] font-semibold text-[var(--text-tertiary)]">
                        <span>
                            {t(
                                'vault_date.period_dependency_details',
                                'Dependency details',
                            )}
                        </span>
                        <button
                            type="button"
                            aria-expanded={showDependencyHelp}
                            aria-label={t(
                                'vault_date.period_dependency_details_hint',
                                'Define how this task relates to each predecessor and any delay before it starts.',
                            )}
                            title={t(
                                'vault_date.period_dependency_details_hint',
                                'Define how this task relates to each predecessor and any delay before it starts.',
                            )}
                            onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                setShowDependencyHelp((visible) => !visible);
                            }}
                            className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-[var(--border-primary)] text-[9px] font-bold leading-none text-[var(--text-tertiary)] transition-colors hover:border-[var(--gnosi-primary)] hover:text-[var(--gnosi-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--gnosi-primary)]/20"
                        >
                            ?
                        </button>
                    </span>
                    {showDependencyHelp && (
                        <span className="text-[11px] text-[var(--text-tertiary)] animate-in fade-in duration-150">
                            {t(
                                'vault_date.period_dependency_details_hint',
                                'Define how this task relates to each predecessor and any delay before it starts.',
                            )}
                        </span>
                    )}
                    <div className="grid grid-cols-[1fr_118px_118px] gap-1 text-[10px] font-semibold text-[var(--text-tertiary)]">
                        <span>{t('vault_date.period_dependency_task', 'Predecessor')}</span>
                        <span>{t('vault_date.period_dependency_relation', 'Relation')}</span>
                        <span>{t('vault_date.period_dependency_lag_short', 'Lag (min)')}</span>
                    </div>
                    {model.period.dependencies.map((dependency, index) => (
                        <div key={dependency.predecessorId} className="grid grid-cols-[1fr_118px_118px] gap-1">
                            <span className="truncate rounded bg-[var(--bg-secondary)] px-2 py-1 text-[var(--text-secondary)]">
                                {idToTitle[dependency.predecessorId]
                                    || dependency.predecessorId}
                            </span>
                            <select
                                value={dependency.type}
                                onChange={(event) => {
                                    model.handleDependencyTypeChange(
                                        index,
                                        event.target.value,
                                    );
                                }}
                                aria-label={t(
                                    'vault_date.period_dependency_relation',
                                    'Relation',
                                )}
                                className="rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1 text-[var(--text-primary)]"
                            >
                                <option value="FS">{t('vault_date.period_dependency_fs', 'Finish → start')}</option>
                                <option value="SS">{t('vault_date.period_dependency_ss', 'Start → start')}</option>
                                <option value="FF">{t('vault_date.period_dependency_ff', 'Finish → finish')}</option>
                                <option value="SF">{t('vault_date.period_dependency_sf', 'Start → finish')}</option>
                            </select>
                            <input
                                type="number"
                                step="15"
                                value={dependency.lagMinutes}
                                onChange={(event) => {
                                    model.handleDependencyLagChange(
                                        index,
                                        event.target.value,
                                    );
                                }}
                                aria-label={t(
                                    'vault_date.period_dependency_lag',
                                    'Lag minutes',
                                )}
                                className="rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1 text-[var(--text-primary)]"
                            />
                        </div>
                    ))}
                </div>
            )}
        </>
    );
}
