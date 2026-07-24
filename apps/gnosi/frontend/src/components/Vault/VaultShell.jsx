import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, ChevronRight, ChevronLeft, PanelLeft } from 'lucide-react';
import { AppHeader } from '../AppHeader';

export const VaultShell = ({
    sidebarContent,
    breadcrumbs = [],
    onSearch,
    onBack,
    onForward,
    canGoBack,
    canGoForward,
    children
}) => {
    const { t } = useTranslation();
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);

    return (
        <div className="flex h-screen w-full overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)] font-sans selection:bg-indigo-100 italic-none transition-colors duration-300">
            <aside
                className={`${isSidebarOpen ? 'w-[240px]' : 'w-0'} transition-all duration-300 ease-in-out border-r border-[var(--sidebar-border)] bg-[var(--sidebar-bg)] flex flex-col shrink-0 overflow-hidden relative`}
            >
                <div className="flex-1 flex flex-col min-w-[240px] min-h-0">
                    {sidebarContent}
                </div>
            </aside>

            {/* Main Area */}
            <main className="flex-1 flex flex-col min-w-0 bg-[var(--bg-primary)] relative transition-colors duration-300">
                {/* Minimal Top Bar (Page actions) */}
                <header className="h-12 flex items-center justify-between px-4 shrink-0 z-20 border-b border-[var(--border-primary)]">
                    <div className="flex items-center gap-1 overflow-hidden">

                        {/* Sidebar toggle (always visible) */}
                        <button
                            onClick={() => setIsSidebarOpen(prev => !prev)}
                            className="p-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] rounded transition-colors shrink-0"
                            title={isSidebarOpen ? t('shell.hide_sidebar', 'Amagar barra lateral') : t('shell.show_sidebar', 'Mostrar barra lateral')}
                        >
                            <PanelLeft size={16} />
                        </button>

                        <div className="flex items-center gap-1 overflow-hidden ml-2">
                            {/* Navigation buttons */}
                            <div className="flex items-center gap-0.5 mr-2">
                                <button
                                    onClick={onBack}
                                    disabled={!canGoBack}
                                    className={`p-1 rounded transition-colors ${canGoBack ? 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]' : 'opacity-20 cursor-not-allowed'}`}
                                    title={t('shell.go_back')}
                                >
                                    <ChevronLeft size={18} />
                                </button>
                                <button
                                    onClick={onForward}
                                    disabled={!canGoForward}
                                    className={`p-1 rounded transition-colors ${canGoForward ? 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]' : 'opacity-20 cursor-not-allowed'}`}
                                    title={t('shell.go_forward')}
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

                    {/* Global controls only. Page-specific actions (favorite, history,
                        comments, share, translate, code view, lock, delete) now live next
                        to the page title inside the editor — see PageActionsBar — and, for
                        tables, in the VaultViewsHeader. */}
                    <div className="flex items-center gap-1 pr-2">
                        <button
                            onClick={onSearch}
                            className="p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded transition-colors"
                            title="Quick Search"
                        >
                            <Search size={16} />
                        </button>
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
