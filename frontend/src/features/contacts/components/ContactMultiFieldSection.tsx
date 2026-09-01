import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';

import {
    type ContactFieldKey,
    type ContactFieldItem,
    type ContactMultiField,
} from './contactFormModel';
import { inputStyle, sectionTitleStyle, selectStyle } from './contactFormStyles';

interface FieldLabelOption {
    readonly label: string;
    readonly value: string;
}

export interface ContactMultiFieldSectionProps {
    readonly field: ContactMultiField;
    readonly icon: ReactNode;
    readonly inputType?: string;
    readonly items: readonly ContactFieldItem[];
    readonly labels: readonly FieldLabelOption[];
    readonly onAdd: (field: ContactMultiField) => void;
    readonly onChange: (
        field: ContactMultiField,
        index: number,
        key: ContactFieldKey,
        value: string,
    ) => void;
    readonly onRemove: (field: ContactMultiField, index: number) => void;
    readonly placeholder: string;
    readonly title: string;
}

export function ContactMultiFieldSection({
    field,
    icon,
    inputType = 'text',
    items,
    labels,
    onAdd,
    onChange,
    onRemove,
    placeholder,
    title,
}: ContactMultiFieldSectionProps) {
    const { t } = useTranslation();
    return (
        <div style={{ background: 'rgba(255,255,255,0.01)', padding: '20px', borderRadius: '12px', border: '1px solid var(--border-primary)' }}>
            <div style={sectionTitleStyle}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {icon} {title}
                </span>
                <button
                    type="button"
                    onClick={() => {
                        onAdd(field);
                    }}
                    style={{
                        padding: '4px 8px',
                        background: 'rgba(59,130,246,0.1)',
                        color: 'var(--gnosi-blue)',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '11px',
                        fontWeight: '700',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                    }}
                >
                    <Plus size={12} /> {t('common.btn.add', "Add")}
                </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {items.map((item, index) => (
                    <div key={index} style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
                        <select
                            value={item.label}
                            onChange={(event) => {
                                onChange(field, index, 'label', event.target.value);
                            }}
                            style={{ ...selectStyle, marginTop: 0 }}
                        >
                            {labels.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                        {item.label === 'other' && (
                            <input
                                type="text"
                                value={item.customLabel || ''}
                                onChange={(event) => {
                                    onChange(field, index, 'customLabel', event.target.value);
                                }}
                                placeholder={t('contacts.label_custom_placeholder', "Specify...")}
                                style={{ ...inputStyle, marginTop: 0, width: '120px', flex: 'none' }}
                            />
                        )}
                        <input
                            type={inputType}
                            value={item.value}
                            onChange={(event) => {
                                onChange(field, index, 'value', event.target.value);
                            }}
                            placeholder={placeholder}
                            style={{ ...inputStyle, marginTop: 0, flex: 1, minWidth: '150px' }}
                            required={index === 0 && field === 'emails'}
                        />
                        {items.length > 1 && (
                            <button
                                type="button"
                                onClick={() => {
                                    onRemove(field, index);
                                }}
                                style={{
                                    padding: '8px',
                                    background: 'transparent',
                                    color: 'var(--text-tertiary)',
                                    border: 'none',
                                    cursor: 'pointer',
                                    opacity: 0.6,
                                }}
                            >
                                <Trash2 size={16} />
                            </button>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
