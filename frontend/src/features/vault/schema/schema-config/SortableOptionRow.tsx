import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Trash2 } from 'lucide-react';
import { OPTION_COLOR_PALETTE, optionColorHex } from '../../../../shared/records/model/optionCatalogUtils';
import type { OptionRowProps } from './types';
export function SortableOptionRow({ option, fieldType, groups, usageCount, isDefault, onRename, onRemove, onSetColor, onSetGroup, onSetDefault }: OptionRowProps) {
    const { t } = useTranslation();
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: option.name });
    // The row is remounted via key={option.name} when the option is renamed, so
    // the draft doesn't need any synchronization effect.
    const [draft, setDraft] = useState(option.name);
    const [paletteOpen, setPaletteOpen] = useState(false);

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.9 : 1,
        zIndex: isDragging ? 50 : 1,
    };

    const commit = () => {
        const next = draft.trim();
        if (!next || next === option.name) { setDraft(option.name); return; }
        onRename(option.name, next);
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={`relative flex items-center gap-2 rounded-lg border bg-[var(--bg-primary)] px-2 py-1 transition-colors ${isDragging ? 'border-[var(--gnosi-primary)] shadow-md' : 'border-[var(--border-primary)]'}`}
        >
            <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing p-1 rounded text-[var(--text-tertiary)]/40 hover:text-[var(--gnosi-primary)]">
                <GripVertical size={14} />
            </div>
            {/* Option color: clickable dot that opens the palette. */}
            <button
                type="button"
                onClick={() => { setPaletteOpen((v) => !v); }}
                className="shrink-0 w-4 h-4 rounded-full border border-black/10 hover:scale-110 transition-transform"
                style={{ backgroundColor: optionColorHex(option.color) }}
                title={t('schema.option_color', "Option color")}
            />
            {paletteOpen && (
                <div className="absolute left-8 top-7 z-50 flex gap-1 p-1.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-lg">
                    {OPTION_COLOR_PALETTE.map((c) => (
                        <button
                            key={c}
                            type="button"
                            onClick={() => { onSetColor(option.name, c); setPaletteOpen(false); }}
                            className={`w-4 h-4 rounded-full border ${option.color === c ? 'ring-2 ring-[var(--gnosi-primary)] ring-offset-1' : 'border-black/10'}`}
                            style={{ backgroundColor: optionColorHex(c) }}
                            title={c}
                        />
                    ))}
                </div>
            )}
            <input
                type="text"
                value={draft}
                onChange={(e) => { setDraft(e.target.value); }}
                onBlur={commit}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); commit(); e.currentTarget.blur(); }
                    if (e.key === 'Escape') { e.stopPropagation(); setDraft(option.name); e.currentTarget.blur(); }
                }}
                className="flex-1 min-w-0 bg-transparent text-sm text-[var(--text-primary)] outline-none border-none focus:ring-0"
            />
            {typeof usageCount === 'number' && (
                <span
                    className="shrink-0 text-[10px] tabular-nums text-[var(--text-tertiary)]/70"
                    title={t('schema.option_usage', { count: usageCount, defaultValue: "{{count}} records use this option" })}
                >
                    {usageCount}
                </span>
            )}
            {fieldType === 'status' && (
                <select
                    value={option.group || ''}
                    onChange={(e) => { onSetGroup(option.name, e.target.value); }}
                    className="shrink-0 text-[10px] border border-[var(--border-primary)] rounded px-1 py-0.5 bg-[var(--bg-secondary)] text-[var(--text-secondary)] outline-none"
                    title={t('schema.option_group', "Group")}
                >
                    <option value="">{t('schema.option_group_none', "— group —")}</option>
                    {groups.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
            )}
            <button
                type="button"
                onClick={() => { onSetDefault(isDefault ? '' : option.name); }}
                className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded border transition-colors ${isDefault ? 'border-[var(--gnosi-primary)] text-[var(--gnosi-primary)] bg-[var(--gnosi-primary)]/10' : 'border-transparent text-[var(--text-tertiary)]/50 hover:text-[var(--text-secondary)]'}`}
                title={t('schema.option_default_hint', "Default option when creating a record")}
            >
                {t('schema.option_default', "default")}
            </button>
            <button
                type="button"
                onClick={() => { onRemove(option.name); }}
                className="btn-gnosi-danger !p-1"
                title={t('common.delete', "Delete")}
            >
                <Trash2 size={14} />
            </button>
        </div>
    );
}
