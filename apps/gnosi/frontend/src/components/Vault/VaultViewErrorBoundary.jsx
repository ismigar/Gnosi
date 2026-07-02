import React from 'react';
import { AlertTriangle } from 'lucide-react';

/**
 * VaultViewErrorBoundary — xarxa de seguretat al voltant del COS d'una vista de
 * BD (taula, kanban, galeria, timeline, feed, calendari).
 *
 * Per què: durant una càrrega EN FRED el cos es pot renderitzar amb dades a mig
 * carregar (notes ↔ schema ↔ activeView ↔ registry encara resolent-se). Si una
 * cel·la o derivació llança en aquesta finestra transitòria, sense boundary
 * React ho reporta com a "recoverable error" ("An error occurred in the
 * <VaultTable> component. Consider adding an error boundary…") i, en el pitjor
 * cas, podria deixar la vista en blanc. Aquest boundary:
 *   1) Mostra un fallback DISCRET en comptes de tombar l'arbre.
 *   2) S'AUTO-RECUPERA: quan canvia qualsevol `resetKey` (p. ex. arriben les
 *      dades, o l'usuari canvia de vista/taula) neteja l'estat d'error i torna a
 *      renderitzar els fills. Sense això, un throw transitori deixaria la vista
 *      bloquejada al fallback fins a un F5 manual.
 *   3) Deixa el stack + component stack a `window.__vaultViewError` per a
 *      depuració (el canal que faltava: els recoverable errors de React 19 van
 *      per `reportError()` → event `window 'error'`, no per `console`).
 *
 * És el patró que recomana el propi missatge de React. Reutilitzat per
 * VaultViewBody, així cobreix els 3 punts de render del Dashboard i l'embed.
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
        // Reset NOMÉS quan un resetKey ha canviat de VALOR (no per la nova
        // referència de l'array, que es crea a cada render): així evitem un bucle
        // reset→throw→reset si el fill torna a llançar amb les mateixes dades.
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
                        No s'ha pogut mostrar aquesta vista
                    </p>
                    <p className="text-xs text-[var(--text-tertiary)] mt-1">
                        Hi ha hagut un error en renderitzar. Reintenta o recarrega la pàgina.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={this.handleRetry}
                    className="px-3 py-1.5 text-xs font-medium rounded-md border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                >
                    Reintenta
                </button>
            </div>
        );
    }
}

export default VaultViewErrorBoundary;
