import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { 
    Plus, Settings, Hash, Search, X, MoreHorizontal,
    Edit2, Copy, Trash2, Star, LayoutTemplate, SlidersHorizontal,
    ChevronDown, Filter, ArrowUpDown, Tag, Type, CheckSquare,
    Calendar, Layers, FileImage, Columns, List, BarChart2,
    Globe, MapPin, AlignLeft, Lock, GripVertical
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { 
    DndContext, 
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragOverlay
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    horizontalListSortingStrategy,
    verticalListSortingStrategy,
    useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { VIEW_TYPES, getViewIcon, isMainView, isViewHidden, isPageEmbedView } from './viewConstants';
import { ReferenceImportExport } from './ReferenceImportExport';
import { BrainInbox } from './BrainInbox';
import { IconRenderer } from './IconRenderer';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';
import { viewMatchesFilters, isFilterGroup } from '../../utils/vaultFilters';
import { getViewPopoverLayout } from './viewPopoverLayout';

function SortableTab({ view, tableViews, isActive, onSelect, onAction }) {
    const { t } = useTranslation();
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id: view.id });

    const [showMenu, setShowMenu] = useState(false);
    const menuRef = useRef(null);

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        zIndex: isDragging ? 100 : 1,
    };

    const isPrimaryView = isMainView(view, tableViews);

    useEffect(() => {
        const handleClickOutside = (e) => {
            if (menuRef.current && !menuRef.current.contains(e.target)) {
                setShowMenu(false);
            }
        };
        if (showMenu) document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showMenu]);

    // Esc closes the tab menu (dropdown).
    useModalKeyboard({ isOpen: showMenu, onClose: () => setShowMenu(false) });

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...attributes}
            className="relative flex items-center shrink-0"
        >
            <div
                className={`w-[184px] flex items-center gap-1.5 px-3 pt-1.5 pb-0 text-xs font-medium transition-all rounded-t-md border-b-2 mr-1 cursor-pointer ${isActive
                    ? 'text-[var(--gnosi-blue)] border-[var(--gnosi-blue)] bg-[var(--bg-primary)] shadow-[0_-2px_5px_-1px_rgba(var(--gnosi-primary-rgb),0.1)]'
                    : 'text-[var(--text-tertiary)] border-transparent hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
                    }`}
                onClick={() => onSelect?.(view.id)}
                title={view.name}
            >
                {/* Separate drag handle to avoid conflicting with onClick */}
                <span
                    {...listeners}
                    className="cursor-grab active:cursor-grabbing flex items-center"
                    onClick={(e) => e.stopPropagation()}
                    title={t('views_header.drag_to_reorder', "Drag to reorder")}
                >
                    {React.createElement(getViewIcon(view.type), {
                        size: 13,
                        className: isActive ? 'text-[var(--gnosi-blue)]' : 'text-[var(--text-tertiary)]',
                    })}
                </span>
                <span className="truncate flex-1 min-w-0" title={view.name}>{view.name}</span>
                {isPrimaryView && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[10px] text-[var(--text-tertiary)] border border-[var(--border-primary)]" title={t('views_header.main_view')} aria-label={t('views_header.main_view')}>
                        <Lock size={10} />
                    </span>
                )}
                <div
                    onClick={(e) => {
                        e.stopPropagation();
                        setShowMenu(!showMenu);
                    }}
                    className={`p-0.5 rounded hover:bg-[var(--bg-tertiary)] transition-colors ml-0.5 ${showMenu ? 'bg-[var(--bg-tertiary)]' : ''}`}
                >
                    <MoreHorizontal size={13} />
                </div>
            </div>

            {showMenu && (
                <div 
                    ref={menuRef}
                    className="absolute top-full left-0 mt-1 w-44 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-xl z-[var(--z-popover)] py-1 animate-in fade-in zoom-in-95 duration-100 font-normal"
                >
                    {!isPrimaryView && (
                        <>
                            <button 
                                onClick={() => { setShowMenu(false); onAction?.(view, 'configure'); }}
                                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors text-left"
                            >
                                <Settings size={13} />
                                {t('views_header.configure')}
                            </button>
                            <button 
                                onClick={() => { setShowMenu(false); onAction?.(view, 'rename'); }}
                                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors text-left"
                            >
                                <Edit2 size={13} />
                                {t('views_header.rename')}
                            </button>
                        </>
                    )}
                    <button 
                        onClick={() => { setShowMenu(false); onAction?.(view, 'duplicate'); }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors text-left"
                    >
                        <Copy size={13} />
                        {t('views_header.duplicate')}
                    </button>
                    <div className="h-px bg-[var(--border-primary)] my-1 mx-2" />
                    {isPrimaryView ? (
                        <div className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-tertiary)]/70 cursor-not-allowed">
                            <Lock size={13} />
                            {t('views_header.main_view_locked')}
                        </div>
                    ) : (
                        <button
                            onClick={() => { setShowMenu(false); onAction?.(view, 'delete'); }}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--status-error)] hover:bg-[var(--bg-tertiary)] transition-colors text-left"
                        >
                            <Trash2 size={13} className="text-[var(--status-error)]" />
                            {t('views_header.delete')}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

// Row of the "Manage views" panel: reorder handle + name + contextual menu.
// Page-embed visibility is derived from view semantics and is not a table setting.
function SortableManageRow({ view, tableViews, isActive, onAction }) {
    const { t } = useTranslation();
    const {
        attributes, listeners, setNodeRef, transform, transition, isDragging
    } = useSortable({ id: view.id });

    const [showMenu, setShowMenu] = useState(false);
    const [menuPosition, setMenuPosition] = useState(null);
    const menuRef = useRef(null);

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        zIndex: isDragging ? 100 : 1,
    };

    const isPrimaryView = isMainView(view, tableViews);
    const hidden = isViewHidden(view, tableViews);

    useEffect(() => {
        const handleClickOutside = (e) => {
            if (menuRef.current && !menuRef.current.contains(e.target)) {
                setShowMenu(false);
            }
        };
        if (showMenu) document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showMenu]);

    // Esc closes the row contextual menu.
    useModalKeyboard({ isOpen: showMenu, onClose: () => setShowMenu(false) });

    const toggleMenu = (event) => {
        if (showMenu) {
            setShowMenu(false);
            setMenuPosition(null);
            return;
        }

        const rect = event.currentTarget.getBoundingClientRect();
        setMenuPosition({
            top: rect.bottom + 4,
            right: Math.max(8, window.innerWidth - rect.right),
        });
        setShowMenu(true);
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...attributes}
            className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md group/row ${isActive ? 'bg-[var(--gnosi-blue)]/5' : 'hover:bg-[var(--bg-tertiary)]'}`}
        >
            <span
                {...listeners}
                className="cursor-grab active:cursor-grabbing text-[var(--text-tertiary)] shrink-0"
                title={t('views_header.drag_to_reorder', "Drag to reorder")}
            >
                <GripVertical size={14} />
            </span>
            {React.createElement(getViewIcon(view.type), {
                size: 14,
                className: `shrink-0 ${hidden ? 'text-[var(--text-tertiary)]/60' : 'text-[var(--text-secondary)]'}`,
            })}
            <span className="flex-1 min-w-0 flex flex-col items-start gap-0.5 py-0.5">
                <span className={`w-full text-xs leading-4 break-words line-clamp-2 ${hidden ? 'text-[var(--text-tertiary)]' : 'text-[var(--text-primary)]'}`} title={view.name}>
                    {view.name}
                </span>
                {isPageEmbedView(view) && (
                    <span
                        className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] border border-[var(--border-primary)] font-normal"
                        title={t('views_header.dashboard_view_badge_hint', "Embedded view from a page or dashboard")}
                    >
                        {t('views_header.dashboard_view_badge', "Dashboard")}
                    </span>
                )}
            </span>
            {isPrimaryView ? (
                <span
                    className="shrink-0 inline-flex items-center justify-center w-7 h-6 text-[var(--text-tertiary)]/70"
                    title={t('views_header.main_view_locked')}
                    aria-label={t('views_header.main_view_locked')}
                >
                    <Lock size={13} />
                </span>
            ) : null}
            {/* Contextual "..." menu — same actions as the tab dropdown. */}
            <div className="relative shrink-0">
                <button
                    type="button"
                    onClick={toggleMenu}
                    className={`inline-flex items-center justify-center w-7 h-6 rounded text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors ${showMenu ? 'bg-[var(--bg-secondary)]' : ''}`}
                    title={t('views_header.more_actions', "More actions")}
                    aria-label={t('views_header.more_actions', "More actions")}
                    aria-haspopup="menu"
                    aria-expanded={showMenu}
                >
                    <MoreHorizontal size={14} />
                </button>
                {showMenu && menuPosition && createPortal((
                    <div
                        ref={menuRef}
                        role="menu"
                        className="fixed w-44 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-xl z-[var(--z-popover)] py-1 animate-in fade-in zoom-in-95 duration-100"
                        style={menuPosition}
                    >
                        {!isPrimaryView && (
                            <>
                                <button
                                    role="menuitem"
                                    onClick={() => { setShowMenu(false); onAction?.(view, 'configure'); }}
                                    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors text-left"
                                >
                                    <Settings size={13} />
                                    {t('views_header.configure')}
                                </button>
                                <button
                                    role="menuitem"
                                    onClick={() => { setShowMenu(false); onAction?.(view, 'rename'); }}
                                    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors text-left"
                                >
                                    <Edit2 size={13} />
                                    {t('views_header.rename')}
                                </button>
                            </>
                        )}
                        <button
                            role="menuitem"
                            onClick={() => { setShowMenu(false); onAction?.(view, 'duplicate'); }}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors text-left"
                        >
                            <Copy size={13} />
                            {t('views_header.duplicate')}
                        </button>
                        <div className="h-px bg-[var(--border-primary)] my-1 mx-2" />
                        {isPrimaryView ? (
                            <div className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-tertiary)]/70 cursor-not-allowed">
                                <Lock size={13} />
                                {t('views_header.main_view_locked')}
                            </div>
                        ) : (
                            <button
                                role="menuitem"
                                onClick={() => { setShowMenu(false); onAction?.(view, 'delete'); }}
                                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--status-error)] hover:bg-[var(--bg-tertiary)] transition-colors text-left"
                            >
                                <Trash2 size={13} className="text-[var(--status-error)]" />
                                {t('views_header.delete')}
                            </button>
                        )}
                    </div>
                ), document.body)}
            </div>
        </div>
    );
}

function OverflowViewRow({ view, tableViews, isActive, onSelect, onAction, onCloseOverflow }) {
    const { t } = useTranslation();
    const [showMenu, setShowMenu] = useState(false);
    const menuRef = useRef(null);

    const isPrimaryView = isMainView(view, tableViews);
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (menuRef.current && !menuRef.current.contains(e.target)) {
                setShowMenu(false);
            }
        };
        if (showMenu) document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showMenu]);

    useModalKeyboard({ isOpen: showMenu, onClose: () => setShowMenu(false) });

    return (
        <div
            className={`group/overflow-row relative flex items-center justify-between px-3 py-1.5 text-xs transition-colors ${isActive ? 'text-[var(--gnosi-blue)] bg-[var(--gnosi-blue)]/5 font-medium' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'}`}
        >
            <button 
                type="button"
                onClick={() => {
                    onSelect?.(view.id);
                    onCloseOverflow?.();
                }}
                className="flex items-center gap-2 flex-1 min-w-0 text-left"
            >
                {React.createElement(getViewIcon(view.type), { size: 13, className: 'shrink-0' })}
                <span className="truncate flex-1 min-w-0" title={view.name}>{view.name}</span>
                {isPrimaryView && (
                    <span className="shrink-0 inline-flex items-center text-[9px] px-1.5 py-0.5 rounded border border-[var(--border-primary)] bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]" title={t('views_header.main_view')} aria-label={t('views_header.main_view')}>
                        <Lock size={9} />
                    </span>
                )}
            </button>

            {/* Contextual "..." menu button */}
            <div className="relative shrink-0 ml-1">
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        setShowMenu(!showMenu);
                    }}
                    className={`p-0.5 rounded hover:bg-[var(--bg-secondary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors ${showMenu ? 'bg-[var(--bg-secondary)]' : ''}`}
                    title={t('views_header.more_actions', "More actions")}
                    aria-label={t('views_header.more_actions', "More actions")}
                    aria-haspopup="menu"
                    aria-expanded={showMenu}
                >
                    <MoreHorizontal size={13} />
                </button>
                {showMenu && (
                    <div 
                        ref={menuRef}
                        role="menu"
                        className="absolute right-0 top-full mt-1 w-44 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-xl z-[var(--z-popover)] py-1 animate-in fade-in zoom-in-95 duration-100 font-normal"
                    >
                        {!isPrimaryView && (
                            <>
                                <button
                                    role="menuitem"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setShowMenu(false);
                                        onCloseOverflow?.();
                                        onAction?.(view, 'configure');
                                    }}
                                    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors text-left"
                                >
                                    <Settings size={13} />
                                    {t('views_header.configure')}
                                </button>
                                <button
                                    role="menuitem"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setShowMenu(false);
                                        onCloseOverflow?.();
                                        onAction?.(view, 'rename');
                                    }}
                                    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors text-left"
                                >
                                    <Edit2 size={13} />
                                    {t('views_header.rename')}
                                </button>
                            </>
                        )}
                        <button
                            role="menuitem"
                            onClick={(e) => {
                                e.stopPropagation();
                                setShowMenu(false);
                                onCloseOverflow?.();
                                onAction?.(view, 'duplicate');
                            }}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors text-left"
                        >
                            <Copy size={13} />
                            {t('views_header.duplicate')}
                        </button>
                        <div className="h-px bg-[var(--border-primary)] my-1 mx-2" />
                        {isPrimaryView ? (
                            <div className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-tertiary)]/70 cursor-not-allowed">
                                <Lock size={13} />
                                {t('views_header.main_view_locked')}
                            </div>
                        ) : (
                            <button
                                role="menuitem"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setShowMenu(false);
                                    onCloseOverflow?.();
                                    onAction?.(view, 'delete');
                                }}
                                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--status-error)] hover:bg-[var(--bg-tertiary)] transition-colors text-left"
                            >
                                <Trash2 size={13} className="text-[var(--status-error)]" />
                                {t('views_header.delete')}
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

export function VaultViewsHeader({
    tableName,
    recordCount,
    notes = [],
    views,
    activeViewId,
    onViewSelect, 
    onAddView, 
    onEditView,
    onDuplicateView,
    onDeleteView,
    onReorderViews,
    onRenameView,
    onEditSchema,
    onCreateRecord,
    onCreateTemplate,
    onCreateFromSource,
    onEditTemplate,
    onDuplicateTemplate,
    onSetDefaultTemplate,
    onDeleteTemplate,
    searchTerm,
    setSearchTerm,
    templates = [],
    onClose,
    referenceTableId,
    brainTableId,
    onReferencesImported,
}) {
    const { t } = useTranslation();
    const [showSearch, setShowSearch] = useState(false);
    const [isAddingView, setIsAddingView] = useState(false);
    const [viewPopoverLayout, setViewPopoverLayout] = useState(null);
    const [showNewMenu, setShowNewMenu] = useState(false);
    // "..." submenu of a specific template inside the "+ New" menu.
    // Stores { id, tpl, top, right } (fixed coords computed from the "..." button).
    const [templateMenuFor, setTemplateMenuFor] = useState(null);
    const hasTemplateActions = !!(onEditTemplate || onDuplicateTemplate || onSetDefaultTemplate || onDeleteTemplate);

    const openTemplateMenu = (e, tpl) => {
        e.preventDefault();
        e.stopPropagation();
        const rect = e.currentTarget.getBoundingClientRect();
        setTemplateMenuFor(prev => (prev?.id === tpl.id ? null : {
            id: tpl.id,
            tpl,
            top: rect.bottom + 4,
            right: Math.max(8, window.innerWidth - rect.right),
        }));
    };

    const closeNewMenus = useCallback(() => {
        setTemplateMenuFor(null);
        setShowNewMenu(false);
    }, []);

    // Record count of the ACTIVE view (not of the whole table). If the view
    // has filters, only the records matching them; if it has none, it equals
    // the total. It reuses `viewMatchesFilters` (the same pure function applied by
    // VaultTable via useVaultViewData) so the badge and the table don't diverge —
    // this also covers the nested `filterTree` (complex AND/OR groups).
    // Search is deliberately left out: it is transient and already reflected by
    // the "Showing X of Y" inside the table; the badge is the view's size.
    const activeView = useMemo(
        () => views?.find(v => v.id === activeViewId) || null,
        [views, activeViewId]
    );
    const hasActiveFilter = useMemo(() => {
        if (!activeView) return false;
        return isFilterGroup(activeView.filterTree)
            ? (activeView.filterTree.rules || []).length > 0
            : (activeView.filters || []).length > 0;
    }, [activeView]);
    const viewRecordCount = useMemo(() => {
        if (!hasActiveFilter) return recordCount;
        return (notes || []).filter(n => viewMatchesFilters(n, activeView)).length;
    }, [notes, activeView, hasActiveFilter, recordCount]);
    const isFilteredView = viewRecordCount !== recordCount;

    // Views shown as tabs: all but the semantically hidden ones. The main view
    // is always there (isViewHidden leaves it out). The management panel still
    // sees every view so embedded/dashboard views remain configurable.
    const tabViews = useMemo(
        () => (views || [])
            .filter(v => !isViewHidden(v, views))
            // Stable sort: the main/primary view is always pinned first so it
            // stays at the left of the tab strip regardless of registry order.
            .sort((a, b) => (isMainView(b, views) ? 1 : 0) - (isMainView(a, views) ? 1 : 0)),
        [views]
    );
    const hideSingleViewTab = tabViews.length === 1;

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    const containerRef = useRef(null);
    const actionsRef = useRef(null);
    const searchRef = useRef(null);
    const newMenuRef = useRef(null);
    const addViewButtonRef = useRef(null);
    const [visibleCount, setVisibleCount] = useState(views.length || 1);
    const [showOverflow, setShowOverflow] = useState(false);

    useEffect(() => {
        if (!showNewMenu) return undefined;
        const handler = (e) => {
            // The template actions submenu is teleported to <body> via
            // createPortal (to escape the menu's containing block, which has a
            // residual `transform` from the animation and would break position:fixed).
            // Since it ends up outside newMenuRef, it must be excluded here or a click inside it
            // would close the "+ New" menu before running the action.
            if (newMenuRef.current && !newMenuRef.current.contains(e.target) && !e.target.closest?.('[data-template-submenu]')) {
                closeNewMenus();
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [closeNewMenus, showNewMenu]);

    // Esc closes each of this header's dropdowns.
    useModalKeyboard({ isOpen: showNewMenu, onClose: closeNewMenus });
    useModalKeyboard({ isOpen: isAddingView, onClose: () => setIsAddingView(false) });
    useModalKeyboard({ isOpen: showOverflow, onClose: () => setShowOverflow(false) });

    const updateViewPopoverLayout = useCallback(() => {
        if (!addViewButtonRef.current) return;
        setViewPopoverLayout(getViewPopoverLayout(
            addViewButtonRef.current.getBoundingClientRect(),
            window.innerWidth,
            window.innerHeight
        ));
    }, []);

    useEffect(() => {
        if (!isAddingView) return undefined;
        updateViewPopoverLayout();
        window.addEventListener('resize', updateViewPopoverLayout);
        window.addEventListener('scroll', updateViewPopoverLayout, true);
        return () => {
            window.removeEventListener('resize', updateViewPopoverLayout);
            window.removeEventListener('scroll', updateViewPopoverLayout, true);
        };
    }, [isAddingView, updateViewPopoverLayout]);

    // Dynamic calculation of how many tabs fit
    useEffect(() => {
        if (!containerRef.current) return;

        const observer = new ResizeObserver((entries) => {
            for (let entry of entries) {
                const totalWidth = entry.contentRect.width;
                // Get the width of the right actions if they exist
                const actionsWidth = actionsRef.current ? actionsRef.current.offsetWidth : 210;
                
                // Space for tabs = Total - Actions - Marges/Gaps - (+ bar and ... which occupy about 80px)
                const availableForTabs = totalWidth - actionsWidth - 40; 
                const tabWidth = 184;
                const reservedInternal = 60; // + and ...
                
                const count = Math.max(1, Math.floor((availableForTabs - reservedInternal) / tabWidth));
                setVisibleCount(count);
            }
        });

        // Observe the PARENT container of Row 2 to have the real total space
        observer.observe(containerRef.current);
        return () => observer.disconnect();
    }, [tabViews.length]);

    // Sort views so that the active one is always visible if needed
    const displayViews = useMemo(() => {
        const activeIdx = tabViews.findIndex(v => v.id === activeViewId);
        if (activeIdx === -1 || activeIdx < visibleCount) return tabViews;

        // If the active one is out of range, move it temporarily to position visibleCount - 1
        const newDisplay = [...tabViews];
        const activeView = newDisplay.splice(activeIdx, 1)[0];
        newDisplay.splice(visibleCount - 1, 0, activeView);
        return newDisplay;
    }, [tabViews, activeViewId, visibleCount]);

    useEffect(() => {
        if (showSearch && searchRef.current) searchRef.current.focus();
    }, [showSearch]);

    // Reordering of the tab STRIP (visible views only). It is rebuilt
    // the full order keeping hidden ones at the end (their relative order
    // only matters inside the management panel).
    const handleDragEnd = (event) => {
        const { active, over } = event;
        if (over && active.id !== over.id) {
            const oldIndex = tabViews.findIndex(v => v.id === active.id);
            const newIndex = tabViews.findIndex(v => v.id === over.id);
            const newTabOrder = arrayMove(tabViews, oldIndex, newIndex);
            const hidden = (views || []).filter(v => isViewHidden(v, views));
            onReorderViews?.([...newTabOrder, ...hidden]);
        }
    };

    // Reordering of the management PANEL: operates on the full list.
    const handleManageDragEnd = (event) => {
        const { active, over } = event;
        if (over && active.id !== over.id) {
            const oldIndex = views.findIndex(v => v.id === active.id);
            const newIndex = views.findIndex(v => v.id === over.id);
            onReorderViews?.(arrayMove(views, oldIndex, newIndex));
        }
    };

    const handleViewAction = useCallback((view, action) => {
        if (action === 'configure') {
            // The main view mirrors the field configuration and is not editable
            // via the view modal (change fields from the schema config instead).
            if (isMainView(view, views)) return;
            onEditView?.(view);
        }
        if (action === 'delete') {
            if (isMainView(view, views)) return;
            onDeleteView?.(view);
        }
        if (action === 'duplicate') {
            onDuplicateView?.(view);
        }
        if (action === 'rename') {
            onRenameView?.(view);
        }
    }, [onEditView, onDeleteView, onDuplicateView, onRenameView, views]);

    // Handling of the expanding search input

    return (
        <div className="relative z-50 flex flex-col w-full bg-[var(--bg-primary)] shrink-0">
            {/* Row 1: Title and Record Count */}
            <div className="flex items-start justify-between px-2 pt-vault-header-top pb-1.5 md:px-4 md:pb-2">
                <div className="flex items-center gap-3">
                    <h1 className="text-xl md:text-2xl font-bold text-[var(--text-primary)] flex items-center gap-2 md:gap-3 mt-0 leading-none">
                        {tableName}
                    </h1>
                    <span
                        className="text-[10px] md:text-xs font-medium text-[var(--text-tertiary)] bg-[var(--bg-tertiary)] px-2 py-0.5 rounded-full border border-[var(--border-primary)]"
                        title={isFilteredView ? t('views_header.records_count_in_view_hint', { count: viewRecordCount, total: recordCount }) : undefined}
                    >
                        {isFilteredView
                            ? t('views_header.records_count_in_view', { count: viewRecordCount, total: recordCount })
                            : t('views_header.records_count', { count: recordCount })}
                    </span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                    {brainTableId && (
                        <BrainInbox onAccepted={onReferencesImported} />
                    )}
                    {referenceTableId && (
                        <ReferenceImportExport
                            tableId={referenceTableId}
                            onImported={onReferencesImported}
                        />
                    )}
                    {onClose && (
                        <button
                            onClick={onClose}
                            className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors p-1"
                            title={t('views_header.close_panel')}
                        >
                            <X size={20} />
                        </button>
                    )}
                </div>
            </div>

            {/* Row 2: Views and Actions */}
            <div className="flex items-end justify-between px-2 md:px-4 min-w-0" ref={containerRef}>
                {/* Left: View tabs */}
                <div className="flex items-center flex-1 min-w-0 pr-2 md:pr-4">
                    <DndContext 
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={handleDragEnd}
                    >
                        <div className="flex items-end gap-1 flex-1 pb-0 relative min-w-0">
                            <SortableContext 
                                items={hideSingleViewTab ? [] : displayViews.map(v => v.id)}
                                strategy={horizontalListSortingStrategy}
                            >
                                {!hideSingleViewTab && displayViews.slice(0, visibleCount).map(view => (
                                    <SortableTab 
                                        key={view.id}
                                        view={view}
                                        tableViews={views}
                                        isActive={activeViewId === view.id}
                                        onSelect={onViewSelect}
                                        onAction={handleViewAction}
                                    />
                                ))}
                            </SortableContext>

                            {/* Overflow button for the remaining views */}
                            {tabViews.length > visibleCount && (
                                <div className="relative">
                                    <button 
                                        onClick={() => setShowOverflow(!showOverflow)}
                                        className={`p-1 mb-2 rounded transition-colors ${showOverflow ? 'bg-[var(--bg-tertiary)] text-[var(--gnosi-blue)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'}`}
                                        title={t('views_header.more_views')}
                                    >
                                        <MoreHorizontal size={15} />
                                    </button>

                                    {showOverflow && (
                                        <>
                                            <div className="fixed inset-0 z-40" onClick={() => setShowOverflow(false)}></div>
                                            <div className="absolute top-full left-0 mt-1 w-60 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-xl z-50 py-1 animate-in fade-in zoom-in-95 duration-100">
                                                <div className="px-3 py-1.5 text-[10px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">
                                                    {t('views_header.other_views')}
                                                </div>
                                                {displayViews.slice(visibleCount).map(view => (
                                                    <OverflowViewRow
                                                        key={view.id}
                                                        view={view}
                                                        tableViews={views}
                                                        isActive={activeViewId === view.id}
                                                        onSelect={onViewSelect}
                                                        onAction={handleViewAction}
                                                        onCloseOverflow={() => setShowOverflow(false)}
                                                    />
                                                ))}
                                            </div>
                                        </>
                                    )}
                                </div>
                            )}

                            {/* Add View button */}
                            <button
                                ref={addViewButtonRef}
                                type="button"
                                onClick={() => {
                                    if (isAddingView) {
                                        setIsAddingView(false);
                                        return;
                                    }
                                    updateViewPopoverLayout();
                                    setIsAddingView(true);
                                }}
                                title={t('views_header.add_view')}
                                aria-label={t('views_header.add_view')}
                                aria-haspopup="dialog"
                                aria-expanded={isAddingView}
                                className="p-1 ml-1 mb-2 rounded text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                            >
                                <Plus size={16} />
                            </button>
                        </div>
                    </DndContext>
                </div>

                {/* Right: Actions */}
                <div className="flex items-center gap-1 md:gap-2 mb-2 shrink-0 ml-1 md:ml-2" ref={actionsRef}>
                    {/* Expandable search */}
                    <div className="flex items-center">
                        {showSearch ? (
                            <div className="flex items-center gap-1 bg-[var(--bg-primary)] border border-[var(--gnosi-primary)]/40 rounded-md px-2 py-1 shadow-sm animate-in slide-in-from-right-4 duration-200">
                                <Search size={14} className="text-[var(--gnosi-primary)]" />
                                <input
                                    ref={searchRef}
                                    type="text"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    onBlur={() => !searchTerm && setShowSearch(false)}
                                    placeholder={t('views_header.search_placeholder')}
                                    className="text-xs outline-none w-32 md:w-48 text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] bg-transparent"
                                />
                                <button
                                    onClick={() => { setSearchTerm(''); setShowSearch(false); }}
                                    className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                                >
                                    <X size={14} />
                                </button>
                            </div>
                        ) : (
                            <button
                                onClick={() => setShowSearch(true)}
                                className="p-1.5 rounded-md text-[var(--text-tertiary)] hover:text-[var(--gnosi-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                                title={t('views_header.search_title')}
                            >
                                <Search size={18} />
                            </button>
                        )}
                    </div>

                    {/* Fields button */}
                    <button
                        onClick={() => onEditSchema?.('schema')}
                        className="btn-gnosi !text-xs !py-1.5 !px-3"
                    >
                        <Settings size={14} />
                        <span className="hidden md:inline">{t('views_header.fields')}</span>
                    </button>

                    {/* New button (split: main action + chevron for the menu) */}
                    <div ref={newMenuRef} className="relative inline-flex shadow-md rounded-xl">
                        <button
                            onClick={() => onCreateRecord?.()}
                            className="btn-gnosi btn-gnosi-primary !px-3 !py-1.5 !text-xs !gap-1.5 !shadow-none !rounded-r-none active:scale-95"
                        >
                            <Plus size={14} />
                            <span className="hidden sm:inline">{t('views_header.new_action')}</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                if (showNewMenu) closeNewMenus();
                                else setShowNewMenu(true);
                            }}
                            aria-label={t('views_header.new_options', "Creation options")}
                            aria-haspopup="menu"
                            aria-expanded={showNewMenu}
                            className="btn-gnosi btn-gnosi-primary !px-2 !py-1.5 !shadow-none !rounded-l-none border-l border-white/20 hover:text-white/80 active:scale-95"
                        >
                            <ChevronDown size={14} />
                        </button>

                        {showNewMenu && (
                            <div className="absolute top-full right-0 mt-1 w-56 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-xl z-[var(--z-popover)] py-1 animate-in fade-in zoom-in-95 duration-100">
                                <button
                                    onClick={() => { setShowNewMenu(false); onCreateRecord?.(); }}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors text-left"
                                >
                                    <Plus size={14} className="text-[var(--text-tertiary)]" />
                                    <span>{t('views_header.new_empty_record')}</span>
                                </button>
                                <button
                                    onClick={() => { setShowNewMenu(false); onCreateTemplate?.(); }}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors text-left"
                                >
                                    <LayoutTemplate size={14} className="text-[var(--text-tertiary)]" />
                                    <span>{t('views_header.new_template')}</span>
                                </button>

                                {referenceTableId && onCreateFromSource && (
                                    <button
                                        onClick={() => { setShowNewMenu(false); onCreateFromSource(); }}
                                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors text-left"
                                    >
                                        <Search size={14} className="text-[var(--text-tertiary)]" />
                                        <span>{t('views_header.new_from_source', { defaultValue: "Create from a source…" })}</span>
                                    </button>
                                )}

                                {templates.length > 0 && (
                                    <>
                                        <div className="h-px bg-[var(--border-primary)] my-1 mx-2" />
                                        <div className="px-3 py-1 text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-tighter">{t('views_header.templates_title')}</div>
                                        {templates.map(tpl => {
                                            const isDefault = !!tpl.metadata?.is_default_template;
                                            return (
                                                <div
                                                    key={tpl.id}
                                                    className="group/tpl flex items-stretch hover:bg-[var(--bg-tertiary)] transition-colors"
                                                >
                                                    <button
                                                        onClick={() => { setShowNewMenu(false); onCreateRecord?.(tpl.id); }}
                                                        className="flex-1 min-w-0 flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-primary)] text-left"
                                                    >
                                                        {tpl.metadata?.icon ? (
                                                            <IconRenderer icon={tpl.metadata.icon} size={16} className="shrink-0" />
                                                        ) : (
                                                            <LayoutTemplate size={14} className="shrink-0 text-[var(--text-tertiary)] group-hover/tpl:text-[var(--gnosi-primary)]" />
                                                        )}
                                                        <span className="truncate">{tpl.title || t('common.untitled')}</span>
                                                        {isDefault && (
                                                            <span className="ml-auto shrink-0 text-[9px] bg-[var(--status-success)]/20 text-[var(--status-success)] px-1 rounded">{t('views_header.default_badge')}</span>
                                                        )}
                                                    </button>
                                                    {hasTemplateActions && (
                                                        <button
                                                            type="button"
                                                            onClick={(e) => openTemplateMenu(e, tpl)}
                                                            title={t('table.options')}
                                                            aria-label={t('table.options')}
                                                            aria-haspopup="menu"
                                                            className={`shrink-0 px-2 flex items-center hover:bg-[var(--bg-secondary)] transition-all ${templateMenuFor?.id === tpl.id ? 'opacity-100 text-[var(--text-primary)]' : 'opacity-0 group-hover/tpl:opacity-100 focus:opacity-100 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'}`}
                                                        >
                                                            <MoreHorizontal size={15} />
                                                        </button>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </>
                                )}

                                {templateMenuFor && createPortal((
                                    <div
                                        role="menu"
                                        data-template-submenu
                                        className="fixed w-48 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-xl z-[var(--z-popover)] py-1 animate-in fade-in zoom-in-95 duration-100"
                                        style={{ top: `${templateMenuFor.top}px`, right: `${templateMenuFor.right}px` }}
                                    >
                                        {onEditTemplate && (
                                            <button
                                                role="menuitem"
                                                onClick={() => { closeNewMenus(); onEditTemplate(templateMenuFor.tpl); }}
                                                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors text-left"
                                            >
                                                <Edit2 size={13} className="text-[var(--text-tertiary)]" />
                                                <span>{t('table.edit')}</span>
                                            </button>
                                        )}
                                        {onDuplicateTemplate && (
                                            <button
                                                role="menuitem"
                                                onClick={() => { closeNewMenus(); onDuplicateTemplate(templateMenuFor.tpl); }}
                                                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors text-left"
                                            >
                                                <Copy size={13} className="text-[var(--text-tertiary)]" />
                                                <span>{t('table.duplicate')}</span>
                                            </button>
                                        )}
                                        {onSetDefaultTemplate && !templateMenuFor.tpl?.metadata?.is_default_template && (
                                            <button
                                                role="menuitem"
                                                onClick={() => { closeNewMenus(); onSetDefaultTemplate(templateMenuFor.tpl); }}
                                                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors text-left"
                                            >
                                                <Star size={13} className="text-[var(--text-tertiary)]" />
                                                <span>{t('table.set_default')}</span>
                                            </button>
                                        )}
                                        {onDeleteTemplate && (
                                            <>
                                                <div className="h-px bg-[var(--border-primary)] my-1 mx-2" />
                                                <button
                                                    role="menuitem"
                                                    onClick={() => { closeNewMenus(); onDeleteTemplate(templateMenuFor.tpl); }}
                                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-500 hover:bg-red-500/10 transition-colors text-left"
                                                >
                                                    <Trash2 size={13} />
                                                    <span>{t('table.delete')}</span>
                                                </button>
                                            </>
                                        )}
                                    </div>
                                ), document.body)}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* View management panel ("+" button): reorder/configure existing
                views and create new ones. It is portalled so header overflow and
                transformed ancestors cannot detach or clip it. */}
            {isAddingView && viewPopoverLayout && createPortal((
                <>
                    <div className="fixed inset-0 z-[var(--z-overlay)]" onClick={() => setIsAddingView(false)} />
                    <div
                        role="dialog"
                        aria-label={t('views_header.manage_views', "Views")}
                        className="fixed flex flex-col overflow-y-auto bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-xl z-[var(--z-popover)] py-1.5 animate-in fade-in zoom-in-95 duration-150"
                        style={viewPopoverLayout}
                    >
                        {/* Section: management of existing views */}
                        <div className="px-3 py-1 text-[10px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">
                            {t('views_header.manage_views', "Views")}
                        </div>
                        <div className="max-h-72 overflow-y-auto px-1">
                            <DndContext
                                sensors={sensors}
                                collisionDetection={closestCenter}
                                onDragEnd={handleManageDragEnd}
                            >
                                <SortableContext items={views.map(v => v.id)} strategy={verticalListSortingStrategy}>
                                    {[...views]
                                        // Main/primary view pinned at the top of the manage list.
                                        .sort((a, b) => (isMainView(b, views) ? 1 : 0) - (isMainView(a, views) ? 1 : 0))
                                        .map(view => (
                                        <SortableManageRow
                                            key={view.id}
                                            view={view}
                                            tableViews={views}
                                            isActive={activeViewId === view.id}
                                            onAction={handleViewAction}
                                        />
                                    ))}
                                </SortableContext>
                            </DndContext>
                        </div>

                        <div className="h-px bg-[var(--border-primary)] my-1.5 mx-2" />

                        {/* Section: create a new view */}
                        <div className="px-3 py-1 text-[10px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">
                            {t('views_header.add_new_view', "Add new view")}
                        </div>
                        {VIEW_TYPES.map(vt => {
                             const ViewIcon = vt.icon;
                             return (
                                <button
                                    key={vt.id}
                                    onClick={() => { setIsAddingView(false); onAddView(vt.id); }}
                                    className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors text-left"
                                >
                                    <ViewIcon size={14} className="text-[var(--text-tertiary)]" />
                                    <span className="capitalize">{t(`view.type_${vt.id}`, vt.label)}</span>
                                </button>
                             );
                        })}
                    </div>
                </>
            ), document.body)}
        </div>
    );
}
