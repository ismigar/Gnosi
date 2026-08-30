import { Component, type ErrorInfo, type PropsWithChildren } from 'react';
import { X } from 'lucide-react';
import i18n from '../../../i18n';
interface BoundaryState { readonly hasError: boolean; readonly error: unknown; }
function errorText(value: unknown): string { return String(value); }

export class ErrorBoundary extends Component<PropsWithChildren, BoundaryState> {
    constructor(props: PropsWithChildren) {
        super(props);
        this.state = { hasError: false, error: null };
    }
    static getDerivedStateFromError(error: unknown): BoundaryState { return { hasError: true, error }; }
    componentDidCatch(error: Error, errorInfo: ErrorInfo) { console.error("ErrorBoundary caught an error", error, errorInfo); }
    render() {
        if (this.state.hasError) {
            return (
                <div className="p-12 border-2 border-dashed border-[var(--status-error)]/30 rounded-xl bg-[var(--status-error)]/5 flex flex-col items-center gap-4 text-center my-10">
                    <div className="p-4 bg-[var(--status-error)]/10 rounded-full text-[var(--status-error)]"><X size={32} /></div>
                    <div className="max-w-md">
                        <h3 className="text-lg font-bold text-[var(--text-primary)]">{i18n.t('editor.error_title')}</h3>
                        <p className="text-sm text-[var(--text-tertiary)] mt-1">{i18n.t('editor.error_hint')}</p>
                        <div className="bg-[var(--bg-secondary)] p-3 rounded-lg text-left mt-4 overflow-auto max-h-40 border border-[var(--border-primary)] shadow-inner">
                            <code className="text-[10px] text-[var(--text-tertiary)] leading-relaxed whitespace-pre-wrap">
                                {this.state.error == null ? '' : errorText(this.state.error)}
                            </code>
                        </div>
                    </div>
                </div>
            );
        }
        return this.props.children;
    }
}
