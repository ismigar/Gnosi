import React, { useState, useRef, useEffect } from 'react';
import { Calendar as CalendarIcon, Clock, X } from 'lucide-react';
import { useLocaleSettings } from '../../hooks/useLocaleSettings';

// --- Helpers de període (format "YYYY-MM-DD/YYYY-MM-DD") ---
// Compartits amb VaultTable per mostrar/calcular el nombre de dies sense
// duplicar lògica de dates.
export const parsePeriod = (value) => {
    const [start = '', end = ''] = String(value || '').split('/');
    return { start, end };
};

// Nombre de dies inclusiu entre inici i fi (1 = mateix dia). null si no es pot calcular.
export const periodDaysInclusive = (start, end) => {
    if (!start || !end) return null;
    const a = new Date(`${start}T00:00:00`);
    const b = new Date(`${end}T00:00:00`);
    if (isNaN(a.getTime()) || isNaN(b.getTime())) return null;
    const diff = Math.round((b - a) / 86400000) + 1;
    return diff >= 1 ? diff : null;
};

// Suma `days` dies a una data ISO (YYYY-MM-DD) i torna ISO. '' si la base no és vàlida.
export const addDaysISO = (isoDate, days) => {
    const d = new Date(`${isoDate}T00:00:00`);
    if (isNaN(d.getTime())) return '';
    d.setDate(d.getDate() + days);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export const VaultDateProperty = ({ value, onChange, type = 'date' }) => {
    const inputRef = useRef(null);
    const hiddenInputRef = useRef(null);
    const [inputValue, setInputValue] = useState('');
    // L'idioma de la interfície per formatar la data mostrada a l'input
    // (abans estava fixat a 'ca-ES', ignorant la preferència de l'usuari).
    const { dateLocale } = useLocaleSettings();

    // Formateig inicial i sincronització
    useEffect(() => {
        if (!value) {
            setInputValue('');
            return;
        }

        try {
            const date = new Date(value);
            if (isNaN(date.getTime())) {
                setInputValue(value); // Si no és vàlida, mantenim el text original (entrada manual en curs)
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

    // Convertir de local a ISO per desar
    const handleInputChange = (e) => {
        const val = e.target.value;
        setInputValue(val);

        // Intentar parsejar si sembla una data completa
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
                    onChange(date.toISOString());
                }
            }
        }
    };

    // Formateig per al input ocult (format HTML/ISO local)
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

        const date = new Date(val);
        if (!isNaN(date.getTime())) {
            onChange(date.toISOString());
        }
    };

    // Gestió de Períodes: dues dates (inici → fi) + nombre de dies.
    // El nombre de dies es deriva de les dates; si l'usuari l'edita i hi ha
    // data d'inici, recalculem la data de fi (inici + N-1 dies, inclusiu).
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
                    placeholder="dies"
                    title="Nombre de dies (recalcula la data de fi)"
                    className="w-12 shrink-0 bg-transparent hover:bg-[var(--bg-tertiary)] text-xs text-right rounded px-1 transition-colors outline-none disabled:opacity-40 disabled:cursor-not-allowed"
                />
                <span className="text-[10px] text-[var(--text-tertiary)] shrink-0">d</span>
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
                    // Esperar un moment per no interrompre el focus si l'usuari vol escriure
                    // però permetre l'obertura si és un click buit
                    if (!inputValue) triggerPicker();
                }}
                onClick={() => {
                    // Si ja té focus i cliques de nou, obrim el picker (com a Motion)
                    triggerPicker();
                }}
                placeholder={type === 'datetime' ? "DD/MM/AAAA HH:MM" : "DD/MM/AAAA"}
                className="w-full bg-transparent text-sm text-[var(--text-primary)] outline-none hover:bg-[var(--bg-secondary)] rounded px-1 -ml-1 transition-colors"
            />

            <button
                type="button"
                onClick={(e) => {
                    e.stopPropagation();
                    triggerPicker();
                }}
                className="opacity-0 group-hover:opacity-100 p-1 text-[var(--text-tertiary)] hover:text-indigo-500 transition-all focus:opacity-100"
                title="Obrir calendari"
            >
                {type === 'datetime' ? <Clock size={12} /> : <CalendarIcon size={12} />}
            </button>

            {/* Input ocult que realment té el calendari */}
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
