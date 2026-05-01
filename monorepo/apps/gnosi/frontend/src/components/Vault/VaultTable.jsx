import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Tag, Clock, Hash, CheckSquare, Calendar, Link as LinkIcon, Type, ArrowUp, ArrowDown, Settings, Settings2, Plus, ChevronDown, ChevronRight, ExternalLink, Search, X, Trash2, Filter, List, LayoutPanelLeft, Unlock, Columns2, LayoutTemplate } from 'lucide-react';
import { IconRenderer } from './IconRenderer';
import { VaultDateProperty } from './VaultDateProperty';

const InlinePillsPicker = ({ value = [], options = [], idToTitle = {}, onSave }) => {
    const [localValues, setLocalValues] = useState(value);
    const [search, setSearch] = useState('');
    const containerRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (e) => {
            if (containerRef.current && !containerRef.current.contains(e.target)) {
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
        (idToTitle[opt] || opt).toLowerCase().includes(search.toLowerCase()) &&
        !localValues.includes(opt)
    );

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
                placeholder="Cercar…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => { if (e.key === 'Escape') onSave(localValues); }}
            />
            {filtered.length > 0 && (
                <div className="mt-1 max-h-32 overflow-y-auto custom-scrollbar border border-[var(--border-primary)] rounded bg-[var(--bg-primary)] shadow-md z-50 relative">
                    {filtered.map(opt => (
                        <div
                            key={opt}
                            className="px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--gnosi-primary)]/10 hover:text-[var(--gnosi-primary)] cursor-pointer"
                            onMouseDown={e => { e.preventDefault(); toggle(opt); }}
                        >
                            {idToTitle[opt] || opt}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
import { useVaultViewData } from '../../hooks/useVaultViewData';
import { VaultViewToolbar } from './VaultViewToolbar';
import { evaluateFormula } from './formulaUtils';
import { evaluateRollup } from './rollupUtils';
import { getFieldConfig, getFieldType, getSchemaFieldEntries } from './schemaUtils';
import { applyDefaultFormulasToMetadata } from './defaultFormulaUtils';
import { isMainView } from './viewConstants';
import { useVaultSelection } from '../../hooks/useVaultSelection';
import { useVaultSelectionShortcuts } from '../../hooks/useVaultSelectionShortcuts';
import { VaultBulkActionsBar } from './VaultBulkActionsBar';
import axios from 'axios';
import { toast } from 'react-hot-toast';
import { notifyError, logError } from '../../lib/notifyError';

export function VaultTable({ notes, templates = [], onNoteSelect, schema = {}, idToTitle = {}, allNotes = [], activeView, onUpdateView, isEmbedded = false, onEditSchema, isListView = false, onCreateRecord, onCreateTemplate, onDuplicateTemplate, onSetDefaultTemplate, onDeletePage, onDeleteSelected, onCellSaved, onOpenParallel, searchTerm: searchTermProp, onSearchChange }) {
    const { t, i18n } = useTranslation();
    const safeNotes = notes || [];
    const ROWS_BATCH_SIZE = 200;

    // State for column widths
    const [columnWidths, setColumnWidths] = useState({
        title: 250,
        last_modified: 150
    });

    // Refs for drag state
    const resizingCol = useRef(null);
    const startX = useRef(0);
    const startWidth = useRef(0);

    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [editingCell, setEditingCell] = useState(null); // { rowId, field, activeMetaKey }
    const [aggregations, setAggregations] = useState({}); // { field: 'sum' | 'avg' | 'count' | 'none' }
    const [internalSearchTerm, setInternalSearchTerm] = useState('');
    const searchTerm = searchTermProp !== undefined ? searchTermProp : internalSearchTerm;
    const setSearchTerm = onSearchChange || setInternalSearchTerm;
    const [expandedRows, setExpandedRows] = useState(new Set()); // IDs of expanded rows
    const [newSubitemTitle, setNewSubitemTitle] = useState(''); // title for the new inline subitem
    const [addingSubitemFor, setAddingSubitemFor] = useState(null); // parent ID for adding a subitem
    const [openingResourceId, setOpeningResourceId] = useState(null);
    const [visibleRowsCount, setVisibleRowsCount] = useState(ROWS_BATCH_SIZE);
    const [newRowTitle, setNewRowTitle] = useState('');
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
    const activeSort = activeView?.sort || { field: "last_modified", direction: "desc" };

    const viewConfig = {
        filters: activeView?.filters || [],
        sort: activeSort.field ? [activeSort] : [],
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

    const handleSort = (field) => {
        if (!activeView || !onUpdateView) return;
        const isCurrentField = activeView.sort?.field === field;
        const currentDirection = activeView.sort?.direction;
        let newDirection = 'asc';
        if (isCurrentField) {
            newDirection = currentDirection === 'asc' ? 'desc' : 'asc';
        }
        const updatedView = { ...activeView, sort: { field, direction: newDirection } };
        onUpdateView(updatedView);
    };

    // Strip schema by removing title to put it at the beginning and filtering by visibility
    const dynamicColumns = useMemo(() => {
        const titleFieldName = Object.entries(schema || {}).find(([, t]) => t === 'title')?.[0];
        const forceAllProperties = isMainView(activeView, [activeView].filter(Boolean));
        const baseFields = (!forceAllProperties && activeView?.visibleProperties)
            ? activeView.visibleProperties.map(key => [key, getFieldType(schema, key)]).filter(([key, type]) => key && type)
            : getSchemaFieldEntries(schema).filter(([key, type]) => type !== 'title');
        
        // Ensure the field used as title is not duplicated
        return baseFields.filter(([key]) => key !== titleFieldName);
    }, [activeView, schema]);

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
        }
    }, []);

    useEffect(() => {
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [handleMouseMove, handleMouseUp]);

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

    useEffect(() => {
        const handleOutsideDropdownListClose = () => { setDropdownOpenTpl(null); };
        window.addEventListener('scroll', handleOutsideDropdownListClose, true);
        window.addEventListener('click', handleOutsideDropdownListClose);
        return () => {
            window.removeEventListener('scroll', handleOutsideDropdownListClose, true);
            window.removeEventListener('click', handleOutsideDropdownListClose);
        };
    }, []);

    const hasOpenableResource = useCallback((note) => {
        const metadata = note?.metadata || {};
        const zoteroUri = String(getMetadataValueByNormalizedKey(metadata, ['Zotero uri', 'zotero_uri', 'zotero uri'])).trim();
        const filePath = String(getMetadataValueByNormalizedKey(metadata, ["Ruta de l'arxiu", 'ruta_arxiu', 'file_path', 'path'])).trim();
        const attachments = getMetadataValueByNormalizedKey(metadata, ['Adjunts', 'attachments', 'adjuntos']);
        return Boolean(zoteroUri || filePath || attachments);
    }, [getMetadataValueByNormalizedKey]);

    const [dropdownOpenTpl, setDropdownOpenTpl] = useState(null);
    const addMenuActions = useMemo(() => {
        const actions = [];

        if (onCreateRecord) {
            actions.push({
                key: 'new-record',
                label: t('table.new_record'),
                icon: Plus,
                onClick: () => onCreateRecord(null)
            });
        }

        const hasTemplates = Array.isArray(templates) && templates.length > 0 && onCreateRecord;
        if (hasTemplates || onCreateTemplate) {
            actions.push({ type: 'separator' });
            actions.push({
                type: 'section',
                key: 'templates-section',
                label: t('table.templates'),
                icon: LayoutTemplate
            });
        }

        if (hasTemplates) {
            templates
                .slice()
                .sort((a, b) => {
                    if (a.metadata?.is_default_template) return -1;
                    if (b.metadata?.is_default_template) return 1;
                    return String(a?.title || '').localeCompare(String(b?.title || ''));
                })
                .forEach((template) => {
                    const isDefault = template.metadata?.is_default_template;
                    actions.push({
                        key: `tpl-${template.id}`,
                        label: (
                            <span className="flex items-center gap-2 relative w-full justify-between">
                                <span className="flex items-center gap-1 truncate font-medium">
                                    {template.title || t('common.untitled')}
                                    {isDefault && <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1 rounded uppercase tracking-wider ml-1">{t('table.default_label')}</span>}
                                </span>
                                <div className="relative group shrink-0">
                                    <button
                                        className="p-1 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-700 transition-colors"
                                        onClick={e => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            if (dropdownOpenTpl && dropdownOpenTpl.id === template.id) {
                                                setDropdownOpenTpl(null);
                                            } else {
                                                const rect = e.currentTarget.getBoundingClientRect();
                                                setDropdownOpenTpl({
                                                    id: template.id,
                                                    top: rect.bottom + window.scrollY,
                                                    right: window.innerWidth - rect.right
                                                });
                                            }
                                        }}
                                        title={t('table.options')}
                                    >
                                        <span style={{fontSize: '18px'}}>...</span>
                                    </button>
                                    {/* The dropdown portal handles rendering instead of inline */}
                                </div>
                            </span>
                        ),
                        icon: LayoutTemplate,
                        onClick: () => onCreateRecord(template.id)
                    });
                });
        }

        if (onCreateTemplate) {
            actions.push({
                key: 'new-template',
                label: t('common.new_template'),
                icon: LayoutTemplate,
                onClick: onCreateTemplate
            });
        }

        return actions;
    }, [onCreateRecord, onCreateTemplate, templates, dropdownOpenTpl, onDeletePage, onNoteSelect, onDuplicateTemplate, onSetDefaultTemplate]);

    // Render logic for the teleported dropdown menus to avoid overflow-hidden clipping
    const dropdownPortal = dropdownOpenTpl ? (
        <div 
            className="fixed w-48 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded shadow-lg overflow-hidden flex flex-col"
            style={{ 
                zIndex: 99999, 
                top: `${dropdownOpenTpl.top + 4}px`, 
                right: `${dropdownOpenTpl.right}px` 
            }}
        >
            <button
                className="w-full text-left px-3 py-2 text-xs font-medium hover:bg-[var(--bg-secondary)] text-[var(--text-primary)] transition-colors"
                onClick={e => {
                    e.stopPropagation();
                    const tplId = dropdownOpenTpl.id;
                    setDropdownOpenTpl(null);
                    onNoteSelect(tplId);
                }}
            >{t('table.edit')}</button>
            
            {onDuplicateTemplate && (
                <button
                    className="w-full text-left px-3 py-2 text-xs font-medium hover:bg-[var(--bg-secondary)] text-[var(--text-primary)] transition-colors"
                    onClick={e => {
                        e.stopPropagation();
                        const tplId = dropdownOpenTpl.id;
                        const template = templates.find(t => t.id === tplId);
                        setDropdownOpenTpl(null);
                        if(template) onDuplicateTemplate(template);
                    }}
                >{t('table.duplicate')}</button>
            )}

            {onSetDefaultTemplate && (
                <button
                    className="w-full text-left px-3 py-2 text-xs font-medium hover:bg-[var(--bg-secondary)] text-[var(--text-primary)] transition-colors border-b border-[var(--border-primary)]"
                    onClick={e => {
                        e.stopPropagation();
                        const tplId = dropdownOpenTpl.id;
                        const template = templates.find(t => t.id === tplId);
                        setDropdownOpenTpl(null);
                        if(template) onSetDefaultTemplate(template);
                    }}
                >{t('table.set_default')}</button>
            )}

            <button
                className="w-full text-left px-3 py-2 text-xs font-medium hover:bg-red-500/10 text-red-500 transition-colors"
                onClick={e => {
                    e.stopPropagation();
                    const tplId = dropdownOpenTpl.id;
                    const template = templates.find(t => t.id === tplId);
                    setDropdownOpenTpl(null);
                    if(template) onDeletePage(tplId, template.title);
                }}
            >{t('table.delete')}</button>
        </div>
    ) : null;

    const handleOpenExternalResource = useCallback(async (note) => {
        const metadata = note?.metadata || {};
        const zoteroUri = String(getMetadataValueByNormalizedKey(metadata, ['Zotero uri', 'zotero_uri', 'zotero uri'])).trim();
        const filePath = String(getMetadataValueByNormalizedKey(metadata, ["Ruta de l'arxiu", 'ruta_arxiu', 'file_path', 'path'])).trim();
        const attachments = getMetadataValueByNormalizedKey(metadata, ['Adjunts', 'attachments', 'adjuntos']);

        if (!zoteroUri && !filePath && !attachments) {
            alert(t('table.no_resource_error'));
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
            alert(message);
        } finally {
            setOpeningResourceId(null);
        }
    }, [getMetadataValueByNormalizedKey]);

    // ---- SAVE CELL + PROPAGATION TO PARENT ----
    const handleCellSave = useCallback(async (noteId, field, newValue, originalMetaKey, skipPropagation = false) => {
        setEditingCell(null);
        const note = safeNotes.find(n => n.id === noteId);
        if (!note) return;

        const currentValue = note.metadata?.[originalMetaKey];
        if (currentValue === newValue) return;

        const updatedMetadata = { ...note.metadata, [originalMetaKey]: newValue };

        try {
            const response = await fetch(`/api/vault/pages/${noteId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: note.title,
                    content: note.content || "",
                    metadata: updatedMetadata
                })
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
            // Refresh data to reflect changes in UI
            if (onCellSaved) await onCellSaved();
            else if (onUpdateView) onUpdateView(activeView);
        } catch (error) {
            // Cell save failures used to be silent. Surface them so the user
            // doesn't believe the change was persisted when it wasn't.
            notifyError('table-save-cell', error, t('table.save_cell_error', 'Error desant la cel·la'));
        }
    }, [safeNotes, activeView, onUpdateView]);

    // ---- PROPAGATION LOGIC TO PARENT ----
    const propagateToParent = useCallback(async (parentId, changedField, changedChildId, newValue) => {
        const parent = safeNotes.find(n => n.id === parentId);
        if (!parent) return;

        const children = childrenMap[parentId] || [];
        if (children.length === 0) return;

        // 1. Auto-complete/archive: if all children have status "Completed"/"Archived"/"Done"
        const statusLike = ['status', 'checkbox', 'estat'];
        const isStatusField = statusLike.includes(getFieldType(schema, changedField)) || statusLike.includes(changedField?.toLowerCase());
        const completedValues = new Set(['completat', 'arxivat', 'done', 'finished', 'completed', 'archivat', 'true', true]);

        if (isStatusField) {
            const allChildrenDone = children.every(child => {
                const childId = child.id;
                // Simulate the new value for the child that just changed
                const val = childId === changedChildId ? newValue : child.metadata?.[getMetaKey(child, changedField)];
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
                const val = child.id === changedChildId ? newValue : child.metadata?.[getMetaKey(child, changedField)];
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
                    // For simple date fields: min for "start" fields, max for "end" fields
                    const fieldLower = changedField.toLowerCase();
                    const isEndField = fieldLower.includes('fi') || fieldLower.includes('end') || fieldLower.includes('fin');
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

    const getAvailableOptions = (field, type) => {
        const config = getFieldConfig(schema, field);
        if (config?.options && config.options.length > 0) return config.options;
        const values = safeNotes
            .map(n => {
                const originalMetaKey = n.metadata ? (Object.keys(n.metadata).find(k => normalizeKey(k) === (aliasMap[normalizeKey(field)] ? normalizeKey(aliasMap[normalizeKey(field)]) : normalizeKey(field))) || field) : field;
                return n.metadata?.[originalMetaKey];
            })
            .filter(v => v !== undefined && v !== null && v !== '');
        return Array.from(new Set(values));
    };

    const handleKeyDown = (e, noteId, field, originalMetaKey) => {
        // Ignore computed fields to avoid accidental editing
        const fieldType = getFieldType(schema, field);
        const isComputed = fieldType === 'formula' || fieldType === 'rollup';
        if (isComputed) return;

        if (e.key === 'Tab') {
            e.preventDefault();
            handleCellSave(noteId, field, e.target.value, originalMetaKey);
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

    const calculateFormula = useCallback((formula, note) => evaluateFormula(formula, note, {
        notes: safeNotes,
        currentTableId: resolveNoteTableId(note),
        schema,
    }), [safeNotes, resolveNoteTableId, schema]);

    const calculateRollup = useCallback((config, note) => evaluateRollup(config, note, {
        notes: safeNotes,
        currentTableId: resolveNoteTableId(note),
    }), [safeNotes, resolveNoteTableId]);

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

        return '';
    }, []);

    const getImagePreviewUrlFromValue = useCallback((rawValue) => {
        if (Array.isArray(rawValue)) {
            for (const item of rawValue) {
                const candidate = toImagePreviewUrl(String(item || ''));
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
            alert(t('table.zotero_empty_error'));
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
            alert(message);
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

    const renderCellContent = (value, type, noteId, field, originalMetaKey) => {
        const isEditing = editingCell?.rowId === noteId && editingCell?.field === field;
        const note = safeNotes.find(n => n.id === noteId);
        const isManual = note?.metadata?.[`${originalMetaKey}_manual`];
        const isImageLikeField = /(image|imatge|cover|thumbnail|thumb|foto|imagen)/i.test(String(field || ''));

        if (isEditing) {
            if (type === 'status' || type === 'select') {
                const options = getAvailableOptions(field, type);
                return (
                    <select
                        autoFocus
                        className="w-full px-1 py-0.5 text-sm border border-[var(--border-primary)] rounded focus:outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)]"
                        defaultValue={value || ''}
                        onBlur={(e) => handleCellSave(noteId, field, e.target.value, originalMetaKey)}
                        onChange={(e) => handleCellSave(noteId, field, e.target.value, originalMetaKey)}
                        onKeyDown={(e) => {
                            if (e.key === 'Escape') setEditingCell(null);
                            handleKeyDown(e, noteId, field, originalMetaKey);
                        }}
                    >
                        <option value="">({t('table.none')})</option>
                        {options.map(opt => (
                            <option key={opt} value={opt}>{opt}</option>
                        ))}
                    </select>
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
                return (
                    <InlinePillsPicker
                        value={currentValues}
                        options={options}
                        idToTitle={displayMap}
                        onSave={(vals) => handleCellSave(noteId, field, vals, originalMetaKey)}
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

            return (
                <input
                    autoFocus
                    className="w-full px-1 py-0.5 text-sm border border-[var(--border-primary)] rounded focus:outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)]"
                    defaultValue={value || ''}
                    onBlur={(e) => handleCellSave(noteId, field, e.target.value, originalMetaKey)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') handleCellSave(noteId, field, e.target.value, originalMetaKey);
                        if (e.key === 'Escape') setEditingCell(null);
                        handleKeyDown(e, noteId, field, originalMetaKey);
                    }}
                />
            );
        }

        if (value === undefined || value === null || value === '') return <span className="text-[var(--text-tertiary)]">-</span>;

        switch (type) {
            case 'checkbox':
                return value ? <CheckSquare size={16} className="text-indigo-500" /> : <div className="w-4 h-4 border border-[var(--border-primary)] rounded-sm"></div>;
            case 'date':
            case 'datetime':
                return (
                    <div className="flex items-center gap-1.5 whitespace-nowrap text-[var(--text-primary)]">
                        {type === 'datetime' ? <Clock size={14} className="text-[var(--text-tertiary)]" /> : <Calendar size={14} className="text-[var(--text-tertiary)]" />}
                        <span>
                            {new Date(value).toLocaleString(i18n.language, {
                                day: '2-digit',
                                month: 'short',
                                year: 'numeric',
                                ...(type === 'datetime' ? { hour: '2-digit', minute: '2-digit' } : {})
                            })}
                        </span>
                    </div>
                );
            case 'period': {
                const [start, end] = String(value).split('/');
                const formatDate = (d) => d ? new Date(d).toLocaleDateString(i18n.language, { day: '2-digit', month: 'short' }) : '?';
                return (
                    <div className="flex items-center gap-1 text-[11px] font-medium text-[var(--text-secondary)] bg-[var(--bg-tertiary)] px-1.5 py-0.5 rounded border border-[var(--border-primary)]">
                        <span>{formatDate(start)}</span>
                        <span className="text-[var(--text-tertiary)]">→</span>
                        <span>{formatDate(end)}</span>
                    </div>
                );
            }
            case 'status':
            case 'select':
                return (
                    <div className="flex items-center gap-1.5">
                        <span className="px-2 py-0.5 rounded-md text-xs font-semibold bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border-primary)]">
                            {value}
                        </span>
                        {isManual && <Unlock size={10} className="text-amber-500 opacity-60" title={t('table.manual_value')} />}
                    </div>
                );
            case 'multi_select':
            case 'relation': {
                const items = Array.isArray(value) ? value : String(value).split(',').map(s => s.trim());
                const displayMap = type === 'relation' ? getRelationContext(field).displayMap : idToTitle;
                return (
                    <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto custom-scrollbar pr-1 py-0.5">
                        {items.map((it, idx) => (
                            <span key={idx} className="px-1.5 py-0.5 rounded text-[11px] font-medium bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)] whitespace-nowrap border border-[var(--gnosi-primary)]/20" title={it}>
                                {displayMap[it] || (it.length > 20 ? it.substring(0, 8) + '...' : it)}
                            </span>
                        ))}
                    </div>
                );
            }
            case 'url':
                {
                    const imageUrl = getImagePreviewUrlFromValue(value);
                    if (imageUrl) {
                        return (
                            <a href={imageUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center">
                                <img src={imageUrl} alt={field} className="w-14 h-10 object-cover rounded border border-[var(--border-primary)]" loading="lazy" />
                            </a>
                        );
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
            case 'files': {
                const imageUrl = getImagePreviewUrlFromValue(value);
                if (imageUrl) {
                    return (
                        <a href={imageUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center">
                            <img src={imageUrl} alt={field} className="w-14 h-10 object-cover rounded border border-slate-200" loading="lazy" />
                        </a>
                    );
                }

                return <span className="truncate max-w-[200px] block" title={String(value)}>{String(value)}</span>;
            }
            case 'formula':
            case 'rollup': {
                return (
                    <div className="flex items-center gap-1.5 text-indigo-500 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20 font-mono text-[11px] w-fit">
                        <span className="text-[10px] opacity-50">{type === 'rollup' ? 'r' : 'ƒ'}</span>
                        <span>{value || '0'}</span>
                    </div>
                );
            }
            default:
                if (isImageLikeField) {
                    const imageUrl = getImagePreviewUrlFromValue(value);
                    if (imageUrl) {
                        return (
                            <a href={imageUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center">
                                <img src={imageUrl} alt={field} className="w-14 h-10 object-cover rounded border border-[var(--border-primary)]" loading="lazy" />
                            </a>
                        );
                    }
                }
                return <span className="truncate max-w-[200px] block" title={value}>{value}</span>;
        }
    };

    const calculateAggregation = (field, type) => {
        const func = aggregations[field];
        if (!func || func === 'none') return null;
        const values = sortedNotes.map(note => {
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
            const nums = values.map(v => Number(v)).filter(v => !isNaN(v));
            if (nums.length === 0) return 0;
            if (func === 'sum') return nums.reduce((a, b) => a + b, 0).toLocaleString();
            if (func === 'avg') return (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2);
            if (func === 'min') return Math.min(...nums).toLocaleString();
            if (func === 'max') return Math.max(...nums).toLocaleString();
        }
        if (type === 'date' || type === 'datetime' || type === 'period' || field === 'last_modified') {
            const formatAggDate = (d) => d.toLocaleDateString(i18n.language, { day: '2-digit', month: 'short', year: 'numeric' });
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
    const renderRow = (note, isChild = false, depth = 0, rowPath = '0') => {
        const hasChildren = (childrenMap[note.id]?.length > 0);
        const isExpanded = expandedRows.has(note.id);
        const isAddingSubitem = addingSubitemFor === note.id;

        return (
            <React.Fragment key={`${note.id || 'note'}-${rowPath}`}>
                <tr
                    className={`border-b border-[var(--border-primary)] hover:bg-[var(--bg-secondary)] cursor-pointer transition-colors group/row
                        ${isListView ? 'border-b-0 group' : ''}
                        ${isSelected(note.id) ? 'bg-indigo-500/10' : ''}
                        ${isChild ? 'bg-[var(--bg-secondary)]/30' : ''}
                    `}
                    onClick={() => { /* Row: selection via checkbox */ }}
                    onDoubleClick={() => onNoteSelect(note.id)}
                >
                    {/* Acció cel·la */}
                    <td className={`w-10 px-2 sticky left-0 z-20 text-center align-top pt-2.5 ${isSelected(note.id) ? 'bg-indigo-500/10' : isChild ? 'bg-[var(--bg-secondary)]/30' : 'bg-[var(--bg-primary)]'}`}>
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
                                className={`p-1 text-[var(--text-tertiary)] hover:text-indigo-600 transition-colors ${selectedIds.size > 0 ? 'hidden' : 'block'}`}
                                title={t('common.open')}
                            >
                                <ExternalLink size={14} />
                            </button>
                            {hasOpenableResource(note) && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleOpenExternalResource(note);
                                    }}
                                    disabled={openingResourceId === note.id}
                                    className="p-1 text-[var(--text-tertiary)] hover:text-emerald-600 transition-colors"
                                    title={t('table.open_resource_tooltip')}
                                >
                                    <LinkIcon size={14} />
                                </button>
                            )}
                            {onOpenParallel && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); onOpenParallel(note.id); }}
                                    className="p-1 text-[var(--text-tertiary)] hover:text-purple-600 transition-colors opacity-60 hover:opacity-100"
                                    title={t('table.open_parallel')}
                                >
                                    <Columns2 size={14} />
                                </button>
                            )}
                            {!isListView && onDeletePage && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onDeletePage(note.id, note.title);
                                    }}
                                    className="p-1 text-[var(--text-tertiary)] hover:text-red-500 transition-colors opacity-0 group-hover/row:opacity-100"
                                    title={t('table.delete')}
                                >
                                    <Trash2 size={14} />
                                </button>
                            )}
                        </div>
                    </td>

                    <td
                        style={{ width: columnWidths['title'] || 250, maxWidth: columnWidths['title'] || 250 }}
                        className={`py-2.5 px-4 flex items-center gap-1.5 font-medium text-[var(--text-primary)] sticky left-10 z-20 overflow-hidden align-top
                            ${isSelected(note.id) ? 'bg-indigo-500/10' : isChild ? 'bg-[var(--bg-secondary)]/50' : 'bg-[var(--bg-primary)]'}
                            ${isListView ? 'group-hover:bg-[var(--bg-secondary)]' : 'border-r border-[var(--border-primary)] shadow-[2px_0_5px_-2px_rgba(0,0,0,0.02)]'}`}
                        onClick={() => onNoteSelect(note.id)}
                    >
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
                        <span className="truncate flex-1">{note.title}</span>

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
                    </td>

                    {dynamicColumns.map(([key, type]) => {
                        const originalMetaKey = getMetaKey(note, key);
                        const val = note.metadata?.[originalMetaKey];
                        return (
                            <td
                                key={key}
                                style={{ width: columnWidths[key] || 180, maxWidth: columnWidths[key] || 180 }}
                                className="py-2.5 px-4 overflow-hidden truncate hover:bg-[var(--bg-tertiary)]/50 text-[var(--text-primary)] align-top"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    const fieldType = getFieldType(schema, key);
                                    const isComputed = fieldType === 'formula' || fieldType === 'rollup';
                                    if (!isComputed) {
                                        setEditingCell({ rowId: note.id, field: key, originalMetaKey });
                                    }
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

                    <td
                        style={{ width: columnWidths['last_modified'] || 150, maxWidth: columnWidths['last_modified'] || 150 }}
                        className={`py-2.5 px-4 text-[var(--text-tertiary)] flex items-center gap-1.5 overflow-hidden truncate align-top ${isListView ? '' : 'border-l border-[var(--border-primary)]'}`}
                    >
                        <Clock size={14} className="shrink-0" />
                        <span className="truncate">{new Date(note.last_modified).toLocaleDateString(i18n.language)}</span>
                    </td>
                </tr>

                {isExpanded && (childrenMap[note.id] || []).map((child, childIndex) => renderRow(child, true, depth + 1, `${rowPath}.${childIndex}`))}

                {isAddingSubitem && (
                    <tr className="border-b border-[var(--border-primary)] bg-indigo-500/5">
                        <td className="w-10 sticky left-0 z-20 bg-[var(--bg-primary)]" />
                        <td
                            style={{ width: columnWidths['title'] || 250, maxWidth: columnWidths['title'] || 250 }}
                            className="py-1.5 px-4 sticky left-10 z-20 bg-[var(--bg-primary)] border-r border-[var(--border-primary)]"
                        >
                            <div className="flex items-center gap-2" style={{ marginLeft: (depth + 1) * 20 }}>
                                <input
                                    ref={subitemInputRef}
                                    type="text"
                                    placeholder={t('table.subitem_name_placeholder')}
                                    value={newSubitemTitle}
                                    onChange={(e) => setNewSubitemTitle(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') handleCreateSubitem(note.id);
                                        if (e.key === 'Escape') {
                                            setAddingSubitemFor(null);
                                            setNewSubitemTitle('');
                                        }
                                    }}
                                    className="flex-1 px-2 py-1 text-sm border border-[var(--border-primary)] rounded focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-sm"
                                />
                                <button
                                    onClick={() => handleCreateSubitem(note.id)}
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
                        <td style={{ width: columnWidths['last_modified'] || 150 }} className="py-1.5 px-4 border-l border-[var(--border-primary)]" />
                    </tr>
                )}
            </React.Fragment>
        );
    };

    return (
        <div className={`w-full h-full overflow-hidden ${isEmbedded ? '' : 'bg-[var(--bg-primary)]'}`}>
            <div className="w-full h-full flex flex-col">
                {selectedIds.size > 0 && (
                    <VaultBulkActionsBar
                        selectedIds={selectedIds}
                        totalCount={sortedNotes.length}
                        onSelectAll={() => selectAll(sortedNotes.map(n => n.id))}
                        onClearSelection={clearSelection}
                        onDeleteSelected={(onDeleteSelected || onDeletePage) ? handleBulkDelete : null}
                    />
                )}

                <div className={`bg-[var(--bg-primary)] overflow-auto flex-1 custom-scrollbar pt-vault-header-top ${isEmbedded ? 'rounded border border-[var(--border-primary)] shadow-sm' : 'border-none shadow-none'} ${isListView ? 'border-none shadow-none' : ''}`}>
                    <table className="text-left text-sm text-[var(--text-secondary)] whitespace-nowrap" style={{ tableLayout: 'fixed', width: 'max-content' }}>
                        {!isListView && (
                            <thead className="bg-[var(--bg-secondary)] border-b border-[var(--border-primary)] text-[var(--text-secondary)] font-semibold select-none group/table sticky top-0 z-30">
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
                                            className="py-3 px-4 hover:bg-[var(--bg-tertiary)] transition-colors group relative border-r border-[var(--border-primary)]"
                                        >
                                            <div className="flex items-center gap-1.5 justify-between cursor-pointer overflow-hidden text-[var(--text-secondary)]" onClick={() => handleSort(key)}>
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
                                </tr>
                            </thead>
                        )}
                        <tbody>
                            {visibleRootNotes.map((note, noteIndex) => renderRow(note, false, 0, `${noteIndex}`))}
                            
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
                                    <td style={{ width: columnWidths['last_modified'] || 150 }} className="py-1 px-4 border-l border-[var(--border-primary)] text-[var(--text-secondary)]" />
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
                                </tr>
                            </tfoot>
                        )}
                    </table>

                    {sortedNotes.length === 0 && (
                        <div className="p-8 text-center text-[var(--text-tertiary)] bg-[var(--bg-primary)]">
                            {t('table.no_notes')}
                        </div>
                    )}

                    {sortedNotes.length > visibleRowsCount && (
                        <div className="px-4 py-3 border-t border-[var(--border-primary)] bg-[var(--bg-secondary)] flex items-center justify-between">
                            <span className="text-xs text-[var(--text-tertiary)]">
                                {t('table.showing_records', { count: visibleRowsCount, total: sortedNotes.length })}
                            </span>
                            <button
                                onClick={() => setVisibleRowsCount(prev => Math.min(prev + ROWS_BATCH_SIZE, sortedNotes.length))}
                                className="btn-gnosi btn-gnosi-primary !px-3 !py-1.5"
                            >
                                {t('table.show_more_count', { count: Math.min(ROWS_BATCH_SIZE, sortedNotes.length - visibleRowsCount) })}
                            </button>
                        </div>
                    )}
                </div>
            </div>
            {dropdownPortal}
        </div>
    );
};
