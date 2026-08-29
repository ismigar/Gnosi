import { useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';

import {
    PERIOD_INPUT_CLASS,
    periodDateLabel,
    type PlanningPeriodModel,
} from './planningModel';

interface PlanningPeriodDatesProps {
    readonly model: PlanningPeriodModel;
}

export function PlanningPeriodDates({ model }: PlanningPeriodDatesProps) {
    const { t } = useTranslation();
    const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({});
    const [showDurationHelp, setShowDurationHelp] = useState(false);
    const draftValue = (key: string, persisted: string, isEnd = false): string => (
        Object.hasOwn(drafts, key)
            ? drafts[key] ?? ''
            : model.periodInputValue(persisted, isEnd)
    );
    const updateDraft = (key: string, raw: string): void => {
        setDrafts((current) => ({ ...current, [key]: raw }));
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
    const durationLabel = model.periodUnit === 'hours'
        ? 'Hours'
        : model.periodUnit === 'years' ? 'Years' : 'Days';

    return (
        <>
            <label className="flex flex-col gap-1">
                <span className="flex h-4 items-center text-[10px] font-semibold text-[var(--text-tertiary)]">
                    {periodDateLabel(t, model.periodUnit, 'start')}
                </span>
                <input
                    type="text"
                    value={draftValue('start', model.period.start)}
                    placeholder={placeholder}
                    onChange={(event) => {
                        updateDraft('start', event.target.value);
                    }}
                    onBlur={() => {
                        commitDraft('start', model.handleStartChange);
                    }}
                    className={PERIOD_INPUT_CLASS}
                />
            </label>
            <label className="flex flex-col gap-1">
                <span className="flex h-4 items-center gap-1 text-[10px] font-semibold text-[var(--text-tertiary)]">
                    <span>
                        {t(
                            `vault_date.period_duration_${model.periodUnit}`,
                            durationLabel,
                        )}
                    </span>
                    <button
                        type="button"
                        aria-expanded={showDurationHelp}
                        aria-label={t(
                            'vault_date.period_duration_hint',
                            'Calculate finish from start date and working-day duration.',
                        )}
                        title={t(
                            'vault_date.period_duration_hint',
                            'Calculate finish from start date and working-day duration.',
                        )}
                        onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setShowDurationHelp((open) => !open);
                        }}
                        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-[var(--border-primary)] text-[9px] font-bold leading-none text-[var(--text-tertiary)] transition-colors hover:border-[var(--gnosi-primary)] hover:text-[var(--gnosi-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--gnosi-primary)]/20"
                    >
                        ?
                    </button>
                </span>
                {showDurationHelp && (
                    <span className="text-[11px] text-[var(--text-tertiary)] animate-in fade-in duration-150">
                        {t(
                            'vault_date.period_duration_hint',
                            'Calculate finish from start date and working-day duration.',
                        )}
                    </span>
                )}
                <input
                    type="number"
                    min="0"
                    step={model.periodUnit === 'years' ? '1' : '0.25'}
                    value={model.displayDuration}
                    onChange={(event: ChangeEvent<HTMLInputElement>) => {
                        model.handleDurationChange(event.target.value);
                    }}
                    className={PERIOD_INPUT_CLASS}
                />
            </label>
            <label className="flex flex-col gap-1">
                <span className="flex h-4 items-center text-[10px] font-semibold text-[var(--text-tertiary)]">
                    {periodDateLabel(t, model.periodUnit, 'end')}
                </span>
                <input
                    type="text"
                    value={draftValue('end', model.period.end, true)}
                    placeholder={placeholder}
                    onChange={(event) => {
                        updateDraft('end', event.target.value);
                    }}
                    onBlur={() => {
                        commitDraft('end', model.handleEndChange);
                    }}
                    className={PERIOD_INPUT_CLASS}
                />
            </label>
        </>
    );
}
