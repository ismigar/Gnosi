import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { 
    Plus, Settings, Hash, Search, X, MoreHorizontal, 
    Edit2, Copy, Trash2, LayoutTemplate, SlidersHorizontal, 
    ChevronDown, Filter, ArrowUpDown, Tag, Type, CheckSquare, 
    Calendar, Layers, FileImage, Columns, List, BarChart2,
    Globe, MapPin, AlignLeft, Lock
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
    useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { VIEW_TYPES, getViewIcon, isMainView } from './viewConstants';
import { ReferenceImportExport } from './ReferenceImportExport';

function SortableTab({ view, tableViews, isActive, onSelect, onAction, onConfigure }) {
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

    const ViewIcon = getViewIcon(view.type);
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
                {/* Mànec de drag separat per evitar conflicte amb onClick */}
                <span
                    {...listeners}
                    className="cursor-grab active:cursor-grabbing flex items-center"
                    onClick={(e) => e.stopPropagation()}
                    title={t('views_header.drag_to_reorder', 'Arrossega per reordenar')}
                >
                    <ViewIcon size={13} className={isActive ? 'text-[var(--gnosi-blue)]' : 'text-[var(--text-tertiary)]'} />
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
                    className="absolute top-full left-0 mt-1 w-44 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-xl z-[1000] py-1 animate-in fade-in zoom-in-95 duration-100"
                >
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

export function VaultViewsHeader({ 
    tableName, 
    recordCount, 
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
    onConfigureFields,
    onCreateRecord,
    onCreateTemplate,
    onCreateFromSource,
    searchTerm,
    setSearchTerm,
    templates = [],
    onClose,
    referenceTableId,
    onReferencesImported,
}) {
    const { t } = useTranslation();
    const [showSearch, setShowSearch] = useState(false);
    const [isAddingView, setIsAddingView] = useState(false);
    const [showNewMenu, setShowNewMenu] = useState(false);
    
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    const containerRef = useRef(null);
    const actionsRef = useRef(null);
    const searchRef = useRef(null);
    const newMenuRef = useRef(null);
    const [visibleCount, setVisibleCount] = useState(views.length || 1);
    const [showOverflow, setShowOverflow] = useState(false);

    useEffect(() => {
        if (!showNewMenu) return undefined;
        const handler = (e) => {
            if (newMenuRef.current && !newMenuRef.current.contains(e.target)) {
                setShowNewMenu(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [showNewMenu]);
    
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
    }, [views.length]);

    // Sort views so that the active one is always visible if needed
    const displayViews = useMemo(() => {
        const activeIdx = views.findIndex(v => v.id === activeViewId);
        if (activeIdx === -1 || activeIdx < visibleCount) return views;
        
        // If the active one is out of range, move it temporarily to position visibleCount - 1
        const newDisplay = [...views];
        const activeView = newDisplay.splice(activeIdx, 1)[0];
        newDisplay.splice(visibleCount - 1, 0, activeView);
        return newDisplay;
    }, [views, activeViewId, visibleCount]);

    useEffect(() => {
        if (showSearch && searchRef.current) searchRef.current.focus();
    }, [showSearch]);

    const handleDragEnd = (event) => {
        const { active, over } = event;
        if (over && active.id !== over.id) {
            const oldIndex = views.findIndex(v => v.id === active.id);
            const newIndex = views.findIndex(v => v.id === over.id);
            const newViews = arrayMove(views, oldIndex, newIndex);
            onReorderViews?.(newViews);
        }
    };

    const handleViewAction = useCallback((view, action) => {
        if (action === 'configure') onEditView?.(view);
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
    }, [onEditView, onDeleteView, onDuplicateView, onRenameView]);

    // Gestió de l'input de cerca que s'expandeix

    return (
        <div className="relative z-50 flex flex-col w-full bg-[var(--bg-secondary)] border-b border-[var(--border-primary)] shrink-0">
            {/* Row 1: Title and Record Count */}
            <div className="flex items-start justify-between px-4 pt-vault-header-top pb-1.5 md:px-6 md:pb-2">
                <div className="flex items-center gap-3">
                    <h1 className="text-xl md:text-2xl font-bold text-[var(--text-primary)] flex items-center gap-2 md:gap-3 mt-0 leading-none">
                        {tableName}
                    </h1>
                    <span className="text-[10px] md:text-xs font-medium text-[var(--text-tertiary)] bg-[var(--bg-tertiary)] px-2 py-0.5 rounded-full border border-[var(--border-primary)]">
                        {t('views_header.records_count', { count: recordCount })}
                    </span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
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
                                items={displayViews.map(v => v.id)}
                                strategy={horizontalListSortingStrategy}
                            >
                                {displayViews.slice(0, visibleCount).map(view => (
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
                            {views.length > visibleCount && (
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
                                            <div className="absolute top-full left-0 mt-1 w-52 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-xl z-50 py-1 animate-in fade-in zoom-in-95 duration-100">
                                                <div className="px-3 py-1.5 text-[10px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">
                                                    {t('views_header.other_views')}
                                                </div>
                                                {displayViews.slice(visibleCount).map(view => {
                                                    const Icon = getViewIcon(view.type);
                                                    const primary = isMainView(view, views);
                                                    return (
                                                        <button 
                                                            key={view.id}
                                                            onClick={() => {
                                                                onViewSelect(view.id);
                                                                setShowOverflow(false);
                                                            }}
                                                            className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors text-left ${activeViewId === view.id ? 'text-[var(--gnosi-blue)] bg-[var(--gnosi-blue)]/5 font-medium' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'}`}
                                                        >
                                                            <Icon size={13} />
                                                            <span className="truncate">{view.name}</span>
                                                            {primary && (
                                                                <span className="ml-auto inline-flex items-center text-[9px] px-1.5 py-0.5 rounded border border-[var(--border-primary)] bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]" title={t('views_header.main_view')} aria-label={t('views_header.main_view')}>
                                                                    <Lock size={9} />
                                                                </span>
                                                            )}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </>
                                    )}
                                </div>
                            )}

                            {/* Add View button */}
                            <button
                                onClick={() => setIsAddingView(!isAddingView)}
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

                    {/* New button (split: acció principal + chevron per al menú) */}
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
                            onClick={() => setShowNewMenu(o => !o)}
                            aria-label={t('views_header.new_options', 'Opcions de creació')}
                            aria-haspopup="menu"
                            aria-expanded={showNewMenu}
                            className="btn-gnosi btn-gnosi-primary !px-2 !py-1.5 !shadow-none !rounded-l-none border-l border-white/20 hover:text-white/80 active:scale-95"
                        >
                            <ChevronDown size={14} />
                        </button>

                        {showNewMenu && (
                            <div className="absolute top-full right-0 mt-1 w-56 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-xl z-[1001] py-1 animate-in fade-in zoom-in-95 duration-100">
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
                                        <span>{t('views_header.new_from_source', { defaultValue: 'Crear des d\'una font…' })}</span>
                                    </button>
                                )}

                                {templates.length > 0 && (
                                    <>
                                        <div className="h-px bg-[var(--border-primary)] my-1 mx-2" />
                                        <div className="px-3 py-1 text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-tighter">{t('views_header.templates_title')}</div>
                                        {templates.map(tpl => (
                                            <button
                                                key={tpl.id}
                                                onClick={() => { setShowNewMenu(false); onCreateRecord?.(tpl.id); }}
                                                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors text-left group"
                                            >
                                                <LayoutTemplate size={14} className="text-[var(--text-tertiary)] group-hover:text-[var(--gnosi-primary)]" />
                                                <span className="truncate">{tpl.title || t('common.untitled')}</span>
                                                {tpl.metadata?.is_default_template && (
                                                    <span className="ml-auto text-[9px] bg-[var(--status-success)]/20 text-[var(--status-success)] px-1 rounded">{t('views_header.default_badge')}</span>
                                                )}
                                            </button>
                                        ))}
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Add view menu (same as before but more integrated) */}
            {isAddingView && (
                <div className="absolute top-full left-10 mt-1 w-48 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-xl z-[1002] py-1 animate-in slide-in-from-top-2 duration-200">
                    {VIEW_TYPES.map(vt => {
                         const ViewIcon = vt.icon;
                         return (
                            <button
                                key={vt.id}
                                onClick={() => { setIsAddingView(false); onAddView(vt.id); }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors text-left"
                            >
                                <ViewIcon size={14} className="text-[var(--text-tertiary)]" />
                                <span className="capitalize">{vt.label}</span>
                            </button>
                         );
                    })}
                </div>
            )}
        </div>
    );
}
