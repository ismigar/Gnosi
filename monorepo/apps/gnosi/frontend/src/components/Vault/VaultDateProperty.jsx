import React, { useState, useRef, useEffect, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar as CalendarIcon, ChevronDown, Clock, Repeat, Search, X } from 'lucide-react';
import { useLocaleSettings } from '../../hooks/useLocaleSettings';
import { RecurrenceEditor } from './RecurrenceEditor';
import {
    addPeriodDuration,
    addWorkingDuration,
    dependencySuccessorIds,
    formatLocalDateTime,
    latestPredecessorEnd,
    normalizePeriodUnit,
    nextWorkingInstant,
    parsePeriod,
    periodDaysInclusive,
    periodDurationFromBoundaries,
    periodDurationToWorkingDays,
    serializePeriod,
} from '../../utils/projectPlanning';
import { formatVaultDate, isSignedVaultDate, parseVaultDate } from './dateUtils';

// Compatibility re-exports for existing period consumers.
export { parsePeriod, periodDaysInclusive };

// Adds `days` days to an ISO date (YYYY-MM-DD) and returns ISO. '' if the base isn't valid.
export const addDaysISO = (isoDate, days) => {
    const d = parseVaultDate(isoDate);
    if (isNaN(d.getTime())) return '';
    d.setDate(d.getDate() + days);
    return formatVaultDate(d);
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

const PLANNING_CONSTRAINT_OPTIONS = [
    ['ASAP', 'vault_date.period_constraint_option_asap'],
    ['ALAP', 'vault_date.period_constraint_option_alap'],
    ['SNET', 'vault_date.period_constraint_option_snet'],
    ['SNLT', 'vault_date.period_constraint_option_snlt'],
    ['FNET', 'vault_date.period_constraint_option_fnet'],
    ['FNLT', 'vault_date.period_constraint_option_fnlt'],
    ['MSO', 'vault_date.period_constraint_option_mso'],
    ['MFO', 'vault_date.period_constraint_option_mfo'],
];

const PLANNING_CONSTRAINTS_REQUIRING_DATE = new Set([
    'SNET',
    'SNLT',
    'FNET',
    'FNLT',
    'MSO',
    'MFO',
]);

export const VaultDateProperty = ({
    value,
    onChange,
    rruleValue,
    onRruleChange,
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
    const [showRecurrence, setShowRecurrence] = useState(false);
    const [predecessorSearch, setPredecessorSearch] = useState('');
    const [periodDrafts, setPeriodDrafts] = useState({});
    const [predecessorOpen, setPredecessorOpen] = useState(false);
    const [showConstraintHelp, setShowConstraintHelp] = useState(false);
    const [showAllConstraintRules, setShowAllConstraintRules] = useState(false);
    const [showConstraintDateHelp, setShowConstraintDateHelp] = useState(false);
    const [showDurationHelp, setShowDurationHelp] = useState(false);
    const [showPredecessorsHelp, setShowPredecessorsHelp] = useState(false);
    const [showDependencyDetailsHelp, setShowDependencyDetailsHelp] = useState(false);
    const [showDeadlineHelp, setShowDeadlineHelp] = useState(false);
    const predecessorPickerRef = useRef(null);
    const constraintDateInputRef = useRef(null);
    const pendingConstraintDateFocusRef = useRef(false);
    const constraintDateHelpId = useId();
    const constraintDateErrorId = useId();
    // The interface language to format the date shown in the input
    // (previously it was hardcoded to 'ca-ES', ignoring the user's preference).
    const { dateLocale } = useLocaleSettings();

    useEffect(() => {
        const handleOutsideClick = (event) => {
            if (predecessorPickerRef.current && !predecessorPickerRef.current.contains(event.target)) {
                setPredecessorOpen(false);
            }
        };
        document.addEventListener('mousedown', handleOutsideClick);
        return () => document.removeEventListener('mousedown', handleOutsideClick);
    }, []);

    useEffect(() => {
        if (!pendingConstraintDateFocusRef.current || !constraintDateInputRef.current) return;
        constraintDateInputRef.current.focus();
        pendingConstraintDateFocusRef.current = false;
    }, [value]);

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
            const date = parseVaultDate(scalarValue);
            if (isNaN(date.getTime())) {
                setInputValue(String(scalarValue || '')); // Keep manual text without rendering `[object Object]`.
            } else if (date.getFullYear() < 0) {
                setInputValue(formatVaultDate(date, { withTime: type === 'datetime' }));
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
        if (/^-\d{4,}-\d{2}-\d{2}(?:T\d{2}:\d{2})?$/.test(val)) {
            onChange(val);
            return;
        }
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
        const d = parseVaultDate(scalarValue);
        if (isNaN(d.getTime())) return '';
        if (d.getFullYear() < 0) return '';

        const pad = (n) => String(n).padStart(2, '0');
        const datePart = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        if (type === 'datetime') {
            return `${datePart}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
        }
        return datePart;
    };

    const triggerPicker = () => {
        if (isSignedVaultDate(value)) return;
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
        const periodUnit = normalizePeriodUnit(fieldConfig.period_unit);
        // Periods expose their configured duration unit whenever planning is
        // active. Older schemas may persist duration_enabled=false while
        // still rendering the duration control; keeping the control editable
        // ensures entering a duration always recalculates the finish.
        const durationEnabled = planningEnabled;
        const predecessorsEnabled = planningEnabled && fieldConfig.predecessors_enabled !== false;
        const skipNonWorkingDays = fieldConfig.skip_non_working_days !== false;

        if (planningEnabled) {
            const workdayStart = /^\d{2}:\d{2}$/.test(planningSettings.workday_start || '')
                ? planningSettings.workday_start
                : '09:00';
            const asInputDateTime = (raw, isEnd = false) => {
                if (!raw) return '';
                if (String(raw).includes('T')) return formatLocalDateTime(raw);
                if (!/^-?\d{4,}-\d{2}-\d{2}$/.test(String(raw))) return formatLocalDateTime(raw);
                if (!isEnd) return `${raw}T${workdayStart}`;
                const startOfDay = `${raw}T${workdayStart}`;
                return addWorkingDuration(startOfDay, 1, planningSettings, false) || startOfDay;
            };
            const periodInputValue = (raw, isEnd = false) => {
                const dateTime = asInputDateTime(raw, isEnd);
                if (!dateTime) return '';
                if (periodUnit === 'hours') return dateTime;
                if (periodUnit === 'days') return dateTime.slice(0, 10);
                const year = dateTime.match(/^-?\d{4,}/)?.[0];
                return year || '';
            };
            const periodInputToBoundary = (raw) => {
                if (!raw) return '';
                if (periodUnit === 'hours') return raw;
                if (periodUnit === 'days') return `${raw}T${workdayStart}`;
                if (!/^-?\d{1,}$/.test(raw)) return '';
                const number = Number(raw);
                if (!Number.isInteger(number)) return '';
                const year = number < 0
                    ? `-${String(Math.abs(number)).padStart(4, '0')}`
                    : String(number).padStart(4, '0');
                return `${year}-01-01T${workdayStart}`;
            };
            const draftValue = (key, raw, isEnd = false) => (
                Object.prototype.hasOwnProperty.call(periodDrafts, key)
                    ? periodDrafts[key]
                    : periodInputValue(raw, isEnd)
            );
            const updateDraft = (key, raw) => setPeriodDrafts((drafts) => ({ ...drafts, [key]: raw }));
            const commitDraft = (key, commitValue) => {
                const raw = periodDrafts[key];
                if (raw === undefined) return;
                const boundary = periodInputToBoundary(raw);
                if (raw === '' || boundary) commitValue(boundary);
                setPeriodDrafts((drafts) => {
                    const { [key]: _ignored, ...remaining } = drafts;
                    return remaining;
                });
            };
            const periodDateLabel = (kind) => t(
                `vault_date.period_${kind}_${periodUnit}`,
                periodUnit === 'hours'
                    ? ({ start: 'Start date and time', end: 'Finish date and time', actual_start: 'Actual start', actual_end: 'Actual finish', constraint_date: 'Constraint date and time', deadline: 'Deadline date and time' }[kind])
                    : periodUnit === 'days'
                        ? ({ start: 'Start date', end: 'Finish date', actual_start: 'Actual start date', actual_end: 'Actual finish date', constraint_date: 'Constraint date', deadline: 'Deadline date' }[kind])
                        : ({ start: 'Start year', end: 'Finish year', actual_start: 'Actual start year', actual_end: 'Actual finish year', constraint_date: 'Constraint year', deadline: 'Deadline year' }[kind]),
            );
            const displayStart = asInputDateTime(period.start);
            const displayEnd = asInputDateTime(period.end, true);
            const legacyDuration = period.durationDays === null || period.durationDays === undefined
                ? null
                : periodUnit === 'hours'
                    ? period.durationDays * (Number(planningSettings.hours_per_day) || 8)
                    : periodUnit === 'years' ? period.durationDays / 365 : period.durationDays;
            const duration = period.durationValue !== null
                && (!period.durationUnit || period.durationUnit === periodUnit)
                ? period.durationValue
                : periodDurationFromBoundaries(displayStart, displayEnd, periodUnit, planningSettings, skipNonWorkingDays)
                    ?? legacyDuration
                    ?? periodDaysInclusive(period.start, period.end);
            const displayDuration = duration === null || duration === undefined
                ? '' : Number(Number(duration).toFixed(4));
            const durationValueFor = (candidate) => {
                if (candidate.durationValue !== null
                    && (!candidate.durationUnit || candidate.durationUnit === periodUnit)) {
                    return candidate.durationValue;
                }
                if (candidate.durationDays !== null && candidate.durationDays !== undefined) {
                    return periodUnit === 'hours'
                        ? candidate.durationDays * (Number(planningSettings.hours_per_day) || 8)
                        : periodUnit === 'years' ? candidate.durationDays / 365 : candidate.durationDays;
                }
                return null;
            };
            const taskTableId = String(planningSettings.task_table_id || '');
            const getTableId = (note) => String(
                note?.resolved_table_id
                || note?.metadata?.table_id
                || note?.metadata?.database_table_id
                || '',
            );
            const currentNote = (notes || []).find((note) => String(note?.id) === String(noteId));
            const currentTableId = getTableId(currentNote);
            const scopedTableId = currentTableId || taskTableId;
            const scopedNotes = (notes || []).filter((note) => (
                scopedTableId ? getTableId(note) === scopedTableId : false
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
            const visibleCandidates = candidates.filter((candidate) => {
                const title = candidate.title || idToTitle[candidate.id] || candidate.id;
                return String(title).toLocaleLowerCase().includes(predecessorSearch.toLocaleLowerCase());
            });

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
                    && durationValueFor(next) !== null
                ) {
                    next.end = addPeriodDuration(
                        next.start,
                        durationValueFor(next),
                        periodUnit,
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
                if (durationEnabled && duration !== null) {
                    next.durationValue = duration;
                    next.durationUnit = periodUnit;
                    next.durationDays = periodDurationToWorkingDays(duration, periodUnit, planningSettings);
                    next.end = addPeriodDuration(
                        newStart,
                        duration,
                        periodUnit,
                        planningSettings,
                        skipNonWorkingDays,
                    );
                    next.endMode = 'auto';
                } else if (durationEnabled && newStart && displayEnd) {
                    next.durationValue = periodDurationFromBoundaries(
                        newStart,
                        displayEnd,
                        periodUnit,
                        planningSettings,
                        skipNonWorkingDays,
                    );
                    next.durationUnit = periodUnit;
                    next.durationDays = periodDurationToWorkingDays(next.durationValue, periodUnit, planningSettings);
                }
                commit(next);
            };
            const handleEndChange = (newEnd) => {
                const next = { ...period, end: newEnd, endMode: 'manual' };
                if (durationEnabled && displayStart && newEnd) {
                    next.durationValue = periodDurationFromBoundaries(
                        displayStart,
                        newEnd,
                        periodUnit,
                        planningSettings,
                        skipNonWorkingDays,
                    );
                    next.durationUnit = periodUnit;
                    next.durationDays = periodDurationToWorkingDays(next.durationValue, periodUnit, planningSettings);
                }
                commit(next);
            };
            const handleDurationChange = (event) => {
                const raw = event.target.value;
                const nextDuration = raw === '' ? null : Number(raw);
                if (nextDuration !== null && (!Number.isFinite(nextDuration) || nextDuration < 0)) return;
                const next = {
                    ...period,
                    durationValue: nextDuration,
                    durationUnit: periodUnit,
                    durationDays: periodDurationToWorkingDays(nextDuration, periodUnit, planningSettings),
                    endMode: 'auto',
                };
                if (!next.start) fillAutomaticBoundaries(next, true);
                if (next.start && nextDuration !== null) {
                    next.end = addPeriodDuration(
                        asInputDateTime(next.start),
                        nextDuration,
                        periodUnit,
                        planningSettings,
                        skipNonWorkingDays,
                    );
                } else if (nextDuration === null && next.endMode === 'auto') {
                    next.end = '';
                }
                commit(next);
            };
            const handlePredecessorsChange = (predecessorIds) => {
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
                    // Selecting a predecessor always makes the start automatic:
                    // it must follow the latest selected predecessor, even when
                    // the task previously had a manually entered start.
                    next.start = '';
                    next.startMode = 'auto';
                    next.end = '';
                    next.endMode = 'auto';
                    // Persist a duration that was only derived from the old
                    // boundaries before replacing those boundaries from the
                    // predecessor. This keeps the visible task length stable.
                    if (durationEnabled && duration !== null && durationValueFor(next) === null) {
                        next.durationValue = duration;
                        next.durationUnit = periodUnit;
                        next.durationDays = periodDurationToWorkingDays(duration, periodUnit, planningSettings);
                    }
                    fillAutomaticBoundaries(next, true);
                }
                commit(next);
            };
            const togglePredecessor = (predecessorId) => {
                const predecessorIds = period.predecessorIds.includes(predecessorId)
                    ? period.predecessorIds.filter((id) => id !== predecessorId)
                    : [...period.predecessorIds, predecessorId];
                handlePredecessorsChange(predecessorIds);
            };
            const periodInputClass = 'w-full h-9 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-1.5 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--gnosi-primary)]/50 focus:ring-2 focus:ring-[var(--gnosi-primary)]/20';
            const periodSelectClass = `${periodInputClass} cursor-pointer`;
            const selectedPredecessors = period.predecessorIds
                .map((predecessorId) => ({
                    id: predecessorId,
                    title: idToTitle[predecessorId] || predecessorId,
                }));
            const hasPredecessors = predecessorsEnabled && selectedPredecessors.length > 0;
            const selectedConstraintType = period.constraintType || 'ASAP';
            const selectedConstraintOption = PLANNING_CONSTRAINT_OPTIONS.find(
                ([value]) => value === selectedConstraintType,
            ) || PLANNING_CONSTRAINT_OPTIONS[0];
            const constraintRequiresDate = PLANNING_CONSTRAINTS_REQUIRING_DATE.has(
                selectedConstraintType,
            );
            const constraintDateDraft = draftValue('constraintDate', period.constraintDate);
            const constraintDateMissing = constraintRequiresDate
                && String(constraintDateDraft || '').trim() === '';
            const constraintDateDescribedBy = [
                showConstraintDateHelp ? constraintDateHelpId : '',
                constraintDateMissing ? constraintDateErrorId : '',
            ].filter(Boolean).join(' ') || undefined;
            const handleConstraintTypeChange = (event) => {
                const constraintType = event.target.value;
                if (PLANNING_CONSTRAINTS_REQUIRING_DATE.has(constraintType)) {
                    pendingConstraintDateFocusRef.current = true;
                }
                commit({ ...period, constraintType });
            };

            return (
                <div className="grid min-w-[430px] grid-cols-2 gap-2 p-1 text-xs">
                    <label className="flex flex-col gap-1">
                        <span className="flex h-4 items-center text-[10px] font-semibold text-[var(--text-tertiary)]">
                            {periodDateLabel('start')}
                        </span>
                        <input
                            type="text"
                            value={draftValue('start', period.start)}
                            placeholder={periodUnit === 'hours' ? 'YYYY-MM-DDTHH:mm' : periodUnit === 'days' ? 'YYYY-MM-DD' : 'YYYY'}
                            onChange={(event) => updateDraft('start', event.target.value)}
                            onBlur={() => commitDraft('start', handleStartChange)}
                            className={periodInputClass}
                        />
                    </label>
                    <label className="flex flex-col gap-1">
                        <span className="flex h-4 items-center gap-1 text-[10px] font-semibold text-[var(--text-tertiary)]">
                            <span>{t(`vault_date.period_duration_${periodUnit}`, periodUnit === 'hours' ? 'Hours' : periodUnit === 'years' ? 'Years' : 'Days')}</span>
                            <button
                                type="button"
                                aria-expanded={showDurationHelp}
                                aria-label={t('vault_date.period_duration_hint', 'Calculate finish from start date and working-day duration.')}
                                title={t('vault_date.period_duration_hint', 'Calculate finish from start date and working-day duration.')}
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
                                {t('vault_date.period_duration_hint', 'Calculate finish from start date and working-day duration.')}
                            </span>
                        )}
                        <input type="number" min="0" step={periodUnit === 'years' ? '1' : '0.25'} value={displayDuration} onChange={handleDurationChange} className={periodInputClass} />
                    </label>
                    <label className="flex flex-col gap-1">
                        <span className="flex h-4 items-center text-[10px] font-semibold text-[var(--text-tertiary)]">
                            {periodDateLabel('end')}
                        </span>
                        <input
                            type="text"
                            value={draftValue('end', period.end, true)}
                            placeholder={periodUnit === 'hours' ? 'YYYY-MM-DDTHH:mm' : periodUnit === 'days' ? 'YYYY-MM-DD' : 'YYYY'}
                            onChange={(event) => updateDraft('end', event.target.value)}
                            onBlur={() => commitDraft('end', handleEndChange)}
                            className={periodInputClass}
                        />
                    </label>
                    {predecessorsEnabled && (
                        <label className="flex flex-col gap-1">
                        <span className="flex h-4 items-center gap-1 text-[10px] font-semibold text-[var(--text-tertiary)]">
                            <span>{t('vault_date.period_predecessors', "Predecessors")}</span>
                            <button
                                type="button"
                                aria-expanded={showPredecessorsHelp}
                                aria-label={t('vault_date.period_predecessors_hint', 'Select one or more tasks that must finish before this one.')}
                                title={t('vault_date.period_predecessors_hint', 'Select one or more tasks that must finish before this one.')}
                                onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    setShowPredecessorsHelp((open) => !open);
                                }}
                                className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-[var(--border-primary)] text-[9px] font-bold leading-none text-[var(--text-tertiary)] transition-colors hover:border-[var(--gnosi-primary)] hover:text-[var(--gnosi-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--gnosi-primary)]/20"
                            >
                                ?
                            </button>
                        </span>
                        {showPredecessorsHelp && (
                            <span className="text-[11px] text-[var(--text-tertiary)] animate-in fade-in duration-150">
                                {t('vault_date.period_predecessors_hint', 'Select one or more tasks that must finish before this one.')}
                            </span>
                        )}
                            <div ref={predecessorPickerRef} className="relative">
                                <div
                                    role="button"
                                    tabIndex={0}
                                    aria-expanded={predecessorOpen}
                                    onClick={() => setPredecessorOpen((open) => !open)}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter' || event.key === ' ') {
                                            event.preventDefault();
                                            setPredecessorOpen((open) => !open);
                                        }
                                    }}
                                    className="flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-1.5 text-sm text-[var(--text-primary)] transition hover:border-[var(--gnosi-primary)]/50 focus:outline-none focus:ring-2 focus:ring-[var(--gnosi-primary)]/20"
                                    title={t('vault_date.period_predecessors_hint', "Select one or more tasks that must finish first")}
                                >
                                    {selectedPredecessors.length === 0 && <span className="ml-1 text-[var(--text-tertiary)]/60">{t('vault_date.period_predecessors_search', 'Search tasks')}</span>}
                                    {selectedPredecessors.map((candidate) => (
                                        <span key={candidate.id} className="flex max-w-full items-center gap-1.5 rounded-full border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)] shadow-sm">
                                            <span className="truncate">{candidate.title}</span>
                                            <span role="button" tabIndex={0} title={t('common.delete', 'Delete')} className="flex cursor-pointer items-center hover:text-[var(--status-error)]" onClick={(event) => { event.stopPropagation(); togglePredecessor(candidate.id); }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); togglePredecessor(candidate.id); } }}><X size={10} /></span>
                                        </span>
                                    ))}
                                    <ChevronDown size={14} className={`ml-auto shrink-0 text-[var(--text-tertiary)]/60 transition-transform ${predecessorOpen ? 'rotate-180' : ''}`} />
                                </div>
                                {predecessorOpen && (
                                    <div className="absolute left-0 right-0 top-full z-[var(--z-popover)] mt-2 flex max-h-72 flex-col overflow-y-auto rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] p-2 shadow-xl">
                                        <div className="relative mb-2 shrink-0">
                                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]/60" />
                                            <input autoFocus value={predecessorSearch} onChange={(event) => setPredecessorSearch(event.target.value)} onClick={(event) => event.stopPropagation()} placeholder={t('vault_date.period_predecessors_search', 'Search tasks')} aria-label={t('vault_date.period_predecessors_search', 'Search tasks')} className="w-full rounded-lg bg-[var(--bg-secondary)] py-2 pl-9 pr-4 text-sm text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-[var(--gnosi-primary)]/20" />
                                        </div>
                                        <div className="overflow-y-auto">
                                            {visibleCandidates.map((candidate) => (
                                                <div key={candidate.id} role="option" aria-selected={period.predecessorIds.includes(String(candidate.id))} onClick={(event) => { event.stopPropagation(); togglePredecessor(String(candidate.id)); }} className="flex cursor-pointer items-center gap-2 rounded-lg p-2.5 text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--gnosi-primary)]/10 hover:text-[var(--gnosi-primary)]">
                                                    <span className="w-4 text-[var(--gnosi-primary)]">{period.predecessorIds.includes(String(candidate.id)) ? '✓' : ''}</span>
                                                    <span className="truncate">{candidate.title || idToTitle[candidate.id] || candidate.id}</span>
                                                </div>
                                            ))}
                                            {visibleCandidates.length === 0 && <span className="block p-2 text-xs text-[var(--text-tertiary)]">{t('vault_date.period_predecessors_empty', 'No tasks found in this table')}</span>}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </label>
                    )}
                    {hasPredecessors && period.dependencies.length > 0 && (
                        <div className="col-span-2 flex flex-col gap-1">
                            <span className="flex items-center gap-1 text-[10px] font-semibold text-[var(--text-tertiary)]">
                                <span>{t('vault_date.period_dependency_details', 'Dependency details')}</span>
                                <button
                                    type="button"
                                    aria-expanded={showDependencyDetailsHelp}
                                    aria-label={t('vault_date.period_dependency_details_hint', 'Define how this task relates to each predecessor and any delay before it starts.')}
                                    title={t('vault_date.period_dependency_details_hint', 'Define how this task relates to each predecessor and any delay before it starts.')}
                                    onClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        setShowDependencyDetailsHelp((open) => !open);
                                    }}
                                    className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-[var(--border-primary)] text-[9px] font-bold leading-none text-[var(--text-tertiary)] transition-colors hover:border-[var(--gnosi-primary)] hover:text-[var(--gnosi-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--gnosi-primary)]/20"
                                >
                                    ?
                                </button>
                            </span>
                            {showDependencyDetailsHelp && (
                                <span className="text-[11px] text-[var(--text-tertiary)] animate-in fade-in duration-150">
                                    {t('vault_date.period_dependency_details_hint', 'Define how this task relates to each predecessor and any delay before it starts.')}
                                </span>
                            )}
                            <div className="grid grid-cols-[1fr_118px_118px] gap-1 text-[10px] font-semibold text-[var(--text-tertiary)]">
                                <span>{t('vault_date.period_dependency_task', 'Predecessor')}</span>
                                <span>{t('vault_date.period_dependency_relation', 'Relation')}</span>
                                <span>{t('vault_date.period_dependency_lag_short', 'Lag (min)')}</span>
                            </div>
                            {period.dependencies.map((dependency, index) => (
                                <div key={dependency.predecessorId} className="grid grid-cols-[1fr_118px_118px] gap-1">
                                    <span className="truncate rounded bg-[var(--bg-secondary)] px-2 py-1 text-[var(--text-secondary)]">{idToTitle[dependency.predecessorId] || dependency.predecessorId}</span>
                                    <select value={dependency.type || 'FS'} onChange={(event) => commit({ ...period, dependencies: period.dependencies.map((item, itemIndex) => itemIndex === index ? { ...item, type: event.target.value } : item) })} aria-label={t('vault_date.period_dependency_relation', 'Relation')} className="rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1 text-[var(--text-primary)]"><option value="FS">{t('vault_date.period_dependency_fs', 'Finish → start')}</option><option value="SS">{t('vault_date.period_dependency_ss', 'Start → start')}</option><option value="FF">{t('vault_date.period_dependency_ff', 'Finish → finish')}</option><option value="SF">{t('vault_date.period_dependency_sf', 'Start → finish')}</option></select>
                                    <input type="number" step="15" value={dependency.lagMinutes ?? 0} onChange={(event) => commit({ ...period, dependencies: period.dependencies.map((item, itemIndex) => itemIndex === index ? { ...item, lagMinutes: Number(event.target.value) || 0 } : item) })} aria-label={t('vault_date.period_dependency_lag', 'Lag minutes')} className="rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1 text-[var(--text-primary)]" />
                                </div>
                            ))}
                        </div>
                    )}
                    {hasPredecessors && (
                        <div className="col-span-2 grid grid-cols-2 gap-2">
                            <label className="flex flex-col gap-1">
                                <span className="flex h-4 items-center gap-1 text-[10px] font-semibold text-[var(--text-tertiary)]">
                                    <span>{t('vault_date.period_constraint', 'Scheduling rule')}</span>
                                    <button
                                        type="button"
                                        aria-expanded={showConstraintHelp}
                                        aria-label={t('vault_date.period_constraint_help_toggle', 'Show scheduling rule explanations')}
                                        title={t('vault_date.period_constraint_help_toggle', 'Show scheduling rule explanations')}
                                        onClick={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            const nextOpen = !showConstraintHelp;
                                            setShowConstraintHelp(nextOpen);
                                            if (!nextOpen) setShowAllConstraintRules(false);
                                        }}
                                        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-[var(--border-primary)] text-[9px] font-bold leading-none text-[var(--text-tertiary)] transition-colors hover:border-[var(--gnosi-primary)] hover:text-[var(--gnosi-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--gnosi-primary)]/20"
                                    >
                                        ?
                                    </button>
                                </span>
                                <select
                                    value={selectedConstraintType}
                                    onChange={handleConstraintTypeChange}
                                    className={periodSelectClass}
                                >
                                    <option value="ASAP">ASAP</option><option value="ALAP">ALAP</option>
                                    <option value="SNET">SNET</option><option value="SNLT">SNLT</option>
                                    <option value="FNET">FNET</option><option value="FNLT">FNLT</option>
                                    <option value="MSO">MSO</option><option value="MFO">MFO</option>
                                </select>
                            </label>
                            {constraintRequiresDate && (
                                <label className="flex flex-col gap-1">
                                    <span className="flex h-4 items-center gap-1 text-[10px] font-semibold text-[var(--text-tertiary)]">
                                        <span>{periodDateLabel('constraint_date')}</span>
                                        <button
                                            type="button"
                                            aria-expanded={showConstraintDateHelp}
                                            aria-label={t('vault_date.period_constraint_date_hint', 'It is required by the selected rule and changes the automatic schedule; a deadline only raises a warning.')}
                                            title={t('vault_date.period_constraint_date_hint', 'It is required by the selected rule and changes the automatic schedule; a deadline only raises a warning.')}
                                            onClick={(event) => {
                                                event.preventDefault();
                                                event.stopPropagation();
                                                setShowConstraintDateHelp((open) => !open);
                                            }}
                                            className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-[var(--border-primary)] text-[9px] font-bold leading-none text-[var(--text-tertiary)] transition-colors hover:border-[var(--gnosi-primary)] hover:text-[var(--gnosi-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--gnosi-primary)]/20"
                                        >
                                            ?
                                        </button>
                                    </span>
                                    <input
                                        ref={constraintDateInputRef}
                                        type="text"
                                        value={constraintDateDraft}
                                        placeholder={periodUnit === 'hours' ? 'YYYY-MM-DDTHH:mm' : periodUnit === 'days' ? 'YYYY-MM-DD' : 'YYYY'}
                                        aria-invalid={constraintDateMissing}
                                        aria-describedby={constraintDateDescribedBy}
                                        onChange={(event) => updateDraft('constraintDate', event.target.value)}
                                        onBlur={() => commitDraft('constraintDate', (constraintDate) => commit({ ...period, constraintDate }))}
                                        className={`${periodInputClass} ${constraintDateMissing ? 'border-[var(--status-error)] focus:border-[var(--status-error)] focus:ring-[var(--status-error)]/20' : ''}`}
                                    />
                                    {showConstraintDateHelp && (
                                        <span id={constraintDateHelpId} className="text-[11px] text-[var(--text-tertiary)] animate-in fade-in duration-150">
                                            {t('vault_date.period_constraint_date_hint', 'It is required by the selected rule and changes the automatic schedule; a deadline only raises a warning.')}
                                        </span>
                                    )}
                                    {constraintDateMissing && (
                                        <span id={constraintDateErrorId} role="alert" className="text-[11px] font-medium text-[var(--status-error)]">
                                            {t('vault_date.period_constraint_date_required', 'Enter a constraint date for the selected scheduling rule.')}
                                        </span>
                                    )}
                                </label>
                            )}
                            <label className="flex flex-col gap-1">
                                <span className="flex h-4 items-center gap-1 text-[10px] font-semibold text-[var(--text-tertiary)]">
                                    <span>{periodDateLabel('deadline')}</span>
                                    <button
                                        type="button"
                                        aria-expanded={showDeadlineHelp}
                                        aria-label={t('vault_date.period_deadline_hint', 'Sets the desired latest finish. Exceeding it raises a warning but does not move schedule dates.')}
                                        title={t('vault_date.period_deadline_hint', 'Sets the desired latest finish. Exceeding it raises a warning but does not move schedule dates.')}
                                        onClick={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            setShowDeadlineHelp((open) => !open);
                                        }}
                                        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-[var(--border-primary)] text-[9px] font-bold leading-none text-[var(--text-tertiary)] transition-colors hover:border-[var(--gnosi-primary)] hover:text-[var(--gnosi-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--gnosi-primary)]/20"
                                    >
                                        ?
                                    </button>
                                </span>
                                {showDeadlineHelp && (
                                    <span className="text-[11px] text-[var(--text-tertiary)] animate-in fade-in duration-150">
                                        {t('vault_date.period_deadline_hint', 'Sets the desired latest finish. Exceeding it raises a warning but does not move schedule dates.')}
                                    </span>
                                )}
                                <input
                                    type="text"
                                    value={draftValue('deadline', period.deadline)}
                                    placeholder={periodUnit === 'hours' ? 'YYYY-MM-DDTHH:mm' : periodUnit === 'days' ? 'YYYY-MM-DD' : 'YYYY'}
                                    onChange={(event) => updateDraft('deadline', event.target.value)}
                                    onBlur={() => commitDraft('deadline', (deadline) => commit({ ...period, deadline }))}
                                    className={periodInputClass}
                                />
                            </label>
                            {showConstraintHelp && (
                                <div
                                    role="region"
                                    aria-label={t('vault_date.period_constraint_help_title', 'Scheduling rule explanations')}
                                    className="col-span-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)]/70 p-2 text-[11px] text-[var(--text-secondary)] animate-in fade-in duration-150"
                                >
                                    <div className="mb-1 font-semibold text-[var(--text-primary)]">
                                        {t('vault_date.period_constraint_selected_title', 'Selected rule')}
                                    </div>
                                    <p className="mb-2 text-[var(--text-tertiary)]">
                                        {t('vault_date.period_constraint_help_intro', 'Use a constraint date with SNET, SNLT, FNET, FNLT, MSO, or MFO. ASAP and ALAP do not need one.')}
                                    </p>
                                    <dl className="grid gap-1">
                                        <div
                                            aria-current="true"
                                            className="grid grid-cols-[2.5rem_1fr] gap-2 rounded-md border border-[var(--gnosi-primary)]/30 bg-[var(--gnosi-primary)]/10 px-2 py-1.5"
                                        >
                                            <dt className="font-semibold text-[var(--gnosi-primary)]">{selectedConstraintOption[0]}</dt>
                                            <dd>{t(selectedConstraintOption[1])}</dd>
                                        </div>
                                        {showAllConstraintRules && PLANNING_CONSTRAINT_OPTIONS
                                            .filter(([value]) => value !== selectedConstraintType)
                                            .map(([value, descriptionKey]) => (
                                                <div key={value} className="grid grid-cols-[2.5rem_1fr] gap-2 px-2 py-1">
                                                    <dt className="font-semibold text-[var(--text-primary)]">{value}</dt>
                                                    <dd>{t(descriptionKey)}</dd>
                                                </div>
                                            ))}
                                    </dl>
                                    <button
                                        type="button"
                                        aria-expanded={showAllConstraintRules}
                                        onClick={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            setShowAllConstraintRules((showAll) => !showAll);
                                        }}
                                        className="mt-2 inline-flex items-center rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1 font-semibold text-[var(--gnosi-primary)] transition-colors hover:border-[var(--gnosi-primary)]/50 hover:bg-[var(--gnosi-primary)]/5 focus:outline-none focus:ring-2 focus:ring-[var(--gnosi-primary)]/20"
                                    >
                                        {showAllConstraintRules
                                            ? t('vault_date.period_constraint_show_selected', 'Show only the selected rule')
                                            : t('vault_date.period_constraint_show_all', 'Show all rules')}
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
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
                        type="text"
                        value={start || ''}
                        onChange={(e) => onChange(`${e.target.value}/${end || ''}`)}
                        className="w-full bg-transparent hover:bg-[var(--bg-tertiary)] text-xs rounded px-1 transition-colors outline-none cursor-pointer"
                    />
                </div>
                <span className="text-[var(--text-tertiary)]">→</span>
                <div className="flex-1 relative group">
                    <input
                        type="text"
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
                className="opacity-0 group-hover:opacity-100 p-1 text-[var(--text-tertiary)] hover:text-[var(--gnosi-primary)] transition-all focus:opacity-100 shrink-0"
                title={t('vault_date.open_calendar', "Open calendar")}
            >
                {type === 'datetime' ? <Clock size={12} /> : <CalendarIcon size={12} />}
            </button>

            {onRruleChange && (
                <>
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            setShowRecurrence(!showRecurrence);
                        }}
                        className={`p-1 shrink-0 transition-all focus:opacity-100 ${rruleValue ? 'text-[var(--gnosi-primary)] opacity-100' : 'text-[var(--text-tertiary)] opacity-0 group-hover:opacity-100 hover:text-[var(--gnosi-primary)]'}`}
                        title={t('vault_date.toggle_recurrence', "Repeat")}
                    >
                        <Repeat size={12} />
                    </button>
                    {showRecurrence && (
                        <>
                            <div className="fixed inset-0 z-[55]" onClick={(e) => { e.stopPropagation(); setShowRecurrence(false); }} />
                            <div 
                                className="absolute top-full right-0 mt-1 p-3 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-xl z-[60] min-w-[280px]"
                                onClick={e => e.stopPropagation()}
                            >
                                <RecurrenceEditor 
                                    value={rruleValue} 
                                    onChange={onRruleChange} 
                                />
                            </div>
                        </>
                    )}
                </>
            )}

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
