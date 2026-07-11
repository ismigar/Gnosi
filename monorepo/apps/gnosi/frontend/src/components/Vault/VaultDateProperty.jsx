import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar as CalendarIcon, Clock, X } from 'lucide-react';
import { useLocaleSettings } from '../../hooks/useLocaleSettings';

// --- Period helpers (format "YYYY-MM-DD/YYYY-MM-DD") ---
// Shared with VaultTable to show/calculate the number of days without
// duplicating date logic.
export const parsePeriod = (value) => {
    const [start = '', end = ''] = String(value || '').split('/');
    return { start, end };
};

// Inclusive number of days between start and end (1 = same day). null if it cannot be calculated.
export const periodDaysInclusive = (start, end) => {
    if (!start || !end) return null;
    const a = new Date(`${start}T00:00:00`);
    const b = new Date(`${end}T00:00:00`);
    if (isNaN(a.getTime()) || isNaN(b.getTime())) return null;
    const diff = Math.round((b - a) / 86400000) + 1;
    return diff >= 1 ? diff : null;
};

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

export const VaultDateProperty = ({ value, onChange, type = 'date' }) => {
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
            const date = new Date(value);
            if (isNaN(date.getTime())) {
                setInputValue(value); // If it's not valid, we keep the original text (manual entry in progress)
            } else {
                const options = { day: '2-digit', month: '2-digit', year: 'numeric' };
                if (type === 'datetime') {
                    options.hour = '2-digit';
                    options.minute = '2-digit';
                }
                setInputValue(date.toLocaleString(dateLocale || 'ca-ES', options).replace(',', ''));
            }
        } catch (e) {
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
                // Suposem format DD/MM/YYYY o YYYY-MM-DD
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
        const d = new Date(val);
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
            } catch (e) {
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

    // Period handling: two dates (start → end) + number of days.
    // The number of days is derived from the dates; if the user edits it and there is
    // start date, we recalculate the end date (start + N-1 days, inclusive).
    if (type === 'period') {
        const { start, end } = parsePeriod(value);
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
                    placeholder={t('vault_date.days_placeholder', 'dies')}
                    title={t('vault_date.days_count_hint', 'Nombre de dies (recalcula la data de fi)')}
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
                onFocus={(e) => {
                    // Wait a moment so as not to interrupt focus if the user wants to type
                    // but allow it to open if it's an empty click
                    if (!inputValue) triggerPicker();
                }}
                onClick={() => {
                    // If it already has focus and you click again, we open the picker (like Motion)
                    triggerPicker();
                }}
                placeholder={type === 'datetime' ? t('vault_date.format_datetime_placeholder', 'DD/MM/AAAA HH:MM') : t('vault_date.format_date_placeholder', 'DD/MM/AAAA')}
                className="w-full bg-transparent text-sm text-[var(--text-primary)] outline-none hover:bg-[var(--bg-secondary)] rounded px-1 -ml-1 transition-colors"
            />

            <button
                type="button"
                onClick={(e) => {
                    e.stopPropagation();
                    triggerPicker();
                }}
                className="opacity-0 group-hover:opacity-100 p-1 text-[var(--text-tertiary)] hover:text-indigo-500 transition-all focus:opacity-100"
                title={t('vault_date.open_calendar', 'Obrir calendari')}
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
