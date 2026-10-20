import { useRef, useState, type ChangeEvent } from 'react';
import { Calendar as CalendarIcon, Clock, Repeat } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useLocaleSettings } from '../../../../shared/i18n/useLocaleSettings';
import {
    formattedDateInputValue,
    htmlDateValue,
    isSignedDateValue,
    dateInputBoundary,
    dateInputPlaceholder,
} from './dateModel';
import { RecurrenceEditor } from '../../../calendar/components/RecurrenceEditor';
import type { VaultDatePropertyProps } from './types';

type ScalarDateEditorProps = Pick<
    Required<VaultDatePropertyProps>,
    'onChange' | 'type' | 'value'
> & Pick<
    VaultDatePropertyProps,
    'onRruleChange' | 'rruleValue' | 'fieldConfig'
>;

interface InputState {
    readonly dateFormat: string;
    readonly dateLocale: string;
    readonly source: VaultDatePropertyProps['value'];
    readonly type: VaultDatePropertyProps['type'];
    readonly value: string;
}

export function VaultScalarDateEditor({
    fieldConfig,
    onChange,
    onRruleChange,
    rruleValue,
    type,
    value,
}: ScalarDateEditorProps) {
    const { t } = useTranslation();
    const settings = useLocaleSettings();
    const dateLocale = settings.dateLocale;
    const dateFormat = fieldConfig?.format?.dateFormat || settings.dateFormat || 'locale';
    const inputRef = useRef<HTMLInputElement>(null);
    const hiddenInputRef = useRef<HTMLInputElement>(null);
    const [showRecurrence, setShowRecurrence] = useState(false);
    const [inputState, setInputState] = useState<InputState>(() => ({
        dateLocale,
        dateFormat,
        source: value,
        type,
        value: formattedDateInputValue(value, type, dateLocale, dateFormat),
    }));

    if (
        inputState.source !== value
        || inputState.type !== type
        || inputState.dateLocale !== dateLocale
        || inputState.dateFormat !== dateFormat
    ) {
        setInputState({
            dateLocale,
            dateFormat,
            source: value,
            type,
            value: formattedDateInputValue(value, type, dateLocale, dateFormat),
        });
    }

    const handleInputChange = (event: ChangeEvent<HTMLInputElement>): void => {
        const raw = event.target.value;
        setInputState((current) => ({ ...current, value: raw }));
        if (raw === '') { onChange(''); return; }
        const boundary = dateInputBoundary(raw, type, dateLocale, dateFormat);
        if (boundary) onChange(boundary);
    };

    const triggerPicker = (): void => {
        if (isSignedDateValue(value)) return;
        const picker = hiddenInputRef.current;
        if (!picker) return;
        const pickerCandidate: unknown = Reflect.get(picker, 'showPicker');
        if (typeof pickerCandidate !== 'function') {
            picker.click();
            return;
        }
        try {
            pickerCandidate.call(picker);
        } catch {
            picker.focus();
        }
    };

    return (
        <div className="relative flex items-center group w-full">
            <input
                ref={inputRef}
                type="text"
                value={inputState.value}
                onChange={handleInputChange}
                onFocus={() => {
                    if (!inputState.value) triggerPicker();
                }}
                onClick={triggerPicker}
                placeholder={dateInputPlaceholder(dateLocale, dateFormat, type === 'datetime'
                    ? t('vault_date.format_datetime_placeholder', 'DD/MM/YYYY HH:MM')
                    : t('vault_date.format_date_placeholder', 'DD/MM/YYYY'))}
                className="gnosi-input min-w-0 flex-1"
            />
            <button
                type="button"
                onClick={(event) => {
                    event.stopPropagation();
                    triggerPicker();
                }}
                className="opacity-0 group-hover:opacity-100 p-1 text-[var(--text-tertiary)] hover:text-[var(--gnosi-primary)] transition-all focus:opacity-100 shrink-0"
                title={t('vault_date.open_calendar', 'Open calendar')}
            >
                {type === 'datetime'
                    ? <Clock size={12} />
                    : <CalendarIcon size={12} />}
            </button>
            {onRruleChange && (
                <>
                    <button
                        type="button"
                        onClick={(event) => {
                            event.stopPropagation();
                            setShowRecurrence((visible) => !visible);
                        }}
                        className={`p-1 shrink-0 transition-all focus:opacity-100 ${rruleValue
                            ? 'text-[var(--gnosi-primary)] opacity-100'
                            : 'text-[var(--text-tertiary)] opacity-0 group-hover:opacity-100 hover:text-[var(--gnosi-primary)]'}`}
                        title={t('vault_date.toggle_recurrence', 'Repeat')}
                    >
                        <Repeat size={12} />
                    </button>
                    {showRecurrence && (
                        <>
                            <div
                                className="fixed inset-0 z-[55]"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    setShowRecurrence(false);
                                }}
                            />
                            <div
                                className="absolute top-full right-0 mt-1 p-3 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-xl z-[60] min-w-[280px]"
                                onClick={(event) => {
                                    event.stopPropagation();
                                }}
                            >
                                <RecurrenceEditor
                                    value={rruleValue}
                                    onChange={onRruleChange}
                                    inputClass="gnosi-input"
                                    renderUntilDate={(untilDate, update) => <VaultScalarDateEditor
                                        type="date" value={untilDate} fieldConfig={fieldConfig}
                                        onChange={next => { if (typeof next === 'string') update(next); }} />}
                                />
                            </div>
                        </>
                    )}
                </>
            )}
            <input
                ref={hiddenInputRef}
                type={type === 'datetime' ? 'datetime-local' : 'date'}
                value={htmlDateValue(value, type)}
                onChange={(event) => {
                    if (event.target.value) onChange(event.target.value);
                }}
                className="absolute opacity-0 pointer-events-none w-0 h-0"
                tabIndex={-1}
            />
        </div>
    );
}
