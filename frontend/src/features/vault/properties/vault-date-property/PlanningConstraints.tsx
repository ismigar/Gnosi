import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    PERIOD_INPUT_CLASS,
    periodDateLabel,
    type PlanningPeriodModel,
} from './planningModel';
import { PlanningConstraintRulesHelp } from './PlanningConstraintRulesHelp';

interface PlanningConstraintsProps {
    readonly model: PlanningPeriodModel;
}

export function PlanningConstraints({ model }: PlanningConstraintsProps) {
    const { t } = useTranslation();
    const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({});
    const [showConstraintHelp, setShowConstraintHelp] = useState(false);
    const [showConstraintDateHelp, setShowConstraintDateHelp] = useState(false);
    const [showDeadlineHelp, setShowDeadlineHelp] = useState(false);
    const constraintInputRef = useRef<HTMLInputElement>(null);
    const pendingFocusRef = useRef(false);
    const constraintDateHelpId = useId();
    const constraintDateErrorId = useId();

    useEffect(() => {
        if (!pendingFocusRef.current || !constraintInputRef.current) return;
        constraintInputRef.current.focus();
        pendingFocusRef.current = false;
    }, [model.period.constraintType]);

    const draftValue = (key: string, persisted: string): string => (
        Object.hasOwn(drafts, key) ? drafts[key] ?? '' : persisted
    );
    const updateDraft = (key: string, value: string): void => {
        setDrafts((current) => ({ ...current, [key]: value }));
    };
    const commitDraft = (key: string, commit: (value: string) => void): void => {
        const raw = drafts[key];
        if (raw === undefined) return;
        const boundary = model.periodInputToBoundary(raw);
        if (raw === '' || boundary) commit(boundary);
        setDrafts((current) => Object.fromEntries(
            Object.entries(current).filter(([candidate]) => candidate !== key),
        ));
    };
    const placeholder = model.periodUnit === 'hours'
        ? 'YYYY-MM-DDTHH:mm'
        : model.periodUnit === 'days' ? 'YYYY-MM-DD' : 'YYYY';
    const constraintDate = draftValue(
        'constraintDate',
        model.period.constraintDate,
    );
    const constraintMissing = model.constraintRequiresDate
        && constraintDate.trim() === '';
    const describedBy = [
        showConstraintDateHelp ? constraintDateHelpId : '',
        constraintMissing ? constraintDateErrorId : '',
    ].filter(Boolean).join(' ') || undefined;

    return (
        <div className="col-span-2 grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
                <span className="flex h-4 items-center gap-1 text-[10px] font-semibold text-[var(--text-tertiary)]">
                    <span>{t('vault_date.period_constraint', 'Scheduling rule')}</span>
                    <button
                        type="button"
                        aria-expanded={showConstraintHelp}
                        aria-label={t(
                            'vault_date.period_constraint_help_toggle',
                            'Show scheduling rule explanations',
                        )}
                        title={t(
                            'vault_date.period_constraint_help_toggle',
                            'Show scheduling rule explanations',
                        )}
                        onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setShowConstraintHelp((visible) => !visible);
                        }}
                        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-[var(--border-primary)] text-[9px] font-bold leading-none text-[var(--text-tertiary)] transition-colors hover:border-[var(--gnosi-primary)] hover:text-[var(--gnosi-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--gnosi-primary)]/20"
                    >
                        ?
                    </button>
                </span>
                <select
                    value={model.selectedConstraintType}
                    onChange={(event) => {
                        if (event.target.value !== 'ASAP' && event.target.value !== 'ALAP') {
                            pendingFocusRef.current = true;
                        }
                        model.setConstraintType(event.target.value);
                    }}
                    className={`${PERIOD_INPUT_CLASS} cursor-pointer`}
                >
                    <option value="ASAP">ASAP</option><option value="ALAP">ALAP</option>
                    <option value="SNET">SNET</option><option value="SNLT">SNLT</option>
                    <option value="FNET">FNET</option><option value="FNLT">FNLT</option>
                    <option value="MSO">MSO</option><option value="MFO">MFO</option>
                </select>
            </label>
            {model.constraintRequiresDate && (
                <label className="flex flex-col gap-1">
                    <span className="flex h-4 items-center gap-1 text-[10px] font-semibold text-[var(--text-tertiary)]">
                        <span>{periodDateLabel(t, model.periodUnit, 'constraint_date')}</span>
                        <button
                            type="button"
                            aria-expanded={showConstraintDateHelp}
                            aria-label={t(
                                'vault_date.period_constraint_date_hint',
                                'It is required by the selected rule and changes the automatic schedule; a deadline only raises a warning.',
                            )}
                            title={t(
                                'vault_date.period_constraint_date_hint',
                                'It is required by the selected rule and changes the automatic schedule; a deadline only raises a warning.',
                            )}
                            onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                setShowConstraintDateHelp((visible) => !visible);
                            }}
                            className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-[var(--border-primary)] text-[9px] font-bold leading-none text-[var(--text-tertiary)] transition-colors hover:border-[var(--gnosi-primary)] hover:text-[var(--gnosi-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--gnosi-primary)]/20"
                        >
                            ?
                        </button>
                    </span>
                    <input
                        ref={constraintInputRef}
                        type="text"
                        value={constraintDate}
                        placeholder={placeholder}
                        aria-invalid={constraintMissing}
                        aria-describedby={describedBy}
                        onChange={(event) => {
                            updateDraft('constraintDate', event.target.value);
                        }}
                        onBlur={() => {
                            commitDraft('constraintDate', model.commitConstraintDate);
                        }}
                        className={`${PERIOD_INPUT_CLASS} ${constraintMissing
                            ? 'border-[var(--status-error)] focus:border-[var(--status-error)] focus:ring-[var(--status-error)]/20'
                            : ''}`}
                    />
                    {showConstraintDateHelp && (
                        <span id={constraintDateHelpId} className="text-[11px] text-[var(--text-tertiary)] animate-in fade-in duration-150">
                            {t(
                                'vault_date.period_constraint_date_hint',
                                'It is required by the selected rule and changes the automatic schedule; a deadline only raises a warning.',
                            )}
                        </span>
                    )}
                    {constraintMissing && (
                        <span id={constraintDateErrorId} role="alert" className="text-[11px] font-medium text-[var(--status-error)]">
                            {t(
                                'vault_date.period_constraint_date_required',
                                'Enter a constraint date for the selected scheduling rule.',
                            )}
                        </span>
                    )}
                </label>
            )}
            <label className="flex flex-col gap-1">
                <span className="flex h-4 items-center gap-1 text-[10px] font-semibold text-[var(--text-tertiary)]">
                    <span>{periodDateLabel(t, model.periodUnit, 'deadline')}</span>
                    <button
                        type="button"
                        aria-expanded={showDeadlineHelp}
                        aria-label={t(
                            'vault_date.period_deadline_hint',
                            'Sets the desired latest finish. Exceeding it raises a warning but does not move schedule dates.',
                        )}
                        title={t(
                            'vault_date.period_deadline_hint',
                            'Sets the desired latest finish. Exceeding it raises a warning but does not move schedule dates.',
                        )}
                        onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setShowDeadlineHelp((visible) => !visible);
                        }}
                        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-[var(--border-primary)] text-[9px] font-bold leading-none text-[var(--text-tertiary)] transition-colors hover:border-[var(--gnosi-primary)] hover:text-[var(--gnosi-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--gnosi-primary)]/20"
                    >
                        ?
                    </button>
                </span>
                {showDeadlineHelp && (
                    <span className="text-[11px] text-[var(--text-tertiary)] animate-in fade-in duration-150">
                        {t(
                            'vault_date.period_deadline_hint',
                            'Sets the desired latest finish. Exceeding it raises a warning but does not move schedule dates.',
                        )}
                    </span>
                )}
                <input
                    type="text"
                    value={draftValue('deadline', model.period.deadline)}
                    placeholder={placeholder}
                    onChange={(event) => {
                        updateDraft('deadline', event.target.value);
                    }}
                    onBlur={() => {
                        commitDraft('deadline', model.commitDeadline);
                    }}
                    className={PERIOD_INPUT_CLASS}
                />
            </label>
            {showConstraintHelp && <PlanningConstraintRulesHelp model={model} />}
        </div>
    );
}
