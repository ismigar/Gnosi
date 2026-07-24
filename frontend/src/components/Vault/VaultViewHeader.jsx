/**
 * VaultViewHeader.jsx
 * View header for displaying Vault tables inside the BlockEditor.
 * Lets you select views and search records.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Search, X } from 'lucide-react';

export function VaultViewHeader({
    displayViews = [],
    currentViewId,
    setActiveViewId,
    showSearch,
    setShowSearch,
    searchTerm,
    setSearchTerm,
    // The following props exist for interoperability but are handled in the Dashboard
    visibleTabsCount,
    showViewMenu,
    setShowViewMenu,
    onUpdateBlock,
    onDeleteView,
    setRenamingViewId,
    setNewViewName,
    renamingViewId,
    newViewName,
    handleRenameView,
    handleCreateActiveView,
    showConfig,
    setShowConfig,
    showLayout,
    setShowLayout,
    showSort,
    setShowSort,
    showFilters,
    setShowFilters,
    activeTableId,
    cv,
    tableSchema,
    onEditSchema,
    handleDragEnd,
    DatabaseTabsContainer,
    ViewTab,
    addViewMenuRef,
    showAddViewMenu,
    setShowAddViewMenu,
}) {
    const { t } = useTranslation();
    return (
        <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]/60 min-h-[40px]">
            {/* View tabs */}
            <div className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto scrollbar-none">
                {displayViews.map(view => (
                    <button
                        key={view.id}
                        onClick={() => setActiveViewId && setActiveViewId(view.id)}
                        className={`shrink-0 px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                            currentViewId === view.id
                                ? 'bg-[var(--bg-primary)] text-indigo-700 dark:text-indigo-400 shadow-sm border border-[var(--border-primary)]'
                                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-primary)]/60'
                        }`}
                    >
                        {view.name || t('views_header.default_view_name', "View")}
                    </button>
                ))}
            </div>

            {/* Search */}
            <div className="flex items-center gap-1 shrink-0 ml-2">
                {showSearch ? (
                    <div className="flex items-center gap-1 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-md px-2 py-1 focus-within:border-indigo-500">
                        <Search size={12} className="text-[var(--text-secondary)]" />
                        <input
                            autoFocus
                            type="text"
                            value={searchTerm || ''}
                            onChange={e => setSearchTerm && setSearchTerm(e.target.value)}
                            placeholder={t('common.search_placeholder', "Search...")}
                            className="text-xs outline-none w-28 text-[var(--text-primary)] bg-transparent"
                        />
                        <button
                            onClick={() => {
                                setSearchTerm && setSearchTerm('');
                                setShowSearch && setShowSearch(false);
                            }}
                            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                        >
                            <X size={12} />
                        </button>
                    </div>
                ) : (
                    <button
                        onClick={() => setShowSearch && setShowSearch(true)}
                        className="p-1.5 rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-primary)] transition-colors"
                        title={t('common.search', "Search")}
                    >
                        <Search size={14} />
                    </button>
                )}
            </div>
        </div>
    );
}
