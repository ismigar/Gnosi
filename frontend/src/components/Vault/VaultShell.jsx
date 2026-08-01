import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, ChevronRight, ChevronLeft, PanelLeft, Plus, X } from 'lucide-react';
import { useMediaQuery } from '../../hooks/useMediaQuery';

export const VaultShell = ({
    sidebarContent,
    breadcrumbs = [],
    onSearch,
    onBack,
    onForward,
    canGoBack,
    canGoForward,
    showDocumentControls = false,
    onNewDocument,
    onCloseDocument,
    children
}) => {
    const { t } = useTranslation();
    const isCompact = useMediaQuery('(max-width: 768px)');
    const isUltraCompact = useMediaQuery('(max-width: 359px)');
    const isNarrow = useMediaQuery('(max-width: 1023px)');
    const sidebarMode = isNarrow ? 'drawer' : 'wide';
    const [sidebarOverrides, setSidebarOverrides] = useState({});
    const isSidebarOpen = sidebarOverrides[sidebarMode] ?? !isNarrow;
    const setIsSidebarOpen = useCallback((nextValue) => {
        setSidebarOverrides(currentOverrides => {
            const currentValue = currentOverrides[sidebarMode] ?? !isNarrow;
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
    }, [isNarrow, sidebarMode]);

    const visibleBreadcrumbs = isCompact ? [] : breadcrumbs;
    const staleCheckout = import.meta.env.DEV
        && import.meta.env.VITE_GNOSI_STALE_CHECKOUT === '1';
    const checkoutLabel = import.meta.env.VITE_GNOSI_CHECKOUT_LABEL || '';
    const [isWarningDismissed, setIsWarningDismissed] = useState(false);
    const isMac = typeof navigator !== 'undefined'
        && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
    const newTabShortcut = isMac ? '⌘T' : 'Ctrl+T';
    const switchTabShortcut = isMac ? '⌘1–9' : 'Ctrl+1–9';
    const newTabLabel = t('doc_tabs.new_tab_tooltip', {
        shortcut: newTabShortcut,
        tabShortcut: switchTabShortcut,
        defaultValue: 'New tab or quick search ({{shortcut}}). Switch tab: {{tabShortcut}}',
    });

    useEffect(() => {
        if (!isNarrow || !isSidebarOpen) return undefined;
        const closeOnEscape = (event) => {
            if (event.key === 'Escape') setIsSidebarOpen(false);
        };
        window.addEventListener('keydown', closeOnEscape);
        return () => window.removeEventListener('keydown', closeOnEscape);
    }, [isNarrow, isSidebarOpen, setIsSidebarOpen]);

    return (
        <div className="vault-shell">
            {isNarrow && isSidebarOpen && (
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
                {isNarrow && isSidebarOpen && (
                    <button
                        type="button"
                        className="vault-shell__drawer-close"
                        onClick={() => setIsSidebarOpen(false)}
                        title={t('shell.hide_sidebar', 'Hide sidebar')}
                        aria-label={t('shell.hide_sidebar', 'Hide sidebar')}
                    >
                        <X size={18} />
                    </button>
                )}
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
                            className="vault-shell__icon-button p-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] rounded transition-colors shrink-0"
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
                                {(!isUltraCompact || canGoBack) && (
                                    <button
                                        onClick={onBack}
                                        disabled={!canGoBack}
                                        className={`vault-shell__icon-button p-1 rounded transition-colors ${canGoBack ? 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]' : 'opacity-20 cursor-not-allowed'}`}
                                        title={t('shell.go_back')}
                                        aria-label={t('shell.go_back')}
                                    >
                                        <ChevronLeft size={18} />
                                    </button>
                                )}
                                {(!isUltraCompact || (!canGoBack && canGoForward)) && (
                                    <button
                                        onClick={onForward}
                                        disabled={!canGoForward}
                                        className={`vault-shell__icon-button p-1 rounded transition-colors ${canGoForward ? 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]' : 'opacity-20 cursor-not-allowed'}`}
                                        title={t('shell.go_forward')}
                                        aria-label={t('shell.go_forward')}
                                    >
                                        <ChevronRight size={18} />
                                    </button>
                                )}
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
                        {showDocumentControls && (
                            <>
                                <button
                                    type="button"
                                    onClick={onNewDocument}
                                    className="vault-shell__icon-button p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded transition-colors"
                                    title={newTabLabel}
                                    aria-label={newTabLabel}
                                >
                                    <Plus size={16} />
                                </button>
                                <button
                                    type="button"
                                    onClick={onCloseDocument}
                                    className="vault-shell__icon-button p-1.5 text-[var(--text-secondary)] hover:text-[var(--status-error)] hover:bg-[var(--bg-tertiary)] rounded transition-colors"
                                    title={t('doc_tabs.close_tab', 'Close tab')}
                                    aria-label={t('doc_tabs.close_tab', 'Close tab')}
                                >
                                    <X size={16} />
                                </button>
                            </>
                        )}
                        <button
                            onClick={onSearch}
                            className="vault-shell__icon-button p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded transition-colors"
                            title={t('shell.quick_search', 'Quick search')}
                            aria-label={t('shell.quick_search', 'Quick search')}
                        >
                            <Search size={16} />
                        </button>
                    </div>
                </header>

                {staleCheckout && !isWarningDismissed && (
                    <div
                        className="vault-shell__checkout-warning"
                        role="status"
                        title={t('shell.stale_checkout', {
                            checkout: checkoutLabel,
                            defaultValue: 'Local preview is serving merged checkout {{checkout}}, behind origin/main.',
                        })}
                    >
                        <span className="vault-shell__checkout-warning-full">
                            {t('shell.stale_checkout', {
                                checkout: checkoutLabel,
                                defaultValue: 'Local preview is serving merged checkout {{checkout}}, behind origin/main.',
                            })}
                        </span>
                        <span className="vault-shell__checkout-warning-short">
                            {t('shell.stale_checkout_short', 'Local preview is outdated.')}
                        </span>
                        <button
                            type="button"
                            onClick={() => setIsWarningDismissed(true)}
                            aria-label={t('shell.dismiss_checkout_warning', 'Dismiss checkout warning')}
                            title={t('shell.dismiss_checkout_warning', 'Dismiss checkout warning')}
                        >
                            <X size={14} />
                        </button>
                    </div>
                )}

                {/* Content Area */}
                <div className="flex-1 flex flex-col overflow-hidden relative min-w-0">
                    {children}
                </div>
            </main>
        </div>
    );
};
