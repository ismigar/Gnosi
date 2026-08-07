import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { toast } from '../../lib/toast';
import { X, Plus, Trash2, Settings, GripVertical, Layers, Languages, Zap, Tag, Globe, Loader2, Link2, Send, AlertTriangle, Sparkles } from 'lucide-react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { getFieldConfig, getFieldType, getSchemaFieldNames } from './schemaUtils';
import {
    OPTION_COLOR_PALETTE,
    normalizeOption,
    normalizeOptions,
    optionColorHex,
    seedOptionsForFeature,
} from './optionCatalogUtils';
import { ConfirmModal } from '../ConfirmModal';
import { pushModalLayer } from '../../hooks/useModalKeyboard';
import PromptModal from '../PromptModal';
import { useTranslation } from 'react-i18next';
import { usePlugins } from '../../plugins/usePlugins';

// Immutable ID for properties: 'fld_' + 8 hex chars. It is persisted in the
// table schema and is preserved across field name renames.
const generateFieldId = () => {
    const bytes = new Uint8Array(4);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        crypto.getRandomValues(bytes);
    } else {
        for (let i = 0; i < 4; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    return 'fld_' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
};

const ROLLUP_AGGREGATIONS = [
    { value: 'count_all', label: 'Count all' },
    { value: 'count_values', label: 'Count values' },
    { value: 'sum', label: 'Sum' },
    { value: 'avg', label: 'Avg' },
    { value: 'min', label: 'Min' },
    { value: 'max', label: 'Max' },
    { value: 'unique_count', label: 'Unique count' },
    { value: 'percent_checked', label: '% checked' },
    { value: 'earliest', label: 'Earliest' },
    { value: 'latest', label: 'Latest' },
    { value: 'show_original', label: 'Show original' },
];

// Field types that can be marked as translatable. Excludes derived fields
// (formula/rollup/virtual), fields without textual content, and type
// structural fields such as `button`. `title` is indeed allowed: the backend
// (translate_row) uses the title translation as the subitem's title.
const TRANSLATABLE_FIELD_TYPES = new Set([
    'title', 'text', 'rich_text', 'select', 'multi_select', 'status', 'url'
]);

// Catalog of actions that a `button`-type field can execute. For now
// only row translation; adding new actions means registering them
// also in the backend (skills) and, if needed, in the UI.
const BUTTON_ACTIONS = [
    { id: 'translate_row', label_key: 'schema.button_action_translate_row', label_default: 'Traduir fila a subitems' },
    { id: 'set_fields', label_key: 'schema.button_action_set_fields', label_default: 'Assignar valors a camps' },
    { id: 'ai_prompt', label_key: 'schema.button_action_ai_prompt', label_default: 'Executar prompt IA' },
    { id: 'run_skill', label_key: 'schema.button_action_run_skill', label_default: 'Executar Skill de Settings' },
];

// Field types that have a fixed catalog of selectable options.
const OPTION_FIELD_TYPES = new Set(['select', 'multi_select', 'status']);

// An option row inside the OptionsEditor. The rename is confirmed on onBlur/Enter
// (not on every keystroke) so the name stays a stable id for dragging —
// this way no transient duplicate ids appear while typing.
function SortableOptionRow({ option, fieldType, groups, usageCount, isDefault, onRename, onRemove, onSetColor, onSetGroup, onSetDefault }) {
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
                onClick={() => setPaletteOpen((v) => !v)}
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
                onChange={(e) => setDraft(e.target.value)}
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
                    onChange={(e) => onSetGroup(option.name, e.target.value)}
                    className="shrink-0 text-[10px] border border-[var(--border-primary)] rounded px-1 py-0.5 bg-[var(--bg-secondary)] text-[var(--text-secondary)] outline-none"
                    title={t('schema.option_group', "Group")}
                >
                    <option value="">{t('schema.option_group_none', "— group —")}</option>
                    {groups.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
            )}
            <button
                type="button"
                onClick={() => onSetDefault(isDefault ? '' : option.name)}
                className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded border transition-colors ${isDefault ? 'border-[var(--gnosi-primary)] text-[var(--gnosi-primary)] bg-[var(--gnosi-primary)]/10' : 'border-transparent text-[var(--text-tertiary)]/50 hover:text-[var(--text-secondary)]'}`}
                title={t('schema.option_default_hint', "Default option when creating a record")}
            >
                {t('schema.option_default', "default")}
            </button>
            <button
                type="button"
                onClick={() => onRemove(option.name)}
                className="btn-gnosi-danger !p-1"
                title={t('common.delete', "Delete")}
            >
                <Trash2 size={14} />
            </button>
        </div>
    );
}

// Dialog for deleting an option with two outcomes: clear the values or
// REASSIGN them to another option (Notion style). Always with confirmation
// (never destructive on the first click) and portal to body, outside the parent's modalRef
// so that Esc doesn't close the entire configuration.
function RemoveOptionDialog({ state, options, onCancel, onConfirm }) {
    const { t } = useTranslation();
    // The parent remounts the dialog via key on each opening: useState starts clean.
    const [reassignTo, setReassignTo] = useState('');
    if (!state.isOpen) return null;
    const others = options.filter((o) => o.name !== state.value);
    return createPortal(
        <div
            className="fixed inset-0 z-[var(--z-modal-dropdown)] flex items-center justify-center bg-black/40"
            onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } }}
        >
            <div className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-xl w-full max-w-md p-5 animate-in zoom-in-95 duration-150">
                <h3 className="text-base font-semibold text-[var(--text-primary)] mb-2">
                    {t('schema.confirm_remove_option_title', "Delete option")}
                </h3>
                <p className="text-sm text-[var(--text-secondary)] mb-3">
                    {typeof state.usageCount === 'number' && state.usageCount > 0
                        ? t('schema.remove_option_in_use', { name: state.value, count: state.usageCount, defaultValue: "The option “{{name}}” is used by {{count}} records. What should we do with their values?" })
                        : t('schema.remove_option_unused', { name: state.value, defaultValue: "Are you sure you want to delete the option “{{name}}”?" })}
                </p>
                {state.protectedReason && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 mb-3">
                        {state.protectedReason}
                    </p>
                )}
                {others.length > 0 && (
                    <label className="flex items-center gap-2 mb-4 text-sm text-[var(--text-secondary)]">
                        {t('schema.remove_option_reassign', "Reassign to")}
                        <select
                            value={reassignTo}
                            onChange={(e) => setReassignTo(e.target.value)}
                            className="flex-1 text-sm border border-[var(--border-primary)] rounded-md px-2 py-1 bg-[var(--bg-secondary)] text-[var(--text-primary)] outline-none"
                        >
                            <option value="">{t('schema.remove_option_clear', "— clear the values —")}</option>
                            {others.map((o) => <option key={o.name} value={o.name}>{o.name}</option>)}
                        </select>
                    </label>
                )}
                <div className="flex justify-end gap-2">
                    <button type="button" onClick={onCancel} className="px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded-md transition-colors">
                        {t('common.cancel', "Cancel")}
                    </button>
                    <button type="button" onClick={() => onConfirm(reassignTo || null)} className="btn-gnosi-danger px-3 py-1.5 text-sm rounded-md">
                        {t('schema.confirm_remove_option_confirm', "Delete")}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
}

// States that the action_rules write or check: when removing them, the UI
// warns (the engine would recreate them on its own if a rule needs them — §4.1.5).
const RULE_PROTECTED_OPTIONS = new Set([
    'Esborrany', 'Traduït', 'Publicat a Drupal', 'Publicat a XXSS',
]);

// Editor for the option catalog of a select/multi_select/status field. Add,
// rename (with eager rewriting of rows on the server), delete with
// clearing or reassignment, reorder (drag), per-option color, group (status) and
// default option. Lives in its own DndContext, nested inside the one for fields.
function OptionsEditor({ options = [], onChange, fieldType = 'select', groups = [], defaultOption = '', onDefaultOptionChange, optionTools = null, fieldId = '', catalogRef = '', sharedCatalogs = {}, onLinkCatalog = null }) {
    const { t } = useTranslation();
    const [newOption, setNewOption] = useState('');
    const [usage, setUsage] = useState(null); // {name: count} or null while loading
    const [confirmRemove, setConfirmRemove] = useState({ isOpen: false, value: null, usageCount: null, protectedReason: '' });
    const [showNewCatalog, setShowNewCatalog] = useState(false);
    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );
    // With a shared catalog (config.catalog_ref), the options LIVE in the root
    // registry and are edited there (all linked tables see them). Otherwise, they are
    // local to the field. Renaming/deleting everywhere is only supported for
    // local catalogs (row rewriting is per-table).
    const isShared = Boolean(catalogRef);
    const richOptions = normalizeOptions(isShared ? (sharedCatalogs[catalogRef] || []) : options);
    const names = richOptions.map((o) => o.name);
    const applyChange = (next) => {
        if (isShared) optionTools?.updateSharedCatalog?.(catalogRef, next);
        else onChange(next);
    };

    // Usage counter per option (server). Only if the field already exists in the
    // registry (persisted fieldId); for new fields there is nothing to count.
    useEffect(() => {
        let cancelled = false;
        if (!optionTools?.fetchUsage || !fieldId) return undefined;
        optionTools.fetchUsage(fieldId)
            .then((counts) => { if (!cancelled) setUsage(counts || {}); })
            .catch(() => { if (!cancelled) setUsage(null); });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fieldId]);

    const addOption = () => {
        const v = newOption.trim();
        if (!v || names.includes(v)) { setNewOption(''); return; }
        applyChange([...richOptions, normalizeOption(v)]);
        setNewOption('');
    };

    const renameOption = (oldVal, newVal) => {
        if (names.includes(newVal)) return; // silent: do not duplicate
        if (isShared) {
            // Row rewriting for shared catalogs (multi-table)
            // is not yet supported: renaming would leave orphaned values.
            toast.error(t('schema.shared_catalog_rename_unsupported', "Renaming options of a shared catalog is not supported yet."));
            return;
        }
        onChange(richOptions.map((o) => (o.name === oldVal ? { ...o, name: newVal } : o)));
        if (defaultOption === oldVal) onDefaultOptionChange?.(newVal);
        // Eager rewrite of affected .md files (values are stored by name):
        // ONE call to the server, never N PATCHes from the client.
        optionTools?.renameEverywhere?.(fieldId, oldVal, newVal, usage?.[oldVal] ?? null);
        if (usage && usage[oldVal] !== undefined) {
            setUsage((u) => {
                const next = { ...u };
                next[newVal] = (next[newVal] || 0) + next[oldVal];
                delete next[oldVal];
                return next;
            });
        }
    };

    const setColor = (name, color) => {
        applyChange(richOptions.map((o) => (o.name === name ? { ...o, color } : o)));
    };

    const setGroup = (name, group) => {
        applyChange(richOptions.map((o) => {
            if (o.name !== name) return o;
            const next = { ...o };
            if (group) next.group = group; else delete next.group;
            return next;
        }));
    };

    // Deleting an option removes it from ALL records that use it (not
    // just from the catalog) or reassigns them to another option. Always with
    // confirmation (accessibility: never destructive on the first click).
    const requestRemoveOption = (val) => {
        if (isShared) {
            toast.error(t('schema.shared_catalog_remove_unsupported', "Deleting options from a shared catalog is not supported yet."));
            return;
        }
        setConfirmRemove({
            isOpen: true,
            value: val,
            usageCount: usage ? (usage[val] || 0) : null,
            protectedReason: RULE_PROTECTED_OPTIONS.has(val)
                ? t('schema.remove_option_rule_warning', "This option is used by the action rules (translate/publish); if a rule needs it, it will be recreated automatically.")
                : '',
        });
    };
    const executeRemoveOption = (reassignTo) => {
        const val = confirmRemove.value;
        setConfirmRemove({ isOpen: false, value: null, usageCount: null, protectedReason: '' });
        if (val === null) return;
        onChange(richOptions.filter((o) => o.name !== val));
        if (defaultOption === val) onDefaultOptionChange?.('');
        optionTools?.removeEverywhere?.(fieldId, val, reassignTo);
        if (usage) {
            setUsage((u) => {
                const next = { ...u };
                if (reassignTo && next[val]) next[reassignTo] = (next[reassignTo] || 0) + next[val];
                delete next[val];
                return next;
            });
        }
    };

    const handleDragEnd = ({ active, over }) => {
        if (active && over && active.id !== over.id) {
            const oldIndex = names.indexOf(active.id);
            const newIndex = names.indexOf(over.id);
            if (oldIndex !== -1 && newIndex !== -1) applyChange(arrayMove(richOptions, oldIndex, newIndex));
        }
    };

    // Link the field to a shared catalog (or unlink it). When
    // unlinking, the catalog options are COPIED as local ones so the
    // field doesn't end up without a catalog.
    const handleCatalogLink = (value) => {
        if (!onLinkCatalog) return;
        if (value === '__create__') {
            setShowNewCatalog(true);
            return;
        }
        if (!value && isShared) {
            onChange(richOptions); // local copy of the shared catalog
            onLinkCatalog('');
            return;
        }
        if (value) onLinkCatalog(value);
    };

    const doNewCatalog = async (name) => {
        setShowNewCatalog(false);
        const clean = (name || '').trim();
        if (!clean) return;
        optionTools?.updateSharedCatalog?.(clean, richOptions);
        onLinkCatalog(clean);
    };

    return (
        <>
        <div className="px-3 pb-3 pt-1 border-t border-[var(--border-primary)] bg-[var(--gnosi-primary)]/5 animate-in fade-in slide-in-from-top-1 duration-200">
            <div className="p-3 bg-[var(--bg-primary)] rounded-lg border border-[var(--gnosi-primary)]/20 shadow-inner space-y-2">
                <label className="text-[10px] uppercase tracking-wider text-[var(--gnosi-primary)] font-bold ml-1 flex items-center gap-1.5">
                    <Tag size={12} /> {t('schema.options_label', "Options")}
                    {catalogRef && (
                        <span className="normal-case tracking-normal font-medium text-[var(--text-tertiary)]">
                            · {t('schema.options_shared_catalog', { name: catalogRef, defaultValue: "shared catalog “{{name}}”" })}
                        </span>
                    )}
                </label>
                {richOptions.length > 0 ? (
                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                        <SortableContext items={names} strategy={verticalListSortingStrategy}>
                            <div className="space-y-1.5">
                                {richOptions.map((opt) => (
                                    <SortableOptionRow
                                        key={opt.name}
                                        option={opt}
                                        fieldType={fieldType}
                                        groups={groups}
                                        usageCount={usage ? (usage[opt.name] || 0) : undefined}
                                        isDefault={defaultOption === opt.name}
                                        onRename={renameOption}
                                        onRemove={requestRemoveOption}
                                        onSetColor={setColor}
                                        onSetGroup={setGroup}
                                        onSetDefault={(name) => onDefaultOptionChange?.(name)}
                                    />
                                ))}
                            </div>
                        </SortableContext>
                    </DndContext>
                ) : (
                    <p className="text-[11px] text-[var(--text-secondary)]/60 px-1 italic">
                        {t('schema.options_empty', "No options yet. They're also created automatically when filling records.")}
                    </p>
                )}
                <div className="flex items-center gap-2 pt-1">
                    <input
                        type="text"
                        value={newOption}
                        onChange={(e) => setNewOption(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); addOption(); }
                            if (e.key === 'Escape') { e.stopPropagation(); setNewOption(''); }
                        }}
                        placeholder={t('schema.options_add_placeholder', "New option…")}
                        className="flex-1 text-sm rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 py-1.5 text-[var(--text-primary)] outline-none focus:border-[var(--gnosi-primary)]"
                    />
                    <button
                        type="button"
                        onClick={addOption}
                        disabled={!newOption.trim() || names.includes(newOption.trim())}
                        className="btn-gnosi btn-gnosi-primary !text-xs !py-1.5 !px-3 flex items-center gap-1 disabled:opacity-40"
                    >
                        <Plus size={14} /> {t('common.add', "Add")}
                    </button>
                </div>
                {onLinkCatalog && (
                    <div className="flex items-center gap-2 pt-1">
                        <Link2 size={12} className="text-[var(--text-tertiary)]/60" />
                        <label className="text-[10px] text-[var(--text-tertiary)]/80">
                            {t('schema.shared_catalog_label', "Catalog")}
                        </label>
                        <select
                            value={catalogRef || ''}
                            onChange={(e) => handleCatalogLink(e.target.value)}
                            className="text-[11px] border border-[var(--border-primary)] rounded px-1.5 py-0.5 bg-[var(--bg-secondary)] text-[var(--text-secondary)] outline-none"
                            title={t('schema.shared_catalog_hint', "Shares the same option list across tables: editing it in one place updates it everywhere.")}
                        >
                            <option value="">{t('schema.shared_catalog_own', "Field's own")}</option>
                            {Object.keys(sharedCatalogs).sort().map((name) => (
                                <option key={name} value={name}>{name}</option>
                            ))}
                            <option value="__create__">{t('schema.shared_catalog_create', "+ Convert into shared catalog…")}</option>
                        </select>
                    </div>
                )}
            </div>
        </div>
        <RemoveOptionDialog
            key={confirmRemove.value ?? 'closed'}
            state={confirmRemove}
            options={richOptions}
            onCancel={() => setConfirmRemove({ isOpen: false, value: null, usageCount: null, protectedReason: '' })}
            onConfirm={executeRemoveOption}
        />
        <PromptModal
            isOpen={showNewCatalog}
            onClose={() => setShowNewCatalog(false)}
            onSubmit={doNewCatalog}
            title={t('schema.shared_catalog_new_title', "New shared catalog")}
            label={t('schema.shared_catalog_new_prompt', "Name of the new shared catalog:")}
            confirmText={t('common.create', "Create")}
            cancelText={t('common.cancel', "Cancel")}
        />
        </>
    );
}

const ASSIGNMENT_NUMERIC_TYPES = ['number', 'currency', 'percent', 'formula', 'rollup'];
const ASSIGNMENT_DATE_TYPES = ['date', 'period'];
const ASSIGNMENT_DATETIME_TYPES = ['datetime'];

/**
 * Value control for a `set_fields` assignment. Renders an input that matches
 * the target field type (select/status → dropdown, multi_select → multi
 * dropdown, checkbox → checkbox, number/currency/percent/formula/rollup →
 * numeric input, date/datetime/period → date picker), mirroring the behavior
 * of FilterValueControl in PageViewModal. A `custom` toggle (kept on the
 * assignment object) falls back to a free-text input so the user can still
 * type a formula or literal.
 *
 * @param {object}   props
 * @param {string|string[]} props.value   Current value (string, or array for multi_select).
 * @param {(v: any) => void} props.onChange  Reports the next value.
 * @param {object}   [props.fieldMeta]       Target field meta: `{ type, options }` or undefined.
 * @param {boolean}  [props.custom]          When true, forces a free-text input.
 * @param {(c: boolean) => void} [props.onCustomChange] Reports the custom toggle.
 */
function AssignmentValueControl({ value, onChange, fieldMeta, custom, onCustomChange }) {
    const { t } = useTranslation();
    const cls = 'w-full text-xs border border-[var(--border-primary)] rounded p-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none';

    // Free-text (formula) mode always wins when enabled.
    if (custom) {
        return (
            <div className="flex items-center gap-1 w-full">
                <input
                    type="text"
                    value={value || ''}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={t('schema.button_value_or_formula', "Value or formula")}
                    className={cls}
                />
                <button
                    type="button"
                    onClick={() => onCustomChange(false)}
                    title={t('schema.button_value_type', "Use field-type input")}
                    className="shrink-0 px-1.5 py-1.5 text-[10px] rounded border border-[var(--border-primary)] text-[var(--gnosi-primary)] hover:bg-[var(--gnosi-primary)]/10 transition-colors"
                >
                    {t('schema.button_value_type', "Type")}
                </button>
            </div>
        );
    }

    const ftype = fieldMeta?.type;
    const optionNames = normalizeOptions(fieldMeta?.options).map((o) => o.name);

    if (ftype === 'select' || ftype === 'status') {
        if (optionNames.length > 0) {
            return (
                <select
                    value={String(value || '')}
                    onChange={(e) => onChange(e.target.value)}
                    className={cls}
                >
                    <option value="">{t('schema.button_value_pick', "Pick…")}</option>
                    {optionNames.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
            );
        }
    }

    if (ftype === 'multi_select') {
        if (optionNames.length > 0) {
            const selected = Array.isArray(value)
                ? value.map(String)
                : (value ? [String(value)] : []);
            return (
                <select
                    multiple
                    className={`${cls} h-20`}
                    value={selected}
                    onChange={(e) => onChange(Array.from(e.target.selectedOptions, (o) => o.value))}
                    aria-label={t('schema.button_value_pick', "Pick…")}
                >
                    {optionNames.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
            );
        }
    }

    if (ftype === 'checkbox') {
        const checked = String(value) === 'true';
        return (
            <label className={`${cls} flex items-center gap-2 cursor-pointer`}>
                <input
                    type="checkbox"
                    className="accent-[var(--gnosi-primary)] cursor-pointer"
                    checked={checked}
                    onChange={(e) => onChange(e.target.checked ? 'true' : 'false')}
                />
                <span className="text-[var(--text-secondary)]">
                    {checked ? t('schema.button_value_checked', "Checked") : t('schema.button_value_unchecked', "Unchecked")}
                </span>
            </label>
        );
    }

    if (ASSIGNMENT_NUMERIC_TYPES.includes(ftype)) {
        return (
            <input
                type="number"
                value={value || ''}
                onChange={(e) => onChange(e.target.value)}
                placeholder={t('schema.button_value_ph', "Value")}
                className={cls}
            />
        );
    }

    if (ASSIGNMENT_DATETIME_TYPES.includes(ftype)) {
        const isFormula = typeof value === 'string' && (value.includes('(') || value.includes('{'));
        if (isFormula) {
            return (
                <input
                    type="text"
                    value={value || ''}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder="now()"
                    className={cls}
                />
            );
        }
        return (
            <div className="flex items-center gap-1 w-full">
                <input
                    type="datetime-local"
                    value={value || ''}
                    onChange={(e) => onChange(e.target.value)}
                    className={cls}
                />
                <button
                    type="button"
                    onClick={() => onChange('now()')}
                    title="now()"
                    className="shrink-0 px-1.5 py-1 text-[10px] rounded border border-[var(--border-primary)] text-[var(--gnosi-primary)] hover:bg-[var(--gnosi-primary)]/10"
                >
                    now()
                </button>
            </div>
        );
    }

    if (ASSIGNMENT_DATE_TYPES.includes(ftype)) {
        const isFormula = typeof value === 'string' && (value.includes('(') || value.includes('{'));
        if (isFormula) {
            return (
                <input
                    type="text"
                    value={value || ''}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder="today()"
                    className={cls}
                />
            );
        }
        return (
            <div className="flex items-center gap-1 w-full">
                <input
                    type="date"
                    value={value || ''}
                    onChange={(e) => onChange(e.target.value)}
                    className={cls}
                />
                <button
                    type="button"
                    onClick={() => onChange('today()')}
                    title="today()"
                    className="shrink-0 px-1.5 py-1 text-[10px] rounded border border-[var(--border-primary)] text-[var(--gnosi-primary)] hover:bg-[var(--gnosi-primary)]/10"
                >
                    today()
                </button>
            </div>
        );
    }

    // text / rich_text / url / email / relation / files / unknown → free text,
    // with an explicit formula toggle in case the target type is option-like.
    return (
        <input
            type="text"
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={t('schema.button_value_or_formula', "Value or formula")}
            className={cls}
        />
    );
}

// Child component for each draggable property
function SortableField({ field, idx, allFields, handleUpdateField, handleRemoveField, allTables = [], currentTableName = '', virtualComputers = [], enableTranslation = false, enableDrupalSync = false, drupalBundle = '', drupalFields = [], drupalFieldMapping = {}, setDrupalFieldMapping = () => {}, optionTools = null, projectPlanningEnabled = false, setAiActionModalFieldIndex, availableSkills = [] }) {
    const { t } = useTranslation();
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.id });

    // Sorted alphabetically: these pickers are for finding a field, unlike the
    // schema list itself, whose (drag-and-drop) order is the user's column order.
    const byName = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' });

    const relationFieldOptions = allFields
        .filter((candidate) => candidate.id !== field.id && candidate.type === 'relation' && candidate.name?.trim())
        .map((candidate) => candidate.name.trim())
        .sort(byName);

    const targetPropertyOptions = allFields
        .filter((candidate) => candidate.id !== field.id && candidate.name?.trim())
        .map((candidate) => candidate.name.trim())
        .sort(byName);

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 50 : 1,
        opacity: isDragging ? 0.9 : 1,
    };

    return (
        <div 
            ref={setNodeRef} 
            style={style} 
            className={`flex flex-col bg-[var(--bg-primary)] rounded-xl border shadow-sm transition-all duration-200 overflow-hidden ${isDragging ? 'border-[var(--gnosi-primary)] shadow-lg ring-2 ring-[var(--gnosi-primary)]/10 z-50 scale-[1.02]' : 'border-[var(--border-primary)] hover:border-[var(--text-tertiary)]/40'}`}
        >
            {/* Upper Row: Grip, Name, Type and Actions */}
            <div className={`flex items-center gap-3 p-3 ${field.type === 'title' ? 'bg-[var(--bg-secondary)]/50' : ''}`}>
                <div 
                    {...attributes} 
                    {...listeners} 
                    className={`cursor-grab active:cursor-grabbing p-1.5 rounded-md text-[var(--text-secondary)]/40 hover:text-[var(--gnosi-primary)] hover:bg-[var(--gnosi-primary)]/10 transition-colors ${field.name === 'title' ? 'invisible' : ''}`}
                >
                    <GripVertical size={18} />
                </div>

                <div className="flex-1 min-w-[150px]">
                    <input
                        type="text"
                        value={field.name}
                        onChange={(e) => handleUpdateField(idx, 'name', e.target.value)}
                        placeholder={t('schema.property_name_placeholder')}
                        className="w-full text-sm font-semibold bg-transparent border-none focus:ring-0 text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]/40 outline-none"
                    />
                </div>

                <div className={`w-44 ${field.type === 'title' ? 'mr-10' : ''}`}>
                    <select
                        value={field.type}
                        onChange={(e) => handleUpdateField(idx, 'type', e.target.value)}
                        className="w-full text-xs font-medium border border-[var(--border-primary)] rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 focus:border-[var(--gnosi-primary)] outline-none bg-[var(--bg-secondary)] text-[var(--text-primary)] disabled:opacity-50"
                        disabled={field.type === 'title'}
                    >
                        {[
                            { value: 'text', label: t('schema.type_text') },
                            { value: 'rich_text', label: t('schema.type_rich_text') },
                            { value: 'number', label: t('schema.type_number') },
                            { value: 'select', label: t('schema.type_select') },
                            { value: 'multi_select', label: t('schema.type_multi_select') },
                            { value: 'autoria', label: t('schema.type_autoria', "Authorship") },
                            { value: 'status', label: t('schema.type_status') },
                            { value: 'date', label: t('schema.type_date') },
                            { value: 'datetime', label: t('schema.type_datetime') },
                            { value: 'period', label: t('schema.type_period') },
                            { value: 'checkbox', label: t('schema.type_checkbox') },
                            { value: 'url', label: t('schema.type_url') },
                            { value: 'zotero', label: t('schema.type_zotero', 'Zotero') },
                            { value: 'files', label: t('schema.type_files') },
                            { value: 'image', label: t('schema.type_image', "Image") },
                            { value: 'relation', label: t('schema.type_relation') },
                            { value: 'formula', label: t('schema.type_formula') },
                            { value: 'rollup', label: t('schema.type_rollup') },
                            { value: 'virtual', label: t('schema.type_virtual', "Derived") },
                            { value: 'created_time', label: t('schema.type_created_time', "Created at") },
                            { value: 'last_edited_time', label: t('schema.type_last_edited_time', "Edited at") },
                            { value: 'created_by', label: t('schema.type_created_by', "Created by") },
                            { value: 'last_edited_by', label: t('schema.type_last_edited_by', "Edited by") },
                            { value: 'button', label: t('schema.type_button', "Button") },
                            { value: 'title', label: t('schema.type_title') },
                        ]
                            .sort((a, b) => a.label.localeCompare(b.label))
                            .map((opt) => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                    </select>
                </div>

                {enableTranslation && TRANSLATABLE_FIELD_TYPES.has(field.type) && (
                    <label
                        className="flex items-center gap-1.5 cursor-pointer select-none px-2 py-1 rounded-md hover:bg-[var(--bg-secondary)] transition-colors"
                        title={t('schema.field_translatable_hint', "Mark this field as translatable — the translate button will process it.")}
                    >
                        <input
                            type="checkbox"
                            checked={!!field.translatable}
                            onChange={(e) => handleUpdateField(idx, 'translatable', e.target.checked)}
                            className="w-3.5 h-3.5 rounded border-[var(--border-primary)] text-[var(--gnosi-primary)] focus:ring-[var(--gnosi-primary)] cursor-pointer"
                        />
                        <Languages size={13} className={field.translatable ? 'text-[var(--gnosi-primary)]' : 'text-[var(--text-tertiary)]'} />
                        <span className="text-[10px] uppercase tracking-wider font-bold text-[var(--text-secondary)]">
                            {t('schema.field_translatable', "Translatable")}
                        </span>
                    </label>
                )}

                {enableDrupalSync && drupalBundle && field.name?.trim() && field.type !== 'button' && !field.system && (
                    <div
                        className="flex items-center gap-1.5 px-2 py-1 rounded-md"
                        title={t('schema.field_drupal_map_hint', "Map this field to a field of the Drupal content type.")}
                    >
                        <Globe size={13} className={drupalFieldMapping[field.id] ? 'text-[var(--gnosi-primary)]' : 'text-[var(--text-tertiary)]'} />
                        <select
                            value={drupalFieldMapping[field.id] || ''}
                            onChange={(e) => setDrupalFieldMapping((prev) => {
                                const next = { ...prev };
                                if (e.target.value) next[field.id] = e.target.value;
                                else delete next[field.id];
                                return next;
                            })}
                            className="text-xs px-2 py-1 rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] max-w-[150px]"
                        >
                            <option value="">{t('schema.drupal_no_map', "— Do not sync —")}</option>
                            {drupalFields.map((df) => (
                                <option key={df.field_name} value={df.field_name}>{df.label} · {df.field_type}</option>
                            ))}
                            {/* Fallback: if Drupal doesn't respond (e.g. 436), still show
                                the saved value so the mapping doesn't look lost. */}
                            {drupalFieldMapping[field.id] && !drupalFields.some((df) => df.field_name === drupalFieldMapping[field.id]) && (
                                <option value={drupalFieldMapping[field.id]}>{drupalFieldMapping[field.id]}</option>
                            )}
                        </select>
                    </div>
                )}

                {field.type !== 'title' && (
                    <button
                        onClick={() => handleRemoveField(idx)}
                        className="btn-gnosi-danger !p-1.5"
                        title={t('schema.remove_property')}
                    >
                        <Trash2 size={18} />
                    </button>
                )}
            </div>

            {/* Number: format (number / currency / percentage + decimals) */}
            {field.type === 'number' && (
                <div className="px-3 pb-3 pt-1 border-t border-[var(--border-primary)] bg-[var(--gnosi-primary)]/5 animate-in fade-in slide-in-from-top-1 duration-200">
                    <div className="p-3 bg-[var(--bg-primary)] rounded-lg border border-[var(--gnosi-primary)]/20 shadow-inner space-y-2">
                        <label className="text-[10px] uppercase tracking-wider text-[var(--gnosi-primary)] font-bold ml-1 block">
                            {t('schema.number_format', "Number format")}
                        </label>
                        <div className="grid grid-cols-3 gap-2">
                            <select
                                value={field.format?.kind || 'number'}
                                onChange={(e) => handleUpdateField(idx, 'format', { ...(field.format || {}), kind: e.target.value })}
                                className="text-sm border border-[var(--border-primary)] rounded-md p-1.5 focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 outline-none bg-[var(--bg-primary)] text-[var(--text-primary)]"
                            >
                                <option value="number">{t('schema.number_plain', "Number")}</option>
                                <option value="currency">{t('schema.number_currency', "Currency")}</option>
                                <option value="percent">{t('schema.number_percent', "Percent")}</option>
                                <option value="year">{t('schema.number_year', "Year")}</option>
                            </select>
                            {field.format?.kind !== 'year' && (
                                <input
                                    type="number"
                                    min="0"
                                    max="6"
                                    value={field.format?.decimals ?? ''}
                                    onChange={(e) => handleUpdateField(idx, 'format', { ...(field.format || {}), decimals: e.target.value === '' ? undefined : Math.max(0, parseInt(e.target.value, 10) || 0) })}
                                    placeholder={t('schema.number_decimals', 'Decimals')}
                                    className="text-sm border border-[var(--border-primary)] rounded-md p-1.5 focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 outline-none bg-[var(--bg-primary)] text-[var(--text-primary)]"
                                />
                            )}
                            {field.format?.kind === 'currency' && (
                                <select
                                    value={field.format?.currency || ''}
                                    onChange={(e) => handleUpdateField(idx, 'format', { ...(field.format || {}), currency: e.target.value })}
                                    className="text-sm border border-[var(--border-primary)] rounded-md p-1.5 focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 outline-none bg-[var(--bg-primary)] text-[var(--text-primary)]"
                                >
                                    <option value="">{t('schema.currency_default', "Default")}</option>
                                    <option value="EUR (€)">EUR (€)</option>
                                    <option value="USD ($)">USD ($)</option>
                                    <option value="GBP (£)">GBP (£)</option>
                                    <option value="JPY (¥)">JPY (¥)</option>
                                    <option value="CHF (₣)">CHF (₣)</option>
                                </select>
                            )}
                        </div>
                        <p className="text-[10px] text-[var(--text-secondary)]/70 px-1">
                            {t('schema.number_format_hint', "Empty/“Number” = global Settings format. Percent shows the value as-is with “%”. “Year” drops the thousands separator (2024, not 2,024).")}
                        </p>
                    </div>
                </div>
            )}

            {/* Date/datetime: display format */}
            {(field.type === 'date' || field.type === 'datetime') && (
                <div className="px-3 pb-3 pt-1 border-t border-[var(--border-primary)] bg-[var(--gnosi-primary)]/5 animate-in fade-in slide-in-from-top-1 duration-200">
                    <div className="p-3 bg-[var(--bg-primary)] rounded-lg border border-[var(--gnosi-primary)]/20 shadow-inner space-y-2">
                        <label className="text-[10px] uppercase tracking-wider text-[var(--gnosi-primary)] font-bold ml-1 block">
                            {t('schema.date_format', "Date format")}
                        </label>
                        <select
                            value={field.format?.dateFormat || ''}
                            onChange={(e) => handleUpdateField(idx, 'format', { ...(field.format || {}), dateFormat: e.target.value || undefined })}
                            className="w-full text-sm border border-[var(--border-primary)] rounded-md p-1.5 focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 outline-none bg-[var(--bg-primary)] text-[var(--text-primary)]"
                        >
                            <option value="">{t('schema.date_format_global', 'Global (Settings)')}</option>
                            <option value="locale">{t('schema.date_format_locale', "By language")}</option>
                            <option value="DD/MM/YYYY">{t('schema.date_format_dmy', "DD/MM/YYYY")}</option>
                            <option value="MM/DD/YYYY">{t('schema.date_format_mdy', "MM/DD/YYYY")}</option>
                            <option value="YYYY-MM-DD">{t('schema.date_format_iso', "YYYY-MM-DD (ISO)")}</option>
                        </select>
                    </div>
                </div>
            )}

            {field.type === 'period' && projectPlanningEnabled && (
                <div className="px-3 pb-3 pt-1 border-t border-[var(--border-primary)] bg-[var(--gnosi-primary)]/5 animate-in fade-in slide-in-from-top-1 duration-200">
                    <div className="space-y-3 rounded-lg border border-[var(--gnosi-primary)]/20 bg-[var(--bg-primary)] p-3 shadow-inner">
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--gnosi-primary)]">
                            {t('schema.period_planning', "Project planning")}
                        </label>
                        <label className="flex items-start gap-2 text-xs text-[var(--text-secondary)]">
                            <input
                                type="checkbox"
                                checked={field.duration_enabled !== false}
                                onChange={(event) => handleUpdateField(idx, 'duration_enabled', event.target.checked)}
                                className="mt-0.5 rounded border-[var(--border-primary)] text-[var(--gnosi-primary)]"
                            />
                            <span>
                                <strong className="block text-[var(--text-primary)]">
                                    {t('schema.period_duration_enabled', "Add working-day duration")}
                                </strong>
                                {t('schema.period_duration_hint', "Calculate finish from start and duration.")}
                            </span>
                        </label>
                        <label className="flex items-start gap-2 text-xs text-[var(--text-secondary)]">
                            <input
                                type="checkbox"
                                checked={field.predecessors_enabled !== false}
                                onChange={(event) => handleUpdateField(idx, 'predecessors_enabled', event.target.checked)}
                                className="mt-0.5 rounded border-[var(--border-primary)] text-[var(--gnosi-primary)]"
                            />
                            <span>
                                <strong className="block text-[var(--text-primary)]">
                                    {t('schema.period_predecessors_enabled', "Add predecessors")}
                                </strong>
                                {t('schema.period_predecessors_hint', "Calculate an empty start from the latest predecessor finish.")}
                            </span>
                        </label>
                        <label className="flex items-start gap-2 text-xs text-[var(--text-secondary)]">
                            <input
                                type="checkbox"
                                checked={field.skip_non_working_days !== false}
                                onChange={(event) => handleUpdateField(idx, 'skip_non_working_days', event.target.checked)}
                                className="mt-0.5 rounded border-[var(--border-primary)] text-[var(--gnosi-primary)]"
                            />
                            <span>
                                <strong className="block text-[var(--text-primary)]">
                                    {t('schema.period_skip_non_working', "Skip non-working time")}
                                </strong>
                                {t('schema.period_skip_non_working_hint', "Use the plugin's work week and holiday calendar.")}
                            </span>
                        </label>
                    </div>
                </div>
            )}

            {/* Button: action + label + custom config */}
            {field.type === 'button' && (
                <div className="px-3 pb-3 pt-1 border-t border-[var(--border-primary)] bg-[var(--gnosi-primary)]/5 animate-in fade-in slide-in-from-top-1 duration-200">
                    <div className="p-3 bg-[var(--bg-primary)] rounded-lg border border-[var(--gnosi-primary)]/20 shadow-inner space-y-3">
                        <div className="flex items-center justify-between">
                            <label className="text-[10px] uppercase tracking-wider text-[var(--gnosi-primary)] font-bold flex items-center gap-1.5">
                                <Zap size={12} /> {t('schema.button_action', "Button action")}
                            </label>
                            <button
                                type="button"
                                onClick={() => {
                                    setAiActionModalFieldIndex(idx);
                                    setAiActionPrompt('');
                                }}
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded font-medium bg-gradient-to-r from-[var(--gnosi-primary)]/10 to-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)] dark:text-[var(--gnosi-primary)] border border-[var(--gnosi-primary)]/30 hover:from-[var(--gnosi-primary)]/20 hover:to-[var(--gnosi-primary)]/20 transition-all shadow-sm"
                            >
                                <Sparkles size={12} />
                                {t('schema.button_program_ai', "Programar amb IA ✨")}
                            </button>
                        </div>

                        <select
                            value={field.button_action || 'translate_row'}
                            onChange={(e) => handleUpdateField(idx, 'button_action', e.target.value)}
                            className="w-full text-sm border border-[var(--border-primary)] rounded-md p-1.5 focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 outline-none bg-[var(--bg-primary)] text-[var(--text-primary)]"
                        >
                            {BUTTON_ACTIONS.map(action => (
                                <option key={action.id} value={action.id}>
                                    {t(action.label_key, action.label_default)}
                                </option>
                            ))}
                        </select>

                        <div>
                            <label className="text-[10px] uppercase tracking-wider text-[var(--gnosi-primary)] font-bold block mb-1">
                                {t('schema.button_label', "Button label")}
                            </label>
                            <input
                                type="text"
                                value={field.button_label || ''}
                                onChange={(e) => handleUpdateField(idx, 'button_label', e.target.value)}
                                placeholder={t('schema.button_label_placeholder', "e.g. Translate")}
                                className="w-full text-sm border border-[var(--border-primary)] rounded-md p-1.5 focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 outline-none bg-[var(--bg-primary)] text-[var(--text-primary)]"
                            />
                        </div>

                        {/* Custom config for set_fields */}
                        {field.button_action === 'set_fields' && (
                            <div className="pt-2 border-t border-[var(--border-primary)]/50 space-y-2">
                                <label className="text-xs font-semibold text-[var(--text-primary)] block">
                                    {t('schema.button_set_fields_title', "Field assignments")}
                                </label>
                                {(field.button_config?.assignments || []).map((assign, aIdx) => {
                                    const targetMeta = allFields.find(f => f.name === assign.field);
                                    const targetIsMulti = targetMeta?.type === 'multi_select';
                                    const usesTypedControl = !!targetMeta && ['select', 'status', 'multi_select', 'checkbox', 'date', 'datetime', 'period', 'number', 'currency', 'percent', 'formula', 'rollup'].includes(targetMeta.type);
                                    const updateAssignment = (patch) => {
                                        const nextAssignments = [...(field.button_config?.assignments || [])];
                                        nextAssignments[aIdx] = { ...nextAssignments[aIdx], ...patch };
                                        handleUpdateField(idx, 'button_config', { ...field.button_config, assignments: nextAssignments });
                                    };
                                    return (
                                        <div key={aIdx} className="flex items-center gap-2">
                                            <select
                                                value={assign.field || ''}
                                                onChange={(e) => {
                                                    const pickedName = e.target.value;
                                                    const pickedMeta = allFields.find(f => f.name === pickedName);
                                                    // When switching to multi_select, coerce a string value
                                                    // into an array so the multi-select renders correctly.
                                                    let nextValue = assign.value;
                                                    if (pickedMeta?.type === 'multi_select') {
                                                        nextValue = Array.isArray(nextValue)
                                                            ? nextValue
                                                            : (nextValue ? [String(nextValue)] : []);
                                                    } else if (Array.isArray(nextValue)) {
                                                        nextValue = nextValue.join(', ');
                                                    }
                                                    updateAssignment({ field: pickedName, value: nextValue });
                                                }}
                                                className="w-1/2 text-xs border border-[var(--border-primary)] rounded p-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none"
                                            >
                                                <option value="">-- {t('schema.button_target_field', "Target field")} --</option>
                                                {allFields.filter(f => f.name !== field.name).map(f => (
                                                    <option key={f.id} value={f.name}>{f.name}</option>
                                                ))}
                                            </select>
                                            <div className="flex items-center gap-1 w-1/2">
                                                <AssignmentValueControl
                                                    value={assign.value ?? (targetIsMulti ? [] : '')}
                                                    fieldMeta={targetMeta}
                                                    custom={assign.custom === true}
                                                    onCustomChange={(c) => updateAssignment({ custom: c })}
                                                    onChange={(v) => updateAssignment({ value: v })}
                                                />
                                                {usesTypedControl && assign.custom !== true && (
                                                    <button
                                                        type="button"
                                                        onClick={() => updateAssignment({ custom: true })}
                                                        title={t('schema.button_value_custom', "Custom value / formula")}
                                                        className="shrink-0 px-1.5 py-1.5 text-[10px] rounded border border-[var(--border-primary)] text-[var(--gnosi-primary)] hover:bg-[var(--gnosi-primary)]/10 transition-colors"
                                                    >
                                                        {t('schema.button_value_custom', "Custom")}
                                                    </button>
                                                )}
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    const nextAssignments = (field.button_config?.assignments || []).filter((_, i) => i !== aIdx);
                                                    handleUpdateField(idx, 'button_config', { ...field.button_config, assignments: nextAssignments });
                                                }}
                                                className="p-1.5 text-red-500 hover:bg-red-500/10 rounded transition-colors"
                                            >
                                                <Trash2 size={13} />
                                            </button>
                                        </div>
                                    );
                                })}
                                <button
                                    type="button"
                                    onClick={() => {
                                        const current = field.button_config?.assignments || [];
                                        handleUpdateField(idx, 'button_config', {
                                            ...field.button_config,
                                            assignments: [...current, { field: '', value: '' }]
                                        });
                                    }}
                                    className="text-xs text-[var(--gnosi-primary)] hover:underline inline-flex items-center gap-1 font-medium pt-1"
                                >
                                    <Plus size={12} /> {t('schema.button_add_field_assignment', "Add assignment")}
                                </button>
                            </div>
                        )}

                        {/* Custom config for ai_prompt */}
                        {field.button_action === 'ai_prompt' && (
                            <div className="pt-2 border-t border-[var(--border-primary)]/50 space-y-2">
                                <div>
                                    <label className="text-xs font-semibold text-[var(--text-primary)] block mb-1">
                                        {t('schema.button_ai_prompt_label', "AI Instruction (Prompt)")}
                                    </label>
                                    <textarea
                                        rows={3}
                                        value={field.button_config?.prompt || ''}
                                        onChange={(e) => handleUpdateField(idx, 'button_config', { ...field.button_config, prompt: e.target.value })}
                                        placeholder={t('schema.button_ai_prompt_placeholder', "e.g. Summarize the Description field in 2 sentences...")}
                                        className="w-full text-xs border border-[var(--border-primary)] rounded p-2 bg-[var(--bg-primary)] text-[var(--text-primary)] focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-semibold text-[var(--text-primary)] block mb-1">
                                        {t('schema.button_target_field', "Target field")}
                                    </label>
                                    <select
                                        value={field.button_config?.target_field || ''}
                                        onChange={(e) => handleUpdateField(idx, 'button_config', { ...field.button_config, target_field: e.target.value })}
                                        className="w-full text-xs border border-[var(--border-primary)] rounded p-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none"
                                    >
                                        <option value="">-- {t('schema.button_target_field', "Target field")} --</option>
                                        {allFields.filter(f => f.name !== field.name).map(f => (
                                            <option key={f.id} value={f.name}>{f.name}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        )}

                        {/* Custom config for run_skill */}
                        {field.button_action === 'run_skill' && (
                            <div className="pt-2 border-t border-[var(--border-primary)]/50 space-y-2">
                                <label className="text-xs font-semibold text-[var(--text-primary)] block mb-1">
                                    {t('schema.button_select_skill', "Select Skill")}
                                </label>
                                <select
                                    value={field.button_config?.skill_id || ''}
                                    onChange={(e) => handleUpdateField(idx, 'button_config', { ...field.button_config, skill_id: e.target.value })}
                                    className="w-full text-xs border border-[var(--border-primary)] rounded p-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none"
                                >
                                    <option value="">-- {t('schema.button_select_skill', "Select Skill")} --</option>
                                    {availableSkills.map(sk => (
                                        <option key={sk.id || sk.name} value={sk.id || sk.name}>{sk.name || sk.id}</option>
                                    ))}
                                </select>
                            </div>
                        )}

                        <p className="text-[10px] text-[var(--text-secondary)]/70 px-1">
                            {t('schema.button_hint', "The button runs the selected action on the row and, for translation, creates one subitem per target language.")}
                        </p>
                    </div>
                </div>
            )}

            {/* Files: storage folder config */}
            {field.type === 'files' && (
                <div className="px-3 pb-3 pt-1 border-t border-[var(--border-primary)] bg-[var(--gnosi-primary)]/5 animate-in fade-in slide-in-from-top-1 duration-200">
                    <div className="p-3 bg-[var(--bg-primary)] rounded-lg border border-[var(--gnosi-primary)]/20 shadow-inner space-y-2">
                        <label className="text-[10px] uppercase tracking-wider text-[var(--gnosi-primary)] font-bold ml-1">
                            {t('schema.file_mode', 'Mode')}
                        </label>
                        <div className="flex gap-2">
                            {[
                                { value: 'link', label: t('schema.file_mode_link', "Link") },
                                { value: 'upload', label: t('schema.file_mode_upload', "Upload") },
                            ].map(opt => (
                                <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => handleUpdateField(idx, 'file_mode', opt.value)}
                                    className={`flex-1 text-xs rounded-lg border px-2 py-1.5 font-semibold transition-colors ${
                                        (field.file_mode || 'upload') === opt.value
                                            ? 'bg-[var(--gnosi-primary)] text-white border-[var(--gnosi-primary)]'
                                            : 'border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'
                                    }`}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                        <p className="text-[10px] text-[var(--text-secondary)]/70 px-1">
                            {(field.file_mode || 'upload') === 'link'
                                ? t('schema.file_mode_link_desc', "Links a local file without copying it (reference).")
                                : t('schema.file_mode_upload_desc', "Copies the file to the destination folder.")}
                        </p>

                        {(field.file_mode || 'upload') === 'upload' && (
                        <div className="pt-2 mt-1 space-y-2 border-t border-[var(--border-primary)]/50">
                        <label className="text-[10px] uppercase tracking-wider text-[var(--gnosi-primary)] font-bold ml-1">
                            {t('schema.storage_folder', "Storage folder")}
                        </label>
                        <div className="flex gap-2">
                            {[
                                { value: 'assets',    label: 'Assets',    desc: t('schema.storage_assets_desc', "Vault Assets folder") },
                                { value: 'library', label: 'Library', desc: t('schema.storage_library_desc', "Shared reference library (OneDrive/Library)") },
                                { value: 'free',      label: t('schema.storage_free', "Free"), desc: t('schema.storage_free_desc', "User selects the destination folder or existing file on each attachment") },
                            ].map(opt => (
                                <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => handleUpdateField(idx, 'storage_folder', opt.value)}
                                    title={opt.desc}
                                    className={`flex-1 text-xs rounded-lg border px-2 py-1.5 font-semibold transition-colors ${
                                        (field.storage_folder || 'assets') === opt.value
                                            ? 'bg-[var(--gnosi-primary)] text-white border-[var(--gnosi-primary)]'
                                            : 'border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'
                                    }`}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                        <p className="text-[10px] text-[var(--text-secondary)]/70 px-1">
                            {{
                                assets:    t('schema.storage_assets_desc', "Vault Assets folder"),
                                library: t('schema.storage_library_desc', "Shared reference library (OneDrive/Library)"),
                                free:      t('schema.storage_free_desc', "User selects the destination folder or existing file on each attachment"),
                            }[field.storage_folder || 'assets']}
                        </p>

                        <div className="pt-2 mt-1 space-y-1 border-t border-[var(--border-primary)]/50">
                            <label className="text-[10px] uppercase tracking-wider text-[var(--gnosi-primary)] font-bold ml-1">
                                {t('schema.name_pattern', "Name pattern")}
                            </label>
                            <input
                                type="text"
                                value={field.name_pattern || ''}
                                onChange={(e) => handleUpdateField(idx, 'name_pattern', e.target.value)}
                                placeholder={t('schema.name_pattern_ph', "E.g. {Authors} - {Any} - {Títol}")}
                                className="w-full text-xs rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 py-1.5 text-[var(--text-primary)] outline-none focus:border-[var(--gnosi-primary)]"
                            />
                            {allFields.filter(f => f !== field && (f.name || '').trim()).length > 0 && (
                                <div className="flex flex-wrap gap-1 px-1">
                                    {allFields.filter(f => f !== field && (f.name || '').trim()).sort((a, b) => (a.name || '').localeCompare(b.name || '')).flatMap(f => (
                                        (f.type === 'autoria' ? [`${f.name}.nom`, `${f.name}.cognom1`, `${f.name}.cognom2`] : [f.name]).map(tok => (
                                            <button
                                                key={tok}
                                                type="button"
                                                onClick={() => handleUpdateField(idx, 'name_pattern', `${field.name_pattern || ''}{${tok}}`)}
                                                className="text-[10px] rounded border border-[var(--border-primary)] px-1.5 py-0.5 text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
                                                title={t('schema.name_pattern_insert', "Insert the field into the pattern")}
                                            >
                                                {`{${tok}}`}
                                            </button>
                                        ))
                                    ))}
                                </div>
                            )}
                            <p className="text-[10px] text-[var(--text-secondary)]/70 px-1">
                                {t('schema.name_pattern_hint', "On upload, the file is renamed on disk according to the pattern (empty fields are omitted). For authors: {Autor.nom}, {Autor.cognom1} and {Autor.cognom2} (and {Autor} alone, the full name).")}
                            </p>
                        </div>
                        </div>
                        )}
                    </div>
                </div>
            )}

            {/* Specific Configuration Section (Formula, Rollup, Relation, Virtual) */}
            {(field.type === 'relation' || field.type === 'rollup' || field.type === 'formula' || field.type === 'virtual') && (
                <div className="px-3 pb-3 pt-1 border-t border-[var(--border-primary)] bg-[var(--gnosi-primary)]/5 animate-in fade-in slide-in-from-top-1 duration-200">
                    <div className="p-3 bg-[var(--bg-primary)] rounded-lg border border-[var(--gnosi-primary)]/20 shadow-inner">
                        {field.type === 'virtual' && (
                            <div className="space-y-2">
                                <label className="text-[10px] uppercase tracking-wider text-[var(--gnosi-primary)] font-bold ml-1">
                                    {t('schema.virtual_compute', "Derived computer")}
                                </label>
                                <select
                                    value={field.compute || ''}
                                    onChange={(e) => handleUpdateField(idx, 'compute', e.target.value)}
                                    className="w-full text-sm bg-transparent text-[var(--text-primary)] outline-none border-none focus:ring-0"
                                >
                                    <option value="">{t('schema.virtual_pick', "— Pick a computer —")}</option>
                                    {(virtualComputers || []).map(c => (
                                        <option key={c.compute} value={c.compute}>
                                            {c.label} ({c.compute})
                                        </option>
                                    ))}
                                </select>
                                {field.compute && (
                                    <p className="text-[10px] text-[var(--text-secondary)]/80 px-1 border-t border-[var(--border-primary)] pt-1">
                                        {(virtualComputers || []).find(c => c.compute === field.compute)?.description || ''}
                                    </p>
                                )}
                                <p className="text-[10px] text-[var(--text-secondary)]/60 px-1">
                                    {t('schema.virtual_hint', "Derived (read-only) field. The backend computes it from the graph or other indexes.")}
                                </p>
                            </div>
                        )}
                        {field.type === 'formula' && (
                            <div className="space-y-2">
                                <label className="text-[10px] uppercase tracking-wider text-[var(--gnosi-primary)] font-bold ml-1">{t('schema.formula_expression')}</label>
                                <input
                                    type="text"
                                    value={field.formula || ''}
                                    onChange={(e) => handleUpdateField(idx, 'formula', e.target.value)}
                                    placeholder={t('schema.formula_placeholder')}
                                    className="w-full text-sm border-none focus:ring-0 bg-transparent font-mono text-[var(--text-primary)] outline-none"
                                />
                                <p className="text-[10px] text-[var(--text-secondary)]/60 px-1 border-t border-[var(--border-primary)] pt-1">
                                    {t('schema.formula_hint')}
                                </p>
                            </div>
                        )}

                        {field.type === 'rollup' && (
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <div className="space-y-1">
                                    <label className="text-[10px] uppercase tracking-wider text-[var(--gnosi-primary)] font-bold ml-1">{t('schema.relation')}</label>
                                    <select
                                        value={field.relationField || ''}
                                        onChange={(e) => handleUpdateField(idx, 'relationField', e.target.value)}
                                        className="w-full text-xs border border-[var(--border-primary)] rounded-md p-1.5 focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 outline-none bg-[var(--bg-primary)] text-[var(--text-primary)]"
                                    >
                                        <option value="">{t('schema.relation_fields_placeholder')}</option>
                                        {relationFieldOptions.map((name) => (
                                            <option key={name} value={name}>{name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[10px] uppercase tracking-wider text-[var(--gnosi-primary)] font-bold ml-1">{t('schema.target_property')}</label>
                                    <select
                                        value={field.targetProperty || ''}
                                        onChange={(e) => handleUpdateField(idx, 'targetProperty', e.target.value)}
                                        className="w-full text-xs border border-[var(--border-primary)] rounded-md p-1.5 focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 outline-none bg-[var(--bg-primary)] text-[var(--text-primary)]"
                                    >
                                        <option value="">{t('schema.select_property_placeholder')}</option>
                                        <option value="title">title</option>
                                        {targetPropertyOptions.map((name) => (
                                            <option key={name} value={name}>{name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="space-y-1 text-xs">
                                    <label className="text-[10px] uppercase tracking-wider text-[var(--gnosi-primary)] font-bold ml-1">{t('schema.aggregation')}</label>
                                    <select
                                        value={field.aggregation || 'count_values'}
                                        onChange={(e) => handleUpdateField(idx, 'aggregation', e.target.value)}
                                        className="w-full text-xs border border-[var(--border-primary)] rounded-md p-1.5 focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 outline-none bg-[var(--bg-primary)] text-[var(--text-primary)]"
                                    >
                                        {ROLLUP_AGGREGATIONS.map((option) => (
                                            <option key={option.value} value={option.value}>{t(`schema.rollup_${option.value}`, option.label)}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        )}

                        {field.type === 'relation' && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <label className="text-[10px] uppercase tracking-wider text-[var(--gnosi-primary)] font-bold ml-1">{t('schema.related_table')}</label>
                                    <select
                                        value={field.relation_database_id || ''}
                                        onChange={(e) => handleUpdateField(idx, 'relation_database_id', e.target.value)}
                                        className="w-full text-xs border border-[var(--border-primary)] rounded-md px-3 py-2 focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 focus:border-[var(--gnosi-primary)] outline-none bg-[var(--bg-primary)] text-[var(--text-primary)]"
                                    >
                                        <option value="">{t('schema.select_table_placeholder')}</option>
                                        {(allTables || []).map((t) => (
                                            <option key={t.id} value={t.id}>{t.name || t.title || t.id}</option>
                                        ))}
                                    </select>
                                </div>
                                {(() => {
                                    const relatedTable = (allTables || []).find(tt => tt.id === field.relation_database_id);
                                    const relatedName = relatedTable ? (relatedTable.name || relatedTable.title || relatedTable.id) : '';
                                    const srcName = currentTableName || '';
                                    // Readable label: "[Current table] <cardinality> [Related table]".
                                    // E.g.: "Resources many-to-one Areas" = each resource belongs to one area, but an area has many resources.
                                    const cardLabel = (key) => {
                                        const base = t(`schema.${key}`);
                                        if (srcName && relatedName) return `${srcName} ${base.toLowerCase()} ${relatedName}`;
                                        return base;
                                    };
                                    return (
                                        <div className="space-y-1">
                                            <label className="text-[10px] uppercase tracking-wider text-[var(--gnosi-primary)] font-bold ml-1">{t('schema.relation_cardinality')}</label>
                                            <select
                                                value={field.cardinality || 'one-to-many'}
                                                onChange={(e) => handleUpdateField(idx, 'cardinality', e.target.value)}
                                                className="w-full text-xs border border-[var(--border-primary)] rounded-md px-3 py-2 focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 focus:border-[var(--gnosi-primary)] outline-none bg-[var(--bg-primary)] text-[var(--text-primary)]"
                                            >
                                                <option value="one-to-one">{cardLabel('one_to_one')}</option>
                                                <option value="one-to-many">{cardLabel('one_to_many')}</option>
                                                <option value="many-to-one">{cardLabel('many_to_one')}</option>
                                                <option value="many-to-many">{cardLabel('many_to_many')}</option>
                                            </select>
                                        </div>
                                    );
                                })()}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Options Section (select / multi_select / status) */}
            {OPTION_FIELD_TYPES.has(field.type) && (
                <OptionsEditor
                    options={field.options || []}
                    onChange={(opts) => handleUpdateField(idx, 'options', opts)}
                    fieldType={field.type}
                    groups={Array.isArray(field.rawConfig?.option_groups) && field.rawConfig.option_groups.length > 0 ? field.rawConfig.option_groups : ['Inicial', 'En curs', 'Final']}
                    defaultOption={field.defaultOption || ''}
                    onDefaultOptionChange={(name) => handleUpdateField(idx, 'defaultOption', name)}
                    optionTools={optionTools}
                    fieldId={field.id || ''}
                    catalogRef={field.catalogRef || ''}
                    sharedCatalogs={optionTools?.sharedCatalogs || {}}
                    onLinkCatalog={(name) => handleUpdateField(idx, 'catalogRef', name)}
                />
            )}

            {/* Default Value Section */}
            {field.type !== 'title' && field.type !== 'button' && (
                <div className="px-3 pb-3 pt-1 border-t border-[var(--border-primary)]">
                    <div className="flex gap-3 items-center px-1">
                        <div className="flex-1">
                            <input
                                type="text"
                                value={field.defaultFormula || ''}
                                onChange={(e) => handleUpdateField(idx, 'defaultFormula', e.target.value)}
                                placeholder={t('schema.default_formula_placeholder')}
                                className="w-full text-[11px] font-mono bg-transparent border-none focus:ring-0 text-[var(--text-secondary)]/60 placeholder:text-[var(--text-tertiary)]/20 outline-none"
                            />
                        </div>
                        <span className="text-[10px] text-[var(--text-tertiary)]/40 italic">{t('schema.default_label')}</span>
                    </div>
                </div>
            )}
        </div>
    );
}

export function SchemaConfigModal({ isOpen, onClose, folder, tableName = '', currentSchema, onSchemaUpdated, onSave, initialEnableSubitems = false, initialVisibleProperties = null, initialEnableTranslation = false, initialEnableDrupalSync = false, initialDrupalBundle = '', initialDrupalFieldMapping = null, tableId = null, availableTables = null }) {
    const { t } = useTranslation();
    const { isEnabled: isPluginEnabled } = usePlugins();
    const projectPlanningEnabled = isPluginEnabled('project-planning');
    const [fields, setFields] = useState([]);
    const [allTables, setAllTables] = useState([]);
    const [virtualComputers, setVirtualComputers] = useState([]);
    // Name of the CURRENT table for the human-readable cardinality label ("[source] X to Y [target]").
    // The VaultDashboard passes the name via `folder`, not `tableName`; we also resolve it by `tableId`
    // against allTables (authoritative). Without this, the source came out empty and the cardinality
    // was displayed without the tables (regression).
    const resolvedTableName = tableName
        || (allTables.find(tt => tt.id === tableId)?.name)
        || folder || '';
    const [enableSubitems, setEnableSubitems] = useState(initialEnableSubitems);
    const [enableTranslation, setEnableTranslation] = useState(initialEnableTranslation);
    // Shared option catalogs ({name: [{name,color,group}…]}).
    const [sharedCatalogs, setSharedCatalogs] = useState({});
    // Synchronization with Drupal (table config; persisted in the registry).
    const [enableDrupalSync, setEnableDrupalSync] = useState(initialEnableDrupalSync);
    const [drupalBundle, setDrupalBundle] = useState(initialDrupalBundle || '');
    const [drupalFieldMapping, setDrupalFieldMapping] = useState(initialDrupalFieldMapping || {});
    // Publishing to XXSS: the flag lives in the schema (`system` column "XXSS"),
    // like Drupal. The toggle state is derived from the schema on open (it is not a prop).
    const [enableSocialPublish, setEnableSocialPublish] = useState(false);
    // Catalogs discovered from Drupal (ephemeral; they only feed the <select> elements).
    const [drupalContentTypes, setDrupalContentTypes] = useState([]);
    const [drupalFields, setDrupalFields] = useState([]);
    const [drupalLoading, setDrupalLoading] = useState(false);
    const [drupalError, setDrupalError] = useState('');
    const [matching, setMatching] = useState(false);
    const [aiActionModalFieldIndex, setAiActionModalFieldIndex] = useState(null);
    const [aiActionPrompt, setAiActionPrompt] = useState('');
    const [aiActionLoading, setAiActionLoading] = useState(false);
    const [availableSkills, setAvailableSkills] = useState([]);

    useEffect(() => {
        if (isOpen) {
            axios.get('/api/skills').then(res => {
                setAvailableSkills(res.data?.skills || res.data || []);
            }).catch(() => {});
        }
    }, [isOpen]);

    const handleGenerateAiAction = async () => {
        if (!aiActionPrompt.trim() || aiActionModalFieldIndex === null) return;
        setAiActionLoading(true);
        try {
            const res = await axios.post('/api/vault/skills/generate-button-action', {
                prompt: aiActionPrompt,
                fields: fields.map(f => ({ name: f.name, type: f.type }))
            });
            const result = res.data?.result || {};
            const idx = aiActionModalFieldIndex;
            const newFields = [...fields];
            if (result.button_action) newFields[idx].button_action = result.button_action;
            if (result.button_label) newFields[idx].button_label = result.button_label;
            if (result.button_config) newFields[idx].button_config = result.button_config;
            setFields(newFields);
            toast.success(t('schema.button_program_success', "Acció programada correctament"));
            setAiActionModalFieldIndex(null);
            setAiActionPrompt('');
        } catch (err) {
            toast.error(err.response?.data?.detail || "Could not generate AI action");
        } finally {
            setAiActionLoading(false);
        }
    };

    // The AI action modal renders in its own portal above this one, so it must
    // ALSO push its own layer into the modal stack; otherwise Esc is captured
    // by this modal's handler (still the top layer) and closes the whole dialog
    // instead of just the AI modal. Capture phase on `window`, like useModalKeyboard.
    useEffect(() => {
        if (aiActionModalFieldIndex === null) return undefined;
        const layer = pushModalLayer();
        const handleKeyDown = (e) => {
            if (e.key === 'Escape' && layer.isTop()) {
                e.preventDefault();
                e.stopPropagation();
                setAiActionModalFieldIndex(null);
                setAiActionPrompt('');
            }
        };
        window.addEventListener('keydown', handleKeyDown, true);
        return () => {
            window.removeEventListener('keydown', handleKeyDown, true);
            layer.release();
        };
    }, [aiActionModalFieldIndex]);

    // Initialization guard: we only want to sync local state with the
    // props when the modal opens. If the parent re-renders while it is open
    // (e.g. fetchRegistry after an unrelated action), the props
    // arrive with new references and would overwrite the user's edits
    // that haven't been saved yet (toggles, added fields, etc.).
    const initializedRef = useRef(false);
    // Ref to skip the first autosave trigger: right after
    // initialization, the setters cause a re-render that would trigger
    // autosave with a payload identical to the backend's. There's no point sending it.
    const skipNextAutosaveRef = useRef(false);
    // Ref to the modal's root element: we attach the Esc listener there (see below).
    const modalRef = useRef(null);
    // Ref to the modal's scrollable body: we focus it on open so it
    // can be scrolled with the keyboard (arrows / Page Up) and Esc works.
    const scrollRef = useRef(null);
    // Pending save (debounce not yet fired). We flush it on unmount
    // so that closing (Esc/X) right after editing doesn't lose the last change.
    const pendingSaveRef = useRef(null);
    // Layer of this modal in the global stack (cf. pushModalLayer): shared
    // between the effect that registers it and the Esc handler with focus on <body>.
    const modalLayerRef = useRef(null);

    useEffect(() => {
        if (!isOpen) {
            initializedRef.current = false;
            skipNextAutosaveRef.current = false;
            return;
        }
        if (initializedRef.current) return;
        initializedRef.current = true;
        skipNextAutosaveRef.current = true;
        {
            // Transform object to array for editing.
            const fieldsArray = getSchemaFieldNames(currentSchema || {}).map((name) => {
                const cfg = getFieldConfig(currentSchema || {}, name);
                return {
                    // We reuse the immutable field_id from the config if it exists; otherwise
                    // we generate a new one that will be persisted on save.
                    id: cfg.id || generateFieldId(),
                    name,
                    type: getFieldType(currentSchema || {}, name),
                    formula: cfg.formula || '',
                    compute: cfg.compute || '',
                    defaultFormula: cfg.defaultFormula || '',
                    relationField: cfg.relationField || '',
                    targetProperty: cfg.targetProperty || '',
                    aggregation: cfg.aggregation || 'count_values',
                    limit: cfg.limit ?? '',
                    fallbackValue: cfg.fallbackValue ?? '',
                    relation_database_id: cfg.relation_database_id || '',
                    cardinality: cfg.cardinality || 'one-to-many',
                    file_mode: cfg.file_mode || 'upload',
                    storage_folder: cfg.storage_folder || '',
                    name_pattern: cfg.name_pattern || '',
                    translatable: !!cfg.translatable,
                    system: !!cfg.system,
                    button_action: cfg.button_action || '',
                    button_label: cfg.button_label || '',
                    duration_enabled: cfg.duration_enabled !== false,
                    predecessors_enabled: cfg.predecessors_enabled !== false,
                    skip_non_working_days: cfg.skip_non_working_days !== false,
                    format: (cfg.format && typeof cfg.format === 'object') ? cfg.format : {},
                    // Rich catalog: normalizes legacy strings into {name,color,group}.
                    options: normalizeOptions(cfg.options),
                    defaultOption: cfg.default_option || '',
                    catalogRef: cfg.catalog_ref || '',
                    // Registry CRU config: buildPayload starts from it to do
                    // round-trip of keys that the UI doesn't manage (role,
                    // option_groups…) — without this, every save would erase them.
                    rawConfig: cfg,
                    visible: initialVisibleProperties ? initialVisibleProperties.includes(name) : true
                };
            });
            setFields(fieldsArray);
            setEnableSubitems(initialEnableSubitems);
            setEnableTranslation(initialEnableTranslation);
            setEnableDrupalSync(initialEnableDrupalSync);
            setDrupalBundle(initialDrupalBundle || '');
            setDrupalFieldMapping(initialDrupalFieldMapping || {});
            setEnableSocialPublish(fieldsArray.some((f) => f.system && /xxss|social/i.test(f.name || '')));

            // Candidate tables for relation fields. If the parent passes a list of them
            // (e.g. Notion Import: the Notion workspace's DBs, not the vault's
            // local one), it takes precedence; otherwise, the active vault's tables are loaded.
            if (Array.isArray(availableTables)) {
                setAllTables(availableTables);
            } else {
                const fetchTables = async () => {
                    try {
                        const response = await axios.get('/api/vault/tables');
                        const tables = response.data?.tables || response.data || [];
                        setAllTables(tables);
                    } catch (err) {
                        console.error('Error loading tables for the modal:', err);
                    }
                };
                fetchTables();
            }

            // Shared option catalogs (root registry `option_catalogs`).
            const fetchSharedCatalogs = async () => {
                try {
                    const response = await axios.get('/api/vault/option-catalogs');
                    setSharedCatalogs(response.data?.catalogs || {});
                } catch (err) {
                    console.error('Error loading shared catalogs:', err);
                }
            };
            fetchSharedCatalogs();

            // Load virtual computers catalogue for "type: virtual" properties
            const fetchVirtualComputers = async () => {
                try {
                    const response = await axios.get('/api/vault/virtual-fields');
                    setVirtualComputers(response.data?.computers || []);
                } catch (err) {
                    console.error('Error loading virtual computers catalog:', err);
                }
            };
            fetchVirtualComputers();
        }
    }, [isOpen, currentSchema, initialEnableSubitems, initialVisibleProperties, initialEnableTranslation, initialEnableDrupalSync, initialDrupalBundle, initialDrupalFieldMapping, availableTables]);

    // Checks whether a button field with the translation action already exists.
    // Every `button` field receives `button_action` when created (handleUpdateField and
    // addTranslateButton sets it explicitly), so the comparison
    // direct comparison is correct: if a button with an empty button_action arrived, it would mean
    // the configuration is incomplete and the warning banner must appear.
    const hasTranslateButton = fields.some(
        (f) => f.type === 'button' && f.button_action === 'translate_row'
    );

    // Adds a `button` field with the `translate_row` action if there isn't one yet.
    // Picks a unique name based on the "Translate" label to avoid collisions with
    // existing fields (silent validation).
    const addTranslateButton = () => {
        if (hasTranslateButton) return;
        const baseName = t('schema.button_label_translate', "Translate");
        const usedNames = new Set(fields.map((f) => (f.name || '').trim()).filter(Boolean));
        let candidate = baseName;
        let i = 2;
        while (usedNames.has(candidate)) {
            candidate = `${baseName} ${i++}`;
        }
        setFields([...fields, {
            id: generateFieldId(),
            name: candidate,
            type: 'button',
            formula: '',
            compute: '',
            defaultFormula: '',
            relationField: '',
            targetProperty: '',
            aggregation: 'count_values',
            limit: '',
            fallbackValue: '',
            relation_database_id: '',
            cardinality: 'one-to-many',
            file_mode: 'upload',
            storage_folder: '',
            name_pattern: '',
            translatable: false,
            button_action: 'translate_row',
            button_label: '',
            options: [],
            visible: true,
        }]);
    };

    // When enabling translation for the first time, sub-items are required
    // (translations are saved as children). If the user disables it
    // explicitly afterward, we respect their decision. Also, if there isn't
    // yet a `button` field with the `translate_row` action, we add one so that
    // the user immediately has a visible trigger in the table.
    // Centered confirmation (the project's standard ConfirmModal) when DISABLING
    // a toggle with consequences. window.confirm was used before; now we use
    // the modal in the middle of the screen, consistent with the rest of the UI.
    const [toggleConfirm, setToggleConfirm] = useState({ isOpen: false, title: '', message: '', confirmText: '', onConfirm: null });
    const closeToggleConfirm = () => setToggleConfirm((s) => ({ ...s, isOpen: false }));
    const requestDisableConfirm = ({ title, message, confirmText, onConfirm }) => {
        setToggleConfirm({ isOpen: true, title, message, confirmText, onConfirm });
    };

    // Server tools for the options editor. Without tableId (table still
    // not persisted to the registry) remain disabled and all CRUD is local.
    const optionTools = {
        sharedCatalogs,
        fetchUsage: tableId ? async (fieldId) => {
            const res = await axios.get(`/api/vault/tables/${tableId}/options/usage`, { params: { field_id: fieldId } });
            return res.data?.counts || {};
        } : null,
        renameEverywhere: tableId ? async (fieldId, oldVal, newVal) => {
            if (!fieldId) return;
            try {
                const res = await axios.post(`/api/vault/tables/${tableId}/options/rename`, { field_id: fieldId, old: oldVal, new: newVal });
                const n = res.data?.files_changed ?? 0;
                if (n > 0) toast.success(t('schema.option_renamed', { count: n, defaultValue: "{{count}} records updated" }));
            } catch (err) {
                toast.error(err.response?.data?.detail || t('schema.option_rename_error', "Could not rename the option in the records"));
            }
        } : null,
        removeEverywhere: tableId ? async (fieldId, value, reassignTo) => {
            if (!fieldId) return;
            try {
                const res = await axios.post(`/api/vault/tables/${tableId}/options/remove`, { field_id: fieldId, value, reassign_to: reassignTo || undefined });
                const n = res.data?.files_changed ?? 0;
                if (n > 0) toast.success(t('schema.option_removed_rows', { count: n, defaultValue: "{{count}} records updated" }));
            } catch (err) {
                toast.error(err.response?.data?.detail || t('schema.option_remove_error', "Could not remove the option from the records"));
            }
        } : null,
        updateSharedCatalog: async (name, options) => {
            try {
                const res = await axios.put(`/api/vault/option-catalogs/${encodeURIComponent(name)}`, { options });
                setSharedCatalogs((prev) => ({ ...prev, [name]: res.data?.options || options }));
            } catch (err) {
                toast.error(err.response?.data?.detail || t('schema.shared_catalog_save_error', "Could not save the shared catalog"));
            }
        },
    };

    // Seed-on-enable (mirror of the backend's ensure_status_seed, for UX
    // immediate): when enabling Translate/Drupal/XXSS, the field with role `status`
    // receives the base options and the feature's option. The server sends it back
    // guarantee on save — this only saves waiting for the autosave+refetch.
    const seedStatusOptions = (feature) => {
        setFields((prev) => {
            const isStatusField = (f) =>
                OPTION_FIELD_TYPES.has(f.type) && f.type !== 'multi_select' && (
                    f.rawConfig?.role === 'status' ||
                    ['estat', 'estado', 'status', 'state'].includes(String(f.name || '').trim().toLowerCase())
                );
            const idx = prev.findIndex(isStatusField);
            if (idx === -1) return prev;
            const f = prev[idx];
            if (f.catalogRef) return prev;
            const current = normalizeOptions(f.options);
            const have = new Set(current.map((o) => o.name));
            const additions = [...seedOptionsForFeature('base'), ...seedOptionsForFeature(feature)]
                .filter((o) => !have.has(o.name));
            if (additions.length === 0) return prev;
            const next = [...prev];
            next[idx] = { ...f, options: [...current, ...additions] };
            return next;
        });
    };

    const handleToggleTranslation = (next) => {
        if (!next && enableTranslation && fields.some((f) => f.translatable)) {
            requestDisableConfirm({
                title: t('schema.translation_disable_title', "Disable translation"),
                message: t('schema.translation_disable_confirm', "Disable translation for this table? Existing translations are kept, but the table will no longer be translatable."),
                confirmText: t('schema.disable', "Disable"),
                onConfirm: () => setEnableTranslation(false),
            });
            return;
        }
        setEnableTranslation(next);
        if (next && !enableSubitems) {
            setEnableSubitems(true);
        }
        if (next) {
            addTranslateButton();
            seedStatusOptions('translation');
            // A translatable table with no translatable field fails silent
            // validation, which blocks autosave for the WHOLE modal: the toggle
            // (and every later change) was discarded on close. We seed a sensible
            // default — the title, which translate_row needs anyway — so the state
            // is valid the moment the toggle flips. The user can change it after.
            ensureTranslatableField();
        }
    };

    // Marks a default translatable field when there is none. Prefers the title
    // (the backend uses its translation as the subitem's title); otherwise, the
    // first non-system field whose type supports translation.
    const ensureTranslatableField = () => {
        setFields((prev) => {
            if (prev.some((f) => f.translatable && TRANSLATABLE_FIELD_TYPES.has(f.type))) return prev;
            let idx = prev.findIndex((f) => f.type === 'title');
            if (idx === -1) {
                idx = prev.findIndex((f) => !f.system && TRANSLATABLE_FIELD_TYPES.has(f.type));
            }
            if (idx === -1) return prev;
            const next = [...prev];
            next[idx] = { ...next[idx], translatable: true };
            return next;
        });
    };

    // --- Drupal synchronization -----------------------------------------
    // Names of the system-managed columns where the sync stores the NID and
    // the Drupal node's URL. Read-only in the grid (config.system). They are
    // VALUES stored in the schema (the sync looks them up by name) — never via i18n.
    const DRUPAL_NID_COL = 'Drupal NID';
    const DRUPAL_URL_COL = 'Drupal URL';

    // Adds the two output columns (NID/URL) if they aren't there yet. They
    // are managed as part of the schema (like the translate button): this way
    // they're persisted via buildPayload and continuous autosave doesn't erase them.
    const addDrupalColumns = () => {
        const mk = (name, type) => ({
            id: generateFieldId(), name, type,
            formula: '', compute: '', defaultFormula: '', relationField: '',
            targetProperty: '', aggregation: 'count_values', limit: '', fallbackValue: '',
            relation_database_id: '', cardinality: 'one-to-many', file_mode: 'upload',
            storage_folder: '', name_pattern: '', translatable: false, system: true,
            button_action: '', button_label: '', options: [], format: {}, visible: true,
        });
        setFields((prev) => {
            const have = new Set(prev.map((f) => (f.name || '').trim().toLowerCase()));
            const additions = [];
            if (!have.has(DRUPAL_NID_COL.toLowerCase())) additions.push(mk(DRUPAL_NID_COL, 'text'));
            if (!have.has(DRUPAL_URL_COL.toLowerCase())) additions.push(mk(DRUPAL_URL_COL, 'url'));
            return additions.length ? [...prev, ...additions] : prev;
        });
    };

    const handleToggleDrupalSync = (next) => {
        // When disabling, asks for confirmation (centered modal) if there is a mapping
        // configured: this way an accidental click (with autosave active) doesn't leave the
        // table unsynced without warning. The mapping is preserved on the backend.
        if (!next && enableDrupalSync && Object.keys(drupalFieldMapping || {}).length > 0) {
            requestDisableConfirm({
                title: t('schema.drupal_sync_disable_title', "Disable Drupal sync"),
                message: t('schema.drupal_sync_disable_confirm', "Disable Drupal sync? The field mapping will be kept in case you enable it again."),
                confirmText: t('schema.disable', "Disable"),
                onConfirm: () => setEnableDrupalSync(false),
            });
            return;
        }
        setEnableDrupalSync(next);
        if (next) {
            addDrupalColumns();
            seedStatusOptions('drupal');
        }
    };

    // `system` column that marks the table as publishable to XXSS. Its
    // presence is the signal that makes the "Publish to XXSS" button appear (like the
    // Drupal columns). It is persisted with the schema via the `fields` autosave:
    // it's a saved/compared VALUE for logic, not a label — never via i18n
    // (translating it would break detection in tables created in another language).
    const SOCIAL_PUBLISH_COL = 'XXSS';
    const addSocialPublishColumns = () => {
        setFields((prev) => {
            const have = new Set(prev.map((f) => (f.name || '').trim().toLowerCase()));
            if (have.has(SOCIAL_PUBLISH_COL.toLowerCase())) return prev;
            return [...prev, {
                id: generateFieldId(), name: SOCIAL_PUBLISH_COL, type: 'text',
                formula: '', compute: '', defaultFormula: '', relationField: '',
                targetProperty: '', aggregation: 'count_values', limit: '', fallbackValue: '',
                relation_database_id: '', cardinality: 'one-to-many', file_mode: 'upload',
                storage_folder: '', name_pattern: '', translatable: false, system: true,
                button_action: '', button_label: '', options: [], format: {}, visible: true,
            }];
        });
    };

    // Removes the `system` column of XXSS from the schema. Same criterion for
    // detection than the initial state (system + xxss/social name), because in
    // reopening the modal the toggle doesn't get re-derived as active.
    const removeSocialPublishColumns = () => {
        setFields((prev) => prev.filter((f) => !(f.system && /xxss|social/i.test(f.name || ''))));
    };

    const handleToggleSocialPublish = (next) => {
        if (!next && enableSocialPublish) {
            requestDisableConfirm({
                title: t('schema.social_disable_title', "Disable social publishing"),
                message: t('schema.social_publish_disable_confirm', { col: SOCIAL_PUBLISH_COL, defaultValue: "Disable social publishing? The “{{col}}” column will be removed from the schema and the table will no longer be publishable to social networks." }),
                confirmText: t('schema.disable', "Disable"),
                onConfirm: () => { setEnableSocialPublish(false); removeSocialPublishColumns(); },
            });
            return;
        }
        setEnableSocialPublish(next);
        if (next) {
            addSocialPublishColumns();
            seedStatusOptions('social');
        }
    };

    // Links existing rows to Drupal nodes by title (backfill of
    // nid/url, without creating anything in Drupal). Useful for content created before
    // of enabling sync, or when adding new records.
    const handleMatchExisting = async () => {
        if (!tableId || !drupalBundle) return;
        setMatching(true);
        try {
            const res = await axios.post('/api/vault/skills/match-drupal-rows', { table_id: tableId, dry_run: false });
            const c = res.data?.counts || {};
            toast.success(t('schema.drupal_match_done', { matched: c.matched || 0, unmatched: c.unmatched || 0, defaultValue: "{{matched}} linked · {{unmatched}} unmatched." }));
        } catch (err) {
            toast.error(err.response?.data?.detail || t('schema.drupal_match_error', "Error linking with Drupal."));
        } finally {
            setMatching(false);
        }
    };

    // Discovers Drupal content types when enabling synchronization.
    useEffect(() => {
        if (!isOpen || !enableDrupalSync || drupalContentTypes.length > 0) return;
        let cancelled = false;
        setDrupalLoading(true);
        setDrupalError('');
        axios.get('/api/vault/drupal/content-types')
            .then((res) => { if (!cancelled) setDrupalContentTypes(res.data?.content_types || []); })
            .catch((err) => { if (!cancelled) setDrupalError(err.response?.data?.detail || t('schema.drupal_load_error', "Could not connect to Drupal.")); })
            .finally(() => { if (!cancelled) setDrupalLoading(false); });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, enableDrupalSync]);

    // Discovers the fields of the chosen content type.
    useEffect(() => {
        if (!isOpen || !enableDrupalSync || !drupalBundle) { setDrupalFields([]); return; }
        let cancelled = false;
        setDrupalLoading(true);
        setDrupalError('');
        axios.get(`/api/vault/drupal/content-types/${encodeURIComponent(drupalBundle)}/fields`)
            .then((res) => { if (!cancelled) setDrupalFields(res.data?.fields || []); })
            .catch((err) => { if (!cancelled) setDrupalError(err.response?.data?.detail || t('schema.drupal_fields_error', "Could not load the fields.")); })
            .finally(() => { if (!cancelled) setDrupalLoading(false); });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, enableDrupalSync, drupalBundle]);

    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    const handleAddField = () => {
        setFields([...fields, {
            id: generateFieldId(),
            name: '',
            type: 'text',
            formula: '',
            compute: '',
            defaultFormula: '',
            relationField: '',
            targetProperty: '',
            aggregation: 'count_values',
            limit: '',
            fallbackValue: '',
            relation_database_id: '',
            cardinality: 'one-to-many',
            file_mode: 'upload',
            storage_folder: '',
            name_pattern: '',
            translatable: false,
            button_action: '',
            button_label: '',
            duration_enabled: true,
            predecessors_enabled: true,
            skip_non_working_days: true,
            options: [],
            visible: true,
        }]);
    };

    const handleUpdateField = (index, key, value) => {
        const newFields = [...fields];
        newFields[index][key] = value;
        if (key === 'type' && value !== 'formula') {
            newFields[index].formula = '';
        }
        if (key === 'type' && value !== 'virtual') {
            newFields[index].compute = '';
        }
        if (key === 'type' && value !== 'rollup') {
            newFields[index].relationField = '';
            newFields[index].targetProperty = '';
            newFields[index].aggregation = 'count_values';
            newFields[index].limit = '';
            newFields[index].fallbackValue = '';
        }
        if (key === 'type' && value !== 'relation') {
            newFields[index].relation_database_id = '';
            newFields[index].cardinality = 'one-to-many';
        }
        if (key === 'type' && value !== 'button') {
            newFields[index].button_action = '';
            newFields[index].button_label = '';
        }
        if (key === 'type' && value === 'button') {
            // Sensible defaults: the most common action is translation.
            if (!newFields[index].button_action) newFields[index].button_action = 'translate_row';
            // Buttons are not translatable by themselves.
            newFields[index].translatable = false;
        }
        if (key === 'type' && !TRANSLATABLE_FIELD_TYPES.has(value)) {
            newFields[index].translatable = false;
        }
        if (key === 'type' && value === 'status' && normalizeOptions(newFields[index].options).length === 0) {
            // A newly created `status` field starts with the base catalog (decision §9.1).
            newFields[index].options = seedOptionsForFeature('base');
        }
        if (key === 'type' && value === 'period') {
            if (newFields[index].duration_enabled === undefined) newFields[index].duration_enabled = true;
            if (newFields[index].predecessors_enabled === undefined) newFields[index].predecessors_enabled = true;
            if (newFields[index].skip_non_working_days === undefined) newFields[index].skip_non_working_days = true;
        }
        setFields(newFields);
    };

    // Confirmation before deleting a property: the trash button must not
    // be destructive on the first press (accessibility — avoids
    // accidental deletions due to tremor/dystonia). We save the index and name to show it in the dialog.
    const [confirmRemoveField, setConfirmRemoveField] = useState({ isOpen: false, index: null, name: '' });

    const handleRemoveField = (index) => {
        const name = fields[index]?.name?.trim() || t('schema.untitled_property', "unnamed");
        setConfirmRemoveField({ isOpen: true, index, name });
    };

    const executeRemoveField = () => {
        if (confirmRemoveField.index !== null) {
            setFields((curr) => curr.filter((_, i) => i !== confirmRemoveField.index));
        }
        setConfirmRemoveField({ isOpen: false, index: null, name: '' });
    };

    const handleDragEnd = (event) => {
        const { active, over } = event;
        if (active && over && active.id !== over.id) {
            setFields((items) => {
                const oldIndex = items.findIndex(item => item.id === active.id);
                const newIndex = items.findIndex(item => item.id === over.id);
                return arrayMove(items, oldIndex, newIndex);
            });
        }
    };

    // Silent validation: returns a message if something needs to be corrected,
    // null if everything's OK. Doesn't show toasts: the state is reflected in the bar
    // of the footer's autosave.
    const validate = () => {
        if (fields.some(f => !f.name.trim())) return t('schema.error_name_required');
        if (fields.some(f => f.type === 'formula' && !f.formula?.trim())) return t('schema.error_formula_required');
        if (fields.some(f => f.type === 'virtual' && !f.compute?.trim())) return t('schema.error_compute_required', "Pick a computer for the derived field.");
        if (fields.some(f => f.type === 'rollup' && !f.relationField?.trim())) return t('schema.error_relation_field_required');
        if (fields.some(f => f.type === 'rollup' && f.aggregation !== 'count_all' && !f.targetProperty?.trim())) return t('schema.error_target_property_required');
        if (fields.some(f => f.type === 'button' && !f.button_action?.trim())) return t('schema.error_button_action_required', "Pick an action for the button field.");
        if (enableTranslation && !fields.some(f => f.translatable)) return t('schema.error_no_translatable_fields', "If the table is translatable, mark at least one field as translatable.");
        return null;
    };

    // Same check, evaluated on render: while it returns a message, autosave is
    // paused and the banner at the top of the modal says so. Without it, an
    // invalid state silently discarded every change (including the toggles).
    const validationError = validate();

    // Config keys that the UI manages explicitly: buildPayload
    // removes them from the raw config before rewriting them from local state.
    // The rest (role, option_groups, …) round-trip intact.
    const MANAGED_CONFIG_KEYS = [
        'id', 'system', 'formula', 'compute', 'relationField', 'targetProperty',
        'aggregation', 'limit', 'fallbackValue', 'defaultFormula',
        'relation_database_id', 'cardinality', 'file_mode', 'storage_folder',
        'name_pattern', 'button_action', 'button_label', 'button_config', 'format', 'options',
        'translatable', 'default_option', 'catalog_ref', 'duration_enabled',
        'predecessors_enabled', 'skip_non_working_days',
    ];

    // Builds the serializable schema sent to the backend from
    // the local state. Taken directly from the previous block of `handleSave`.
    const buildPayload = () => {
        const newSchemaObj = {};
        const visibleProperties = [];
        fields.forEach(f => {
            const cleanName = f.name.trim();
            newSchemaObj[cleanName] = f.type;
            // Round-trip of the registry config: keys that the UI doesn't
            // manage (role, option_groups…) are kept as-is.
            const config = { ...(f.rawConfig || {}) };
            for (const k of MANAGED_CONFIG_KEYS) delete config[k];
            // Persists the immutable field_id: it's the stable key for
            // referencing the field in notes, views, filters and sections.
            // It is never regenerated once assigned.
            if (f.id && /^fld_[0-9a-f]{8}$/.test(f.id)) {
                config.id = f.id;
            }
            // System-managed column (Drupal NID/URL): read-only in the
            // grid. The sync writes its value; the user doesn't edit it.
            if (f.system === true) {
                config.system = true;
            }
            if (f.type === 'formula') {
                config.formula = f.formula.trim();
            }
            if (f.type === 'virtual') {
                config.compute = f.compute.trim();
            }
            if (f.type === 'rollup') {
                config.relationField = f.relationField.trim();
                config.aggregation = (f.aggregation || 'count_values').trim();
                if (f.aggregation !== 'count_all') {
                    config.targetProperty = f.targetProperty.trim();
                }
                if (String(f.limit || '').trim()) {
                    config.limit = Number(f.limit);
                }
                if (String(f.fallbackValue || '').trim()) {
                    config.fallbackValue = f.fallbackValue;
                }
            }
            if (f.defaultFormula?.trim()) {
                config.defaultFormula = f.defaultFormula.trim();
            }
            if (f.type === 'relation') {
                if (f.relation_database_id) {
                    config.relation_database_id = f.relation_database_id;
                }
                config.cardinality = f.cardinality || 'one-to-many';
            }
            if (f.type === 'files') {
                if (f.file_mode) config.file_mode = f.file_mode;
                if (f.storage_folder) config.storage_folder = f.storage_folder;
                if (f.name_pattern?.trim()) config.name_pattern = f.name_pattern.trim();
            }
            if (f.type === 'button') {
                config.button_action = (f.button_action || 'translate_row').trim();
                if (f.button_label?.trim()) {
                    config.button_label = f.button_label.trim();
                }
                if (f.button_config) {
                    config.button_config = f.button_config;
                }
            }
            if (f.type === 'period') {
                config.duration_enabled = f.duration_enabled !== false;
                config.predecessors_enabled = f.predecessors_enabled !== false;
                config.skip_non_working_days = f.skip_non_working_days !== false;
            }
            // Per-field format (override of the global one): only persisted if it has
            // meaningful values, so that a field without a format derives from the global one.
            if (f.type === 'number' && f.format) {
                const fmt = {};
                if (f.format.kind && f.format.kind !== 'number') fmt.kind = f.format.kind;
                if (f.format.decimals != null && f.format.decimals !== '') fmt.decimals = Number(f.format.decimals);
                if (f.format.currency) fmt.currency = f.format.currency;
                if (Object.keys(fmt).length > 0) config.format = fmt;
            }
            if ((f.type === 'date' || f.type === 'datetime') && f.format?.dateFormat) {
                config.format = { ...(config.format || {}), dateFormat: f.format.dateFormat };
            }
            // Option catalog for select/multi_select/status, in
            // rich {name,color,group} format. With `catalog_ref` (shared catalog)
            // the options live in the root registry and are NOT persisted to the
            // field. If the list ends up empty, we don't write the key so that the
            // field can keep deriving options from the existing values.
            if (OPTION_FIELD_TYPES.has(f.type)) {
                const catalogRef = String(f.catalogRef || '').trim();
                if (catalogRef) {
                    config.catalog_ref = catalogRef;
                } else {
                    const cleaned = normalizeOptions(f.options);
                    if (cleaned.length > 0) {
                        config.options = cleaned;
                    }
                }
                const def = String(f.defaultOption || '').trim();
                if (def && (catalogRef || normalizeOptions(f.options).some((o) => o.name === def))) {
                    config.default_option = def;
                }
            }
            // We only persist `translatable: true` when the field is marked
            // and its type supports it. Otherwise, we don't add the key.
            if (enableTranslation && f.translatable && TRANSLATABLE_FIELD_TYPES.has(f.type)) {
                config.translatable = true;
            }
            if (Object.keys(config).length > 0) {
                newSchemaObj[`${cleanName}_config`] = config;
            }
            if (f.visible) {
                visibleProperties.push(cleanName);
            }
        });
        return { newSchemaObj, visibleProperties };
    };

    // Autosave with debounce: after a change, waits 600ms of inactivity,
    // validates, and sends. If validation fails silently: the state remains
    // unsaved until the user completes the required fields. We only
    // notify with a toast when the server fails — the app's other modals
    // also follow this pattern (silent by default).
    useEffect(() => {
        if (!isOpen) return;
        if (!initializedRef.current) return; // first render: no autosave
        if (skipNextAutosaveRef.current) {
            // The initialization setters just caused this trigger.
            // The payload is identical to the backend's; nothing to save.
            skipNextAutosaveRef.current = false;
            return;
        }
        if (validationError) {
            // Invalid state: nothing is sent (the banner above tells the user why).
            // We also drop any pending save: it belongs to an earlier render and
            // flushing it on unmount would silently persist an outdated payload.
            pendingSaveRef.current = null;
            return;
        }
        // Saves the current state. We save it in a ref so we can trigger it
        // also on unmount (flush) if the debounce hasn't fired yet.
        const doSave = async () => {
            pendingSaveRef.current = null;
            try {
                const { newSchemaObj, visibleProperties } = buildPayload();
                if (onSave) {
                    await onSave(newSchemaObj, { enableSubitems, visibleProperties, enableTranslation, enableDrupalSync, drupalBundle, drupalFieldMapping });
                } else {
                    await axios.post(`/api/vault/schema?folder=${encodeURIComponent(folder)}`, newSchemaObj);
                }
                onSchemaUpdated?.(newSchemaObj);
            } catch (err) {
                console.error(err);
                toast.error(t('schema.error_saving'));
            }
        };
        pendingSaveRef.current = doSave;
        const handle = setTimeout(doSave, 600);
        return () => clearTimeout(handle);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, fields, enableSubitems, enableTranslation, enableDrupalSync, drupalBundle, drupalFieldMapping]);

    // Flush the pending save on unmounting the modal (e.g. closing with Esc or the X
    // right after editing, before the debounce's 600ms). Fire-and-forget:
    // the POST completes even if the component is no longer there. Without this,
    // the autosave effect's `clearTimeout` would cancel the last change.
    useEffect(() => {
        return () => { pendingSaveRef.current?.(); };
    }, []);

    // Closing with Esc — NATIVE listener directly on the modal element (via
    // ref), not on `window`. Tested in the browser with REAL keystrokes: the `window` one
    // didn't respond reliably to a real keypress from a field inside the
    // modal (it did with the X), while a listener on the element did. Deps only
    // [isOpen] to avoid re-binding on every render (the churn left windows where the
    // listener wasn't there). `onClose` is stable in behavior, so
    // capturem directament.
    useEffect(() => {
        if (!isOpen) return;
        // Layer in the global modal stack: this modal can be nested INSIDE
        // of Settings (Notion Import) and having a ConfirmModal on top.
        // Each Esc should only close the top layer (cf. useModalKeyboard).
        const layer = pushModalLayer();
        modalLayerRef.current = layer;
        const el = modalRef.current;
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                if (layer.isTop()) onClose();
            }
        };
        el?.addEventListener('keydown', handleKeyDown);
        // Focus on the scrollable BODY (not the root): this way Esc works (the keydown
        // bubbles up to `el`) and, additionally, it can be scrolled with the keyboard.
        // Giving focus to the root (not scrollable) broke keyboard scrolling.
        scrollRef.current?.focus();
        return () => {
            el?.removeEventListener('keydown', handleKeyDown);
            layer.release();
            modalLayerRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    // Global flag while the modal is open: VaultTable checks it to
    // disable grid cell navigation. Without this, with a
    // active cell, the grid handler (on window) remained EVERY
    // arrow (it moved the cursor under the modal and the preventDefault killed the
    // native scroll of the body) and, with focus on <body>, a letter or ⌫ would edit or
    // was blindly clearing cells beneath the modal.
    useEffect(() => {
        if (!isOpen) return;
        document.body.classList.add('gnosi-modal-open');
        return () => document.body.classList.remove('gnosi-modal-open');
    }, [isOpen]);

    // Keyboard scroll always lives inside the modal. The browser only scrolls
    // the scrollable ancestor of the FOCUSED element, and here focus is lost
    // continuously: a click on the header/frame/backdrop leaves it on <body>
    // (and those keydowns don't even bubble through modalRef: that's why the listener goes
    // on document), and a click "inside" almost always lands on a field, which
    // keeps the focus. Policy depending on where the focus is:
    //  - body or modal chrome: all scroll keys, including Home/End;
    //  - text inputs (the bulk of the modal): arrows and Page Up/Down scroll
    //    (with preventDefault the caret doesn't move), but Home/End and the keys
    //    with Shift (selection) are left for the caret; the input types where
    //    arrows DO work (number, date, radio…) are left untouched;
    //  - select, textarea, and contenteditable: nothing is touched (their own semantics);
    //  - dnd-kit handles ([aria-roledescription]): nothing is touched, since
    //    keyboard drag (Space + arrows) is theirs — that's why space isn't either
    //    is not handled anywhere (enables buttons);
    //  - everything else (including the scrollable body): WE scroll it ourselves with preventDefault.
    //    We never delegate to native scroll: verified live that, even with
    //    the focus to the body and the event clear of preventDefault, Chrome didn't scroll
    //    (and with our preventDefault, there can never be double scrolling);
    //  - focus on another overlay (nested ConfirmModal): nothing is touched.
    useEffect(() => {
        if (!isOpen) return;
        const FLETXES_DEL_CONTROL = new Set(['number', 'range', 'date', 'time', 'datetime-local', 'month', 'week', 'radio']);
        const handler = (e) => {
            if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
            const main = scrollRef.current;
            if (!main) return;
            const t = e.target;
            const focusAlBody = t === document.body || t === document.documentElement;
            const dinsDelModal = t instanceof Element && modalRef.current?.contains(t);
            if (!focusAlBody && !dinsDelModal) return;
            // Esc with focus on <body> (click on the chrome): the Esc listener of
            // modalRef doesn't see these events (they don't bubble there). For the ones inside
            // the modal we never get past here: that listener calls stopPropagation.
            if (e.key === 'Escape' && focusAlBody) {
                if (modalLayerRef.current?.isTop()) onClose();
                return;
            }
            if (dinsDelModal && t.closest('[aria-roledescription]')) return; // nansa dnd-kit
            let nomesVerticals = false;
            const control = dinsDelModal ? t.closest('select, textarea, input, [contenteditable="true"]') : null;
            if (control) {
                const esInputDeText = control.tagName === 'INPUT' && !FLETXES_DEL_CONTROL.has(control.type);
                if (!esInputDeText) return;
                nomesVerticals = true; // Home/End remain for the caret
            }
            const pagina = main.clientHeight * 0.9;
            const salts = { ArrowDown: 48, ArrowUp: -48, PageDown: pagina, PageUp: -pagina };
            if (e.key in salts) {
                main.scrollBy({ top: salts[e.key] });
            } else if (e.key === 'Home' && !nomesVerticals) {
                main.scrollTo({ top: 0 });
            } else if (e.key === 'End' && !nomesVerticals) {
                main.scrollTo({ top: main.scrollHeight });
            } else {
                return;
            }
            e.preventDefault();
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    // Scroll fix (Mac+Chrome): native <select>/<input>/<textarea> absorb
    // the wheel when the cursor is over it and the modal body doesn't scroll. Since
    // this modal is full of controls (fields + Drupal mapping), we redirect
    // the wheel to the scrollable body. Same pattern as GlobalSettingsModal.
    useEffect(() => {
        if (!isOpen) return;
        const handler = (e) => {
            if (e.ctrlKey || e.metaKey) return; // respecta pinch/zoom
            const t = e.target;
            const main = scrollRef.current;
            if (!t || !t.closest || !main || !main.contains(t)) return;
            const tag = t.tagName;
            if (tag !== 'SELECT' && tag !== 'INPUT' && tag !== 'TEXTAREA') return;
            // textarea with its own scroll: let it manage it itself
            if (tag === 'TEXTAREA' && t.scrollHeight > t.clientHeight + 1) return;
            if (main.scrollHeight > main.clientHeight) {
                main.scrollTop += e.deltaY;
                e.preventDefault();
            }
        };
        document.addEventListener('wheel', handler, { passive: false, capture: true });
        return () => document.removeEventListener('wheel', handler, { capture: true });
    }, [isOpen]);

    if (!isOpen) return null;

    // Portal to document.body: when this modal opens from inside the
    // global Settings modal, the `.settings-modal` ancestor has a `transform` (which makes
    // our `fixed inset-0` resolve against THAT box, not the viewport) and
    // `.settings-main` is `overflow-y:auto` with its own wheel handler on
    // capture → scrolling with the cursor was being taken by the background panel. Rendering
    // by going to the body we escape that context (just like this file's internal popover).
    return createPortal(
        <>
        <div
            ref={modalRef}
            className="fixed inset-0 bg-black/60 flex items-center justify-center z-[var(--z-modal-dropdown)] p-4 font-sans backdrop-blur-sm"
        >
            <div className="bg-[var(--bg-primary)] rounded-xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh] border border-[var(--border-primary)]">
                {/* Header */}
                <div className="px-6 py-4 border-b border-[var(--border-primary)] flex justify-between items-center bg-[var(--bg-secondary)] shrink-0">
                    <h2 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
                        <Settings size={20} className="text-[var(--gnosi-primary)]" />
                        {t('schema.manage_properties_of')} {folder}{tableName ? ` · ${tableName}` : ''}
                    </h2>
                    <button onClick={onClose} className="gnosi-close-btn" aria-label={t('common.close', "Close")}>
                        <X />
                    </button>
                </div>

                <div ref={scrollRef} tabIndex={-1} className="gnosi-modal-scroll p-6 overflow-y-auto flex-1 bg-[var(--bg-primary)] outline-none">
                    {/* Autosave paused: this modal saves continuously, so an invalid
                        state means nothing is being persisted. It used to fail in
                        silence and the user only noticed on reopening the modal. */}
                    {validationError && (
                        <div
                            role="alert"
                            className="mb-6 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-[var(--text-primary)]"
                        >
                            <AlertTriangle size={16} className="mt-px shrink-0 text-amber-500" />
                            <span>
                                <strong className="font-semibold">
                                    {t('schema.autosave_paused', "Unsaved changes")}
                                </strong>
                                {' — '}
                                {validationError}
                            </span>
                        </div>
                    )}
                    <div className="bg-[var(--bg-secondary)] p-4 rounded-lg border border-[var(--border-primary)] shadow-sm mb-6 space-y-4">
                        <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
                            <Layers size={16} className="text-[var(--gnosi-primary)]" />
                            {t('schema.table_config')}
                        </h3>

                        <div>
                            <label
                                className={`flex items-center gap-3 group ${enableTranslation ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                                title={enableTranslation ? t('schema.subitems_locked_by_translation', "Subitems are required for translation. Disable “Translatable table” first.") : undefined}
                            >
                                <div className={`w-10 h-6 flex items-center rounded-full p-1 transition-colors ${enableSubitems ? 'bg-[var(--gnosi-primary)]' : 'bg-[var(--text-tertiary)]/20'} ${enableTranslation ? 'opacity-60' : ''}`}>
                                    <input
                                        type="checkbox"
                                        className="hidden"
                                        checked={enableSubitems}
                                        disabled={enableTranslation}
                                        onChange={(e) => {
                                            // Blocked while the table is translatable: the
                                            // translations are persisted as subitems.
                                            if (enableTranslation && !e.target.checked) return;
                                            setEnableSubitems(e.target.checked);
                                        }}
                                    />
                                    <div className={`bg-[var(--bg-primary)] w-4 h-4 rounded-full shadow-sm transform transition-transform ${enableSubitems ? 'translate-x-4' : 'translate-x-0'}`} />
                                </div>
                                <span className="text-sm font-medium text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors">
                                    {t('schema.allow_subitems')}
                                </span>
                            </label>
                            <p className="mt-2 text-xs text-[var(--text-secondary)]/60">
                                {enableTranslation
                                    ? t('schema.subitems_required_for_translation', "Enabled automatically: translations are saved as subitems.")
                                    : t('schema.subitems_hint')}
                            </p>
                        </div>

                        <div className="border-t border-[var(--border-primary)] pt-4">
                            <label className="flex items-center gap-3 cursor-pointer group">
                                <div className={`w-10 h-6 flex items-center rounded-full p-1 transition-colors ${enableTranslation ? 'bg-[var(--gnosi-primary)]' : 'bg-[var(--text-tertiary)]/20'}`}>
                                    <input
                                        type="checkbox"
                                        className="hidden"
                                        checked={enableTranslation}
                                        onChange={(e) => handleToggleTranslation(e.target.checked)}
                                    />
                                    <div className={`bg-[var(--bg-primary)] w-4 h-4 rounded-full shadow-sm transform transition-transform ${enableTranslation ? 'translate-x-4' : 'translate-x-0'}`} />
                                </div>
                                <span className="text-sm font-medium text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors flex items-center gap-1.5">
                                    <Languages size={14} className={enableTranslation ? 'text-[var(--gnosi-primary)]' : 'text-[var(--text-tertiary)]'} />
                                    {t('schema.translation_enabled', "Translatable table")}
                                </span>
                            </label>
                            <p className="mt-2 text-xs text-[var(--text-secondary)]/60">
                                {t('schema.translation_hint', "Lets you mark fields as translatable and add buttons that generate subitems with the translation to other languages.")}
                            </p>
                        </div>

                        <div className="border-t border-[var(--border-primary)] pt-4">
                            <label className="flex items-center gap-3 cursor-pointer group">
                                <div className={`w-10 h-6 flex items-center rounded-full p-1 transition-colors ${enableSocialPublish ? 'bg-[var(--gnosi-primary)]' : 'bg-[var(--text-tertiary)]/20'}`}>
                                    <input
                                        type="checkbox"
                                        className="hidden"
                                        checked={enableSocialPublish}
                                        onChange={(e) => handleToggleSocialPublish(e.target.checked)}
                                    />
                                    <div className={`bg-[var(--bg-primary)] w-4 h-4 rounded-full shadow-sm transform transition-transform ${enableSocialPublish ? 'translate-x-4' : 'translate-x-0'}`} />
                                </div>
                                <span className="text-sm font-medium text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors flex items-center gap-1.5">
                                    <Send size={14} className={enableSocialPublish ? 'text-[var(--gnosi-primary)]' : 'text-[var(--text-tertiary)]'} />
                                    {t('schema.social_publish_enabled', "Publishable to social media")}
                                </span>
                            </label>
                            <p className="mt-2 text-xs text-[var(--text-secondary)]/60">
                                {t('schema.social_publish_hint', "Adds a button to generate with AI and publish the records to the configured social networks.")}
                            </p>
                        </div>

                        <div className="border-t border-[var(--border-primary)] pt-4">
                            <label className="flex items-center gap-3 cursor-pointer group">
                                <div className={`w-10 h-6 flex items-center rounded-full p-1 transition-colors ${enableDrupalSync ? 'bg-[var(--gnosi-primary)]' : 'bg-[var(--text-tertiary)]/20'}`}>
                                    <input
                                        type="checkbox"
                                        className="hidden"
                                        checked={enableDrupalSync}
                                        onChange={(e) => handleToggleDrupalSync(e.target.checked)}
                                    />
                                    <div className={`bg-[var(--bg-primary)] w-4 h-4 rounded-full shadow-sm transform transition-transform ${enableDrupalSync ? 'translate-x-4' : 'translate-x-0'}`} />
                                </div>
                                <span className="text-sm font-medium text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors flex items-center gap-1.5">
                                    <Globe size={14} className={enableDrupalSync ? 'text-[var(--gnosi-primary)]' : 'text-[var(--text-tertiary)]'} />
                                    {t('schema.drupal_sync_enabled', "Sync with Drupal")}
                                </span>
                            </label>
                            <p className="mt-2 text-xs text-[var(--text-secondary)]/60">
                                {t('schema.drupal_sync_hint', "Publishes the records as Drupal nodes. Pick the content type; then map each field from the column list below.")}
                            </p>

                            {enableDrupalSync && (
                                <div className="mt-3 space-y-3">
                                    {drupalError && (
                                        <p className="text-xs text-red-500">{drupalError}</p>
                                    )}
                                    <div className="flex items-center gap-2">
                                        <label className="text-xs font-medium text-[var(--text-secondary)] w-36 shrink-0">
                                            {t('schema.drupal_content_type', "Content type")}
                                        </label>
                                        <select
                                            value={drupalBundle}
                                            onChange={(e) => setDrupalBundle(e.target.value)}
                                            className="flex-1 text-sm px-2 py-1.5 rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)]"
                                        >
                                            <option value="">{drupalLoading && drupalContentTypes.length === 0 ? t('common.loading', "Loading...") : t('schema.drupal_pick_type', "— Pick a type —")}</option>
                                            {drupalContentTypes.map((ct) => (
                                                <option key={ct.machine} value={ct.machine}>{ct.label} ({ct.machine})</option>
                                            ))}
                                            {/* Fallback: if Drupal doesn't respond, show the saved bundle
                                                so it doesn't look like the configuration was lost. */}
                                            {drupalBundle && !drupalContentTypes.some((ct) => ct.machine === drupalBundle) && (
                                                <option value={drupalBundle}>{drupalBundle}</option>
                                            )}
                                        </select>
                                    </div>

                                    {drupalBundle && (
                                        <div className="rounded-lg border border-[var(--border-primary)] overflow-hidden">
                                            <div className="px-3 py-2 bg-[var(--bg-tertiary)] text-xs font-semibold text-[var(--text-secondary)] flex items-center justify-between">
                                                <span>{t('schema.drupal_field_mapping', "Field mapping")}</span>
                                                <span className="text-[var(--text-tertiary)] font-normal">{t('schema.drupal_field_drupal', "Drupal field")}</span>
                                            </div>
                                            <div className="divide-y divide-[var(--border-primary)]">
                                                <div className="flex items-center gap-2 px-3 py-1.5">
                                                    <span className="text-xs italic text-[var(--text-secondary)] w-36 shrink-0 truncate" title={t('schema.drupal_body_hint', "The Markdown text of the page body")}>{t('schema.drupal_body_field', "Page body")}</span>
                                                    <span className="text-[var(--text-tertiary)] text-xs">→</span>
                                                    <select
                                                        value={drupalFieldMapping['__body__'] || ''}
                                                        onChange={(e) => setDrupalFieldMapping((prev) => {
                                                            const next = { ...prev };
                                                            if (e.target.value) next['__body__'] = e.target.value;
                                                            else delete next['__body__'];
                                                            return next;
                                                        })}
                                                        className="flex-1 text-xs px-2 py-1 rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)]"
                                                    >
                                                        <option value="">{t('schema.drupal_no_map', "— Do not sync —")}</option>
                                                        {drupalFields.map((df) => (
                                                            <option key={df.field_name} value={df.field_name}>{df.label} · {df.field_type}</option>
                                                        ))}
                                                        {/* Fallback: saved value even if Drupal doesn't respond. */}
                                                        {drupalFieldMapping['__body__'] && !drupalFields.some((df) => df.field_name === drupalFieldMapping['__body__']) && (
                                                            <option value={drupalFieldMapping['__body__']}>{drupalFieldMapping['__body__']}</option>
                                                        )}
                                                    </select>
                                                </div>
                                                <div className="px-3 py-2 text-[11px] text-[var(--text-secondary)]/60">
                                                    {t('schema.drupal_perfield_note', "Each field's mapping is configured in the column list below, next to each field.")}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                    {drupalBundle && tableId && (
                                        <button
                                            type="button"
                                            onClick={handleMatchExisting}
                                            disabled={matching}
                                            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] disabled:opacity-50"
                                            title={t('schema.drupal_match_hint', "Searches Drupal for existing nodes by title and fills their NID/URL into the rows (creates nothing).")}
                                        >
                                            {matching ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />}
                                            {t('schema.drupal_match_existing', "Link existing records by title")}
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>

                    </div>

                    <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2 px-1">
                        {t('schema.columns_and_properties')}
                    </h3>
                    <p className="text-xs text-[var(--text-secondary)]/60 mb-4 px-1">
                        {t('schema.columns_hint')}
                    </p>

                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                        <SortableContext items={fields.map(f => f.id)} strategy={verticalListSortingStrategy}>
                            <div className="space-y-3">
                                {fields.map((field, idx) => (
                                    <SortableField
                                        key={field.id}
                                        field={field}
                                        idx={idx}
                                        allFields={fields}
                                        allTables={allTables}
                                        currentTableName={resolvedTableName}
                                        virtualComputers={virtualComputers}
                                        handleUpdateField={handleUpdateField}
                                        handleRemoveField={handleRemoveField}
                                        enableTranslation={enableTranslation}
                                        enableDrupalSync={enableDrupalSync}
                                        drupalBundle={drupalBundle}
                                        drupalFields={drupalFields}
                                        drupalFieldMapping={drupalFieldMapping}
                                        setDrupalFieldMapping={setDrupalFieldMapping}
                                        optionTools={optionTools}
                                        projectPlanningEnabled={projectPlanningEnabled}
                                        setAiActionModalFieldIndex={setAiActionModalFieldIndex}
                                        availableSkills={availableSkills}
                                    />
                                ))}
                            </div>
                        </SortableContext>
                    </DndContext>

                    <button
                        onClick={handleAddField}
                        className="btn-gnosi btn-gnosi-primary !text-xs !py-2 !px-4 mt-5"
                    >
                        <Plus size={16} /> {t('schema.add_property')}
                    </button>
                </div>

            </div>
        </div>

        <ConfirmModal
            isOpen={confirmRemoveField.isOpen}
            onClose={() => setConfirmRemoveField({ isOpen: false, index: null, name: '' })}
            onConfirm={executeRemoveField}
            title={t('schema.confirm_remove_field_title', "Delete property")}
            message={t('schema.confirm_remove_field_message', { name: confirmRemoveField.name, defaultValue: "Are you sure you want to delete the property “{{name}}”? This action cannot be undone." })}
            confirmText={t('schema.confirm_remove_field_confirm', "Delete")}
            isDestructive={true}
        />

        <ConfirmModal
            isOpen={toggleConfirm.isOpen}
            onClose={closeToggleConfirm}
            onConfirm={async () => { await toggleConfirm.onConfirm?.(); closeToggleConfirm(); }}
            title={toggleConfirm.title}
            message={toggleConfirm.message}
            confirmText={toggleConfirm.confirmText || t('schema.disable', "Disable")}
            cancelText={t('common.cancel', "Cancel")}
            isDestructive={true}
        />

        {/* AI Action Programmer Modal — rendered through its OWN portal so it
            stacks above this modal's backdrop (which creates its own stacking
            context and would otherwise swallow the nested z-index). */}
        {aiActionModalFieldIndex !== null && createPortal(
            <div className="fixed inset-0 z-[10100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
                <div className="w-full max-w-md bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl shadow-2xl overflow-hidden flex flex-col">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]">
                        <div className="flex items-center gap-2 text-[var(--gnosi-primary)] font-semibold text-sm">
                            <Sparkles size={16} />
                            <span>{t('schema.button_ai_modal_title', "Program button action with AI")}</span>
                        </div>
                        <button
                            type="button"
                            onClick={() => setAiActionModalFieldIndex(null)}
                            className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] p-1 rounded-md"
                        >
                            <X size={16} />
                        </button>
                    </div>
                    <div className="p-4 space-y-3">
                        <p className="text-xs text-[var(--text-secondary)]">
                            {t('schema.button_ai_modal_desc', "Describe in natural language what action you want this button to perform.")}
                        </p>
                        <textarea
                            rows={4}
                            value={aiActionPrompt}
                            onChange={(e) => setAiActionPrompt(e.target.value)}
                            placeholder={t('schema.button_ai_modal_placeholder', "Type your request here...")}
                            className="w-full text-xs p-2.5 border border-[var(--border-primary)] rounded-lg bg-[var(--bg-primary)] text-[var(--text-primary)] focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 outline-none resize-none"
                            autoFocus
                        />
                    </div>
                    <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[var(--border-primary)] bg-[var(--bg-secondary)]">
                        <button
                            type="button"
                            onClick={() => setAiActionModalFieldIndex(null)}
                            className="px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded-md transition-colors"
                        >
                            {t('common.cancel', "Cancel")}
                        </button>
                        <button
                            type="button"
                            disabled={!aiActionPrompt.trim() || aiActionLoading}
                            onClick={handleGenerateAiAction}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-[var(--gnosi-primary)] hover:opacity-90 text-white disabled:opacity-50 transition-colors shadow-sm cursor-pointer"
                        >
                            {aiActionLoading ? (
                                <>
                                    <Loader2 size={12} className="animate-spin" />
                                    <span>{t('schema.button_ai_generating', "Generant...")}</span>
                                </>
                            ) : (
                                <>
                                    <Sparkles size={12} />
                                    <span>{t('schema.button_program_ai', "Programar amb IA ✨")}</span>
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>,
            document.body
        )}
        </>,
        document.body
    );
}
