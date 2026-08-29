import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { subscribeDocumentEvent } from '../../../shared/platform/browser-events';
import type { PlanningPeriodModel } from './planningModel';

interface PlanningPredecessorPickerProps {
    readonly idToTitle: Readonly<Record<string, string>>;
    readonly model: PlanningPeriodModel;
}

export function PlanningPredecessorPicker({
    idToTitle,
    model,
}: PlanningPredecessorPickerProps) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [showHelp, setShowHelp] = useState(false);
    const pickerRef = useRef<HTMLDivElement>(null);

    useEffect(() => subscribeDocumentEvent('mousedown', (event) => {
        const picker = pickerRef.current;
        if (picker && event.target instanceof Node && !picker.contains(event.target)) {
            setOpen(false);
        }
    }), []);

    const visibleCandidates = model.candidates.filter((candidate) => {
        const title = candidate.title || idToTitle[candidate.id] || candidate.id;
        return title.toLocaleLowerCase().includes(search.toLocaleLowerCase());
    });

    return (
        <label className="flex flex-col gap-1">
            <span className="flex h-4 items-center gap-1 text-[10px] font-semibold text-[var(--text-tertiary)]">
                <span>{t('vault_date.period_predecessors', 'Predecessors')}</span>
                <button
                    type="button"
                    aria-expanded={showHelp}
                    aria-label={t(
                        'vault_date.period_predecessors_hint',
                        'Select one or more tasks that must finish before this one.',
                    )}
                    title={t(
                        'vault_date.period_predecessors_hint',
                        'Select one or more tasks that must finish before this one.',
                    )}
                    onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setShowHelp((visible) => !visible);
                    }}
                    className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-[var(--border-primary)] text-[9px] font-bold leading-none text-[var(--text-tertiary)] transition-colors hover:border-[var(--gnosi-primary)] hover:text-[var(--gnosi-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--gnosi-primary)]/20"
                >
                    ?
                </button>
            </span>
            {showHelp && (
                <span className="text-[11px] text-[var(--text-tertiary)] animate-in fade-in duration-150">
                    {t(
                        'vault_date.period_predecessors_hint',
                        'Select one or more tasks that must finish before this one.',
                    )}
                </span>
            )}
            <div ref={pickerRef} className="relative">
                <div
                    role="button"
                    tabIndex={0}
                    aria-expanded={open}
                    onClick={() => {
                        setOpen((visible) => !visible);
                    }}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setOpen((visible) => !visible);
                        }
                    }}
                    className="flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-1.5 text-sm text-[var(--text-primary)] transition hover:border-[var(--gnosi-primary)]/50 focus:outline-none focus:ring-2 focus:ring-[var(--gnosi-primary)]/20"
                    title={t(
                        'vault_date.period_predecessors_hint',
                        'Select one or more tasks that must finish first',
                    )}
                >
                    {model.selectedPredecessors.length === 0 && (
                        <span className="ml-1 text-[var(--text-tertiary)]/60">
                            {t('vault_date.period_predecessors_search', 'Search tasks')}
                        </span>
                    )}
                    {model.selectedPredecessors.map((candidate) => (
                        <span key={candidate.id} className="flex max-w-full items-center gap-1.5 rounded-full border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)] shadow-sm">
                            <span className="truncate">{candidate.title}</span>
                            <span
                                role="button"
                                tabIndex={0}
                                title={t('common.delete', 'Delete')}
                                className="flex cursor-pointer items-center hover:text-[var(--status-error)]"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    model.togglePredecessor(candidate.id);
                                }}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter' || event.key === ' ') {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        model.togglePredecessor(candidate.id);
                                    }
                                }}
                            >
                                <X size={10} />
                            </span>
                        </span>
                    ))}
                    <ChevronDown size={14} className={`ml-auto shrink-0 text-[var(--text-tertiary)]/60 transition-transform ${open ? 'rotate-180' : ''}`} />
                </div>
                {open && (
                    <div className="absolute left-0 right-0 top-full z-[var(--z-popover)] mt-2 flex max-h-72 flex-col overflow-y-auto rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] p-2 shadow-xl">
                        <div className="relative mb-2 shrink-0">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]/60" />
                            <input
                                autoFocus
                                value={search}
                                onChange={(event) => {
                                    setSearch(event.target.value);
                                }}
                                onClick={(event) => {
                                    event.stopPropagation();
                                }}
                                placeholder={t('vault_date.period_predecessors_search', 'Search tasks')}
                                aria-label={t('vault_date.period_predecessors_search', 'Search tasks')}
                                className="w-full rounded-lg bg-[var(--bg-secondary)] py-2 pl-9 pr-4 text-sm text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-[var(--gnosi-primary)]/20"
                            />
                        </div>
                        <div className="overflow-y-auto">
                            {visibleCandidates.map((candidate) => (
                                <div
                                    key={candidate.id}
                                    role="option"
                                    aria-selected={model.period.predecessorIds.includes(candidate.id)}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        model.togglePredecessor(candidate.id);
                                    }}
                                    className="flex cursor-pointer items-center gap-2 rounded-lg p-2.5 text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--gnosi-primary)]/10 hover:text-[var(--gnosi-primary)]"
                                >
                                    <span className="w-4 text-[var(--gnosi-primary)]">
                                        {model.period.predecessorIds.includes(candidate.id) ? '✓' : ''}
                                    </span>
                                    <span className="truncate">
                                        {candidate.title || idToTitle[candidate.id] || candidate.id}
                                    </span>
                                </div>
                            ))}
                            {visibleCandidates.length === 0 && (
                                <span className="block p-2 text-xs text-[var(--text-tertiary)]">
                                    {t(
                                        'vault_date.period_predecessors_empty',
                                        'No tasks found in this table',
                                    )}
                                </span>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </label>
    );
}
