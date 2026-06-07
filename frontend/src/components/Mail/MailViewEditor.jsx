import { useState, useRef } from 'react';
import { X, Plus, Trash2, GripVertical, Eye, EyeOff } from 'lucide-react';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';

// ── Constants ─────────────────────────────────────────────────────────────────

const ALL_FIELDS = [
    { key: 'sender',          label: 'De' },
    { key: 'recipient',       label: 'Per a' },
    { key: 'cc',              label: 'CC' },
    { key: 'bcc',             label: 'CCO' },
    { key: 'subject',         label: 'Assumpte' },
    { key: 'labels',          label: 'Etiquetes' },
    { key: 'has_attachments', label: 'Arxius' },
    { key: 'date',            label: 'Data' },
    { key: 'snippet',         label: 'Extracte' },
    { key: 'category',        label: 'Categoria' },
];

const DEFAULT_FIELDS = ALL_FIELDS.map((f, i) => ({ key: f.key, visible: true, order: i }));

const FILTER_FIELDS = [
    { key: 'sender',          label: 'De',           type: 'text' },
    { key: 'recipient',       label: 'Per a',        type: 'text' },
    { key: 'cc',              label: 'CC',            type: 'text' },
    { key: 'bcc',             label: 'CCO',           type: 'text' },
    { key: 'subject',         label: 'Assumpte',     type: 'text' },
    { key: 'category',        label: 'Categoria',    type: 'text' },
    { key: 'labels',          label: 'Etiquetes',    type: 'text' },
    { key: 'is_read',         label: 'Llegit',       type: 'bool' },
    { key: 'has_attachments', label: 'Té adjunts',   type: 'bool' },
    { key: 'archived',        label: 'Arxivat',      type: 'bool' },
    { key: 'is_starred',      label: 'Destacat',     type: 'bool' },
    { key: 'timestamp',       label: 'Data',         type: 'date' },
];

const TEXT_OPERATORS = [
    { value: 'contains',    label: 'conté' },
    { value: 'starts_with', label: 'comença per' },
    { value: 'equals',      label: 'és igual a' },
    { value: 'is_not',      label: 'no és' },
];

const BOOL_OPERATORS = [
    { value: 'is',     label: 'és' },
    { value: 'is_not', label: 'no és' },
];

const DATE_OPERATORS = [
    { value: 'before', label: 'abans de' },
    { value: 'after',  label: 'després de' },
];

const ALL_ACTIONS = [
    { value: 'archive',   label: 'Arxivar' },
    { value: 'trash',     label: 'Eliminar' },
    { value: 'mark_read', label: 'Marcar llegit' },
    { value: 'star',      label: 'Destacar' },
    { value: 'snooze',    label: 'Ajornar' },
    { value: 'reply',     label: 'Respondre' },
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

function FieldRow({ field, onToggle }) {
    const meta = ALL_FIELDS.find(f => f.key === field.key);
    return (
        <div className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-[var(--bg-secondary)] group">
            <GripVertical size={13} className="text-[var(--text-tertiary)] cursor-grab shrink-0" />
            <span className="flex-1 text-[13px] text-[var(--text-primary)]">{meta?.label ?? field.key}</span>
            <button
                type="button"
                onClick={() => onToggle(field.key)}
                className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                title={field.visible ? 'Amagar' : 'Mostrar'}
            >
                {field.visible ? <Eye size={14} /> : <EyeOff size={14} className="opacity-40" />}
            </button>
        </div>
    );
}

function FilterRow({ filter, index, onChange, onRemove }) {
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
                    <option key={f.key} value={f.key}>{f.label}</option>
                ))}
            </select>

            {/* Operator */}
            <select
                value={filter.operator}
                onChange={e => onChange(index, { ...filter, operator: e.target.value })}
                className="text-[12px] bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-md px-2 py-1 text-[var(--text-primary)] shrink-0"
            >
                {operators.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                ))}
            </select>

            {/* Value */}
            {fieldMeta?.type === 'bool' ? (
                <select
                    value={String(filter.value)}
                    onChange={e => onChange(index, { ...filter, value: e.target.value === 'true' })}
                    className="text-[12px] bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-md px-2 py-1 text-[var(--text-primary)] shrink-0"
                >
                    <option value="true">Sí</option>
                    <option value="false">No</option>
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
                    placeholder="Valor..."
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
        if (!form.name.trim()) { setError('Cal un nom per a la vista'); return; }
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
    // Esc cancel·la (tanca l'editor). Enter desa via el submit natiu del form.
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
                        {initialView ? 'Editar vista' : 'Nova vista'}
                    </h2>
                    <button type="button" onClick={onCancel} className="p-1.5 hover:bg-[var(--bg-secondary)] rounded-lg text-[var(--text-secondary)] transition-colors">
                        <X size={15} />
                    </button>
                </div>

                {/* Scrollable body */}
                <div className="overflow-y-auto flex-1 px-5 py-4 space-y-5">

                    {/* Name */}
                    <div>
                        <SectionTitle>Nom</SectionTitle>
                        <input
                            type="text"
                            value={form.name}
                            onChange={e => set('name', e.target.value)}
                            placeholder="Ex: Newsletters, Feina..."
                            autoFocus
                            className="w-full text-[13px] bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg px-3 py-2 text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none focus:border-[var(--gnosi-blue)]"
                        />
                    </div>

                    {/* Fields */}
                    <div>
                        <SectionTitle>Camps visibles</SectionTitle>
                        <div className="border border-[var(--border-primary)] rounded-xl overflow-hidden">
                            {form.fields.map((field, i) => (
                                <FieldRow
                                    key={field.key}
                                    field={field}
                                    onToggle={toggleField}
                                    isFirst={i === 0}
                                    isLast={i === form.fields.length - 1}
                                />
                            ))}
                        </div>
                    </div>

                    {/* Filters */}
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <SectionTitle>Filtres</SectionTitle>
                            {form.filters.length > 1 && (
                                <Pills
                                    options={[{ value: 'AND', label: 'I (AND)' }, { value: 'OR', label: 'O (OR)' }]}
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
                            <Plus size={13} /> Afegir filtre
                        </button>
                    </div>

                    {/* Grouping & Sort */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <SectionTitle>Agrupar per</SectionTitle>
                            <select
                                value={form.group_by}
                                onChange={e => set('group_by', e.target.value)}
                                className="w-full text-[12px] bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg px-3 py-2 text-[var(--text-primary)]"
                            >
                                <option value="none">Cap</option>
                                <option value="date">Data</option>
                                <option value="sender">Remitent</option>
                                <option value="category">Categoria</option>
                                <option value="label">Etiqueta</option>
                            </select>
                        </div>
                        <div>
                            <SectionTitle>Ordenar per</SectionTitle>
                            <div className="flex gap-1">
                                <select
                                    value={form.sort_by}
                                    onChange={e => set('sort_by', e.target.value)}
                                    className="flex-1 text-[12px] bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg px-3 py-2 text-[var(--text-primary)]"
                                >
                                    <option value="date">Data</option>
                                    <option value="sender">Remitent</option>
                                    <option value="subject">Assumpte</option>
                                </select>
                                <button
                                    type="button"
                                    onClick={() => set('sort_dir', form.sort_dir === 'asc' ? 'desc' : 'asc')}
                                    className="px-2.5 text-[13px] bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                                    title={form.sort_dir === 'asc' ? 'Ascendent' : 'Descendent'}
                                >
                                    {form.sort_dir === 'asc' ? '↑' : '↓'}
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Actions */}
                    <div>
                        <SectionTitle>Accions disponibles</SectionTitle>
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
                                    {a.label}
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
                            Cancel·lar
                        </button>
                        <button
                            type="submit"
                            disabled={saving}
                            className="px-4 py-2 text-[13px] font-semibold rounded-lg bg-[var(--gnosi-blue)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                        >
                            {saving ? 'Desant...' : (initialView ? 'Desar' : 'Crear')}
                        </button>
                    </div>
                </div>
            </form>
        </div>
    );
}
