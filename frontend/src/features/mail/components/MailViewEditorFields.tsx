import type { CSSProperties, ReactNode } from 'react';
import { Eye, EyeOff, GripVertical, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import {
    ALL_FIELDS,
    defaultOperatorForField,
    defaultValueForField,
    FILTER_FIELDS,
    getOperatorsForField,
    legacyFilterValue,
    legacyTruthyFilterValue,
    type MailViewField,
    type MailViewFilter,
} from './mailViewEditorModel';


interface SectionTitleProps {
    readonly children: ReactNode;
}


export function SectionTitle({ children }: SectionTitleProps) {
    return (
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-2">
            {children}
        </h3>
    );
}


interface PillOption {
    readonly label: string;
    readonly value: string;
}


interface PillsProps {
    readonly onChange: (value: string) => void;
    readonly options: readonly PillOption[];
    readonly value: string;
}


export function Pills({ onChange, options, value }: PillsProps) {
    return (
        <div className="flex items-center gap-1 bg-[var(--bg-secondary)] rounded-lg p-0.5 flex-wrap">
            {options.map((option) => (
                <button
                    className={`px-3 py-1 rounded-md text-[12px] font-semibold transition-all ${
                        value === option.value
                            ? 'bg-[var(--bg-primary)] text-[var(--gnosi-blue)] shadow-sm'
                            : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                    key={option.value}
                    onClick={() => {
                        onChange(option.value);
                    }}
                    type="button"
                >
                    {option.label}
                </button>
            ))}
        </div>
    );
}


interface FieldRowProps {
    readonly field: MailViewField;
    readonly onToggle: (key: string) => void;
}


export function FieldRow({ field, onToggle }: FieldRowProps) {
    const { t } = useTranslation();
    const metadata = ALL_FIELDS.find((candidate) => candidate.key === field.key);
    const {
        attributes,
        isDragging,
        listeners,
        setNodeRef,
        transform,
        transition,
    } = useSortable({ id: field.key });
    const style: CSSProperties = {
        opacity: isDragging ? 0.9 : 1,
        position: 'relative',
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 50 : 1,
    };

    return (
        <div
            className={`flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-[var(--bg-secondary)] group ${isDragging ? 'bg-[var(--bg-secondary)] shadow-md ring-1 ring-[var(--gnosi-primary)]/30' : ''}`}
            ref={setNodeRef}
            style={style}
        >
            <div
                {...attributes}
                {...listeners}
                className="cursor-grab active:cursor-grabbing shrink-0 text-[var(--text-tertiary)] hover:text-[var(--gnosi-primary)]"
            >
                <GripVertical size={13} />
            </div>
            <span className="flex-1 text-[13px] text-[var(--text-primary)]">
                {metadata
                    ? t(metadata.labelKey, metadata.label)
                    : field.key}
            </span>
            <button
                className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                onClick={() => {
                    onToggle(field.key);
                }}
                title={field.visible
                    ? t('mail_view_editor.hide_field', 'Hide')
                    : t('mail_view_editor.show_field', 'Show')}
                type="button"
            >
                {field.visible
                    ? <Eye size={14} />
                    : <EyeOff className="opacity-40" size={14} />}
            </button>
        </div>
    );
}


interface FilterRowProps {
    readonly filter: MailViewFilter;
    readonly index: number;
    readonly onChange: (index: number, updated: MailViewFilter) => void;
    readonly onRemove: (index: number) => void;
}


export function FilterRow({
    filter,
    index,
    onChange,
    onRemove,
}: FilterRowProps) {
    const { t } = useTranslation();
    const fieldMetadata = FILTER_FIELDS.find(
        (candidate) => candidate.key === filter.field,
    );
    const operators = getOperatorsForField(filter.field);

    const handleFieldChange = (newField: string): void => {
        onChange(index, {
            field: newField,
            operator: defaultOperatorForField(newField),
            value: defaultValueForField(newField),
        });
    };

    return (
        <div className="flex items-center gap-2 p-2 bg-[var(--bg-secondary)] rounded-lg">
            <select
                className="text-[12px] bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-md px-2 py-1 text-[var(--text-primary)] flex-1 min-w-0"
                onChange={(event) => {
                    handleFieldChange(event.target.value);
                }}
                value={filter.field}
            >
                {FILTER_FIELDS.map((field) => (
                    <option key={field.key} value={field.key}>
                        {t(field.labelKey, field.label)}
                    </option>
                ))}
            </select>

            <select
                className="text-[12px] bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-md px-2 py-1 text-[var(--text-primary)] shrink-0"
                onChange={(event) => {
                    onChange(index, { ...filter, operator: event.target.value });
                }}
                value={filter.operator}
            >
                {operators.map((operator) => (
                    <option key={operator.value} value={operator.value}>
                        {t(operator.labelKey, operator.label)}
                    </option>
                ))}
            </select>

            {fieldMetadata?.type === 'bool' ? (
                <select
                    className="text-[12px] bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-md px-2 py-1 text-[var(--text-primary)] shrink-0"
                    onChange={(event) => {
                        onChange(index, {
                            ...filter,
                            value: event.target.value === 'true',
                        });
                    }}
                    value={legacyFilterValue(filter.value)}
                >
                    <option value="true">{t('common.yes', 'Yes')}</option>
                    <option value="false">{t('mail_view_editor.bool_no', 'No')}</option>
                </select>
            ) : fieldMetadata?.type === 'date' ? (
                <input
                    className="text-[12px] bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-md px-2 py-1 text-[var(--text-primary)] shrink-0"
                    onChange={(event) => {
                        onChange(index, { ...filter, value: event.target.value });
                    }}
                    type="date"
                    value={legacyTruthyFilterValue(filter.value)}
                />
            ) : (
                <input
                    className="text-[12px] bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-md px-2 py-1 text-[var(--text-primary)] flex-1 min-w-0"
                    onChange={(event) => {
                        onChange(index, { ...filter, value: event.target.value });
                    }}
                    placeholder={t('view_config.value_placeholder', 'Value...')}
                    type="text"
                    value={legacyTruthyFilterValue(filter.value)}
                />
            )}

            <button
                className="text-[var(--text-secondary)] hover:text-red-500 transition-colors shrink-0"
                onClick={() => {
                    onRemove(index);
                }}
                type="button"
            >
                <Trash2 size={13} />
            </button>
        </div>
    );
}
