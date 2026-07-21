import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Plus, Trash2, GripVertical, Eye, EyeOff } from 'lucide-react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';

// ── Constants ─────────────────────────────────────────────────────────────────
// `label` keeps the original Catalan text as the i18n fallback default; `labelKey`
// is the translation key resolved via t() at each render site (see FieldRow/FilterRow
// below). `key`/`value` fields are stored/compared identifiers and are never translated.

const ALL_FIELDS = [
    { key: 'sender',          label: 'De',         labelKey: 'mail.from_label' },
    { key: 'recipient',       label: 'Per a',       labelKey: 'mail.to_label' },
    { key: 'cc',              label: 'CC',          labelKey: 'mail.cc_label' },
    { key: 'bcc',             label: 'CCO',         labelKey: 'mail.bcc_label' },
    { key: 'subject',         label: 'Assumpte',    labelKey: 'mail.subject_label' },
    { key: 'labels',          label: 'Etiquetes',   labelKey: 'mail.labels' },
    { key: 'has_attachments', label: 'Arxius',      labelKey: 'mail_view_editor.field_attachments' },
    { key: 'date',            label: 'Data',        labelKey: 'mail.date_label' },
    { key: 'snippet',         label: 'Extracte',    labelKey: 'mail_view_editor.field_snippet' },
    { key: 'category',        label: 'Categoria',   labelKey: 'mail_view_editor.field_category' },
];

const DEFAULT_FIELDS = ALL_FIELDS.map((f, i) => ({ key: f.key, visible: true, order: i }));

const FILTER_FIELDS = [
    { key: 'sender',          label: 'De',           labelKey: 'mail.from_label',                     type: 'text' },
    { key: 'recipient',       label: 'Per a',        labelKey: 'mail.to_label',                        type: 'text' },
    { key: 'cc',              label: 'CC',            labelKey: 'mail.cc_label',                       type: 'text' },
    { key: 'bcc',             label: 'CCO',           labelKey: 'mail.bcc_label',                       type: 'text' },
    { key: 'subject',         label: 'Assumpte',     labelKey: 'mail.subject_label',                   type: 'text' },
    { key: 'category',        label: 'Categoria',    labelKey: 'mail_view_editor.field_category',       type: 'text' },
    { key: 'labels',          label: 'Etiquetes',    labelKey: 'mail.labels',                           type: 'text' },
    { key: 'is_read',         label: 'Llegit',       labelKey: 'mail_view_editor.field_read',           type: 'bool' },
    { key: 'has_attachments', label: 'Té adjunts',   labelKey: 'mail_view_editor.field_has_attachments', type: 'bool' },
    { key: 'archived',        label: 'Arxivat',      labelKey: 'mail.undo_label_archived',              type: 'bool' },
    { key: 'is_starred',      label: 'Destacat',     labelKey: 'mail_view_editor.field_starred',         type: 'bool' },
    { key: 'timestamp',       label: 'Data',         labelKey: 'mail.date_label',                       type: 'date' },
];

const TEXT_OPERATORS = [
    { value: 'contains',    label: 'conté',        labelKey: 'view_config.operators.contains' },
    { value: 'starts_with', label: 'comença per',  labelKey: 'mail_view_editor.operator_starts_with' },
    { value: 'equals',      label: 'és igual a',   labelKey: 'view_config.operators.equals' },
    { value: 'is_not',      label: 'no és',        labelKey: 'mail_view_editor.operator_is_not' },
];

const BOOL_OPERATORS = [
    { value: 'is',     label: 'és',     labelKey: 'mail_view_editor.operator_is' },
    { value: 'is_not', label: 'no és',  labelKey: 'mail_view_editor.operator_is_not' },
];

const DATE_OPERATORS = [
    { value: 'before', label: 'abans de',     labelKey: 'mail_view_editor.operator_before' },
    { value: 'after',  label: 'després de',   labelKey: 'mail_view_editor.operator_after' },
];

const ALL_ACTIONS = [
    { value: 'archive',   label: 'Arxivar',       labelKey: 'mail.archive_action' },
    { value: 'trash',     label: 'Eliminar',      labelKey: 'mail.delete_action' },
    { value: 'mark_read', label: 'Marcar llegit', labelKey: 'mail_view_editor.action_mark_read' },
    { value: 'star',      label: 'Destacar',      labelKey: 'mail_view_editor.action_star' },
    { value: 'snooze',    label: 'Ajornar',       labelKey: 'mail_view_editor.action_snooze' },
    { value: 'reply',     label: 'Respondre',     labelKey: 'mail_view_editor.action_reply' },
];

const DEFAULT_VIEW = {
    name: '',
    fields: DEFAULT_FIELDS,
    filters: [],
    filter_logic: 'AND',
    group_by: 'none',
    sort_by: 'date',
    sort_dir: 'desc',
    actions: ['archive', 'trash', 'mark_read'],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function getOperatorsForField(fieldKey) {
    const field = FILTER_FIELDS.find(f => f.key === fieldKey);
    if (!field) return TEXT_OPERATORS;
    if (field.type === 'bool') return BOOL_OPERATORS;
    if (field.type === 'date') return DATE_OPERATORS;
    return TEXT_OPERATORS;
}

function defaultValueForField(fieldKey) {
    const field = FILTER_FIELDS.find(f => f.key === fieldKey);
    if (!field) return '';
    if (field.type === 'bool') return true;
    if (field.type === 'date') return new Date().toISOString().slice(0, 10);
    return '';
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionTitle({ children }) {
    return (
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-2">
            {children}
        </h3>
    );
}

function Pills({ options, value, onChange }) {
    return (
        <div className="flex items-center gap-1 bg-[var(--bg-secondary)] rounded-lg p-0.5 flex-wrap">
            {options.map(o => (
                <button
                    key={o.value}
                    type="button"
                    onClick={() => onChange(o.value)}
                    className={`px-3 py-1 rounded-md text-[12px] font-semibold transition-all ${
                        value === o.value
                            ? 'bg-[var(--bg-primary)] text-[var(--gnosi-blue)] shadow-sm'
                            : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                >
                    {o.label}
                </button>
            ))}
        </div>
    );
}

// Sortable row: drag to reorder (dnd-kit, same pattern as SchemaConfigModal),
// eye toggle to show/hide.
function FieldRow({ field, onToggle }) {
    const { t } = useTranslation();
    const meta = ALL_FIELDS.find(f => f.key === field.key);
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.key });
    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.9 : 1,
        zIndex: isDragging ? 50 : 1,
        position: 'relative',
    };
    return (
        <div
            ref={setNodeRef}
            style={style}
            className={`flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-[var(--bg-secondary)] group ${isDragging ? 'bg-[var(--bg-secondary)] shadow-md ring-1 ring-[var(--gnosi-primary)]/30' : ''}`}
        >
            <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing shrink-0 text-[var(--text-tertiary)] hover:text-[var(--gnosi-primary)]">
                <GripVertical size={13} />
            </div>
            <span className="flex-1 text-[13px] text-[var(--text-primary)]">{meta ? t(meta.labelKey, meta.label) : field.key}</span>
            <button
                type="button"
                onClick={() => onToggle(field.key)}
                className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                title={field.visible ? t('mail_view_editor.hide_field', 'Amagar') : t('mail_view_editor.show_field', 'Mostrar')}
            >
                {field.visible ? <Eye size={14} /> : <EyeOff size={14} className="opacity-40" />}
            </button>
        </div>
    );
}

function FilterRow({ filter, index, onChange, onRemove }) {
    const { t } = useTranslation();
    const fieldMeta = FILTER_FIELDS.find(f => f.key === filter.field);
    const operators = getOperatorsForField(filter.field);

    const handleFieldChange = (newField) => {
        const ops = getOperatorsForField(newField);
        onChange(index, { field: newField, operator: ops[0].value, value: defaultValueForField(newField) });
    };

    return (
        <div className="flex items-center gap-2 p-2 bg-[var(--bg-secondary)] rounded-lg">
            {/* Field */}
            <select
                value={filter.field}
                onChange={e => handleFieldChange(e.target.value)}
                className="text-[12px] bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-md px-2 py-1 text-[var(--text-primary)] flex-1 min-w-0"
            >
                {FILTER_FIELDS.map(f => (
                    <option key={f.key} value={f.key}>{t(f.labelKey, f.label)}</option>
                ))}
            </select>

            {/* Operator */}
            <select
                value={filter.operator}
                onChange={e => onChange(index, { ...filter, operator: e.target.value })}
                className="text-[12px] bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-md px-2 py-1 text-[var(--text-primary)] shrink-0"
            >
                {operators.map(o => (
                    <option key={o.value} value={o.value}>{t(o.labelKey, o.label)}</option>
                ))}
            </select>

            {/* Value */}
            {fieldMeta?.type === 'bool' ? (
                <select
                    value={String(filter.value)}
                    onChange={e => onChange(index, { ...filter, value: e.target.value === 'true' })}
                    className="text-[12px] bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-md px-2 py-1 text-[var(--text-primary)] shrink-0"
                >
                    <option value="true">{t('common.yes', 'Sí')}</option>
                    <option value="false">{t('mail_view_editor.bool_no', 'No')}</option>
                </select>
            ) : fieldMeta?.type === 'date' ? (
                <input
                    type="date"
                    value={filter.value || ''}
                    onChange={e => onChange(index, { ...filter, value: e.target.value })}
                    className="text-[12px] bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-md px-2 py-1 text-[var(--text-primary)] shrink-0"
                />
            ) : (
                <input
                    type="text"
                    value={filter.value || ''}
                    onChange={e => onChange(index, { ...filter, value: e.target.value })}
                    placeholder={t('view_config.value_placeholder', 'Valor...')}
                    className="text-[12px] bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-md px-2 py-1 text-[var(--text-primary)] flex-1 min-w-0"
                />
            )}

            <button
                type="button"
                onClick={() => onRemove(index)}
                className="text-[var(--text-secondary)] hover:text-red-500 transition-colors shrink-0"
            >
                <Trash2 size={13} />
            </button>
        </div>
    );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MailViewEditor({ initialView = null, onSave, onCancel }) {
    const { t } = useTranslation();
    const [form, setForm] = useState(() => {
        if (initialView) return { ...DEFAULT_VIEW, ...initialView };
        return { ...DEFAULT_VIEW, fields: DEFAULT_FIELDS };
    });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    const set = (key, val) => setForm(prev => ({ ...prev, [key]: val }));

    const toggleField = (key) => {
        setForm(prev => ({
            ...prev,
            fields: prev.fields.map(f => f.key === key ? { ...f, visible: !f.visible } : f),
        }));
    };

    // Drag-and-drop reorder of the visible-fields list; keeps `order` in sync
    // with the array position (the persisted contract of view.fields).
    const dndSensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );
    const handleFieldDragEnd = ({ active, over }) => {
        if (!active || !over || active.id === over.id) return;
        setForm(prev => {
            const oldIndex = prev.fields.findIndex(f => f.key === active.id);
            const newIndex = prev.fields.findIndex(f => f.key === over.id);
            if (oldIndex === -1 || newIndex === -1) return prev;
            const fields = arrayMove(prev.fields, oldIndex, newIndex).map((f, i) => ({ ...f, order: i }));
            return { ...prev, fields };
        });
    };

    const addFilter = () => {
        const firstField = FILTER_FIELDS[0];
        const ops = getOperatorsForField(firstField.key);
        setForm(prev => ({
            ...prev,
            filters: [...prev.filters, {
                field: firstField.key,
                operator: ops[0].value,
                value: defaultValueForField(firstField.key),
            }],
        }));
    };

    const updateFilter = (index, updated) => {
        setForm(prev => ({
            ...prev,
            filters: prev.filters.map((f, i) => i === index ? updated : f),
        }));
    };

    const removeFilter = (index) => {
        setForm(prev => ({ ...prev, filters: prev.filters.filter((_, i) => i !== index) }));
    };

    const toggleAction = (value) => {
        setForm(prev => ({
            ...prev,
            actions: prev.actions.includes(value)
                ? prev.actions.filter(a => a !== value)
                : [...prev.actions, value],
        }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.name.trim()) { setError(t('mail_view_editor.error_name_required', 'Cal un nom per a la vista')); return; }
        setSaving(true);
        setError(null);
        try {
            await onSave(form);
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    const formRef = useRef(null);
    // Esc cancels (closes the editor). Enter saves via the form's native submit.
    useModalKeyboard({ isOpen: true, onClose: onCancel, containerRef: formRef });

    return (
        <div
            className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-black/40 backdrop-blur-sm"
            onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
        >
            <form
                ref={formRef}
                onSubmit={handleSubmit}
                onMouseDown={(e) => e.stopPropagation()}
                className="w-full max-w-lg bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden"
            >
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-primary)] shrink-0">
                    <h2 className="text-[15px] font-bold text-[var(--text-primary)]">
                        {initialView ? t('mail_view_editor.edit_title', 'Editar vista') : t('view.new_view', 'Nova vista')}
                    </h2>
                    <button type="button" onClick={onCancel} className="p-1.5 hover:bg-[var(--bg-secondary)] rounded-lg text-[var(--text-secondary)] transition-colors">
                        <X size={15} />
                    </button>
                </div>

                {/* Scrollable body */}
                <div className="overflow-y-auto flex-1 px-5 py-4 space-y-5">

                    {/* Name */}
                    <div>
                        <SectionTitle>{t('mail_view_editor.section_name', 'Nom')}</SectionTitle>
                        <input
                            type="text"
                            value={form.name}
                            onChange={e => set('name', e.target.value)}
                            placeholder={t('mail_view_editor.name_placeholder', 'Ex: Newsletters, Feina...')}
                            data-autofocus="true"
                            className="w-full text-[13px] bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg px-3 py-2 text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none focus:border-[var(--gnosi-blue)]"
                        />
                    </div>

                    {/* Fields */}
                    <div>
                        <SectionTitle>{t('mail_view_editor.section_fields', 'Camps visibles')}</SectionTitle>
                        <div className="border border-[var(--border-primary)] rounded-xl overflow-hidden">
                            <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleFieldDragEnd}>
                                <SortableContext items={form.fields.map(f => f.key)} strategy={verticalListSortingStrategy}>
                                    {form.fields.map(field => (
                                        <FieldRow
                                            key={field.key}
                                            field={field}
                                            onToggle={toggleField}
                                        />
                                    ))}
                                </SortableContext>
                            </DndContext>
                        </div>
                    </div>

                    {/* Filters */}
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <SectionTitle>{t('view.tab_filters', 'Filtres')}</SectionTitle>
                            {form.filters.length > 1 && (
                                <Pills
                                    options={[
                                        { value: 'AND', label: t('mail_view_editor.logic_and', 'I (AND)') },
                                        { value: 'OR', label: t('mail_view_editor.logic_or', 'O (OR)') },
                                    ]}
                                    value={form.filter_logic}
                                    onChange={v => set('filter_logic', v)}
                                />
                            )}
                        </div>
                        <div className="space-y-2">
                            {form.filters.map((f, i) => (
                                <FilterRow
                                    key={i}
                                    filter={f}
                                    index={i}
                                    onChange={updateFilter}
                                    onRemove={removeFilter}
                                />
                            ))}
                        </div>
                        <button
                            type="button"
                            onClick={addFilter}
                            className="mt-2 flex items-center gap-1.5 text-[12px] text-[var(--gnosi-blue)] hover:opacity-80 transition-opacity font-medium"
                        >
                            <Plus size={13} /> {t('view.add_filter', 'Afegir filtre')}
                        </button>
                    </div>

                    {/* Grouping & Sort */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <SectionTitle>{t('mail_view_editor.section_group_by', 'Agrupar per')}</SectionTitle>
                            <select
                                value={form.group_by}
                                onChange={e => set('group_by', e.target.value)}
                                className="w-full text-[12px] bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg px-3 py-2 text-[var(--text-primary)]"
                            >
                                <option value="none">{t('table.none', 'Cap')}</option>
                                <option value="date">{t('mail.date_label', 'Data')}</option>
                                <option value="sender">{t('mail_view_editor.option_sender', 'Remitent')}</option>
                                <option value="category">{t('mail_view_editor.field_category', 'Categoria')}</option>
                                <option value="label">{t('mail_view_editor.option_label', 'Etiqueta')}</option>
                            </select>
                        </div>
                        <div>
                            <SectionTitle>{t('mail_view_editor.section_sort_by', 'Ordenar per')}</SectionTitle>
                            <div className="flex gap-1">
                                <select
                                    value={form.sort_by}
                                    onChange={e => set('sort_by', e.target.value)}
                                    className="flex-1 text-[12px] bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg px-3 py-2 text-[var(--text-primary)]"
                                >
                                    <option value="date">{t('mail.date_label', 'Data')}</option>
                                    <option value="sender">{t('mail_view_editor.option_sender', 'Remitent')}</option>
                                    <option value="subject">{t('mail.subject_label', 'Assumpte')}</option>
                                </select>
                                <button
                                    type="button"
                                    onClick={() => set('sort_dir', form.sort_dir === 'asc' ? 'desc' : 'asc')}
                                    className="px-2.5 text-[13px] bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                                    title={form.sort_dir === 'asc' ? t('view.asc', 'Ascendent') : t('view.desc', 'Descendent')}
                                >
                                    {form.sort_dir === 'asc' ? '↑' : '↓'}
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Actions */}
                    <div>
                        <SectionTitle>{t('mail_view_editor.section_actions', 'Accions disponibles')}</SectionTitle>
                        <div className="flex flex-wrap gap-2">
                            {ALL_ACTIONS.map(a => (
                                <button
                                    key={a.value}
                                    type="button"
                                    onClick={() => toggleAction(a.value)}
                                    className={`px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-all ${
                                        form.actions.includes(a.value)
                                            ? 'bg-[var(--gnosi-blue)] text-white border-[var(--gnosi-blue)]'
                                            : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] border-[var(--border-primary)] hover:border-[var(--gnosi-blue)]'
                                    }`}
                                >
                                    {t(a.labelKey, a.label)}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-[var(--border-primary)] shrink-0">
                    {error && <p className="text-[12px] text-red-500 flex-1">{error}</p>}
                    <div className="flex gap-2 ml-auto">
                        <button
                            type="button"
                            onClick={onCancel}
                            className="px-4 py-2 text-[13px] rounded-lg border border-[var(--border-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                        >
                            {t('common.cancel', 'Cancel·lar')}
                        </button>
                        <button
                            type="submit"
                            disabled={saving}
                            className="px-4 py-2 text-[13px] font-semibold rounded-lg bg-[var(--gnosi-blue)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                        >
                            {saving ? t('view.saving', 'Desant...') : (initialView ? t('common.save', 'Desar') : t('common.create', 'Crear'))}
                        </button>
                    </div>
                </div>
            </form>
        </div>
    );
}
