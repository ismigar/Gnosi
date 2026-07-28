import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, ChevronRight, ChevronLeft, PanelLeft } from 'lucide-react';
import { useMediaQuery } from '../../hooks/useMediaQuery';

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
    const isCompact = useMediaQuery('(max-width: 767px)');
    const sidebarMode = isCompact ? 'compact' : 'wide';
    const [sidebarOverrides, setSidebarOverrides] = useState({});
    const isSidebarOpen = sidebarOverrides[sidebarMode] ?? !isCompact;
    const setIsSidebarOpen = (nextValue) => {
        setSidebarOverrides(currentOverrides => {
            const currentValue = currentOverrides[sidebarMode] ?? !isCompact;
            const resolvedValue = typeof nextValue === 'function'
                ? nextValue(currentValue)
                : nextValue;

            if (currentOverrides[sidebarMode] === resolvedValue) {
                return currentOverrides;
            }

            return {
                ...currentOverrides,
                [sidebarMode]: resolvedValue
            };
        });
    };

    const visibleBreadcrumbs = isCompact && breadcrumbs.length > 1
        ? breadcrumbs.slice(0, -1)
        : breadcrumbs;

    return (
        <div className="vault-shell">
            {isCompact && isSidebarOpen && (
                <button
                    type="button"
                    className="vault-shell__backdrop"
                    onClick={() => setIsSidebarOpen(false)}
                    aria-label={t('shell.hide_sidebar', 'Hide sidebar')}
                />
            )}
            <aside
                id="vault-navigation"
                className={`vault-shell__sidebar ${isSidebarOpen ? 'is-open' : ''}`}
            >
                <div className="vault-shell__sidebar-content">
                    {sidebarContent}
                </div>
            </aside>

            {/* Main Area */}
            <main className="vault-shell__main">
                {/* Minimal Top Bar (Page actions) */}
                <header className="vault-shell__header h-12 flex items-center justify-between px-4 shrink-0 z-20 border-b border-[var(--border-primary)]">
                    <div className="flex items-center gap-1 overflow-hidden">

                        {/* Sidebar toggle (always visible) */}
                        <button
                            onClick={() => setIsSidebarOpen(prev => !prev)}
                            className="p-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] rounded transition-colors shrink-0"
                            title={isSidebarOpen ? t('shell.hide_sidebar', "Hide sidebar") : t('shell.show_sidebar', "Show sidebar")}
                            aria-label={isSidebarOpen ? t('shell.hide_sidebar', "Hide sidebar") : t('shell.show_sidebar', "Show sidebar")}
                            aria-expanded={isSidebarOpen}
                            aria-controls="vault-navigation"
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
                                    aria-label={t('shell.go_back')}
                                >
                                    <ChevronLeft size={18} />
                                </button>
                                <button
                                    onClick={onForward}
                                    disabled={!canGoForward}
                                    className={`p-1 rounded transition-colors ${canGoForward ? 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]' : 'opacity-20 cursor-not-allowed'}`}
                                    title={t('shell.go_forward')}
                                    aria-label={t('shell.go_forward')}
                                >
                                    <ChevronRight size={18} />
                                </button>
                            </div>

                            {visibleBreadcrumbs.map((crumb, idx) => (
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
                            title={t('shell.quick_search', 'Quick search')}
                            aria-label={t('shell.quick_search', 'Quick search')}
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
