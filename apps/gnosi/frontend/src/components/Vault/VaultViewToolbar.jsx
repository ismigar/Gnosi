/**
 * VaultViewToolbar.jsx
 * Barra d'eines per a les vistes del Vault (filtres, ordenació, cerca, configuració).
 */
import React from 'react';
import { Search, SlidersHorizontal, ArrowUpDown, Filter, X } from 'lucide-react';

export function VaultViewToolbar({
    searchTerm = '',
    setSearchTerm,
    showSearch,
    setShowSearch,
    onOpenFilters,
    onOpenSort,
    onOpenConfig,
    activeFiltersCount = 0,
    activeSortsCount = 0,
    className = '',
}) {
    return (
        <div className={`flex items-center gap-1 ${className}`}>
            {/* Filtre */}
            <button
                onClick={onOpenFilters}
                className={`relative flex items-center gap-1.5 px-2 py-1.5 text-xs rounded-md transition-colors ${
                    activeFiltersCount > 0
                        ? 'bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)] border border-[var(--gnosi-primary)]/20 shadow-sm'
                        : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
                }`}
                title="Filtres"
            >
                <Filter size={13} />
                {activeFiltersCount > 0 && (
                    <span className="bg-[var(--gnosi-primary)] text-white text-[10px] rounded-full px-1.5 py-0 leading-4">
                        {activeFiltersCount}
                    </span>
                )}
            </button>

            {/* Ordenació */}
            <button
                onClick={onOpenSort}
                className={`flex items-center gap-1.5 px-2 py-1.5 text-xs rounded-md transition-colors ${
                    activeSortsCount > 0
                        ? 'bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)] border border-[var(--gnosi-primary)]/20 shadow-sm'
                        : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
                }`}
                title="Ordenació"
            >
                <ArrowUpDown size={13} />
                {activeSortsCount > 0 && (
                    <span className="bg-[var(--gnosi-primary)] text-white text-[10px] rounded-full px-1.5 py-0 leading-4">
                        {activeSortsCount}
                    </span>
                )}
            </button>

            {/* Configuració */}
            {onOpenConfig && (
                <button
                    onClick={onOpenConfig}
                    className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] rounded-md transition-colors"
                    title="Configuració de la vista"
                >
                    <SlidersHorizontal size={13} />
                </button>
            )}

            {/* Cerca */}
            {showSearch ? (
                <div className="flex items-center gap-1 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-md px-2 py-1">
                    <Search size={12} className="text-[var(--text-tertiary)]" />
                    <input
                        autoFocus
                        type="text"
                        value={searchTerm}
                        onChange={e => setSearchTerm?.(e.target.value)}
                        placeholder="Cerca..."
                        className="text-xs outline-none w-28 text-[var(--text-primary)] bg-transparent"
                    />
                    <button
                        onClick={() => { setSearchTerm?.(''); setShowSearch?.(false); }}
                        className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                    >
                        <X size={12} />
                    </button>
                </div>
            ) : (
                <button
                    onClick={() => setShowSearch?.(true)}
                    className="p-1.5 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                    title="Cerca"
                >
                    <Search size={14} />
                </button>
            )}
        </div>
    );
}
