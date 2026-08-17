import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
    DndContext, closestCenter, PointerSensor, KeyboardSensor,
    useSensor, useSensors
} from '@dnd-kit/core';
import {
    SortableContext, horizontalListSortingStrategy,
    useSortable, arrayMove, sortableKeyboardCoordinates
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { FileText, Tag, Clock, Hash, CheckSquare, Calendar, Link as LinkIcon, Type, ArrowUp, ArrowDown, Settings, Settings2, Plus, ChevronDown, ChevronRight, ExternalLink, Search, X, Trash2, Filter, List, LayoutPanelLeft, Unlock, Columns2, Languages, Zap, Globe, Send, AlertTriangle, BrainCircuit, Loader2, Sparkles } from 'lucide-react';
import { IconRenderer } from './IconRenderer';
import { VaultDateProperty, parsePeriod, periodDaysInclusive } from './VaultDateProperty';
import { withPeriodBoundaries } from '../../utils/projectPlanning';
import { ImageHoverPreview } from './ImageHoverPreview';
import { FileFieldValue } from './FileFieldValue';
import { RelationItem } from './RelationItem';
import {
    RELATION_VALUE_APPLIED_EVENT,
    announceRelationUnlinked,
    normalizeRelationValues,
    withoutRelationValue,
} from './relationItemUtils';
import { filenameFromTarget, isImageFieldName, getImageSrc, parseImageField, buildImageValue, fileTargetKey, withActiveVault, canonicalStorageFolder } from '../../lib/fileResource';
import { InsertContentModal } from './InsertContentModal';
import { useTitlePreview } from './useTitlePreview';
import { normalizeTableFunctionalities } from './tableFunctionalityUtils';
import { getTableFocusTarget, getTableRecordFocusPreparation } from './tableRecordFocusUtils';
import { hasResourceReference } from './resourceLinkUtils';

// A cell's dropdown (select/multi_select) rendered in a PORTAL at
// `document.body` with `position: fixed`, anchored below the input. This way it escapes the
// embedded table's `overflow-auto` scroller (which used to clip it when
// the view was short) and the embed block's `isolate` stacking context, and
// always stays on top (max z-index). If it doesn't fit below, it flips upward.
// The click-outside for pickers must ignore clicks inside the portal: we mark it
// with `data-cell-dropdown` and check it with `closest('[data-cell-dropdown]')`.
const CellDropdownPortal = React.forwardRef(function CellDropdownPortal(
    { anchorRef, className = '', maxHeight = 240, children },
    ref,
) {
    const [pos, setPos] = useState(null);
    useLayoutEffect(() => {
        let raf = 0;
        const compute = () => {
            const el = anchorRef.current;
            // Layout effects run child-first: on the first mount the
            // the parent container's `ref` (anchorRef) may not be attached yet.
            // Retries on the next frame, when it's already there.
            if (!el) { raf = requestAnimationFrame(compute); return; }
            const r = el.getBoundingClientRect();
            const spaceBelow = window.innerHeight - r.bottom;
            const spaceAbove = r.top;
            const flipUp = spaceBelow < Math.min(maxHeight, 160) && spaceAbove > spaceBelow;
            const avail = (flipUp ? spaceAbove : spaceBelow) - 8;
            setPos({
                left: Math.round(r.left),
                width: Math.round(r.width),
                top: flipUp ? undefined : Math.round(r.bottom + 4),
                bottom: flipUp ? Math.round(window.innerHeight - r.top + 4) : undefined,
                maxHeight: Math.max(80, Math.min(maxHeight, avail)),
            });
        };
        compute();
        // `true` (capture) to catch scroll from ANY ancestor container
        // (the table's internal scroller), not just window's.
        window.addEventListener('scroll', compute, true);
        window.addEventListener('resize', compute);
        return () => {
            if (raf) cancelAnimationFrame(raf);
            window.removeEventListener('scroll', compute, true);
            window.removeEventListener('resize', compute);
        };
    }, [anchorRef, maxHeight]);

    if (!pos) return null;
    return createPortal(
        <div
            ref={ref}
            data-cell-dropdown
            className={`overflow-y-auto custom-scrollbar border border-[var(--border-primary)] rounded bg-[var(--bg-primary)] shadow-xl ${className}`}
            style={{
                position: 'fixed',
                left: pos.left,
                width: pos.width,
                top: pos.top,
                bottom: pos.bottom,
                maxHeight: pos.maxHeight,
                zIndex: 'var(--z-popover)',
            }}
        >
            {children}
        </div>,
        document.body,
    );
});

// Sortable data-column header (dnd-kit, same pattern as VaultDocumentTabs).
// The drag handle is the inner label div, NOT the whole th: the resize handle
// (a sibling passed via `resizeHandle`) never starts a column reorder. When
// `disabled` (canReorderColumns false) no listeners/attributes are attached, so
// the header behaves as a plain click-to-sort cell.
function SortableColumnTh({ id, disabled, width, className, handleClassName, onHeaderClick, resizeHandle, children }) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
    // z-index while dragging: above sibling headers but below the sticky
    // checkbox/title columns (z-40), which must keep covering it.
    return (
        <th
            ref={setNodeRef}
            style={{
                width,
                transform: CSS.Transform.toString(transform),
                transition,
                zIndex: isDragging ? 10 : undefined,
            }}
            className={`${className} ${isDragging ? 'opacity-40' : ''}`}
        >
            <div
                {...(disabled ? {} : { ...attributes, ...listeners })}
                className={handleClassName}
                onClick={onHeaderClick}
            >
                {children}
            </div>
            {resizeHandle}
        </th>
    );
}

const InlinePillsPicker = ({
    value = [],
    options = [],
    idToTitle = {},
    optionColors = {},
    onSave,
    onCreate,
    onDeleteOption,
    relationItems = false,
    onOpenRelation,
    onRemoveRelation,
}) => {
    const { t } = useTranslation();
    const [localValues, setLocalValues] = useState(value);
    const [search, setSearch] = useState('');
    const containerRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (e) => {
            // The dropdown lives in a portal (outside containerRef): it doesn't
            // count it as "outside".
            if (containerRef.current && !containerRef.current.contains(e.target) && !e.target.closest?.('[data-cell-dropdown]')) {
                onSave(localValues);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [localValues, onSave]);

    const toggle = (val) => {
        setLocalValues(prev =>
            prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]
        );
    };

    const filtered = options.filter(opt =>
        String(idToTitle[opt] ?? opt ?? '').toLowerCase().includes(search.toLowerCase()) &&
        !localValues.includes(opt)
    );
    const term = search.trim();
    const canCreate = Boolean(term && onCreate && !options.includes(term));

    const handleCreate = () => {
        if (!canCreate) return;
        onCreate(term);              // persists the option to the schema
        setLocalValues(prev => [...prev, term]); // and selects it in this record
        setSearch('');
    };

    const handleDelete = (val) => {
        if (!onDeleteOption) return;
        onDeleteOption(val);         // removes the option from the field's catalog
        setLocalValues(prev => prev.filter(v => v !== val)); // and of this record
    };

    return (
        <div ref={containerRef} className="w-full">
            <div className="flex flex-wrap gap-1 mb-1 min-h-[20px]">
                {localValues.map(val => relationItems ? (
                    <RelationItem
                        key={val}
                        relationId={val}
                        title={idToTitle[val] || val}
                        onOpen={onOpenRelation}
                        onRemove={onRemoveRelation ? async () => {
                            const removed = await onRemoveRelation(val);
                            if (removed !== false) {
                                setLocalValues(prev => prev.filter(item => item !== val));
                            }
                        } : undefined}
                    />
                ) : (
                    <span key={val} className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-medium bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)] border border-[var(--gnosi-primary)]/20 whitespace-nowrap">
                        {idToTitle[val] || (val.length > 16 ? val.substring(0, 8) + '…' : val)}
                        <X size={9} className="cursor-pointer hover:text-red-500 shrink-0" onMouseDown={e => { e.preventDefault(); toggle(val); }} />
                    </span>
                ))}
            </div>
            <input
                autoFocus
                className="w-full px-2 py-0.5 text-xs border border-[var(--border-primary)] rounded bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                placeholder={onCreate ? t('table.search_or_create_placeholder', "Search or create…") : t('table.search_placeholder', "Search…")}
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => {
                    if (e.key === 'Escape') onSave(localValues);
                    if (e.key === 'Enter') { e.preventDefault(); handleCreate(); }
                }}
            />
            {(filtered.length > 0 || canCreate) && (
                <CellDropdownPortal anchorRef={containerRef} maxHeight={128}>
                    {filtered.map(opt => (
                        <div
                            key={opt}
                            className="flex items-center justify-between gap-2 px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--gnosi-primary)]/10 hover:text-[var(--gnosi-primary)] cursor-pointer group"
                            onMouseDown={e => { e.preventDefault(); toggle(opt); }}
                        >
                            <span className="flex items-center gap-1.5 truncate">
                                {optionColors[opt] && (
                                    <span className="shrink-0 w-2 h-2 rounded-full" style={{ backgroundColor: optionChipStyle(optionColors[opt])?.color }} />
                                )}
                                {idToTitle[opt] || opt}
                            </span>
                            {onDeleteOption && (
                                <span
                                    role="button"
                                    title={t('table.delete_option_tooltip', "Delete the field's option")}
                                    onMouseDown={e => { e.preventDefault(); e.stopPropagation(); handleDelete(opt); }}
                                    className="shrink-0 p-0.5 rounded text-[var(--text-tertiary)]/50 opacity-0 group-hover:opacity-100 hover:text-[var(--status-error)] transition-colors"
                                >
                                    <Trash2 size={12} />
                                </span>
                            )}
                        </div>
                    ))}
                    {canCreate && (
                        <div
                            className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-[var(--gnosi-primary)] hover:bg-[var(--gnosi-primary)]/10 cursor-pointer"
                            onMouseDown={e => { e.preventDefault(); handleCreate(); }}
                        >
                            <Plus size={12} /> {t('table.create_option', "Create \"{{term}}\"", { term })}
                        </div>
                    )}
                </CellDropdownPortal>
            )}
        </div>
    );
};

// Inline single-value picker for select/status cells in the table.
// Replaces the native <select> to allow searching, creating, and deleting options
// (Notion style). Keyboard-navigable (↑↓/Enter/Esc) sharing a single
// highlightedIndex with hover — see the canonical pattern in MultiSelectPills.
const InlineSelectPicker = ({ value = '', options = [], idToTitle = {}, optionColors = {}, onSave, onCreate, onDeleteOption }) => {
    const { t } = useTranslation();
    const [search, setSearch] = useState('');
    const [highlightedIndex, setHighlightedIndex] = useState(0);
    const containerRef = useRef(null);
    const listRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (e) => {
            if (containerRef.current && !containerRef.current.contains(e.target) && !e.target.closest?.('[data-cell-dropdown]')) {
                onSave(value); // closes without changing (handleCellSave does an early return if it's the same)
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [value, onSave]);

    const filtered = options.filter(opt =>
        String(idToTitle[opt] ?? opt ?? '').toLowerCase().includes(search.toLowerCase())
    );
    const term = search.trim();
    const canCreate = Boolean(term && onCreate && !options.includes(term));
    const totalItems = filtered.length + (canCreate ? 1 : 0);

    // The highlight reset when the search changes happens in the input's onChange
    // (not in an effect) to avoid a cascading render.
    useEffect(() => {
        const el = listRef.current?.querySelector(`[data-idx="${highlightedIndex}"]`);
        if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
    }, [highlightedIndex]);

    const handleKeyDown = (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (totalItems > 0) setHighlightedIndex(i => Math.min(i + 1, totalItems - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlightedIndex(i => Math.max(i - 1, 0));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (highlightedIndex < filtered.length) onSave(filtered[highlightedIndex]);
            else if (canCreate) onCreate(term);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            onSave(value);
        }
    };

    return (
        <div ref={containerRef} className="w-full">
            <input
                autoFocus
                className="w-full px-2 py-0.5 text-xs border border-[var(--border-primary)] rounded bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                placeholder={onCreate ? t('table.search_or_create_placeholder', "Search or create…") : t('table.search_placeholder', "Search…")}
                value={search}
                onChange={e => { setSearch(e.target.value); setHighlightedIndex(0); }}
                onKeyDown={handleKeyDown}
            />
            <CellDropdownPortal ref={listRef} anchorRef={containerRef} maxHeight={160}>
                {filtered.map((opt, idx) => {
                    const isHighlighted = idx === highlightedIndex;
                    return (
                        <div
                            key={opt}
                            data-idx={idx}
                            onMouseEnter={() => setHighlightedIndex(idx)}
                            onMouseDown={e => { e.preventDefault(); onSave(opt); }}
                            className={`flex items-center justify-between gap-2 px-2 py-1 text-xs cursor-pointer group ${isHighlighted ? 'bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)]' : 'text-[var(--text-secondary)]'} ${value === opt ? 'font-semibold' : ''}`}
                        >
                            <span className="flex items-center gap-1.5 truncate">
                                {optionColors[opt] && (
                                    <span className="shrink-0 w-2 h-2 rounded-full" style={{ backgroundColor: optionChipStyle(optionColors[opt])?.color }} />
                                )}
                                {idToTitle[opt] || opt}
                            </span>
                            {onDeleteOption && (
                                <span
                                    role="button"
                                    title={t('table.delete_option_tooltip', "Delete the field's option")}
                                    onMouseDown={e => { e.preventDefault(); e.stopPropagation(); onDeleteOption(opt); }}
                                    className="shrink-0 p-0.5 rounded text-[var(--text-tertiary)]/50 opacity-0 group-hover:opacity-100 hover:text-[var(--status-error)] transition-colors"
                                >
                                    <Trash2 size={12} />
                                </span>
                            )}
                        </div>
                    );
                })}
                {canCreate && (
                    <div
                        data-idx={filtered.length}
                        onMouseEnter={() => setHighlightedIndex(filtered.length)}
                        onMouseDown={e => { e.preventDefault(); onCreate(term); }}
                        className={`flex items-center gap-1 px-2 py-1 text-xs font-medium text-[var(--gnosi-primary)] cursor-pointer ${highlightedIndex === filtered.length ? 'bg-[var(--gnosi-primary)]/10' : ''}`}
                    >
                        <Plus size={12} /> {t('table.create_option', "Create \"{{term}}\"", { term })}
                    </div>
                )}
                {filtered.length === 0 && !canCreate && (
                    <div className="px-2 py-1 text-xs text-[var(--text-tertiary)]/60 italic">{t('table.no_options', "No options")}</div>
                )}
            </CellDropdownPortal>
        </div>
    );
};

import { AutoriaEditor, AutoriaDisplay } from './AutoriaField';
import { dedupeAuthors } from './autoriaUtils';
import { useVaultViewData } from '../../hooks/useVaultViewData';
import { VaultViewToolbar } from './VaultViewToolbar';
import { evaluateFormula } from './formulaUtils';
import { evaluateRollup } from './rollupUtils';
import { normalizeOptions, optionChipStyle, optionColorHex, checkActionRequires } from './optionCatalogUtils';
import { getFieldConfig, getFieldType, getSchemaFieldEntries, getSchemaFieldNames, getLanguageFieldName, resolveFieldRef, resolveSystemDateValue, resolveViewSorts, resolveViewFilters, withResolvedSystemDates } from './schemaUtils';
import {
    isComputedType,
    isPasteableType,
    serializeCellForClipboard,
    parseClipboardMatrix,
    coerceValueForField,
    sameCellValue,
    clampIndex,
    computePasteRect,
} from './cellGridUtils';
import { formatNumber, formatDate, resolveFieldFormat } from './formatUtils';
import { useLocaleSettings } from '../../hooks/useLocaleSettings';
import { useAuth } from '../../context/AuthContext';
import { applyDefaultFormulasToMetadata } from './defaultFormulaUtils';
import { useVaultSelection } from '../../hooks/useVaultSelection';
import { useVaultSelectionShortcuts } from '../../hooks/useVaultSelectionShortcuts';
import { VaultBulkActionsBar } from './VaultBulkActionsBar';
import { TranslateLanguagesModal } from './TranslateLanguagesModal';
import { SyncDrupalModal } from './SyncDrupalModal';
import { PublishSocialModal } from './PublishSocialModal';
import { ProcessResourceModal } from './ProcessResourceModal';
import axios from 'axios';
import { toast } from '../../lib/toast';
import { notifyError } from '../../lib/notifyError';
import { useVirtualizer } from '@tanstack/react-virtual';
import { asBool } from '../../utils/vaultFilters';
import { usePlugins } from '../../plugins/usePlugins';

/**
 * Sentinel that fires `onLoadMore` when it enters the viewport.
 *
 * Replaces the manual "Show more" button: the table loads the first
 * `ROWS_BATCH_SIZE` rows and, when the user reaches the end, the next ones
 * appear on their own. This way we don't pay the cost of mounting 300 rows on the first
 * render (~4 s observed) and we keep the feel of a complete list.
 *
 * Implemented with `IntersectionObserver` (zero polling, released on
 * dismount) + a synchronous fallback button in case the autoload doesn't trigger
 * (DOM where the sentinel isn't visible, e.g. inside a dialog with
 * `display:none` while switching tabs).
 */
const InfiniteLoadSentinel = React.memo(function InfiniteLoadSentinel({ visibleCount, total, batchSize, onLoadMore, label }) {
    const ref = useRef(null);
    useEffect(() => {
        const el = ref.current;
        if (!el) return undefined;
        const io = new IntersectionObserver((entries) => {
            for (const e of entries) {
                if (e.isIntersecting) {
                    onLoadMore();
                    break;
                }
            }
        }, { rootMargin: '300px' });
        io.observe(el);
        return () => io.disconnect();
    }, [onLoadMore]);

    return (
        <div
            ref={ref}
            className="px-4 py-3 border-t border-[var(--border-primary)] bg-[var(--bg-primary)] flex items-center justify-between"
        >
            <span className="text-xs text-[var(--text-tertiary)]">{label}</span>
            <button
                onClick={onLoadMore}
                className="btn-gnosi btn-gnosi-primary !px-3 !py-1.5"
            >
                +{Math.min(batchSize, total - visibleCount)}
            </button>
        </div>
    );
});

// ── Keyboard ownership across VaultTable INSTANCES ─────────────────────
// The keyboard listener is global (window) and each instance mounts one: with
// a split panel or 2+ embedded tables on the same page, each arrow
// moved the cursor of ALL the grids at once and ⌫/⌘V edited/cleared cells
// of tables the user wasn't touching (real PATCHes). A single instance "owns"
// the keyboard: the last one the user interacted with (click, entry via nav
// from the editor) or, if none, the first one that initializes. The rest ignore the events.
let _gridKeyboardOwner = null;
let _gridInstanceSeq = 0;

export function VaultTable({ notes, onNoteSelect, schema = {}, idToTitle = {}, allNotes = [], activeView, onUpdateView, isEmbedded = false, isListView = false, onCreateRecord, onDeletePage, onDeleteSelected, onApplyTemplate, templates = [], onCellSaved, onUpdateFieldOptions, onOpenParallel, onTranslated, searchTerm: searchTermProp, actionRules = null, functionalities = null, maxHeight = null, registerNavApi = null, onExitTop = null, onExitBottom = null, onEscape = null, restoreRecordFocus = null, onRecordFocusRestored = null }) {
    const { isEnabled: isPluginEnabled, getPluginSettings } = usePlugins();
    const projectPlanningEnabled = isPluginEnabled('project-planning');
    const projectPlanningSettings = getPluginSettings('project-planning');
    const [llmWikiConfig, setLlmWikiConfig] = useState(null);
    const [llmWikiJobs, setLlmWikiJobs] = useState({});
    useEffect(() => {
        let alive = true;
        if (!isPluginEnabled('llm-wiki')) {
            setLlmWikiConfig(null);
            return () => { alive = false; };
        }
        axios.get('/api/vault/llm-wiki/config')
            .then((response) => {
                if (!alive) return;
                setLlmWikiConfig(response.data?.config
                    ? {
                        ...response.data.config,
                        processed_resources: response.data.processed_resources || {},
                    }
                    : null);
                setLlmWikiJobs(response.data?.resource_statuses || {});
            })
            .catch((error) => {
                if (alive) setLlmWikiConfig(null);
                console.warn('Could not load the LLM Wiki table configuration:', error);
            });
        return () => { alive = false; };
    }, [isPluginEnabled]);
    const { t, i18n } = useTranslation();
    // Stable identity of this instance for keyboard ownership.
    const gridInstanceIdRef = useRef(null);
    if (!gridInstanceIdRef.current) gridInstanceIdRef.current = `vault-grid-${++_gridInstanceSeq}`;
    const claimKeyboard = useCallback(() => { _gridKeyboardOwner = gridInstanceIdRef.current; }, []);
    // On unmount, release the property if it was ours.
    useEffect(() => () => {
        if (_gridKeyboardOwner === gridInstanceIdRef.current) _gridKeyboardOwner = null;
    }, []);
    // Current user (for the "Created by"/"Edited by" fields in personal mode).
    const { user: currentUser } = useAuth();
    // Global format defaults (currency/number/date) — overridden per field via config.format.
    const localeSettings = useLocaleSettings();
    // Optimistic overrides per cell. Map<noteId, partialMetadata>. When
    // the user edits a field, we apply the change here *before* the PATCH to the
    // backend; this way the UI reflects the new data right away (0 ms perceived)
    // and the backend (~200-450 ms) runs in the background. They are cleared
    // automatically in the `useEffect` below when the `notes` prop arrives
    // with the desired value already reflected (post-refetch); if the PATCH fails,
    // the catch in `handleCellSave` removes them manually (rollback) and shows
    // an error toast.
    const [optimisticPatches, setOptimisticPatches] = useState(() => new Map());
    const relationHistoryProtectionRef = useRef(new Map());
    const refreshAfterRelationHistoryRef = useRef(null);
    refreshAfterRelationHistoryRef.current = () => {
        if (onCellSaved) return onCellSaved();
        if (onUpdateView) return onUpdateView(activeView);
        return undefined;
    };
    useEffect(() => {
        const applyRelationValue = (event) => {
            const detail = event.detail || {};
            if (!detail.pageId || !detail.metadataKey) return;
            const protectionKey = `${detail.pageId}::${detail.metadataKey}`;
            const previousTimer = relationHistoryProtectionRef.current.get(protectionKey);
            if (previousTimer) window.clearTimeout(previousTimer);
            setOptimisticPatches(prev => {
                const next = new Map(prev);
                const existing = next.get(detail.pageId) || {};
                next.set(detail.pageId, {
                    ...existing,
                    [detail.metadataKey]: normalizeRelationValues(detail.value),
                });
                return next;
            });
            const timer = window.setTimeout(async () => {
                try {
                    await refreshAfterRelationHistoryRef.current?.();
                } finally {
                    relationHistoryProtectionRef.current.delete(protectionKey);
                    setOptimisticPatches(prev => {
                        const next = new Map(prev);
                        const existing = next.get(detail.pageId);
                        if (!existing) return prev;
                        const { [detail.metadataKey]: _removed, ...rest } = existing;
                        if (Object.keys(rest).length === 0) next.delete(detail.pageId);
                        else next.set(detail.pageId, rest);
                        return next;
                    });
                }
            }, 4500);
            relationHistoryProtectionRef.current.set(protectionKey, timer);
        };
        window.addEventListener(RELATION_VALUE_APPLIED_EVENT, applyRelationValue);
        return () => {
            window.removeEventListener(RELATION_VALUE_APPLIED_EVENT, applyRelationValue);
            for (const timer of relationHistoryProtectionRef.current.values()) {
                window.clearTimeout(timer);
            }
            relationHistoryProtectionRef.current.clear();
        };
    }, []);
    // Optimistic override of the title. Map<noteId, newTitle>. The title lives in
    // `note.title` (not in metadata), so `optimisticPatches` doesn't cover it;
    // this map gives immediate feedback when editing it inline. It clears itself when
    // the refetch reflects the new title (see the effect below).
    const [optimisticTitles, setOptimisticTitles] = useState(() => new Map());
    // We stabilize the reference to `notes || []` to prevent it from changing on
    // every render and invalidating `useMemo`/`useEffect` for no reason.
    const rawNotes = useMemo(() => notes || [], [notes]);
    const safeNotes = useMemo(() => {
        if (optimisticPatches.size === 0 && optimisticTitles.size === 0) return rawNotes;
        return rawNotes.map(n => {
            const patch = optimisticPatches.get(n.id);
            const titleOverride = optimisticTitles.get(n.id);
            if (!patch && titleOverride === undefined) return n;
            return {
                ...n,
                ...(titleOverride !== undefined ? { title: titleOverride } : {}),
                metadata: patch ? { ...(n.metadata || {}), ...patch } : n.metadata,
            };
        });
    }, [rawNotes, optimisticPatches, optimisticTitles]);
    const datedNotes = useMemo(
        () => safeNotes.map(note => withResolvedSystemDates(note, schema)),
        [safeNotes, schema],
    );

    // Clears title overrides already reflected in the `notes` prop (post-refetch).
    useEffect(() => {
        if (optimisticTitles.size === 0) return;
        setOptimisticTitles(prev => {
            let changed = false;
            const next = new Map(prev);
            for (const [id, title] of prev) {
                const fresh = rawNotes.find(n => n.id === id);
                if (fresh && fresh.title === title) { next.delete(id); changed = true; }
            }
            return changed ? next : prev;
        });
    }, [rawNotes, optimisticTitles]);

    // Clears patches that are already reflected in `notes` (after a
    // successful refetch). Without this, the overrides would accumulate indefinitely.
    useEffect(() => {
        if (optimisticPatches.size === 0) return;
        setOptimisticPatches(prev => {
            let changed = false;
            const next = new Map(prev);
            for (const [noteId, patch] of next) {
                const note = rawNotes.find(n => n.id === noteId);
                if (!note) continue;
                // `sameCellValue` (not ===): ARRAY values (multi_select,
                // relation, files) were never strictly equal to the copy
                // fresh and the override stayed alive forever, masking changes
                // external (rule engine, inverse relations, other clients).
                const allMatch = Object.entries(patch).every(
                    ([k, v]) => sameCellValue((note.metadata || {})[k], v)
                );
                const isHistoryProtected = Object.keys(patch).some(
                    key => relationHistoryProtectionRef.current.has(`${noteId}::${key}`)
                );
                if (allMatch && !isHistoryProtected) {
                    next.delete(noteId);
                    changed = true;
                }
            }
            return changed ? next : prev;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps -- we only want to react to changes in `notes`
    }, [rawNotes]);
    // Initial batch size. Rendering 200 rows × ~12 cells (~2400
    // React components) on the first mount of a table with 303 records
    // took ~4 s with the main thread frozen. We load 50 of them
    // up front (~600 components, ~700 ms) and the rest via autoload on
    // on scroll. The UX stays the same because the rest appear before
    // the user gets there.
    const ROWS_BATCH_SIZE = 50;

    // State for column widths — initialized from the view (persistent).
    const [columnWidths, setColumnWidths] = useState(() => ({
        title: 250,
        last_modified: 150,
        ...(activeView?.columnWidths || {}),
    }));
    const columnWidthsRef = useRef({});
    columnWidthsRef.current = columnWidths;
    // When switching views (each view has its own widths), re-synchronize.
    useEffect(() => {
        setColumnWidths({ title: 250, last_modified: 150, ...(activeView?.columnWidths || {}) });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeView?.id]);

    // Configurable row height (activeView.rowHeight): compact/normal/tall.
    const rowHeight = activeView?.rowHeight || 'normal';
    const rowPadClass = rowHeight === 'compact' ? 'py-1' : (rowHeight === 'tall' ? 'py-4' : 'py-2.5');

    // Row grouping (activeView.groupBy): name of a field from the schema
    // (select/status/multi_select). Empty = no grouping (current flat table).
    const groupByField = activeView?.groupBy || '';

    // Refs for drag state
    const resizingCol = useRef(null);
    const startX = useRef(0);
    const startWidth = useRef(0);

    const [, setIsDropdownOpen] = useState(false);
    const [editingCell, setEditingCell] = useState(null); // { rowId, field, activeMetaKey }
    // ── Notion/Excel-style grid ───────────────────────────────────────
    // `activeCell` is the CURSOR (highlighted border) and is independent of
    // `editingCell` (open input). `anchorCell` is the anchor of a
    // rectangular selection (Shift+arrows / Shift+click); the range is the rectangle
    // between anchor and cursor. See docs/dev_memory/directives/vault_table_cell_grid.md
    const [activeCell, setActiveCell] = useState(null);   // { rowId, field }
    const [anchorCell, setAnchorCell] = useState(null);   // { rowId, field } | null
    const [editInitial, setEditInitial] = useState(null); // char inicial en type-to-edit (text/number)
    const clipboardRef = useRef(null);                    // { matrix: rawValues[][] } — porta-retalls intern
    // Refs for event closures — allow the keyboard listener
    // reads current values without rebuilding itself on every keypress.
    const activeCellRef = useRef(null);
    activeCellRef.current = activeCell;
    const anchorCellRef = useRef(null);
    anchorCellRef.current = anchorCell;
    const editingCellRef = useRef(null);
    editingCellRef.current = editingCell;
    // Content preview on hover (or Space/Quick Look)
    // over a record's title. A single card for the whole table; the listener
    // global keyboard listener invokes it via `titlePreviewRef` (without recreating itself).
    const titlePreview = useTitlePreview({ onOpenPage: onNoteSelect });
    const titlePreviewRef = useRef(null);
    titlePreviewRef.current = titlePreview;
    const [mediaPickerCell, setMediaPickerCell] = useState(null); // { rowId, field, originalMetaKey, tableId }
    // Confirmation when deleting a file from a `files` field:
    // { rowId, field, originalMetaKey, idx, arr, target, fileName }
    const [fileDeletePrompt, setFileDeletePrompt] = useState(null);
    const [fileDeleteBusy, setFileDeleteBusy] = useState(false);
    useEffect(() => {
        if (!fileDeletePrompt) return undefined;
        const onKey = (e) => { if (e.key === 'Escape' && !fileDeleteBusy) setFileDeletePrompt(null); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [fileDeletePrompt, fileDeleteBusy]);
    const [aggregations, setAggregations] = useState({}); // { field: 'sum' | 'avg' | 'count' | 'none' }
    const [internalSearchTerm] = useState('');
    const searchTerm = searchTermProp !== undefined ? searchTermProp : internalSearchTerm;

    const [expandedRows, setExpandedRows] = useState(new Set()); // IDs of expanded rows
    const [expandedGroups, setExpandedGroups] = useState(() => new Set()); // EXPANDED group keys (grouping); default: collapsed
    const [newSubitemTitle, setNewSubitemTitle] = useState(''); // title for the new inline subitem
    const [addingSubitemFor, setAddingSubitemFor] = useState(null); // parent ID for adding a subitem
    const [openingResourceId, setOpeningResourceId] = useState(null);
    const [visibleRowsCount, setVisibleRowsCount] = useState(ROWS_BATCH_SIZE);
    // Snapshot of ids for bulk translation (GAP 3c). We capture the selection
    // when opening the modal so clearing it afterward doesn't empty the request.
    const [bulkTranslateIds, setBulkTranslateIds] = useState(null);
    const [openHeaderHelp, setOpenHeaderHelp] = useState({});

    // The table is translatable if it has at least one field marked `translatable`. This is the
    // same signal the backend validates (translate-row returns 400 if there aren't
    // any) and that SchemaConfigModal only writes when translation is enabled
    // — that's why no additional `translation_enabled` prop is needed.
    const isTranslatableTable = useMemo(
        () => getSchemaFieldNames(schema).some(
            (name) => getFieldConfig(schema, name)?.translatable === true
        ),
        [schema]
    );
    // Shows the Drupal sync button when the table has the feature
    // enabled. The signal is in the schema: enabling it adds
    // `system` "Drupal NID/URL" columns (see SchemaConfigModal), so there's no need for
    // thread a new prop through every place that renders VaultTable.
    const isDrupalSyncTable = useMemo(
        () => getSchemaFieldNames(schema).some((name) => {
            const cfg = getFieldConfig(schema, name);
            return cfg?.system === true && /drupal/i.test(name);
        }),
        [schema]
    );
    // Shows the "Publish to XXSS" button when the table has the feature enabled. When
    // enabling it, SchemaConfigModal adds a `system` "XXSS" column
    // (publication status), so the signal lives in the schema just like Drupal.
    const isSocialPublishTable = useMemo(
        () => getSchemaFieldNames(schema).some((name) => {
            const cfg = getFieldConfig(schema, name);
            return cfg?.system === true && /xxss|social/i.test(name);
        }),
        [schema]
    );
    const tableFunctionalities = useMemo(
        () => normalizeTableFunctionalities(functionalities, schema).filter((functionality) => functionality.enabled !== false),
        [functionalities, schema]
    );
    const hasTranslateFunctionality = tableFunctionalities.some((functionality) => functionality.action === 'translate_row');
    // The Brain action is gated by plugin state and the v2 source-table
    // configuration. A historical processed-date column may remain after the
    // plugin is disabled, so schema heuristics are deliberately not used.
    const llmWikiTableId = String(
        notes.find((note) => note?.metadata?.table_id)?.metadata?.table_id
        || schema?.id
        || schema?.table_id
        || '',
    );
    const llmWikiSourceConfig = (llmWikiConfig?.source_tables || []).find(
        (source) => source.table_id === llmWikiTableId,
    ) || null;
    const isLlmWikiTable = useMemo(
        () => isPluginEnabled('llm-wiki') && Boolean(llmWikiSourceConfig),
        [isPluginEnabled, llmWikiSourceConfig],
    );
    // `useCallback` to keep the reference stable: `React.memo` in
    // `InfiniteLoadSentinel` only works if the props don't change on
    // every parent render. Without this, a new inline function per
    // render causes the sentinel to remount and `IntersectionObserver`
    // reconnects, firing `onLoadMore` immediately and in a loop until
    // fill the list — effectively negated the benefit of batching.
    const handleLoadMoreRows = useCallback(() => {
        setVisibleRowsCount(prev => prev + ROWS_BATCH_SIZE);
    }, [ROWS_BATCH_SIZE]);
    const [newRowTitle, setNewRowTitle] = useState('');
    // Pending action triggered by a `button`-type field. If it's set,
    // we show the modal corresponding to the action (currently only `translate_row`).
    const [pendingAction, setPendingAction] = useState(null);
    const [executingButtonKey, setExecutingButtonKey] = useState(null);
    const dropdownRef = useRef(null);
    const subitemInputRef = useRef(null);
    const newRowInputRef = useRef(null);

    // Close dropdown on outside click
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Focus input when subitem form opens
    useEffect(() => {
        if (addingSubitemFor && subitemInputRef.current) {
            subitemInputRef.current.focus();
        }
    }, [addingSubitemFor]);

    // ---- UNIFIED DATA LOGIC (FILTERS, SORT, SEARCH) ----
    // `resolveViewSorts` resolves BOTH registry keys (`sorts` array
    // complete — Notion import/modal — and legacy `sort`) and both forms
    // (object or array). Before, only `activeView.sort` was read and the order
    // configured by ALL imported views (which persist `sorts`)
    // was silently ignored. With no config: most recent first; with
    // explicit but empty config (the user has removed all orders): no order.
    // Memoized: `resolveViewSorts`/`resolveViewFilters` return NEW arrays on
    // every call and, without useMemo, the sort/filtering in useVaultViewData was
    // recalculated on every render of the table.
    const effectiveSorts = useMemo(
        () => resolveViewSorts(activeView, { field: "last_modified", direction: "desc" }),
        [activeView]
    );
    // The primary order governs the header's asc/desc arrow and the toggle.
    const activeSort = effectiveSorts[0] || {};
    // Stable signature (multi-field) to reinitialize the cursor when the order changes.
    const sortSignature = effectiveSorts.map(s => `${s.field}:${s.direction}`).join(',');

    const viewConfig = useMemo(() => ({
        filters: resolveViewFilters(activeView),
        sort: effectiveSorts,
        search: searchTerm
    }), [activeView, effectiveSorts, searchTerm]);

    const { sortedPages: sortedAndFilteredNotes } = useVaultViewData({ pages: datedNotes, schema, view: viewConfig, searchTerm });

    const resolveNoteTableId = useCallback((note) => note?.resolved_table_id || note?.metadata?.table_id || note?.metadata?.database_table_id || null, []);

    // ---- SUBITEMS TREE CONSTRUCTION (only if enableSubitems is true) ----
    const enableSubitems = !!activeView?.enableSubitems;

    // Obtain IDs of all notes in this table
    const allNoteIds = new Set(safeNotes.map(n => n.id));

    // Identify children: notes with parent_id pointing to a note in this table
    const childrenMap = {};
    const rootNotes = [];

    // COMPLETE children map (over safeNotes, WITHOUT the view's filters),
    // only for propagation to the parent: deciding "all children done" or the
    // min/max of dates with only the VISIBLE children marked the parent as
    // Completed even though it had pending children hidden by the filter.
    const allChildrenByParent = {};

    if (enableSubitems) {
        sortedAndFilteredNotes.forEach(note => {
            const pid = note.metadata?.parent_id || note.parent_id || note.metadata?.source_parent_id;
            if (pid && allNoteIds.has(pid)) {
                if (!childrenMap[pid]) childrenMap[pid] = [];
                childrenMap[pid].push(note);
            } else {
                rootNotes.push(note);
            }
        });
        safeNotes.forEach(note => {
            const pid = note.metadata?.parent_id || note.parent_id || note.metadata?.source_parent_id;
            if (pid && allNoteIds.has(pid)) {
                if (!allChildrenByParent[pid]) allChildrenByParent[pid] = [];
                allChildrenByParent[pid].push(note);
            }
        });
    } else {
        rootNotes.push(...sortedAndFilteredNotes);
    }
 
    const sortedNotes = rootNotes; // They come filtered and sorted from the hook

    // ---- MULTIPLE SELECTION ----
    const { selectedIds, isSelected, toggleSelect, selectAll, clearSelection } = useVaultSelection(sortedNotes);
    const lastSelectedId = [...selectedIds].at(-1) ?? null;
    const selectedIdsRef = useRef(null);
    selectedIdsRef.current = selectedIds;

    const handleBulkDelete = useCallback(() => {
        if (selectedIds.size === 0) return;
        if (onDeleteSelected) {
            onDeleteSelected(new Set(selectedIds));
            clearSelection();
        } else if (onDeletePage) {
            selectedIds.forEach(id => {
                const note = safeNotes.find(n => n.id === id);
                if (note) onDeletePage(id, note.title);
            });
            clearSelection();
        }
    }, [selectedIds, onDeleteSelected, onDeletePage, safeNotes, clearSelection]);

    const handleApplyTemplate = useCallback((templateId) => {
        if (!templateId || selectedIds.size === 0 || !onApplyTemplate) return;
        onApplyTemplate(new Set(selectedIds), templateId);
        clearSelection();
    }, [selectedIds, onApplyTemplate, clearSelection]);

    useVaultSelectionShortcuts({
        selectedCount: selectedIds.size,
        onClearSelection: clearSelection,
        onDeleteSelection: handleBulkDelete,
        enabled: !editingCell,
    });

    // Keyboard shortcut Cmd/Ctrl + O
    useEffect(() => {
        const handleKeyDown = (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'o') {
                if (lastSelectedId) {
                    e.preventDefault();
                    onNoteSelect(lastSelectedId, { returnFocusId: lastSelectedId });
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [lastSelectedId, onNoteSelect]);

    const visibleRootNotes = useMemo(() => sortedNotes.slice(0, visibleRowsCount), [sortedNotes, visibleRowsCount]);

    useEffect(() => {
        setVisibleRowsCount(ROWS_BATCH_SIZE);
    }, [activeView?.id, searchTerm, sortedNotes.length]);

    // ── Virtualization (TanStack Virtual) ───────────────────────────────
    // The first mount of a table with 303 records took 1-4 s because
    // it mounted the N rows × ~12 cells at once. Here we only render the
    // rows actually within the viewport + a few extra to anticipate the
    // scroll (`overscan`). The cost of the first paint drops to O(viewport),
    // independent of the table's total size.
    //
    // **Descriptors plans**: `tanstack/react-virtual` assumeix 1 element
    // measurable by index. To avoid breaking this contract (root +
    // expanded children + form subitem inside a `Fragment` confused the
    // virtualizer and caused imprecise padding/scrolling), we flatten the hierarchy
    // into a single `rowDescriptors` list where **each entry generates a
    // single `<tr>`**. The virtualizer indexes 1:1 against this list and
    // `measureElement` directly receives the `<tr>` of the virtual item.
    //
    // DOM pattern: native `<tbody>` with `<tr>` spacers (height =
    // padding) above and below the visible rows, so `<table>`+
    // `<thead>` keep column alignment without having to change
    // `display: block`.
    const tableContainerRef = useRef(null);

    // Metadata for the grouping field (order and color of the options, like the
    // kanban): if the field has options defined in the schema, the groups follow
    // their ORDER and inherit their COLOR. `fieldId` is the fallback for reading the
    // value when the metadata is keyed by id instead of by name.
    const groupMeta = useMemo(() => {
        if (!groupByField) return null;
        const cfg = getFieldConfig(schema, groupByField);
        const options = (cfg && Array.isArray(cfg.options)) ? normalizeOptions(cfg.options) : [];
        const colorMap = {};
        options.forEach(o => { colorMap[o.name] = o.color; });
        // Grouping by a RELATION field: the group value is the id of the related
        // page. We resolve id→title (as relation cells do) so that
        // the group header shows the title and not the raw UUID. For select/text
        // `labelMap` is null and the label stays the same (the name/option).
        const relDb = cfg?.relation_database_id;
        const labelMap = relDb
            ? Object.fromEntries((allNotes || []).filter(n => {
                const tid = n.resolved_table_id || n.metadata?.table_id || n.metadata?.database_table_id;
                return tid === relDb;
            }).map(n => [n.id, n.title || idToTitle[n.id] || n.id]))
            : null;
        return { fieldId: cfg?.id || null, optionOrder: options.map(o => o.name), colorMap, labelMap };
    }, [groupByField, schema, allNotes, idToTitle]);

    // Collapse/expansion of a group (local state). It resets when changing
    // view or grouping field, where the group keys stop making sense.
    // Default: COLLAPSED (empty Set); the user expands the groups they want to see.
    const toggleGroup = useCallback((groupKey) => {
        setExpandedGroups(prev => {
            const next = new Set(prev);
            if (next.has(groupKey)) next.delete(groupKey); else next.add(groupKey);
            return next;
        });
    }, []);
    useEffect(() => { setExpandedGroups(new Set()); }, [activeView?.id, groupByField]);

    // True if the user has any active column aggregation: then each
    // group shows a footer with the subtotals (Notion-style).
    const hasGroupAggregations = useMemo(
        () => Object.values(aggregations || {}).some(f => f && f !== 'none'),
        [aggregations]
    );

    // Flat list of descriptors. Each entry → 1 virtual `<tr>`.
    const rowDescriptors = useMemo(() => {
        const list = [];
        // Adds a root row and, if it's expanded, its subitems + the
        // new-subitem form. Reused by the flat and grouped paths.
        const pushNoteRows = (note) => {
            list.push({ kind: 'row', note, isChild: false, depth: 0 });
            if (expandedRows.has(note.id)) {
                const children = childrenMap[note.id] || [];
                for (const child of children) {
                    list.push({ kind: 'row', note: child, isChild: true, depth: 1 });
                }
                if (addingSubitemFor === note.id) {
                    list.push({ kind: 'new-subitem', parentNote: note, depth: 1 });
                }
            }
        };

        // Without grouping: previous behavior (infinite-load chunk + virtualization).
        if (!groupByField || !groupMeta) {
            for (const note of visibleRootNotes) pushNoteRows(note);
            return list;
        }

        // With grouping: we group ALL sorted/filtered rows (not just the
        // infinite-load chunk) so that the counters and the set of groups
        // are accurate; virtualization already limits the cost to the viewport. The
        // group value is read by the field name or, as a fallback, by the id
        // (getMetaKey lives further below and is not accessible here; this resolution
        // covers both real metadata formats).
        const EMPTY = ' empty';
        const readVal = (note) => {
            const m = note?.metadata || {};
            if (Object.prototype.hasOwnProperty.call(m, groupByField)) return m[groupByField];
            if (groupMeta.fieldId && Object.prototype.hasOwnProperty.call(m, groupMeta.fieldId)) return m[groupMeta.fieldId];
            return undefined;
        };
        const groups = new Map(); // gid -> { key, label, notes: [] }
        for (const note of sortedNotes) {
            const raw = readVal(note);
            let name;
            if (Array.isArray(raw)) name = raw.length ? String(raw[0]).trim() : '';
            else name = (raw === null || raw === undefined) ? '' : String(raw).trim();
            const gid = name === '' ? EMPTY : name;
            let g = groups.get(gid);
            if (!g) { g = { key: gid, label: gid === EMPTY ? t('table.no_group_value', "No value") : (groupMeta.labelMap?.[name] || name), notes: [] }; groups.set(gid, g); }
            g.notes.push(note);
        }
        // Order: defaults to that of the option catalog (→ uncataloged values
        // in order of appearance); 'alpha' by group name; 'count' by number of
        // records. asc/desc direction. The "No value" group (EMPTY) always at the
        // end regardless of the chosen order.
        const groupSort = activeView?.groupSort || activeView?.group_sort || 'catalog';
        const groupSortDir = (activeView?.groupSortDir || activeView?.group_sort_dir || 'asc') === 'desc' ? -1 : 1;
        const order = groupMeta.optionOrder;
        const byCatalog = (a, b) => {
            const ia = order.indexOf(a.key);
            const ib = order.indexOf(b.key);
            if (ia !== -1 && ib !== -1) return ia - ib;
            if (ia !== -1) return -1;
            if (ib !== -1) return 1;
            return 0;
        };
        const ordered = Array.from(groups.values()).sort((a, b) => {
            if (a.key === EMPTY) return 1;
            if (b.key === EMPTY) return -1;
            if (groupSort === 'alpha') {
                const c = String(a.label || '').localeCompare(String(b.label || ''), undefined, { numeric: true });
                return c * groupSortDir;
            }
            if (groupSort === 'count') {
                const c = a.notes.length - b.notes.length;
                return (c || byCatalog(a, b)) * groupSortDir;
            }
            return byCatalog(a, b); // 'catalog': asc = catalog order; desc = reverse order
        });
        if (groupSort === 'catalog' && groupSortDir === -1) {
            // Inverts while keeping the empty group at the end.
            const empty = ordered.filter(g => g.key === EMPTY);
            const rest = ordered.filter(g => g.key !== EMPTY).reverse();
            ordered.splice(0, ordered.length, ...rest, ...empty);
        }
        for (const g of ordered) {
            const colorName = g.key === EMPTY ? null : groupMeta.colorMap[g.label];
            list.push({
                kind: 'group-header',
                groupKey: g.key,
                label: g.label,
                count: g.notes.length,
                colorHex: colorName ? optionColorHex(colorName) : null,
            });
            if (!expandedGroups.has(g.key)) continue; // collapsed group → no rows (default: collapsed)
            for (const note of g.notes) pushNoteRows(note);
            // Group footer (Notion-style subtotals): only if the user has
            // any active column aggregation. It's calculated over the notes
            // of THIS group (g.notes). It's rendered below the group's rows.
            if (hasGroupAggregations) {
                list.push({ kind: 'group-footer', groupKey: g.key, notes: g.notes });
            }
        }
        return list;
    }, [groupByField, groupMeta, visibleRootNotes, sortedNotes, expandedRows, childrenMap, addingSubitemFor, expandedGroups, hasGroupAggregations, activeView?.groupSort, activeView?.groupSortDir, activeView?.group_sort, activeView?.group_sort_dir, t]);

    const rowVirtualizer = useVirtualizer({
        count: rowDescriptors.length,
        getScrollElement: () => tableContainerRef.current,
        // One row is approximately 56 px. With flat descriptors there's no need to bump up
        // the estimate for expansion: each child is already its own virtual
        // item with its own estimateSize/measureElement.
        estimateSize: () => (rowHeight === 'compact' ? 40 : rowHeight === 'tall' ? 76 : 56),
        // Direct measurement: each virtual item is a SINGLE `<tr>`, no need for
        // DOM walking. This is precisely the improvement that the pattern
        // that flattening contributes over the `Fragment` + walking one.
        measureElement: (el) => el?.getBoundingClientRect().height || 56,
        overscan: 8,
        // scrollPaddingStart: compensates for the sticky header (~44 px) so that
        // scrollToIndex doesn't leave rows hidden behind the thead.
        // scrollPaddingEnd: keeps 1 row of margin at the bottom so that the cursor
        // never reaches the bottom edge before the scroll is triggered.
        scrollPaddingStart: 44,
        scrollPaddingEnd: 56,
    });
    const virtualRows = rowVirtualizer.getVirtualItems();
    const virtTotalSize = rowVirtualizer.getTotalSize();
    const virtPaddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
    const virtPaddingBottom = virtualRows.length > 0
        ? virtTotalSize - virtualRows[virtualRows.length - 1].end
        : 0;

    const handleSort = (field) => {
        if (!activeView || !onUpdateView) return;
        // We read the EFFECTIVE primary order (key `sorts` or `sort`, object or array).
        const primary = resolveViewSorts(activeView)[0];
        const isCurrentField = primary?.field === field;
        let newDirection = 'asc';
        if (isCurrentField) {
            newDirection = primary.direction === 'asc' ? 'desc' : 'asc';
        }
        // Clicking a header sets this field as the SOLE sort (in
        // Notion/Airtable). BOTH keys are saved in sync (like the
        // PageViewModal style): if only `sort` were written, a stale `sorts` from the
        // view would win the resolution and the click would seem to do nothing.
        const newSorts = [{ field, direction: newDirection }];
        const updatedView = { ...activeView, sort: newSorts, sorts: newSorts };
        onUpdateView(updatedView);
    };

    // Strip schema by removing title to put it at the beginning and filtering by visibility
    const dynamicColumns = useMemo(() => {
        const titleFieldName = Object.entries(schema || {}).find(([, t]) => t === 'title')?.[0];
        // Every view with `visibleProperties` configured respects them — INCLUDING the
        // main one. Previously the main view forced the entire live schema and masked the
        // actual config (main views imported from Notion carry a
        // subset chosen by the user). Without config (local main view
        // 'default' or an old view), the entire schema is shown, which keeps making
        // new fields appear instantly.
        const baseFields = activeView?.visibleProperties?.length
            ? activeView.visibleProperties.map(key => [key, getFieldType(schema, key)]).filter(([key, type]) => key && type)
            : getSchemaFieldEntries(schema).filter(([, type]) => type !== 'title');

        // The title is already rendered as a fixed column: no entry from
        // `visibleProperties` must show it again as a data column.
        // We exclude it by the field's real name (titleFieldName), by the reference
        // to canonical/legacy 'title' (which getFieldType resolves to 'text' because
        // the schema doesn't have that key), and by any field of type 'title'.
        return baseFields.filter(([key, type]) => key !== titleFieldName && key !== 'title' && type !== 'title' && type !== 'button');
    }, [activeView, schema]);

    // Column drag-to-reorder: available in ANY view (the main
    // included: now that it respects and persists its `visibleProperties`, the
    // drag no longer reverts on reload). `onUpdateView` is required to persist it.
    const canReorderColumns = !!onUpdateView && !!activeView;

    // The "Modification" column (last_modified) is metadata, not a field of the
    // schema. With `visibleProperties` configured, it's only shown if the
    // the view includes it; without config (view with no visibleProperties) it
    // keeps the previous behavior: show it.
    const showModifiedColumn = useMemo(() => {
        const vp = activeView?.visibleProperties;
        if (!vp || vp.length === 0) return true;
        return vp.some(k => k === 'last_modified' || k === 'modified' || k === 'last_edited_time');
    }, [activeView]);

    // Is the "Language" column visible in the current view? If it is, the badge
    // for the language, next to the title, shows the same value as the cell →
    // redundant. We hide it, but keep the "stale" warning (which the column doesn't
    // carry). It compares by resolved name because columns can come by id or by name.
    const hasVisibleLanguageColumn = useMemo(() => {
        const langFieldName = getLanguageFieldName(schema);
        if (!langFieldName) return false;
        return dynamicColumns.some(([key]) => resolveFieldRef(schema, key).name === langFieldName);
    }, [dynamicColumns, schema]);

    // Initialize missing column widths
    useEffect(() => {
        setColumnWidths(prev => {
            const newWidths = { ...prev };
            let changed = false;
            dynamicColumns.forEach(([key]) => {
                if (!newWidths[key]) {
                    newWidths[key] = 180;
                    changed = true;
                }
            });
            return changed ? newWidths : prev;
        });
    }, [schema]);

    // ── Grid: column order and navigable rows ───────────────────
    // The cursor moves through the `title` (col 0, sticky) + the metadata columns
    // (dynamicColumns). The title is navigable and editable cell by cell, but
    // stays out of block paste/clear (lives in note.title, not metadata;
    // see isPasteableType). Actions and last_modified remain outside.
    const gridColumns = useMemo(
        () => [{ key: 'title', type: 'title' }, ...dynamicColumns.map(([key, type]) => ({ key, type }))],
        [dynamicColumns]
    );
    // Navigable rows = descriptors with `kind:'row'`, with their index of
    // descriptor (= virtualizer index) for scrollToIndex.
    const navRows = useMemo(() => {
        const out = [];
        rowDescriptors.forEach((d, i) => {
            if (d.kind === 'row' && d.note) out.push({ id: d.note.id, descriptorIndex: i });
        });
        return out;
    }, [rowDescriptors]);
    const navRowIndexById = useMemo(() => {
        const m = new Map();
        navRows.forEach((r, i) => m.set(r.id, i));
        return m;
    }, [navRows]);
    const colIndexByKey = useMemo(() => {
        const m = new Map();
        gridColumns.forEach((c, i) => m.set(c.key, i));
        return m;
    }, [gridColumns]);
    const navRowsRef = useRef([]);
    navRowsRef.current = navRows;
    const rowDescriptorsRef = useRef([]);
    rowDescriptorsRef.current = rowDescriptors;
    const restoredRecordFocusRequestRef = useRef(null);
    const scheduledRecordFocusRequestRef = useRef(null);
    useEffect(() => {
        const recordId = restoreRecordFocus?.recordId;
        const requestId = restoreRecordFocus?.requestId;
        if (
            !recordId
            || requestId == null
            || restoredRecordFocusRequestRef.current === requestId
            || scheduledRecordFocusRequestRef.current === requestId
        ) return undefined;

        const preparation = getTableRecordFocusPreparation({
            recordId,
            notes: safeNotes,
            sortedNotes,
            enableSubitems,
            expandedRows,
            groupByField,
            groupFieldId: groupMeta?.fieldId,
            expandedGroups,
            visibleRowsCount,
            batchSize: ROWS_BATCH_SIZE,
        });
        if (preparation.status === 'missing') {
            if (safeNotes.length > 0) {
                restoredRecordFocusRequestRef.current = requestId;
                onRecordFocusRestored?.(requestId);
            }
            return undefined;
        }
        if (preparation.status === 'expand-parent') {
            setExpandedRows(current => new Set(current).add(preparation.parentId));
            return undefined;
        }
        if (preparation.status === 'load-batch') {
            setVisibleRowsCount(preparation.requiredCount);
            return undefined;
        }
        if (preparation.status === 'expand-group') {
            setExpandedGroups(current => new Set(current).add(preparation.groupKey));
            return undefined;
        }

        const targetRow = navRows.find(row => row.id === recordId);
        if (!targetRow) return undefined;

        scheduledRecordFocusRequestRef.current = requestId;
        claimKeyboard();
        setAnchorCell(null);
        setActiveCell({ rowId: recordId, field: 'title' });
        rowVirtualizer.scrollToIndex(targetRow.descriptorIndex, { align: 'center' });

        let attempts = 0;
        let stableChecks = 0;
        const findRenderedCell = () => Array.from(tableContainerRef.current?.querySelectorAll('[data-title-cell]') || [])
            .find(element => element.dataset.titleCell === recordId);
        const stabilizeRenderedCellFocus = () => {
            const cell = findRenderedCell();
            const activeElement = document.activeElement;
            if (cell && activeElement && activeElement !== document.body && activeElement !== cell) {
                scheduledRecordFocusRequestRef.current = null;
                return;
            }

            if (cell && activeElement === cell) {
                stableChecks += 1;
            } else if (cell) {
                cell.focus({ preventScroll: true });
                stableChecks = 0;
            }

            if (cell && stableChecks >= 2) {
                restoredRecordFocusRequestRef.current = requestId;
                scheduledRecordFocusRequestRef.current = null;
                onRecordFocusRestored?.(requestId);
                return;
            }

            attempts += 1;
            if (attempts < 12) {
                setTimeout(stabilizeRenderedCellFocus, 50);
            } else {
                scheduledRecordFocusRequestRef.current = null;
            }
        };
        setTimeout(stabilizeRenderedCellFocus, 0);
        return undefined;
    }, [
        claimKeyboard,
        enableSubitems,
        expandedGroups,
        expandedRows,
        groupByField,
        groupMeta,
        navRows,
        onRecordFocusRestored,
        restoreRecordFocus,
        rowVirtualizer,
        safeNotes,
        sortedNotes,
        visibleRowsCount,
    ]);
    // Navigation between group headers and entry into the first row (mode
    // kept separate: the cell cursor is not affected). They are defined here so that
    // the `pendingEnterGroupDesc` effect can access them without a TDZ issue.
    const focusGroupHeaderByOffset = (fromDescriptorIndex, delta) => {
        const list = rowDescriptorsRef.current;
        for (let i = fromDescriptorIndex + delta; i >= 0 && i < list.length; i += delta) {
            if (list[i].kind === 'group-header') {
                rowVirtualizer.scrollToIndex(i);
                const el = tableContainerRef.current?.querySelector(
                    `[data-index="${i}"] button`);
                el?.focus({ preventScroll: true });
                return true;
            }
        }
        return false;
    };
    const focusFirstRowOfGroup = (groupDescriptorIndex) => {
        const list = rowDescriptorsRef.current;
        for (let i = groupDescriptorIndex + 1; i < list.length; i++) {
            const d = list[i];
            if (d.kind === 'group-header') return false; // empty group
            if (d.kind === 'row' && d.note) {
                setActiveCell({ rowId: d.note.id, field: gridColumnsRef.current[0]?.key || 'title' });
                rowVirtualizer.scrollToIndex(i);
                return true;
            }
        }
        return false;
    };
    // descriptorIndex of a group that has just been expanded with Enter from its
    // header; the effect below places the cursor on the first row.
    const pendingEnterGroupDescRef = useRef(null);
    useEffect(() => {
        const di = pendingEnterGroupDescRef.current;
        if (di === null) return;
        pendingEnterGroupDescRef.current = null;
        // Waits for the first row's descriptor to exist (re-render).
        const raf = requestAnimationFrame(() => focusFirstRowOfGroup(di));
        return () => cancelAnimationFrame(raf);
    }, [rowDescriptors, expandedGroups, focusFirstRowOfGroup]);
    const gridColumnsRef = useRef([]);
    gridColumnsRef.current = gridColumns;
    const navRowIndexByIdRef = useRef(new Map());
    navRowIndexByIdRef.current = navRowIndexById;
    const colIndexByKeyRef = useRef(new Map());
    colIndexByKeyRef.current = colIndexByKey;
    // id→note index for O(1) lookups inside the copy/paste/clear loops
    // (previously `safeNotes.find` per cell → O(n·m) on large selections).
    const noteById = useMemo(() => {
        const m = new Map();
        for (const n of safeNotes) m.set(n.id, n);
        return m;
    }, [safeNotes]);

    // Current selection rectangle (inclusive indices within navRows/gridColumns).
    const selectionRect = useMemo(() => {
        if (!activeCell) return null;
        const aRow = navRowIndexById.get(activeCell.rowId);
        const aCol = colIndexByKey.get(activeCell.field);
        if (aRow == null || aCol == null) return null;
        if (!anchorCell) return { r0: aRow, c0: aCol, r1: aRow, c1: aCol };
        const bRow = navRowIndexById.get(anchorCell.rowId);
        const bCol = colIndexByKey.get(anchorCell.field);
        if (bRow == null || bCol == null) return { r0: aRow, c0: aCol, r1: aRow, c1: aCol };
        return {
            r0: Math.min(aRow, bRow), c0: Math.min(aCol, bCol),
            r1: Math.max(aRow, bRow), c1: Math.max(aCol, bCol),
        };
    }, [activeCell, anchorCell, navRowIndexById, colIndexByKey]);
    const selectionRectRef = useRef(null);
    selectionRectRef.current = selectionRect;

    const getCellSelState = useCallback((rowId, field) => {
        if (!selectionRect) return { isActive: false, inRange: false };
        const r = navRowIndexById.get(rowId);
        const c = colIndexByKey.get(field);
        if (r == null || c == null) return { isActive: false, inRange: false };
        const inRange = r >= selectionRect.r0 && r <= selectionRect.r1 && c >= selectionRect.c0 && c <= selectionRect.c1;
        const isActive = !!activeCell && activeCell.rowId === rowId && activeCell.field === field;
        return { isActive, inRange };
    }, [selectionRect, navRowIndexById, colIndexByKey, activeCell]);

    // When the view, search, or sort changes (or when the page loads), we set
    // the cursor on the first cell like Excel does, without having to click.
    // Notes arrive asynchronously: on the first mount `navRows` is usually
    // empty, so we wait until we have data. `initializedViewRef` ensures
    // that we only initialize once per view (it doesn't reposition the cursor when
    // a row is added or pagination happens), and leaves the user's navigation/Escape
    // intact (activeCell is NOT a dependency).
    const initializedViewRef = useRef(null);
    useEffect(() => {
        const viewKey = `${activeView?.id}|${searchTerm}|${sortSignature}`;
        if (initializedViewRef.current === viewKey) return;
        if (navRows.length === 0 || gridColumns.length === 0) return; // waits for the data
        // If ANOTHER instance owns the keyboard (split panel, 2+ embeds),
        // we don't take its cursor away on load: only the owner (or the first
        // of all) auto-initializes. A click from the user claims ownership.
        if (_gridKeyboardOwner && _gridKeyboardOwner !== gridInstanceIdRef.current) return;
        initializedViewRef.current = viewKey;
        _gridKeyboardOwner = gridInstanceIdRef.current;
        setAnchorCell(null);
        const focusTarget = getTableFocusTarget({
            activeCell: activeCellRef.current,
            navRows,
            gridColumns,
        });
        const preservesActiveCell = focusTarget?.rowId === activeCellRef.current?.rowId
            && focusTarget?.field === activeCellRef.current?.field;
        // Grouped view: initial focus goes to the FIRST group HEADER
        // (Enter expands it and moves down to the items). Otherwise, to the first cell.
        if (groupByField && !preservesActiveCell) {
            const firstGroupIdx = rowDescriptors.findIndex(d => d.kind === 'group-header');
            if (firstGroupIdx >= 0) {
                rowVirtualizer.scrollToIndex(firstGroupIdx);
                requestAnimationFrame(() => {
                    tableContainerRef.current?.querySelector(`[data-index="${firstGroupIdx}"] button`)?.focus({ preventScroll: true });
                });
                return;
            }
        }
        if (focusTarget) {
            setActiveCell(focusTarget);
            if (preservesActiveCell) {
                const targetRow = navRows.find(row => row.id === focusTarget.rowId);
                if (targetRow?.descriptorIndex != null) {
                    rowVirtualizer.scrollToIndex(targetRow.descriptorIndex, { align: 'center' });
                    requestAnimationFrame(() => {
                        const selector = `[data-title-cell="${CSS.escape(focusTarget.rowId)}"]`;
                        tableContainerRef.current?.querySelector(selector)?.focus({ preventScroll: true });
                    });
                }
            }
        }
    }, [activeView?.id, searchTerm, sortSignature, navRows, gridColumns, groupByField, rowDescriptors, rowVirtualizer]);

    // Resizing Handlers
    const handleMouseDown = useCallback((e, colKey) => {
        e.preventDefault();
        e.stopPropagation();
        resizingCol.current = colKey;
        startX.current = e.pageX;
        startWidth.current = columnWidths[colKey] || 180;
        document.body.style.cursor = 'col-resize';
    }, [columnWidths]);

    const handleMouseMove = useCallback((e) => {
        if (!resizingCol.current) return;
        const diffX = e.pageX - startX.current;
        const newWidth = Math.max(100, startWidth.current + diffX);
        setColumnWidths(prev => ({ ...prev, [resizingCol.current]: newWidth }));
    }, []);

    const handleMouseUp = useCallback(() => {
        if (resizingCol.current) {
            resizingCol.current = null;
            document.body.style.cursor = 'default';
            // Persist the widths to the view so they are preserved on reload
            // or when switching views (previously they were only local state and were lost).
            if (activeView && onUpdateView) {
                onUpdateView({ ...activeView, columnWidths: { ...columnWidthsRef.current } });
            }
        }
    }, [activeView, onUpdateView]);

    useEffect(() => {
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [handleMouseMove, handleMouseUp]);

    // ── Column reordering via drag and drop (dnd-kit) ─────────────
    // Only the DATA columns (dynamicColumns) are sortable; the title
    // (sticky), the checkbox/actions, and "Modification" stay fixed. On drop,
    // we rebuild the order and persist it to `activeView.visibleProperties` via
    // `onUpdateView` (just like handleSort saves `sort`); the parent (handleUpdateView)
    // saves it as-is, and dynamicColumns applies it. Same pattern as
    // VaultDocumentTabs: PointerSensor with a 5px activation distance so a
    // plain click never starts a drag and click-to-sort keeps working.
    const columnDndSensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );
    const columnSortableIds = useMemo(() => dynamicColumns.map(([k]) => k), [dynamicColumns]);

    // A completed drag fires a native `click` on the handle right after the
    // drop (pointerdown/up land on the same element because the dragged header
    // follows the pointer): without this flag that click would ALSO toggle the
    // sort of the dragged column. Native HTML5 drag suppressed it for free.
    const columnDragJustEndedRef = useRef(false);
    const suppressNextHeaderClick = useCallback(() => {
        columnDragJustEndedRef.current = true;
        setTimeout(() => { columnDragJustEndedRef.current = false; }, 0);
    }, []);

    const handleColumnDragEnd = useCallback((event) => {
        suppressNextHeaderClick();
        const { active, over } = event;
        if (!over || active.id === over.id || !activeView || !onUpdateView) return;

        // We reorder over `visibleProperties` if it exists: this way the title field and
        // any other entry that isn't a data column stay in their
        // place (the title is rendered separately, but we keep it where it was — often first
        // by convention). If the view doesn't have one (no config), we materialize the order
        // current visible from dynamicColumns. arrayMove over that base matches
        // exactly the reorder dnd-kit previewed on screen.
        const hasVP = Array.isArray(activeView.visibleProperties) && activeView.visibleProperties.length > 0;
        const base = hasVP ? activeView.visibleProperties : dynamicColumns.map(([k]) => k);
        const oldIndex = base.indexOf(active.id);
        const newIndex = base.indexOf(over.id);
        if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;

        onUpdateView({ ...activeView, visibleProperties: arrayMove(base, oldIndex, newIndex) });
    }, [dynamicColumns, activeView, onUpdateView, suppressNextHeaderClick]);

    // ---- NORMALIZATION HELPERS ----
    const normalizeKey = (k) => String(k || '').toLowerCase().replace(/[^a-z0-9]/gi, '');
    const aliasMap = {
        "date added": "created_time",
        "date modified": "last_edited_time",
        "id": ["id", "gnosi_id", "source_id"]
    };
    const getMetaKey = (note, field) => {
        const schemaKeyNorm = normalizeKey(field);
        const mapped = aliasMap[schemaKeyNorm];

        if (Array.isArray(mapped)) {
            // If we have an array of fallbacks, look for the first key that exists in the metadata
            if (!note?.metadata) return field;
            // Object.prototype.hasOwnProperty.call avoids false positives if
            // metadata has a property called "hasOwnProperty".
            const existingKey = mapped.find(k => Object.prototype.hasOwnProperty.call(note.metadata, k));
            if (existingKey) return existingKey;

            // If none exist exactly, look by normalization
            for (const fallback of mapped) {
                const targetKeyNorm = normalizeKey(fallback);
                const found = Object.keys(note.metadata).find(k => normalizeKey(k) === targetKeyNorm);
                if (found) return found;
            }
            return field;
        }

        const targetKeyNorm = mapped ? normalizeKey(mapped) : schemaKeyNorm;
        return note?.metadata ? (Object.keys(note.metadata).find(k => normalizeKey(k) === targetKeyNorm) || field) : field;
    };

    const getMetadataValueByNormalizedKey = useCallback((metadata, possibleKeys) => {
        if (!metadata || typeof metadata !== 'object') return '';
        for (const key of possibleKeys) {
            const keyNorm = normalizeKey(key);
            const found = Object.keys(metadata).find((candidate) => normalizeKey(candidate) === keyNorm);
            if (found && metadata[found] !== undefined && metadata[found] !== null && metadata[found] !== '') {
                return metadata[found];
            }
        }
        return '';
    }, []);

    const hasOpenableResource = useCallback((note) => {
        const metadata = note?.metadata || {};
        const zoteroUri = String(getMetadataValueByNormalizedKey(metadata, ['Zotero uri', 'zotero_uri', 'zotero uri'])).trim();
        const filePath = String(getMetadataValueByNormalizedKey(metadata, ["Ruta de l'arxiu", 'ruta_arxiu', 'file_path', 'path'])).trim();
        const attachments = getMetadataValueByNormalizedKey(metadata, ['Adjunts', 'attachments', 'adjuntos']);
        return hasResourceReference(zoteroUri)
            || hasResourceReference(filePath)
            || hasResourceReference(attachments);
    }, [getMetadataValueByNormalizedKey]);

    const handleOpenExternalResource = useCallback(async (note) => {
        const metadata = note?.metadata || {};
        const zoteroUri = String(getMetadataValueByNormalizedKey(metadata, ['Zotero uri', 'zotero_uri', 'zotero uri'])).trim();
        const filePath = String(getMetadataValueByNormalizedKey(metadata, ["Ruta de l'arxiu", 'ruta_arxiu', 'file_path', 'path'])).trim();
        const attachments = getMetadataValueByNormalizedKey(metadata, ['Adjunts', 'attachments', 'adjuntos']);

        if (!zoteroUri && !filePath && !attachments) {
            toast.error(t('table.no_resource_error'));
            return;
        }

        try {
            setOpeningResourceId(note.id);
            const response = await fetch('/api/vault/open-resource', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    zotero_uri: zoteroUri || null,
                    file_path: filePath || null,
                    attachments,
                }),
            });

            if (!response.ok) {
                const payload = await response.json().catch(() => ({}));
                throw new Error(payload?.detail || t('table.open_resource_error'));
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : t('table.open_resource_error');
            toast.error(message);
        } finally {
            setOpeningResourceId(null);
        }
    }, [getMetadataValueByNormalizedKey]);

    // ---- SAVE CELL + PROPAGATION TO PARENT ----
    const handleCellSave = useCallback(async (noteId, field, newValue, originalMetaKey, skipPropagation = false, additionalMetaUpdates = {}) => {
        setEditingCell(null);
        setEditInitial(null);
        const note = safeNotes.find(n => n.id === noteId);
        if (!note) return false;

        const currentValue = note.metadata?.[originalMetaKey];
        if (sameCellValue(currentValue, newValue) && Object.keys(additionalMetaUpdates).length === 0) return true;

        // 1. OPTIMISTIC: applies the change locally right away — the user
        //    sees the new value before the backend responds (~200-450 ms).
        setOptimisticPatches(prev => {
            const next = new Map(prev);
            const existing = next.get(noteId) || {};
            next.set(noteId, { ...existing, [originalMetaKey]: newValue, ...additionalMetaUpdates });
            return next;
        });

        try {
            // 2. Partial PATCH — the backend does `metadata.update(request.metadata)`
            //    and keeps title / content / other fields intact. Before
            //    we used to send PUT with the full `title + content + metadata` for
            //    each edited cell (potentially MBs of body, double the latency of
            //    serialization).
            // Use axios (not raw fetch) so this write flows through the etag
            // optimistic-concurrency interceptor: it attaches expected_etag and
            // captures the new etag. A raw fetch bypassed both, so cell edits had
            // no two-device clobber protection and later editor saves 409'd.
            // axios rejects on non-2xx, so no manual response.ok check is needed.
            await axios.patch(`/api/vault/pages/${noteId}`, {
                metadata: { [originalMetaKey]: newValue, ...additionalMetaUpdates }
            });
            // Propagate changes to parent if this is a child
            if (!skipPropagation) {
                const parentId = note.metadata?.parent_id || note.parent_id;
                if (parentId) {
                    await propagateToParent(parentId, field, noteId, newValue);
                }
            }
            // Refresh in background — the backend cache has already been
            // invalidated on PATCH. We do NOT wait here: the user already sees the change
            // thanks to the optimistic patch, and when the new `notes`
            // prop arrives, the `useEffect` will clean up the override automatically.
            if (onCellSaved) onCellSaved();
            else if (onUpdateView) onUpdateView(activeView);
            return true;
        } catch (error) {
            // 3. ROLLBACK: removes only this field's patch (we keep
            //    other pending patches for the same note intact).
            setOptimisticPatches(prev => {
                const next = new Map(prev);
                const existing = next.get(noteId);
                if (existing) {
                    const { [originalMetaKey]: _removed, ...rest } = existing;
                    if (Object.keys(rest).length === 0) {
                        next.delete(noteId);
                    } else {
                        next.set(noteId, rest);
                    }
                }
                return next;
            });
            // Cell save failures used to be silent. Surface them so the user
            // doesn't believe the change was persisted when it wasn't.
            notifyError('table-save-cell', error, t('table.save_cell_error', "Error saving the cell"));
            return false;
        }
    // `propagateToParent` and `t` are captured by the closure; adding them to the
    // dep array would create a recreation cycle with `propagateToParent` (which
    // in turn depends on `handleCellSave`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [safeNotes, activeView, onUpdateView, onCellSaved]);

    // ---- PROPAGATION LOGIC TO PARENT ----
    // `overrides` (Map<childId, value>) allows bulk paste to pass the
    // values that were just written so that the "all children done" calculation doesn't use
    // the old values of the siblings (individual edits leave it as `null`).
    const propagateToParent = useCallback(async (parentId, changedField, changedChildId, newValue, overrides = null) => {
        const parent = safeNotes.find(n => n.id === parentId);
        if (!parent) return;

        // COMPLETE children (not those filtered by the view): the status/dates decision
        // for the parent must see all children, including those hidden by the filter.
        const children = allChildrenByParent[parentId] || [];
        if (children.length === 0) return;

        // 1. Auto-complete/archive: if all children have status "Completed"/"Archived"/"Done"
        const statusLike = ['status', 'checkbox', 'estat'];
        const declaredFieldType = schema && schema[changedField];
        const isDeclaredInSchema = declaredFieldType !== undefined && declaredFieldType !== null && declaredFieldType !== '';
        const isStatusField = statusLike.includes(getFieldType(schema, changedField))
            || (!isDeclaredInSchema && statusLike.includes(changedField?.toLowerCase()));
        const completedValues = new Set(['completat', 'arxivat', 'done', 'finished', 'completed', 'archivat', 'true', true]);

        if (isStatusField) {
            const allChildrenDone = children.every(child => {
                const childId = child.id;
                // Simulate the new value for the child(ren) that just changed
                const val = overrides?.has(childId)
                    ? overrides.get(childId)
                    : (childId === changedChildId ? newValue : child.metadata?.[getMetaKey(child, changedField)]);
                return completedValues.has(String(val || '').toLowerCase());
            });

            if (allChildrenDone) {
                const parentMetaKey = getMetaKey(parent, changedField);
                const parentCurrentVal = parent.metadata?.[parentMetaKey];
                // Write a completed value that actually exists in THIS field's
                // catalog (the value from the children) rather than the hardcoded
                // Catalan literal 'Completat', which on an English/Notion status
                // catalog would inject a ghost option (option VALUE == NAME here).
                const completedWrite = (typeof newValue === 'string' && completedValues.has(newValue.toLowerCase()))
                    ? newValue
                    : (children
                        .map(c => c.metadata?.[getMetaKey(c, changedField)])
                        .find(v => completedValues.has(String(v || '').toLowerCase())) || newValue);
                const parentStatus = getFieldType(schema, changedField) === 'checkbox' ? true : completedWrite;
                if (String(parentCurrentVal || '').toLowerCase() !== String(parentStatus).toLowerCase()) {
                    await handleCellSave(parentId, changedField, parentStatus, parentMetaKey, true);
                }
            }
        }

        // 2. Date inheritance: min(start) and max(end)
        const dateLike = ['date', 'period', 'datetime'];
        const isDateField = dateLike.includes(getFieldType(schema, changedField));

        if (isDateField) {
            // Collect all date values from children (including the new one)
            const allDates = children.map(child => {
                const val = overrides?.has(child.id)
                    ? overrides.get(child.id)
                    : (child.id === changedChildId ? newValue : child.metadata?.[getMetaKey(child, changedField)]);
                return val || null;
            }).filter(Boolean);

            if (allDates.length > 0) {
                if (getFieldType(schema, changedField) === 'period') {
                    const starts = allDates.map(v => parsePeriod(v).start).filter(Boolean).map(d => new Date(d)).filter(d => !isNaN(d));
                    const ends = allDates.map(v => parsePeriod(v).end).filter(Boolean).map(d => new Date(d)).filter(d => !isNaN(d));
                    if (starts.length > 0 && ends.length > 0) {
                        const minStart = new Date(Math.min(...starts));
                        const maxEnd = new Date(Math.max(...ends));
                        const parentMetaKey = getMetaKey(parent, changedField);
                        const parentValue = parent.metadata?.[parentMetaKey];
                        const hasTime = allDates.some((item) => (
                            parsePeriod(item).start.includes('T') || parsePeriod(item).end.includes('T')
                        ));
                        const padDatePart = (number) => String(number).padStart(2, '0');
                        const localDate = (date) => {
                            const day = `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
                            return hasTime
                                ? `${day}T${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}`
                                : day;
                        };
                        const newPeriod = withPeriodBoundaries(
                            parentValue,
                            localDate(minStart),
                            localDate(maxEnd),
                            { startMode: 'auto', endMode: 'auto' },
                        );
                        if (JSON.stringify(parentValue) !== JSON.stringify(newPeriod)) {
                            await handleCellSave(parentId, changedField, newPeriod, parentMetaKey, true);
                        }
                    }
                } else {
                    // For simple date fields: min for "start" fields, max for "end" fields.
                    // Whole-word matching (separators: space, hyphen, underscore
                    // or start/end of string) to avoid false positives like "Definition",
                    // "Fixation" or "infinite".
                    const fieldLower = changedField.toLowerCase();
                    const isEndField = /(^|[\s_-])(end|fi|fin|final)([\s_-]|$)/i.test(fieldLower);
                    const dates = allDates.map(d => new Date(d)).filter(d => !isNaN(d));
                    if (dates.length > 0) {
                        const targetDate = isEndField
                            ? new Date(Math.max(...dates)).toISOString().split('T')[0]
                            : new Date(Math.min(...dates)).toISOString().split('T')[0];
                        const parentMetaKey = getMetaKey(parent, changedField);
                        if (parent.metadata?.[parentMetaKey] !== targetDate) {
                            await handleCellSave(parentId, changedField, targetDate, parentMetaKey, true);
                        }
                    }
                }
            }
        }
    }, [safeNotes, allChildrenByParent, schema, handleCellSave]);

    // ---- CREATE SUBITEM ----
    const handleCreateSubitem = useCallback(async (parentId) => {
        const title = newSubitemTitle.trim();
        if (!title) {
            setAddingSubitemFor(null);
            setNewSubitemTitle('');
            return;
        }
        try {
            const parentNote = safeNotes.find(n => n.id === parentId);
            const tableId = activeView?.table_id || parentNote?.resolved_table_id || parentNote?.metadata?.table_id || parentNote?.metadata?.database_table_id;
            const baseMetadata = {
                title: title,
                parent_id: parentId,
                table_id: tableId,
                database_table_id: tableId,
                ...(parentNote?.metadata?.database_id ? { database_id: parentNote.metadata.database_id } : {})
            };
            const metadataWithDefaults = applyDefaultFormulasToMetadata({
                schema,
                metadata: baseMetadata,
                title,
                notes: safeNotes,
                currentTableId: tableId,
            });
            // Use axios for consistency with the dashboard and to ensure the correct port
            const res = await axios.post(`/api/vault/pages`, {
                title,
                content: '',
                parent_id: parentId,
                metadata: metadataWithDefaults
            });

            if (res.status === 200 || res.status === 201) {
                setExpandedRows(prev => new Set([...prev, parentId]));
                // Notify the parent so it reloads the data. Prefer onCellSaved
                // over onUpdateView to avoid persisting the virtual 'default' view.
                if (onCellSaved) onCellSaved();
                else if (onUpdateView) onUpdateView(activeView);
                toast.success(t('table.subitem_created'));
            }
        } catch (error) {
            notifyError('table-create-subitem', error, t('table.subitem_create_error'));
        } finally {
            setAddingSubitemFor(null);
            setNewSubitemTitle('');
        }
    }, [newSubitemTitle, safeNotes, activeView, onUpdateView, schema]);

    // ---- CREATE ROW RECORD (FAST ADD) ----
    const handleCreateRowRecord = useCallback(async () => {
        const title = newRowTitle.trim();
        if (!title) return;

        

        try {
            const tableId = activeView?.table_id || (safeNotes.length > 0 ? resolveNoteTableId(safeNotes[0]) : null);
            if (!tableId) {
                console.warn("VaultTable: Could not determine tableId");
            }

            const baseMetadata = {
                title,
                table_id: tableId,
                database_table_id: tableId,
            };
            
            const metadataWithDefaults = applyDefaultFormulasToMetadata({
                schema,
                metadata: baseMetadata,
                title,
                notes: safeNotes,
                currentTableId: tableId,
            });

            const res = await axios.post(`/api/vault/pages`, {
                title,
                content: '',
                metadata: metadataWithDefaults
            });

            if (res.status === 200 || res.status === 201) {
                setNewRowTitle('');
                // Refresh rows via onCellSaved, NOT onUpdateView: the latter
                // PUTs the (possibly virtual 'default') view and caused cross-table
                // view-id collisions.
                if (onCellSaved) onCellSaved();
                toast.success(t('table.record_created'));
                const newId = res.data?.id;
                if (newId && onNoteSelect) {
                    onNoteSelect(newId, { returnFocusId: newId });
                }
            }
        } catch (error) {
            const errorMsg = error.response?.data?.detail || t('table.record_create_error');
            notifyError('table-create-record', error, errorMsg);
        }
    }, [newRowTitle, safeNotes, activeView, onUpdateView, schema, resolveNoteTableId]);

    // Shared option catalogs (root registry): a field with
    // config.catalog_ref resolves its list there. They are loaded once.
    const [sharedOptionCatalogs, setSharedOptionCatalogs] = useState({});
    useEffect(() => {
        const needsCatalogs = getSchemaFieldNames(schema)
            .some((name) => getFieldConfig(schema, name)?.catalog_ref);
        if (!needsCatalogs) return undefined;
        let cancelled = false;
        axios.get('/api/vault/option-catalogs')
            .then((res) => { if (!cancelled) setSharedOptionCatalogs(res.data?.catalogs || {}); })
            .catch(() => {});
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [schema]);

    // Rich catalog of a field ({name,color,group}…), or [] if the field derives its
    // options from the values (without an explicit catalog).
    const getCatalogOptions = (field) => {
        const config = getFieldConfig(schema, field);
        if (config?.catalog_ref) {
            return normalizeOptions(sharedOptionCatalogs[config.catalog_ref] || []);
        }
        if (Array.isArray(config?.options) && config.options.length > 0) {
            return normalizeOptions(config.options);
        }
        return [];
    };

    // Name → color map for painting the chips. Only for options from an explicit
    // catalog: derived ones keep the theme's neutral style.
    const getOptionColorMap = (field) => {
        const map = {};
        for (const o of getCatalogOptions(field)) map[o.name] = o.color;
        return map;
    };

    const getAvailableOptions = (field, type) => {
        const catalog = getCatalogOptions(field);
        if (catalog.length > 0) return catalog.map((o) => o.name);
        const values = safeNotes
            // `getMetaKey` iterates over the aliases (which can be ARRAYS of fallbacks); the
            // previous inline code coerced the array to a string and never matched any key.
            .map(n => n.metadata?.[getMetaKey(n, field)])
            .filter(v => v !== undefined && v !== null && v !== '');
        // multi_select saves an array per row: it must be FLATTENED into individual values,
        // trick is to not deduplicate entire arrays (this used to show "tag1tag2tag3" as a single
        // option). It also accepts CSV strings for compatibility.
        if (type === 'multi_select') {
            const flat = [];
            for (const v of values) {
                if (Array.isArray(v)) {
                    flat.push(
                        ...v
                            .filter(x => typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean')
                            .map(x => String(x).trim())
                            .filter(Boolean)
                    );
                } else if (typeof v === 'string') flat.push(...v.split(',').map(x => x.trim()).filter(Boolean));
            }
            return Array.from(new Set(flat));
        }
        return Array.from(new Set(values));
    };

    // Persists the option catalog of a select/multi_select/status field to the
    // schema (PATCH to the table via the dashboard handler). Resolves the tableId
    // view's registry and to the schema's immutable fieldId. If there's no handler or it's not
    // possible to resolve the id, it does nothing (the cell's value is still saved).
    const updateFieldOptions = (field, nextOptions) => {
        if (!onUpdateFieldOptions || !Array.isArray(nextOptions)) return;
        const tableId = activeView?.table_id || (safeNotes.length > 0 ? resolveNoteTableId(safeNotes[0]) : null);
        const fieldId = getFieldConfig(schema, field)?.id;
        if (!tableId || !fieldId) return;
        onUpdateFieldOptions(tableId, fieldId, nextOptions);
    };

    // Notion-style deletion of an option: removes it from the catalog AND from the value of
    // ALL rows that have it. The rewrite is done by A SINGLE call to the
    // server (never N PATCHes from the client: they exhaust the DB pool and hide
    // partial errors — feedback_bulk_ops_server_side). The optimistic patch does
    // so the change shows up instantly in the table.
    const removeOptionEverywhere = async (field, type, optionValue) => {
        const tableId = activeView?.table_id || (safeNotes.length > 0 ? resolveNoteTableId(safeNotes[0]) : null);
        const fieldId = getFieldConfig(schema, field)?.id;

        // Optimistic patch over the visible rows that use the value.
        setOptimisticPatches(prev => {
            const next = new Map(prev);
            for (const n of safeNotes) {
                const key = getMetaKey(n, field);
                const v = n.metadata?.[key];
                if (type === 'multi_select') {
                    const arr = Array.isArray(v)
                        ? v
                        : (typeof v === 'string' && v ? v.split(',').map(s => s.trim()).filter(Boolean) : []);
                    if (arr.includes(optionValue)) {
                        const existing = next.get(n.id) || {};
                        next.set(n.id, { ...existing, [key]: arr.filter(x => x !== optionValue) });
                    }
                } else if (v === optionValue) {
                    const existing = next.get(n.id) || {};
                    next.set(n.id, { ...existing, [key]: '' });
                }
            }
            return next;
        });

        try {
            if (tableId && fieldId) {
                await axios.post(`/api/vault/tables/${tableId}/options/remove`, {
                    field_id: fieldId,
                    value: optionValue,
                });
            } else {
                // Without resolvable table/field id (e.g. folder view
                // arrival) there is no per-table endpoint: it only removes the option from the
                // local catalog if there is one.
                const cfg = getFieldConfig(schema, field) || {};
                if (Array.isArray(cfg.options) && cfg.options.length > 0) {
                    updateFieldOptions(field, normalizeOptions(cfg.options).filter(o => o.name !== optionValue));
                }
            }
            if (onCellSaved) onCellSaved();
        } catch (err) {
            notifyError('remove-option-everywhere', err, t('table.remove_option_error', "Error removing the option from the records"));
        }
    };

    // Unique authors already present in the table for this field (autocomplete).
    // Dedup by nom|cognom1|cognom2; ignore authors that are completely empty.
    const getAutoriaSuggestions = (field) =>
        dedupeAuthors(safeNotes.map(n => n.metadata?.[getMetaKey(n, field)]));

    const handleKeyDown = (e, noteId, field, originalMetaKey) => {
        // Ignore computed fields to avoid accidental editing
        const fieldType = getFieldType(schema, field);
        const isComputed = fieldType === 'formula' || fieldType === 'rollup';
        if (isComputed) return;

        if (e.key === 'Tab') {
            e.preventDefault();
            const tabRaw = e.target.value;
            const tabVal = fieldType === 'number'
                ? (String(tabRaw).trim() === '' ? '' : (Number.isFinite(Number(tabRaw)) ? Number(tabRaw) : tabRaw))
                : tabRaw;
            handleCellSave(noteId, field, tabVal, originalMetaKey);
            // Only EDITABLE columns with the generic input: excluding the fields
            // calculated (formula/rollup/virtual), `files` (has its own editor) and
            // `last_modified` (read-only). Previously, Tab would open the generic input there
            // text and saved the calculated/serialized value in the frontmatter
            // (corruption) or would leave the editing state stuck with no editor.
            const columns = ['title', ...dynamicColumns.map(([k]) => k)].filter(c => {
                if (c === 'title') return true;
                const tCol = getFieldType(schema, c);
                return !isComputedType(tCol) && tCol !== 'files';
            });
            const currentIndex = columns.indexOf(field);
            if (currentIndex === -1) return;
            let nextIndex = e.shiftKey ? currentIndex - 1 : currentIndex + 1;
            let nextNoteId = noteId;
            if (nextIndex >= columns.length) {
                nextIndex = 0;
                const noteIndex = sortedNotes.findIndex(n => n.id === noteId);
                if (noteIndex < sortedNotes.length - 1) nextNoteId = sortedNotes[noteIndex + 1].id;
            } else if (nextIndex < 0) {
                nextIndex = columns.length - 1;
                const noteIndex = sortedNotes.findIndex(n => n.id === noteId);
                if (noteIndex > 0) nextNoteId = sortedNotes[noteIndex - 1].id;
            }
            const nextField = columns[nextIndex];
            const nextNote = safeNotes.find(n => n.id === nextNoteId);
            // `getMetaKey` iterates over the aliases (which can be ARRAYS of fallbacks);
            // the previous inline expression coerced the array to a string and never matched.
            const nextOriginalMetaKey = nextNote ? getMetaKey(nextNote, nextField) : nextField;
            setEditingCell({ rowId: nextNoteId, field: nextField, originalMetaKey: nextOriginalMetaKey });
        }
    };

    // evaluateFormula(formula, METADATA, TITLE, options): the metadata must be passed
    // of the note (not the whole note) and the title separately. Previously, it would pass
    // (formula, note, opts) → fields wouldn't resolve ({Preu}→'') and prop('title')
    // used to return the options object; now {Preu}*{Quantitat} gives the actual result.
    const calculateFormula = useCallback((formula, note) => evaluateFormula(
        formula,
        note?.metadata || {},
        note?.title || '',
        { notes: safeNotes, currentTableId: resolveNoteTableId(note), schema },
    ), [safeNotes, resolveNoteTableId, schema]);

    // evaluateRollup(values, aggregation) aggregates a list of values that have ALREADY been collected.
    // It used to be called as (config, note, opts) → `values.map` would blow up ("values.map is
    // not a function"). Here we collect the values from the related records (for the
    // ids in `relationField`, looked up in allNotes) and then we aggregate.
    const calculateRollup = useCallback((config, note) => {
        const relationField = config?.relationField;
        const aggregation = config?.aggregation || 'count_values';
        const raw = note?.metadata?.[relationField];
        let relatedIds = Array.isArray(raw)
            ? raw.map(String)
            : (raw != null && raw !== '' ? [String(raw)] : []);
        if (config?.limit) relatedIds = relatedIds.slice(0, Number(config.limit));
        if (aggregation === 'count_all') return evaluateRollup(relatedIds, 'count_all');
        const byId = new Map((allNotes || []).map(n => [n.id, n]));
        const values = relatedIds.map(id => byId.get(id)?.metadata?.[config?.targetProperty]);
        return evaluateRollup(values, aggregation);
    }, [allNotes]);

    const getCalculatedFieldValue = useCallback((field, note, fallbackValue = null) => {
        const fieldType = getFieldType(schema, field);
        const fieldConfig = getFieldConfig(schema, field);

        if (fieldType === 'formula' && fieldConfig?.formula) {
            return calculateFormula(fieldConfig.formula, note);
        }

        if (fieldType === 'rollup') {
            return calculateRollup(fieldConfig, note);
        }

        return fallbackValue;
    }, [schema, calculateFormula, calculateRollup]);

    const toImagePreviewUrl = useCallback((rawValue) => {
        if (!rawValue || typeof rawValue !== 'string') return '';
        const value = rawValue.trim();
        if (!value) return '';

        const lower = value.toLowerCase();
        const hasImageExtension = /(\.png|\.jpg|\.jpeg|\.gif|\.webp|\.svg|\.avif|\.bmp)(\?|#|$)/i.test(lower);
        const isDataImage = lower.startsWith('data:image/');
        if (!isDataImage && !hasImageExtension) return '';

        // Served URLs carry the active vault (withActiveVault) so that the
        // native `<img>` thumbnail resolves the correct vault without a header.
        if (value.startsWith('/api/vault/assets/')) return withActiveVault(value);
        if (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('data:image/')) return value;

        if (value.startsWith('Assets/')) return withActiveVault(`/api/vault/assets/${value.slice('Assets/'.length)}`);
        if (value.startsWith('../Assets/')) return withActiveVault(`/api/vault/assets/${value.slice('../Assets/'.length)}`);
        if (value.startsWith('./Assets/')) return withActiveVault(`/api/vault/assets/${value.slice('./Assets/'.length)}`);

        const assetsIdx = value.indexOf('/Assets/');
        if (assetsIdx >= 0) return withActiveVault(`/api/vault/assets/${value.slice(assetsIdx + '/Assets/'.length)}`);

        // Fallback: relative path inside the vault (e.g. "Articles/foo.png") → serve from /api/vault/assets/
        if (!value.startsWith('/') && !value.includes('://')) {
            return withActiveVault(`/api/vault/assets/${value.replace(/^\.\//, '')}`);
        }

        return '';
    }, []);

    const isImageField = useCallback((field, fieldType) => {
        if (fieldType === 'files') return true;
        // Explicit `image` type: always a thumbnail, regardless of the name (the
        // render value-gates with the servable URL, same as inferred fields).
        if (fieldType === 'image') return true;
        // We only infer image by NAME in text fields (or fields with no declared type):
        // a field explicitly typed number/date/select/relation/url/etc. is never an
        // inferred image. Previously, this blocked ANY field with a declared
        // type, which also excluded "Imatge" (text type) — now only
        // the exclusion by name ([[isImageFieldName]]) separates "Imatge" (path) from
        // "Image Alt Text" (prose). The render value-gates on the servable URL.
        if (fieldType && fieldType !== 'text') return false;
        return isImageFieldName(field);
    }, []);

    const urlToVaultPath = useCallback((url) => {
        if (!url) return '';
        const prefix = '/api/vault/assets/';
        // Strips the vault query-param (`?vault=…`) so the SAVED value stays clean.
        if (url.startsWith(prefix)) return url.slice(prefix.length).split('?')[0];
        return url;
    }, []);

    const getImagePreviewUrlFromValue = useCallback((rawValue) => {
        // COMPOSITE image field {src, alt, …}: extracts the path.
        if (rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)) {
            return toImagePreviewUrl(getImageSrc(rawValue));
        }
        if (Array.isArray(rawValue)) {
            for (const item of rawValue) {
                const candidate = toImagePreviewUrl(getImageSrc(item));
                if (candidate) return candidate;
            }
            return '';
        }

        const asString = String(rawValue || '').trim();
        if (!asString) return '';

        const direct = toImagePreviewUrl(asString);
        if (direct) return direct;

        const parts = asString.split(',').map((p) => p.trim()).filter(Boolean);
        for (const part of parts) {
            const candidate = toImagePreviewUrl(part);
            if (candidate) return candidate;
        }

        return '';
    }, [toImagePreviewUrl]);

    const parseResourceValue = useCallback((rawValue) => {
        if (rawValue === undefined || rawValue === null) return null;
        const text = String(rawValue).trim();
        if (!text) return null;

        const markdownMatch = text.match(/\(([^)]+)\)/);
        const candidate = markdownMatch ? markdownMatch[1].trim() : text;

        if (candidate.startsWith('zotero://')) {
            return { zotero_uri: candidate, file_path: null, attachments: null };
        }

        if (candidate.startsWith('file://')) {
            return { zotero_uri: null, file_path: candidate, attachments: null };
        }

        const embeddedZotero = candidate.match(/zotero:\/\/\S+/i);
        if (embeddedZotero?.[0]) {
            return { zotero_uri: embeddedZotero[0], file_path: null, attachments: null };
        }

        return { zotero_uri: null, file_path: candidate, attachments: null };
    }, []);

    const handleOpenZoteroValue = useCallback(async (rawValue) => {
        const payload = parseResourceValue(rawValue);
        if (!payload || (!payload.zotero_uri && !payload.file_path)) {
            toast.error(t('table.zotero_empty_error'));
            return;
        }

        try {
            const response = await fetch('/api/vault/open-resource', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(data?.detail || t('table.zotero_open_error'));
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : t('table.zotero_open_error');
            toast.error(message);
        }
    }, [parseResourceValue, t]);

    const getRelationContext = (field) => {
        const config = getFieldConfig(schema, field);
        const relatedTableId = config?.relation_database_id;
        const relatedNotes = relatedTableId
            ? allNotes.filter(n => {
                const nTableId = n.resolved_table_id || n.metadata?.table_id || n.metadata?.database_table_id;
                return nTableId === relatedTableId;
            })
            : [];
        const displayMap = {
            ...idToTitle,
            ...Object.fromEntries(relatedNotes.map(n => [n.id, n.title || idToTitle[n.id] || n.id])),
        };
        return { relatedTableId, relatedNotes, displayMap };
    };

    // ── Grid: copy / paste / navigation ───────────────────────────
    const openMediaPicker = useCallback((note, key, fieldType) => {
        const noteTableId = activeView?.table_id || resolveNoteTableId(note);
        const metaKey = getMetaKey(note, key);
        const cfg = fieldType === 'files' ? (getFieldConfig(schema, key) || {}) : null;
        const isImg = fieldType !== 'files'; // image field detected by name (not `files`)
        setMediaPickerCell({
            rowId: note.id, field: key, originalMetaKey: metaKey, tableId: noteTableId,
            fileField: cfg
                ? { propertyName: key, storageFolder: canonicalStorageFolder(cfg.storage_folder) || 'assets', namePattern: cfg.name_pattern || '', fileMode: cfg.file_mode || 'upload' }
                : null,
            imageField: isImg,
            imageMeta: isImg ? parseImageField(note.metadata?.[metaKey]) : null,
            rowMetadata: note.metadata || {},
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeView, resolveNoteTableId, schema]);

    // Collects the raw values from the selected range → 2D matrix of cells.
    const getRangeCells = useCallback(() => {
        if (!selectionRect) return [];
        const { r0, c0, r1, c1 } = selectionRect;
        const rows = [];
        for (let r = r0; r <= r1; r++) {
            const navRow = navRows[r];
            if (!navRow) continue;
            const note = noteById.get(navRow.id);
            if (!note) continue;
            const cols = [];
            for (let c = c0; c <= c1; c++) {
                const col = gridColumns[c];
                if (!col) continue;
                if (col.key === 'title') {
                    cols.push({ rowId: note.id, field: 'title', type: 'text', value: note.title ?? '' });
                    continue;
                }
                const metaKey = getMetaKey(note, col.key);
                cols.push({ rowId: note.id, field: col.key, type: col.type, value: note.metadata?.[metaKey] });
            }
            rows.push(cols);
        }
        return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectionRect, navRows, gridColumns, noteById]);

    const handleCopyCells = useCallback(() => {
        const cells = getRangeCells();
        if (cells.length === 0 || cells[0].length === 0) return;
        clipboardRef.current = { matrix: cells.map(row => row.map(c => c.value)) };
        const tsv = cells.map(row => row.map(c => serializeCellForClipboard(c.value, c.type, idToTitle)).join('\t')).join('\n');
        if (navigator.clipboard?.writeText) navigator.clipboard.writeText(tsv).catch(() => {});
        const n = cells.length * cells[0].length;
        toast.success(t('table.cells_copied', { count: n, defaultValue: `${n} cel·la(es) copiada(es)` }));
    }, [getRangeCells, idToTitle, t]);

    // Propagates to parents (autocomplete/dates) after a bulk paste:
    // replicates what `handleCellSave` does for individual edits, aggregated
    // by (parent, field) and with `overrides` so the "all children done" calculation
    // uses the just-pasted values, not the old ones.
    const propagateBulkToParents = useCallback(async (succeeded) => {
        const groups = new Map(); // `${parentId}::${field}` → { parentId, field, overrides, sampleChild, sampleValue }
        for (const u of succeeded) {
            const note = noteById.get(u.id);
            const parentId = note?.metadata?.parent_id || note?.parent_id;
            if (!parentId) continue;
            const ftype = getFieldType(schema, u.field);
            const isStatusish = ['status', 'checkbox'].includes(ftype) || ['status', 'estat'].includes(String(u.field).toLowerCase());
            const isDateish = ['date', 'period', 'datetime'].includes(ftype);
            if (!isStatusish && !isDateish) continue;
            const gkey = `${parentId}::${u.field}`;
            let g = groups.get(gkey);
            if (!g) { g = { parentId, field: u.field, overrides: new Map(), sampleChild: u.id, sampleValue: u.newValue }; groups.set(gkey, g); }
            g.overrides.set(u.id, u.newValue);
        }
        for (const g of groups.values()) {
            await propagateToParent(g.parentId, g.field, g.sampleChild, g.sampleValue, g.overrides);
        }
    }, [noteById, schema, propagateToParent]);

    // Bulk write: 1 optimistic patch + 1 PATCH per PAGE (grouping the
    // metadata keys), with limited concurrency to avoid flooding the backend
    // on large selections, + propagation to parents + a single refetch.
    const applyBulkCellUpdates = useCallback(async (updates) => {
        if (!updates || updates.length === 0) return;
        // Dedupe by id+key (last one wins).
        const map = new Map();
        for (const u of updates) map.set(`${u.id}::${u.key}`, u);
        const finalUpdates = [...map.values()];

        // Optimistic patch: all keys of each page at once.
        setOptimisticPatches(prev => {
            const next = new Map(prev);
            for (const u of finalUpdates) {
                const existing = next.get(u.id) || {};
                next.set(u.id, { ...existing, [u.key]: u.newValue });
            }
            return next;
        });

        // Groups by page → 1 PATCH per page with multiple keys.
        const byPage = new Map();
        for (const u of finalUpdates) {
            const m = byPage.get(u.id) || {};
            m[u.key] = u.newValue;
            byPage.set(u.id, m);
        }
        const pageEntries = [...byPage.entries()];

        // Limited concurrency (chunks) to avoid a flood of requests.
        const CHUNK = 20;
        const failedPageIds = new Set();
        for (let i = 0; i < pageEntries.length; i += CHUNK) {
            const slice = pageEntries.slice(i, i + CHUNK);
            const results = await Promise.allSettled(slice.map(([id, metadata]) =>
                fetch(`/api/vault/pages/${id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ metadata }),
                }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); })
            ));
            results.forEach((res, j) => { if (res.status === 'rejected') failedPageIds.add(slice[j][0]); });
        }

        // Rollback of the pages that failed.
        if (failedPageIds.size > 0) {
            setOptimisticPatches(prev => {
                const next = new Map(prev);
                for (const u of finalUpdates) {
                    if (!failedPageIds.has(u.id)) continue;
                    const existing = next.get(u.id);
                    if (!existing) continue;
                    const { [u.key]: _removed, ...rest } = existing;
                    if (Object.keys(rest).length === 0) next.delete(u.id);
                    else next.set(u.id, rest);
                }
                return next;
            });
            notifyError('table-bulk-paste', new Error(`${failedPageIds.size} pages failed`), t('table.paste_error', { count: failedPageIds.size, defaultValue: 'Error saving {{count}} pages' }));
        }

        // Propagates to parents for correctly saved children (status/dates).
        const succeeded = finalUpdates.filter(u => !failedPageIds.has(u.id));
        await propagateBulkToParents(succeeded);

        if (onCellSaved) onCellSaved();
        else if (onUpdateView) onUpdateView(activeView);
    }, [onCellSaved, onUpdateView, activeView, t, propagateBulkToParents]);

    // Coercion context for a column (select/relation options).
    const coercionCtxFor = useCallback((col) => {
        if (col.type === 'select' || col.type === 'status' || col.type === 'multi_select') {
            return { options: getAvailableOptions(col.key, col.type), idToTitle };
        }
        if (col.type === 'relation') {
            return { relatedNotes: getRelationContext(col.key).relatedNotes, idToTitle };
        }
        return {};
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [idToTitle, schema, safeNotes, allNotes]);

    const handlePasteCells = useCallback(async () => {
        if (!selectionRect) return;
        let srcMatrix = clipboardRef.current?.matrix || null;
        if (!srcMatrix) {
            let text = '';
            try { text = await navigator.clipboard.readText(); } catch { text = ''; }
            const parsed = parseClipboardMatrix(text);
            if (parsed.length === 0) return;
            srcMatrix = parsed;
        }
        const srcRows = srcMatrix.length;
        const srcCols = srcMatrix[0]?.length || 0;
        if (srcRows === 0 || srcCols === 0) return;

        const rect = computePasteRect(srcRows, srcCols, selectionRect, navRows.length, gridColumns.length);
        const updates = [];
        let skipped = 0;
        for (let r = rect.r0; r <= rect.r1; r++) {
            const navRow = navRows[r];
            if (!navRow) continue;
            const note = noteById.get(navRow.id);
            if (!note) continue;
            for (let c = rect.c0; c <= rect.c1; c++) {
                const col = gridColumns[c];
                if (!col) continue;
                if (!isPasteableType(col.type)) continue;
                const raw = srcMatrix[(r - rect.r0) % srcRows]?.[(c - rect.c0) % srcCols];
                const res = coerceValueForField(raw, col.type, coercionCtxFor(col));
                if (res.skip) { skipped++; continue; }
                const metaKey = getMetaKey(note, col.key);
                if (sameCellValue(note.metadata?.[metaKey], res.value)) continue;
                updates.push({ id: note.id, key: metaKey, field: col.key, newValue: res.value });
            }
        }
        await applyBulkCellUpdates(updates);
        if (skipped > 0) toast(t('table.paste_skipped', { count: skipped, defaultValue: `${skipped} cel·la(es) ometa(es) (tipus incompatible)` }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectionRect, navRows, gridColumns, noteById, coercionCtxFor, applyBulkCellUpdates, t]);

    const clearActiveCells = useCallback(() => {
        const rect = selectionRectRef.current;
        if (!rect) return;
        const rows = navRowsRef.current;
        const cols = gridColumnsRef.current;
        const updates = [];
        for (let r = rect.r0; r <= rect.r1; r++) {
            const navRow = rows[r];
            if (!navRow) continue;
            const note = noteById.get(navRow.id);
            if (!note) continue;
            for (let c = rect.c0; c <= rect.c1; c++) {
                const col = cols[c];
                if (!col || !isPasteableType(col.type)) continue;
                const empty = (col.type === 'multi_select' || col.type === 'relation') ? [] : (col.type === 'checkbox' ? false : '');
                const metaKey = getMetaKey(note, col.key);
                if (sameCellValue(note.metadata?.[metaKey], empty)) continue;
                updates.push({ id: note.id, key: metaKey, field: col.key, newValue: empty });
            }
        }
        applyBulkCellUpdates(updates);
    }, [noteById, applyBulkCellUpdates]);

    // Moves the cursor (dRow/dCol) within the limits; `extend` fixes the anchor.
    // All changing values (activeCell, navRows, etc.) are read via
    // refs to avoid rebuilding the callback — and re-registering the listener
    // keyboard— on every key pressed.
    const moveCursor = useCallback((dRow, dCol, extend) => {
        const prev = activeCellRef.current;
        const currentAnchor = anchorCellRef.current;
        const rows = navRowsRef.current;
        const cols = gridColumnsRef.current;
        const rowIndex = navRowIndexByIdRef.current;
        const colIndex = colIndexByKeyRef.current;
        let rIdx = 0, cIdx = 0;
        if (prev && rowIndex.has(prev.rowId) && colIndex.has(prev.field)) {
            rIdx = rowIndex.get(prev.rowId);
            cIdx = colIndex.get(prev.field);
        }
        let nr = rIdx + dRow;
        if (nr > rows.length - 1 && sortedNotes.length > visibleRowsCount) handleLoadMoreRows();
        nr = clampIndex(nr, rows.length);
        const nc = clampIndex(cIdx + dCol, cols.length);
        const target = rows[nr];
        const col = cols[nc];
        if (!target || !col) return;
        // Vertical scroll only if we change rows (avoids recalculating on
        // purament horitzontals).
        if (nr !== rIdx && target.descriptorIndex != null && rowVirtualizer?.scrollToIndex) {
            rowVirtualizer.scrollToIndex(target.descriptorIndex, { align: 'auto' });
        }
        // Horizontal scroll: makes the destination column visible when it leaves the viewport.
        // Column 0 is the `title`, sticky → always visible, no need to scroll it. The
        // offset sum starts at i=1 because the title width is already inside stickyW.
        const container = tableContainerRef.current;
        if (container && nc > 0) {
            const widths = columnWidthsRef.current;
            const stickyW = 40 + (widths['title'] || 250);
            let colLeft = stickyW;
            for (let i = 1; i < nc; i++) colLeft += (widths[cols[i].key] || 180);
            const colRight = colLeft + (widths[col.key] || 180);
            const visLeft = container.scrollLeft + stickyW;
            const visRight = container.scrollLeft + container.clientWidth;
            if (colLeft < visLeft) {
                container.scrollLeft = colLeft - stickyW;
            } else if (colRight > visRight) {
                container.scrollLeft = colRight - container.clientWidth + 4;
            }
        }
        if (extend) { if (!currentAnchor && prev) setAnchorCell(prev); }
        else setAnchorCell(null);
        setActiveCell({ rowId: target.id, field: col.key });
    }, [sortedNotes.length, visibleRowsCount, handleLoadMoreRows, rowVirtualizer]);

    // Opens the active cell's editor (Enter / typing / second click).
    const beginEditActive = useCallback((initialChar = null) => {
        const cell = activeCellRef.current;
        if (!cell) return;
        const note = safeNotes.find(n => n.id === cell.rowId);
        if (!note) return;
        // The title is edited inline in its own <td> (not via renderCellContent).
        if (cell.field === 'title') {
            titlePreviewRef.current?.close(); // don't cover the input with the pop-up
            setEditInitial(initialChar);
            setEditingCell({ rowId: note.id, field: 'title', originalMetaKey: 'title' });
            return;
        }
        const type = getFieldType(schema, cell.field);
        if (isComputedType(type)) return;
        const metaKey = getMetaKey(note, cell.field);
        if (isImageField(cell.field, type)) { openMediaPicker(note, cell.field, type); return; }
        if (type === 'checkbox') {
            const cur = note.metadata?.[metaKey];
            const checked = !!cur && cur !== 'false';
            handleCellSave(note.id, cell.field, !checked, metaKey);
            return;
        }
        setEditInitial(initialChar);
        setEditingCell({ rowId: note.id, field: cell.field, originalMetaKey: metaKey });
    }, [safeNotes, schema, isImageField, openMediaPicker, handleCellSave]);

    // Saves the title (field `note.title`, not metadata) with the same pattern
    // optimistic than handleCellSave: immediate override + PATCH { title }.
    const saveTitle = useCallback(async (noteId, newTitle) => {
        setEditingCell(null);
        setEditInitial(null);
        const note = noteById.get(noteId);
        if (!note) return;
        const trimmed = String(newTitle ?? '').trim();
        if (trimmed === '' || trimmed === note.title) return; // no-op (empty doesn't clear the title)
        setOptimisticTitles(prev => new Map(prev).set(noteId, trimmed));
        try {
            const response = await fetch(`/api/vault/pages/${noteId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: trimmed }),
            });
            if (!response.ok) {
                const payload = await response.json().catch(() => ({}));
                throw new Error(payload?.detail || `HTTP ${response.status}`);
            }
            if (onCellSaved) onCellSaved();
        } catch (error) {
            // Same pattern as handleCellSave: rollback of the optimistic override and
            // notifyError (logs context + backend message) instead of a
            // generic toast, so we can diagnose 4xx/5xx and payload.detail.
            setOptimisticTitles(prev => { const n = new Map(prev); n.delete(noteId); return n; });
            notifyError('table-save-title', error, t('table.title_save_error', { defaultValue: "Couldn't save the title" }));
        }
    }, [noteById, onCellSaved, t]);

    // After saving with Enter, moves the cursor down one row (Excel style).
    const advanceCursorAfterEdit = useCallback((rowId, field) => {
        const r = navRowIndexById.get(rowId);
        const c = colIndexByKey.get(field);
        if (r == null || c == null) return;
        const nr = clampIndex(r + 1, navRows.length);
        const target = navRows[nr];
        if (!target) return;
        setAnchorCell(null);
        setActiveCell({ rowId: target.id, field });
        if (target.descriptorIndex != null && rowVirtualizer?.scrollToIndex) {
            rowVirtualizer.scrollToIndex(target.descriptorIndex, { align: 'auto' });
        }
    }, [navRowIndexById, colIndexByKey, navRows, rowVirtualizer]);

    // Grid keyboard navigation (at the window level: the rows
    // are virtualized and unmount, so we can't rely on DOM focus per cell).
    // All changing values are accessed via refs to avoid unregistering
    // and re-registering the listener on every keypress (main cause of lag).
    const handleCopyCellsRef = useRef(handleCopyCells);
    handleCopyCellsRef.current = handleCopyCells;
    const handlePasteCellsRef = useRef(handlePasteCells);
    handlePasteCellsRef.current = handlePasteCells;
    const moveCursorRef = useRef(moveCursor);
    moveCursorRef.current = moveCursor;
    const beginEditActiveRef = useRef(beginEditActive);
    beginEditActiveRef.current = beginEditActive;
    const clearActiveCellsRef = useRef(clearActiveCells);
    clearActiveCellsRef.current = clearActiveCells;
    const schemaRef = useRef(schema);
    schemaRef.current = schema;
    // Refs for the row action shortcuts (handler mounted only once).
    const rowActionsRef = useRef({});
    rowActionsRef.current = { noteById, onNoteSelect, onOpenParallel, onDeletePage, hasOpenableResource, handleOpenExternalResource };

    // ── Navigation bridge with the editor (only when the table is embedded) ──
    // Exit callbacks + grid limits, read via ref by the global
    // listener (mounted only once). When not embedded, onExit* are null and the
    // behavior is the usual one (arrows stick at the edges).
    const onExitTopRef = useRef(null); onExitTopRef.current = onExitTop;
    const onExitBottomRef = useRef(null); onExitBottomRef.current = onExitBottom;
    const onEscapeRef = useRef(null); onEscapeRef.current = onEscape;
    const tableEdgeRef = useRef({});
    tableEdgeRef.current = {
        firstRowId: navRows[0]?.id,
        lastRowId: navRows[navRows.length - 1]?.id,
        allLoaded: sortedNotes.length <= visibleRowsCount,
    };

    // Exposes an API to whoever embeds it, to "enter" the table via the keyboard. In
    // set the activeCell and remove focus from the editor (→ <body>), the listener
    // global listener below catches the arrow keys (see the guard `t === document.body`).
    useEffect(() => {
        if (!registerNavApi) return undefined;
        const focusEdge = (which) => {
            const rows = navRowsRef.current;
            const cols = gridColumnsRef.current;
            if (!rows.length || !cols.length) return false;
            claimKeyboard(); // entering it from the editor makes the keyboard property ours
            const row = which === 'last' ? rows[rows.length - 1] : rows[0];
            const col = cols[0];
            setAnchorCell(null);
            setActiveCell({ rowId: row.id, field: col.key });
            if (row.descriptorIndex != null && rowVirtualizer?.scrollToIndex) {
                rowVirtualizer.scrollToIndex(row.descriptorIndex, { align: which === 'last' ? 'end' : 'start' });
            }
            try { document.activeElement?.blur?.(); } catch { /* noop */ }
            return true;
        };
        registerNavApi({
            focusFirstCell: () => focusEdge('first'),
            focusLastCell: () => focusEdge('last'),
        });
        return () => registerNavApi(null);
    }, [registerNavApi, rowVirtualizer]);

    useEffect(() => {
        const onKey = (e) => {
            // Don't hijack keys that aren't meant for the grid. Without these
            // guards, with an active cell and a modal open on top, every
            // arrow moved the cursor under the modal and the preventDefault killed
            // the modal's native scroll; and a letter or ⌫ with focus on <body>
            // would edit or clear cells invisibly (data loss).
            if (e.defaultPrevented) return; // already handled upstream (e.g. modal scroll)
            if (document.body.classList.contains('gnosi-modal-open')) return;
            // Only the OWNER instance of the keyboard processes the event: with
            // several mounted tables (split panel, embeds), all of them received
            // each key and ⌫/⌘V would act on grids the user wasn't touching.
            if (_gridKeyboardOwner !== gridInstanceIdRef.current) return;
            const t = e.target;
            // Keys originating outside the table (focus inside a modal, the
            // sidebar…): aren't ours. The <body> is (normal navigation of
            // cells doesn't leave the focus inside the container: virtual rows).
            if (t instanceof Element && t !== document.body && tableContainerRef.current && !tableContainerRef.current.contains(t)) return;
            const cell = activeCellRef.current;
            if (!cell || editingCellRef.current) return;
            const el = document.activeElement;
            const tag = el?.tagName;
            const inputType = (el && el.getAttribute) ? (el.getAttribute('type') || '') : '';
            const isTextInput = (tag === 'INPUT' && !['checkbox', 'radio', 'button', 'submit'].includes(inputType)) || tag === 'TEXTAREA' || el?.isContentEditable;
            if (isTextInput) return;
            // Checkbox cells are `<td tabIndex=0>` with their own
            // onKeyDown (Space/Enter toggle). If one has focus, we let it
            // handle these keys so we don't toggle it twice.
            if (tag === 'TD' && (e.key === ' ' || e.key === 'Enter')) return;

            const meta = e.metaKey || e.ctrlKey;
            if (meta && (e.key === 'c' || e.key === 'C')) { e.preventDefault(); handleCopyCellsRef.current(); return; }
            if (meta && (e.key === 'v' || e.key === 'V')) { e.preventDefault(); handlePasteCellsRef.current(); return; }
            // ⌘/Ctrl+⌫ → deletes the cursor's row (deliberate: ⌫ alone clears
            // the cell). Only if there's no multiple row selection.
            if (meta && (e.key === 'Backspace' || e.key === 'Delete')) {
                const { onDeletePage, noteById } = rowActionsRef.current;
                if (onDeletePage && selectedIdsRef.current.size === 0) {
                    const n = noteById.get(cell.rowId);
                    if (n) { e.preventDefault(); onDeletePage(n.id, n.title); }
                }
                return;
            }
            if (meta) return; // leaves ⌘A/⌘O to its own listeners

            // Action shortcuts on the cursor's row (Alt+letter; via e.code
            // because on Mac Alt+letter produces special characters). They don't clash
            // with type-to-edit (which ignores altKey).
            if (e.altKey && !e.shiftKey) {
                const { noteById, onNoteSelect, onOpenParallel, hasOpenableResource, handleOpenExternalResource } = rowActionsRef.current;
                const n = noteById.get(cell.rowId);
                if (e.code === 'KeyO') { e.preventDefault(); if (n && onNoteSelect) onNoteSelect(n.id, { returnFocusId: n.id }); return; }
                if (e.code === 'KeyR') { e.preventDefault(); if (n && hasOpenableResource(n)) handleOpenExternalResource(n); return; }
                if (e.code === 'KeyP') { e.preventDefault(); if (n && onOpenParallel) onOpenParallel(n.id); return; }
            }

            switch (e.key) {
                case 'ArrowUp':
                    e.preventDefault();
                    // On the first row, ↑ exits to the editor (above the view).
                    if (onExitTopRef.current && !e.shiftKey && cell.rowId === tableEdgeRef.current.firstRowId) {
                        setActiveCell(null); setAnchorCell(null); onExitTopRef.current();
                    } else {
                        moveCursorRef.current(-1, 0, e.shiftKey);
                    }
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    // On the last row (and nothing left to load), ↓ exits to
                    // the editor (below the view).
                    if (onExitBottomRef.current && !e.shiftKey && cell.rowId === tableEdgeRef.current.lastRowId && tableEdgeRef.current.allLoaded) {
                        setActiveCell(null); setAnchorCell(null); onExitBottomRef.current();
                    } else {
                        moveCursorRef.current(1, 0, e.shiftKey);
                    }
                    break;
                case 'ArrowLeft': e.preventDefault(); moveCursorRef.current(0, -1, e.shiftKey); break;
                case 'ArrowRight': e.preventDefault(); moveCursorRef.current(0, 1, e.shiftKey); break;
                case 'Tab': e.preventDefault(); moveCursorRef.current(0, e.shiftKey ? -1 : 1, false); break;
                case 'Enter': e.preventDefault(); beginEditActiveRef.current(null); break;
                case ' ':
                    e.preventDefault(); // prevents page scroll while navigating between cells
                    if (getFieldType(schemaRef.current, cell.field) === 'checkbox') { beginEditActiveRef.current(null); break; }
                    // Quick Look: Space on the title cell opens/closes the
                    // preview pop-up, anchored to the active cell.
                    if (cell.field === 'title') {
                        const tp = titlePreviewRef.current;
                        if (tp?.active && tp.active.pageId === cell.rowId && tp.active.viaKeyboard) {
                            tp.close();
                        } else {
                            const el = tableContainerRef.current?.querySelector(`[data-title-cell="${CSS.escape(cell.rowId)}"]`);
                            if (el) tp?.openForKeyboard(cell.rowId, el.getBoundingClientRect());
                        }
                    }
                    break;
                case 'Escape':
                    e.preventDefault();
                    setActiveCell(null);
                    setAnchorCell(null);
                    if (onEscapeRef.current) {
                        onEscapeRef.current();
                    }
                    break;
                case 'Backspace':
                case 'Delete':
                    if (selectedIdsRef.current.size === 0) { e.preventDefault(); clearActiveCellsRef.current(); }
                    break;
                default:
                    if (e.key.length === 1 && !e.altKey) {
                        const type = getFieldType(schemaRef.current, cell.field);
                        if (type === 'text' || type === 'number' || type === undefined || type === '') {
                            e.preventDefault();
                            beginEditActiveRef.current(e.key);
                        }
                    }
                    break;
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []); // mounted only once; all values accessed via refs

    const handleRelationUnlink = useCallback(async (noteId, field, originalMetaKey, relationId, displayMap) => {
        const note = safeNotes.find(item => item.id === noteId);
        if (!note) return false;
        const previousValue = normalizeRelationValues(note.metadata?.[originalMetaKey]);
        const nextValue = withoutRelationValue(previousValue, relationId);
        if (nextValue.length === previousValue.length) return false;

        const saved = await handleCellSave(noteId, field, nextValue, originalMetaKey);
        if (!saved) return false;

        announceRelationUnlinked({
            pageId: noteId,
            field,
            metadataKey: originalMetaKey,
            relationId,
            relationTitle: displayMap?.[relationId] || relationId,
            previousValue,
            nextValue,
        });
        return true;
    }, [handleCellSave, safeNotes]);

    const executeTableFunctionality = async (event, note, functionality) => {
        event?.stopPropagation();
        if (!functionality || functionality.enabled === false) return;
        const action = functionality.action || 'translate_row';
        const config = functionality.config || {};
        const buttonKey = `${note.id}_${functionality.id}`;
        if (executingButtonKey === buttonKey) return;

        if (action === 'translate_row' || action === 'sync_drupal' || action === 'publish_social' || action === 'process_resource') {
            setPendingAction({
                noteId: note.id,
                fieldConfig: { button_action: action, button_config: config },
                action,
            });
            return;
        }

        if (action === 'set_fields') {
            const assignments = config.assignments || [];
            if (assignments.length === 0) {
                toast.error(t('schema.no_assignments_error', 'No field assignments configured for this functionality'));
                return;
            }
            for (const assignment of assignments) {
                if (!assignment.field) continue;
                let value = assignment.value ?? '';
                if (typeof value === 'string' && (value.includes('(') || value.includes('{') || value.includes('+'))) {
                    const evaluated = evaluateFormula(value, note.metadata || {}, note.title || '');
                    if (evaluated !== null && evaluated !== undefined) value = evaluated;
                }
                await handleCellSave(note.id, assignment.field, value, assignment.field);
            }
            toast.success(t('schema.functionality_executed_success', 'Functionality executed successfully'));
            return;
        }

        if (action === 'ai_prompt' || action === 'run_skill') {
            setExecutingButtonKey(buttonKey);
            try {
                const response = await axios.post('/api/vault/skills/execute-button-action', {
                    note_id: note.id,
                    button_action: action,
                    button_config: config,
                });
                if (response.data?.status === 'ok') {
                    toast.success(t('schema.functionality_executed_success', 'Functionality executed successfully'));
                    onTranslated?.({});
                }
            } catch (error) {
                toast.error(error.response?.data?.detail || t('schema.functionality_execute_error', 'Could not execute functionality'));
            } finally {
                setExecutingButtonKey(null);
            }
        }
    };

    const renderCellContent = (value, type, noteId, field, originalMetaKey) => {
        const isEditing = editingCell?.rowId === noteId && editingCell?.field === field;
        const note = noteById.get(noteId);
        const isManual = note?.metadata?.[`${originalMetaKey}_manual`];
        const isImageLikeField = isImageField(field, type);

        // Action button: the field has no value, always shows the button. Clicking it
        // triggers the configured action (translation, set_fields, ai_prompt, run_skill).
        if (type === 'button') {
            const cfg = getFieldConfig(schema, field) || {};
            const action = cfg.button_action || 'translate_row';
            const label = cfg.button_label?.trim() || (action === 'translate_row'
                ? t('schema.button_label_translate', "Translate")
                : field);
            const btnKey = `${noteId}_${field}`;
            const isExecuting = executingButtonKey === btnKey;
            const Icon = isExecuting ? Loader2 : (action === 'translate_row' ? Languages : (action === 'ai_prompt' ? Sparkles : Zap));

            const handleButtonClick = async (e) => {
                e.stopPropagation();
                if (isExecuting) return;

                if (action === 'translate_row' || action === 'sync_drupal' || action === 'publish_social' || action === 'process_resource') {
                    setPendingAction({ noteId, field, fieldConfig: cfg, action });
                    return;
                }

                if (action === 'set_fields') {
                    const assignments = cfg.button_config?.assignments || [];
                    if (assignments.length === 0) {
                        toast.error(t('schema.no_assignments_error', "No field assignments configured for this button"));
                        return;
                    }
                    const note = noteById.get(noteId);
                    const metadata = note?.metadata || {};
                    const title = note?.title || '';
                    for (const assign of assignments) {
                        if (!assign.field) continue;
                        let val = assign.value || '';
                        if (typeof val === 'string' && (val.includes('(') || val.includes('{') || val.includes('+'))) {
                            const evaluated = evaluateFormula(val, metadata, title);
                            if (evaluated !== null && evaluated !== undefined) val = evaluated;
                        }
                        await handleCellSave(noteId, assign.field, val, assign.field);
                    }
                    toast.success(t('schema.button_executed_success', "Acció executada correctament"));
                    return;
                }

                if (action === 'ai_prompt' || action === 'run_skill') {
                    setExecutingButtonKey(btnKey);
                    try {
                        const res = await axios.post('/api/vault/skills/execute-button-action', {
                            note_id: noteId,
                            button_action: action,
                            button_config: cfg.button_config || {},
                        });
                        if (res.data?.status === 'ok') {
                            toast.success(t('schema.button_executed_success', "Acció executada correctament"));
                            onTranslated?.({});
                        }
                    } catch (err) {
                        toast.error(err.response?.data?.detail || "Error executing action");
                    } finally {
                        setExecutingButtonKey(null);
                    }
                }
            };

            return (
                <button
                    type="button"
                    disabled={isExecuting}
                    onClick={handleButtonClick}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)] border border-[var(--gnosi-primary)]/30 hover:bg-[var(--gnosi-primary)]/20 transition-colors disabled:opacity-50"
                    title={label}
                >
                    <Icon size={12} className={isExecuting ? "animate-spin" : ""} />
                    {isExecuting ? t('schema.button_executing', "Executant...") : label}
                </button>
            );
        }

        // System fields (read-only): Created/Edited on (timestamps from the
        // registered table fields) and Created/Edited by (authorship). In
        // personal mode, the author is the sole user; if the page carries a
        // saved value (e.g. from an import), it is preserved.
        if (type === 'created_time' || type === 'last_edited_time') {
            const iso = resolveSystemDateValue(note, schema, type, field);
            let label = '';
            if (iso) { try { label = new Date(iso).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' }); } catch { label = String(iso).slice(0, 10); } }
            return <span className="text-sm text-[var(--text-tertiary)]">{label || '—'}</span>;
        }
        if (type === 'created_by' || type === 'last_edited_by') {
            // REAL authorship stamped per page (canonical key), with fallbacks.
            const canonical = note?.metadata?.[type];
            const stored = canonical || (value && String(value).trim()) || note?.metadata?.[field];
            const who = stored || currentUser?.name || currentUser?.email || '—';
            return <span className="text-sm text-[var(--text-secondary)]">{who}</span>;
        }

        // Safety net: never open the generic editor on a CALCULATED field
        // (formula/rollup/virtual) — would save the derived value in the frontmatter.
        // The phantom editing state is cleared and we proceed with the read-only render.
        if (isEditing && isComputedType(type)) {
            setTimeout(() => setEditingCell(null), 0);
        } else if (isEditing) {
            if (type === 'status' || type === 'select') {
                const options = getAvailableOptions(field, type);
                // `status` is a STRICT catalog (like Notion): you can neither create options
                // inline from the cell nor delete them — they're managed from
                // the options editor in the Fields modal. Fields with
                // a shared catalog (catalog_ref) too: edited in the catalog.
                const isStrict = type === 'status' || Boolean(getFieldConfig(schema, field)?.catalog_ref);
                return (
                    <InlineSelectPicker
                        value={value || ''}
                        options={options}
                        idToTitle={idToTitle}
                        optionColors={getOptionColorMap(field)}
                        onSave={(val) => handleCellSave(noteId, field, val, originalMetaKey)}
                        onCreate={(!isStrict && onUpdateFieldOptions) ? (val) => {
                            updateFieldOptions(field, [...options, val]);
                            handleCellSave(noteId, field, val, originalMetaKey);
                        } : undefined}
                        onDeleteOption={(!isStrict && onUpdateFieldOptions) ? (val) => removeOptionEverywhere(field, type, val) : undefined}
                    />
                );
            }

            if (type === 'multi_select' || type === 'relation') {
                let options;
                let displayMap = idToTitle;
                if (type === 'relation') {
                    const { relatedNotes, displayMap: enriched } = getRelationContext(field);
                    options = relatedNotes.map(n => n.id);
                    displayMap = enriched;
                } else {
                    options = getAvailableOptions(field, type);
                }
                const currentValues = Array.isArray(value) ? value : (value ? String(value).split(',').map(s => s.trim()).filter(Boolean) : []);
                const canManageOptions = type === 'multi_select' && Boolean(onUpdateFieldOptions)
                    && !getFieldConfig(schema, field)?.catalog_ref;
                return (
                    <InlinePillsPicker
                        value={currentValues}
                        options={options}
                        idToTitle={displayMap}
                        optionColors={type === 'multi_select' ? getOptionColorMap(field) : {}}
                        onSave={(vals) => handleCellSave(noteId, field, vals, originalMetaKey)}
                        onCreate={canManageOptions ? (val) => updateFieldOptions(field, [...options, val]) : undefined}
                        onDeleteOption={canManageOptions ? (val) => removeOptionEverywhere(field, 'multi_select', val) : undefined}
                        relationItems={type === 'relation'}
                        onOpenRelation={type === 'relation' ? onNoteSelect : undefined}
                        onRemoveRelation={type === 'relation'
                            ? (relationId) => handleRelationUnlink(noteId, field, originalMetaKey, relationId, displayMap)
                            : undefined}
                    />
                );
            }

            if (type === 'autoria') {
                const current = Array.isArray(value) ? value : [];
                return (
                    <AutoriaEditor
                        value={current}
                        suggestions={getAutoriaSuggestions(field)}
                        onSave={(authors) => handleCellSave(noteId, field, authors, originalMetaKey)}
                    />
                );
            }

            // Edit dates and periods using VaultDateProperty component
            if (type === 'date' || type === 'datetime' || type === 'period') {
                return (
                    <VaultDateProperty
                        value={value || ''}
                        rruleValue={note?.metadata?.[`${originalMetaKey}_rrule`] || ''}
                        type={type}
                        fieldConfig={getFieldConfig(schema, field)}
                        fieldName={field}
                        noteId={noteId}
                        notes={(allNotes && allNotes.length > 0) ? allNotes : safeNotes}
                        idToTitle={idToTitle}
                        planningSettings={projectPlanningSettings}
                        planningEnabled={projectPlanningEnabled}
                        onChange={(newVal) => handleCellSave(noteId, field, newVal, originalMetaKey)}
                        onRruleChange={(newRrule) => handleCellSave(noteId, field, value || '', originalMetaKey, false, { [`${originalMetaKey}_rrule`]: newRrule })}
                    />
                );
            }

            if (type === 'number') {
                // Saves a real number (not a string) so that aggregations and
                // sorting is reliable; empty is saved as ''.
                const saveNumber = (raw) => {
                    const s = String(raw).trim();
                    const n = s === '' ? '' : (Number.isFinite(Number(s)) ? Number(s) : s);
                    handleCellSave(noteId, field, n, originalMetaKey);
                };
                return (
                    <input
                        autoFocus
                        type="number"
                        inputMode="decimal"
                        className="w-full px-1 py-0.5 text-sm border border-[var(--border-primary)] rounded focus:outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)]"
                        defaultValue={editInitial != null ? editInitial : (value ?? '')}
                        onBlur={(e) => saveNumber(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); saveNumber(e.target.value); advanceCursorAfterEdit(noteId, field); return; }
                            if (e.key === 'Escape') { setEditingCell(null); setEditInitial(null); return; }
                            handleKeyDown(e, noteId, field, originalMetaKey);
                        }}
                    />
                );
            }

            return (
                <input
                    autoFocus
                    className="w-full px-1 py-0.5 text-sm border border-[var(--border-primary)] rounded focus:outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)]"
                    defaultValue={editInitial != null ? editInitial : (value || '')}
                    onBlur={(e) => handleCellSave(noteId, field, e.target.value, originalMetaKey)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); handleCellSave(noteId, field, e.target.value, originalMetaKey); advanceCursorAfterEdit(noteId, field); return; }
                        if (e.key === 'Escape') { setEditingCell(null); setEditInitial(null); return; }
                        handleKeyDown(e, noteId, field, originalMetaKey);
                    }}
                />
            );
        }

        // Formula/rollup always show their chip (with "0" if needed), not the dash:
        // so an empty result and a 0 result render the same.
        const isEmptyValue = value === undefined || value === null || value === '';
        if (isEmptyValue && type !== 'formula' && type !== 'rollup') {
            if (type === 'checkbox') {
                return <div className="w-4 h-4 border border-[var(--border-primary)] rounded-sm"></div>;
            }
            if (type === 'files') {
                return <span className="text-[var(--text-tertiary)] italic">{t('table.add_files', { defaultValue: "+ Files" })}</span>;
            }
            if (isImageLikeField) {
                return <span className="text-[var(--text-tertiary)] italic">{t('table.add_image', { defaultValue: "+ Image" })}</span>;
            }
            return <span className="text-[var(--text-tertiary)]">-</span>;
        }

        switch (type) {
            case 'checkbox':
                return asBool(value) ? <CheckSquare size={16} className="text-indigo-500" /> : <div className="w-4 h-4 border border-[var(--border-primary)] rounded-sm"></div>;
            case 'number': {
                const fmt = resolveFieldFormat(getFieldConfig(schema, field), localeSettings);
                return (
                    <span className="tabular-nums" title={String(value)}>
                        {formatNumber(value, { kind: fmt.kind, decimals: fmt.decimals, currencyCode: fmt.currencyCode, locale: fmt.numberLocale })}
                    </span>
                );
            }
            case 'virtual': {
                // Derived field injected by the backend (read-only). Booleans
                // (is_hub/is_orphan) → checkbox; numeric ones (Progress %, centrality…)
                // → formatNumber with the field's format.
                if (typeof value === 'boolean' || value === 'true' || value === 'false') {
                    return (value && value !== 'false')
                        ? <CheckSquare size={16} className="text-indigo-500" />
                        : <div className="w-4 h-4 border border-[var(--border-primary)] rounded-sm"></div>;
                }
                const vfmt = resolveFieldFormat(getFieldConfig(schema, field), localeSettings);
                return (
                    <span className="tabular-nums" title={String(value)}>
                        {formatNumber(value, { kind: vfmt.kind, decimals: vfmt.decimals, currencyCode: vfmt.currencyCode, locale: vfmt.numberLocale })}
                    </span>
                );
            }
            case 'date':
            case 'datetime': {
                const importedRange = value && typeof value === 'object'
                    ? parsePeriod(value)
                    : null;
                const displayValue = importedRange?.start || value;
                const parsed = new Date(displayValue);
                if (isNaN(parsed.getTime())) {
                    // Corrupt value: we show the raw text instead of "Invalid Date".
                    const rawLabel = typeof value === 'object'
                        ? JSON.stringify(value)
                        : String(value);
                    return <span className="truncate max-w-[200px] block text-[var(--text-tertiary)]" title={rawLabel}>{rawLabel}</span>;
                }
                const fmt = resolveFieldFormat(getFieldConfig(schema, field), localeSettings);
                const formatBoundary = (boundary) => formatDate(boundary, {
                    dateFormat: fmt.dateFormat,
                    type: String(boundary).includes('T') ? 'datetime' : type,
                    locale: fmt.dateLocale,
                });
                return (
                    <div className="flex items-center gap-1.5 whitespace-nowrap text-[var(--text-primary)]">
                        {type === 'datetime' ? <Clock size={14} className="text-[var(--text-tertiary)]" /> : <Calendar size={14} className="text-[var(--text-tertiary)]" />}
                        <span>{formatBoundary(displayValue)}</span>
                        {importedRange?.end && importedRange.end !== importedRange.start && (
                            <>
                                <span className="text-[var(--text-tertiary)]">→</span>
                                <span>{formatBoundary(importedRange.end)}</span>
                            </>
                        )}
                    </div>
                );
            }
            case 'period': {
                const { start, end, durationDays, predecessorIds } = parsePeriod(value);
                const fmt = resolveFieldFormat(getFieldConfig(schema, field), localeSettings);
                // 'locale' mode → compact (day + short month, no year) to avoid inflating
                // the chip; an explicit format (DD/MM/YYYY…) is respected as-is.
                const fmtPeriodDate = (d) => {
                    if (!d) return '?';
                    const hasTime = String(d).includes('T');
                    if (fmt.dateFormat && fmt.dateFormat !== 'locale') {
                        return formatDate(d, {
                            dateFormat: fmt.dateFormat,
                            type: hasTime ? 'datetime' : 'date',
                            locale: fmt.dateLocale,
                        });
                    }
                    return new Date(d).toLocaleString(
                        fmt.dateLocale || i18n.language,
                        hasTime
                            ? { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }
                            : { day: '2-digit', month: 'short' },
                    );
                };
                const days = durationDays ?? periodDaysInclusive(start, end);
                return (
                    <div className="flex items-center gap-1 text-[11px] font-medium text-[var(--text-secondary)] bg-[var(--bg-tertiary)] px-1.5 py-0.5 rounded border border-[var(--border-primary)] w-fit">
                        <span>{fmtPeriodDate(start)}</span>
                        <span className="text-[var(--text-tertiary)]">→</span>
                        <span>{fmtPeriodDate(end)}</span>
                        {days != null && (
                            <span className="text-[var(--text-tertiary)] ml-0.5" title={t('table.period_days', { count: days, defaultValue: "{{count}} days" })}>· {days} d</span>
                        )}
                        {predecessorIds.length > 0 && (
                            <span
                                className="text-[var(--text-tertiary)] ml-0.5"
                                title={predecessorIds.map((id) => idToTitle[id] || id).join(', ')}
                            >
                                · {t('vault_date.period_predecessor_count', {
                                    count: predecessorIds.length,
                                    defaultValue: "{{count}} predecessors",
                                })}
                            </span>
                        )}
                    </div>
                );
            }
            case 'status':
            case 'select': {
                // Catalog color (if the option has one): colored chip; if not,
                // the theme's usual neutral style.
                const chipStyle = optionChipStyle(getOptionColorMap(field)[value]);
                return (
                    <div className="flex items-center gap-1.5">
                        <span
                            className={`px-2 py-0.5 rounded-md text-xs font-semibold border ${chipStyle ? '' : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border-[var(--border-primary)]'}`}
                            style={chipStyle || undefined}
                        >
                            {value}
                        </span>
                        {isManual && <Unlock size={10} className="text-amber-500 opacity-60" title={t('table.manual_value')} />}
                    </div>
                );
            }
            case 'multi_select': {
                // String() + filter(Boolean) like in the kanban and the gallery: an array
                // with booleans/empties it rendered empty pills and passed title={false}.
                const items = normalizeRelationValues(value);
                const colorMap = getOptionColorMap(field);
                return (
                    <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto custom-scrollbar pr-1 py-0.5">
                        {items.map((it, idx) => {
                            const chipStyle = optionChipStyle(colorMap[it]);
                            return (
                                <span
                                    key={idx}
                                    className={`px-1.5 py-0.5 rounded text-[11px] font-medium whitespace-nowrap border ${chipStyle ? '' : 'bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)] border-[var(--gnosi-primary)]/20'}`}
                                    style={chipStyle || undefined}
                                    title={it}
                                >
                                    {idToTitle[it] || (it.length > 20 ? it.substring(0, 8) + '...' : it)}
                                </span>
                            );
                        })}
                    </div>
                );
            }
            case 'relation': {
                const items = normalizeRelationValues(value);
                const displayMap = getRelationContext(field).displayMap;
                return (
                    <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto custom-scrollbar pr-1 py-0.5">
                        {items.map(relationId => (
                            <RelationItem
                                key={relationId}
                                relationId={relationId}
                                title={displayMap[relationId] || relationId}
                                onOpen={onNoteSelect}
                                onRemove={() => handleRelationUnlink(
                                    noteId,
                                    field,
                                    originalMetaKey,
                                    relationId,
                                    displayMap,
                                )}
                            />
                        ))}
                    </div>
                );
            }
            case 'autoria':
                return <AutoriaDisplay value={value} />;
            case 'url':
                {
                    const imageUrl = getImagePreviewUrlFromValue(value);
                    if (imageUrl) {
                        return <ImageHoverPreview src={imageUrl} alt={field} href={imageUrl} />;
                    }
                }
                return (
                    <a href={value} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-indigo-500 hover:underline flex items-center gap-1 truncate max-w-[150px]">
                        <LinkIcon size={12} /> URL
                    </a>
                );
            case 'zotero':
                return (
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            handleOpenZoteroValue(value);
                        }}
                        className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 hover:bg-emerald-500/20"
                        title={String(value)}
                    >
                        <LinkIcon size={12} /> {t('table.open_zotero')}
                    </button>
                );
            case 'files':
                return (
                    <FileFieldValue
                        value={value}
                        field={field}
                        variant="table"
                        onRemove={(idx) => {
                            const arr = (Array.isArray(value) ? value : (value ? [value] : []))
                                .map(v => String(v ?? '')).filter(v => v.trim() !== '');
                            const tgt = arr[idx];
                            setFileDeletePrompt({
                                rowId: noteId, field, originalMetaKey, idx, arr,
                                target: tgt, fileName: filenameFromTarget(tgt),
                            });
                        }}
                    />
                );
            case 'formula':
            case 'rollup': {
                const fmt = resolveFieldFormat(getFieldConfig(schema, field), localeSettings);
                const display = formatNumber(value, { kind: fmt.kind, decimals: fmt.decimals, currencyCode: fmt.currencyCode, locale: fmt.numberLocale });
                return (
                    <div className="flex items-center gap-1.5 text-indigo-500 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20 font-mono text-[11px] w-fit">
                        <span className="text-[10px] opacity-50">{type === 'rollup' ? 'r' : 'ƒ'}</span>
                        <span>{display || '0'}</span>
                    </div>
                );
            }
            default:
                if (isImageLikeField) {
                    const imageUrl = getImagePreviewUrlFromValue(value);
                    if (imageUrl) {
                        return <ImageHoverPreview src={imageUrl} alt={field} />;
                    }
                    return <span className="text-[var(--text-tertiary)] italic">{t('table.add_image', { defaultValue: "+ Image" })}</span>;
                }
                // A boolean (a Notion field with no type in the schema) is not a valid title.
                return <span className="truncate max-w-[200px] block" title={typeof value === 'boolean' ? undefined : value}>{value}</span>;
        }
    };

    const calculateAggregation = (field, type, notesSubset = null) => {
        const func = aggregations[field];
        if (!func || func === 'none') return null;
        const sourceNotes = notesSubset || sortedNotes;
        const values = sourceNotes.map(note => {
            if (field === 'title') return note.title;
            if (field === 'last_modified') return note.last_modified;
            const calculated = getCalculatedFieldValue(field, note, undefined);
            if (calculated !== undefined) {
                return calculated;
            }
            const originalMetaKey = getMetaKey(note, field);
            return note.metadata?.[originalMetaKey];
        }).filter(v => v !== undefined && v !== null && v !== '');
        if (func === 'count') return values.length;
        if (type === 'number' || field === 'size' || type === 'formula' || type === 'rollup') {
            // Tolerant parsing with the COMMA decimal (locale ca/es): "0,25" → 0.25.
            // `Number("0,25")` is NaN, so the sum/average/min/max of a
            // number column in Catalan format excluded values with a comma (total
            // and average were wrong: it counted fewer rows than there actually are).
            const nums = values.map(v => {
                const t = String(v).trim();
                return /^-?\d+,\d+$/.test(t) ? Number(t.replace(',', '.')) : Number(t);
            }).filter(v => !isNaN(v));
            if (nums.length === 0) return 0;
            const aggFmt = resolveFieldFormat(getFieldConfig(schema, field), localeSettings);
            const fnum = (n) => formatNumber(n, { kind: aggFmt.kind, decimals: aggFmt.decimals, currencyCode: aggFmt.currencyCode, locale: aggFmt.numberLocale });
            if (func === 'sum') return fnum(nums.reduce((a, b) => a + b, 0));
            if (func === 'avg') return fnum(nums.reduce((a, b) => a + b, 0) / nums.length);
            if (func === 'min') return fnum(Math.min(...nums));
            if (func === 'max') return fnum(Math.max(...nums));
        }
        if (type === 'date' || type === 'datetime' || type === 'period' || field === 'last_modified') {
            const aggDateFmt = resolveFieldFormat(getFieldConfig(schema, field), localeSettings);
            const formatAggDate = (d) => formatDate(d, { dateFormat: aggDateFmt.dateFormat, type: 'date', locale: aggDateFmt.dateLocale });
            if (type === 'period') {
                // earliest = min start, latest = max end
                if (func === 'earliest') {
                    const dates = values.map(v => new Date(parsePeriod(v).start)).filter(d => !isNaN(d));
                    return dates.length ? formatAggDate(new Date(Math.min(...dates))) : '-';
                }
                if (func === 'latest') {
                    const dates = values.map(v => {
                        const period = parsePeriod(v);
                        return new Date(period.end || period.start);
                    }).filter(d => !isNaN(d));
                    return dates.length ? formatAggDate(new Date(Math.max(...dates))) : '-';
                }
            } else {
                const dates = values.map(v => new Date(v)).filter(d => !isNaN(d));
                if (dates.length === 0) return '-';
                if (func === 'earliest') return formatAggDate(new Date(Math.min(...dates)));
                if (func === 'latest') return formatAggDate(new Date(Math.max(...dates)));
            }
        }
        return values.length;
    };

    // ---- RENDER A ROW (parent or child note) ----
    // `rootRowId` propagates the root note's id through recursion: all
    // `<tr>`s from the same root (parent + expanded children + new-subitem)
    // carry `data-row-id={rootRowId}`. This lets the `measureElement`
    // of the virtualizer sum their actual heights, to know the space
    // taken up by the full expansion, not just the parent.
    // Renders a single `<tr>` (root or child). For 1:1 virtualization
    // between virtual items and `<tr>`, this function does NOT render either the
    // recursion into children nor the new-subitem form: these are generated
    // as separate descriptors (see `rowDescriptors` further below) and
    // have their own renderers.
    const renderRow = (note, isChild = false, depth = 0, rowPath = '0', virtualItem = null) => {
        const hasChildren = (childrenMap[note.id]?.length > 0);
        const isExpanded = expandedRows.has(note.id);
        // The title is a navigable cell of the grid (col 0): cursor state
        // and of the inline editor.
        const titleSel = getCellSelState(note.id, 'title');
        const isEditingTitle = editingCell?.rowId === note.id && editingCell?.field === 'title';
        const selectTitleCell = (e) => {
            if (e.shiftKey && activeCell) {
                if (!anchorCell) setAnchorCell(activeCell);
                setActiveCell({ rowId: note.id, field: 'title' });
                return;
            }
            setActiveCell({ rowId: note.id, field: 'title' });
            setAnchorCell(null);
        };
        // Opens the inline title editor (parallel to `openEditor` for
        // metadata cells). The title lives in note.title → originalMetaKey
        // 'title' and has its own write path (saveTitle).
        const openTitleEditor = () => {
            titlePreviewRef.current?.close(); // don't cover the input with the pop-up
            setEditInitial(null);
            setActiveCell({ rowId: note.id, field: 'title' });
            setAnchorCell(null);
            setEditingCell({ rowId: note.id, field: 'title', originalMetaKey: 'title' });
        };

        return (
            <tr
                key={`${note.id || 'note'}-${rowPath}`}
                data-index={virtualItem?.index}
                ref={virtualItem ? rowVirtualizer.measureElement : undefined}
                className={`border-b border-[var(--border-primary)] hover:bg-[var(--bg-secondary)] cursor-pointer transition-colors group/row
                    ${isListView ? 'border-b-0 group' : ''}
                    ${isSelected(note.id) ? 'bg-indigo-500/10' : ''}
                    ${isChild ? 'bg-[var(--bg-secondary)]/30' : ''}
                `}
                onClick={() => { /* Row: selection via checkbox */ }}
                    onDoubleClick={() => onNoteSelect(note.id, { returnFocusId: note.id })}
                    draggable
                    onDragStart={(e) => {
                        // Don't hijack text selection inside inline editors.
                        if (editingCell || e.target.closest?.('input, textarea, button, a, label, select, [contenteditable="true"]')) {
                            e.preventDefault();
                            return;
                        }
                        // Same protocol as the sidebar: the canvas (page-card) and
                        // the editor (wikilink) already accept this type.
                        e.dataTransfer.setData('application/gnosi-note', JSON.stringify({ id: note.id, title: note.title }));
                        e.dataTransfer.effectAllowed = 'copy';
                    }}
                >
                    {/* Cell action */}
                    <td className={`w-10 px-2 sticky left-0 z-20 hover:z-50 text-center align-top pt-2.5 ${isSelected(note.id) ? 'bg-indigo-50 dark:bg-indigo-950' : isChild ? 'bg-[var(--bg-secondary)]' : 'bg-[var(--bg-primary)]'}`}>
                        <div className="flex items-center justify-center gap-0.5">
                            {/* Selection checkbox */}
                            <label
                                className={`cursor-pointer inline-flex items-center shrink-0 ${isSelected(note.id) || selectedIds.size > 0 ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100'}`}
                                onClick={(e) => e.stopPropagation()}
                            >
                                <input
                                    type="checkbox"
                                    checked={isSelected(note.id)}
                                    onChange={(e) => toggleSelect(note.id, e)}
                                    className="w-3.5 h-3.5 rounded border-[var(--border-primary)] text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                                />
                            </label>
                            <button
                                onClick={(e) => { e.stopPropagation(); onNoteSelect(note.id, { returnFocusId: note.id }); }}
                                className={`relative p-1 text-[var(--text-tertiary)] hover:text-indigo-600 transition-colors ${selectedIds.size > 0 ? 'hidden' : 'block'}`}
                                aria-label={t('common.open')}
                            >
                                <ExternalLink size={14} />
                                <span className="row-action-tooltip">{t('common.open')}<kbd>⌥O</kbd></span>
                            </button>
                            {hasOpenableResource(note) && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleOpenExternalResource(note);
                                    }}
                                    disabled={openingResourceId === note.id}
                                    className="relative p-1 text-[var(--text-tertiary)] hover:text-emerald-600 transition-colors"
                                    aria-label={t('table.open_resource_tooltip')}
                                >
                                    <LinkIcon size={14} />
                                    <span className="row-action-tooltip">{t('table.open_resource_tooltip')}<kbd>⌥R</kbd></span>
                                </button>
                            )}
                            {onOpenParallel && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); onOpenParallel(note.id); }}
                                    className="relative p-1 text-[var(--text-tertiary)] hover:text-purple-600 transition-colors opacity-60 hover:opacity-100"
                                    aria-label={t('table.open_parallel')}
                                >
                                    <Columns2 size={14} />
                                    <span className="row-action-tooltip">{t('table.open_parallel')}<kbd>⌥P</kbd></span>
                                </button>
                            )}
                            {!isListView && tableFunctionalities.map((functionality) => {
                                const action = functionality.action || 'set_fields';
                                const gate = checkActionRequires(schema, note.metadata || {}, action, actionRules);
                                const buttonKey = `${note.id}_${functionality.id}`;
                                const isExecuting = executingButtonKey === buttonKey;
                                const Icon = isExecuting ? Loader2 : action === 'translate_row' ? Languages : action === 'ai_prompt' ? Sparkles : Zap;
                                const label = functionality.label || t('schema.functionality_default_label', 'Functionality');
                                return (
                                    <button
                                        key={functionality.id}
                                        type="button"
                                        onClick={(event) => {
                                            if (!gate.ok || isExecuting) return;
                                            executeTableFunctionality(event, note, functionality);
                                        }}
                                        disabled={!gate.ok || isExecuting}
                                        className={`relative p-1 transition-colors opacity-0 group-hover/row:opacity-100 ${gate.ok ? 'text-[var(--text-tertiary)] hover:text-[var(--gnosi-primary)]' : 'text-[var(--text-tertiary)]/40 cursor-not-allowed'}`}
                                        aria-label={gate.ok ? label : gate.reason}
                                    >
                                        <Icon size={14} className={isExecuting ? 'animate-spin' : ''} />
                                        <span className="row-action-tooltip">{gate.ok ? label : gate.reason}</span>
                                    </button>
                                );
                            })}
                            {!hasTranslateFunctionality && isTranslatableTable && !isListView && !note.metadata?.translation_lang && (() => {
                                // action_rules safeguard: button VISIBLE but
                                // disabled with the reason (e.g. drafts),
                                // instead of hiding it. The backend revalidates (409).
                                const gate = checkActionRequires(schema, note.metadata || {}, 'translate_row', actionRules);
                                return (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if (!gate.ok) return;
                                            // Reuses the same flow as the `button` field:
                                            // opens TranslateLanguagesModal in row mode (subitems).
                                            setPendingAction({
                                                noteId: note.id,
                                                fieldConfig: { button_action: 'translate_row' },
                                                action: 'translate_row',
                                            });
                                        }}
                                        disabled={!gate.ok}
                                        className={`relative p-1 transition-colors opacity-0 group-hover/row:opacity-100 ${gate.ok ? 'text-[var(--text-tertiary)] hover:text-[var(--gnosi-primary)]' : 'text-[var(--text-tertiary)]/40 cursor-not-allowed'}`}
                                        aria-label={gate.ok ? t('table.translate_row', "Translate") : gate.reason}
                                    >
                                        <Languages size={14} />
                                        <span className="row-action-tooltip">{gate.ok ? t('table.translate_row', "Translate") : gate.reason}</span>
                                    </button>
                                );
                            })()}
                            {isDrupalSyncTable && !isListView && !note.metadata?.translation_lang && (() => {
                                const gate = checkActionRequires(schema, note.metadata || {}, 'sync_drupal', actionRules);
                                const label = note.metadata?.drupal_uuid ? t('table.sync_drupal_update', "Update on Drupal") : t('table.sync_drupal', "Sync with Drupal");
                                return (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if (!gate.ok) return;
                                            setPendingAction({
                                                noteId: note.id,
                                                fieldConfig: { button_action: 'sync_drupal' },
                                                action: 'sync_drupal',
                                            });
                                        }}
                                        disabled={!gate.ok}
                                        className={`relative p-1 transition-colors opacity-0 group-hover/row:opacity-100 ${gate.ok ? 'text-[var(--text-tertiary)] hover:text-[var(--gnosi-primary)]' : 'text-[var(--text-tertiary)]/40 cursor-not-allowed'}`}
                                        aria-label={gate.ok ? label : gate.reason}
                                    >
                                        <Globe size={14} className={note.metadata?.drupal_uuid && gate.ok ? 'text-[var(--gnosi-primary)]' : ''} />
                                        <span className="row-action-tooltip">{gate.ok ? label : gate.reason}</span>
                                    </button>
                                );
                            })()}
                            {isSocialPublishTable && !isListView && !note.metadata?.translation_lang && (() => {
                                const gate = checkActionRequires(schema, note.metadata || {}, 'publish_social', actionRules);
                                return (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if (!gate.ok) return;
                                            setPendingAction({
                                                noteId: note.id,
                                                action: 'publish_social',
                                            });
                                        }}
                                        disabled={!gate.ok}
                                        className={`relative p-1 transition-colors opacity-0 group-hover/row:opacity-100 ${gate.ok ? 'text-[var(--text-tertiary)] hover:text-[var(--gnosi-primary)]' : 'text-[var(--text-tertiary)]/40 cursor-not-allowed'}`}
                                        aria-label={gate.ok ? t('table.publish_social', "Publish to social") : gate.reason}
                                    >
                                        <Send size={14} />
                                        <span className="row-action-tooltip">{gate.ok ? t('table.publish_social', "Publish to social") : gate.reason}</span>
                                    </button>
                                );
                            })()}
                            {isLlmWikiTable && !note.metadata?.translation_lang && (() => {
                                const persistedJob = llmWikiJobs?.[llmWikiTableId]?.[note.id] || null;
                                const manifestTimestamp = llmWikiConfig?.processed_resources?.[llmWikiTableId]?.[note.id];
                                const processed = note.metadata?.['Processat pel Cervell']
                                    || note.metadata?.['processat pel cervell']
                                    || manifestTimestamp;
                                const running = Boolean(persistedJob?.running);
                                const retryable = ['partial', 'error'].includes(persistedJob?.phase);
                                // Keep the action available for every configured source row. The
                                // backend reads the durable row data and can resume an interrupted
                                // job even when this client has a stale or incomplete field schema.
                                const ok = !running;
                                const processedLabel = typeof processed === 'number'
                                    ? new Date(processed * 1000).toLocaleDateString(i18n.language)
                                    : processed;
                                const label = running
                                    ? t('table.process_resource_running', "Processing…")
                                    : !ok
                                    ? t('table.process_resource_no_source', "This resource has no configured attachment or URL")
                                    : retryable
                                    ? t('table.reprocess_resource_error', "Resume interrupted processing")
                                    : !processed
                                    ? t('table.process_resource', "Process resource (Brain)")
                                    : t('table.reprocess_resource', "Reprocess resource (processed on {{date}})", { date: processedLabel });
                                return (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if (!ok) return;
                                            setPendingAction({
                                                noteId: note.id,
                                                action: 'process_resource',
                                                sourceTableId: llmWikiTableId,
                                                force: Boolean(processed) || retryable,
                                            });
                                        }}
                                        disabled={!ok}
                                        className={`relative p-1 transition-colors opacity-0 group-hover/row:opacity-100 ${ok ? 'text-[var(--text-tertiary)] hover:text-[var(--gnosi-primary)]' : 'text-[var(--text-tertiary)]/40 cursor-not-allowed'}`}
                                        aria-label={label}
                                    >
                                        <BrainCircuit size={14} />
                                        <span className="row-action-tooltip">{label}</span>
                                    </button>
                                );
                            })()}
                            {!isListView && onDeletePage && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onDeletePage(note.id, note.title);
                                    }}
                                    className="relative p-1 text-[var(--text-tertiary)] hover:text-red-500 transition-colors opacity-0 group-hover/row:opacity-100"
                                    aria-label={t('table.delete')}
                                >
                                    <Trash2 size={14} />
                                    <span className="row-action-tooltip">{t('table.delete')}<kbd>⌘⌫</kbd></span>
                                </button>
                            )}
                        </div>
                    </td>

                    <td
                        data-title-cell={note.id}
                        tabIndex={-1}
                        style={{ width: columnWidths['title'] || 250, maxWidth: columnWidths['title'] || 250 }}
                        className={`${rowPadClass} px-4 font-medium text-[var(--text-primary)] sticky left-10 z-30 overflow-hidden align-top
                            ${titleSel.inRange && !titleSel.isActive ? 'bg-[var(--gnosi-primary)]/10' : isSelected(note.id) ? 'bg-indigo-50 dark:bg-indigo-950' : isChild ? 'bg-[var(--bg-secondary)]' : 'bg-[var(--bg-primary)]'}
                            ${isListView ? 'group-hover:bg-[var(--bg-secondary)]' : 'border-r border-[var(--border-primary)] shadow-[2px_0_5px_-2px_rgba(0,0,0,0.02)]'}
                            ${titleSel.isActive ? 'shadow-[inset_0_0_0_2px_var(--gnosi-primary)]' : ''}`}
                        onClick={(e) => {
                            e.stopPropagation();
                            // Same model as the rest of the cells: clicking the
                            // already-active cell (without Shift) opens the inline title editor; otherwise,
                            // it just moves the cursor. Opening the record = buttons on the left
                            // or Alt+O (no longer click/double-click on the title).
                            const alreadyActive = !e.shiftKey && activeCell && activeCell.rowId === note.id && activeCell.field === 'title';
                            if (alreadyActive) { openTitleEditor(); return; }
                            selectTitleCell(e);
                        }}
                        onDoubleClick={(e) => { e.stopPropagation(); openTitleEditor(); }}
                    >
                        <div className="flex items-center gap-1.5">
                            {note.metadata?.translation_lang && (!hasVisibleLanguageColumn || note.metadata?.translation_stale) && (
                                <span
                                    className={`shrink-0 inline-flex items-center gap-0.5 px-1 py-px rounded text-[9px] font-bold uppercase ${note.metadata?.translation_stale ? 'bg-amber-500/15 text-amber-600' : 'bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)]'}`}
                                    title={note.metadata?.translation_stale
                                        ? t('table.translation_stale', "The original changed — re-translate to update")
                                        : t('table.translation_badge', "Translation")}
                                >
                                    {note.metadata?.translation_stale && <AlertTriangle size={9} />}
                                    {!hasVisibleLanguageColumn && String(note.metadata.translation_lang).toUpperCase()}
                                </span>
                            )}
                            {isChild && (
                                <div className="flex shrink-0" style={{ width: depth * 20 }}>
                                    <div className="flex-1" />
                                    <span className="w-5 flex items-center justify-center text-[var(--text-tertiary)]">└</span>
                                </div>
                            )}

                            {enableSubitems && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setExpandedRows(prev => {
                                            const next = new Set(prev);
                                            if (next.has(note.id)) next.delete(note.id);
                                            else next.add(note.id);
                                            return next;
                                        });
                                    }}
                                    className={`p-0.5 rounded transition-colors shrink-0 ${hasChildren ? 'text-[var(--text-tertiary)] hover:text-indigo-600 hover:bg-indigo-500/10' : 'text-transparent pointer-events-none'}`}
                                    title={hasChildren ? (isExpanded ? t('table.collapse_subitems') : t('table.expand_subitems')) : ''}
                                >
                                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                </button>
                            )}

                            <IconRenderer icon={note.metadata?.icon} size={16} />
                            {isEditingTitle ? (
                                <input
                                    autoFocus
                                    defaultValue={editInitial != null ? editInitial : (note.title ?? '')}
                                    onClick={(e) => e.stopPropagation()}
                                    onDoubleClick={(e) => e.stopPropagation()}
                                    onBlur={(e) => saveTitle(note.id, e.target.value)}
                                    onKeyDown={(e) => {
                                        e.stopPropagation();
                                        if (e.key === 'Enter') { e.preventDefault(); saveTitle(note.id, e.target.value); advanceCursorAfterEdit(note.id, 'title'); return; }
                                        if (e.key === 'Escape') { e.preventDefault(); setEditingCell(null); setEditInitial(null); return; }
                                    }}
                                    className="flex-1 min-w-0 px-1 py-0.5 text-sm border border-[var(--border-primary)] rounded focus:outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] font-medium"
                                />
                            ) : (
                                <span className="truncate flex-1" {...titlePreview.getTitleProps(note.id)}>{note.title}</span>
                            )}

                            {enableSubitems && hasChildren && !isExpanded && (
                                <span className="ml-1 px-1.5 py-0.5 text-[10px] font-semibold bg-[var(--gnosi-primary)]/20 text-[var(--gnosi-primary)] rounded-full shrink-0">
                                    {childrenMap[note.id].length}
                                </span>
                            )}

                            {!isListView && enableSubitems && onCreateRecord && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setExpandedRows(prev => new Set([...prev, note.id]));
                                        setAddingSubitemFor(note.id);
                                        setNewSubitemTitle('');
                                    }}
                                    className="opacity-0 group-hover/row:opacity-100 ml-1 p-0.5 rounded text-[var(--text-tertiary)] hover:text-indigo-600 hover:bg-indigo-500/10 transition-all shrink-0"
                                    title={t('table.add_subitem')}
                                >
                                    <Plus size={12} />
                                </button>
                            )}
                        </div>
                    </td>

                    {dynamicColumns.map(([key, type]) => {
                        const originalMetaKey = getMetaKey(note, key);
                        const val = note.metadata?.[originalMetaKey];
                        const isCheckbox = type === 'checkbox';
                        // Same "checked" logic as the render: truthy, but without
                        // confusing the string 'false' with a truthy value.
                        const checkboxChecked = !!val && val !== 'false';
                        const toggleCheckbox = () => handleCellSave(note.id, key, !checkboxChecked, originalMetaKey);
                        const sel = getCellSelState(note.id, key);
                        // Click = places the cursor (selects); second click / double-click /
                        // Enter / typing = edit. This way ⌘C copies the cell, not an input's text.
                        const selectCell = () => { setActiveCell({ rowId: note.id, field: key }); setAnchorCell(null); };
                        const openEditor = () => { setEditInitial(null); setActiveCell({ rowId: note.id, field: key }); setAnchorCell(null); setEditingCell({ rowId: note.id, field: key, originalMetaKey }); };
                        return (
                            <td
                                key={key}
                                style={{ width: columnWidths[key] || 180, maxWidth: columnWidths[key] || 180 }}
                                className={`${rowPadClass} px-4 overflow-hidden truncate text-[var(--text-primary)] align-top ${sel.inRange ? 'bg-[var(--gnosi-primary)]/10' : 'hover:bg-[var(--bg-tertiary)]/50'} ${sel.isActive ? 'shadow-[inset_0_0_0_2px_var(--gnosi-primary)]' : ''}`}
                                tabIndex={isCheckbox ? 0 : undefined}
                                onKeyDown={isCheckbox ? (e) => {
                                    if (e.key === ' ' || e.key === 'Enter') {
                                        e.preventDefault();
                                        toggleCheckbox();
                                    }
                                } : undefined}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    // Shift+click extends the rectangular selection from the active cell.
                                    if (e.shiftKey && activeCell) {
                                        if (!anchorCell) setAnchorCell(activeCell);
                                        setActiveCell({ rowId: note.id, field: key });
                                        return;
                                    }
                                    if (isCheckbox) { selectCell(); toggleCheckbox(); return; }
                                    const fieldType = getFieldType(schema, key);
                                    if (isComputedType(fieldType)) { selectCell(); return; }
                                    if (isImageField(key, fieldType)) { selectCell(); openMediaPicker(note, key, fieldType); return; }
                                    const alreadyActive = activeCell && activeCell.rowId === note.id && activeCell.field === key;
                                    if (alreadyActive) openEditor();
                                    else selectCell();
                                }}
                                onDoubleClick={(e) => {
                                    e.stopPropagation();
                                    if (isCheckbox) { toggleCheckbox(); return; }
                                    const fieldType = getFieldType(schema, key);
                                    if (isComputedType(fieldType)) return;
                                    if (isImageField(key, fieldType)) { selectCell(); openMediaPicker(note, key, fieldType); return; }
                                    openEditor();
                                }}
                            >
                                {renderCellContent(
                                    getCalculatedFieldValue(key, note, val),
                                    type,
                                    note.id,
                                    key,
                                    originalMetaKey,
                                )}
                            </td>
                        );
                    })}

                    {showModifiedColumn && (
                        <td
                            style={{ width: columnWidths['last_modified'] || 150, maxWidth: columnWidths['last_modified'] || 150 }}
                            className={`${rowPadClass} px-4 text-[var(--text-tertiary)] flex items-center gap-1.5 overflow-hidden truncate align-top ${isListView ? '' : 'border-l border-[var(--border-primary)]'}`}
                        >
                            <Clock size={14} className="shrink-0" />
                            <span className="truncate">{new Date(note.last_modified).toLocaleDateString(i18n.language)}</span>
                        </td>
                    )}
            </tr>
        );
    };

    // Renders the `<tr>` of the "new subitem" form. It is a descriptor
    // virtual, independent from its parent; this way the virtualizer stays 1:1
    // with the `<tr>`s.
    const renderNewSubitemRow = (parentNote, depth = 1, virtualItem = null) => (
        <tr
            key={`new-sub-${parentNote.id}`}
            data-index={virtualItem?.index}
            ref={virtualItem ? rowVirtualizer.measureElement : undefined}
            className="border-b border-[var(--border-primary)] bg-indigo-500/5"
        >
            <td className="w-10 sticky left-0 z-20 bg-[var(--bg-primary)]" />
            <td
                style={{ width: columnWidths['title'] || 250, maxWidth: columnWidths['title'] || 250 }}
                className="py-1.5 px-4 sticky left-10 z-20 bg-[var(--bg-primary)] border-r border-[var(--border-primary)]"
            >
                <div className="flex items-center gap-2" style={{ marginLeft: depth * 20 }}>
                    <input
                        ref={subitemInputRef}
                        type="text"
                        placeholder={t('table.subitem_name_placeholder')}
                        value={newSubitemTitle}
                        onChange={(e) => setNewSubitemTitle(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') handleCreateSubitem(parentNote.id);
                            if (e.key === 'Escape') {
                                setAddingSubitemFor(null);
                                setNewSubitemTitle('');
                            }
                        }}
                        className="flex-1 px-2 py-1 text-sm border border-[var(--border-primary)] rounded focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-sm"
                    />
                    <button
                        onClick={() => handleCreateSubitem(parentNote.id)}
                        className="px-2 py-1 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700 transition-colors shrink-0 font-medium"
                    >
                        {t('common.create')}
                    </button>
                    <button
                        onClick={() => { setAddingSubitemFor(null); setNewSubitemTitle(''); }}
                        className="p-1 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
                    >
                        <X size={14} />
                    </button>
                </div>
            </td>
            {dynamicColumns.map(([key]) => (
                <td key={key} style={{ width: columnWidths[key] || 180 }} className="py-1.5 px-4" />
            ))}
            {showModifiedColumn && (
                <td style={{ width: columnWidths['last_modified'] || 150 }} className="py-1.5 px-4 border-l border-[var(--border-primary)]" />
            )}
        </tr>
    );

    // Keyboard navigation FROM a group header (separated mode):
    //   ↑/↓   → previous/next header
    //   Enter → toggles collapsed; if left expanded, cursor to the first row
    //   →     → if expanded, cursor on the first row (cell mode, no collapsing)
    //   Esc   → removes focus (returns to cell mode with an empty cursor)
    // Doesn't affect the grid's global listener: the button does preventDefault +
    // stopPropagation and the `defaultPrevented` guard of the window-keydown exits.
    const handleGroupHeaderKeyDown = (e, d) => {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        switch (e.key) {
            case 'ArrowUp':
                e.preventDefault(); e.stopPropagation();
                if (!focusGroupHeaderByOffset(d.descriptorIndex ?? e.currentTarget.dataset.di, -1)) {
                    onExitTopRef.current?.();
                }
                break;
            case 'ArrowDown':
                e.preventDefault(); e.stopPropagation();
                focusGroupHeaderByOffset(d.descriptorIndex, 1);
                break;
            case 'ArrowRight':
            case 'Enter': {
                e.preventDefault(); e.stopPropagation();
                const wasCollapsed = !expandedGroups.has(d.groupKey);
                toggleGroup(d.groupKey);
                if (wasCollapsed) {
                    // The cursor on the first row is delayed until the re-render (the
                    // rows descriptor only exists when the group is open).
                    pendingEnterGroupDescRef.current = d.descriptorIndex;
                } else {
                    focusFirstRowOfGroup(d.descriptorIndex);
                }
                break;
            }
            case 'Escape':
                e.preventDefault(); e.stopPropagation();
                e.currentTarget.blur();
                break;
            default: break;
        }
    };

    // Group header (row grouping): a virtual `<tr>` with a single
    // cell with `colSpan` spanning the whole table. The content (chevron +
    // color dot + name + counter) goes inside a `<div sticky left-0>` so that
    // it stays visible when scrolling horizontally, like the title column.
    const renderGroupHeader = (d, virtualItem) => {
        const collapsed = !expandedGroups.has(d.groupKey);
        return (
            <tr
                key={`group-${d.groupKey}-${virtualItem.index}`}
                data-index={virtualItem.index}
                ref={rowVirtualizer.measureElement}
                className="border-b border-[var(--border-primary)] bg-[var(--bg-primary)]"
            >
                <td colSpan={dynamicColumns.length + 3} className="p-0 bg-[var(--bg-primary)]">
                    <div className="sticky left-0 z-10 inline-flex items-center w-max max-w-[calc(100vw-2rem)]">
                        <button
                            type="button"
                            tabIndex={0}
                            onClick={() => toggleGroup(d.groupKey)}
                            onKeyDown={(e) => handleGroupHeaderKeyDown(e, { ...d, descriptorIndex: virtualItem.index })}
                            className="flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--bg-tertiary)] transition-colors w-full outline-none focus-visible:ring-1 focus-visible:ring-[var(--gnosi-primary)]"
                            title={collapsed ? t('common.expand', "Expand") : t('common.collapse', "Collapse")}
                        >
                            {collapsed
                                ? <ChevronRight size={15} className="text-[var(--text-tertiary)] shrink-0" />
                                : <ChevronDown size={15} className="text-[var(--text-tertiary)] shrink-0" />}
                            {d.colorHex && <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: d.colorHex }} />}
                            <span className="text-xs font-bold text-[var(--text-primary)] truncate">{d.label}</span>
                            <span className="text-[10px] font-semibold text-[var(--text-tertiary)] bg-[var(--bg-primary)] px-1.5 py-0.5 rounded-full border border-[var(--border-primary)]/60 shrink-0">{d.count}</span>
                        </button>
                    </div>
                </td>
            </tr>
        );
    };

    // Group footer: per-column subtotals computed over the group's notes,
    // with the SAME aggregations the user chose in the table footer.
    const renderGroupFooter = (d, virtualItem) => {
        const aggCell = (field, type) => {
            const func = aggregations[field];
            if (!func || func === 'none') return null;
            const val = calculateAggregation(field, type, d.notes);
            return (
                <span className="inline-flex items-center gap-1">
                    <span className="text-[9px] uppercase tracking-wide text-[var(--text-tertiary)]">{t(`table.${func}`, func)}</span>
                    <span className="text-[var(--text-primary)] font-bold">{val}</span>
                </span>
            );
        };
        return (
            <tr
                key={`gfoot-${d.groupKey}-${virtualItem.index}`}
                data-index={virtualItem.index}
                ref={rowVirtualizer.measureElement}
                className="border-b border-[var(--border-primary)] bg-[var(--bg-primary)] text-[11px] text-[var(--text-secondary)]"
            >
                <td className="w-10 sticky left-0 bg-[var(--bg-secondary)] z-20 border-r border-[var(--border-primary)]"></td>
                <td className="py-1.5 px-4 sticky left-10 bg-[var(--bg-secondary)] z-20 border-r border-[var(--border-primary)] shadow-[2px_0_5px_-2px_rgba(0,0,0,0.02)]">
                    {aggCell('title', 'title')}
                </td>
                {dynamicColumns.map(([key, type]) => (
                    <td key={key} className="py-1.5 px-4 border-r border-[var(--border-primary)]">
                        {aggCell(key, type)}
                    </td>
                ))}
                {showModifiedColumn && (
                    <td className="py-1.5 px-4 border-l border-[var(--border-primary)]">
                        {aggCell('last_modified', 'date')}
                    </td>
                )}
            </tr>
        );
    };

    return (
        <div className={`w-full ${maxHeight ? '' : 'h-full overflow-hidden'} ${isEmbedded ? '' : 'bg-[var(--bg-primary)]'}`}>
            <div className={`w-full ${maxHeight ? '' : 'h-full'} flex flex-col`}>
                {selectedIds.size > 0 && (
                    <VaultBulkActionsBar
                        selectedIds={selectedIds}
                        totalCount={sortedNotes.length}
                        onSelectAll={() => selectAll(sortedNotes.map(n => n.id))}
                        onClearSelection={clearSelection}
                        onDeleteSelected={(onDeleteSelected || onDeletePage) ? handleBulkDelete : null}
                        templates={templates}
                        onApplyTemplate={onApplyTemplate ? handleApplyTemplate : null}
                    />
                )}

                {/* `maxHeight`: adaptive mode (embed). The scroller takes the height
                    of the content and only scrolls once it exceeds the maximum — 
                    virtualization keeps working because max-height is a real
                    bound. Without `maxHeight` (full-screen table)
                    `flex-1` is used to fill the parent's height. */}
                <div
                    ref={tableContainerRef}
                    data-vault-table-scroll
                    onPointerDownCapture={claimKeyboard}
                    style={maxHeight ? { maxHeight } : undefined}
                    className={`bg-[var(--bg-primary)] overflow-auto custom-scrollbar ${maxHeight ? '' : 'flex-1'} ${isEmbedded ? `${activeCell ? 'ring-1 ring-[var(--gnosi-primary)]/30' : ''} transition-all` : 'border-none shadow-none'} ${isListView ? 'border-none shadow-none' : ''}`}>

                    {/* DndContext/SortableContext render no DOM: the table markup
                        stays valid. Only the header cells register as sortables;
                        the native HTML5 drag of the rows (application/gnosi-note)
                        is untouched because dnd-kit sensors only listen on the
                        header handles. */}
                    <DndContext
                        sensors={columnDndSensors}
                        collisionDetection={closestCenter}
                        onDragEnd={handleColumnDragEnd}
                        onDragCancel={suppressNextHeaderClick}
                    >
                    <SortableContext items={columnSortableIds} strategy={horizontalListSortingStrategy}>
                    <table className="text-left text-sm text-[var(--text-secondary)] whitespace-nowrap" style={{ tableLayout: 'fixed', width: 'max-content' }}>
                        {!isListView && (
                            <thead className="bg-[var(--bg-primary)] text-[var(--text-secondary)] font-semibold select-none group/table sticky top-0 z-40">
                                <tr>
                                    <th className="w-10 px-2 sticky left-0 bg-[var(--bg-primary)] z-40 border-r border-[var(--border-primary)]">
                                        <div className="flex items-center justify-center">
                                            <label className="cursor-pointer inline-flex items-center" onClick={(e) => e.stopPropagation()}>
                                                <input
                                                    type="checkbox"
                                                    checked={selectedIds.size === sortedNotes.length && sortedNotes.length > 0}
                                                    ref={el => { if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < sortedNotes.length; }}
                                                    onChange={(e) => {
                                                        if (e.target.checked) selectAll(sortedNotes.map(n => n.id));
                                                        else clearSelection();
                                                    }}
                                                    className="w-3.5 h-3.5 rounded border-[var(--border-primary)] text-[var(--gnosi-primary)] focus:ring-[var(--gnosi-primary)] cursor-pointer"
                                                />
                                            </label>
                                        </div>
                                    </th>
                                    {(() => {
                                        const titleKey = Object.entries(schema || {}).find(([, t]) => t === 'title')?.[0] || 'title';
                                        const titleDesc = getFieldConfig(schema, titleKey)?.description;
                                        const isTitleHelpOpen = !!openHeaderHelp[titleKey];
                                        return (
                                            <th
                                                style={{ width: columnWidths['title'] || 250 }}
                                                className="py-3 px-4 sticky left-10 bg-[var(--bg-secondary)] z-40 border-r border-[var(--border-primary)] shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)] hover:bg-[var(--bg-tertiary)] transition-colors group relative"
                                            >
                                                <div className="flex items-center justify-between cursor-pointer overflow-hidden text-[var(--text-secondary)]" onClick={() => handleSort('title')}>
                                                    <div className="flex items-center gap-1.5 truncate">
                                                        <span className="truncate">{titleKey === 'title' ? t('table.note_name') : titleKey}</span>
                                                        {titleDesc && (
                                                            <button
                                                                type="button"
                                                                aria-expanded={isTitleHelpOpen}
                                                                aria-label={t('schema.toggle_description', 'Toggle field description')}
                                                                title={titleDesc}
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setOpenHeaderHelp((prev) => ({ ...prev, [titleKey]: !prev[titleKey] }));
                                                                }}
                                                                className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[9px] font-bold leading-none transition-colors ${
                                                                    isTitleHelpOpen
                                                                        ? 'border-[var(--gnosi-primary)] bg-[var(--gnosi-primary)] text-white'
                                                                        : 'border-[var(--border-primary)] text-[var(--text-tertiary)] hover:border-[var(--gnosi-primary)] hover:text-[var(--gnosi-primary)]'
                                                                }`}
                                                            >
                                                                ?
                                                            </button>
                                                        )}
                                                    </div>
                                                    {activeSort.field === 'title' && (
                                                        activeSort.direction === 'asc' ? <ArrowUp size={14} className="text-indigo-500 shrink-0" /> : <ArrowDown size={14} className="text-indigo-500 shrink-0" />
                                                    )}
                                                </div>
                                                {isTitleHelpOpen && titleDesc && (
                                                    <div
                                                        className="absolute left-0 top-full z-[100] mt-1 w-64 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] p-2.5 shadow-xl text-xs font-normal text-[var(--text-secondary)] normal-case whitespace-normal leading-relaxed animate-in fade-in zoom-in-95 duration-150 cursor-default"
                                                        onClick={(e) => e.stopPropagation()}
                                                    >
                                                        <div className="font-semibold text-[var(--text-primary)] mb-1 flex items-center justify-between">
                                                            <span>{titleKey}</span>
                                                            <button
                                                                type="button"
                                                                onClick={() => setOpenHeaderHelp((prev) => ({ ...prev, [titleKey]: false }))}
                                                                className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] text-xs px-1"
                                                            >
                                                                ✕
                                                            </button>
                                                        </div>
                                                        <p>{titleDesc}</p>
                                                    </div>
                                                )}
                                                <div
                                                    className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-[var(--gnosi-primary)]/40 opacity-0 group-hover/table:opacity-100 z-30 transition-opacity"
                                                    onMouseDown={(e) => handleMouseDown(e, 'title')}
                                                />
                                            </th>
                                        );
                                    })()}
                                    {dynamicColumns.map(([key, type]) => {
                                        const fieldCfg = getFieldConfig(schema, key);
                                        const desc = fieldCfg?.description;
                                        const isHelpOpen = !!openHeaderHelp[key];
                                        return (
                                            <SortableColumnTh
                                                key={key}
                                                id={key}
                                                disabled={!canReorderColumns}
                                                width={columnWidths[key] || 180}
                                                className="py-3 px-4 hover:bg-[var(--bg-tertiary)] transition-colors group relative border-r border-[var(--border-primary)]"
                                                handleClassName={`flex items-center gap-1.5 justify-between overflow-hidden text-[var(--text-secondary)] ${canReorderColumns ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}`}
                                                onHeaderClick={() => {
                                                    if (columnDragJustEndedRef.current) return;
                                                    handleSort(key);
                                                }}
                                                resizeHandle={
                                                    <div
                                                        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-[var(--gnosi-primary)]/40 opacity-0 group-hover/table:opacity-100 z-30 transition-opacity"
                                                        onMouseDown={(e) => handleMouseDown(e, key)}
                                                    />
                                                }
                                            >
                                                <div className="flex items-center gap-1.5 truncate">
                                                    {type === 'checkbox' && <CheckSquare size={14} className="text-[var(--text-tertiary)] shrink-0" />}
                                                    {type === 'date' && <Calendar size={14} className="text-[var(--text-tertiary)] shrink-0" />}
                                                    {(type === 'status' || type === 'select') && <Type size={14} className="text-[var(--text-tertiary)] shrink-0" />}
                                                    {(type === 'multi_select' || type === 'relation') && <Tag size={14} className="text-[var(--text-tertiary)] shrink-0" />}
                                                    <span className="truncate">{key}</span>
                                                    {desc && (
                                                        <button
                                                            type="button"
                                                            aria-expanded={isHelpOpen}
                                                            aria-label={t('schema.toggle_description', 'Toggle field description')}
                                                            title={desc}
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setOpenHeaderHelp((prev) => ({ ...prev, [key]: !prev[key] }));
                                                            }}
                                                            className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[9px] font-bold leading-none transition-colors ${
                                                                isHelpOpen
                                                                    ? 'border-[var(--gnosi-primary)] bg-[var(--gnosi-primary)] text-white'
                                                                    : 'border-[var(--border-primary)] text-[var(--text-tertiary)] hover:border-[var(--gnosi-primary)] hover:text-[var(--gnosi-primary)]'
                                                            }`}
                                                        >
                                                            ?
                                                        </button>
                                                    )}
                                                </div>
                                                {activeSort.field === key && (
                                                    activeSort.direction === 'asc' ? <ArrowUp size={14} className="text-indigo-500 shrink-0" /> : <ArrowDown size={14} className="text-indigo-500 shrink-0" />
                                                )}
                                                {isHelpOpen && desc && (
                                                    <div
                                                        className="absolute left-0 top-full z-[100] mt-1 w-64 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] p-2.5 shadow-xl text-xs font-normal text-[var(--text-secondary)] normal-case whitespace-normal leading-relaxed animate-in fade-in zoom-in-95 duration-150 cursor-default"
                                                        onClick={(e) => e.stopPropagation()}
                                                    >
                                                        <div className="font-semibold text-[var(--text-primary)] mb-1 flex items-center justify-between">
                                                            <span>{key}</span>
                                                            <button
                                                                type="button"
                                                                onClick={() => setOpenHeaderHelp((prev) => ({ ...prev, [key]: false }))}
                                                                className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] text-xs px-1"
                                                            >
                                                                ✕
                                                            </button>
                                                        </div>
                                                        <p>{desc}</p>
                                                    </div>
                                                )}
                                            </SortableColumnTh>
                                        );
                                    })}
                                    {showModifiedColumn && (
                                        <th
                                            style={{ width: columnWidths['last_modified'] || 150 }}
                                            className="py-3 px-4 hover:bg-[var(--bg-tertiary)] transition-colors group relative border-l border-[var(--border-primary)] text-[var(--text-secondary)]"
                                        >
                                            <div className="flex items-center justify-between cursor-pointer overflow-hidden" onClick={() => handleSort('last_modified')}>
                                                <span className="truncate">{t('table.modification')}</span>
                                                {activeSort.field === 'last_modified' && (
                                                    activeSort.direction === 'asc' ? <ArrowUp size={14} className="text-indigo-500 shrink-0" /> : <ArrowDown size={14} className="text-indigo-500 shrink-0" />
                                                )}
                                            </div>
                                            <div
                                                className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-[var(--gnosi-primary)]/40 opacity-0 group-hover/table:opacity-100 z-30 transition-opacity"
                                                onMouseDown={(e) => handleMouseDown(e, 'last_modified')}
                                            />
                                        </th>
                                    )}
                                </tr>
                            </thead>
                        )}
                        <tbody>
                            {/* Top spacer for the virtualizer's padding. */}
                            {virtPaddingTop > 0 && (
                                <tr aria-hidden="true">
                                    <td colSpan={dynamicColumns.length + 3} style={{ height: virtPaddingTop, padding: 0, border: 0 }} />
                                </tr>
                            )}
                            {virtualRows.map(vi => {
                                const d = rowDescriptors[vi.index];
                                if (!d) return null;
                                if (d.kind === 'row') {
                                    return renderRow(d.note, d.isChild, d.depth, `${vi.index}`, vi);
                                }
                                if (d.kind === 'group-header') {
                                    return renderGroupHeader(d, vi);
                                }
                                if (d.kind === 'group-footer') {
                                    return renderGroupFooter(d, vi);
                                }
                                if (d.kind === 'new-subitem') {
                                    return renderNewSubitemRow(d.parentNote, d.depth, vi);
                                }
                                return null;
                            })}
                            {virtPaddingBottom > 0 && (
                                <tr aria-hidden="true">
                                    <td colSpan={dynamicColumns.length + 3} style={{ height: virtPaddingBottom, padding: 0, border: 0 }} />
                                </tr>
                            )}

                            {!isListView && (
                                <tr className="border-b border-[var(--border-primary)]/50 hover:bg-[var(--bg-secondary)]/80 transition-colors group/new-row h-10">
                                    <td className="w-10 sticky left-0 z-20 bg-[var(--bg-primary)] border-r border-[var(--border-primary)] py-2">
                                        <div className="flex items-center justify-center">
                                            <Plus size={14} className="text-[var(--text-tertiary)] group-focus-within/new-row:text-indigo-500" />
                                        </div>
                                    </td>
                                    <td
                                        style={{ width: columnWidths['title'] || 250, maxWidth: columnWidths['title'] || 250 }}
                                        className="py-1 px-4 sticky left-10 z-20 bg-[var(--bg-primary)] border-r border-[var(--border-primary)] shadow-[2px_0_5px_-2px_rgba(0,0,0,0.02)]"
                                    >
                                        <input
                                            ref={newRowInputRef}
                                            type="text"
                                            placeholder={t('table.new_record_placeholder')}
                                            value={newRowTitle}
                                            onChange={(e) => setNewRowTitle(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    handleCreateRowRecord();
                                                }
                                                if (e.key === 'Escape') {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    setNewRowTitle('');
                                                }
                                            }}
                                            className="w-full bg-transparent border-none outline-none text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:placeholder:text-[var(--text-secondary)] font-medium"
                                        />
                                    </td>
                                    {dynamicColumns.map(([key]) => (
                                        <td key={key} style={{ width: columnWidths[key] || 180 }} className="py-1 px-4 text-[var(--text-primary)]" />
                                    ))}
                                    {showModifiedColumn && (
                                        <td style={{ width: columnWidths['last_modified'] || 150 }} className="py-1 px-4 border-l border-[var(--border-primary)] text-[var(--text-secondary)]" />
                                    )}
                                </tr>
                            )}
                        </tbody>
                        {!isListView && (
                            <tfoot className="bg-[var(--bg-primary)] text-[11px] text-[var(--text-secondary)] font-medium">
                                <tr>
                                    <td className="w-10 sticky left-0 bg-[var(--bg-primary)] z-20 border-r border-[var(--border-primary)]"></td>
                                    <td className="py-2 px-4 sticky left-10 bg-[var(--bg-secondary)] z-20 border-r border-[var(--border-primary)] shadow-[2px_0_5px_-2px_rgba(0,0,0,0.02)]">
                                        <div className="flex flex-col">
                                            <select
                                                className="bg-transparent border-none p-0 focus:ring-0 cursor-pointer hover:text-indigo-600"
                                                value={aggregations['title'] || 'none'}
                                                onChange={(e) => setAggregations({ ...aggregations, title: e.target.value })}
                                            >
                                                <option value="none">({t('table.none')})</option>
                                                <option value="count">{t('table.agg_count', "Count")}</option>
                                            </select>
                                            {aggregations['title'] && aggregations['title'] !== 'none' && (
                                                <span className="text-[var(--text-primary)] font-bold">{calculateAggregation('title', 'title')}</span>
                                            )}
                                        </div>
                                    </td>
                                    {dynamicColumns.map(([key, type]) => (
                                        <td key={key} className="py-2 px-4 border-r border-[var(--border-primary)]">
                                            <div className="flex flex-col">
                                                <select
                                                    className="bg-transparent border-none p-0 focus:ring-0 cursor-pointer hover:text-indigo-600"
                                                    value={aggregations[key] || 'none'}
                                                    onChange={(e) => setAggregations({ ...aggregations, [key]: e.target.value })}
                                                >
                                                    <option value="none">({t('table.none')})</option>
                                                    <option value="count">{t('table.agg_count', "Count")}</option>
                                                    {(type === 'number' || type === 'formula' || type === 'rollup') && (
                                                        <>
                                                            <option value="sum">{t('view.agg_sum', "Sum")}</option>
                                                            <option value="avg">{t('view.agg_avg', "Average")}</option>
                                                            <option value="min">{t('view.agg_min', "Min")}</option>
                                                            <option value="max">{t('view.agg_max', "Max")}</option>
                                                        </>
                                                    )}
                                                    {(type === 'date' || type === 'datetime' || type === 'period') && (
                                                        <>
                                                            <option value="earliest">{t('table.earliest')}</option>
                                                            <option value="latest">{t('table.latest')}</option>
                                                        </>
                                                    )}
                                                </select>
                                                {aggregations[key] && aggregations[key] !== 'none' && (
                                                    <span className="text-[var(--text-primary)] font-bold">{calculateAggregation(key, type)}</span>
                                                )}
                                            </div>
                                        </td>
                                    ))}
                                    {showModifiedColumn && (
                                        <td className="py-2 px-4 border-l border-[var(--border-primary)]">
                                            <div className="flex flex-col">
                                                <select
                                                    className="bg-transparent border-none p-0 focus:ring-0 cursor-pointer hover:text-indigo-600"
                                                    value={aggregations['last_modified'] || 'none'}
                                                    onChange={(e) => setAggregations({ ...aggregations, last_modified: e.target.value })}
                                                >
                                                    <option value="none">({t('table.none')})</option>
                                                    <option value="count">{t('table.agg_count', "Count")}</option>
                                                    <option value="earliest">{t('table.earliest')}</option>
                                                    <option value="latest">{t('table.latest')}</option>
                                                </select>
                                                {aggregations['last_modified'] && aggregations['last_modified'] !== 'none' && (
                                                    <span className="text-[var(--text-primary)] font-bold">{calculateAggregation('last_modified', 'date')}</span>
                                                )}
                                            </div>
                                        </td>
                                    )}
                                </tr>
                            </tfoot>
                        )}
                    </table>
                    </SortableContext>
                    </DndContext>

                    {sortedNotes.length === 0 && (
                        <div className="p-8 text-center text-[var(--text-tertiary)] bg-[var(--bg-primary)]">
                            {t('table.no_notes')}
                        </div>
                    )}

                    {!groupByField && sortedNotes.length > visibleRowsCount && (
                        <InfiniteLoadSentinel
                            visibleCount={visibleRowsCount}
                            total={sortedNotes.length}
                            batchSize={ROWS_BATCH_SIZE}
                            onLoadMore={handleLoadMoreRows}
                            label={t('table.showing_records', { count: visibleRowsCount, total: sortedNotes.length })}
                        />
                    )}
                </div>
            </div>

            {pendingAction && pendingAction.action === 'translate_row' && (
                <TranslateLanguagesModal
                    isOpen={true}
                    onClose={() => setPendingAction(null)}
                    noteId={pendingAction.noteId}
                    fieldConfig={pendingAction.fieldConfig}
                    recordMetadata={noteById.get(pendingAction.noteId)?.metadata || {}}
                    schema={schema}
                    onTranslated={(data) => { setPendingAction(null); onTranslated?.(data); }}
                />
            )}

            {pendingAction && pendingAction.action === 'sync_drupal' && (
                <SyncDrupalModal
                    isOpen={true}
                    onClose={() => setPendingAction(null)}
                    noteId={pendingAction.noteId}
                    recordMetadata={noteById.get(pendingAction.noteId)?.metadata || {}}
                    onSynced={() => { setPendingAction(null); onTranslated?.({}); }}
                />
            )}

            {pendingAction && pendingAction.action === 'publish_social' && (
                <PublishSocialModal
                    isOpen={true}
                    onClose={() => setPendingAction(null)}
                    noteId={pendingAction.noteId}
                    recordMetadata={noteById.get(pendingAction.noteId)?.metadata || {}}
                    onPublished={() => { setPendingAction(null); onTranslated?.({}); }}
                />
            )}

            {pendingAction && pendingAction.action === 'process_resource' && (
                <ProcessResourceModal
                    isOpen={true}
                    onClose={() => setPendingAction(null)}
                    noteId={pendingAction.noteId}
                    title={noteById.get(pendingAction.noteId)?.title || ''}
                    sourceTableId={pendingAction.sourceTableId}
                    force={pendingAction.force}
                    onJobUpdate={(nextJob) => {
                        setLlmWikiJobs((current) => ({
                            ...current,
                            [pendingAction.sourceTableId]: {
                                ...(current[pendingAction.sourceTableId] || {}),
                                [pendingAction.noteId]: nextJob,
                            },
                        }));
                    }}
                    onProcessed={() => { onTranslated?.({}); }}
                />
            )}

            {bulkTranslateIds && bulkTranslateIds.length > 0 && (
                <TranslateLanguagesModal
                    isOpen={true}
                    mode="bulk"
                    noteIds={bulkTranslateIds}
                    onClose={() => setBulkTranslateIds(null)}
                    onTranslated={(data) => {
                        setBulkTranslateIds(null);
                        clearSelection();
                        onTranslated?.(data);
                    }}
                />
            )}

            <InsertContentModal
                // key per ROW: reopening the modal on another row REMOUNTS the
                // instance (state and in-flight promises die with their context).
                // Without this, a long upload started on one row survives to
                // closing/reopening and any reading of "current" props can
                // insert the result into the wrong row (seen on 2026-06-09:
                // attachment of «El camí de tornada» written to «Un viaje inexperado»).
                key={mediaPickerCell?.rowId || 'closed'}
                open={Boolean(mediaPickerCell)}
                tableId={mediaPickerCell?.tableId || ''}
                fileField={mediaPickerCell?.fileField || null}
                rowMetadata={mediaPickerCell?.rowMetadata || {}}
                imageField={Boolean(mediaPickerCell?.imageField)}
                initialImageMeta={mediaPickerCell?.imageMeta || null}
                onClose={() => setMediaPickerCell(null)}
                onInsert={(result) => {
                    if (!mediaPickerCell) return;
                    const { rowId, field, originalMetaKey } = mediaPickerCell;
                    // Metadata only (alt/title/…): keeps the field's current src.
                    if (result?.metadataOnly) {
                        const note = safeNotes.find(n => n.id === rowId);
                        const currentSrc = getImageSrc(note?.metadata?.[originalMetaKey]);
                        if (currentSrc) {
                            handleCellSave(rowId, field, buildImageValue(currentSrc, result.imageMeta || {}), originalMetaKey);
                        }
                        setMediaPickerCell(null);
                        return;
                    }
                    // Multi-file (`files` field): adds ALL the URLs in a single
                    // go (avoids the race of adding them one by one via N onInsert),
                    // DEDUPLICATING with the canonical key (file:// ≡ absolute ≡ ~/ ≡
                    // served): repeating a link/upload does not duplicate entries.
                    if (Array.isArray(result?.urls) && result.urls.length && getFieldType(schema, field) === 'files') {
                        const note = safeNotes.find(n => n.id === rowId);
                        const existing = note?.metadata?.[originalMetaKey];
                        const arr = (Array.isArray(existing) ? existing : (existing ? [existing] : []))
                            .map(v => String(v ?? '')).filter(v => v.trim() !== '');
                        const seen = new Set(arr.map(fileTargetKey));
                        const adds = [];
                        for (const u of result.urls) {
                            const vp = urlToVaultPath(u || '');
                            if (!vp) continue;
                            const key = fileTargetKey(vp);
                            if (seen.has(key)) continue;
                            seen.add(key);
                            adds.push(vp);
                        }
                        if (!adds.length) { setMediaPickerCell(null); return; }
                        const next = [...arr, ...adds];
                        handleCellSave(rowId, field, next.length === 1 ? next[0] : next, originalMetaKey);
                        setMediaPickerCell(null);
                        return;
                    }
                    const newPath = urlToVaultPath(result?.url || '');
                    let value = newPath;
                    // `files` fields are multi-file: we append to the existing list.
                    // (Image fields detected by name are single-valued → they replace.)
                    if (newPath && getFieldType(schema, field) === 'files') {
                        const note = safeNotes.find(n => n.id === rowId);
                        const existing = note?.metadata?.[originalMetaKey];
                        const arr = (Array.isArray(existing) ? existing : (existing ? [existing] : []))
                            .map(v => String(v ?? '')).filter(v => v.trim() !== '');
                        // Same file already present (in any format) → don't duplicate it.
                        const newKey = fileTargetKey(newPath);
                        if (arr.some(v => fileTargetKey(v) === newKey)) {
                            setMediaPickerCell(null);
                            return;
                        }
                        const next = [...arr, newPath];
                        value = next.length === 1 ? next[0] : next;
                    } else if (newPath) {
                        // Image field: composite value {src, alt, title, …} when metadata is present.
                        value = buildImageValue(newPath, result?.imageMeta || {});
                    }
                    handleCellSave(rowId, field, value, originalMetaKey);
                    setMediaPickerCell(null);
                }}
            />

            {fileDeletePrompt && (
                <div
                    className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
                    onClick={() => { if (!fileDeleteBusy) setFileDeletePrompt(null); }}
                >
                    <div
                        className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-2xl shadow-2xl w-full max-w-md p-5"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h2 className="text-base font-semibold text-[var(--text-primary)] mb-1">
                            {t('files.delete_title', { defaultValue: "Delete file" })}
                        </h2>
                        <p className="text-sm text-[var(--text-secondary)] mb-4 break-words">
                            {t('files.delete_question', { defaultValue: "What do you want to do with “{{name}}”?", name: fileDeletePrompt.fileName })}
                        </p>
                        <div className="flex flex-col gap-2">
                            <button
                                type="button"
                                disabled={fileDeleteBusy}
                                onClick={() => {
                                    const p = fileDeletePrompt;
                                    const next = p.arr.filter((_, i) => i !== p.idx);
                                    handleCellSave(p.rowId, p.field, next.length === 0 ? '' : (next.length === 1 ? next[0] : next), p.originalMetaKey);
                                    setFileDeletePrompt(null);
                                }}
                                className="w-full text-left px-3 py-2 rounded-lg border border-[var(--border-primary)] hover:bg-[var(--bg-secondary)] text-sm text-[var(--text-primary)] disabled:opacity-50"
                            >
                                {t('files.delete_link_only', { defaultValue: "Remove only the link (keep the file)" })}
                            </button>
                            <button
                                type="button"
                                disabled={fileDeleteBusy}
                                onClick={async () => {
                                    const p = fileDeletePrompt;
                                    setFileDeleteBusy(true);
                                    try {
                                        const res = await fetch('/api/vault/delete-physical-file', {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ target: p.target }),
                                        });
                                        if (!res.ok) {
                                            const err = await res.json().catch(() => ({}));
                                            throw new Error(err.detail || `HTTP ${res.status}`);
                                        }
                                        const data = await res.json();
                                        const next = p.arr.filter((_, i) => i !== p.idx);
                                        handleCellSave(p.rowId, p.field, next.length === 0 ? '' : (next.length === 1 ? next[0] : next), p.originalMetaKey);
                                        toast.success(data.method === 'macos_trash'
                                            ? t('files.trashed', { defaultValue: "File moved to Trash" })
                                            : t('files.deleted', { defaultValue: "File deleted" }));
                                        setFileDeletePrompt(null);
                                    } catch (err) {
                                        toast.error(t('files.delete_error', { defaultValue: "Could not delete the file: {{msg}}", msg: err.message }));
                                    } finally {
                                        setFileDeleteBusy(false);
                                    }
                                }}
                                className="w-full text-left px-3 py-2 rounded-lg border border-red-500/30 bg-red-500/5 hover:bg-red-500/10 text-sm text-red-600 disabled:opacity-50"
                            >
                                {t('files.delete_physical', { defaultValue: "Also delete the file (to Trash)" })}
                            </button>
                            <button
                                type="button"
                                disabled={fileDeleteBusy}
                                onClick={() => setFileDeletePrompt(null)}
                                className="w-full px-3 py-2 rounded-lg hover:bg-[var(--bg-secondary)] text-sm text-[var(--text-secondary)] disabled:opacity-50"
                            >
                                {t('common.cancel', { defaultValue: "Cancel" })}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {titlePreview.preview}
        </div>
    );
};
