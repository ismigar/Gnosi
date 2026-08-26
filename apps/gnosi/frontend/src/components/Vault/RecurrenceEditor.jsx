import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarPlus } from 'lucide-react';

export const parseRrule = (rrule) => {
    let recurrence = '';
    let selectedDays = [];
    let endType = 'never';
    let endCount = '10';
    let untilDate = '';

    if (rrule) {
        const cleanRrule = rrule.startsWith('RRULE:') ? rrule.slice(6) : rrule;
        const rules = Object.fromEntries(cleanRrule.split(';').map(part => {
            const [k, v] = part.split('=');
            return [k?.toUpperCase(), v];
        }));
        if (rules.FREQ) recurrence = rules.FREQ;
        if (rules.BYDAY) selectedDays = rules.BYDAY.split(',');
        if (rules.COUNT) {
            endType = 'count';
            endCount = rules.COUNT;
        } else if (rules.UNTIL) {
            endType = 'until';
            const u = rules.UNTIL;
            untilDate = u.length >= 8 ? `${u.slice(0, 4)}-${u.slice(4, 6)}-${u.slice(6, 8)}` : '';
        }
    }
    return { recurrence, selectedDays, endType, endCount, untilDate };
};

export const buildRrule = ({ recurrence, selectedDays, endType, endCount, untilDate }) => {
    if (!recurrence) return null;
    let rruleParts = [`FREQ=${recurrence}`];
    if (recurrence === 'WEEKLY' && selectedDays.length > 0) {
        rruleParts.push(`BYDAY=${selectedDays.join(',')}`);
    }
    if (endType === 'count') {
        rruleParts.push(`COUNT=${endCount}`);
    } else if (endType === 'until' && untilDate) {
        const compactUntil = untilDate.replace(/-/g, '') + 'T235959Z';
        rruleParts.push(`UNTIL=${compactUntil}`);
    }
    return rruleParts.join(';');
};

export const RecurrenceEditor = ({ value, onChange, labelClass, inputClass }) => {
    const { t } = useTranslation();
    const parsed = parseRrule(value);

    const [recurrence, setRecurrence] = useState(parsed.recurrence);
    const [selectedDays, setSelectedDays] = useState(parsed.selectedDays);
    const [endType, setEndType] = useState(parsed.endType);
    const [endCount, setEndCount] = useState(parsed.endCount);
    const [untilDate, setUntilDate] = useState(parsed.untilDate);

    useEffect(() => {
        const p = parseRrule(value);
        setRecurrence(p.recurrence);
        setSelectedDays(p.selectedDays);
        setEndType(p.endType);
        setEndCount(p.endCount);
        setUntilDate(p.untilDate);
    }, [value]);

    const notifyChange = (updates) => {
        const next = { recurrence, selectedDays, endType, endCount, untilDate, ...updates };
        onChange(buildRrule(next));
    };

    return (
        <div className="space-y-2">
            <label className={labelClass || "flex items-center gap-1.5 text-[11px] font-bold text-[var(--text-tertiary)] uppercase tracking-tight"}>
                <CalendarPlus size={10} />
                {t('calendar.recurrence', "Recurrence")}
            </label>
            <select
                value={recurrence}
                onChange={(e) => {
                    setRecurrence(e.target.value);
                    notifyChange({ recurrence: e.target.value });
                }}
                className={inputClass || "w-full bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg text-xs p-2 text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"}
            >
                <option value="">{t('calendar.recurrence_none', "Does not repeat")}</option>
                <option value="DAILY">{t('calendar.recurrence_daily', "Every day")}</option>
                <option value="WEEKLY">{t('calendar.recurrence_weekly', "Every week")}</option>
                <option value="MONTHLY">{t('calendar.recurrence_monthly', "Every month")}</option>
                <option value="YEARLY">{t('calendar.recurrence_yearly', "Every year")}</option>
            </select>

            {recurrence === 'WEEKLY' && (
                <div className="flex flex-wrap gap-1 mt-2">
                    {[
                        { value: 'MO', label: t('calendar.day_mo', "Mon") },
                        { value: 'TU', label: t('calendar.day_tu', "Tue") },
                        { value: 'WE', label: t('calendar.day_we', "Wed") },
                        { value: 'TH', label: t('calendar.day_th', "Thu") },
                        { value: 'FR', label: t('calendar.day_fr', "Fri") },
                        { value: 'SA', label: t('calendar.day_sa', "Sat") },
                        { value: 'SU', label: t('calendar.day_su', "Sun") },
                    ].map(day => (
                        <button
                            key={day.value}
                            type="button"
                            onClick={() => {
                                const newDays = selectedDays.includes(day.value)
                                    ? selectedDays.filter(d => d !== day.value)
                                    : [...selectedDays, day.value];
                                setSelectedDays(newDays);
                                notifyChange({ selectedDays: newDays });
                            }}
                            className={`w-7 h-7 text-[10px] font-bold rounded-md border transition-all ${selectedDays.includes(day.value)
                                ? 'bg-[var(--gnosi-primary)] text-white border-[var(--gnosi-primary)]'
                                : 'bg-[var(--bg-primary)] text-[var(--text-secondary)] border-[var(--border-primary)]'
                                }`}
                        >
                            {day.label}
                        </button>
                    ))}
                </div>
            )}

            {recurrence && (
                <div className="mt-2 p-2.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)] space-y-2">
                    <label className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-tight">
                        {t('calendar.ends', "Ends")}
                    </label>

                    <div className="flex flex-col gap-1.5">
                        <label className="flex items-center gap-2 cursor-pointer group">
                            <input
                                type="radio"
                                name="endType"
                                checked={endType === 'never'}
                                onChange={() => {
                                    setEndType('never');
                                    notifyChange({ endType: 'never' });
                                }}
                                className="w-3 h-3 accent-[var(--gnosi-primary)]"
                            />
                            <span className="text-[12px] text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors">
                                {t('calendar.recurrence_end_never', "Never")}
                            </span>
                        </label>

                        <label className="flex items-center gap-2 cursor-pointer group">
                            <input
                                type="radio"
                                name="endType"
                                checked={endType === 'count'}
                                onChange={() => {
                                    setEndType('count');
                                    notifyChange({ endType: 'count' });
                                }}
                                className="w-3 h-3 accent-[var(--gnosi-primary)]"
                            />
                            <div className="flex items-center gap-1.5 flex-1">
                                <span className="text-[12px] text-[var(--text-secondary)]">{t('calendar.recurrence_end_after', "After")}</span>
                                <input
                                    type="number"
                                    min="1"
                                    value={endCount}
                                    onChange={(e) => {
                                        setEndCount(e.target.value);
                                        setEndType('count');
                                        notifyChange({ endType: 'count', endCount: e.target.value });
                                    }}
                                    className="w-12 h-6 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded text-[11px] px-1 text-center focus:outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                                />
                                <span className="text-[12px] text-[var(--text-secondary)]">{t('calendar.recurrence_end_times', "times")}</span>
                            </div>
                        </label>

                        <label className="flex items-center gap-2 cursor-pointer group">
                            <input
                                type="radio"
                                name="endType"
                                checked={endType === 'until'}
                                onChange={() => {
                                    setEndType('until');
                                    notifyChange({ endType: 'until' });
                                }}
                                className="w-3 h-3 accent-[var(--gnosi-primary)]"
                            />
                            <div className="flex items-center gap-1.5 flex-1">
                                <span className="text-[12px] text-[var(--text-secondary)]">{t('calendar.recurrence_end_until', "On the day")}</span>
                                <input
                                    type="date"
                                    value={untilDate}
                                    onChange={(e) => {
                                        setUntilDate(e.target.value);
                                        setEndType('until');
                                        notifyChange({ endType: 'until', untilDate: e.target.value });
                                    }}
                                    className="flex-1 h-6 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded text-[10px] px-1.5 focus:outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                                />
                            </div>
                        </label>
                    </div>
                </div>
            )}
        </div>
    );
};
