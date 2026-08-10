import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X, Eye, Filter, ArrowUpDown, SlidersHorizontal, Plus, Trash2, GripVertical, Layers } from 'lucide-react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import ConfirmModal from '../ConfirmModal';
import { MAIN_VIEW_NAME, VIEW_TYPES } from './viewConstants';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';
import { discoverFieldNamesFromRecords } from './schemaUtils';
import { normalizeOptions } from './optionCatalogUtils';

/**
 * Modal for adding a DB view to a page (slash command /vista).
 *
 * Supports multiple filters, sorting, and a checkbox property selector.
 * Optionally, saves the view to the table's registry (registry.views[]) to
 * reuse it from the table's own page.
 *
 * Backend: POST /api/vault/views (saved view) + POST /api/pages/{id}/views
 * (embed with view_id).
 */
const FILTER_OPERATORS = [
    { value: 'equals', label: 'equals' },
    { value: 'not_equals', label: 'does not equal' },
    { value: 'contains', label: 'contains' },
    { value: 'not_contains', label: 'does not contain' },
    { value: 'is_empty', label: 'is empty' },
    { value: 'is_not_empty', label: 'is not empty' },
    { value: 'greater_than', label: 'greater than' },
    { value: 'greater_than_or_equal', label: 'greater than or equal' },
    { value: 'less_than', label: 'less than' },
    { value: 'less_than_or_equal', label: 'less than or equal' },
];

// --- View-type-specific configuration options ---
// The GALLERY accepts a card size and a preview mode; the
// KANBAN a grouping field; CALENDAR/TIMELINE one (or two) date fields.
// The values live in the view (registry, free-form dict) and the renderer honors them.
const CARD_SIZES = [
    { value: 'small', label: 'Small' },
    { value: 'medium', label: 'Medium' },
    { value: 'large', label: 'Large' },
];
const GALLERY_PREVIEWS = [
    { value: 'cover', label: 'Cover', hint: 'Page cover image and properties.' },
    { value: 'content', label: 'Content', hint: 'A snippet of page text and its properties.' },
    { value: 'properties', label: 'Properties only', hint: 'No image; title and properties.' },
    { value: 'none', label: 'Title only', hint: 'Minimal card with cover and title, without properties.' },
];
// Valid schema types for each control: Kanban grouping (fields with a
// bounded set of values) and calendar/timeline temporal axis.
const GROUP_FIELD_TYPES = new Set(['select', 'status', 'multi_select']);
const DATE_FIELD_TYPES = new Set(['date', 'datetime', 'period']);
const NUMERIC_FIELD_TYPES = new Set(['number', 'formula', 'rollup', 'currency', 'percent']);

const TABS = [
    { id: 'general', icon: SlidersHorizontal, label: 'General' },
    { id: 'properties', icon: Eye, label: 'Fields' },
    { id: 'filters', icon: Filter, label: 'Filters' },
    { id: 'sort', icon: ArrowUpDown, label: 'Sort' },
    { id: 'grouping', icon: Layers, label: 'Grouping' },
];

/**
 * Generic sortable row with a drag handle (dnd-kit), shared by the
 * visible-columns and sort-criteria lists. Same pattern as
 * SchemaConfigModal so reordering feels identical across the app.
 */
function SortableRow({ id, className = '', gripSize = 14, children }) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
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
            className={`${className} ${isDragging ? 'bg-[var(--bg-tertiary)] shadow-md ring-1 ring-[var(--gnosi-primary)]/30' : ''}`}
        >
            <div
                {...attributes}
                {...listeners}
                className="cursor-grab active:cursor-grabbing p-1 rounded text-[var(--text-tertiary)]/40 hover:text-[var(--gnosi-primary)]"
            >
                <GripVertical size={gripSize} />
            </div>
            {children}
        </div>
    );
}

/**
 * Searchable selector for a RELATION filter's value. Instead of free
 * text (prone to typos like "thiis"), it offers a dropdown with:
 *  - "This page" (special value `this` = id of the page where it's embedded),
 *  - the titles of the related table's records (value = id),
 *  with a search box to filter and keyboard navigation (↑↓/Enter/Esc).
 */
function RelationValuePicker({ value, onChange, options, loading, thisLabel, placeholder }) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [highlighted, setHighlighted] = useState(0);
    // Fixed panel position: the dropdown is rendered in a PORTAL to
    // <body> so it isn't clipped by the modal body's `overflow-y-auto`
    // (previously only the search box was visible and the list stayed hidden).
    const [rect, setRect] = useState(null);
    const boxRef = useRef(null);
    const panelRef = useRef(null);

    const allOptions = useMemo(
        () => [{ value: 'this', label: thisLabel }, ...(options || [])],
        [options, thisLabel],
    );
    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return allOptions;
        return allOptions.filter(o => String(o.label || '').toLowerCase().includes(q));
    }, [allOptions, query]);

    const current = allOptions.find(o => o.value === value);
    const display = current ? current.label : (value || '');

    const openPanel = () => {
        const r = boxRef.current?.getBoundingClientRect();
        if (r) setRect({ left: r.left, top: r.bottom + 4, width: r.width });
        setQuery('');
        setHighlighted(0);
        setOpen(true);
    };

    useEffect(() => {
        if (!open) return undefined;
        const onDoc = (e) => {
            if (boxRef.current?.contains(e.target)) return;
            if (panelRef.current?.contains(e.target)) return;
            setOpen(false);
        };
        // The panel has a fixed position calculated on open; if the user scrolls
        // (e.g. inside the modal) or resizes, we close it to avoid misalignment.
        const onMove = () => setOpen(false);
        document.addEventListener('mousedown', onDoc);
        window.addEventListener('resize', onMove);
        window.addEventListener('scroll', onMove, true);
        return () => {
            document.removeEventListener('mousedown', onDoc);
            window.removeEventListener('resize', onMove);
            window.removeEventListener('scroll', onMove, true);
        };
    }, [open]);

    const pick = (opt) => { onChange(opt.value); setOpen(false); setQuery(''); };

    return (
        <div ref={boxRef} className="relative w-40">
            <button
                type="button"
                onClick={() => (open ? setOpen(false) : openPanel())}
                className="w-full text-left truncate text-xs border border-[var(--border-primary)] rounded px-2 py-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)] hover:border-[var(--gnosi-primary)]"
                title={display}
            >
                {display || <span className="text-[var(--text-tertiary)]">{placeholder || t('view.filter_pick', "Pick…")}</span>}
            </button>
            {open && rect && createPortal(
                <div
                    ref={panelRef}
                    style={{ position: 'fixed', top: rect.top, left: rect.left, width: Math.max(rect.width, 220), zIndex: 300 }}
                    className="max-h-60 overflow-auto rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-2xl"
                >
                    <input
                        autoFocus
                        value={query}
                        onChange={e => { setQuery(e.target.value); setHighlighted(0); }}
                        onKeyDown={e => {
                            if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(h => Math.min(h + 1, filtered.length - 1)); }
                            else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted(h => Math.max(h - 1, 0)); }
                            else if (e.key === 'Enter') { e.preventDefault(); if (filtered[highlighted]) pick(filtered[highlighted]); }
                            else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
                        }}
                        placeholder={t('view.search_placeholder', "Search…")}
                        className="w-full text-xs border-b border-[var(--border-primary)] px-2 py-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)] sticky top-0"
                    />
                    {loading && <div className="px-2 py-1.5 text-xs text-[var(--text-tertiary)] italic">{t('common.loading', "Loading...")}</div>}
                    {!loading && filtered.map((o, i) => (
                        <div
                            key={o.value}
                            onMouseEnter={() => setHighlighted(i)}
                            onMouseDown={e => { e.preventDefault(); pick(o); }}
                            className={`px-2 py-1.5 text-xs cursor-pointer truncate ${i === highlighted ? 'bg-[var(--gnosi-primary)]/15 text-[var(--gnosi-primary)]' : 'text-[var(--text-primary)]'} ${o.value === value ? 'font-semibold' : ''}`}
                            title={o.label}
                        >
                            {o.value === 'this' ? `📍 ${o.label}` : o.label}
                        </div>
                    ))}
                    {!loading && filtered.length === 0 && (
                        <div className="px-2 py-1.5 text-xs text-[var(--text-tertiary)] italic">{t('view.no_results', "No results")}</div>
                    )}
                </div>,
                document.body
            )}
        </div>
    );
}

// --- Complex filter tree (Notion-style nested AND/OR groups) ---------------
// The view stores a `filterTree` root group `{ conjunction, rules }` whose rules
// are leaf rules `{ field, operator, value }` OR nested groups (arbitrary depth).
// The legacy flat `filters` array survives as a back-compat mirror. Evaluation
// parity lives in vaultFilters.matchesFilterNode / DbViewEmbed.applyFilterNode /
// backend view_snapshot.apply_filter_node. Max nesting depth for the UI (the
// engines support any depth, but the editor caps it to stay readable).
const MAX_FILTER_DEPTH = 3;
const NO_VALUE_OPS = ['is_empty', 'is_not_empty'];

const isFilterGroup = (node) => !!node && Array.isArray(node.rules);
const emptyFilterTree = () => ({ conjunction: 'and', rules: [] });

// Builds the editor's tree from a view/section-like source, preferring the
// nested `filterTree` and falling back to the legacy flat `filters` (AND). Deep
// clones so edits don't mutate the loaded object.
function treeFromSource(src) {
    if (isFilterGroup(src?.filterTree)) return cloneFilterNode(src.filterTree);
    const flat = Array.isArray(src?.filters) ? src.filters : [];
    return { conjunction: 'and', rules: flat.map(f => ({ ...f })) };
}

function cloneFilterNode(node) {
    if (isFilterGroup(node)) {
        return { conjunction: node.conjunction === 'or' ? 'or' : 'and', rules: node.rules.map(cloneFilterNode) };
    }
    return { ...node };
}

// Flattens the tree to its leaf rules (used to prefetch relation options and to
// detect a `this`-context filter).
function collectLeafRules(node) {
    if (!node) return [];
    if (isFilterGroup(node)) return node.rules.flatMap(collectLeafRules);
    return node.field ? [node] : [];
}

// Sanitizes for persistence: drops leaf rules without a field, normalizes the
// value (null for is_empty/is_not_empty), and prunes empty sub-groups. The root
// group is always returned (possibly with 0 rules = "no filter").
function sanitizeFilterTree(node, isRoot = true) {
    if (isFilterGroup(node)) {
        const rules = node.rules
            .map(child => sanitizeFilterTree(child, false))
            .filter(Boolean);
        const group = { conjunction: node.conjunction === 'or' ? 'or' : 'and', rules };
        if (!isRoot && rules.length === 0) return null; // prune empty sub-groups
        return group;
    }
    if (!node?.field) return null;
    return {
        field: node.field,
        operator: node.operator || 'equals',
        value: NO_VALUE_OPS.includes(node.operator) ? null : (node.value || ''),
    };
}

// Returns the leaf rules IFF the tree is a single-level AND of only leaf rules
// (the legacy shape); otherwise null. Used to mirror `filters` for old readers.
function flatAndRules(tree) {
    if (!isFilterGroup(tree) || tree.conjunction !== 'and') return null;
    if (tree.rules.some(isFilterGroup)) return null;
    return tree.rules;
}

/**
 * Value control for a single filter rule; matches the field type (checkbox →
 * checkbox, number → numeric input, date → date picker, relation → picker).
 */
function FilterValueControl({ rule, meta, relOpts, onValue, t }) {
    const inputCls = 'text-xs border border-[var(--border-primary)] rounded px-2 py-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)] w-32 disabled:opacity-40';
    if (NO_VALUE_OPS.includes(rule.operator)) {
        // is_empty / is_not_empty: no value is needed.
        return <input className={inputCls} value="" placeholder="—" disabled />;
    }
    const isRelation = meta?.type === 'relation' && !!meta.relation_database_id;
    if (isRelation) {
        return (
            <RelationValuePicker
                value={rule.value || ''}
                onChange={v => onValue(v)}
                options={relOpts || []}
                loading={relOpts === undefined}
                thisLabel={t('view.filter_this', { defaultValue: "This page" })}
                placeholder={t('view.filter_pick', { defaultValue: "Pick…" })}
            />
        );
    }
    const ftype = meta?.type;
    const optionNames = normalizeOptions(meta?.options).map(option => option.name);
    if ((ftype === 'select' || ftype === 'status') && optionNames.length > 0) {
        return (
            <select
                className={inputCls}
                value={String(rule.value || '')}
                onChange={e => onValue(e.target.value)}
            >
                <option value="">{t('view.filter_pick', { defaultValue: "Pick…" })}</option>
                {optionNames.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
        );
    }
    if (ftype === 'multi_select' && optionNames.length > 0) {
        const selected = Array.isArray(rule.value)
            ? rule.value.map(String)
            : (rule.value ? [String(rule.value)] : []);
        return (
            <select
                multiple
                className={`${inputCls} h-20`}
                value={selected}
                onChange={e => onValue(Array.from(e.target.selectedOptions, option => option.value))}
                aria-label={t('view.filter_pick', { defaultValue: "Pick…" })}
            >
                {optionNames.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
        );
    }
    if (ftype === 'checkbox') {
        // Checked = filters for marked records ('true'); unmarked = for not
        // checked ('false', which the engine also matches with empty values).
        const checked = rule.value === 'true';
        return (
            <label className={`${inputCls} flex items-center gap-2 cursor-pointer`}>
                <input
                    type="checkbox"
                    className="accent-[var(--gnosi-primary)] cursor-pointer"
                    checked={checked}
                    onChange={e => onValue(e.target.checked ? 'true' : 'false')}
                />
                <span className="text-[var(--text-secondary)]">{checked ? t('view.checked', "Checked") : t('view.unchecked', "Unchecked")}</span>
            </label>
        );
    }
    if (['number', 'currency', 'percent', 'formula', 'rollup'].includes(ftype)) {
        return (
            <input
                type="number"
                className={inputCls}
                value={rule.value || ''}
                onChange={e => onValue(e.target.value)}
                placeholder={t('view.value_ph', "Value")}
            />
        );
    }
    if (ftype === 'date' || ftype === 'datetime' || ftype === 'period') {
        const isToday = rule.value === 'today';
        return (
            <div className="flex gap-1">
                <select
                    className="text-xs border border-[var(--border-primary)] rounded px-1.5 py-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)]"
                    value={isToday ? 'today' : 'date'}
                    onChange={e => onValue(e.target.value === 'today' ? 'today' : '')}
                >
                    <option value="today">{t('view.filter_today')}</option>
                    <option value="date">{t('view.filter_specific_date')}</option>
                </select>
                {!isToday && (
                    <input
                        type={ftype === 'datetime' ? 'datetime-local' : 'date'}
                        className={inputCls}
                        value={rule.value || ''}
                        onChange={e => onValue(e.target.value)}
                    />
                )}
            </div>
        );
    }
    return (
        <input
            className={inputCls}
            value={rule.value || ''}
            onChange={e => onValue(e.target.value)}
            placeholder={t('view.value_this_ph', "this or value")}
        />
    );
}

/** A single leaf rule row: field select + operator select + value control + delete. */
function FilterRuleRow({ rule, onChange, onRemove, ctx }) {
    const { tableFields, fieldMeta, fieldLabel, relationCache, defaultFilterValue, t } = ctx;
    const meta = fieldMeta[rule.field];
    const isRelation = meta?.type === 'relation' && !!meta.relation_database_id;
    const relOpts = isRelation ? relationCache[meta.relation_database_id] : null;
    return (
        <div className="flex gap-2 items-center">
            <select
                className="text-xs border border-[var(--border-primary)] rounded px-2 py-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)] flex-1"
                value={rule.field}
                onChange={e => {
                    // Changing the field resets the value to the new type's default
                    // (a relation id makes no sense in a text field, etc.).
                    const field = e.target.value;
                    const nextRule = { ...rule, field, value: defaultFilterValue(field) };
                    if (fieldMeta[field]?.type === 'period') {
                        nextRule.periodPart = rule.periodPart === 'end' ? 'end' : 'start';
                    } else {
                        delete nextRule.periodPart;
                    }
                    onChange(nextRule);
                }}
            >
                {tableFields.map(tf => (
                    <option key={tf.name} value={tf.name}>{tf.displayName || fieldLabel(tf.name)}</option>
                ))}
            </select>
            {meta?.type === 'period' && (
                <select
                    className="text-xs border border-[var(--border-primary)] rounded px-2 py-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)] w-36"
                    value={rule.periodPart === 'end' ? 'end' : 'start'}
                    onChange={e => onChange({ ...rule, periodPart: e.target.value })}
                    aria-label={t('view.filter_period_part')}
                >
                    <option value="start">{t('view.filter_period_start')}</option>
                    <option value="end">{t('view.filter_period_end')}</option>
                </select>
            )}
            <select
                className="text-xs border border-[var(--border-primary)] rounded px-2 py-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)] w-32"
                value={rule.operator}
                onChange={e => onChange({ ...rule, operator: e.target.value })}
            >
                {FILTER_OPERATORS.map(op => (
                    <option key={op.value} value={op.value}>{t(`view.op_${op.value}`, op.label)}</option>
                ))}
            </select>
            <FilterValueControl rule={rule} meta={meta} relOpts={relOpts} onValue={v => onChange({ ...rule, value: v })} t={t} />
            <button
                onClick={onRemove}
                className="text-[var(--text-tertiary)] hover:text-red-500 p-1"
                title={t('view.delete', "Delete")}
            >
                <Trash2 size={14} />
            </button>
        </div>
    );
}

/**
 * Recursive editor for a filter group. Renders a per-row conjunction control
 * (Notion-style: first row "On"/Where, second row an And/Or selector shared by
 * the whole group, the rest static), each child (leaf rule or nested group),
 * and footer buttons to add a rule or a sub-group.
 */
function FilterGroupEditor({ node, onChange, onRemove, depth, ctx }) {
    const { tableFields, defaultFilterValue, t } = ctx;
    const firstField = tableFields[0]?.name || 'title';
    const rules = node.rules || [];
    const conj = node.conjunction === 'or' ? 'or' : 'and';

    const updateChild = (i, child) => onChange({ ...node, rules: rules.map((r, idx) => (idx === i ? child : r)) });
    const removeChild = (i) => onChange({ ...node, rules: rules.filter((_, idx) => idx !== i) });
    const addRule = () => onChange({ ...node, rules: [...rules, { field: firstField, operator: 'equals', value: defaultFilterValue(firstField) }] });
    const addGroup = () => onChange({ ...node, rules: [...rules, { conjunction: 'and', rules: [{ field: firstField, operator: 'equals', value: defaultFilterValue(firstField) }] }] });
    const setConjunction = (c) => onChange({ ...node, conjunction: c });

    const isNested = depth > 0;
    return (
        <div className={isNested ? 'rounded-md border border-[var(--border-primary)] bg-[var(--bg-secondary)]/40 p-2 space-y-2' : 'space-y-2'}>
            {isNested && (
                <div className="flex justify-between items-center">
                    <span className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">{t('view.filter_group', "Filter group")}</span>
                    <button
                        onClick={onRemove}
                        className="text-[var(--text-tertiary)] hover:text-red-500 p-0.5"
                        title={t('view.delete_group', "Delete group")}
                    >
                        <Trash2 size={13} />
                    </button>
                </div>
            )}
            {rules.map((child, i) => {
                // The conjunction prefix mirrors Notion: row 0 = "On"/Where,
                // row 1 = And/Or selector (drives the whole group), row 2+ = static.
                const prefix = i === 0 ? (
                    <span className="text-xs text-[var(--text-tertiary)] w-16 shrink-0 pl-1">{t('view.filter_where', "Where")}</span>
                ) : i === 1 ? (
                    <select
                        className="text-xs border border-[var(--border-primary)] rounded px-1.5 py-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)] w-16 shrink-0"
                        value={conj}
                        onChange={e => setConjunction(e.target.value)}
                    >
                        <option value="and">{t('view.conj_and', "And")}</option>
                        <option value="or">{t('view.conj_or', "Or")}</option>
                    </select>
                ) : (
                    <span className="text-xs text-[var(--text-secondary)] w-16 shrink-0 pl-1">{conj === 'or' ? t('view.conj_or', "Or") : t('view.conj_and', "And")}</span>
                );
                return (
                    <div key={i} className="flex gap-2 items-start">
                        <div className="pt-1.5">{prefix}</div>
                        <div className="flex-1 min-w-0">
                            {isFilterGroup(child) ? (
                                <FilterGroupEditor node={child} onChange={c => updateChild(i, c)} onRemove={() => removeChild(i)} depth={depth + 1} ctx={ctx} />
                            ) : (
                                <FilterRuleRow rule={child} onChange={c => updateChild(i, c)} onRemove={() => removeChild(i)} ctx={ctx} />
                            )}
                        </div>
                    </div>
                );
            })}
            <div className="flex gap-2 pl-1">
                <button
                    onClick={addRule}
                    className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)] hover:bg-[var(--gnosi-primary)]/20"
                >
                    <Plus size={12} />
                    {t('view.add_filter', "Add filter")}
                </button>
                {depth < MAX_FILTER_DEPTH && (
                    <button
                        onClick={addGroup}
                        className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-[var(--border-primary)] text-[var(--text-secondary)] hover:border-[var(--gnosi-primary)] hover:text-[var(--gnosi-primary)]"
                    >
                        <Plus size={12} />
                        {t('view.add_group', "Add group")}
                    </button>
                )}
            </div>
        </div>
    );
}

export function PageViewModal({ isOpen, onClose, pageId, allTables = [], apiFetch, preselectedTableId = '', editingBlock = null, mode = 'embed', editingView = null, initialTab = null }) {
    const { t } = useTranslation();

    // `mode='table'`: the SAME modal but configuring a view of the table
    // (not an embed). The embed-specific options are hidden (source table already
    // pinned, existing view, shared/local scope, "save to views",
    // in the heading) and on save the registry view is updated/created
    // directly (without a section or block). `editingView` = view being configured
    // (null = create a new one).
    const isTableMode = mode === 'table';

    // Ref to the modal's inner panel: delimits the keyboard focus-trap.
    const panelRef = useRef(null);

    const [activeTab, setActiveTab] = useState('general');
    const [heading, setHeading] = useState('');
    const [headingLevel, setHeadingLevel] = useState(1);
    const [sourceTableId, setSourceTableId] = useState(preselectedTableId);
    const [viewName, setViewName] = useState('');
    const [visibleProperties, setVisibleProperties] = useState([]);
    // Multi-table joins on top of the base table (`sourceTableId`). Each item:
    //   { tableId, type: 'inner'|'left'|'right', leftField, rightField }
    // where `leftField` belongs to the last table in the chain (base, or the
    // previously added join) and `rightField` belongs to `tableId`. When empty,
    // the view behaves as a classic single-table view (full back-compat).
    const [joins, setJoins] = useState([]);
    // User fields discovered in the records for tables WITHOUT a schema
    // registered (e.g. "Recursos", imported from the Notion clone: `properties`
    // empty but the records carry fields). Without this, the column selector
    // would only show the title. They are merged into `tableFields`.
    const [discoveredFields, setDiscoveredFields] = useState([]);
    // Discovered fields per JOIN table (same purpose as `discoveredFields`, but
    // keyed by table id so we can build the field picker for every table that
    // participates in a multi-table view). `{ [tableId]: string[] }`.
    const [discoveredByTable, setDiscoveredByTable] = useState({});
    const [viewType, setViewType] = useState('table');
    // Complex filter tree (root AND/OR group with nested rules/groups). The
    // legacy flat `filters` array is derived on save for back-compat.
    const [filterTree, setFilterTree] = useState(emptyFilterTree);
    // Ordered list of sort criteria; the first element has the highest
    // priority (e.g.: sort by `Estat` asc; ties broken by `Data` desc).
    const [sorts, setSorts] = useState([]);
    // Snapshot of results' wikilinks in the markdown (portability). Lives in the
    // view from the registry (resultSnapshot / resultSnapshotLimit); the backend
    // honors it when saving the page. Default: enabled, 500 (0 = no limit).
    const [resultSnapshot, setResultSnapshot] = useState(true);
    const [resultSnapshotLimit, setResultSnapshotLimit] = useState(500);
    // View-type-specific options (gallery/kanban/calendar/timeline).
    // They are saved to the view and the renderer honors them; views that are not of the
    // corresponding type simply ignore them.
    const [cardSize, setCardSize] = useState('medium');
    const [galleryPreview, setGalleryPreview] = useState('cover');
    const [coverField, setCoverField] = useState('');
    const [imageFit, setImageFit] = useState('contain');
    const [groupBy, setGroupBy] = useState('');
    const [groupSort, setGroupSort] = useState('catalog');   // catalog | alpha | count
    const [groupSortDir, setGroupSortDir] = useState('asc'); // asc | desc
    const [dateField, setDateField] = useState('');
    const [endDateField, setEndDateField] = useState('');
    const [calendarView, setCalendarView] = useState('dayGridMonth');
    const [colorField, setColorField] = useState('');
    const [rowHeight, setRowHeight] = useState('normal');
    // Chart view options.
    const [chartType, setChartType] = useState('bar');
    const [xField, setXField] = useState('');
    const [yField, setYField] = useState('');
    const [aggregation, setAggregation] = useState('count');
    const [saveToTableViews, setSaveToTableViews] = useState(true);
    const [error, setError] = useState('');
    // Views saved on the selected table — the user can choose one when
    // stead of having to configure everything from scratch.
    const [existingViews, setExistingViews] = useState([]);
    const [selectedExistingViewId, setSelectedExistingViewId] = useState('');
    const [existingViewsStatus, setExistingViewsStatus] = useState('idle');
    const [existingViewsTableId, setExistingViewsTableId] = useState('');
    const [existingViewsReloadKey, setExistingViewsReloadKey] = useState(0);
    const existingViewsRequestRef = useRef(0);
    // How many pages share the selected existing view — if > 1
    // (including this one), we warn the user before propagating changes.
    const [viewUsage, setViewUsage] = useState({ count: 0, pages: [] });
    // What to do if the user modifies a shared view:
    //   'shared' = apply changes to all pages that use it (default)
    //   'fork'   = only this page; the section is embedded without view_id and
    //              carries an inline copy of the filters/sorts/properties.
    const [editScope, setEditScope] = useState('shared');
    const [modalPinnedViewIds, setModalPinnedViewIds] = useState(new Set());
    const [modalViewToDelete, setModalViewToDelete] = useState(null);
    const [modalViewToDeleteUsage, setModalViewToDeleteUsage] = useState(null);

    const requestDeleteViewFromModal = (v) => {
        if (!v?.id || v.is_main || v.id === 'default') return;
        setModalViewToDelete(v);
        setModalViewToDeleteUsage(null);
        apiFetch(`/api/vault/views/${encodeURIComponent(v.id)}/usage`)
            .then(data => setModalViewToDeleteUsage(data))
            .catch(() => {});
    };

    const confirmDeleteViewFromModal = async () => {
        if (!modalViewToDelete?.id) return;
        const vid = modalViewToDelete.id;
        try {
            await apiFetch(`/api/vault/views/${encodeURIComponent(vid)}`, { method: 'DELETE' });
            setExistingViews(prev => prev.filter(x => x.id !== vid));
            setModalPinnedViewIds(prev => {
                const next = new Set(prev);
                next.delete(vid);
                return next;
            });
            if (selectedExistingViewId === vid) {
                setSelectedExistingViewId('');
            }
        } catch (e) {
            console.error('Failed to delete view from modal', e);
        } finally {
            setModalViewToDelete(null);
            setModalViewToDeleteUsage(null);
        }
    };

    // --- Autosave (mode='table') + flush-on-close (mode='embed') ---
    // Mirrors the pattern in SchemaConfigModal: a debounced effect writes a
    // `pendingSaveRef` closure, and the unmount cleanup flushes it so the last
    // edit before closing (X/Esc/Tancar) is never lost.
    // `createdViewIdRef` is essential for table mode: once the first autosave
    // POSTs a new view, the id is fed back here so subsequent autosaves PUT
    // instead of creating duplicates.
    const createdViewIdRef = useRef(null);
    const initializedRef = useRef(false);
    const pendingSaveRef = useRef(null);
    const skipNextAutosaveRef = useRef(false);
    const lastSavedViewRef = useRef(null);
    // Stable handle for close-with-flush: useModalKeyboard is called before
    // closeWithFlush is defined, so we keep the latest closure in a ref.
    const closeWithFlushRef = useRef(() => {});
    // Stable handle for persistView: the autosave/flush effects run before the
    // early `if (!isOpen) return null`, but persistView is defined after it, so
    // the effects call this ref instead.
    const persistViewRef = useRef(async () => null);
    // 'idle' | 'saving' | 'saved' | 'error' — drives the footer status pill.
    const [autosaveStatus, setAutosaveStatus] = useState('idle');
    const [flushing, setFlushing] = useState(false);

    const selectedTable = useMemo(
        () => allTables.find(tbl => tbl.id === sourceTableId),
        [allTables, sourceTableId]
    );
    const sourceTableName = selectedTable?.name || MAIN_VIEW_NAME;

    const tableFields = useMemo(() => {
        // A title column from the schema (the property of type `title`
        // from a table imported from Notion, e.g. "Nom"/"Título", or a field
        // literally named title/títol/titulo/titre) IS the title of the
        // page. The system already exposes it as the canonical `title` field, which the
        // renderer reads from `r.title`. The previous detection, based only on
        // unaccented names, didn't recognize `Título` (with í) nor the columns
        // of type `title` with a different name (`Nom`), and it ended up showing TWO
        // title columns; moreover, the column with its own name wasn't even
        // rendered (its value isn't in `metadata`, but in `title`).
        // That's why we exclude all title columns from the schema and leave
        // a single canonical `title`.
        const isTitleField = (p) => {
            if (String(p.type || '').trim().toLowerCase() === 'title') return true;
            const n = String(p.name || '').trim().toLowerCase();
            return n === 'title' || n === 'títol' || n === 'titulo' || n === 'título' || n === 'titre';
        };
        const props = (selectedTable?.properties || [])
            .filter(p => !isTitleField(p))
            .map(p => ({
                name: p.name,
                type: p.type,
                relation_database_id: p.relation_database_id,
                options: p.config?.options || p.options || [],
            }));
        props.unshift({ name: 'title', type: 'title' });
        // Merges the fields discovered in records that the registered schema does NOT
        // contain (tables without `properties`, like "Recursos"). They are marked as
        // `text` (unknown type) and go at the end, after the schema.
        const known = new Set(props.map(p => String(p.name || '').toLowerCase()));
        for (const name of discoveredFields) {
            if (known.has(String(name).toLowerCase())) continue;
            props.push({ name, type: 'text' });
            known.add(String(name).toLowerCase());
        }
        return props;
    }, [selectedTable, discoveredFields]);

    // --- Multi-table helpers ----------------------------------------------
    // Tables involved in this view: the base table followed by each join's
    // target table, in chain order. Used to build the per-table field picker
    // and to drive the joins UI.
    const viewTables = useMemo(() => {
        const ids = [sourceTableId, ...joins.map(j => j.tableId).filter(Boolean)];
        return ids
            .filter((id, i, arr) => id && arr.indexOf(id) === i) // dedupe, keep order
            .map(id => allTables.find(t => t.id === id))
            .filter(Boolean);
    }, [sourceTableId, joins, allTables]);

    // Is this view multi-table? Drives whether `visibleProperties` is stored
    // in the composite form (`{ tableId, fieldKey }`) vs. plain strings.
    const isMultiTable = joins.length > 0;

    // Computes the field list for an arbitrary table (same merge logic as
    // `tableFields`: schema properties, excluding duplicate title columns, plus
    // discovered fields for tables without a schema). The base table reuses
    // the cached `tableFields`/`discoveredFields`.
    const fieldsForTable = useCallback((tid) => {
        if (!tid) return [];
        if (tid === sourceTableId) return tableFields;
        const tbl = allTables.find(t => t.id === tid);
        if (!tbl) return [];
        const isTitleField = (p) => {
            if (String(p.type || '').trim().toLowerCase() === 'title') return true;
            const n = String(p.name || '').trim().toLowerCase();
            return n === 'title' || n === 'títol' || n === 'titulo' || n === 'título' || n === 'titre';
        };
        const props = (tbl.properties || [])
            .filter(p => !isTitleField(p))
            .map(p => ({
                name: p.name,
                type: p.type,
                relation_database_id: p.relation_database_id,
                options: p.config?.options || p.options || [],
            }));
        props.unshift(
            { name: 'id', type: 'text', label: 'ID (Identificador)' },
            { name: 'title', type: 'title' }
        );
        const known = new Set(props.map(p => String(p.name || '').toLowerCase()));
        for (const name of (discoveredByTable[tid] || [])) {
            if (known.has(String(name).toLowerCase())) continue;
            props.push({ name, type: 'text' });
            known.add(String(name).toLowerCase());
        }
        return props;
    }, [sourceTableId, tableFields, allTables, discoveredByTable]);

    const fieldMeta = useMemo(() => {
        const m = {};
        if (isMultiTable && viewTables.length > 0) {
            viewTables.forEach(tbl => {
                if (!tbl) return;
                const fields = fieldsForTable(tbl.id);
                fields.forEach(f => {
                    if (!m[f.name]) m[f.name] = f;
                });
            });
        } else {
            tableFields.forEach(f => { m[f.name] = f; });
        }
        return m;
    }, [isMultiTable, viewTables, fieldsForTable, tableFields]);

    // Normalizes `visibleProperties` (which may be a list of strings or of
    // `{tableId, fieldKey, label}`) into the composite form. Strings are
    // treated as fields of the base table.
    const normalizeColumns = useCallback((cols) => {
        if (!Array.isArray(cols) || !cols.length) {
            return [{ tableId: sourceTableId, fieldKey: 'title' }];
        }
        return cols.map(c => {
            if (typeof c === 'string') return { tableId: sourceTableId, fieldKey: c };
            if (c && typeof c === 'object' && c.fieldKey) {
                return { tableId: c.tableId || sourceTableId, fieldKey: c.fieldKey, label: c.label };
            }
            return null;
        }).filter(Boolean);
    }, [sourceTableId]);

    // When the view is multi-table, `visibleProperties` is stored in composite
    // form; when single-table, plain strings (full back-compat). This helper
    // builds the value to persist from the current normalized state.
    const visiblePropertiesToPersist = useMemo(() => {
        if (!isMultiTable) {
            // Single-table: plain strings of the base table (legacy form).
            return normalizeColumns(visibleProperties)
                .filter(c => c.tableId === sourceTableId)
                .map(c => c.fieldKey);
        }
        return normalizeColumns(visibleProperties);
    }, [isMultiTable, visibleProperties, sourceTableId, normalizeColumns]);

    // Cache of related table records for the filter dropdowns
    // for relation: { [tableId]: [{ value: id, label: title }] }. `undefined` =
    // not yet loaded (we show "Loading…").
    const [relationCache, setRelationCache] = useState({});
    useEffect(() => {
        if (!isOpen) return;
        const targets = new Set();
        collectLeafRules(filterTree).forEach(f => {
            const meta = fieldMeta[f.field];
            if (meta?.type === 'relation' && meta.relation_database_id) targets.add(meta.relation_database_id);
        });
        targets.forEach(async (tid) => {
            if (relationCache[tid] !== undefined) return;
            try {
                const rows = await apiFetch(`/api/vault/pages/by-table/${encodeURIComponent(tid)}`);
                const opts = (Array.isArray(rows) ? rows : [])
                    .filter(r => !r.metadata?.is_template)
                    .map(r => ({ value: r.id, label: r.title || t('view.untitled', "(untitled)") }))
                    .sort((a, b) => a.label.localeCompare(b.label));
                setRelationCache(prev => ({ ...prev, [tid]: opts }));
            } catch {
                setRelationCache(prev => ({ ...prev, [tid]: [] }));
            }
        });
    }, [isOpen, filterTree, fieldMeta, apiFetch, relationCache, t]);

    // Reads the per-type options of a view (registry or inline section) into the
    // modal's state, tolerating both naming conventions (camelCase from the
    // registry and snake_case from the embedded section).
    const applyTypeOptions = (v) => {
        setCardSize(v?.cardSize || 'medium');
        setGalleryPreview(v?.galleryPreview || 'cover');
        setCoverField(v?.coverField || v?.cover_field || '');
        setImageFit(v?.imageFit || v?.image_fit || 'contain');
        setGroupBy(v?.groupBy || v?.group_by || '');
        setGroupSort(v?.groupSort || v?.group_sort || 'catalog');
        setGroupSortDir(v?.groupSortDir || v?.group_sort_dir || 'asc');
        setDateField(v?.dateField || v?.date_field || '');
        setEndDateField(v?.endDateField || v?.end_date_field || '');
        setCalendarView(v?.calendarView || v?.calendar_view || 'dayGridMonth');
        setColorField(v?.colorField || v?.color_field || '');
        setRowHeight(v?.rowHeight || v?.row_height || 'normal');
        setChartType(v?.chartType || v?.chart_type || 'bar');
        setXField(v?.xField || v?.x_field || '');
        setYField(v?.yField || v?.y_field || '');
        setAggregation(v?.aggregation || (v?.yField || v?.y_field ? 'sum' : 'count'));
    };
    const resetTypeOptions = () => {
        setCardSize('medium');
        setGalleryPreview('cover');
        setCoverField('');
        setImageFit('contain');
        setGroupBy('');
        setGroupSort('catalog');
        setGroupSortDir('asc');
        setDateField('');
        setEndDateField('');
        setCalendarView('dayGridMonth');
        setColorField('');
        setRowHeight('normal');
        setChartType('bar');
        setXField('');
        setYField('');
        setAggregation('count');
    };

    useEffect(() => {
        if (!isOpen) {
            // Reset the autosave bookkeeping so a reopen starts clean.
            initializedRef.current = false;
            createdViewIdRef.current = null;
            lastSavedViewRef.current = null;
            pendingSaveRef.current = null;
            skipNextAutosaveRef.current = false;
            setAutosaveStatus('idle');
            setJoins([]);
            return;
        }
        // TABLE mode: we configure a registry view directly (not an
        // embed). We pre-fill from `editingView` (or defaults if we're creating one).
        if (isTableMode) {
            // 'appearance' from the old modal = 'general' tab here. Only known ids.
            const validIds = new Set(TABS.map(t => t.id));
            const norm = initialTab === 'appearance' ? 'general' : initialTab;
            setActiveTab(norm && validIds.has(norm) ? norm : 'general');
            setError('');
            setSaveToTableViews(false);
            setEditScope('shared');
            setViewUsage({ count: 0, pages: [] });
            setSelectedExistingViewId('');
            setSourceTableId(String(editingView?.table_id || preselectedTableId || ''));
            if (editingView) {
                setViewType(String(editingView.type || 'table'));
                setViewName(String(editingView.name || ''));
                setVisibleProperties(
                    Array.isArray(editingView.visibleProperties) && editingView.visibleProperties.length
                        ? editingView.visibleProperties
                        : ['title']
                );
                setJoins(Array.isArray(editingView.joins) ? editingView.joins : []);
                setFilterTree(treeFromSource(editingView));
                if (Array.isArray(editingView.sorts) && editingView.sorts.length) {
                    setSorts(editingView.sorts);
                } else if (editingView.sort && editingView.sort.field) {
                    setSorts([{ field: editingView.sort.field, direction: editingView.sort.direction || 'asc' }]);
                } else {
                    setSorts([]);
                }
                setResultSnapshot(editingView.resultSnapshot !== false);
                setResultSnapshotLimit(
                    Number.isFinite(Number(editingView.resultSnapshotLimit)) ? Number(editingView.resultSnapshotLimit) : 500
                );
                applyTypeOptions(editingView);
            } else {
                setViewType('table');
                setViewName('');
                setVisibleProperties(['title']);
                setJoins([]);
                setFilterTree(emptyFilterTree());
                setSorts([]);
                setResultSnapshot(true);
                setResultSnapshotLimit(500);
                resetTypeOptions();
            }
            // Initialization just wrote editing state: skip the first autosave
            // tick so it isn't treated as a user change.
            initializedRef.current = true;
            skipNextAutosaveRef.current = true;
            return;
        }
        // EDIT mode: we prefill from the existing block's props.
        // If the section has a view_id, we'll load it in the existing
        // views useEffect (automatic selection). If not, we parse `section` (config
        // inline) to fill filters/sorts/visible_properties.
        if (editingBlock) {
            const p = editingBlock.props || {};
            setActiveTab('general');
            setHeading(String(p.heading || ''));
            setHeadingLevel(Number(p.heading_level) || 1);
            setError('');

            const vid = String(p.view_id || '');
            // We load the pinned views from localStorage
            try {
                const saved = JSON.parse(localStorage.getItem(`gnosi_embed_pinned_${pageId}_${vid || 'default'}`) || '[]');
                setModalPinnedViewIds(new Set(saved));
            } catch {
                setModalPinnedViewIds(new Set());
            }

            // Inline fallback (disconnected local view)
            let inline = null;
            if (!vid && p.section) {
                try { inline = JSON.parse(p.section); } catch { /* malformat */ }
            }
            setViewName('');
            setSaveToTableViews(false);
            setViewUsage({ count: 0, pages: [] });
            setEditScope('shared');

            if (vid) {
                // Preload via a direct fetch so the chained useEffects don't
                // (sourceTableId → existingViews → selectedExistingViewId) no
                // end up clearing the selection before the view has been read.
                let cancelled = false;
                initializedRef.current = true; // async prefill below will re-arm skip
                apiFetch(`/api/vault/views/${encodeURIComponent(vid)}`)
                    .then(v => {
                        if (cancelled || !v) return;
                        setSourceTableId(String(v.table_id || ''));
                        setViewName(String(v.name || ''));
                        setViewType(String(v.type || 'table'));
                        setVisibleProperties(Array.isArray(v.visibleProperties) && v.visibleProperties.length ? v.visibleProperties : ['title']);
                        setJoins(Array.isArray(v.joins) ? v.joins : []);
                        setFilterTree(treeFromSource(v));
                        setResultSnapshot(v.resultSnapshot !== false);
                        setResultSnapshotLimit(Number.isFinite(Number(v.resultSnapshotLimit)) ? Number(v.resultSnapshotLimit) : 500);
                        applyTypeOptions(v);
                        if (Array.isArray(v.sorts) && v.sorts.length > 0) {
                            setSorts(v.sorts);
                        } else if (v.sort && v.sort.field) {
                            setSorts([{ field: v.sort.field, direction: v.sort.direction || 'asc' }]);
                        } else {
                            setSorts([]);
                        }
                        // We put the view directly into the existing list
                        // so the dropdown shows it selected.
                        setExistingViews(prev => {
                            if (prev.some(x => x.id === v.id)) return prev;
                            return [v, ...prev];
                        });
                        setSelectedExistingViewId(vid);
                        // Async prefill finished: the state writes above would
                        // otherwise look like a user edit and trigger autosave.
                        skipNextAutosaveRef.current = true;
                    })
                    .catch(() => {
                        // If we fail, we leave the modal in create-new mode.
                        if (!cancelled) {
                            setSourceTableId(preselectedTableId || '');
                            setSelectedExistingViewId('');
                            skipNextAutosaveRef.current = true;
                        }
                    });
                return () => { cancelled = true; };
            }

            // Local view (inline). We pre-fill from the serialized JSON.
            setSelectedExistingViewId('');
            setSourceTableId(inline?.source_table_id || preselectedTableId || '');
            setViewType(inline?.type || 'table');
            setFilterTree(treeFromSource(inline || {}));
            setSorts(Array.isArray(inline?.sorts) ? inline.sorts : []);
            setVisibleProperties(Array.isArray(inline?.visibleProperties) && inline.visibleProperties.length ? inline.visibleProperties : ['title']);
            setResultSnapshot(inline?.resultSnapshot !== false);
            setResultSnapshotLimit(Number.isFinite(Number(inline?.resultSnapshotLimit)) ? Number(inline.resultSnapshotLimit) : 500);
            applyTypeOptions(inline);
            setExistingViews([]);
            initializedRef.current = true;
            skipNextAutosaveRef.current = true;
            return;
        }
        // CREATE mode: everything clean.
        setActiveTab('general');
        setHeading('');
        setHeadingLevel(1);
        setSourceTableId(preselectedTableId || '');
        setViewName('');
        setVisibleProperties(['title']);
        setViewType('table');
        setFilterTree(emptyFilterTree());
        setSorts([]);
        setResultSnapshot(true);
        setResultSnapshotLimit(500);
        setSaveToTableViews(true);
        setSelectedExistingViewId('');
        setExistingViews([]);
        setExistingViewsStatus('loading');
        setViewUsage({ count: 0, pages: [] });
        setEditScope('shared');
        setModalPinnedViewIds(new Set());
        resetTypeOptions();
        setError('');
        initializedRef.current = true;
        skipNextAutosaveRef.current = true;
    }, [isOpen, preselectedTableId, editingBlock, isTableMode, editingView, initialTab]);

    // When the source table changes, we load the views already saved for
    // allow choosing one instead of creating it from scratch.
    useEffect(() => {
        if (!sourceTableId) {
            setExistingViews([]);
            setSelectedExistingViewId('');
            setExistingViewsStatus('idle');
            setExistingViewsTableId('');
            return;
        }
        let cancelled = false;
        const requestId = ++existingViewsRequestRef.current;
        setExistingViews([]);
        setExistingViewsTableId(sourceTableId);
        setExistingViewsStatus('loading');
        apiFetch(`/api/vault/views?table_id=${encodeURIComponent(sourceTableId)}`)
            .then(data => {
                if (cancelled || requestId !== existingViewsRequestRef.current) return;
                const responseList = Array.isArray(data) ? data : data?.views;
                // Work on a local copy: callers may reuse or freeze the decoded
                // response, and the virtual main view must not mutate it in place.
                const list = Array.isArray(responseList)
                    ? responseList.filter(view => view && typeof view === 'object').slice()
                    : [];
                // The main view may be virtual when the table has no persisted view:
                // creates it virtually when a table doesn't yet have any view
                // (see VaultDashboard.jsx::ensureMainViewForTable). If we don't
                // add it here, the user can't select it in the dropdown.
                const hasMain = list.some(v =>
                    v.id === 'default'
                    || v.is_main === true
                    || v.is_default === true
                    || ['Main Table', 'Taula Principal'].includes(v.name)
                );
                if (!hasMain) {
                    list.unshift({
                        id: 'default',
                        table_id: sourceTableId,
                        name: sourceTableName,
                        type: 'table',
                        is_main: true,
                        filters: [],
                        sort: { field: 'last_modified', direction: 'desc' },
                        visibleProperties: [],
                    });
                }
                setExistingViews(list);
                // If the currently selected view does NOT belong to the new
                // table (user-initiated change), reset. If it DOES belong (pre-filling
                // edit mode), we keep the selection.
                setSelectedExistingViewId(prev => {
                    if (!prev) return '';
                    return list.some(v => v.id === prev) ? prev : '';
                });
                setExistingViewsTableId(sourceTableId);
                setExistingViewsStatus('ready');
            })
            .catch(() => {
                if (!cancelled && requestId === existingViewsRequestRef.current) {
                    setExistingViews([]);
                    setExistingViewsTableId(sourceTableId);
                    setExistingViewsStatus('error');
                }
            });
        return () => { cancelled = true; };
    }, [sourceTableId, sourceTableName, existingViewsReloadKey, apiFetch]);

    // Tables without a registered schema (`properties` empty, e.g. "Recursos"
    // imported from the Notion clone) do not expose any field in the column selector.
    // We discover the user fields from a sample of records so that
    // the user can select them (and so the sanitization effect doesn't remove them from
    // views that already use them). We only do this when needed: if the table already has
    // schema, there is nothing to discover.
    // For multi-table views, we discover for EVERY involved table (base + joins)
    // and keep the base one in `discoveredFields` (for `tableFields`) and the
    // rest in `discoveredByTable`.
    useEffect(() => {
        const discoverFor = (tid, hasSchema, setter) => {
            if (!tid) { setter([]); return; }
            if (hasSchema) { setter([]); return; }
            let cancelled = false;
            apiFetch(`/api/vault/pages?table_id=${encodeURIComponent(tid)}&limit=300`)
                .then(data => {
                    if (cancelled) return;
                    const recs = Array.isArray(data) ? data : (data?.pages || data?.items || []);
                    setter(discoverFieldNamesFromRecords(recs));
                })
                .catch(() => { if (!cancelled) setter([]); });
            return () => { cancelled = true; };
        };
        const baseHasSchema = Array.isArray(selectedTable?.properties) && selectedTable.properties.length > 0;
        const baseCleanup = discoverFor(sourceTableId, baseHasSchema, setDiscoveredFields);
        // Joins: discover for each table that has no schema. Tables WITH schema
        // get an empty entry so the picker knows there is nothing to discover.
        const joinTableIds = joins.map(j => j.tableId).filter(Boolean);
        const cleanups = [];
        const next = { ...discoveredByTable };
        let changed = false;
        joinTableIds.forEach(tid => {
            const tbl = allTables.find(t => t.id === tid);
            const hasSchema = Array.isArray(tbl?.properties) && tbl.properties.length > 0;
            if (hasSchema) {
                if (next[tid] && next[tid].length) { next[tid] = []; changed = true; }
                return;
            }
            if (next[tid] === undefined) {
                next[tid] = []; changed = true;
                const c = discoverFor(tid, false, (fields) => {
                    setDiscoveredByTable(prev => ({ ...prev, [tid]: fields }));
                });
                if (c) cleanups.push(c);
            }
        });
        // Drop entries for tables no longer in the joins.
        Object.keys(next).forEach(tid => {
            if (!joinTableIds.includes(tid)) { delete next[tid]; changed = true; }
        });
        if (changed) setDiscoveredByTable(next);
        return () => { baseCleanup && baseCleanup(); cleanups.forEach(c => c && c()); };
    }, [sourceTableId, selectedTable, joins, allTables, apiFetch]);

    // When the user selects an existing view, it pre-fills the fields with its
    // config and loads how many pages share it.
    useEffect(() => {
        if (!selectedExistingViewId) {
            setViewUsage({ count: 0, pages: [] });
            setEditScope('shared');
            return;
        }
        const v = existingViews.find(x => x.id === selectedExistingViewId);
        if (!v) return;
        setViewName(v.name || '');
        setVisibleProperties(Array.isArray(v.visibleProperties) && v.visibleProperties.length ? v.visibleProperties : ['title']);
        setJoins(Array.isArray(v.joins) ? v.joins : []);
        setViewType(v.type || 'table');
        setFilterTree(treeFromSource(v));
        setResultSnapshot(v.resultSnapshot !== false);
        setResultSnapshotLimit(Number.isFinite(Number(v.resultSnapshotLimit)) ? Number(v.resultSnapshotLimit) : 500);
        applyTypeOptions(v);
        // Compat: the registry can have `sorts: [...]` (new) or `sort: {...}` (legacy)
        if (Array.isArray(v.sorts) && v.sorts.length > 0) {
            setSorts(v.sorts);
        } else if (v.sort && v.sort.field) {
            setSorts([{ field: v.sort.field, direction: v.sort.direction || 'asc' }]);
        } else {
            setSorts([]);
        }
        // The virtual "Main Table" has no entry in the registry; we show it
        // as a "starting point" but we enable saving (it will be created as a
        // genuinely new view). The usage also doesn't make sense for 'default'.
        // Pre-selecting an existing view overwrites editing state; skip the
        // next autosave so it isn't mistaken for a user change.
        skipNextAutosaveRef.current = true;
        if (selectedExistingViewId === 'default' || v.is_main) {
            setSaveToTableViews(true);
            setViewUsage({ count: 0, pages: [] });
            setEditScope('shared');
            return;
        }

        // When you pick a real existing view, we don't duplicate it in the registry.
        setSaveToTableViews(false);
        setEditScope('shared');

        // Loads usage to find out whether the view is shared.
        let cancelled = false;
        apiFetch(`/api/vault/views/${encodeURIComponent(selectedExistingViewId)}/usage`)
            .then(data => {
                if (cancelled) return;
                setViewUsage({
                    count: data?.count || 0,
                    pages: data?.pages || [],
                });
            })
            .catch(() => {
                if (!cancelled) setViewUsage({ count: 0, pages: [] });
            });
        return () => { cancelled = true; };
    }, [selectedExistingViewId, existingViews, apiFetch]);

    // Adjusts visibleProperties when the table changes (removes fields that no longer
    // exist) and ensures the canonical `title` is always present: as in Notion,
    // the title column is the primary property, always visible, and cannot be
    // remove. If missing, it is placed at the front.
    // For multi-table views, each entry may be `{ tableId, fieldKey }`; we keep
    // only those whose (tableId, fieldKey) is still valid across ALL involved
    // tables, and drop entries whose tableId is no longer part of the chain.
    useEffect(() => {
        if (!selectedTable) return;
        // Table without a registered schema and field discovery still pending:
        // we do NOT sanitize, or we would delete valid view columns before knowing
        // which fields exist (fields arrive async via discoveredFields).
        const hasSchema = Array.isArray(selectedTable.properties) && selectedTable.properties.length > 0;
        if (!hasSchema && discoveredFields.length === 0) return;
        const involvedIds = new Set([sourceTableId, ...joins.map(j => j.tableId).filter(Boolean)]);
        setVisibleProperties(prev => {
            const next = [];
            for (const entry of prev) {
                // Composite form: validate (tableId, fieldKey) against the
                // involved tables' fields.
                if (entry && typeof entry === 'object' && entry.fieldKey) {
                    const tid = entry.tableId || sourceTableId;
                    if (!involvedIds.has(tid)) continue; // table removed
                    const fields = fieldsForTable(tid);
                    if (!fields.some(f => f.name === entry.fieldKey)) {
                        // Field may still be pending discovery → keep it to avoid
                        // wiping valid columns before discovery completes.
                        const tbl = allTables.find(t => t.id === tid);
                        const tHasSchema = Array.isArray(tbl?.properties) && tbl.properties.length > 0;
                        const tDiscovered = tid === sourceTableId ? discoveredFields : (discoveredByTable[tid] || []);
                        if (tHasSchema && tDiscovered.length === 0) continue; // really invalid
                    }
                    next.push(entry);
                } else if (typeof entry === 'string') {
                    // Legacy string form: validate against the base table.
                    const valid = new Set(tableFields.map(f => f.name));
                    if (valid.has(entry)) next.push(entry);
                }
            }
            // Ensure the canonical title is present (base table).
            const hasTitle = next.some(e =>
                (typeof e === 'string' && e === 'title') ||
                (e && typeof e === 'object' && e.fieldKey === 'title' && (e.tableId || sourceTableId) === sourceTableId)
            );
            if (!hasTitle) next.unshift('title');
            return next;
        });
    }, [sourceTableId, selectedTable, tableFields, discoveredFields, joins, fieldsForTable, discoveredByTable, allTables]);

    // Canonical keyboard logic: Esc closes, Tab does a focus-trap inside the panel, and
    // focus is restored on close. No onConfirm: this modal is a
    // configurator with autosave/explicit save, without a single primary action
    // for Enter to trigger. The hook listens in CAPTURE on window, so it
    // overrides BlockNote's stopPropagation (TipTap/ProseMirror).
    useModalKeyboard({
        isOpen,
        onClose: () => closeWithFlushRef.current(),
        containerRef: panelRef,
        trapFocus: true,
    });

    // Drag-and-drop sensors shared by the visible-columns and sort-criteria
    // lists (pointer + keyboard, as in SchemaConfigModal). Must run before the
    // early return below: hooks cannot be conditional.
    const dndSensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    // A field's visible label: the canonical `title` is translated ("Title") and
    // the rest are shown with the first letter capitalized (names with
    // leading emoji/accents are kept intact).
    const capitalizeFirst = (s) => {
        const str = String(s || '');
        return str ? str.charAt(0).toUpperCase() + str.slice(1) : str;
    };
    const fieldLabel = (name) => (
        name === 'title' ? t('view.column_title', { defaultValue: "Title" }) : capitalizeFirst(name)
    );

    const allTableFields = useMemo(() => {
        if (!isMultiTable || viewTables.length <= 1) return tableFields;
        const seen = new Set();
        const result = [];
        viewTables.forEach(tbl => {
            if (!tbl) return;
            const fields = fieldsForTable(tbl.id);
            fields.forEach(f => {
                const key = f.name;
                if (!seen.has(key)) {
                    seen.add(key);
                    result.push({
                        ...f,
                        displayName: `${tbl.name} · ${fieldLabel(f.name)}`
                    });
                }
            });
        });
        return result;
    }, [isMultiTable, viewTables, tableFields, fieldsForTable, fieldLabel]);

    // Field pickers (filters, sorting, grouping, per-type controls) list the fields
    // alphabetically by their visible label: with dozens of properties the schema
    // order is unusable to find one. `tableFields` keeps its own order because it
    // also feeds the visible-columns list, where the order IS the user's column order.
    const sortedTableFields = useMemo(
        () => [...allTableFields].sort((a, b) => {
            const labelA = a.displayName || fieldLabel(a.name);
            const labelB = b.displayName || fieldLabel(b.name);
            return labelA.localeCompare(labelB, undefined, { sensitivity: 'base' });
        }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [allTableFields, t, fieldLabel]
    );

    // Autosave (table mode only): after a change, wait 800ms of inactivity,
    // validate, and persist. `pendingSaveRef` always holds the latest closure so
    // the unmount cleanup can flush the last edit. Mirrors SchemaConfigModal.
    // Must live before the `if (!isOpen) return null` (hooks can't be conditional),
    // so it calls persistViewRef.current (assigned after the early return).
    useEffect(() => {
        if (!isOpen || !initializedRef.current || !isTableMode) return;
        if (skipNextAutosaveRef.current) {
            skipNextAutosaveRef.current = false;
            return;
        }
        // Soft validation: pause autosave (no error banner) when the config is
        // incomplete; the user can keep editing. persistView still hard-validates.
        if (!sourceTableId || visibleProperties.length === 0) return;
        const doSave = async () => {
            setAutosaveStatus('saving');
            try {
                await persistViewRef.current({ closeAfter: false });
                setAutosaveStatus('saved');
            } catch {
                setAutosaveStatus('error');
            }
        };
        pendingSaveRef.current = doSave;
        const handle = setTimeout(doSave, 800);
        return () => clearTimeout(handle);
    }, [isOpen, isTableMode, sourceTableId, viewName, viewType, filterTree, sorts,
        visibleProperties, resultSnapshot, resultSnapshotLimit, cardSize, galleryPreview,
        coverField, imageFit, groupBy, groupSort, groupSortDir, dateField, endDateField,
        calendarView, colorField, rowHeight, chartType, xField, yField, aggregation]);

    // Flush the pending save when the modal unmounts (e.g. closing right after
    // an edit, inside the debounce window). Fire-and-forget: the request
    // completes even if the component is gone. Without this the last change
    // before closing would be cancelled by the clearTimeout above.
    useEffect(() => {
        return () => { pendingSaveRef.current?.(); };
    }, []);

    // Keep every hook before the closed-state return. Embedded views mount this
    // modal closed and open it later; placing this memo after the return changes
    // the hook order and crashes React with a black screen.
    if (!isOpen) return null;

    // Canonical key for a visible-property entry, regardless of whether it's
    // stored as a string (`"title"`) or in composite form (`{tableId, fieldKey}`).
    // Used to compare, dedupe and reorder entries across both forms.
    const colKey = (entry) => {
        if (entry && typeof entry === 'object' && entry.fieldKey) {
            return `${entry.tableId || sourceTableId}::${entry.fieldKey}`;
        }
        return `${sourceTableId}::${entry}`;
    };

    const toggleProperty = (tid, name) => {
        // The base table's `title` is the primary column (as in Notion): always
        // visible, cannot be deselected.
        if ((!tid || tid === sourceTableId) && name === 'title') return;
        const key = `${tid || sourceTableId}::${name}`;
        setVisibleProperties(prev => {
            const keys = new Set(prev.map(colKey));
            if (keys.has(key)) {
                return prev.filter(e => colKey(e) !== key);
            }
            // Add in the form that matches the current view (composite if
            // multi-table, string if single-table and it's the base).
            if (isMultiTable) {
                return [...prev, { tableId: tid || sourceTableId, fieldKey: name }];
            }
            return [...prev, name];
        });
    };

    // Reorders a visible column by dragging it (ids = canonical keys).
    const handleColumnDragEnd = ({ active, over }) => {
        if (!active || !over || active.id === over.id) return;
        setVisibleProperties(prev => {
            const oldIndex = prev.findIndex(e => colKey(e) === active.id);
            const newIndex = prev.findIndex(e => colKey(e) === over.id);
            if (oldIndex === -1 || newIndex === -1) return prev;
            return arrayMove(prev, oldIndex, newIndex);
        });
    };

    // Initial value of a filter based on the field type: checkboxes start
    // with a specific boolean ('false' = unchecked) instead of empty, because the
    // engine's boolean comparison also matches rows with no value.
    const defaultFilterValue = (fieldName) => {
        const type = fieldMeta[fieldName]?.type;
        if (type === 'checkbox') return 'false';
        if (type === 'multi_select') return [];
        return '';
    };

    const addSort = () => {
        const firstField = tableFields[0]?.name || 'title';
        setSorts(prev => [...prev, { field: firstField, direction: 'asc' }]);
    };

    const updateSort = (idx, patch) => {
        setSorts(prev => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
    };

    const removeSort = (idx) => {
        setSorts(prev => prev.filter((_, i) => i !== idx));
    };

    // Reorders a sort criterion by dragging it. Rows are identified by
    // positional ids ("sort-<idx>"): stable during the drag (the array only
    // mutates on drop) and immune to duplicate field names.
    const handleSortDragEnd = ({ active, over }) => {
        if (!active || !over || active.id === over.id) return;
        const oldIndex = Number(String(active.id).slice('sort-'.length));
        const newIndex = Number(String(over.id).slice('sort-'.length));
        if (Number.isNaN(oldIndex) || Number.isNaN(newIndex)) return;
        setSorts(prev => arrayMove(prev, oldIndex, newIndex));
    };

    // Builds the object with the options specific to the view type
    // that's active. Only includes the fields that apply to the type so that a view doesn't
    // drags along irrelevant config (e.g. cardSize on a table).
    const buildViewExtras = (src) => {
        // Without `src` it takes the modal's current state; with `src` (an
        // existing view) it extracts the same fields with the same defaults,
        // tolerating camelCase (registry) and snake_case (embedded section). This way
        // change detection and saving use exactly the same shape.
        const s = src || { cardSize, galleryPreview, coverField, imageFit, groupBy, groupSort, groupSortDir, dateField, endDateField, calendarView, colorField, rowHeight, chartType, xField, yField, aggregation };
        const extras = {};
        if (viewType === 'gallery') {
            extras.cardSize = s.cardSize || 'medium';
            extras.galleryPreview = s.galleryPreview || 'cover';
            extras.coverField = s.coverField || s.cover_field || '';
            extras.imageFit = s.imageFit || s.image_fit || 'contain';
            extras.groupBy = s.groupBy || s.group_by || '';
            extras.groupSort = s.groupSort || s.group_sort || 'catalog';
            extras.groupSortDir = s.groupSortDir || s.group_sort_dir || 'asc';
        } else if (viewType === 'board') {
            extras.groupBy = s.groupBy || s.group_by || '';
            extras.groupSort = s.groupSort || s.group_sort || 'catalog';
            extras.groupSortDir = s.groupSortDir || s.group_sort_dir || 'asc';
        } else if (viewType === 'calendar') {
            extras.dateField = s.dateField || s.date_field || '';
            extras.calendarView = s.calendarView || s.calendar_view || 'dayGridMonth';
        } else if (viewType === 'timeline') {
            extras.dateField = s.dateField || s.date_field || '';
            extras.endDateField = s.endDateField || s.end_date_field || '';
            extras.colorField = s.colorField || s.color_field || '';
        } else if (viewType === 'chart') {
            extras.chartType = s.chartType || s.chart_type || 'bar';
            extras.xField = s.xField || s.x_field || '';
            extras.yField = s.yField || s.y_field || '';
            extras.aggregation = s.aggregation || ((s.yField || s.y_field) ? 'sum' : 'count');
        } else if (viewType === 'table' || viewType === 'list') {
            extras.rowHeight = s.rowHeight || s.row_height || 'normal';
            extras.groupBy = s.groupBy || s.group_by || '';
            extras.groupSort = s.groupSort || s.group_sort || 'catalog';
            extras.groupSortDir = s.groupSortDir || s.group_sort_dir || 'asc';
        }
        return extras;
    };

    // Persists the view (and, in embed mode, the page section). This is the
    // single source of truth for saving — used by both the table-mode autosave
    // (closeAfter=false) and the close-with-flush path (closeAfter=true).
    // It NEVER calls onClose: the caller decides that. Returns the saved view
    // (table mode) or section data (embed mode), or null on validation failure.
    const persistView = async ({ closeAfter = false } = {}) => {
        if (!sourceTableId) {
            setError(t('view.error_no_table', "You must select a source table"));
            setActiveTab('general');
            return null;
        }
        if (visibleProperties.length === 0) {
            setError(t('view.error_no_fields', "At least one visible field is required"));
            setActiveTab('properties');
            return null;
        }

        setError('');
        try {
            // Sanitize the filter tree: drop rules without a field, null out the
            // value for is_empty/is_not_empty, prune empty sub-groups. `cleanTree`
            // is the source of truth (complex AND/OR groups); `cleanFilters` is a
            // flat AND mirror kept ONLY when the tree is a simple single-level AND
            // of leaf rules — otherwise `[]`, so old readers don't misinterpret a
            // complex filter as a flat one (they fall back to `filterTree`).
            const cleanTree = sanitizeFilterTree(filterTree);
            const flat = flatAndRules(cleanTree);
            const cleanFilters = flat ? flat.map(f => ({ ...f })) : [];
            const filterTreeBody = cleanTree.rules.length ? cleanTree : null;
            const leafRules = collectLeafRules(cleanTree);

            const cleanSorts = sorts
                .filter(s => s.field)
                .map(s => ({ field: s.field, direction: s.direction || 'asc' }));
            // We keep `sort` (singular) for compatibility with the renderer/UI that
            // still reads a single criterion.
            const sortConfig = cleanSorts[0] || null;

            // TABLE mode: saves the registry view directly (creates or
            // updates), without a section or block. Runs on every autosave AND
            // on close. The first POST's id is captured in createdViewIdRef so
            // subsequent saves PUT (no duplicate views).
            if (isTableMode) {
                const existingId = editingView?.id || createdViewIdRef.current;
                const isMainViewSelection = Boolean(
                    editingView?.is_main
                    || editingView?.is_default
                    || existingId === 'default'
                    || selectedExistingViewId === 'default'
                );
                // Persist joins only when present (absence = single-table view,
                // fully backward compatible). `visiblePropertiesToPersist`
                // switches between plain strings (single-table) and the
                // composite `{tableId, fieldKey}` form (multi-table).
                const joinsToPersist = isMultiTable ? joins : undefined;
                const viewBody = {
                    ...(editingView || {}),
                    table_id: sourceTableId,
                    name: isMainViewSelection
                        ? sourceTableName
                        : (viewName || editingView?.name || 'Vista').trim(),
                    ...(isMainViewSelection ? { is_main: true } : {}),
                    type: viewType,
                    filters: cleanFilters,
                    filterTree: filterTreeBody,
                    sort: sortConfig,
                    sorts: cleanSorts,
                    visibleProperties: visiblePropertiesToPersist,
                    resultSnapshot,
                    resultSnapshotLimit,
                    ...buildViewExtras(),
                };
                if (existingId) {
                    viewBody.id = existingId;
                }
                if (joinsToPersist) {
                    viewBody.joins = joinsToPersist;
                } else {
                    // Explicitly clear joins when the view is single-table, so a
                    // view that was previously multi-table is cleaned up.
                    delete viewBody.joins;
                }
                let saved;
                if (existingId) {
                    saved = await apiFetch(`/api/vault/views/${encodeURIComponent(existingId)}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(viewBody),
                    });
                } else {
                    saved = await apiFetch('/api/vault/views', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(viewBody),
                    });
                    // Feed the new id back so the next autosave PUTs instead of
                    // creating a duplicate.
                    if (saved?.id) createdViewIdRef.current = saved.id;
                }
                // `saved` can be the created view (with a new id) or a status; in
                // any case we return the body with the resulting id.
                const savedView = {
                    ...viewBody,
                    id: existingId || saved?.id || viewBody.id,
                };
                lastSavedViewRef.current = savedView;
                return savedView;
            }

            // EMBED mode: only persists when closing (flush-on-close). We don't
            // write the section to the page on every autosave — that would insert
            // it while the user is still configuring.
            if (!closeAfter) return null;

            // 'default' is the virtual main view (not persisted): the
            // we treat it as if the user had chosen "Create new view" with
            // saveToTableViews=true (this was forced in the useEffect of
            // selection). Here we clear the viewId so 'default' isn't sent
            // to the backend.
            const isDefaultPick = selectedExistingViewId === 'default';
            let viewId = (selectedExistingViewId && !isDefaultPick) ? selectedExistingViewId : null;

            // We reuse the existing view if a real one was chosen. If
            // the user has modified it:
            //   - editScope === 'shared': we upsert to the registry → affects all
            //     the pages that embed it (this is the natural behavior
            //     of a shared view).
            //   - editScope === 'fork': we remove the `view_id` reference and the
            //     the section is saved with inline fields. This way this page
            //     ends up disconnected from the shared view.
            if (selectedExistingViewId && !isDefaultPick) {
                const original = existingViews.find(x => x.id === selectedExistingViewId);
                const newPropsJson = JSON.stringify({
                    // `type` also counts as a modification: without it, changing
                    // ONLY the type (table→board/feed/graph, without extras) did not
                    // was never upserted to the registry and DbViewEmbed —which prefers the
                    // view from the registry to the section— it kept rendering the old type.
                    type: viewType,
                    filterTree: cleanTree,
                    sorts: cleanSorts,
                    visibleProperties: visiblePropertiesToPersist,
                    joins: isMultiTable ? joins : undefined,
                    resultSnapshot,
                    resultSnapshotLimit,
                    // Options by type (gallery: cardSize/galleryPreview; board:
                    // groupBy; etc.). Without including them here, changing ONLY the
                    // preview or card size was not detected as a
                    // modification and the shared view was never applied to the registry
                    // (from where the render reads galleryPreview) → the change was lost.
                    ...buildViewExtras(),
                });
                const oldPropsJson = JSON.stringify({
                    type: String(original?.view_type || original?.type || 'table').toLowerCase(),
                    // Normalize the original's filters through the same tree pipeline
                    // so a simple flat filter doesn't read as "modified" just because
                    // the new shape is a tree.
                    filterTree: sanitizeFilterTree(treeFromSource(original || {})),
                    sorts: original?.sorts || (original?.sort ? [original.sort] : []),
                    visibleProperties: original?.visibleProperties || ['title'],
                    joins: original?.joins || undefined,
                    resultSnapshot: original?.resultSnapshot !== false,
                    resultSnapshotLimit: Number.isFinite(Number(original?.resultSnapshotLimit)) ? Number(original.resultSnapshotLimit) : 500,
                    ...buildViewExtras(original || {}),
                });
                const modified = newPropsJson !== oldPropsJson;

                if (modified && editScope === 'fork') {
                    // Undo the link: the section will be inline.
                    viewId = null;
                } else if (editScope === 'shared') {
                    // Always persist the selected shared view when the modal is
                    // confirmed. The embedded section is written immediately
                    // afterwards with the current type extras; skipping this
                    // upsert because the generic JSON comparison reports no
                    // change can leave the registry copy stale (notably for
                    // groupSortDir). DbViewEmbed intentionally reads the shared
                    // registry view as its source of truth, so both copies must
                    // be updated in the same save operation.
                    const updated = {
                        ...(original || {}),
                        id: selectedExistingViewId,
                        table_id: sourceTableId,
                        ...(isMultiTable ? { joins } : {}),
                        type: viewType,
                        filters: cleanFilters,
                        filterTree: filterTreeBody,
                        sort: sortConfig,
                        sorts: cleanSorts,
                        visibleProperties: visiblePropertiesToPersist,
                        resultSnapshot,
                        resultSnapshotLimit,
                        ...buildViewExtras(),
                    };
                    await apiFetch('/api/vault/views', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(updated),
                    });
                }
            } else if (saveToTableViews) {
                // Case "create new": we create it first in registry.views[] so that
                // the section can reference it by id.
                const viewBody = {
                    table_id: sourceTableId,
                    name: (viewName || heading || 'Vista').trim(),
                    type: viewType,
                    filters: cleanFilters,
                    filterTree: filterTreeBody,
                    sort: sortConfig,
                    sorts: cleanSorts,
                    visibleProperties: visiblePropertiesToPersist,
                    ...(isMultiTable ? { joins } : {}),
                    resultSnapshot,
                    resultSnapshotLimit,
                    ...buildViewExtras(),
                    // If it filters by the page context ("this"), as a
                    // dashboard tab it would resolve nothing: it is marked embedded
                    // and only lives inside embeds (isPageEmbedView). Without
                    // "this", the "also save to the views" checkbox is respected
                    // of the table" and remains as a normal tab.
                    ...(leafRules.some(f => f?.value === 'this') ? { embedded: true } : {}),
                };
                const created = await apiFetch('/api/vault/views', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(viewBody),
                });
                viewId = created?.id || null;
            }

            // 2) Creates the embedded section in the page. If we have view_id,
            // we reference the saved view (single source of truth). Without
            // view_id, we write the fields inline ("local view" mode).
            const sectionBody = {
                heading: heading.trim(),
                heading_level: headingLevel,
                type: 'db_view',
                source_table_id: sourceTableId,
                view_id: viewId,
                filters: cleanFilters,
                filterTree: filterTreeBody,
                sort: sortConfig,
                sorts: cleanSorts,
                visible_properties: visiblePropertiesToPersist,
                view_type: viewType,
                ...(isMultiTable ? { joins } : {}),
                ...buildViewExtras(),
                // Legacy: kept for sync_sections which still reads `columns`
                columns: visiblePropertiesToPersist,
            };

            // apiFetch returns PARSED JSON and throws on non-2xx, so there is no
            // Response object to inspect (`res.ok`/`res.json()` would be a
            // TypeError). Just await it; failures propagate to the catch below.
            await apiFetch(`/api/pages/${pageId}/views`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(sectionBody),
            });

            if (viewId && !isTableMode) {
                try {
                    localStorage.setItem(`gnosi_embed_pinned_${pageId}_${viewId}`, JSON.stringify([...modalPinnedViewIds]));
                } catch (e) {
                    console.warn('Failed to save pinned views to localStorage', e);
                }
            }

            // We return enough info so the caller (BlockEditor) can insert
            // a dbViewEmbed block at the cursor with the full config.
            return {
                view_id: viewId,
                heading: heading.trim(),
                heading_level: headingLevel,
                source_table_id: sourceTableId,
                view_type: viewType,
                filters: cleanFilters,
                filterTree: filterTreeBody,
                sorts: cleanSorts,
                visible_properties: visibleProperties,
                ...buildViewExtras(),
            };
        } catch (e) {
            setError(e?.message || t('view.error_create', "Unknown error creating the view"));
            throw e;
        }
    };

    // Flush any pending edits then close. Used by the Tancar button, the X, and
    // Esc. In table mode the autosave has usually already persisted; here we run
    // a final flush for changes made inside the debounce window. In embed mode
    // this is the only save path (flush-on-close).
    const closeWithFlush = async () => {
        if (flushing) return;
        setFlushing(true);
        // Clear a pending debounce so we don't double-save.
        pendingSaveRef.current = null;
        try {
            const result = await persistView({ closeAfter: true });
            // result is null only on validation failure → stay open so the user
            // can fix it. Otherwise close and hand back the saved data.
            if (result !== null) {
                onClose(true, result);
            }
        } catch {
            // Network/error already surfaced in the banner; stay open.
            setAutosaveStatus('error');
        } finally {
            setFlushing(false);
        }
    };
    closeWithFlushRef.current = closeWithFlush;
    persistViewRef.current = persistView;

    // Schema fields suitable for each per-type control: grouping of
    // Kanban (fields with bounded values) and calendar/timeline time axis.
    const groupFieldOptions = sortedTableFields.filter(f => GROUP_FIELD_TYPES.has(String(f.type || '').toLowerCase()));
    const dateFieldOptions = sortedTableFields.filter(f => DATE_FIELD_TYPES.has(String(f.type || '').toLowerCase()));
    const numericFieldOptions = sortedTableFields.filter(f => NUMERIC_FIELD_TYPES.has(String(f.type || '').toLowerCase()));
    // Fields suitable for the gallery cover: attachments/images/URL or fields with
    // an image name (the gallery extracts the src from it with getImageSrc).
    const coverFieldOptions = sortedTableFields.filter(f => {
        const ty = String(f.type || '').toLowerCase();
        return ty === 'files' || ty === 'image' || ty === 'url' || /imatge|image|cover|portada|foto|photo|thumbnail|miniatura/i.test(f.name || '');
    });

    // We don't close on click outside: with so many tabs it's easy to
    // accidentally click the overlay and lose the config. Closing only via X / Esc.
    const handleOverlayClick = () => {};
    const existingViewsLoadError = existingViewsStatus === 'error' && existingViewsTableId === sourceTableId;
    const isLoadingExistingViews = Boolean(sourceTableId)
        && existingViewsStatus === 'loading'
        && existingViewsTableId === sourceTableId;

    return (
        <div
            className="fixed inset-0 bg-black/60 flex items-center justify-center z-[200] p-4 backdrop-blur-sm"
            onClick={handleOverlayClick}
        >
            <div ref={panelRef} className="bg-[var(--bg-primary)] rounded-xl shadow-2xl w-full max-w-2xl border border-[var(--border-primary)] flex flex-col max-h-[85vh]">
                {/* Header */}
                <div className="px-5 py-4 border-b border-[var(--border-primary)] flex justify-between items-center bg-[var(--bg-secondary)] rounded-t-xl shrink-0">
                    <h2 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
                        <Eye size={16} className="text-[var(--gnosi-primary)]" />
                        {isTableMode
                            ? (editingView?.id ? t('view.config_title', "Configure view") : t('view.new_view', "New view"))
                            : (editingBlock
                                ? t('page_view.title_edit', "Edit database view")
                                : t('page_view.title', "Add database view"))}
                    </h2>
                    <button onClick={() => closeWithFlushRef.current()} className="gnosi-close-btn">
                        <X size={16} />
                    </button>
                </div>

                {/* Existing View Dropdown - Moved to the top for better UX */}
                {!isTableMode && sourceTableId && (
                    <div className="px-5 py-4 border-b border-[var(--border-primary)] bg-[var(--bg-primary)] shrink-0">
                        <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                            {t('view.existing_view', "Existing view")}
                        </label>
                        <select
                            className="w-full text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                            value={selectedExistingViewId}
                            onChange={e => setSelectedExistingViewId(e.target.value)}
                            disabled={isLoadingExistingViews}
                        >
                            <option value="">
                                {isLoadingExistingViews
                                    ? t('view.loading_views', "Loading views…")
                                    : t('view.create_new_view', "— Create new view —")}
                            </option>
                            {existingViews.map(v => (
                                <option key={v.id} value={v.id}>
                                    {v.name || t('view.unnamed', "(unnamed)")} {v.type ? `· ${v.type}` : ''}
                                </option>
                            ))}
                        </select>
                        {existingViewsLoadError && (
                            <div className="mt-2 flex items-center justify-between gap-3 rounded-md border border-[var(--status-error)]/30 bg-[var(--status-error)]/5 px-2.5 py-2">
                                <p className="text-[11px] text-[var(--status-error)]">
                                    {t('view.existing_views_load_error', "Couldn't load the existing views. You can create a new view or retry.")}
                                </p>
                                <button
                                    type="button"
                                    onClick={() => setExistingViewsReloadKey(key => key + 1)}
                                    className="shrink-0 text-xs font-semibold text-[var(--gnosi-primary)] hover:underline"
                                >
                                    {t('common.retry', "Retry")}
                                </button>
                            </div>
                        )}
                        {selectedExistingViewId && (
                            <p className="mt-1.5 text-[11px] text-[var(--text-tertiary)] leading-tight">
                                {t('view.existing_hint', "You can review/override the fields in the Fields, Filters and Sorting tabs.")}
                            </p>
                        )}
                    </div>
                )}

                {/* Tabs */}
                <div className="flex border-b border-[var(--border-primary)] bg-[var(--bg-secondary)] shrink-0">
                    {TABS.map(tab => {
                        const Icon = tab.icon;
                        const active = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold border-b-2 transition-colors ${
                                    active
                                        ? 'border-[var(--gnosi-primary)] text-[var(--gnosi-primary)]'
                                        : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                                }`}
                            >
                                <Icon size={13} />
                                {t(`view.tab_${tab.id}`, tab.label)}
                            </button>
                        );
                    })}
                </div>

                {/* Body */}
                <div className="p-5 space-y-4 overflow-y-auto flex-1">
                    {activeTab === 'general' && (
                        <>
                            {/* View name — first field in General, shown in both
                                modes. In embed mode the name is only used when
                                "saveToTableViews" is checked, but showing it here
                                keeps the layout consistent and lets the user name
                                the view before configuring the rest. */}
                            <div>
                                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                                    {t('view.view_name', "View name")}
                                </label>
                                <input
                                    className="w-full text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] focus:ring-1 focus:ring-[var(--gnosi-primary)] outline-none"
                                    value={viewName}
                                    onChange={e => setViewName(e.target.value)}
                                    placeholder={t('view.view_name_ph', "e.g. By area")}
                                />
                            </div>

                            {!isTableMode && (
                                <div>
                                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">{t('view.source_table', "Source table")}</label>
                                    <select
                                        className="w-full text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                                        value={sourceTableId}
                                        onChange={e => setSourceTableId(e.target.value)}
                                    >
                                        <option value="">{t('view.pick_table', "— Select table —")}</option>
                                        {allTables.map(tbl => (
                                            <option key={tbl.id} value={tbl.id}>{tbl.name}</option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            {/* Multi-table joins. Visible in both modes (the base
                                table is fixed in table mode but joins are still
                                configurable). Each join chains a new table onto
                                the previous one via a pair of fields. */}
                            {sourceTableId && (
                                <div>
                                    <div className="flex items-center justify-between mb-1">
                                        <label className="block text-xs font-semibold text-[var(--text-secondary)]">
                                            {t('view.joins_section', "Tables and joins")}
                                        </label>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                // Pick the first table not already in the chain.
                                                const used = new Set([sourceTableId, ...joins.map(j => j.tableId)]);
                                                const next = allTables.find(t => !used.has(t.id));
                                                if (!next) return;
                                                const prevTableId = joins.length ? joins[joins.length - 1].tableId : sourceTableId;
                                                const prevFields = fieldsForTable(prevTableId);
                                                const nextFields = fieldsForTable(next.id);
                                                setJoins(prev => [...prev, {
                                                    tableId: next.id,
                                                    type: 'inner',
                                                    leftField: prevFields[0]?.name || 'title',
                                                    rightField: nextFields[0]?.name || 'title',
                                                }]);
                                            }}
                                            className="btn btn-secondary flex items-center gap-1 text-xs"
                                        >
                                            <Plus size={12} />
                                            {t('view.add_join', "Add table (join)")}
                                        </button>
                                    </div>
                                    {joins.length === 0 ? (
                                        <p className="text-xs text-[var(--text-tertiary)] italic">
                                            {t('view.joins_empty', "Only the base table. Add a join to combine fields from multiple tables.")}
                                        </p>
                                    ) : (
                                        <div className="space-y-2">
                                            {joins.map((j, idx) => {
                                                // The "left" side is the table explicitly selected, or the last table in the chain
                                                // (base if no previous join).
                                                const defaultLeftTableId = idx === 0 ? sourceTableId : joins[idx - 1].tableId;
                                                const leftTableId = j.leftTableId || defaultLeftTableId;
                                                const leftFields = fieldsForTable(leftTableId);
                                                const rightFields = fieldsForTable(j.tableId);
                                                
                                                // Available tables for the left side are the source table and any previously joined tables
                                                const availableLeftTables = [
                                                    allTables.find(t => t.id === sourceTableId),
                                                    ...joins.slice(0, idx).map(jj => allTables.find(t => t.id === jj.tableId))
                                                ].filter(Boolean);
                                                
                                                const usedIds = new Set([sourceTableId, ...joins.map((jj, i) => i === idx ? '' : jj.tableId)]);
                                                return (
                                                    <div key={idx} className="rounded-lg border border-[var(--border-primary)] p-3 space-y-3 bg-[var(--bg-secondary)]">
                                                        <div className="flex items-center gap-2 mb-1">
                                                            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] flex-1">
                                                                {t('view.join_target_table', "Join table")} {idx + 1}
                                                            </span>
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    setJoins(prev => prev.filter((_, i) => i !== idx));
                                                                }}
                                                                className="text-[var(--text-tertiary)] hover:text-red-500 p-1"
                                                                title={t('view.remove_join', "Remove join")}
                                                            >
                                                                <Trash2 size={13} />
                                                            </button>
                                                        </div>
                                                        
                                                        <div className="grid grid-cols-2 gap-4">
                                                            {/* Esquerra */}
                                                            <div className="space-y-2 border-r border-[var(--border-primary)] pr-4">
                                                                <div>
                                                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] mb-1">
                                                                        {t('view.join_left_table', "Left table")}
                                                                    </label>
                                                                    <select
                                                                        className="w-full text-xs border border-[var(--border-primary)] rounded-lg px-2 py-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                                                                        value={leftTableId}
                                                                        onChange={e => {
                                                                            const newId = e.target.value;
                                                                            const nf = fieldsForTable(newId);
                                                                            setJoins(prev => prev.map((jj, i) => i === idx ? { ...jj, leftTableId: newId, leftField: nf[0]?.name || 'title' } : jj));
                                                                        }}
                                                                    >
                                                                        {availableLeftTables.slice().sort((a,b) => a.name.localeCompare(b.name)).map(tbl => (
                                                                            <option key={tbl.id} value={tbl.id}>{tbl.name}</option>
                                                                        ))}
                                                                    </select>
                                                                </div>
                                                                <div>
                                                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] mb-1">
                                                                        {t('view.join_left_field', "Left field")}
                                                                    </label>
                                                                    <select
                                                                        className="w-full text-xs border border-[var(--border-primary)] rounded-lg px-2 py-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                                                                        value={j.leftField}
                                                                        onChange={e => setJoins(prev => prev.map((jj, i) => i === idx ? { ...jj, leftField: e.target.value } : jj))}
                                                                    >
                                                                        {leftFields.slice().sort((a,b) => (a.label || a.name).localeCompare(b.label || b.name)).map(f => (
                                                                            <option key={f.name} value={f.name}>{f.label || f.name}</option>
                                                                        ))}
                                                                    </select>
                                                                </div>
                                                            </div>
                                                            
                                                            {/* Dreta */}
                                                            <div className="space-y-2">
                                                                <div>
                                                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] mb-1">
                                                                        {t('view.join_right_table', "Right table")}
                                                                    </label>
                                                                    <select
                                                                        className="w-full text-xs border border-[var(--border-primary)] rounded-lg px-2 py-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                                                                        value={j.tableId}
                                                                        onChange={e => {
                                                                            const newId = e.target.value;
                                                                            const nf = fieldsForTable(newId);
                                                                            setJoins(prev => prev.map((jj, i) => i === idx ? { ...jj, tableId: newId, rightField: nf[0]?.name || 'title' } : jj));
                                                                        }}
                                                                    >
                                                                        {allTables.slice().sort((a,b) => a.name.localeCompare(b.name)).map(tbl => (
                                                                            <option key={tbl.id} value={tbl.id} disabled={usedIds.has(tbl.id)}>
                                                                                {tbl.name}
                                                                            </option>
                                                                        ))}
                                                                    </select>
                                                                </div>
                                                                <div>
                                                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] mb-1">
                                                                        {t('view.join_right_field', "Right field")}
                                                                    </label>
                                                                    <select
                                                                        className="w-full text-xs border border-[var(--border-primary)] rounded-lg px-2 py-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                                                                        value={j.rightField}
                                                                        onChange={e => setJoins(prev => prev.map((jj, i) => i === idx ? { ...jj, rightField: e.target.value } : jj))}
                                                                    >
                                                                        {rightFields.slice().sort((a,b) => (a.label || a.name).localeCompare(b.label || b.name)).map(f => (
                                                                            <option key={f.name} value={f.name}>{f.label || f.name}</option>
                                                                        ))}
                                                                    </select>
                                                                </div>
                                                            </div>
                                                        </div>

                                                        <div className="pt-2 mt-2 border-t border-[var(--border-primary)]">
                                                            <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] mb-1">
                                                                {t('view.join_type', "Join type")}
                                                            </label>
                                                            <select
                                                                className="w-full text-xs border border-[var(--border-primary)] rounded-lg px-2 py-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                                                                value={j.type}
                                                                onChange={e => setJoins(prev => prev.map((jj, i) => i === idx ? { ...jj, type: e.target.value } : jj))}
                                                            >
                                                                <option value="inner">{t('view.join_inner', "Inner (intersection)")}</option>
                                                                <option value="left">{t('view.join_left_type', "Left (keep all from left)")}</option>
                                                                <option value="right">{t('view.join_right_type', "Right (keep all from right)")}</option>
                                                            </select>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            )}

                            <div>
                                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-2">{t('view.type_label', "View type")}</label>
                                <div className="grid grid-cols-4 gap-2">
                                    {VIEW_TYPES.map(vt => {
                                        const Icon = vt.icon;
                                        const active = viewType === vt.id;
                                        return (
                                            <button
                                                key={vt.id}
                                                type="button"
                                                onClick={() => setViewType(vt.id)}
                                                className={`flex flex-col items-center gap-1 p-2 rounded-lg border transition-all ${
                                                    active
                                                        ? 'border-[var(--gnosi-primary)] bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)]'
                                                        : 'border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
                                                }`}
                                                title={t(`view.type_${vt.id}`, vt.label)}
                                            >
                                                <Icon size={18} />
                                                <span className="text-[10px] font-semibold">{t(`view.type_${vt.id}`, vt.label)}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Type-specific options for the chosen view type: they appear
                                contextually right below the type selector. */}
                            {(viewType === 'table' || viewType === 'list') && (
                                <div className="border-t border-[var(--border-primary)] pt-4 space-y-2">
                                    <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">{t('view.table_options', "Table options")}</p>
                                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">{t('view.row_height', "Row height")}</label>
                                    <div className="grid grid-cols-3 gap-2">
                                        {[{ value: 'compact', label: t('view.row_compact', "Compact") }, { value: 'normal', label: t('view.row_normal', 'Normal') }, { value: 'tall', label: t('view.row_tall', "Tall") }].map(opt => (
                                            <button
                                                key={opt.value}
                                                type="button"
                                                onClick={() => setRowHeight(opt.value)}
                                                className={`px-2 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                                                    rowHeight === opt.value
                                                        ? 'border-[var(--gnosi-primary)] bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)]'
                                                        : 'border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
                                                }`}
                                            >
                                                {opt.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {viewType === 'gallery' && (
                                <div className="border-t border-[var(--border-primary)] pt-4 space-y-3">
                                    <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">{t('view.gallery_options', "Gallery options")}</p>
                                    <div>
                                        <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">{t('view.card_size', "Card size")}</label>
                                        <div className="grid grid-cols-3 gap-2">
                                            {CARD_SIZES.map(cs => (
                                                <button
                                                    key={cs.value}
                                                    type="button"
                                                    onClick={() => setCardSize(cs.value)}
                                                    className={`px-2 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                                                        cardSize === cs.value
                                                            ? 'border-[var(--gnosi-primary)] bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)]'
                                                            : 'border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
                                                    }`}
                                                >
                                                    {t(`view.card_${cs.value}`, cs.label)}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">{t('view.card_preview', "Card preview")}</label>
                                        <div className="grid grid-cols-2 gap-2">
                                            {GALLERY_PREVIEWS.map(gp => (
                                                <button
                                                    key={gp.value}
                                                    type="button"
                                                    onClick={() => setGalleryPreview(gp.value)}
                                                    title={t(`view.gp_${gp.value}_hint`, gp.hint)}
                                                    className={`text-left px-2.5 py-2 rounded-lg border transition-all ${
                                                        galleryPreview === gp.value
                                                            ? 'border-[var(--gnosi-primary)] bg-[var(--gnosi-primary)]/10'
                                                            : 'border-[var(--border-primary)] hover:bg-[var(--bg-tertiary)]'
                                                    }`}
                                                >
                                                    <span className={`block text-xs font-semibold ${galleryPreview === gp.value ? 'text-[var(--gnosi-primary)]' : 'text-[var(--text-primary)]'}`}>{t(`view.gp_${gp.value}`, gp.label)}</span>
                                                    <span className="block text-[10px] text-[var(--text-tertiary)] leading-tight mt-0.5">{t(`view.gp_${gp.value}_hint`, gp.hint)}</span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">{t('view.cover_field', "Cover field")}</label>
                                        <select
                                            value={coverField}
                                            onChange={e => setCoverField(e.target.value)}
                                            className="w-full text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                                        >
                                            <option value="">{t('view.cover_default', "Page cover (default)")}</option>
                                            {coverFieldOptions.map(f => (
                                                <option key={f.name} value={f.name}>{fieldLabel(f.name)}</option>
                                            ))}
                                        </select>
                                        <p className="mt-1 text-[10px] text-[var(--text-tertiary)]">{t('view.cover_hint', "Where each card's image comes from (only if the preview is “Cover”).")}</p>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">{t('view.image_fit', "Image fit")}</label>
                                        <div className="grid grid-cols-2 gap-2">
                                            {[{ value: 'contain', label: t('view.fit_contain', "Whole") }, { value: 'cover', label: t('view.fit_cover', "Fill") }].map(opt => (
                                                <button
                                                    key={opt.value}
                                                    type="button"
                                                    onClick={() => setImageFit(opt.value)}
                                                    className={`px-2 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                                                        imageFit === opt.value
                                                            ? 'border-[var(--gnosi-primary)] bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)]'
                                                            : 'border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
                                                    }`}
                                                >
                                                    {opt.label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {(viewType === 'calendar' || viewType === 'timeline') && (
                                <div className="border-t border-[var(--border-primary)] pt-4 space-y-3">
                                    <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">{viewType === 'calendar' ? t('view.calendar_options', "Calendar options") : t('view.timeline_options', "Timeline options")}</p>
                                    {!selectedTable ? (
                                        <p className="text-xs text-[var(--text-tertiary)] italic">{t('view.pick_table_first', "Select a table first.")}</p>
                                    ) : (
                                        <>
                                            <div>
                                                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">{viewType === 'timeline' ? t('view.start_date', "Start date") : t('view.date_field', "Date field")}</label>
                                                <select
                                                    value={dateField}
                                                    onChange={e => setDateField(e.target.value)}
                                                    className="w-full text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                                                >
                                                    <option value="">{t('view.date_auto', "Automatic (first date field)")}</option>
                                                    {dateFieldOptions.map(f => (
                                                        <option key={f.name} value={f.name}>{f.displayName || fieldLabel(f.name)}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            {viewType === 'calendar' && (
                                                <div>
                                                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">{t('view.initial_view', "Initial view")}</label>
                                                    <select
                                                        value={calendarView}
                                                        onChange={e => setCalendarView(e.target.value)}
                                                        className="w-full text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                                                    >
                                                        <option value="dayGridMonth">{t('view.cal_month', "Month")}</option>
                                                        <option value="timeGridWeek">{t('view.cal_week', "Week")}</option>
                                                        <option value="timeGridDay">{t('view.cal_day', "Day")}</option>
                                                        <option value="multiMonthYear">{t('view.cal_year', "Year")}</option>
                                                    </select>
                                                </div>
                                            )}
                                            {viewType === 'timeline' && (
                                                fieldMeta[dateField]?.type === 'period' ? (
                                                    <p className="text-[11px] text-[var(--text-tertiary)]">{t('view.period_hint', "The period field already defines each bar's start and end.")}</p>
                                                ) : (
                                                    <div>
                                                        <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">{t('view.end_date', "End date (optional)")}</label>
                                                        <select
                                                            value={endDateField}
                                                            onChange={e => setEndDateField(e.target.value)}
                                                            className="w-full text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                                                        >
                                                            <option value="">{t('view.end_none', "None (one-day duration)")}</option>
                                                            {dateFieldOptions.map(f => (
                                                                <option key={f.name} value={f.name}>{f.displayName || fieldLabel(f.name)}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                )
                                            )}
                                            {viewType === 'timeline' && (
                                                <div>
                                                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">{t('view.color_by', "Color by")}</label>
                                                    <select
                                                        value={colorField}
                                                        onChange={e => setColorField(e.target.value)}
                                                        className="w-full text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                                                    >
                                                        <option value="">{t('view.color_single', "Single color (default)")}</option>
                                                        {groupFieldOptions.map(f => (
                                                            <option key={f.name} value={f.name}>{f.displayName || fieldLabel(f.name)}</option>
                                                        ))}
                                                    </select>
                                                    <p className="mt-1 text-[10px] text-[var(--text-tertiary)]">{t('view.color_hint', "Colors each bar by this field's value (uses its options' colors).")}</p>
                                                </div>
                                            )}
                                            {dateFieldOptions.length === 0 && (
                                                <p className="text-[11px] text-[var(--text-tertiary)]">{t('view.no_date_fields', "No date field in the table; the modification date will be used.")}</p>
                                            )}
                                        </>
                                    )}
                                </div>
                            )}

                            {viewType === 'chart' && (
                                <div className="border-t border-[var(--border-primary)] pt-4 space-y-3">
                                    <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">{t('view.chart_options', "Chart options")}</p>
                                    {!selectedTable ? (
                                        <p className="text-xs text-[var(--text-tertiary)] italic">{t('view.pick_table_first', "Select a table first.")}</p>
                                    ) : (
                                        <>
                                            <div>
                                                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">{t('view.chart_type', "Chart type")}</label>
                                                <select
                                                    value={chartType}
                                                    onChange={e => setChartType(e.target.value)}
                                                    className="w-full text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                                                >
                                                    <option value="bar">{t('view.chart_bar', "Bars")}</option>
                                                    <option value="hbar">{t('view.chart_hbar', "Horizontal bars")}</option>
                                                    <option value="line">{t('view.chart_line', "Line")}</option>
                                                    <option value="pie">{t('view.chart_pie', "Pie")}</option>
                                                    <option value="donut">{t('view.chart_donut', 'Donut')}</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">{t('view.chart_x', "Group by (X axis)")}</label>
                                                <select
                                                    value={xField}
                                                    onChange={e => setXField(e.target.value)}
                                                    className="w-full text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                                                >
                                                    <option value="">{t('view.pick_field', "— Pick a field —")}</option>
                                                    {sortedTableFields.map(f => (
                                                        <option key={f.name} value={f.name}>{f.displayName || fieldLabel(f.name)}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">{t('view.aggregation', "Aggregation function")}</label>
                                                <select
                                                    value={aggregation}
                                                    onChange={e => setAggregation(e.target.value)}
                                                    className="w-full text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                                                >
                                                    <option value="count">{t('view.agg_count', "Count (number of rows)")}</option>
                                                    <option value="sum">{t('view.agg_sum', "Sum")}</option>
                                                    <option value="avg">{t('view.agg_avg', "Average")}</option>
                                                    <option value="min">{t('view.agg_min', "Min")}</option>
                                                    <option value="max">{t('view.agg_max', "Max")}</option>
                                                </select>
                                            </div>
                                            {aggregation !== 'count' && (
                                                <div>
                                                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">{t('view.chart_y', "Value field (Y axis)")}</label>
                                                    <select
                                                        value={yField}
                                                        onChange={e => setYField(e.target.value)}
                                                        className="w-full text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                                                    >
                                                        <option value="">{t('view.pick_numeric', "— Pick a numeric field —")}</option>
                                                        {numericFieldOptions.map(f => (
                                                            <option key={f.name} value={f.name}>{f.displayName || fieldLabel(f.name)}</option>
                                                        ))}
                                                    </select>
                                                    {numericFieldOptions.length === 0 && (
                                                        <p className="mt-1 text-[10px] text-[var(--text-tertiary)]">{t('view.no_numeric', "No numeric field in the table; use “Count”.")}</p>
                                                    )}
                                                </div>
                                            )}
                                            {!xField && (
                                                <p className="text-[11px] text-[var(--text-tertiary)]">{t('view.chart_pick_x', "Pick the grouping field to see the chart.")}</p>
                                            )}
                                        </>
                                    )}
                                </div>
                            )}



                            {!isTableMode && sourceTableId && existingViews.length > 0 && (
                                <div className="border-t border-[var(--border-primary)] pt-4">
                                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-2">
                                        {t('view.pinned_tabs', "Show tabs (views pinned to this block)")}
                                    </label>
                                    <div className="space-y-1.5 max-h-36 overflow-y-auto border border-[var(--border-primary)] rounded-lg p-2.5 bg-[var(--bg-secondary)]">
                                        {existingViews.map(v => {
                                            const isChecked = modalPinnedViewIds.has(v.id);
                                            const isAnchor = v.id === selectedExistingViewId || (v.id === 'default' && !selectedExistingViewId);
                                            const canDelete = !v.is_main && v.id !== 'default';
                                            return (
                                                <div key={v.id} className="flex items-center justify-between gap-2 py-0.5">
                                                    <label className="flex items-center gap-2 text-xs text-[var(--text-primary)] cursor-pointer select-none truncate min-w-0">
                                                        <input
                                                            type="checkbox"
                                                            checked={isChecked || isAnchor}
                                                            disabled={isAnchor}
                                                            onChange={e => {
                                                                const checked = e.target.checked;
                                                                setModalPinnedViewIds(prev => {
                                                                    const next = new Set(prev);
                                                                    if (checked) {
                                                                        next.add(v.id);
                                                                    } else {
                                                                        next.delete(v.id);
                                                                    }
                                                                    return next;
                                                                });
                                                            }}
                                                            className="rounded text-[var(--gnosi-primary)] focus:ring-[var(--gnosi-primary)] shrink-0"
                                                        />
                                                        <span className="truncate">{v.name || t('view.unnamed', "(unnamed)")}</span>
                                                        {v.type && <span className="text-[10px] text-[var(--text-tertiary)] shrink-0">· {v.type}</span>}
                                                        {isAnchor && (
                                                            <span className="text-[10px] text-[var(--text-tertiary)] italic shrink-0">{t('view.anchor_view', "(anchor view)")}</span>
                                                        )}
                                                    </label>
                                                    {canDelete && (
                                                        <button
                                                            type="button"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                requestDeleteViewFromModal(v);
                                                            }}
                                                            className="shrink-0 p-1 text-[var(--text-tertiary)] hover:text-red-500 rounded transition-colors"
                                                            title={t('views_header.delete', "Delete")}
                                                        >
                                                            <Trash2 size={13} />
                                                        </button>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {selectedExistingViewId && viewUsage.count > 0 && (
                                <div className="border-t border-[var(--border-primary)] pt-4">
                                    <p className="text-xs font-semibold text-[var(--text-secondary)] mb-1">
                                        {t('view.usage_count', { count: viewUsage.count, defaultValue: "This view is already used on {{count}} pages." })}
                                    </p>
                                    {viewUsage.pages?.length > 0 && (
                                        <ul className="text-[11px] text-[var(--text-tertiary)] mb-2 pl-4 list-disc space-y-0.5 max-h-24 overflow-y-auto">
                                            {viewUsage.pages.map((p) => (
                                                <li key={p.id}>{p.title}</li>
                                            ))}
                                        </ul>
                                    )}
                                    <p className="text-[11px] text-[var(--text-tertiary)] mb-3">
                                        {t('view.edit_scope_prompt', "If you modify the fields, choose how to apply it:")}
                                    </p>
                                    <div className="space-y-2">
                                        <label className="flex items-start gap-2 cursor-pointer">
                                            <input
                                                type="radio"
                                                name="editScope"
                                                value="shared"
                                                checked={editScope === 'shared'}
                                                onChange={() => setEditScope('shared')}
                                                className="mt-0.5"
                                            />
                                            <div>
                                                <span className="text-sm text-[var(--text-primary)] block">
                                                    {t('view.scope_shared', "Apply changes to all pages")}
                                                </span>
                                                <span className="text-[11px] text-[var(--text-tertiary)]">
                                                    {t('view.scope_shared_hint', "The shared view is updated and every embed reflects the changes.")}
                                                </span>
                                            </div>
                                        </label>
                                        <label className="flex items-start gap-2 cursor-pointer">
                                            <input
                                                type="radio"
                                                name="editScope"
                                                value="fork"
                                                checked={editScope === 'fork'}
                                                onChange={() => setEditScope('fork')}
                                                className="mt-0.5"
                                            />
                                            <div>
                                                <span className="text-sm text-[var(--text-primary)] block">
                                                    {t('view.scope_fork', "Apply only to this page")}
                                                </span>
                                                <span className="text-[11px] text-[var(--text-tertiary)]">
                                                    {t('view.scope_fork_hint', "Disconnects this embed from the shared view and keeps a local copy. Other pages don't change.")}
                                                </span>
                                            </div>
                                        </label>
                                    </div>
                                </div>
                            )}

                            {!isTableMode && !selectedExistingViewId && (
                                <div className="border-t border-[var(--border-primary)] pt-4 space-y-3">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={saveToTableViews}
                                            onChange={e => setSaveToTableViews(e.target.checked)}
                                            className="rounded border-[var(--border-primary)]"
                                        />
                                        <span className="text-sm text-[var(--text-primary)]">
                                            {t('view.save_to_table', "Also save to the table's views")}
                                        </span>
                                    </label>
                                </div>
                            )}

                            {/* Portability: snapshot of result wikilinks into
                                markdown (Obsidian/Drupal/plain readers). The value
                                lives in the view; the backend honors it when saving. */}
                            <div className="border-t border-[var(--border-primary)] pt-4 space-y-3">
                                <label className="flex items-start gap-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={resultSnapshot}
                                        onChange={e => setResultSnapshot(e.target.checked)}
                                        className="mt-0.5 rounded border-[var(--border-primary)]"
                                    />
                                    <div>
                                        <span className="text-sm text-[var(--text-primary)] block">
                                            {t('view.snapshot_label', "Save result links to the markdown")}
                                        </span>
                                        <span className="text-[11px] text-[var(--text-tertiary)]">
                                            {t('view.snapshot_hint', "Writes a [[Title|id]] list of the pages the view returns, so Obsidian and other readers can navigate them.")}
                                        </span>
                                    </div>
                                </label>
                                {resultSnapshot && (
                                    <div className="ml-6 flex items-center gap-2">
                                        <label htmlFor="pvm-result-snapshot-limit" className="text-xs font-semibold text-[var(--text-secondary)]">
                                            {t('view.snapshot_limit', "Max links")}
                                        </label>
                                        <input
                                            id="pvm-result-snapshot-limit"
                                            type="number"
                                            min="0"
                                            step="50"
                                            value={resultSnapshotLimit}
                                            onChange={e => {
                                                const n = parseInt(e.target.value, 10);
                                                setResultSnapshotLimit(Number.isFinite(n) && n >= 0 ? n : 0);
                                            }}
                                            className="w-24 text-sm border border-[var(--border-primary)] rounded-lg px-2 py-1 bg-[var(--bg-primary)] text-[var(--text-primary)] focus:ring-1 focus:ring-[var(--gnosi-primary)] outline-none text-right"
                                        />
                                        <span className="text-[11px] text-[var(--text-tertiary)]">{t('view.snapshot_unlimited', "0 = no limit")}</span>
                                    </div>
                                )}
                            </div>
                        </>
                    )}

                    {activeTab === 'properties' && (
                        <div>
                            <p className="text-xs text-[var(--text-secondary)] mb-3">
                                {t('view.fields_intro', "Select the fields to show as columns.")}
                            </p>
                            {!selectedTable ? (
                                <p className="text-sm text-[var(--text-tertiary)] italic">
                                    {t('view.pick_table_general', "Select a table first in the General tab.")}
                                </p>
                            ) : (
                                <div className="space-y-3 max-h-[44vh] overflow-y-auto">
                                    {(() => {
                                        // Normalize visible entries to composite form so the
                                        // picker works uniformly across single/multi-table.
                                        const norm = normalizeColumns(visibleProperties);
                                        const selectedKeys = new Set(norm.map(colKey));
                                        const isSelected = (tid, name) =>
                                            selectedKeys.has(`${tid || sourceTableId}::${name}`);
                                        // Build the meta lookup per involved table.
                                        const metaFor = (tid) => {
                                            const fields = fieldsForTable(tid);
                                            const m = {};
                                            fields.forEach(f => { m[f.name] = f; });
                                            return m;
                                        };
                                        return (
                                            <>
                                                <div>
                                                    <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] mb-1 px-2">
                                                        {t('view.visible_columns', "Visible columns (order)")}
                                                    </p>
                                                    {norm.length === 0 ? (
                                                        <p className="text-xs text-[var(--text-tertiary)] italic px-2 py-1">{t('view.no_columns', "No columns. Pick one below.")}</p>
                                                    ) : (
                                                        <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleColumnDragEnd}>
                                                            <SortableContext items={norm.map(colKey)} strategy={verticalListSortingStrategy}>
                                                                {norm.map(c => {
                                                                    const tid = c.tableId || sourceTableId;
                                                                    const m = metaFor(tid);
                                                                    const f = m[c.fieldKey] || { name: c.fieldKey, type: '' };
                                                                    const isJoin = tid !== sourceTableId;
                                                                    const tableName = allTables.find(t => t.id === tid)?.name;
                                                                    return (
                                                                        <SortableRow
                                                                            key={colKey(c)}
                                                                            id={colKey(c)}
                                                                            className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[var(--bg-tertiary)]"
                                                                        >
                                                                            <span className="text-sm text-[var(--text-primary)] flex-1">
                                                                                {isJoin && tableName ? (
                                                                                    <span className="text-[10px] text-[var(--text-tertiary)] mr-1">{tableName} ·</span>
                                                                                ) : null}
                                                                                {f.displayName || fieldLabel(f.name)}
                                                                            </span>
                                                                            <span className="text-[10px] text-[var(--text-tertiary)] uppercase">{f.type || ''}</span>
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => toggleProperty(tid, f.name)}
                                                                                disabled={!isJoin && f.name === 'title'}
                                                                                className="text-[var(--text-tertiary)] hover:text-red-500 p-1 disabled:opacity-25 disabled:hover:text-[var(--text-tertiary)] disabled:cursor-not-allowed"
                                                                                title={!isJoin && f.name === 'title' ? t('view.title_always_visible', "The title is always visible") : t('view.remove', "Remove")}
                                                                            >
                                                                                <Trash2 size={13} />
                                                                            </button>
                                                                        </SortableRow>
                                                                    );
                                                                })}
                                                            </SortableContext>
                                                        </DndContext>
                                                    )}
                                                </div>
                                                {/* Available fields, grouped by table. In single-table views
                                                    this renders a single group identical to the previous UI. */}
                                                {viewTables.map(tbl => {
                                                    const fields = fieldsForTable(tbl.id);
                                                    const available = fields.filter(f => !isSelected(tbl.id, f.name));
                                                    if (available.length === 0) return null;
                                                    return (
                                                        <div key={tbl.id}>
                                                            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] mb-1 px-2">
                                                                {isMultiTable
                                                                    ? t('view.fields_for_table', { table: tbl.name, defaultValue: "{{table}}" })
                                                                    : t('view.available', "Available")}
                                                            </p>
                                                            {available.map(f => (
                                                                <label
                                                                    key={`${tbl.id}-${f.name}`}
                                                                    className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[var(--bg-tertiary)] cursor-pointer"
                                                                >
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={false}
                                                                        onChange={() => toggleProperty(tbl.id, f.name)}
                                                                        className="rounded border-[var(--border-primary)]"
                                                                    />
                                                                    <span className="text-sm text-[var(--text-primary)] flex-1">{f.displayName || fieldLabel(f.name)}</span>
                                                                    <span className="text-[10px] text-[var(--text-tertiary)] uppercase">{f.type || ''}</span>
                                                                </label>
                                                            ))}
                                                        </div>
                                                    );
                                                })}
                                            </>
                                        );
                                    })()}
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'filters' && (
                        <div>
                            <p className="text-xs text-[var(--text-secondary)] mb-3">
                                {t('view.filters_intro_groups', "Combine filters with And/Or and group them for complex conditions. Value \"this\" = this page's ID.")}
                            </p>
                            {!selectedTable ? (
                                <p className="text-sm text-[var(--text-tertiary)] italic">{t('view.pick_table_first', "Select a table first.")}</p>
                            ) : (
                                <FilterGroupEditor
                                    node={filterTree}
                                    onChange={setFilterTree}
                                    depth={0}
                                    ctx={{ tableFields: sortedTableFields, fieldMeta, fieldLabel, relationCache, defaultFilterValue, t }}
                                />
                            )}
                        </div>
                    )}

                    {activeTab === 'sort' && (
                        <div>
                            <div className="flex justify-between items-center mb-3">
                                <p className="text-xs text-[var(--text-secondary)]">
                                    {t('view.sort_intro', "Priority sorting: the first criterion rules, the rest break ties. With no criteria, rows sort by title ascending.")}
                                </p>
                                <button
                                    onClick={addSort}
                                    disabled={!selectedTable}
                                    className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)] hover:bg-[var(--gnosi-primary)]/20 disabled:opacity-40"
                                >
                                    <Plus size={12} />
                                    {t('view.add_sort', "Add criterion")}
                                </button>
                            </div>
                            {!selectedTable ? (
                                <p className="text-sm text-[var(--text-tertiary)] italic">{t('view.pick_table_first', "Select a table first.")}</p>
                            ) : sorts.length === 0 ? (
                                <p className="text-sm text-[var(--text-tertiary)] italic">{t('view.no_sorts', "No criteria. Default: title ascending.")}</p>
                            ) : (
                                <div className="space-y-2">
                                    <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleSortDragEnd}>
                                        <SortableContext items={sorts.map((_, idx) => `sort-${idx}`)} strategy={verticalListSortingStrategy}>
                                            {sorts.map((s, idx) => (
                                                <SortableRow
                                                    key={idx}
                                                    id={`sort-${idx}`}
                                                    className="flex gap-2 items-center rounded"
                                                >
                                                    <span className="text-[10px] font-bold text-[var(--text-tertiary)] w-4 text-center">
                                                        {idx + 1}
                                                    </span>
                                                    <select
                                                        className="text-xs border border-[var(--border-primary)] rounded px-2 py-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)] flex-1"
                                                        value={s.field}
                                                        onChange={e => updateSort(idx, { field: e.target.value })}
                                                    >
                                                        {sortedTableFields.map(tf => (
                                                            <option key={tf.name} value={tf.name}>{tf.displayName || fieldLabel(tf.name)}</option>
                                                        ))}
                                                    </select>
                                                    <select
                                                        className="text-xs border border-[var(--border-primary)] rounded px-2 py-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)] w-32"
                                                        value={s.direction}
                                                        onChange={e => updateSort(idx, { direction: e.target.value })}
                                                    >
                                                        <option value="asc">{t('view.asc', "Ascending")}</option>
                                                        <option value="desc">{t('view.desc', "Descending")}</option>
                                                    </select>
                                                    <button
                                                        onClick={() => removeSort(idx)}
                                                        className="text-[var(--text-tertiary)] hover:text-red-500 p-1"
                                                        title={t('view.delete', "Delete")}
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                </SortableRow>
                                            ))}
                                        </SortableContext>
                                    </DndContext>
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'grouping' && (
                        <div className="space-y-4">
                            {(viewType === 'table' || viewType === 'list' || viewType === 'gallery') && (
                                <div className="space-y-2">
                                    <p className="text-xs text-[var(--text-secondary)]">
                                        {t('view.grouping_intro', "Group records by a select or status field.")}
                                    </p>
                                    <label className="block text-xs font-semibold text-[var(--text-secondary)]">{t('view.group_by', "Group by")}</label>
                                    {!selectedTable ? (
                                        <p className="text-xs text-[var(--text-tertiary)] italic">{t('view.pick_table_first', "Select a table first.")}</p>
                                    ) : (
                                        <>
                                            <select
                                                value={groupBy}
                                                onChange={e => setGroupBy(e.target.value)}
                                                className="w-full text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                                            >
                                                <option value="">{t('view.no_grouping', "No grouping")}</option>
                                                {groupFieldOptions.map(f => (
                                                    <option key={f.name} value={f.name}>{fieldLabel(f.name)}</option>
                                                ))}
                                            </select>
                                            {groupFieldOptions.length === 0 && (
                                                <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">{t('view.no_group_fields', "No select/status field in the table to group by.")}</p>
                                            )}
                                        </>
                                    )}
                                </div>
                            )}

                            {(viewType === 'table' || viewType === 'list' || viewType === 'gallery') && groupBy && selectedTable && (
                                <div className="space-y-2">
                                    <label className="block text-xs font-semibold text-[var(--text-secondary)]">{t('view.group_order', "Group order")}</label>
                                    <div className="flex gap-2">
                                        <select
                                            value={groupSort}
                                            onChange={e => setGroupSort(e.target.value)}
                                            className="flex-1 text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                                        >
                                            <option value="catalog">{t('view.group_order_catalog', "Catalog order")}</option>
                                            <option value="alpha">{t('view.group_order_alpha', "Alphabetical")}</option>
                                            <option value="count">{t('view.group_order_count', "By record count")}</option>
                                        </select>
                                        <select
                                            value={groupSortDir}
                                            onChange={e => setGroupSortDir(e.target.value)}
                                            className="w-32 text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                                        >
                                            <option value="asc">{t('view.asc', "Ascending")}</option>
                                            <option value="desc">{t('view.desc', "Descending")}</option>
                                        </select>
                                    </div>
                                </div>
                            )}

                            {viewType === 'board' && (
                                <div className="space-y-2">
                                    <p className="text-xs text-[var(--text-secondary)]">
                                        {t('view.board_options_intro', "Choose how the kanban columns are grouped.")}
                                    </p>
                                    <label className="block text-xs font-semibold text-[var(--text-secondary)]">{t('view.group_by', "Group by")}</label>
                                    {!selectedTable ? (
                                        <p className="text-xs text-[var(--text-tertiary)] italic">{t('view.pick_table_first', "Select a table first.")}</p>
                                    ) : (
                                        <>
                                            <select
                                                value={groupBy}
                                                onChange={e => setGroupBy(e.target.value)}
                                                className="w-full text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                                            >
                                                <option value="">{t('view.group_auto', "Automatic (status)")}</option>
                                                {groupFieldOptions.map(f => (
                                                    <option key={f.name} value={f.name}>{fieldLabel(f.name)}</option>
                                                ))}
                                            </select>
                                            {groupFieldOptions.length === 0 && (
                                                <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">{t('view.no_group_fields_auto', "No select/status field in the table; it will group automatically.")}</p>
                                            )}
                                        </>
                                    )}
                                </div>
                            )}

                            {viewType === 'board' && groupBy && selectedTable && (
                                <div className="space-y-2">
                                    <label className="block text-xs font-semibold text-[var(--text-secondary)]">{t('view.group_order', "Group order")}</label>
                                    <div className="flex gap-2">
                                        <select
                                            value={groupSort}
                                            onChange={e => setGroupSort(e.target.value)}
                                            className="flex-1 text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                                        >
                                            <option value="catalog">{t('view.group_order_catalog', "Catalog order")}</option>
                                            <option value="alpha">{t('view.group_order_alpha', "Alphabetical")}</option>
                                            <option value="count">{t('view.group_order_count', "By record count")}</option>
                                        </select>
                                        <select
                                            value={groupSortDir}
                                            onChange={e => setGroupSortDir(e.target.value)}
                                            className="w-32 text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                                        >
                                            <option value="asc">{t('view.asc', "Ascending")}</option>
                                            <option value="desc">{t('view.desc', "Descending")}</option>
                                        </select>
                                    </div>
                                </div>
                            )}

                            {(viewType !== 'table' && viewType !== 'list' && viewType !== 'gallery' && viewType !== 'board') && (
                                <p className="text-sm text-[var(--text-tertiary)] italic">{t('view.no_grouping_for_type', "This view type does not support grouping.")}</p>
                            )}
                        </div>
                    )}

                    {error && (
                        <p className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
                            {error}
                        </p>
                    )}
                </div>

                {/* Footer — single Close button (autosave/flush handles persistence). */}
                <div className="px-5 py-4 border-t border-[var(--border-primary)] bg-[var(--bg-secondary)] flex items-center justify-between gap-3 rounded-b-xl shrink-0">
                    {/* Autosave status pill (table mode shows live state; embed mode
                        only shows transient states during the flush). */}
                    <div className="text-xs flex items-center gap-1.5 min-h-[1rem]">
                        {(autosaveStatus === 'saving' || flushing) && (
                            <span className="flex items-center gap-1.5 text-[var(--gnosi-primary)]">
                                <span className="inline-block w-2 h-2 rounded-full bg-current animate-pulse" />
                                {t('view.saving', "Saving…")}
                            </span>
                        )}
                        {autosaveStatus === 'saved' && !flushing && (
                            <span className="flex items-center gap-1.5 text-green-500">
                                <span className="inline-block w-2 h-2 rounded-full bg-current" />
                                {t('view.all_changes_saved', "All changes saved")}
                            </span>
                        )}
                        {autosaveStatus === 'error' && !flushing && (
                            <span className="flex items-center gap-1.5 text-red-500">
                                <span className="inline-block w-2 h-2 rounded-full bg-current" />
                                {t('view.error_create', "Unknown error creating the view")}
                            </span>
                        )}
                    </div>
                    <button
                        onClick={() => closeWithFlushRef.current()}
                        disabled={flushing}
                        className="btn-gnosi btn-gnosi-primary px-6"
                    >
                        {flushing ? t('view.saving', "Saving…") : (
                            isTableMode
                                ? t('common.close', "Close")
                                : (selectedExistingViewId && selectedExistingViewId !== 'default'
                                    ? t('common.insert', "Insert")
                                    : t('view.create_view', "Create view"))
                        )}
                    </button>
                </div>
            </div>
            {modalViewToDelete && (
                <ConfirmModal
                    isOpen={!!modalViewToDelete}
                    onClose={() => { setModalViewToDelete(null); setModalViewToDeleteUsage(null); }}
                    onConfirm={confirmDeleteViewFromModal}
                    title={t('views_header.delete_view_title', "Delete view")}
                    message={
                        modalViewToDeleteUsage && modalViewToDeleteUsage.count > 0
                            ? `${t('views_header.delete_linked_view_confirm', { count: modalViewToDeleteUsage.count, name: modalViewToDelete.name || '', defaultValue: "Aquesta vista està enllaçada a {{count}} pàgina(es):" })}\n\n${modalViewToDeleteUsage.pages.map(p => `• ${p.title}`).join('\n')}\n\n${t('views_header.confirm_delete_anyway', { defaultValue: "Segur que la vols eliminar de totes maneres?" })}`
                            : t('views_header.delete_view_confirm', "Delete the view \"{{name}}\" EVERYWHERE?", { name: modalViewToDelete.name || '' })
                    }
                    confirmText={t('common.delete', "Delete")}
                    cancelText={t('common.cancel', "Cancel")}
                    isDestructive
                />
            )}
        </div>
    );
}
