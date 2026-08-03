import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar as CalendarIcon, Clock, X } from 'lucide-react';
import { useLocaleSettings } from '../../hooks/useLocaleSettings';
import {
    addWorkingDuration,
    dependencySuccessorIds,
    formatLocalDateTime,
    latestPredecessorEnd,
    nextWorkingInstant,
    parsePeriod,
    periodDaysInclusive,
    serializePeriod,
    workingDurationDays,
} from '../../utils/projectPlanning';

// Compatibility re-exports for existing period consumers.
export { parsePeriod, periodDaysInclusive };

// Adds `days` days to an ISO date (YYYY-MM-DD) and returns ISO. '' if the base isn't valid.
export const addDaysISO = (isoDate, days) => {
    const d = new Date(`${isoDate}T00:00:00`);
    if (isNaN(d.getTime())) return '';
    d.setDate(d.getDate() + days);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// Serializes a Date into its LOCAL components ("YYYY-MM-DD" or, for datetime,
// "YYYY-MM-DDTHH:MM"). NEVER `toISOString()`: for a date field in a time zone
// UTC+ local midnight falls on the previous day in UTC (e.g. 15/07 00:00 at
// Madrid → "2024-07-14T22:00:00Z"), so the DAY would shift by one day
// backward; and for datetime, the time would shift by the offset. We always save
// the local time exactly as the user sees it (consistent with the "YYYY-MM-DD" data
// that already exist, and with cellGridUtils, which also avoids toISOString on dates).
const _toLocalDateStr = (date, type) => {
    const pad = (n) => String(n).padStart(2, '0');
    const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    return type === 'datetime' ? `${day}T${pad(date.getHours())}:${pad(date.getMinutes())}` : day;
};

export const VaultDateProperty = ({
    value,
    onChange,
    type = 'date',
    fieldConfig = {},
    fieldName = '',
    noteId = '',
    notes = [],
    idToTitle = {},
    planningSettings = {},
    planningEnabled = false,
}) => {
    const { t } = useTranslation();
    const inputRef = useRef(null);
    const hiddenInputRef = useRef(null);
    const [inputValue, setInputValue] = useState('');
    // The interface language to format the date shown in the input
    // (previously it was hardcoded to 'ca-ES', ignoring the user's preference).
    const { dateLocale } = useLocaleSettings();

    // Initial formatting and syncing
    useEffect(() => {
        if (!value) {
            setInputValue('');
            return;
        }

        try {
            // Some Notion imports stored a date range as `{ start, end }`
            // even when the schema still says `date`. Keep those values
            // editable by treating the start boundary as the scalar date.
            const scalarValue = value && typeof value === 'object'
                ? parsePeriod(value).start
                : value;
            const date = new Date(scalarValue);
            if (isNaN(date.getTime())) {
                setInputValue(String(scalarValue || '')); // Keep manual text without rendering `[object Object]`.
            } else {
                const options = { day: '2-digit', month: '2-digit', year: 'numeric' };
                if (type === 'datetime') {
                    options.hour = '2-digit';
                    options.minute = '2-digit';
                }
                setInputValue(date.toLocaleString(dateLocale || 'en-US', options).replace(',', ''));
            }
        } catch (_error) {
            setInputValue(value);
        }
    }, [value, type, dateLocale]);

    // Convert from local to ISO for saving
    const handleInputChange = (e) => {
        const val = e.target.value;
        setInputValue(val);

        // Try to parse if it looks like a complete date
        if (val.length >= 10) {
            const parts = val.split(/[/\- :]/);
            if (parts.length >= 3) {
                let d, m, y, h = 0, min = 0;
                // Accept either DD/MM/YYYY or YYYY-MM-DD.
                if (parts[0].length === 4) { // YYYY-MM-DD
                    [y, m, d] = parts;
                } else { // DD/MM/YYYY
                    [d, m, y] = parts;
                }

                if (type === 'datetime' && parts.length >= 5) {
                    h = parts[3];
                    min = parts[4];
                }

                const date = new Date(y, m - 1, d, h, min);
                if (!isNaN(date.getTime())) {
                    onChange(_toLocalDateStr(date, type));
                }
            }
        }
    };

    // Formatting for the hidden input (local HTML/ISO format)
    const toHTMLValue = (val) => {
        if (!val) return '';
        const scalarValue = val && typeof val === 'object'
            ? parsePeriod(val).start
            : val;
        const d = new Date(scalarValue);
        if (isNaN(d.getTime())) return '';

        const pad = (n) => String(n).padStart(2, '0');
        const datePart = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        if (type === 'datetime') {
            return `${datePart}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
        }
        return datePart;
    };

    const triggerPicker = () => {
        if (hiddenInputRef.current) {
            try {
                if (hiddenInputRef.current.showPicker) {
                    hiddenInputRef.current.showPicker();
                } else {
                    hiddenInputRef.current.click();
                }
            } catch (_error) {
                hiddenInputRef.current.focus();
            }
        }
    };

    const handlePickerChange = (e) => {
        const val = e.target.value;
        if (!val) return;

        // The value of an <input type="date|datetime-local"> is ALREADY the local time
        // in canonical format ("YYYY-MM-DD" or "YYYY-MM-DDTHH:MM"): we save it as-is
        // which. Passing it through `new Date(val).toISOString()` would convert it to UTC
        // and it would shift the day/time (see _toLocalDateStr).
        onChange(val);
    };

    // Enhanced project-planning periods store start, finish, duration, and
    // predecessors in one value. The legacy range editor remains available
    // while the built-in plugin is disabled.
    if (type === 'period') {
        const period = parsePeriod(value);
        const durationEnabled = planningEnabled && fieldConfig.duration_enabled !== false;
        const predecessorsEnabled = planningEnabled && fieldConfig.predecessors_enabled !== false;
        const skipNonWorkingDays = fieldConfig.skip_non_working_days !== false;

        if (planningEnabled) {
            const workdayStart = /^\d{2}:\d{2}$/.test(planningSettings.workday_start || '')
                ? planningSettings.workday_start
                : '09:00';
            const asInputDateTime = (raw, isEnd = false) => {
                if (!raw) return '';
                if (String(raw).includes('T')) return formatLocalDateTime(raw);
                if (!/^\d{4}-\d{2}-\d{2}$/.test(String(raw))) return formatLocalDateTime(raw);
                if (!isEnd) return `${raw}T${workdayStart}`;
                const startOfDay = `${raw}T${workdayStart}`;
                return addWorkingDuration(startOfDay, 1, planningSettings, false) || startOfDay;
            };
            const displayStart = asInputDateTime(period.start);
            const displayEnd = asInputDateTime(period.end, true);
            const derivedDuration = workingDurationDays(
                displayStart,
                displayEnd,
                planningSettings,
                skipNonWorkingDays,
            );
            const duration = period.durationDays
                ?? derivedDuration
                ?? periodDaysInclusive(period.start, period.end);
            const taskTableId = String(planningSettings.task_table_id || '');
            const getTableId = (note) => String(
                note?.resolved_table_id
                || note?.metadata?.table_id
                || note?.metadata?.database_table_id
                || '',
            );
            const scopedNotes = (notes || []).filter((note) => (
                !taskTableId || getTableId(note) === taskTableId
            ));
            const periodKeys = [
                fieldName,
                fieldConfig.id,
                ...(Array.isArray(fieldConfig.aliases) ? fieldConfig.aliases : []),
            ].filter(Boolean);
            const getPeriodValue = (note) => {
                const metadata = note?.metadata || {};
                const key = periodKeys.find((candidate) => (
                    Object.prototype.hasOwnProperty.call(metadata, candidate)
                ));
                return key ? metadata[key] : '';
            };
            const getPredecessorIds = (note) => {
                const parsed = parsePeriod(getPeriodValue(note));
                return parsed.version >= 2
                    ? parsed.predecessorIds
                    : (note?.metadata?.predecessor_ids || []);
            };
            const blockedCandidateIds = dependencySuccessorIds(
                noteId,
                scopedNotes,
                getPredecessorIds,
            );
            const candidates = scopedNotes.filter((note) => (
                !blockedCandidateIds.has(String(note.id))
            ));

            const fillAutomaticBoundaries = (next, recalculateStart = false) => {
                if (predecessorsEnabled && next.predecessorIds.length > 0
                    && (!next.start || (next.startMode === 'auto' && recalculateStart))) {
                    const predecessorEnd = latestPredecessorEnd(
                        next.predecessorIds,
                        scopedNotes,
                        getPeriodValue,
                    );
                    next.start = predecessorEnd
                        ? nextWorkingInstant(
                            predecessorEnd,
                            planningSettings,
                            skipNonWorkingDays,
                        )
                        : next.start;
                    if (next.start) next.startMode = 'auto';
                }
                if (
                    durationEnabled
                    && next.start
                    && next.durationDays !== null
                    && (!next.end || next.endMode === 'auto')
                ) {
                    next.end = addWorkingDuration(
                        next.start,
                        next.durationDays,
                        planningSettings,
                        skipNonWorkingDays,
                    );
                    if (next.end) next.endMode = 'auto';
                }
                return next;
            };

            const commit = (next) => onChange(serializePeriod(next));
            const handleStartChange = (newStart) => {
                const next = { ...period, start: newStart, startMode: 'manual' };
                if (durationEnabled && next.endMode === 'auto' && duration !== null) {
                    next.durationDays = duration;
                    next.end = addWorkingDuration(
                        newStart,
                        duration,
                        planningSettings,
                        skipNonWorkingDays,
                    );
                } else if (durationEnabled && newStart && displayEnd) {
                    next.durationDays = workingDurationDays(
                        newStart,
                        displayEnd,
                        planningSettings,
                        skipNonWorkingDays,
                    );
                }
                commit(next);
            };
            const handleEndChange = (newEnd) => {
                const next = { ...period, end: newEnd, endMode: 'manual' };
                if (durationEnabled && displayStart && newEnd) {
                    next.durationDays = workingDurationDays(
                        displayStart,
                        newEnd,
                        planningSettings,
                        skipNonWorkingDays,
                    );
                }
                commit(next);
            };
            const handleDurationChange = (event) => {
                const raw = event.target.value;
                const nextDuration = raw === '' ? null : Number(raw);
                if (nextDuration !== null && (!Number.isFinite(nextDuration) || nextDuration < 0)) return;
                const next = {
                    ...period,
                    durationDays: nextDuration,
                    endMode: 'auto',
                };
                if (!next.start) fillAutomaticBoundaries(next, true);
                if (next.start && nextDuration !== null) {
                    next.end = addWorkingDuration(
                        asInputDateTime(next.start),
                        nextDuration,
                        planningSettings,
                        skipNonWorkingDays,
                    );
                } else if (nextDuration === null && next.endMode === 'auto') {
                    next.end = '';
                }
                commit(next);
            };
            const handlePredecessorsChange = (event) => {
                const predecessorIds = Array.from(
                    event.target.selectedOptions,
                    (option) => option.value,
                );
                const next = {
                    ...period,
                    predecessorIds,
                    dependencies: predecessorIds.map((predecessorId) => (
                        period.dependencies.find((dependency) => dependency.predecessorId === predecessorId)
                        || { predecessorId, type: 'FS', lagMinutes: 0 }
                    )),
                };
                if (predecessorIds.length === 0 && next.startMode === 'auto') {
                    next.start = '';
                    if (next.endMode === 'auto') next.end = '';
                } else {
                    fillAutomaticBoundaries(next, true);
                }
                commit(next);
            };

            return (
                <div className="grid min-w-[430px] grid-cols-2 gap-2 p-1 text-xs">
                    <label className="flex flex-col gap-1">
                        <span className="text-[10px] font-semibold text-[var(--text-tertiary)]">
                            {t('vault_date.period_start', "Start date and time")}
                        </span>
                        <input
                            type="datetime-local"
                            value={displayStart}
                            onChange={(event) => handleStartChange(event.target.value)}
                            className="rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1 text-[var(--text-primary)]"
                        />
                    </label>
                    {['SNET', 'SNLT', 'FNET', 'FNLT', 'MSO', 'MFO'].includes(period.constraintType) && (
                        <label className="flex flex-col gap-1">
                            <span className="text-[10px] font-semibold text-[var(--text-tertiary)]">
                                {t('vault_date.period_constraint_date', 'Constraint date')}
                            </span>
                            <input
                                type="datetime-local"
                                value={asInputDateTime(period.constraintDate)}
                                onChange={(event) => commit({ ...period, constraintDate: event.target.value })}
                                className="rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1 text-[var(--text-primary)]"
                            />
                        </label>
                    )}
                    <label className="flex flex-col gap-1">
                        <span className="text-[10px] font-semibold text-[var(--text-tertiary)]">
                            {t('vault_date.period_complete', 'Complete (%)')}
                        </span>
                        <input type="number" min="0" max="100" value={period.percentComplete} onChange={(event) => commit({ ...period, percentComplete: Math.min(100, Math.max(0, Number(event.target.value) || 0)) })} className="rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1 text-[var(--text-primary)]" />
                    </label>
                    <label className="flex flex-col gap-1">
                        <span className="text-[10px] font-semibold text-[var(--text-tertiary)]">
                            {t('vault_date.period_actual_start', 'Actual start')}
                        </span>
                        <input type="datetime-local" value={asInputDateTime(period.actualStart)} onChange={(event) => commit({ ...period, actualStart: event.target.value })} className="rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1 text-[var(--text-primary)]" />
                    </label>
                    <label className="flex flex-col gap-1">
                        <span className="text-[10px] font-semibold text-[var(--text-tertiary)]">
                            {t('vault_date.period_actual_end', 'Actual finish')}
                        </span>
                        <input type="datetime-local" value={asInputDateTime(period.actualEnd)} onChange={(event) => commit({ ...period, actualEnd: event.target.value, percentComplete: event.target.value ? 100 : period.percentComplete })} className="rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1 text-[var(--text-primary)]" />
                    </label>
                    <label className="flex flex-col gap-1">
                        <span className="text-[10px] font-semibold text-[var(--text-tertiary)]">
                            {t('vault_date.period_end', "Finish date and time")}
                        </span>
                        <input
                            type="datetime-local"
                            value={displayEnd}
                            onChange={(event) => handleEndChange(event.target.value)}
                            className="rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1 text-[var(--text-primary)]"
                        />
                    </label>
                    {durationEnabled && (
                        <label className="flex flex-col gap-1">
                            <span className="text-[10px] font-semibold text-[var(--text-tertiary)]">
                                {t('vault_date.period_duration', "Working days")}
                            </span>
                            <input
                                type="number"
                                min="0"
                                step="0.25"
                                value={duration ?? ''}
                                onChange={handleDurationChange}
                                className="rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1 text-[var(--text-primary)]"
                            />
                        </label>
                    )}
                    {predecessorsEnabled && (
                        <label className="flex flex-col gap-1">
                            <span className="text-[10px] font-semibold text-[var(--text-tertiary)]">
                                {t('vault_date.period_predecessors', "Predecessors")}
                            </span>
                            <select
                                multiple
                                size={Math.min(4, Math.max(2, candidates.length))}
                                value={period.predecessorIds}
                                onChange={handlePredecessorsChange}
                                className="rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1 text-[var(--text-primary)]"
                                title={t('vault_date.period_predecessors_hint', "Select one or more tasks that must finish first")}
                            >
                                {candidates.map((candidate) => (
                                    <option key={candidate.id} value={candidate.id}>
                                        {candidate.title || idToTitle[candidate.id] || candidate.id}
                                    </option>
                                ))}
                            </select>
                        </label>
                    )}
                    {predecessorsEnabled && period.dependencies.length > 0 && (
                        <div className="col-span-2 flex flex-col gap-1">
                            <span className="text-[10px] font-semibold text-[var(--text-tertiary)]">
                                {t('vault_date.period_dependency_details', 'Dependency details')}
                            </span>
                            {period.dependencies.map((dependency, index) => (
                                <div key={dependency.predecessorId} className="grid grid-cols-[1fr_76px_96px] gap-1">
                                    <span className="truncate rounded bg-[var(--bg-secondary)] px-2 py-1 text-[var(--text-secondary)]">{idToTitle[dependency.predecessorId] || dependency.predecessorId}</span>
                                    <select value={dependency.type || 'FS'} onChange={(event) => commit({ ...period, dependencies: period.dependencies.map((item, itemIndex) => itemIndex === index ? { ...item, type: event.target.value } : item) })} className="rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1 text-[var(--text-primary)]"><option value="FS">FS</option><option value="SS">SS</option><option value="FF">FF</option><option value="SF">SF</option></select>
                                    <input type="number" step="15" value={dependency.lagMinutes ?? 0} onChange={(event) => commit({ ...period, dependencies: period.dependencies.map((item, itemIndex) => itemIndex === index ? { ...item, lagMinutes: Number(event.target.value) || 0 } : item) })} aria-label={t('vault_date.period_dependency_lag', 'Lag minutes')} className="rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1 text-[var(--text-primary)]" />
                                </div>
                            ))}
                        </div>
                    )}
                    <label className="flex flex-col gap-1">
                        <span className="text-[10px] font-semibold text-[var(--text-tertiary)]">
                            {t('vault_date.period_constraint', 'Constraint')}
                        </span>
                        <select
                            value={period.constraintType || 'ASAP'}
                            onChange={(event) => commit({ ...period, constraintType: event.target.value })}
                            className="rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1 text-[var(--text-primary)]"
                        >
                            <option value="ASAP">ASAP</option><option value="ALAP">ALAP</option>
                            <option value="SNET">SNET</option><option value="SNLT">SNLT</option>
                            <option value="FNET">FNET</option><option value="FNLT">FNLT</option>
                            <option value="MSO">MSO</option><option value="MFO">MFO</option>
                        </select>
                    </label>
                    <label className="flex flex-col gap-1">
                        <span className="text-[10px] font-semibold text-[var(--text-tertiary)]">
                            {t('vault_date.period_deadline', 'Deadline')}
                        </span>
                        <input
                            type="datetime-local"
                            value={asInputDateTime(period.deadline)}
                            onChange={(event) => commit({ ...period, deadline: event.target.value })}
                            className="rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1 text-[var(--text-primary)]"
                        />
                    </label>
                </div>
            );
        }

        const { start, end } = period;
        const days = periodDaysInclusive(start, end);
        const handleDaysChange = (e) => {
            const n = parseInt(e.target.value, 10);
            if (!start || !Number.isFinite(n) || n < 1) return;
            onChange(`${start}/${addDaysISO(start, n - 1)}`);
        };
        return (
            <div className="flex items-center gap-1 w-full">
                <div className="flex-1 relative group">
                    <input
                        type="date"
                        value={start || ''}
                        onChange={(e) => onChange(`${e.target.value}/${end || ''}`)}
                        className="w-full bg-transparent hover:bg-[var(--bg-tertiary)] text-xs rounded px-1 transition-colors outline-none cursor-pointer"
                    />
                </div>
                <span className="text-[var(--text-tertiary)]">→</span>
                <div className="flex-1 relative group">
                    <input
                        type="date"
                        value={end || ''}
                        onChange={(e) => onChange(`${start || ''}/${e.target.value}`)}
                        className="w-full bg-transparent hover:bg-[var(--bg-tertiary)] text-xs rounded px-1 transition-colors outline-none cursor-pointer"
                    />
                </div>
                <input
                    type="number"
                    min="1"
                    value={days ?? ''}
                    onChange={handleDaysChange}
                    disabled={!start}
                    placeholder={t('vault_date.days_placeholder', "days")}
                    title={t('vault_date.days_count_hint', "Number of days (recalculates the end date)")}
                    className="w-12 shrink-0 bg-transparent hover:bg-[var(--bg-tertiary)] text-xs text-right rounded px-1 transition-colors outline-none disabled:opacity-40 disabled:cursor-not-allowed"
                />
                <span className="text-[10px] text-[var(--text-tertiary)] shrink-0">{t('vault_date.days_unit', 'd')}</span>
            </div>
        );
    }

    return (
        <div className="relative flex items-center group w-full">
            <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={handleInputChange}
                onFocus={() => {
                    // Wait a moment so as not to interrupt focus if the user wants to type
                    // but allow it to open if it's an empty click
                    if (!inputValue) triggerPicker();
                }}
                onClick={() => {
                    // If it already has focus and you click again, we open the picker (like Motion)
                    triggerPicker();
                }}
                placeholder={type === 'datetime' ? t('vault_date.format_datetime_placeholder', "DD/MM/YYYY HH:MM") : t('vault_date.format_date_placeholder', "DD/MM/YYYY")}
                className="w-full bg-transparent text-sm text-[var(--text-primary)] outline-none hover:bg-[var(--bg-secondary)] rounded px-1 -ml-1 transition-colors"
            />

            <button
                type="button"
                onClick={(e) => {
                    e.stopPropagation();
                    triggerPicker();
                }}
                className="opacity-0 group-hover:opacity-100 p-1 text-[var(--text-tertiary)] hover:text-indigo-500 transition-all focus:opacity-100"
                title={t('vault_date.open_calendar', "Open calendar")}
            >
                {type === 'datetime' ? <Clock size={12} /> : <CalendarIcon size={12} />}
            </button>

            {/* Hidden input that actually holds the calendar */}
            <input
                ref={hiddenInputRef}
                type={type === 'datetime' ? "datetime-local" : "date"}
                value={toHTMLValue(value)}
                onChange={handlePickerChange}
                className="absolute opacity-0 pointer-events-none w-0 h-0"
                tabIndex="-1"
            />
        </div>
    );
};
