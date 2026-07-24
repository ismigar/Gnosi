import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Tag, Plus, Check, X, Pencil, Trash2 } from 'lucide-react';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';

const PRESET_COLORS = [
    '#ef4444', '#f97316', '#eab308', '#22c55e',
    '#3b82f6', '#8b5cf6', '#ec4899', '#6b7280',
];

function TagColorDot({ color, size = 10 }) {
    return (
        <span
            style={{ backgroundColor: color, width: size, height: size, borderRadius: '50%', display: 'inline-block', flexShrink: 0 }}
        />
    );
}

function TagCreateForm({ onSave, onCancel }) {
    const { t } = useTranslation();
    const [name, setName] = useState('');
    const [color, setColor] = useState(PRESET_COLORS[4]);
    const inputRef = useRef(null);

    useEffect(() => { inputRef.current?.focus(); }, []);

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        onSave({ name: name.trim(), color });
    };

    return (
        <form onSubmit={handleSubmit} style={{ padding: '8px 10px', borderTop: '1px solid var(--border-subtle, #333)' }}>
            <input
                ref={inputRef}
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={t('mail.tag_name_placeholder', "Tag name...")}
                style={{
                    width: '100%', background: 'var(--bg-input, #1a1a1a)', border: '1px solid var(--border-subtle, #444)',
                    borderRadius: 4, color: 'var(--text-primary, #fff)', padding: '4px 8px', fontSize: 13, marginBottom: 6,
                }}
            />
            <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
                {PRESET_COLORS.map(c => (
                    <button
                        key={c} type="button"
                        onClick={() => setColor(c)}
                        style={{
                            width: 18, height: 18, borderRadius: '50%', backgroundColor: c, border: 'none',
                            cursor: 'pointer', outline: color === c ? '2px solid #fff' : 'none', outlineOffset: 1,
                        }}
                    />
                ))}
            </div>
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <button type="button" onClick={onCancel}
                    style={{ padding: '3px 10px', borderRadius: 4, border: '1px solid #444', background: 'transparent', color: '#aaa', cursor: 'pointer', fontSize: 12 }}>
                    {t('common.cancel_short', "Cancel")}
                </button>
                <button type="submit" disabled={!name.trim()}
                    style={{ padding: '3px 10px', borderRadius: 4, border: 'none', background: '#3b82f6', color: '#fff', cursor: 'pointer', fontSize: 12 }}>
                    {t('common.create', "Create")}
                </button>
            </div>
        </form>
    );
}

export default function MailTagPicker({ tags, selectedTagIds = [], onClose, onToggleTag, onCreateTag, onDeleteTag, anchorRect }) {
    const { t } = useTranslation();
    const [showCreate, setShowCreate] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(null);
    const panelRef = useRef(null);

    useEffect(() => {
        const handle = (e) => {
            if (panelRef.current && !panelRef.current.contains(e.target)) onClose();
        };
        document.addEventListener('mousedown', handle);
        return () => document.removeEventListener('mousedown', handle);
    }, [onClose]);

    // Esc closes the picker (dropdown: only Esc, no Enter or trap).
    useModalKeyboard({ isOpen: true, onClose });

    const style = anchorRect ? {
        position: 'fixed',
        top: Math.min(anchorRect.bottom + 4, window.innerHeight - 320),
        left: Math.min(anchorRect.left, window.innerWidth - 220),
        zIndex: 9999,
    } : { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 9999 };

    const panel = (
        <div
            ref={panelRef}
            style={{
                ...style,
                width: 210,
                background: 'var(--bg-surface, #1c1c1c)',
                border: '1px solid var(--border-subtle, #333)',
                borderRadius: 8,
                boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
                overflow: 'hidden',
            }}
        >
            <div style={{ padding: '8px 10px 4px', fontSize: 11, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {t('mail.labels', "Labels")}
            </div>

            <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                {tags.length === 0 && !showCreate && (
                    <div style={{ padding: '8px 10px', color: '#666', fontSize: 13 }}>{t('mail.no_tags', "No tags")}</div>
                )}
                {tags.map(tag => {
                    const isSelected = selectedTagIds.includes(tag.id);
                    return (
                        <div
                            key={tag.id}
                            style={{ display: 'flex', alignItems: 'center', padding: '5px 10px', gap: 8, cursor: 'pointer', borderRadius: 4, margin: '1px 4px' }}
                            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                            onClick={() => onToggleTag(tag.id)}
                        >
                            <TagColorDot color={tag.color} size={10} />
                            <span style={{ flex: 1, fontSize: 13, color: 'var(--text-primary, #eee)' }}>{tag.name}</span>
                            {isSelected && <Check size={13} color="#22c55e" />}
                            {confirmDelete === tag.id ? (
                                <span style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
                                    <button onClick={() => { onDeleteTag(tag.id); setConfirmDelete(null); }}
                                        style={{ background: '#ef4444', border: 'none', borderRadius: 3, color: '#fff', cursor: 'pointer', padding: '1px 5px', fontSize: 11 }}>
                                        {t('common.delete', "Delete")}
                                    </button>
                                    <button onClick={() => setConfirmDelete(null)}
                                        style={{ background: 'transparent', border: 'none', color: '#888', cursor: 'pointer' }}>
                                        <X size={12} />
                                    </button>
                                </span>
                            ) : (
                                <button
                                    onClick={e => { e.stopPropagation(); setConfirmDelete(tag.id); }}
                                    style={{ background: 'transparent', border: 'none', color: '#555', cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center' }}
                                    title={t('mail.delete_tag_tooltip', "Delete tag")}
                                >
                                    <Trash2 size={12} />
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>

            {showCreate ? (
                <TagCreateForm
                    onSave={async (data) => { await onCreateTag(data); setShowCreate(false); }}
                    onCancel={() => setShowCreate(false)}
                />
            ) : (
                <button
                    onClick={() => setShowCreate(true)}
                    style={{
                        width: '100%', padding: '7px 10px', background: 'transparent', border: 'none',
                        borderTop: '1px solid var(--border-subtle, #333)', color: '#888', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 6, fontSize: 13,
                    }}
                >
                    <Plus size={13} /> {t('mail.new_tag', "New tag")}
                </button>
            )}
        </div>
    );

    return createPortal(panel, document.body);
}

export function TagPill({ tag, onRemove }) {
    return (
        <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '1px 7px', borderRadius: 12,
            backgroundColor: tag.color + '22',
            border: `1px solid ${tag.color}55`,
            color: tag.color, fontSize: 11, fontWeight: 500, lineHeight: '16px',
            whiteSpace: 'nowrap',
        }}>
            <TagColorDot color={tag.color} size={6} />
            {tag.name}
            {onRemove && (
                <button
                    onClick={e => { e.stopPropagation(); onRemove(tag.id); }}
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: tag.color, padding: 0, lineHeight: 1, display: 'flex' }}
                >
                    <X size={10} />
                </button>
            )}
        </span>
    );
}
