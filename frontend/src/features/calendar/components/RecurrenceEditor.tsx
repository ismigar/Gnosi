import { useState } from 'react';
import { CalendarPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
    buildRrule,
    parseRrule,
    toggleRecurrenceDay,
    type RecurrenceEndType,
    type RecurrenceState,
} from './recurrence-editor/recurrenceModel';


export interface RecurrenceEditorProps {
    readonly inputClass?: string;
    readonly labelClass?: string;
    readonly onChange: (value: string | null) => void;
    readonly value?: string | null;
}


interface RecurrenceEditorContentProps extends RecurrenceEditorProps {
    readonly initialState: RecurrenceState;
}


const defaultLabelClass = 'flex items-center gap-1.5 text-[11px] font-bold text-[var(--text-tertiary)] uppercase tracking-tight';
const defaultInputClass = 'w-full bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg text-xs p-2 text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]';


export function RecurrenceEditor(props: RecurrenceEditorProps) {
    const syncKey = props.value ?? '';
    return <RecurrenceEditorContent
        {...props}
        initialState={parseRrule(props.value)}
        key={syncKey}
    />;
}


function RecurrenceEditorContent({
    initialState,
    inputClass,
    labelClass,
    onChange,
}: RecurrenceEditorContentProps) {
    const { t } = useTranslation();
    const [state, setState] = useState(initialState);
    const updateState = (updates: Partial<RecurrenceState>): void => {
        const next = { ...state, ...updates };
        setState(next);
        onChange(buildRrule(next));
    };
    const days = [
        ['MO', t('calendar.day_mo', 'Mon')],
        ['TU', t('calendar.day_tu', 'Tue')],
        ['WE', t('calendar.day_we', 'Wed')],
        ['TH', t('calendar.day_th', 'Thu')],
        ['FR', t('calendar.day_fr', 'Fri')],
        ['SA', t('calendar.day_sa', 'Sat')],
        ['SU', t('calendar.day_su', 'Sun')],
    ] as const;
    const chooseEndType = (endType: RecurrenceEndType): void => {
        updateState({ endType });
    };

    return <div className="space-y-2">
        <label className={labelClass || defaultLabelClass}>
            <CalendarPlus size={10} />
            {t('calendar.recurrence', 'Recurrence')}
        </label>
        <select
            className={inputClass || defaultInputClass}
            onChange={(event) => { updateState({ recurrence: event.target.value }); }}
            value={state.recurrence}
        >
            <option value="">{t('calendar.recurrence_none', 'Does not repeat')}</option>
            <option value="DAILY">{t('calendar.recurrence_daily', 'Every day')}</option>
            <option value="WEEKLY">{t('calendar.recurrence_weekly', 'Every week')}</option>
            <option value="MONTHLY">{t('calendar.recurrence_monthly', 'Every month')}</option>
            <option value="YEARLY">{t('calendar.recurrence_yearly', 'Every year')}</option>
        </select>

        {state.recurrence === 'WEEKLY' ? <div className="mt-2 flex flex-wrap gap-1">
            {days.map(([value, label]) => <button
                className={`h-7 w-7 rounded-md border text-[10px] font-bold transition-all ${state.selectedDays.includes(value)
                    ? 'border-[var(--gnosi-primary)] bg-[var(--gnosi-primary)] text-white'
                    : 'border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-secondary)]'}`}
                key={value}
                onClick={() => {
                    updateState({ selectedDays: toggleRecurrenceDay(state.selectedDays, value) });
                }}
                type="button"
            >{label}</button>)}
        </div> : null}

        {state.recurrence ? <div className="mt-2 space-y-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-tertiary)] p-2.5">
            <label className="text-[10px] font-bold uppercase tracking-tight text-[var(--text-tertiary)]">
                {t('calendar.ends', 'Ends')}
            </label>
            <div className="flex flex-col gap-1.5">
                <label className="group flex cursor-pointer items-center gap-2">
                    <input
                        checked={state.endType === 'never'}
                        className="h-3 w-3 accent-[var(--gnosi-primary)]"
                        name="endType"
                        onChange={() => { chooseEndType('never'); }}
                        type="radio"
                    />
                    <span className="text-[12px] text-[var(--text-secondary)] transition-colors group-hover:text-[var(--text-primary)]">
                        {t('calendar.recurrence_end_never', 'Never')}
                    </span>
                </label>
                <label className="group flex cursor-pointer items-center gap-2">
                    <input
                        checked={state.endType === 'count'}
                        className="h-3 w-3 accent-[var(--gnosi-primary)]"
                        name="endType"
                        onChange={() => { chooseEndType('count'); }}
                        type="radio"
                    />
                    <div className="flex flex-1 items-center gap-1.5">
                        <span className="text-[12px] text-[var(--text-secondary)]">{t('calendar.recurrence_end_after', 'After')}</span>
                        <input
                            className="h-6 w-12 rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-1 text-center text-[11px] focus:outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                            min="1"
                            onChange={(event) => {
                                updateState({ endCount: event.target.value, endType: 'count' });
                            }}
                            type="number"
                            value={state.endCount}
                        />
                        <span className="text-[12px] text-[var(--text-secondary)]">{t('calendar.recurrence_end_times', 'times')}</span>
                    </div>
                </label>
                <label className="group flex cursor-pointer items-center gap-2">
                    <input
                        checked={state.endType === 'until'}
                        className="h-3 w-3 accent-[var(--gnosi-primary)]"
                        name="endType"
                        onChange={() => { chooseEndType('until'); }}
                        type="radio"
                    />
                    <div className="flex flex-1 items-center gap-1.5">
                        <span className="text-[12px] text-[var(--text-secondary)]">{t('calendar.recurrence_end_until', 'On the day')}</span>
                        <input
                            className="h-6 flex-1 rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-1.5 text-[10px] focus:outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                            onChange={(event) => {
                                updateState({ endType: 'until', untilDate: event.target.value });
                            }}
                            type="date"
                            value={state.untilDate}
                        />
                    </div>
                </label>
            </div>
        </div> : null}
    </div>;
}
