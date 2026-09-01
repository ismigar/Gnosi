import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    PLANNING_CONSTRAINT_OPTIONS,
    type PlanningPeriodModel,
} from './planningModel';

interface PlanningConstraintRulesHelpProps {
    readonly model: PlanningPeriodModel;
}

export function PlanningConstraintRulesHelp({
    model,
}: PlanningConstraintRulesHelpProps) {
    const { t } = useTranslation();
    const [showAll, setShowAll] = useState(false);
    const selected = PLANNING_CONSTRAINT_OPTIONS.find(
        ([value]) => value === model.selectedConstraintType,
    ) ?? PLANNING_CONSTRAINT_OPTIONS[0];
    if (!selected) return null;

    return (
        <div
            role="region"
            aria-label={t(
                'vault_date.period_constraint_help_title',
                'Scheduling rule explanations',
            )}
            className="col-span-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)]/70 p-2 text-[11px] text-[var(--text-secondary)] animate-in fade-in duration-150"
        >
            <div className="mb-1 font-semibold text-[var(--text-primary)]">
                {t('vault_date.period_constraint_selected_title', 'Selected rule')}
            </div>
            <p className="mb-2 text-[var(--text-tertiary)]">
                {t(
                    'vault_date.period_constraint_help_intro',
                    'Use a constraint date with SNET, SNLT, FNET, FNLT, MSO, or MFO. ASAP and ALAP do not need one.',
                )}
            </p>
            <dl className="grid gap-1">
                <div
                    aria-current="true"
                    className="grid grid-cols-[2.5rem_1fr] gap-2 rounded-md border border-[var(--gnosi-primary)]/30 bg-[var(--gnosi-primary)]/10 px-2 py-1.5"
                >
                    <dt className="font-semibold text-[var(--gnosi-primary)]">
                        {selected[0]}
                    </dt>
                    <dd>{t(selected[1])}</dd>
                </div>
                {showAll && PLANNING_CONSTRAINT_OPTIONS
                    .filter(([value]) => value !== model.selectedConstraintType)
                    .map(([value, descriptionKey]) => (
                        <div key={value} className="grid grid-cols-[2.5rem_1fr] gap-2 px-2 py-1">
                            <dt className="font-semibold text-[var(--text-primary)]">
                                {value}
                            </dt>
                            <dd>{t(descriptionKey)}</dd>
                        </div>
                    ))}
            </dl>
            <button
                type="button"
                aria-expanded={showAll}
                onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setShowAll((visible) => !visible);
                }}
                className="mt-2 inline-flex items-center rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1 font-semibold text-[var(--gnosi-primary)] transition-colors hover:border-[var(--gnosi-primary)]/50 hover:bg-[var(--gnosi-primary)]/5 focus:outline-none focus:ring-2 focus:ring-[var(--gnosi-primary)]/20"
            >
                {showAll
                    ? t(
                        'vault_date.period_constraint_show_selected',
                        'Show only the selected rule',
                    )
                    : t(
                        'vault_date.period_constraint_show_all',
                        'Show all rules',
                    )}
            </button>
        </div>
    );
}
