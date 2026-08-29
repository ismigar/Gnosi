import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tag, X } from 'lucide-react';

import { inputStyle, labelStyle } from './contactFormStyles';

export interface ContactTagsSectionProps {
    readonly onAdd: (tag: string) => void;
    readonly onRemove: (tag: string) => void;
    readonly tags: readonly string[];
}

export function ContactTagsSection({
    onAdd,
    onRemove,
    tags,
}: ContactTagsSectionProps) {
    const { t } = useTranslation();
    const [tagInput, setTagInput] = useState('');
    const addTag = (): void => {
        const trimmed = tagInput.trim();
        if (!trimmed || tags.includes(trimmed)) return;
        onAdd(trimmed);
        setTagInput('');
    };
    return (
        <div>
            <label style={labelStyle}><Tag size={14} /> {t('contacts.tags_label', "Tags")}</label>
            <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                <input
                    type="text"
                    value={tagInput}
                    onChange={(event) => {
                        setTagInput(event.target.value);
                    }}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                            event.preventDefault();
                            addTag();
                        }
                    }}
                    placeholder={t('contacts.tag_placeholder', "Add a tag...")}
                    style={{ ...inputStyle, marginTop: 0, flex: 1 }}
                />
                <button
                    type="button"
                    onClick={addTag}
                    style={{
                        padding: '0 24px',
                        borderRadius: '8px',
                        background: 'rgba(255,255,255,0.04)',
                        color: 'var(--text-primary)',
                        border: '1px solid var(--border-primary)',
                        fontWeight: '600',
                        fontSize: '13px',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                    }}
                >
                    {t('common.btn.add', "Add")}
                </button>
            </div>
            {tags.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '14px' }}>
                    {tags.map((tag, index) => (
                        <span
                            key={index}
                            style={{
                                padding: '4px 10px 4px 12px',
                                background: 'rgba(59,130,246,0.08)',
                                color: 'var(--gnosi-blue)',
                                borderRadius: '6px',
                                fontSize: '12px',
                                fontWeight: '600',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                border: '1px solid rgba(59,130,246,0.1)',
                            }}
                        >
                            {tag}
                            <X
                                size={12}
                                onClick={() => {
                                    onRemove(tag);
                                }}
                                style={{ cursor: 'pointer', opacity: 0.6 }}
                            />
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}
