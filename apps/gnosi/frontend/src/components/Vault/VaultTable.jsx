import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { FileText, Tag, Clock, Hash, CheckSquare, Calendar, Link as LinkIcon, Type, ArrowUp, ArrowDown, Settings, Settings2, Plus, ChevronDown, ChevronRight, ExternalLink, Search, X, Trash2, Filter, List, LayoutPanelLeft, Unlock, Columns2, Languages, Zap, Globe, Send } from 'lucide-react';
import { IconRenderer } from './IconRenderer';
import { VaultDateProperty, periodDaysInclusive } from './VaultDateProperty';
import { ImageHoverPreview } from './ImageHoverPreview';
import { FileFieldValue } from './FileFieldValue';
import { filenameFromTarget, isImageFieldName, getImageSrc, parseImageField, buildImageValue, fileTargetKey } from '../../lib/fileResource';
import { InsertContentModal } from './InsertContentModal';
import { useTitlePreview } from './useTitlePreview';

// Desplegable d'una cel·la (select/multi_select) renderitzat en un PORTAL a
// `document.body` amb `position: fixed`, ancorat sota l'input. Així escapa del
// scroller `overflow-auto` de la taula incrustada (que abans el retallava quan
// la vista era curta) i del context d'apilament `isolate` del bloc embed, i
// queda SEMPRE per sobre (z-index màxim). Si no hi cap a sota, es gira amunt.
// El click-fora dels pickers ha d'ignorar els clics dins del portal: ho marquem
// amb `data-cell-dropdown` i ho comprovem amb `closest('[data-cell-dropdown]')`.
const CellDropdownPortal = React.forwardRef(function CellDropdownPortal(
    { anchorRef, className = '', maxHeight = 240, children },
    ref,
) {
    const [pos, setPos] = useState(null);
    useLayoutEffect(() => {
        let raf = 0;
        const compute = () => {
            const el = anchorRef.current;
            // Els layout effects corren child-first: en el primer muntatge el
            // `ref` del contenidor pare (anchorRef) encara pot no estar adjuntat.
            // Reintenta al frame següent, quan ja hi és.
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
        // `true` (capture) per recollir l'scroll de QUALSEVOL contenidor ancestre
        // (el scroller intern de la taula), no només el de window.
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
                zIndex: 2147483000,
            }}
        >
            {children}
        </div>,
        document.body,
    );
});

const InlinePillsPicker = ({ value = [], options = [], idToTitle = {}, optionColors = {}, onSave, onCreate, onDeleteOption }) => {
    const [localValues, setLocalValues] = useState(value);
    const [search, setSearch] = useState('');
    const containerRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (e) => {
            // El desplegable viu en un portal (fora de containerRef): no el
            // comptem com a "fora".
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
        onCreate(term);              // persisteix l'opció al schema
        setLocalValues(prev => [...prev, term]); // i la selecciona en aquest registre
        setSearch('');
    };

    const handleDelete = (val) => {
        if (!onDeleteOption) return;
        onDeleteOption(val);         // treu l'opció del catàleg del camp
        setLocalValues(prev => prev.filter(v => v !== val)); // i d'aquest registre
    };

    return (
        <div ref={containerRef} className="w-full">
            <div className="flex flex-wrap gap-1 mb-1 min-h-[20px]">
                {localValues.map(val => (
                    <span key={val} className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-medium bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)] border border-[var(--gnosi-primary)]/20 whitespace-nowrap">
                        {idToTitle[val] || (val.length > 16 ? val.substring(0, 8) + '…' : val)}
                        <X size={9} className="cursor-pointer hover:text-red-500 shrink-0" onMouseDown={e => { e.preventDefault(); toggle(val); }} />
                    </span>
                ))}
            </div>
            <input
                autoFocus
                className="w-full px-2 py-0.5 text-xs border border-[var(--border-primary)] rounded bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                placeholder={onCreate ? 'Cercar o crear…' : 'Cercar…'}
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
                                    title="Elimina l'opció del camp"
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
                            <Plus size={12} /> Crear «{term}»
                        </div>
                    )}
                </CellDropdownPortal>
            )}
        </div>
    );
};

// Picker inline d'un sol valor per a cel·les select/status de la taula.
// Substitueix el <select> natiu per poder cercar, crear i eliminar opcions
// (estil Notion). Navegable amb teclat (↑↓/Enter/Esc) compartint un sol
// highlightedIndex amb el hover —vegeu el patró canònic a MultiSelectPills.
const InlineSelectPicker = ({ value = '', options = [], idToTitle = {}, optionColors = {}, onSave, onCreate, onDeleteOption }) => {
    const [search, setSearch] = useState('');
    const [highlightedIndex, setHighlightedIndex] = useState(0);
    const containerRef = useRef(null);
    const listRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (e) => {
            if (containerRef.current && !containerRef.current.contains(e.target) && !e.target.closest?.('[data-cell-dropdown]')) {
                onSave(value); // tanca sense canviar (handleCellSave fa early-return si és igual)
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

    // El reset del highlight en canviar la cerca es fa a l'onChange de l'input
    // (no en un effect) per evitar un render en cascada.
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
                placeholder={onCreate ? 'Cercar o crear…' : 'Cercar…'}
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
                                    title="Elimina l'opció del camp"
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
                        <Plus size={12} /> Crear «{term}»
                    </div>
                )}
                {filtered.length === 0 && !canCreate && (
                    <div className="px-2 py-1 text-xs text-[var(--text-tertiary)]/60 italic">Cap opció</div>
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
import { getFieldConfig, getFieldType, getSchemaFieldEntries, getSchemaFieldNames, getLanguageFieldName, resolveFieldRef, normalizeSorts } from './schemaUtils';
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
import { isMainView } from './viewConstants';
import { useVaultSelection } from '../../hooks/useVaultSelection';
import { useVaultSelectionShortcuts } from '../../hooks/useVaultSelectionShortcuts';
import { VaultBulkActionsBar } from './VaultBulkActionsBar';
import { TranslateLanguagesModal } from './TranslateLanguagesModal';
import { SyncDrupalModal } from './SyncDrupalModal';
import { PublishSocialModal } from './PublishSocialModal';
import axios from 'axios';
import { toast } from '../../lib/toast';
import { notifyError, logError } from '../../lib/notifyError';
import { useVirtualizer } from '@tanstack/react-virtual';

/**
 * Sentinella que dispara `onLoadMore` quan entra al viewport.
 *
 * Reemplaça el botó "Mostrar més" manual: la taula carrega els primers
 * `ROWS_BATCH_SIZE` rows i, quan l'usuari arriba al final, els següents
 * apareixen sols. Així no paguem el cost de muntar 300 rows al primer
 * render (~4 s observat) i mantenim la sensació d'una llista sencera.
 *
 * Implementat amb `IntersectionObserver` (zero polling, alliberat al
 * dismount) + un fallback síncron amb botó per si l'autoload no salta
 * (DOM al què el sentinel no és visible, p.ex. dins un dialeg amb
 * `display:none` mentre canvies de tab).
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
            className="px-4 py-3 border-t border-[var(--border-primary)] bg-[var(--bg-secondary)] flex items-center justify-between"
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

export function VaultTable({ notes, onNoteSelect, schema = {}, idToTitle = {}, allNotes = [], activeView, onUpdateView, isEmbedded = false, onEditSchema, isListView = false, onCreateRecord, onDeletePage, onDeleteSelected, onCellSaved, onUpdateFieldOptions, onOpenParallel, onTranslated, searchTerm: searchTermProp, onSearchChange, actionRules = null, maxHeight = null, registerNavApi = null, onExitTop = null, onExitBottom = null }) {
    const { t, i18n } = useTranslation();
    // Usuari actual (per als camps "Creat per"/"Editat per" en mode personal).
    const { user: currentUser } = useAuth();
    // Defaults globals de format (moneda/número/data) — override per camp via config.format.
    const localeSettings = useLocaleSettings();
    // Overrides optimistic per cel·la. Map<noteId, partialMetadata>. Quan
    // l'usuari edita un camp, apliquem el canvi aquí *abans* del PATCH al
    // backend; així la UI reflecteix la nova dada de seguida (0 ms percebut)
    // i el backend (~200-450 ms) corre en background. Es netegen
    // automàticament al `useEffect` de sota quan el prop `notes` arriba
    // amb el valor desitjat ja reflectit (post-refetch); si el PATCH falla,
    // el catch a `handleCellSave` els treu manualment (rollback) i mostra
    // un toast d'error.
    const [optimisticPatches, setOptimisticPatches] = useState(() => new Map());
    // Override optimistic del títol. Map<noteId, newTitle>. El títol viu a
    // `note.title` (no a metadata), així que `optimisticPatches` no l'abasta;
    // aquest map dóna feedback immediat en editar-lo inline. Es neteja sol quan
    // el refetch reflecteix el nou títol (vegeu l'effect de sota).
    const [optimisticTitles, setOptimisticTitles] = useState(() => new Map());
    // Estabilitzem la referència a `notes || []` per evitar que canviï a
    // cada render i invalidi `useMemo`/`useEffect` sense raó.
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

    // Neteja overrides de títol ja reflectits al prop `notes` (post-refetch).
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

    // Neteja els patches que ja queden reflectits a `notes` (després d'un
    // refetch reeixit). Sense això, els overrides s'acumularien indefinidament.
    useEffect(() => {
        if (optimisticPatches.size === 0) return;
        setOptimisticPatches(prev => {
            let changed = false;
            const next = new Map(prev);
            for (const [noteId, patch] of next) {
                const note = rawNotes.find(n => n.id === noteId);
                if (!note) continue;
                const allMatch = Object.entries(patch).every(
                    ([k, v]) => (note.metadata || {})[k] === v
                );
                if (allMatch) {
                    next.delete(noteId);
                    changed = true;
                }
            }
            return changed ? next : prev;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps -- només volem reaccionar a canvis de `notes`
    }, [rawNotes]);
    // Mida del batch inicial. Renderitzar 200 rows × ~12 cells (~2400
    // components React) al primer mount d'una taula de 303 registres
    // trigava ~4 s amb el thread principal congelat. Carreguem-ne 50
    // d'entrada (~600 components, ~700 ms) i la resta via autoload on
    // scroll. La UX queda igual perquè els altres apareixen abans que
    // l'usuari hi arribi.
    const ROWS_BATCH_SIZE = 50;

    // State for column widths — inicialitzades des de la vista (persistents).
    const [columnWidths, setColumnWidths] = useState(() => ({
        title: 250,
        last_modified: 150,
        ...(activeView?.columnWidths || {}),
    }));
    const columnWidthsRef = useRef({});
    columnWidthsRef.current = columnWidths;
    // En canviar de vista (cada vista té les seves amplades), re-sincronitza.
    useEffect(() => {
        setColumnWidths({ title: 250, last_modified: 150, ...(activeView?.columnWidths || {}) });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeView?.id]);

    // Alçada de fila configurable (activeView.rowHeight): compacta/normal/alta.
    const rowHeight = activeView?.rowHeight || 'normal';
    const rowPadClass = rowHeight === 'compact' ? 'py-1' : (rowHeight === 'tall' ? 'py-4' : 'py-2.5');

    // Agrupació de files (activeView.groupBy): nom d'un camp de l'esquema
    // (select/status/multi_select). Buit = sense agrupar (taula plana actual).
    const groupByField = activeView?.groupBy || '';

    // Refs for drag state
    const resizingCol = useRef(null);
    const startX = useRef(0);
    const startWidth = useRef(0);

    // Reordenació de columnes per arrossegament (drag-to-reorder de la capçalera).
    // La LÒGICA viu en refs (sempre actuals dins els handlers natius de DnD, sense
    // staleness de closures); l'ESTAT només alimenta l'indicador visual (re-render).
    const draggedColRef = useRef(null);     // key de la columna que s'arrossega
    const dropAfterRef = useRef(false);     // drop a la dreta (true) o esquerra (false) de la destí
    const [draggedColumn, setDraggedColumn] = useState(null);
    const [dragOverColumn, setDragOverColumn] = useState(null);
    const [dropAfter, setDropAfter] = useState(false);

    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [editingCell, setEditingCell] = useState(null); // { rowId, field, activeMetaKey }
    // ── Graella estil Notion/Excel ───────────────────────────────────────
    // `activeCell` és el CURSOR (vora ressaltada) i és independent de
    // `editingCell` (input obert). `anchorCell` és l'àncora d'una selecció
    // rectangular (Shift+fletxes / Shift+clic); el rang és el rectangle
    // entre àncora i cursor. Vegeu docs/dev_memory/directives/vault_table_cell_grid.md
    const [activeCell, setActiveCell] = useState(null);   // { rowId, field }
    const [anchorCell, setAnchorCell] = useState(null);   // { rowId, field } | null
    const [editInitial, setEditInitial] = useState(null); // char inicial en type-to-edit (text/number)
    const clipboardRef = useRef(null);                    // { matrix: rawValues[][] } — porta-retalls intern
    // Refs per a tancaments d'event — permeten que el listener de teclat
    // llegeixi valors actuals sense reconstruir-se a cada keypress.
    const activeCellRef = useRef(null);
    activeCellRef.current = activeCell;
    const anchorCellRef = useRef(null);
    anchorCellRef.current = anchorCell;
    const editingCellRef = useRef(null);
    editingCellRef.current = editingCell;
    // Previsualització del contingut en passar el ratolí (o Espai/Quick Look)
    // pel títol d'un registre. Un sol card per a tota la taula; el listener
    // global de teclat l'invoca via `titlePreviewRef` (sense recrear-se).
    const titlePreview = useTitlePreview({ onOpenPage: onNoteSelect });
    const titlePreviewRef = useRef(null);
    titlePreviewRef.current = titlePreview;
    const [mediaPickerCell, setMediaPickerCell] = useState(null); // { rowId, field, originalMetaKey, tableId }
    // Confirmació en eliminar un fitxer d'un camp `files`:
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
    const [internalSearchTerm, setInternalSearchTerm] = useState('');
    const searchTerm = searchTermProp !== undefined ? searchTermProp : internalSearchTerm;
    const setSearchTerm = onSearchChange || setInternalSearchTerm;
    const [expandedRows, setExpandedRows] = useState(new Set()); // IDs of expanded rows
    const [collapsedGroups, setCollapsedGroups] = useState(() => new Set()); // claus de grup col·lapsades (agrupació)
    const [newSubitemTitle, setNewSubitemTitle] = useState(''); // title for the new inline subitem
    const [addingSubitemFor, setAddingSubitemFor] = useState(null); // parent ID for adding a subitem
    const [openingResourceId, setOpeningResourceId] = useState(null);
    const [visibleRowsCount, setVisibleRowsCount] = useState(ROWS_BATCH_SIZE);
    // Snapshot d'ids per a la traducció massiva (GAP 3c). Capturem la selecció
    // en obrir el modal perquè netejar-la després no buidi la petició.
    const [bulkTranslateIds, setBulkTranslateIds] = useState(null);

    // La taula és traduïble si té almenys un camp marcat `translatable`. És el
    // mateix senyal que valida el backend (translate-row fa 400 si no n'hi ha
    // cap) i que SchemaConfigModal només escriu quan la traducció està activada
    // — per això no cal una prop addicional `translation_enabled`.
    const isTranslatableTable = useMemo(
        () => getSchemaFieldNames(schema).some(
            (name) => getFieldConfig(schema, name)?.translatable === true
        ),
        [schema]
    );
    // Mostra el botó de sincronitzar amb Drupal quan la taula té la funció
    // activada. El senyal és a l'esquema: en activar-la s'hi afegeixen columnes
    // `system` "Drupal NID/URL" (vegeu SchemaConfigModal), de manera que no cal
    // enfilar un prop nou per tots els llocs on es renderitza VaultTable.
    const isDrupalSyncTable = useMemo(
        () => getSchemaFieldNames(schema).some((name) => {
            const cfg = getFieldConfig(schema, name);
            return cfg?.system === true && /drupal/i.test(name);
        }),
        [schema]
    );
    // Mostra el botó "Publicar a XXSS" quan la taula té la funció activada. En
    // activar-la, SchemaConfigModal hi afegeix una columna `system` "XXSS"
    // (estat de publicació), de manera que el senyal viu a l'esquema com Drupal.
    const isSocialPublishTable = useMemo(
        () => getSchemaFieldNames(schema).some((name) => {
            const cfg = getFieldConfig(schema, name);
            return cfg?.system === true && /xxss|social/i.test(name);
        }),
        [schema]
    );
    // `useCallback` per mantenir la referència estable: `React.memo` al
    // `InfiniteLoadSentinel` només funciona si les props no canvien a
    // cada render del pare. Sense això, una nova funció inline per
    // render fa que el sentinel es remunti i `IntersectionObserver` es
    // reconnecti, disparant `onLoadMore` immediatament i en bucle fins
    // omplir la llista — efectivament treia el benefici del batching.
    const handleLoadMoreRows = useCallback(() => {
        setVisibleRowsCount(prev => prev + ROWS_BATCH_SIZE);
    }, [ROWS_BATCH_SIZE]);
    const [newRowTitle, setNewRowTitle] = useState('');
    // Acció pendent disparada per un camp de tipus `button`. Si està set,
    // mostrem el modal corresponent a l'acció (ara mateix només `translate_row`).
    const [pendingAction, setPendingAction] = useState(null);
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
    // `sort` pot venir en dues formes històriques: un únic objecte
    // { field, direction } o un array [{ id, field, direction }] (multi-ordenació
    // del ViewConfigModal). Normalitzem sempre a array perquè la taula ordeni
    // igual que Galeria/Kanban/Timeline; sense això, un ordre desat des del modal
    // (array) es perdia (`activeSort.field` era undefined → sort buit).
    const normalizedSorts = normalizeSorts(activeView?.sort);
    // Sense cap ordre configurat (vista nova): per defecte, més recent primer.
    // Un array buit explícit (l'usuari ha tret tots els ordres) es respecta com
    // a "sense ordre".
    const effectiveSorts = normalizedSorts.length > 0
        ? normalizedSorts
        : (activeView?.sort ? [] : [{ field: "last_modified", direction: "desc" }]);
    // L'ordre primari governa la fletxa asc/desc de la capçalera i el toggle.
    const activeSort = effectiveSorts[0] || {};
    // Signatura estable (multi-camp) per reinicialitzar el cursor quan canvia l'ordre.
    const sortSignature = effectiveSorts.map(s => `${s.field}:${s.direction}`).join(',');

    const viewConfig = {
        filters: activeView?.filters || [],
        sort: effectiveSorts,
        search: searchTerm
    };

    const { sortedPages: sortedAndFilteredNotes } = useVaultViewData({ pages: safeNotes, schema, view: viewConfig, searchTerm });

    const resolveNoteTableId = useCallback((note) => note?.resolved_table_id || note?.metadata?.table_id || note?.metadata?.database_table_id || null, []);

    // ---- SUBITEMS TREE CONSTRUCTION (only if enableSubitems is true) ----
    const enableSubitems = !!activeView?.enableSubitems;

    // Obtain IDs of all notes in this table
    const allNoteIds = new Set(safeNotes.map(n => n.id));

    // Identify children: notes with parent_id pointing to a note in this table
    const childrenMap = {};
    const rootNotes = [];

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
                    onNoteSelect(lastSelectedId);
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
    // El primer mount d'una taula de 303 registres trigava 1-4 s perquè
    // muntava els N rows × ~12 cells alhora. Aquí només renderitzem els
    // rows efectivament dins viewport + uns quants per anticipar-se al
    // scroll (`overscan`). El cost del primer paint cau a O(viewport),
    // independent de la mida total de la taula.
    //
    // **Descriptors plans**: `tanstack/react-virtual` assumeix 1 element
    // mesurable per índex. Per evitar trencar aquest contracte (root +
    // children expandits + form subitem dins un `Fragment` confonia el
    // virtualizer i feia padding/scroll imprecisos), aplanem la jerarquia
    // a una llista única `rowDescriptors` on **cada entrada genera un
    // sol `<tr>`**. El virtualizer indexa 1:1 contra aquesta llista i
    // `measureElement` rep directament el `<tr>` del virtual item.
    //
    // Patró del DOM: `<tbody>` natiu amb espaiadors `<tr>` (height =
    // padding) per sobre i sota dels rows visibles, així `<table>`+
    // `<thead>` mantenen l'alineació de columnes sense haver de canviar
    // `display: block`.
    const tableContainerRef = useRef(null);

    // Metadades del camp d'agrupació (ordre i color de les opcions, com el
    // kanban): si el camp té opcions definides a l'esquema, els grups segueixen
    // el seu ORDRE i n'hereten el COLOR. `fieldId` és la reserva per llegir el
    // valor quan la metadata es clava per id en lloc de per nom.
    const groupMeta = useMemo(() => {
        if (!groupByField) return null;
        const cfg = getFieldConfig(schema, groupByField);
        const options = (cfg && Array.isArray(cfg.options)) ? normalizeOptions(cfg.options) : [];
        const colorMap = {};
        options.forEach(o => { colorMap[o.name] = o.color; });
        // Agrupar per un camp RELACIÓ: el valor del grup és l'id de la pàgina
        // relacionada. Resolem id→títol (com fan les cel·les de relació) perquè
        // la capçalera de grup mostri el títol i no l'UUID cru. Per a select/text
        // `labelMap` és null i el label es queda igual (el nom/opció).
        const relDb = cfg?.relation_database_id;
        const labelMap = relDb
            ? Object.fromEntries((allNotes || []).filter(n => {
                const tid = n.resolved_table_id || n.metadata?.table_id || n.metadata?.database_table_id;
                return tid === relDb;
            }).map(n => [n.id, n.title || idToTitle[n.id] || n.id]))
            : null;
        return { fieldId: cfg?.id || null, optionOrder: options.map(o => o.name), colorMap, labelMap };
    }, [groupByField, schema, allNotes, idToTitle]);

    // Col·lapse/expansió d'un grup (estat local). Es reinicia en canviar de
    // vista o de camp d'agrupació, on les claus de grup deixen de tenir sentit.
    const toggleGroup = useCallback((groupKey) => {
        setCollapsedGroups(prev => {
            const next = new Set(prev);
            if (next.has(groupKey)) next.delete(groupKey); else next.add(groupKey);
            return next;
        });
    }, []);
    useEffect(() => { setCollapsedGroups(new Set()); }, [activeView?.id, groupByField]);

    // True si l'usuari té alguna agregació de columna activa: aleshores cada
    // grup mostra un peu amb els subtotals (estil Notion).
    const hasGroupAggregations = useMemo(
        () => Object.values(aggregations || {}).some(f => f && f !== 'none'),
        [aggregations]
    );

    // Llista plana de descriptors. Cada entrada → 1 `<tr>` virtual.
    const rowDescriptors = useMemo(() => {
        const list = [];
        // Afegeix una fila root i, si està desplegada, els seus subitems + el
        // formulari de nou subitem. Reutilitzat per la via plana i l'agrupada.
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

        // Sense agrupació: comportament previ (tram d'infinite-load + virtualització).
        if (!groupByField || !groupMeta) {
            for (const note of visibleRootNotes) pushNoteRows(note);
            return list;
        }

        // Amb agrupació: agrupem TOTES les files ordenades/filtrades (no només el
        // tram d'infinite-load) perquè els comptadors i el conjunt de grups
        // siguin exactes; la virtualització ja limita el cost al viewport. El
        // valor del grup es llegeix pel nom del camp o, com a reserva, per l'id
        // (getMetaKey viu més avall i no és accessible aquí; aquesta resolució
        // cobreix els dos formats reals de metadata).
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
            if (!g) { g = { key: gid, label: gid === EMPTY ? 'Sense valor' : (groupMeta.labelMap?.[name] || name), notes: [] }; groups.set(gid, g); }
            g.notes.push(note);
        }
        // Ordre: opcions de l'esquema (en el seu ordre) → valors no catalogats
        // (ordre d'aparició, sort estable) → grup buit sempre al final.
        const order = groupMeta.optionOrder;
        const ordered = Array.from(groups.values()).sort((a, b) => {
            if (a.key === EMPTY) return 1;
            if (b.key === EMPTY) return -1;
            const ia = order.indexOf(a.key);
            const ib = order.indexOf(b.key);
            if (ia !== -1 && ib !== -1) return ia - ib;
            if (ia !== -1) return -1;
            if (ib !== -1) return 1;
            return 0;
        });
        for (const g of ordered) {
            const colorName = g.key === EMPTY ? null : groupMeta.colorMap[g.label];
            list.push({
                kind: 'group-header',
                groupKey: g.key,
                label: g.label,
                count: g.notes.length,
                colorHex: colorName ? optionColorHex(colorName) : null,
            });
            if (collapsedGroups.has(g.key)) continue; // grup col·lapsat → no rows
            for (const note of g.notes) pushNoteRows(note);
            // Peu de grup (subtotals estil Notion): només si l'usuari té
            // alguna agregació de columna activa. Es calcula sobre les notes
            // d'AQUEST grup (g.notes). Es renderitza sota les files del grup.
            if (hasGroupAggregations) {
                list.push({ kind: 'group-footer', groupKey: g.key, notes: g.notes });
            }
        }
        return list;
    }, [groupByField, groupMeta, visibleRootNotes, sortedNotes, expandedRows, childrenMap, addingSubitemFor, collapsedGroups, hasGroupAggregations]);

    const rowVirtualizer = useVirtualizer({
        count: rowDescriptors.length,
        getScrollElement: () => tableContainerRef.current,
        // Una row aproxima 56 px. Amb descriptors plans no cal pujar
        // l'estimació per expansió: cada child és ja el seu propi virtual
        // item amb el seu propi estimateSize/measureElement.
        estimateSize: () => (rowHeight === 'compact' ? 40 : rowHeight === 'tall' ? 76 : 56),
        // Mesura directa: cada virtual item és UN sol `<tr>`, no fa falta
        // DOM walking. Aquesta és precisament la millora que el patró
        // d'aplanament aporta sobre el de `Fragment` + walking.
        measureElement: (el) => el?.getBoundingClientRect().height || 56,
        overscan: 8,
        // scrollPaddingStart: compensa la capçalera sticky (~44 px) perquè
        // scrollToIndex no deixi files amagades rere el thead.
        // scrollPaddingEnd: manté 1 fila de marge a sota perquè el cursor
        // no arribi mai a la vora inferior abans que el scroll es dispari.
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
        // Llegim l'ordre primari normalitzat (l'`sort` pot ser objecte o array).
        const primary = normalizeSorts(activeView.sort)[0];
        const isCurrentField = primary?.field === field;
        let newDirection = 'asc';
        if (isCurrentField) {
            newDirection = primary.direction === 'asc' ? 'desc' : 'asc';
        }
        // Clicar una capçalera estableix aquest camp com a ÚNIC ordre (estil
        // Notion/Airtable) i el desa en forma d'array, igual que el modal.
        const updatedView = { ...activeView, sort: [{ field, direction: newDirection }] };
        onUpdateView(updatedView);
    };

    // Strip schema by removing title to put it at the beginning and filtering by visibility
    const dynamicColumns = useMemo(() => {
        const titleFieldName = Object.entries(schema || {}).find(([, t]) => t === 'title')?.[0];
        // Només la vista PRINCIPAL ignora `visibleProperties` i mostra tot
        // l'esquema viu (perquè reflecteixi camps nous a l'instant). La resta de
        // vistes respecten els seus camps configurats. Passem `[]` (no
        // `[activeView]`): amb una llista d'un sol element, isMainView cau al
        // fallback "primera vista = principal" i marcaria QUALSEVOL vista com a
        // principal; amb llista buida usa el senyal propi de la vista
        // (is_main / id 'default' / nom canònic), que és el correcte aquí.
        const forceAllProperties = isMainView(activeView, []);
        const baseFields = (!forceAllProperties && activeView?.visibleProperties)
            ? activeView.visibleProperties.map(key => [key, getFieldType(schema, key)]).filter(([key, type]) => key && type)
            : getSchemaFieldEntries(schema).filter(([key, type]) => type !== 'title');
        
        // El títol ja es pinta com a columna fixa: cap entrada de
        // `visibleProperties` ha de tornar-lo a mostrar com a columna de dades.
        // L'excloem pel nom real del camp (titleFieldName), per la referència
        // canònica/legacy 'title' (que getFieldType resol a 'text' perquè
        // l'esquema no en té la clau) i per qualsevol camp de tipus 'title'.
        return baseFields.filter(([key, type]) => key !== titleFieldName && key !== 'title' && type !== 'title');
    }, [activeView, schema]);

    // Drag-to-reorder de columnes: només a vistes NO principals. La vista
    // PRINCIPAL mostra deliberadament tots els camps en ordre d'esquema i el seu
    // ordre no és personalitzable (l'invariant es reforça a VaultDashboard, que
    // reescriu `visibleProperties` a l'ordre d'esquema en desar la principal); per
    // això no l'oferim allà (un drag que es revertís en recarregar enganyaria).
    // Cal `onUpdateView` per persistir; usem el mateix senyal d'isMainView que
    // dynamicColumns (llista buida → senyal propi de la vista).
    const canReorderColumns = !!onUpdateView && !!activeView && !isMainView(activeView, []);

    // La columna "Modificació" (last_modified) són metadades, no un camp de
    // l'esquema. Es mostra a la vista PRINCIPAL (que ensenya tot) o si la vista
    // la configura explícitament a `visibleProperties`; una vista amb camps
    // configurats que no la inclou NO la mostra. Sense `visibleProperties`
    // (vista sense config) es conserva el comportament previ: mostrar-la.
    const showModifiedColumn = useMemo(() => {
        if (isMainView(activeView, [])) return true;
        const vp = activeView?.visibleProperties;
        if (!vp) return true;
        return vp.some(k => k === 'last_modified' || k === 'modified' || k === 'last_edited_time');
    }, [activeView]);

    // La columna "Idioma" és visible a la vista actual? Si ho és, el badge
    // d'idioma del costat del títol mostra el mateix valor que la cel·la →
    // redundant. L'amaguem, però conservem l'avís "stale" (que la columna no
    // porta). Compara per nom resolt perquè les columnes poden venir per id o nom.
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

    // ── Graella: ordre de columnes i files navegables ───────────────────
    // El cursor recorre el `title` (col 0, sticky) + les columnes de metadades
    // (dynamicColumns). El títol és navegable i editable cel·la a cel·la però
    // queda fora de l'enganxat/buidat en bloc (viu a note.title, no a metadata;
    // vegeu isPasteableType). Accions i last_modified segueixen fora.
    const gridColumns = useMemo(
        () => [{ key: 'title', type: 'title' }, ...dynamicColumns.map(([key, type]) => ({ key, type }))],
        [dynamicColumns]
    );
    // Files navegables = descriptors `kind:'row'`, amb el seu índex de
    // descriptor (= índex del virtualizer) per a scrollToIndex.
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
    const gridColumnsRef = useRef([]);
    gridColumnsRef.current = gridColumns;
    const navRowIndexByIdRef = useRef(new Map());
    navRowIndexByIdRef.current = navRowIndexById;
    const colIndexByKeyRef = useRef(new Map());
    colIndexByKeyRef.current = colIndexByKey;
    // Índex id→nota per a lookups O(1) dins els bucles de copy/paste/clear
    // (abans `safeNotes.find` per cel·la → O(n·m) en seleccions grans).
    const noteById = useMemo(() => {
        const m = new Map();
        for (const n of safeNotes) m.set(n.id, n);
        return m;
    }, [safeNotes]);

    // Rectangle de selecció actual (índexs inclusius dins navRows/gridColumns).
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

    // Quan la vista, la cerca o l'ordre canvien (o en carregar la pàgina), posem
    // el cursor a la primera cel·la com fa Excel, sense haver de fer clic.
    // Les notes arriben de forma asíncrona: en el primer mount `navRows` sol
    // ser buit, així que esperem a tenir dades. `initializedViewRef` garanteix
    // que només inicialitzem una vegada per vista (no re-situa el cursor quan
    // s'afegeix una fila o es pagina), i deixa intacta la navegació/Escape de
    // l'usuari (activeCell NO és dependència).
    const initializedViewRef = useRef(null);
    useEffect(() => {
        const viewKey = `${activeView?.id}|${searchTerm}|${sortSignature}`;
        if (initializedViewRef.current === viewKey) return;
        if (navRows.length === 0 || gridColumns.length === 0) return; // espera les dades
        initializedViewRef.current = viewKey;
        setAnchorCell(null);
        setActiveCell({ rowId: navRows[0].id, field: gridColumns[0].key });
    }, [activeView?.id, searchTerm, sortSignature, navRows, gridColumns]);

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
            // Persisteix les amplades a la vista perquè es conservin en recarregar
            // o canviar de vista (abans eren només estat local i es perdien).
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

    // ── Reordenació de columnes per arrossegament ───────────────────────
    // Només les columnes de DADES (dynamicColumns) són arrossegables; el títol
    // (sticky), el checkbox/accions i "Modificació" queden fixos. En deixar anar,
    // reconstruïm l'ordre i el persistim a `activeView.visibleProperties` via
    // `onUpdateView` (igual que handleSort desa `sort`); el pare (handleUpdateView)
    // el desa tal qual a les vistes NO principals i dynamicColumns l'aplica.
    // Aquests handlers només s'enganxen quan canReorderColumns és true (mai a la
    // principal), però igualment fem early-return si no hi ha drag actiu.
    const handleColumnDragStart = useCallback((e, key) => {
        draggedColRef.current = key;
        setDraggedColumn(key);
        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            // Firefox només inicia el drag si hi ha algun payload.
            try { e.dataTransfer.setData('text/plain', key); } catch { /* no-op */ }
        }
        document.body.style.cursor = 'grabbing';
    }, []);

    const clearColumnDrag = useCallback(() => {
        draggedColRef.current = null;
        setDraggedColumn(null);
        setDragOverColumn(null);
        document.body.style.cursor = '';
    }, []);

    const handleColumnDragOver = useCallback((e, key) => {
        const dragged = draggedColRef.current;
        if (!dragged || dragged === key) return;
        e.preventDefault();                 // permet el drop
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        // Costat (esquerra/dreta) segons el punt mitjà de la columna destí:
        // permet inserir abans o després, i així portar-la fins al final.
        const rect = e.currentTarget.getBoundingClientRect();
        const after = (e.clientX - rect.left) > rect.width / 2;
        dropAfterRef.current = after;
        // Només actualitza l'indicador si canvia (evita re-renders redundants).
        setDragOverColumn(prev => (prev === key ? prev : key));
        setDropAfter(prev => (prev === after ? prev : after));
    }, []);

    const handleColumnDrop = useCallback((e, targetKey) => {
        e.preventDefault();
        const dragged = draggedColRef.current;
        const after = dropAfterRef.current;
        clearColumnDrag();
        if (!dragged || dragged === targetKey || !activeView || !onUpdateView) return;

        // Reordenem sobre `visibleProperties` si existeix: així el camp títol i
        // qualsevol altra entrada que no sigui columna de dades es queden al seu
        // lloc (el títol es pinta a part, però el conservem on era — sovint primer
        // per convenció). Si la vista no en té (cap config), materialitzem l'ordre
        // visible actual a partir de dynamicColumns.
        const hasVP = Array.isArray(activeView.visibleProperties) && activeView.visibleProperties.length > 0;
        const base = hasVP ? activeView.visibleProperties : dynamicColumns.map(([k]) => k);
        if (!base.includes(dragged) || !base.includes(targetKey)) return;

        // Treu la columna arrossegada i reinsereix-la abans/després de la destí.
        const without = base.filter(k => k !== dragged);
        let insertAt = without.indexOf(targetKey);
        if (after) insertAt += 1;
        const newOrder = [...without.slice(0, insertAt), dragged, ...without.slice(insertAt)];

        // Sense canvi real → no desis (evita un PATCH inútil).
        if (newOrder.length === base.length && newOrder.every((k, i) => k === base[i])) return;

        onUpdateView({ ...activeView, visibleProperties: newOrder });
    }, [dynamicColumns, activeView, onUpdateView, clearColumnDrag]);

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
            // Object.prototype.hasOwnProperty.call evita falsos positius si
            // metadata té una propietat anomenada "hasOwnProperty".
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
        return Boolean(zoteroUri || filePath || attachments);
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
    const handleCellSave = useCallback(async (noteId, field, newValue, originalMetaKey, skipPropagation = false) => {
        setEditingCell(null);
        setEditInitial(null);
        const note = safeNotes.find(n => n.id === noteId);
        if (!note) return;

        const currentValue = note.metadata?.[originalMetaKey];
        if (currentValue === newValue) return;

        // 1. OPTIMISTIC: aplica el canvi local immediatament — l'usuari
        //    veu el valor nou abans que el backend respongui (~200-450 ms).
        setOptimisticPatches(prev => {
            const next = new Map(prev);
            const existing = next.get(noteId) || {};
            next.set(noteId, { ...existing, [originalMetaKey]: newValue });
            return next;
        });

        try {
            // 2. PATCH partial — el backend fa `metadata.update(request.metadata)`
            //    i conserva title / content / altres camps intactes. Abans
            //    enviàvem PUT amb `title + content + metadata` complets per
            //    cada cel·la editada (potser MBs de body, doble latència de
            //    serialització).
            const response = await fetch(`/api/vault/pages/${noteId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ metadata: { [originalMetaKey]: newValue } })
            });
            if (!response.ok) {
                // fetch només llança a errors de xarxa, no a 4xx/5xx → si no ho
                // gestionem aquí, l'usuari no veu res però la cel·la no s'ha desat.
                const payload = await response.json().catch(() => ({}));
                throw new Error(payload?.detail || `HTTP ${response.status}`);
            }
            // Propagate changes to parent if this is a child
            if (!skipPropagation) {
                const parentId = note.metadata?.parent_id || note.parent_id;
                if (parentId) {
                    await propagateToParent(parentId, field, noteId, newValue);
                }
            }
            // Refresh in background — el cache del backend ja ha estat
            // invalidat al PATCH. NO esperem aquí: l'usuari ja veu el canvi
            // gràcies a l'optimistic patch, i quan arribi el nou `notes`
            // prop, el `useEffect` netejarà l'override automàticament.
            if (onCellSaved) onCellSaved();
            else if (onUpdateView) onUpdateView(activeView);
        } catch (error) {
            // 3. ROLLBACK: treu només el patch d'aquest camp (mantenim
            //    altres patches pendents per a la mateixa nota intactes).
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
            notifyError('table-save-cell', error, t('table.save_cell_error', 'Error desant la cel·la'));
        }
    // `propagateToParent` i `t` són capturats pel closure; afegir-los al
    // dep array crearia un cicle de recreació amb `propagateToParent` (que
    // a la vegada depèn de `handleCellSave`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [safeNotes, activeView, onUpdateView, onCellSaved]);

    // ---- PROPAGATION LOGIC TO PARENT ----
    // `overrides` (Map<childId, value>) permet a l'enganxat en bloc passar els
    // valors acabats d'escriure perquè el càlcul "tots els fills fets" no usi
    // els valors antics dels germans (edicions individuals el deixen `null`).
    const propagateToParent = useCallback(async (parentId, changedField, changedChildId, newValue, overrides = null) => {
        const parent = safeNotes.find(n => n.id === parentId);
        if (!parent) return;

        const children = childrenMap[parentId] || [];
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
                const parentStatus = getFieldType(schema, changedField) === 'checkbox' ? true : 'Completat';
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
                return val ? String(val) : null;
            }).filter(Boolean);

            if (allDates.length > 0) {
                if (getFieldType(schema, changedField) === 'period') {
                    // format "YYYY-MM-DD/YYYY-MM-DD"
                    const starts = allDates.map(v => v.split('/')[0]).filter(Boolean).map(d => new Date(d)).filter(d => !isNaN(d));
                    const ends = allDates.map(v => v.split('/')[1]).filter(Boolean).map(d => new Date(d)).filter(d => !isNaN(d));
                    if (starts.length > 0 && ends.length > 0) {
                        const minStart = new Date(Math.min(...starts)).toISOString().split('T')[0];
                        const maxEnd = new Date(Math.max(...ends)).toISOString().split('T')[0];
                        const newPeriod = `${minStart}/${maxEnd}`;
                        const parentMetaKey = getMetaKey(parent, changedField);
                        if (parent.metadata?.[parentMetaKey] !== newPeriod) {
                            await handleCellSave(parentId, changedField, newPeriod, parentMetaKey, true);
                        }
                    }
                } else {
                    // For simple date fields: min for "start" fields, max for "end" fields.
                    // Coincidència per paraula sencera (separadors: espai, guió, subratllat
                    // o inici/final de string) per evitar falsos positius com "Definició",
                    // "Fixació" o "infinit".
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
    }, [safeNotes, childrenMap, schema, handleCellSave]);

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
            // Usar axios per coherència amb el dashboard i per garantir el port correcte
            const res = await axios.post(`/api/vault/pages`, {
                title,
                content: '',
                parent_id: parentId,
                metadata: metadataWithDefaults
            });

            if (res.status === 200 || res.status === 201) {
                setExpandedRows(prev => new Set([...prev, parentId]));
                // Notificar al pare perquè recarregui les dades
                if (onUpdateView) onUpdateView(activeView);
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
                if (onUpdateView) {
                    
                    onUpdateView(activeView);
                }
                toast.success(t('table.record_created'));
            }
        } catch (error) {
            const errorMsg = error.response?.data?.detail || t('table.record_create_error');
            notifyError('table-create-record', error, errorMsg);
        }
    }, [newRowTitle, safeNotes, activeView, onUpdateView, schema, resolveNoteTableId]);

    // Catàlegs compartits d'opcions (registry arrel): un camp amb
    // config.catalog_ref hi resol la seva llista. Es carreguen un cop.
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

    // Catàleg ric d'un camp ({name,color,group}…), o [] si el camp deriva les
    // opcions dels valors (sense catàleg explícit).
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

    // Mapa nom → color per pintar els xips. Només per a opcions de catàleg
    // explícit: les derivades mantenen l'estil neutre del tema.
    const getOptionColorMap = (field) => {
        const map = {};
        for (const o of getCatalogOptions(field)) map[o.name] = o.color;
        return map;
    };

    const getAvailableOptions = (field, type) => {
        const catalog = getCatalogOptions(field);
        if (catalog.length > 0) return catalog.map((o) => o.name);
        const values = safeNotes
            .map(n => {
                const originalMetaKey = n.metadata ? (Object.keys(n.metadata).find(k => normalizeKey(k) === (aliasMap[normalizeKey(field)] ? normalizeKey(aliasMap[normalizeKey(field)]) : normalizeKey(field))) || field) : field;
                return n.metadata?.[originalMetaKey];
            })
            .filter(v => v !== undefined && v !== null && v !== '');
        // multi_select desa un array per fila: cal APLANAR a valors individuals,
        // no deduplicar arrays sencers (això mostrava "tag1tag2tag3" com una sola
        // opció). Accepta també cadenes CSV per compatibilitat.
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

    // Persisteix el catàleg d'opcions d'un camp select/multi_select/status al
    // schema (PATCH a la taula via el handler del dashboard). Resol el tableId
    // de la vista i el fieldId immutable del schema. Si no hi ha handler o no
    // es pot resoldre l'id, no fa res (el valor de la cel·la sí que es desa).
    const updateFieldOptions = (field, nextOptions) => {
        if (!onUpdateFieldOptions || !Array.isArray(nextOptions)) return;
        const tableId = activeView?.table_id || (safeNotes.length > 0 ? resolveNoteTableId(safeNotes[0]) : null);
        const fieldId = getFieldConfig(schema, field)?.id;
        if (!tableId || !fieldId) return;
        onUpdateFieldOptions(tableId, fieldId, nextOptions);
    };

    // Eliminació d'una opció estil Notion: la treu del catàleg I del valor de
    // TOTES les files que la tenen. La reescriptura la fa UNA crida al
    // servidor (mai N PATCHes des del client: esgoten el pool de BD i amaguen
    // errors parcials — feedback_bulk_ops_server_side). El patch optimista fa
    // que el canvi es vegi a l'instant a la taula.
    const removeOptionEverywhere = async (field, type, optionValue) => {
        const tableId = activeView?.table_id || (safeNotes.length > 0 ? resolveNoteTableId(safeNotes[0]) : null);
        const fieldId = getFieldConfig(schema, field)?.id;

        // Patch optimista sobre les files visibles que usen el valor.
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
                // Sense taula/field id resolubles (p. ex. vista de carpeta
                // llegada) no hi ha endpoint per-taula: només treu l'opció del
                // catàleg local si n'hi ha.
                const cfg = getFieldConfig(schema, field) || {};
                if (Array.isArray(cfg.options) && cfg.options.length > 0) {
                    updateFieldOptions(field, normalizeOptions(cfg.options).filter(o => o.name !== optionValue));
                }
            }
            if (onCellSaved) onCellSaved();
        } catch (err) {
            notifyError('remove-option-everywhere', err, t('table.remove_option_error', "Error eliminant l'opció dels registres"));
        }
    };

    // Autors únics ja presents a la taula per a aquest camp (autocompletar).
    // Dedup per nom|cognom1|cognom2; ignora autors completament buits.
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
            const columns = ['title', ...dynamicColumns.map(([k]) => k), 'last_modified'];
            const currentIndex = columns.indexOf(field);
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
            const nextOriginalMetaKey = nextNote?.metadata ? (Object.keys(nextNote.metadata).find(k => normalizeKey(k) === (aliasMap[normalizeKey(nextField)] ? normalizeKey(aliasMap[normalizeKey(nextField)]) : normalizeKey(nextField))) || nextField) : nextField;
            setEditingCell({ rowId: nextNoteId, field: nextField, originalMetaKey: nextOriginalMetaKey });
        }
    };

    // evaluateFormula(formula, METADATA, TITLE, options): cal passar la metadata
    // de la nota (no la nota sencera) i el títol per separat. Abans es passava
    // (formula, note, opts) → els camps no resolien ({Preu}→'') i prop('title')
    // tornava l'objecte d'opcions; ara {Preu}*{Quantitat} dona el resultat real.
    const calculateFormula = useCallback((formula, note) => evaluateFormula(
        formula,
        note?.metadata || {},
        note?.title || '',
        { notes: safeNotes, currentTableId: resolveNoteTableId(note), schema },
    ), [safeNotes, resolveNoteTableId, schema]);

    // evaluateRollup(values, aggregation) agrega una llista de valors JA recollits.
    // Abans es cridava (config, note, opts) → `values.map` petava ("values.map is
    // not a function"). Aquí recollim els valors dels registres relacionats (pels
    // ids de `relationField`, buscats a allNotes) i després agreguem.
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

        if (value.startsWith('/api/vault/assets/')) return value;
        if (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('data:image/')) return value;

        if (value.startsWith('Assets/')) return `/api/vault/assets/${value.slice('Assets/'.length)}`;
        if (value.startsWith('../Assets/')) return `/api/vault/assets/${value.slice('../Assets/'.length)}`;
        if (value.startsWith('./Assets/')) return `/api/vault/assets/${value.slice('./Assets/'.length)}`;

        const assetsIdx = value.indexOf('/Assets/');
        if (assetsIdx >= 0) return `/api/vault/assets/${value.slice(assetsIdx + '/Assets/'.length)}`;

        // Fallback: path relatiu dins del vault (ex: "Articles/foo.png") → servir des de /api/vault/assets/
        if (!value.startsWith('/') && !value.includes('://')) {
            return `/api/vault/assets/${value.replace(/^\.\//, '')}`;
        }

        return '';
    }, []);

    const isImageField = useCallback((field, fieldType) => {
        if (fieldType === 'files') return true;
        // Tipus `image` explícit: sempre miniatura, independentment del nom (el
        // render value-gateja amb la URL servible, igual que els camps inferits).
        if (fieldType === 'image') return true;
        // Només inferim imatge pel NOM en camps de text (o sense tipus declarat):
        // un camp explícitament number/date/select/relation/url/etc. mai és una
        // imatge inferida. Abans aquí es bloquejava QUALSEVOL camp amb tipus
        // declarat, cosa que també excloïa "Imatge" (tipus text) — ara només
        // l'exclusió per nom ([[isImageFieldName]]) separa "Imatge" (ruta) de
        // "Imatge Alt Text" (prosa). El render value-gateja amb la URL servible.
        if (fieldType && fieldType !== 'text') return false;
        return isImageFieldName(field);
    }, []);

    const urlToVaultPath = useCallback((url) => {
        if (!url) return '';
        const prefix = '/api/vault/assets/';
        if (url.startsWith(prefix)) return url.slice(prefix.length);
        return url;
    }, []);

    const getImagePreviewUrlFromValue = useCallback((rawValue) => {
        // Camp imatge COMPOST {src, alt, …}: extreu la ruta.
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

    // ── Graella: copiar / enganxar / navegació ───────────────────────────
    const openMediaPicker = useCallback((note, key, fieldType) => {
        const noteTableId = activeView?.table_id || resolveNoteTableId(note);
        const metaKey = getMetaKey(note, key);
        const cfg = fieldType === 'files' ? (getFieldConfig(schema, key) || {}) : null;
        const isImg = fieldType !== 'files'; // camp imatge detectat pel nom (no `files`)
        setMediaPickerCell({
            rowId: note.id, field: key, originalMetaKey: metaKey, tableId: noteTableId,
            fileField: cfg
                ? { propertyName: key, storageFolder: cfg.storage_folder || 'assets', namePattern: cfg.name_pattern || '', fileMode: cfg.file_mode || 'upload' }
                : null,
            imageField: isImg,
            imageMeta: isImg ? parseImageField(note.metadata?.[metaKey]) : null,
            rowMetadata: note.metadata || {},
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeView, resolveNoteTableId, schema]);

    // Recull els valors crus del rang seleccionat → matriu 2D de cel·les.
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

    // Propaga als pares (auto-completar/dates) després d'un enganxat en bloc:
    // replica el que `handleCellSave` fa per a edicions individuals, agregat
    // per (pare, camp) i amb `overrides` perquè el càlcul "tots els fills fets"
    // usi els valors acabats d'enganxar, no els antics.
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

    // Escriptura en bloc: 1 patch optimista + 1 PATCH per PÀGINA (agrupant les
    // claus de metadata), amb concurrència limitada per no inundar el backend
    // en seleccions grans, + propagació als pares + 1 sol refetch.
    const applyBulkCellUpdates = useCallback(async (updates) => {
        if (!updates || updates.length === 0) return;
        // Dedupe per id+key (l'última guanya).
        const map = new Map();
        for (const u of updates) map.set(`${u.id}::${u.key}`, u);
        const finalUpdates = [...map.values()];

        // Patch optimista: totes les claus de cada pàgina alhora.
        setOptimisticPatches(prev => {
            const next = new Map(prev);
            for (const u of finalUpdates) {
                const existing = next.get(u.id) || {};
                next.set(u.id, { ...existing, [u.key]: u.newValue });
            }
            return next;
        });

        // Agrupa per pàgina → 1 PATCH per pàgina amb múltiples claus.
        const byPage = new Map();
        for (const u of finalUpdates) {
            const m = byPage.get(u.id) || {};
            m[u.key] = u.newValue;
            byPage.set(u.id, m);
        }
        const pageEntries = [...byPage.entries()];

        // Concurrència limitada (chunks) per evitar una allau de requests.
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

        // Rollback de les pàgines que han fallat.
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
            notifyError('table-bulk-paste', new Error(`${failedPageIds.size} pages failed`), t('table.paste_error', { count: failedPageIds.size, defaultValue: `Error desant ${failedPageIds.size} pàgina(es)` }));
        }

        // Propaga als pares per als fills desats correctament (status/dates).
        const succeeded = finalUpdates.filter(u => !failedPageIds.has(u.id));
        await propagateBulkToParents(succeeded);

        if (onCellSaved) onCellSaved();
        else if (onUpdateView) onUpdateView(activeView);
    }, [onCellSaved, onUpdateView, activeView, t, propagateBulkToParents]);

    // Context de coerció per a una columna (opcions select/relation).
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

    // Mou el cursor (dRow/dCol) dins els límits; `extend` fixa l'àncora.
    // Tots els valors canviants (activeCell, navRows, etc.) es llegeixen via
    // refs per evitar reconstruir el callback —i re-registrar el listener
    // de teclat— a cada tecla premuda.
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
        // Scroll vertical només si canviem de fila (evita recalcular en moviments
        // purament horitzontals).
        if (nr !== rIdx && target.descriptorIndex != null && rowVirtualizer?.scrollToIndex) {
            rowVirtualizer.scrollToIndex(target.descriptorIndex, { align: 'auto' });
        }
        // Scroll horitzontal: fa visible la columna destí quan surt del viewport.
        // La col 0 és el `title`, sticky → sempre visible, no cal scroll-la. La
        // suma d'offsets comença a i=1 perquè l'amplada del títol ja és dins stickyW.
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

    // Obre l'editor de la cel·la activa (Enter / teclejar / segon clic).
    const beginEditActive = useCallback((initialChar = null) => {
        const cell = activeCellRef.current;
        if (!cell) return;
        const note = safeNotes.find(n => n.id === cell.rowId);
        if (!note) return;
        // El títol s'edita inline al seu propi <td> (no via renderCellContent).
        if (cell.field === 'title') {
            titlePreviewRef.current?.close(); // no tapar l'input amb el pop-up
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

    // Desa el títol (camp `note.title`, no metadata) amb el mateix patró
    // optimista que handleCellSave: override immediat + PATCH { title }.
    const saveTitle = useCallback(async (noteId, newTitle) => {
        setEditingCell(null);
        setEditInitial(null);
        const note = noteById.get(noteId);
        if (!note) return;
        const trimmed = String(newTitle ?? '').trim();
        if (trimmed === '' || trimmed === note.title) return; // no-op (buit no esborra el títol)
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
            // Mateix patró que handleCellSave: rollback de l'override optimista i
            // notifyError (registra context + missatge del backend) en lloc d'un
            // toast genèric, per poder diagnosticar 4xx/5xx i payload.detail.
            setOptimisticTitles(prev => { const n = new Map(prev); n.delete(noteId); return n; });
            notifyError('table-save-title', error, t('table.title_save_error', { defaultValue: 'No s\'ha pogut desar el títol' }));
        }
    }, [noteById, onCellSaved, t]);

    // Després de desar amb Enter, baixa el cursor una fila (estil Excel).
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

    // Navegació de teclat de la graella (a nivell de finestra: les files
    // virtualitzades es desmunten, no podem dependre del focus DOM per cel·la).
    // Tots els valors canviants s'accedeixen via refs per evitar desregistrar
    // i re-registrar el listener a cada tecla premuda (principal causa de lag).
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
    // Refs per a les dreceres d'acció de fila (handler muntat un sol cop).
    const rowActionsRef = useRef({});
    rowActionsRef.current = { noteById, onNoteSelect, onOpenParallel, onDeletePage, hasOpenableResource, handleOpenExternalResource };

    // ── Pont de navegació amb l'editor (només quan la taula està incrustada) ──
    // Callbacks de sortida + límits de la graella, llegits via ref pel listener
    // global (muntat un sol cop). Quan no s'incrusta, onExit* són null i el
    // comportament és el de sempre (les fletxes claven als extrems).
    const onExitTopRef = useRef(null); onExitTopRef.current = onExitTop;
    const onExitBottomRef = useRef(null); onExitBottomRef.current = onExitBottom;
    const tableEdgeRef = useRef({});
    tableEdgeRef.current = {
        firstRowId: navRows[0]?.id,
        lastRowId: navRows[navRows.length - 1]?.id,
        allLoaded: sortedNotes.length <= visibleRowsCount,
    };

    // Exposa a qui incrusta una API per "entrar" a la taula amb el teclat. En
    // fixar l'activeCell i treure el focus de l'editor (→ <body>), el listener
    // global de sota recull les fletxes (vegeu el guard `t === document.body`).
    useEffect(() => {
        if (!registerNavApi) return undefined;
        const focusEdge = (which) => {
            const rows = navRowsRef.current;
            const cols = gridColumnsRef.current;
            if (!rows.length || !cols.length) return false;
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
            // No segrestar tecles que no són per a la graella. Sense aquests
            // guards, amb una cel·la activa i un modal obert a sobre, cada
            // fletxa movia el cursor sota el modal i el preventDefault matava
            // el scroll natiu del modal; i una lletra o ⌫ amb focus al <body>
            // editava o buidava cel·les invisiblement (pèrdua de dades).
            if (e.defaultPrevented) return; // ja gestionada aigües amunt (p.ex. scroll del modal)
            if (document.body.classList.contains('gnosi-modal-open')) return;
            const t = e.target;
            // Tecles originades fora de la taula (focus dins d'un modal, el
            // sidebar…): no són nostres. El <body> sí (la navegació normal de
            // cel·les no deixa el focus dins del contenidor: files virtuals).
            if (t instanceof Element && t !== document.body && tableContainerRef.current && !tableContainerRef.current.contains(t)) return;
            const cell = activeCellRef.current;
            if (!cell || editingCellRef.current) return;
            const el = document.activeElement;
            const tag = el?.tagName;
            const inputType = (el && el.getAttribute) ? (el.getAttribute('type') || '') : '';
            const isTextInput = (tag === 'INPUT' && !['checkbox', 'radio', 'button', 'submit'].includes(inputType)) || tag === 'TEXTAREA' || el?.isContentEditable;
            if (isTextInput) return;
            // Les cel·les-checkbox són `<td tabIndex=0>` amb el seu propi
            // onKeyDown (Espai/Enter alternen). Si una té el focus, deixem-li
            // gestionar aquestes tecles per no alternar dues vegades.
            if (tag === 'TD' && (e.key === ' ' || e.key === 'Enter')) return;

            const meta = e.metaKey || e.ctrlKey;
            if (meta && (e.key === 'c' || e.key === 'C')) { e.preventDefault(); handleCopyCellsRef.current(); return; }
            if (meta && (e.key === 'v' || e.key === 'V')) { e.preventDefault(); handlePasteCellsRef.current(); return; }
            // ⌘/Ctrl+⌫ → elimina la fila del cursor (deliberat: ⌫ a soles buida
            // la cel·la). Només si no hi ha selecció múltiple de files.
            if (meta && (e.key === 'Backspace' || e.key === 'Delete')) {
                const { onDeletePage, noteById } = rowActionsRef.current;
                if (onDeletePage && selectedIdsRef.current.size === 0) {
                    const n = noteById.get(cell.rowId);
                    if (n) { e.preventDefault(); onDeletePage(n.id, n.title); }
                }
                return;
            }
            if (meta) return; // deixa ⌘A/⌘O als seus listeners

            // Dreceres d'acció sobre la fila del cursor (Alt+lletra; via e.code
            // perquè a Mac Alt+lletra produeix caràcters especials). No xoquen
            // amb el teclejar-per-editar (que ignora altKey).
            if (e.altKey && !e.shiftKey) {
                const { noteById, onNoteSelect, onOpenParallel, hasOpenableResource, handleOpenExternalResource } = rowActionsRef.current;
                const n = noteById.get(cell.rowId);
                if (e.code === 'KeyO') { e.preventDefault(); if (n && onNoteSelect) onNoteSelect(n.id); return; }
                if (e.code === 'KeyR') { e.preventDefault(); if (n && hasOpenableResource(n)) handleOpenExternalResource(n); return; }
                if (e.code === 'KeyP') { e.preventDefault(); if (n && onOpenParallel) onOpenParallel(n.id); return; }
            }

            switch (e.key) {
                case 'ArrowUp':
                    e.preventDefault();
                    // A la primera fila, ↑ surt cap a l'editor (sobre la vista).
                    if (onExitTopRef.current && !e.shiftKey && cell.rowId === tableEdgeRef.current.firstRowId) {
                        setActiveCell(null); setAnchorCell(null); onExitTopRef.current();
                    } else {
                        moveCursorRef.current(-1, 0, e.shiftKey);
                    }
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    // A l'última fila (i sense més per carregar), ↓ surt cap a
                    // l'editor (sota la vista).
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
                    e.preventDefault(); // evita scroll de la pàgina mentre navegues per cel·les
                    if (getFieldType(schemaRef.current, cell.field) === 'checkbox') { beginEditActiveRef.current(null); break; }
                    // Quick Look: Espai sobre la cel·la del títol obre/tanca el
                    // pop-up de previsualització, ancorat a la cel·la activa.
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
                case 'Escape': setActiveCell(null); setAnchorCell(null); break;
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
    }, []); // muntat una sola vegada; tots els valors accedits via refs

    const renderCellContent = (value, type, noteId, field, originalMetaKey) => {
        const isEditing = editingCell?.rowId === noteId && editingCell?.field === field;
        const note = noteById.get(noteId);
        const isManual = note?.metadata?.[`${originalMetaKey}_manual`];
        const isImageLikeField = isImageField(field, type);

        // Botó d'acció: el camp no té valor, sempre mostra el botó. En clicar
        // dispara l'acció configurada (ara mateix `translate_row`).
        if (type === 'button') {
            const cfg = getFieldConfig(schema, field) || {};
            const action = cfg.button_action || 'translate_row';
            const label = cfg.button_label?.trim() || (action === 'translate_row'
                ? t('schema.button_label_translate', 'Traduir')
                : field);
            const Icon = action === 'translate_row' ? Languages : Zap;
            return (
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        setPendingAction({ noteId, field, fieldConfig: cfg, action });
                    }}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)] border border-[var(--gnosi-primary)]/30 hover:bg-[var(--gnosi-primary)]/20 transition-colors"
                    title={label}
                >
                    <Icon size={12} />
                    {label}
                </button>
            );
        }

        // Camps de sistema (només lectura): Creat/Editat el (timestamps del
        // fitxer) i Creat/Editat per (autoria). En mode personal l'autor és
        // l'usuari únic; si la pàgina porta el valor desat (p. ex. d'un import),
        // es respecta.
        if (type === 'created_time' || type === 'last_edited_time') {
            // Prioritza el timestamp del fitxer; cau a la marca estampada al
            // frontmatter (created_at/last_edited_at) i, finalment, al camp.
            const iso = type === 'created_time'
                ? (note?.created_time || note?.metadata?.created_at || note?.metadata?.[field])
                : (note?.last_modified || note?.metadata?.last_edited_at || note?.metadata?.[field]);
            let label = '';
            if (iso) { try { label = new Date(iso).toLocaleDateString('ca-ES', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { label = String(iso).slice(0, 10); } }
            return <span className="text-sm text-[var(--text-tertiary)]">{label || '—'}</span>;
        }
        if (type === 'created_by' || type === 'last_edited_by') {
            // Autoria REAL estampada per pàgina (clau canònica), amb fallbacks.
            const canonical = note?.metadata?.[type];
            const stored = canonical || (value && String(value).trim()) || note?.metadata?.[field];
            const who = stored || currentUser?.name || currentUser?.email || '—';
            return <span className="text-sm text-[var(--text-secondary)]">{who}</span>;
        }

        if (isEditing) {
            if (type === 'status' || type === 'select') {
                const options = getAvailableOptions(field, type);
                // `status` és catàleg ESTRICTE (com Notion): ni crear opcions
                // inline des de la cel·la ni eliminar-les — es gestionen des
                // de l'editor d'opcions del modal de Camps. Els camps amb
                // catàleg compartit (catalog_ref) també: s'edita al catàleg.
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
                        type={type}
                        onChange={(newVal) => handleCellSave(noteId, field, newVal, originalMetaKey)}
                    />
                );
            }

            if (type === 'number') {
                // Desa un número real (no una cadena) perquè agregacions i
                // ordenacions siguin fiables; buit es desa com a ''.
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

        // Formula/rollup mostren sempre el seu xip (amb "0" si cal), no el guió:
        // així un resultat buit i un resultat 0 es rendereixen igual.
        const isEmptyValue = value === undefined || value === null || value === '';
        if (isEmptyValue && type !== 'formula' && type !== 'rollup') {
            if (type === 'checkbox') {
                return <div className="w-4 h-4 border border-[var(--border-primary)] rounded-sm"></div>;
            }
            if (type === 'files') {
                return <span className="text-[var(--text-tertiary)] italic">{t('table.add_files', { defaultValue: '+ Arxius' })}</span>;
            }
            if (isImageLikeField) {
                return <span className="text-[var(--text-tertiary)] italic">{t('table.add_image', { defaultValue: '+ Imatge' })}</span>;
            }
            return <span className="text-[var(--text-tertiary)]">-</span>;
        }

        switch (type) {
            case 'checkbox':
                return (value && value !== 'false') ? <CheckSquare size={16} className="text-indigo-500" /> : <div className="w-4 h-4 border border-[var(--border-primary)] rounded-sm"></div>;
            case 'number': {
                const fmt = resolveFieldFormat(getFieldConfig(schema, field), localeSettings);
                return (
                    <span className="tabular-nums" title={String(value)}>
                        {formatNumber(value, { kind: fmt.kind, decimals: fmt.decimals, currencyCode: fmt.currencyCode, locale: fmt.numberLocale })}
                    </span>
                );
            }
            case 'virtual': {
                // Camp derivat injectat pel backend (read-only). Booleans
                // (is_hub/is_orphan) → checkbox; numèrics (Progrés %, centralitat…)
                // → formatNumber amb el format del camp.
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
                const parsed = new Date(value);
                if (isNaN(parsed.getTime())) {
                    // Valor corrupte: mostrem el text cru en comptes de "Invalid Date".
                    return <span className="truncate max-w-[200px] block text-[var(--text-tertiary)]" title={String(value)}>{String(value)}</span>;
                }
                const fmt = resolveFieldFormat(getFieldConfig(schema, field), localeSettings);
                return (
                    <div className="flex items-center gap-1.5 whitespace-nowrap text-[var(--text-primary)]">
                        {type === 'datetime' ? <Clock size={14} className="text-[var(--text-tertiary)]" /> : <Calendar size={14} className="text-[var(--text-tertiary)]" />}
                        <span>{formatDate(value, { dateFormat: fmt.dateFormat, type, locale: fmt.dateLocale })}</span>
                    </div>
                );
            }
            case 'period': {
                const [start, end] = String(value).split('/');
                const fmt = resolveFieldFormat(getFieldConfig(schema, field), localeSettings);
                // Mode 'locale' → compacte (dia + mes curt, sense any) per no inflar
                // el xip; un format explícit (DD/MM/YYYY…) es respecta tal qual.
                const fmtPeriodDate = (d) => {
                    if (!d) return '?';
                    if (fmt.dateFormat && fmt.dateFormat !== 'locale') return formatDate(d, { dateFormat: fmt.dateFormat, type: 'date', locale: fmt.dateLocale });
                    return new Date(d).toLocaleDateString(fmt.dateLocale || i18n.language, { day: '2-digit', month: 'short' });
                };
                const days = periodDaysInclusive(start, end);
                return (
                    <div className="flex items-center gap-1 text-[11px] font-medium text-[var(--text-secondary)] bg-[var(--bg-tertiary)] px-1.5 py-0.5 rounded border border-[var(--border-primary)] w-fit">
                        <span>{fmtPeriodDate(start)}</span>
                        <span className="text-[var(--text-tertiary)]">→</span>
                        <span>{fmtPeriodDate(end)}</span>
                        {days != null && (
                            <span className="text-[var(--text-tertiary)] ml-0.5" title={t('table.period_days', { count: days, defaultValue: '{{count}} dies' })}>· {days} d</span>
                        )}
                    </div>
                );
            }
            case 'status':
            case 'select': {
                // Color de catàleg (si l'opció en té): xip pintat; si no,
                // l'estil neutre del tema de sempre.
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
            case 'multi_select':
            case 'relation': {
                const items = Array.isArray(value) ? value : String(value).split(',').map(s => s.trim()).filter(Boolean);
                const displayMap = type === 'relation' ? getRelationContext(field).displayMap : idToTitle;
                const colorMap = type === 'multi_select' ? getOptionColorMap(field) : {};
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
                                    {displayMap[it] || (it.length > 20 ? it.substring(0, 8) + '...' : it)}
                                </span>
                            );
                        })}
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
                    return <span className="text-[var(--text-tertiary)] italic">{t('table.add_image', { defaultValue: '+ Imatge' })}</span>;
                }
                return <span className="truncate max-w-[200px] block" title={value}>{value}</span>;
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
            // Parse tolerant amb el decimal de COMA (locale ca/es): "0,25" → 0.25.
            // `Number("0,25")` és NaN, així que la suma/mitjana/min/max d'una
            // columna number en format català excloïa els valors amb coma (total
            // i mitjana falsos: comptava menys files de les que hi ha).
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
                    const dates = values.map(v => new Date(String(v).split('/')[0])).filter(d => !isNaN(d));
                    return dates.length ? formatAggDate(new Date(Math.min(...dates))) : '-';
                }
                if (func === 'latest') {
                    const dates = values.map(v => new Date((String(v).split('/')[1] || String(v).split('/')[0]))).filter(d => !isNaN(d));
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
    // `rootRowId` propaga l'id del root note per recursió: tots els
    // `<tr>`s d'un mateix root (pare + children expandits + nou-subitem)
    // duen `data-row-id={rootRowId}`. Això permet al `measureElement`
    // del virtualizer sumar les seves alçades reals per saber l'espai
    // ocupat per l'expansió completa, no només el pare.
    // Renderitza un sol `<tr>` (root o child). Per virtualizacio 1:1
    // entre virtual items i `<tr>`, aquesta funcio NO renderitza ni la
    // recursio a children ni el form de nou subitem: aquests es generen
    // com a descriptors separats (vegeu `rowDescriptors` mes avall) i
    // tenen els seus propis renderers.
    const renderRow = (note, isChild = false, depth = 0, rowPath = '0', virtualItem = null) => {
        const hasChildren = (childrenMap[note.id]?.length > 0);
        const isExpanded = expandedRows.has(note.id);
        // El títol és una cel·la navegable de la graella (col 0): estat del cursor
        // i de l'editor inline.
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
        // Obre l'editor inline del títol (paral·lel a `openEditor` de les
        // cel·les de metadades). El títol viu a note.title → originalMetaKey
        // 'title' i camí d'escriptura propi (saveTitle).
        const openTitleEditor = () => {
            titlePreviewRef.current?.close(); // no tapar l'input amb el pop-up
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
                    onDoubleClick={() => onNoteSelect(note.id)}
                    draggable
                    onDragStart={(e) => {
                        // No segrestar la selecció de text dins d'editors inline.
                        if (editingCell || e.target.closest?.('input, textarea, button, a, label, select, [contenteditable="true"]')) {
                            e.preventDefault();
                            return;
                        }
                        // Mateix protocol que la sidebar: el llenç (page-card) i
                        // l'editor (wikilink) ja accepten aquest tipus.
                        e.dataTransfer.setData('application/gnosi-note', JSON.stringify({ id: note.id, title: note.title }));
                        e.dataTransfer.effectAllowed = 'copy';
                    }}
                >
                    {/* Acció cel·la */}
                    <td className={`w-10 px-2 sticky left-0 z-20 hover:z-50 text-center align-top pt-2.5 ${isSelected(note.id) ? 'bg-indigo-50 dark:bg-indigo-950' : isChild ? 'bg-[var(--bg-secondary)]' : 'bg-[var(--bg-primary)]'}`}>
                        <div className="flex items-center justify-center gap-0.5">
                            {/* Checkbox de selecció */}
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
                                onClick={(e) => { e.stopPropagation(); onNoteSelect(note.id); }}
                                className={`relative p-1 text-[var(--text-tertiary)] hover:text-indigo-600 transition-colors ${selectedIds.size > 0 ? 'hidden' : 'block'}`}
                                title={t('common.open')}
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
                                    title={t('table.open_resource_tooltip')}
                                >
                                    <LinkIcon size={14} />
                                    <span className="row-action-tooltip">{t('table.open_resource_tooltip')}<kbd>⌥R</kbd></span>
                                </button>
                            )}
                            {onOpenParallel && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); onOpenParallel(note.id); }}
                                    className="relative p-1 text-[var(--text-tertiary)] hover:text-purple-600 transition-colors opacity-60 hover:opacity-100"
                                    title={t('table.open_parallel')}
                                >
                                    <Columns2 size={14} />
                                    <span className="row-action-tooltip">{t('table.open_parallel')}<kbd>⌥P</kbd></span>
                                </button>
                            )}
                            {isTranslatableTable && !isListView && !note.metadata?.translation_lang && (() => {
                                // Salvaguarda d'action_rules: botó VISIBLE però
                                // desactivat amb el motiu (p. ex. esborranys),
                                // en lloc d'amagar-lo. El backend revalida (409).
                                const gate = checkActionRequires(schema, note.metadata || {}, 'translate_row', actionRules);
                                return (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if (!gate.ok) return;
                                            // Reutilitza el mateix flux que el camp `button`:
                                            // obre TranslateLanguagesModal en mode fila (subitems).
                                            setPendingAction({
                                                noteId: note.id,
                                                fieldConfig: { button_action: 'translate_row' },
                                                action: 'translate_row',
                                            });
                                        }}
                                        disabled={!gate.ok}
                                        className={`relative p-1 transition-colors opacity-0 group-hover/row:opacity-100 ${gate.ok ? 'text-[var(--text-tertiary)] hover:text-[var(--gnosi-primary)]' : 'text-[var(--text-tertiary)]/40 cursor-not-allowed'}`}
                                        title={gate.ok ? t('table.translate_row', 'Traduir') : gate.reason}
                                    >
                                        <Languages size={14} />
                                        <span className="row-action-tooltip">{gate.ok ? t('table.translate_row', 'Traduir') : gate.reason}</span>
                                    </button>
                                );
                            })()}
                            {isDrupalSyncTable && !isListView && !note.metadata?.translation_lang && (() => {
                                const gate = checkActionRequires(schema, note.metadata || {}, 'sync_drupal', actionRules);
                                const label = note.metadata?.drupal_uuid ? t('table.sync_drupal_update', 'Actualitzar a Drupal') : t('table.sync_drupal', 'Sincronitzar amb Drupal');
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
                                        title={gate.ok ? label : gate.reason}
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
                                        title={gate.ok ? t('table.publish_social', 'Publicar a XXSS') : gate.reason}
                                    >
                                        <Send size={14} />
                                        <span className="row-action-tooltip">{gate.ok ? t('table.publish_social', 'Publicar a XXSS') : gate.reason}</span>
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
                                    title={t('table.delete')}
                                >
                                    <Trash2 size={14} />
                                    <span className="row-action-tooltip">{t('table.delete')}<kbd>⌘⌫</kbd></span>
                                </button>
                            )}
                        </div>
                    </td>

                    <td
                        data-title-cell={note.id}
                        style={{ width: columnWidths['title'] || 250, maxWidth: columnWidths['title'] || 250 }}
                        className={`${rowPadClass} px-4 font-medium text-[var(--text-primary)] sticky left-10 z-30 overflow-hidden align-top
                            ${titleSel.inRange && !titleSel.isActive ? 'bg-[var(--gnosi-primary)]/10' : isSelected(note.id) ? 'bg-indigo-50 dark:bg-indigo-950' : isChild ? 'bg-[var(--bg-secondary)]' : 'bg-[var(--bg-primary)]'}
                            ${isListView ? 'group-hover:bg-[var(--bg-secondary)]' : 'border-r border-[var(--border-primary)] shadow-[2px_0_5px_-2px_rgba(0,0,0,0.02)]'}
                            ${titleSel.isActive ? 'shadow-[inset_0_0_0_2px_var(--gnosi-primary)]' : ''}`}
                        onClick={(e) => {
                            e.stopPropagation();
                            // Mateix model que la resta de cel·les: clic sobre la cel·la
                            // ja activa (sense Shift) obre l'editor inline del títol; si no,
                            // només mou el cursor. Obrir la fitxa = botons de l'esquerra
                            // o Alt+O (ja no el clic/doble-clic al títol).
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
                                        ? t('table.translation_stale', "L'original ha canviat — torna a traduir per actualitzar")
                                        : t('table.translation_badge', 'Traducció')}
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
                        // Mateixa lògica de "marcat" que el render: truthy, però sense
                        // confondre la cadena 'false' amb un valor vertader.
                        const checkboxChecked = !!val && val !== 'false';
                        const toggleCheckbox = () => handleCellSave(note.id, key, !checkboxChecked, originalMetaKey);
                        const sel = getCellSelState(note.id, key);
                        // Clic = posa el cursor (selecciona); segon clic / doble-clic /
                        // Enter / teclejar = edita. Així ⌘C copia la cel·la, no el text d'un input.
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
                                    // Shift+clic estén la selecció rectangular des de la cel·la activa.
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

    // Renderitza el `<tr>` del formulari "nou subitem". Es un descriptor
    // virtual independent del seu pare; aixi virtualizer es manté 1:1
    // amb els `<tr>`s.
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

    // Capçalera de grup (agrupació de files): un `<tr>` virtual amb una sola
    // cel·la `colSpan` que abasta tota la taula. El contingut (chevron +
    // punt de color + nom + comptador) va dins un `<div sticky left-0>` perquè
    // es mantingui visible en fer scroll horitzontal, com la columna de títol.
    const renderGroupHeader = (d, virtualItem) => {
        const collapsed = collapsedGroups.has(d.groupKey);
        return (
            <tr
                key={`group-${d.groupKey}-${virtualItem.index}`}
                data-index={virtualItem.index}
                ref={rowVirtualizer.measureElement}
                className="border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]"
            >
                <td colSpan={dynamicColumns.length + 3} className="p-0 bg-[var(--bg-secondary)]">
                    <div className="sticky left-0 z-10 inline-flex items-center w-max max-w-[calc(100vw-2rem)]">
                        <button
                            type="button"
                            onClick={() => toggleGroup(d.groupKey)}
                            className="flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--bg-tertiary)] transition-colors w-full"
                            title={collapsed ? t('common.expand', 'Desplega') : t('common.collapse', 'Replega')}
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

    // Peu de grup: subtotals per columna calculats sobre les notes del grup,
    // amb les MATEIXES agregacions que l'usuari ha triat al peu de la taula.
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
                className="border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]/60 text-[11px] text-[var(--text-secondary)]"
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
                    />
                )}

                {/* `maxHeight`: mode adaptatiu (embed). El scroller pren l'alçada
                    del contingut i només fa scroll quan supera el màxim — la
                    virtualització segueix funcionant perquè max-height és una
                    fita real. Sense `maxHeight` (taula a pantalla completa)
                    s'usa `flex-1` per omplir l'alçada del pare. */}
                <div
                    ref={tableContainerRef}
                    style={maxHeight ? { maxHeight } : undefined}
                    className={`bg-[var(--bg-primary)] overflow-auto custom-scrollbar ${maxHeight ? '' : 'flex-1'} ${isEmbedded ? 'rounded border border-[var(--border-primary)] shadow-sm' : 'border-none shadow-none'} ${isListView ? 'border-none shadow-none' : ''}`}>

                    <table className="text-left text-sm text-[var(--text-secondary)] whitespace-nowrap" style={{ tableLayout: 'fixed', width: 'max-content' }}>
                        {!isListView && (
                            <thead className="bg-[var(--bg-secondary)] border-b border-[var(--border-primary)] text-[var(--text-secondary)] font-semibold select-none group/table sticky top-0 z-40">
                                <tr>
                                    <th className="w-10 px-2 sticky left-0 bg-[var(--bg-secondary)] z-40 border-r border-[var(--border-primary)]">
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
                                    <th
                                        style={{ width: columnWidths['title'] || 250 }}
                                        className="py-3 px-4 sticky left-10 bg-[var(--bg-secondary)] z-40 border-r border-[var(--border-primary)] shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)] hover:bg-[var(--bg-tertiary)] transition-colors group relative"
                                    >
                                        <div className="flex items-center justify-between cursor-pointer overflow-hidden text-[var(--text-secondary)]" onClick={() => handleSort('title')}>
                                            <span className="truncate">{Object.entries(schema || {}).find(([, t]) => t === 'title')?.[0] || t('table.note_name')}</span>
                                            {activeSort.field === 'title' && (
                                                activeSort.direction === 'asc' ? <ArrowUp size={14} className="text-indigo-500 shrink-0" /> : <ArrowDown size={14} className="text-indigo-500 shrink-0" />
                                            )}
                                        </div>
                                        <div
                                            className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-[var(--gnosi-primary)]/40 opacity-0 group-hover/table:opacity-100 z-30 transition-opacity"
                                            onMouseDown={(e) => handleMouseDown(e, 'title')}
                                        />
                                    </th>
                                    {dynamicColumns.map(([key, type]) => (
                                        <th
                                            key={key}
                                            style={{ width: columnWidths[key] || 180 }}
                                            onDragOver={canReorderColumns ? (e) => handleColumnDragOver(e, key) : undefined}
                                            onDrop={canReorderColumns ? (e) => handleColumnDrop(e, key) : undefined}
                                            className={`py-3 px-4 hover:bg-[var(--bg-tertiary)] transition-colors group relative border-r border-[var(--border-primary)] ${draggedColumn === key ? 'opacity-40' : ''}`}
                                        >
                                            {/* Indicador de drop: línia vertical al costat on caurà la columna. */}
                                            {dragOverColumn === key && draggedColumn && draggedColumn !== key && (
                                                <div className={`pointer-events-none absolute top-0 bottom-0 ${dropAfter ? 'right-0' : 'left-0'} w-0.5 bg-[var(--gnosi-primary)] z-40`} />
                                            )}
                                            {/* Només aquest div és arrossegable: el tirador de resize (germà, fora
                                                d'aquest subarbre) no inicia mai una reordenació de columnes. A la
                                                vista principal canReorderColumns és false → sense drag (no persistiria). */}
                                            <div
                                                draggable={canReorderColumns}
                                                onDragStart={canReorderColumns ? (e) => handleColumnDragStart(e, key) : undefined}
                                                onDragEnd={canReorderColumns ? clearColumnDrag : undefined}
                                                className={`flex items-center gap-1.5 justify-between overflow-hidden text-[var(--text-secondary)] ${canReorderColumns ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}`}
                                                onClick={() => handleSort(key)}
                                            >
                                                <div className="flex items-center gap-1.5 truncate">
                                                    {type === 'checkbox' && <CheckSquare size={14} className="text-[var(--text-tertiary)] shrink-0" />}
                                                    {type === 'date' && <Calendar size={14} className="text-[var(--text-tertiary)] shrink-0" />}
                                                    {(type === 'status' || type === 'select') && <Type size={14} className="text-[var(--text-tertiary)] shrink-0" />}
                                                    {(type === 'multi_select' || type === 'relation') && <Tag size={14} className="text-[var(--text-tertiary)] shrink-0" />}
                                                    <span className="truncate">{key}</span>
                                                </div>
                                                {activeSort.field === key && (
                                                    activeSort.direction === 'asc' ? <ArrowUp size={14} className="text-indigo-500 shrink-0" /> : <ArrowDown size={14} className="text-indigo-500 shrink-0" />
                                                )}
                                            </div>
                                            <div
                                                className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-[var(--gnosi-primary)]/40 opacity-0 group-hover/table:opacity-100 z-30 transition-opacity"
                                                onMouseDown={(e) => handleMouseDown(e, key)}
                                            />
                                        </th>
                                    ))}
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
                            {/* Spacer superior pel padding del virtualizer. */}
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
                            <tfoot className="bg-[var(--bg-secondary)] border-t border-[var(--border-primary)] text-[11px] text-[var(--text-secondary)] font-medium">
                                <tr>
                                    <td className="w-10 sticky left-0 bg-[var(--bg-secondary)] z-20 border-r border-[var(--border-primary)]"></td>
                                    <td className="py-2 px-4 sticky left-10 bg-[var(--bg-secondary)] z-20 border-r border-[var(--border-primary)] shadow-[2px_0_5px_-2px_rgba(0,0,0,0.02)]">
                                        <div className="flex flex-col">
                                            <select
                                                className="bg-transparent border-none p-0 focus:ring-0 cursor-pointer hover:text-indigo-600"
                                                value={aggregations['title'] || 'none'}
                                                onChange={(e) => setAggregations({ ...aggregations, title: e.target.value })}
                                            >
                                                <option value="none">({t('table.none')})</option>
                                                <option value="count">Count</option>
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
                                                    <option value="count">Count</option>
                                                    {(type === 'number' || type === 'formula' || type === 'rollup') && (
                                                        <>
                                                            <option value="sum">Sum</option>
                                                            <option value="avg">Avg</option>
                                                            <option value="min">Min</option>
                                                            <option value="max">Max</option>
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
                                                    <option value="count">Count</option>
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
                // key per FILA: reobrir el modal sobre una altra fila REMUNTA la
                // instància (estat i promeses en curs moren amb el seu context).
                // Sense això, una pujada llarga iniciada en una fila sobreviu a
                // tancar/reobrir i qualsevol lectura de props "actuals" pot
                // inserir el resultat a la fila equivocada (vist 2026-06-09:
                // adjunt d'«El camí de tornada» escrit a «Un viaje inexperado»).
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
                    // Només metadades (alt/títol/…): conserva el src actual del camp.
                    if (result?.metadataOnly) {
                        const note = safeNotes.find(n => n.id === rowId);
                        const currentSrc = getImageSrc(note?.metadata?.[originalMetaKey]);
                        if (currentSrc) {
                            handleCellSave(rowId, field, buildImageValue(currentSrc, result.imageMeta || {}), originalMetaKey);
                        }
                        setMediaPickerCell(null);
                        return;
                    }
                    // Multi-fitxer (camp `files`): afegeix TOTES les URLs d'una sola
                    // vegada (evita la cursa d'afegir-les una a una via N onInsert),
                    // DEDUPLICANT amb la clau canònica (file:// ≡ absoluta ≡ ~/ ≡
                    // servida): repetir un enllaç/pujada no duplica entrades.
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
                    // Els camps `files` són multi-fitxer: afegim a la llista existent.
                    // (Els camps d'imatge detectats pel nom són d'un sol valor → reemplacen.)
                    if (newPath && getFieldType(schema, field) === 'files') {
                        const note = safeNotes.find(n => n.id === rowId);
                        const existing = note?.metadata?.[originalMetaKey];
                        const arr = (Array.isArray(existing) ? existing : (existing ? [existing] : []))
                            .map(v => String(v ?? '')).filter(v => v.trim() !== '');
                        // Mateix fitxer ja present (en qualsevol format) → no dupliquis.
                        const newKey = fileTargetKey(newPath);
                        if (arr.some(v => fileTargetKey(v) === newKey)) {
                            setMediaPickerCell(null);
                            return;
                        }
                        const next = [...arr, newPath];
                        value = next.length === 1 ? next[0] : next;
                    } else if (newPath) {
                        // Camp imatge: valor compost {src, alt, title, …} si hi ha metadades.
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
                            {t('files.delete_title', { defaultValue: 'Eliminar fitxer' })}
                        </h2>
                        <p className="text-sm text-[var(--text-secondary)] mb-4 break-words">
                            {t('files.delete_question', { defaultValue: 'Què vols fer amb «{{name}}»?', name: fileDeletePrompt.fileName })}
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
                                {t('files.delete_link_only', { defaultValue: "Treure només l'enllaç (no esborra el fitxer)" })}
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
                                            ? t('files.trashed', { defaultValue: 'Fitxer mogut a la Paperera' })
                                            : t('files.deleted', { defaultValue: 'Fitxer eliminat' }));
                                        setFileDeletePrompt(null);
                                    } catch (err) {
                                        toast.error(t('files.delete_error', { defaultValue: "No s'ha pogut eliminar el fitxer: {{msg}}", msg: err.message }));
                                    } finally {
                                        setFileDeleteBusy(false);
                                    }
                                }}
                                className="w-full text-left px-3 py-2 rounded-lg border border-red-500/30 bg-red-500/5 hover:bg-red-500/10 text-sm text-red-600 disabled:opacity-50"
                            >
                                {t('files.delete_physical', { defaultValue: 'Eliminar també el fitxer (a la Paperera)' })}
                            </button>
                            <button
                                type="button"
                                disabled={fileDeleteBusy}
                                onClick={() => setFileDeletePrompt(null)}
                                className="w-full px-3 py-2 rounded-lg hover:bg-[var(--bg-secondary)] text-sm text-[var(--text-secondary)] disabled:opacity-50"
                            >
                                {t('common.cancel', { defaultValue: 'Cancel·lar' })}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {titlePreview.preview}
        </div>
    );
};
