import React, { useEffect, useRef, useState } from 'react';
import { Search, Star, MoreHorizontal, ChevronRight, ChevronLeft, Menu, Trash2, History, Code2 } from 'lucide-react';
import { AppHeader } from '../AppHeader';

export const NotionShell = ({
    sidebarContent,
    breadcrumbs = [],
    onSearch,
    isFavorite = false,
    onToggleFavorite,
    onBack,
    onForward,
    canGoBack,
    canGoForward,
    onOpenHistory,
    canOpenHistory = false,
    onDeleteCurrentPage,
    canDeleteCurrentPage = false,
    onToggleCodeView,
    canToggleCodeView = false,
    isCodeView = false,
    children
}) => {
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [isPageMenuOpen, setIsPageMenuOpen] = useState(false);
    const pageMenuRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (pageMenuRef.current && !pageMenuRef.current.contains(event.target)) {
                setIsPageMenuOpen(false);
            }
        };

        if (isPageMenuOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isPageMenuOpen]);

    return (
        <div className="flex h-screen w-full overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)] font-sans selection:bg-indigo-100 italic-none transition-colors duration-300">
            {/* Sidebar - Estil Notion */}
            <aside
                className={`${isSidebarOpen ? 'w-[240px]' : 'w-0'} transition-all duration-300 ease-in-out border-r border-[var(--sidebar-border)] bg-[var(--sidebar-bg)] flex flex-col shrink-0 overflow-hidden relative group`}
            >
                {/* Botó tancar sidebar */}
                <button
                    onClick={() => setIsSidebarOpen(false)}
                    className="absolute top-4 right-2 p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded opacity-0 group-hover:opacity-100 transition-all"
                >
                    <ChevronRight className="rotate-180" size={16} />
                </button>

                <div className="flex-1 flex flex-col min-w-[240px] min-h-0">
                    {sidebarContent}
                </div>
            </aside>

            {/* Main Area */}
            <main className="flex-1 flex flex-col min-w-0 bg-[var(--bg-primary)] relative transition-colors duration-300">
                {/* Top Bar Minimalista (Accions de pàgina) */}
                <header className="h-12 flex items-center justify-between px-4 shrink-0 z-20 border-b border-[var(--border-primary)]">
                    <div className="flex items-center gap-1 overflow-hidden">

                        {/* Botó obrir sidebar (si està tancada) */}
                        {!isSidebarOpen && (
                            <button
                                onClick={() => setIsSidebarOpen(true)}
                                className="p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] rounded transition-colors mr-2"
                            >
                                <Menu size={18} />
                            </button>
                        )}

                        <div className="flex items-center gap-1 overflow-hidden ml-2">
                            {/* Botons de navegació */}
                            <div className="flex items-center gap-0.5 mr-2">
                                <button
                                    onClick={onBack}
                                    disabled={!canGoBack}
                                    className={`p-1 rounded transition-colors ${canGoBack ? 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]' : 'opacity-20 cursor-not-allowed'}`}
                                    title="Enrere"
                                >
                                    <ChevronLeft size={18} />
                                </button>
                                <button
                                    onClick={onForward}
                                    disabled={!canGoForward}
                                    className={`p-1 rounded transition-colors ${canGoForward ? 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]' : 'opacity-20 cursor-not-allowed'}`}
                                    title="Endavant"
                                >
                                    <ChevronRight size={18} />
                                </button>
                            </div>

                            {breadcrumbs.map((crumb, idx) => (
                                <React.Fragment key={idx}>
                                    {idx > 0 && <span className="text-[var(--text-secondary)] opacity-30 text-xs px-1">/</span>}
                                    <button
                                        onClick={crumb.onClick}
                                        className="text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] px-2 py-0.5 rounded truncate transition-colors font-medium max-w-[150px]"
                                    >
                                        {crumb.label}
                                    </button>
                                </React.Fragment>
                            ))}
                        </div>
                    </div>

                    <div className="flex items-center gap-1 pr-2 relative" ref={pageMenuRef}>
                        <button
                            onClick={onSearch}
                            className="p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded transition-colors"
                            title="Quick Search"
                        >
                            <Search size={16} />
                        </button>
                        <button
                            onClick={onToggleFavorite}
                            className={`p-1.5 rounded transition-colors ${isFavorite ? 'text-amber-500 hover:bg-amber-500/10' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'}`}
                            title="Favorite"
                        >
                            <Star size={16} fill={isFavorite ? "currentColor" : "none"} />
                        </button>
                        <button
                            onClick={() => setIsPageMenuOpen(prev => !prev)}
                            className="p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded transition-colors"
                            title="Opcions de pàgina"
                        >
                            <MoreHorizontal size={16} />
                        </button>

                        {isPageMenuOpen && (
                            <div className="absolute right-0 top-[calc(100%+6px)] w-56 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg shadow-xl z-[60] py-1 animate-in fade-in zoom-in-95 duration-200">
                                <button
                                    onClick={() => {
                                        setIsPageMenuOpen(false);
                                        if (canToggleCodeView && onToggleCodeView) {
                                            onToggleCodeView();
                                        }
                                    }}
                                    disabled={!canToggleCodeView}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed"
                                >
                                    <Code2 size={14} />
                                    <span>{isCodeView ? 'Canviar a vista normal' : 'Canviar a vista codi (md/json)'}</span>
                                </button>
                                <button
                                    onClick={() => {
                                        setIsPageMenuOpen(false);
                                        if (canOpenHistory && onOpenHistory) {
                                            onOpenHistory();
                                        }
                                    }}
                                    disabled={!canOpenHistory}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed"
                                >
                                    <History size={14} />
                                    <span>Veure històric</span>
                                </button>
                                <button
                                    onClick={() => {
                                        setIsPageMenuOpen(false);
                                        if (canDeleteCurrentPage && onDeleteCurrentPage) {
                                            onDeleteCurrentPage();
                                        }
                                    }}
                                    disabled={!canDeleteCurrentPage}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-red-600 hover:bg-red-500/10 disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed"
                                >
                                    <Trash2 size={14} />
                                    <span>Eliminar pàgina actual</span>
                                </button>
                            </div>
                        )}
                    </div>
                </header>

                {/* Content Area */}
                <div className="flex-1 flex flex-col overflow-hidden relative min-w-0">
                    {children}
                </div>
            </main>
        </div>
    );
};
