import React from 'react';
import { AlertTriangle } from 'lucide-react';
import i18n from '../../i18n';

/**
 * VaultViewErrorBoundary — a safety net around the BODY of a DB view
 * (table, kanban, gallery, timeline, feed, calendar).
 *
 * Why: during a COLD load the body may render with half-loaded data
 * (notes ↔ schema ↔ activeView ↔ registry still resolving). If a
 * cell or a derivation throws in that transient window, without a boundary
 * React reports it as a "recoverable error" ("An error occurred in the
 * <VaultTable> component. Consider adding an error boundary…") and, in the worst
 * case, it could leave the view blank. This boundary:
 *   1) Shows a DISCREET fallback instead of taking down the tree.
 *   2) AUTO-RECOVERS: when any `resetKey` changes (e.g. the data
 *      arrives, or the user switches view/table) it clears the error state and
 *      re-renders the children. Without this, a transient throw would leave the view
 *      stuck on the fallback until a manual F5.
 *   3) Leaves the stack + component stack in `window.__vaultViewError` for
 *      debugging (the missing channel: React 19 recoverable errors go
 *      through `reportError()` → the `window 'error'` event, not through `console`).
 *
 * It is the pattern React's own message recommends. Reused by
 * VaultViewBody, so it covers the Dashboard's 3 render points and the embed.
 */
export class VaultViewErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
        this.handleRetry = this.handleRetry.bind(this);
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        try {
            window.__vaultViewError = {
                message: error?.message ?? String(error),
                stack: error?.stack ?? null,
                componentStack: errorInfo?.componentStack ?? null,
            };
        } catch { /* noop */ }
        console.error('VaultViewErrorBoundary caught an error', error, errorInfo);
    }

    componentDidUpdate(prevProps) {
        if (!this.state.hasError) return;
        // Reset ONLY when a resetKey has changed in VALUE (not because of the new
        // array reference, which is created on every render): this avoids a
        // reset→throw→reset loop if the child throws again with the same data.
        const prev = prevProps.resetKeys || [];
        const next = this.props.resetKeys || [];
        const changed = prev.length !== next.length || next.some((k, i) => !Object.is(k, prev[i]));
        if (changed) {
            this.setState({ hasError: false, error: null });
        }
    }

    handleRetry() {
        this.setState({ hasError: false, error: null });
    }

    render() {
        if (!this.state.hasError) return this.props.children;

        return (
            <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
                <div className="p-3 rounded-full bg-[var(--status-error)]/10 text-[var(--status-error)]">
                    <AlertTriangle size={24} />
                </div>
                <div className="max-w-sm">
                    <p className="text-sm font-medium text-[var(--text-secondary)]">
                        {i18n.t('view_error.title', "No s'ha pogut mostrar aquesta vista")}
                    </p>
                    <p className="text-xs text-[var(--text-tertiary)] mt-1">
                        {i18n.t('view_error.hint', 'Hi ha hagut un error en renderitzar. Reintenta o recarrega la pàgina.')}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={this.handleRetry}
                    className="px-3 py-1.5 text-xs font-medium rounded-md border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                >
                    {i18n.t('view_error.retry', 'Reintenta')}
                </button>
            </div>
        );
    }
}

export default VaultViewErrorBoundary;
