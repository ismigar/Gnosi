import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BrainCircuit, Loader2, Trash2, X } from 'lucide-react';
import { toast } from '../../lib/toast';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';
import {
    dismissBrainSuggestion,
    fetchBrainSuggestions,
} from '../../shared/api/brain';
import { WikilinkInline } from './WikilinkInline';

/**
 * Read-only Brain connection inbox.
 *
 * Proposals can be inspected or dismissed. They never create or edit permanent
 * notes; permanent-note authorship remains entirely manual.
 */
export function BrainInbox({ onAccepted }) {
    const { t } = useTranslation();
    const tb = (key, fallback, values = {}) => t(`llm_wiki.inbox.${key}`, {
        defaultValue: fallback,
        ...values,
    });
    const [open, setOpen] = useState(false);
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState('');
    const modalRef = useRef(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const response = await fetchBrainSuggestions();
            setItems(response.suggestions || []);
        } catch (error) {
            console.error('Could not load Brain connection proposals:', error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    useEffect(() => {
        if (open) load();
    }, [open, load]);

    useModalKeyboard({
        isOpen: open,
        onClose: () => setOpen(false),
        containerRef: modalRef,
        trapFocus: true,
    });

    const dismiss = async (suggestion) => {
        setBusy(suggestion.id);
        try {
            await dismissBrainSuggestion(suggestion.id);
            setItems((current) => current.filter((item) => item.id !== suggestion.id));
            onAccepted?.();
            toast.success(tb('dismissed', "Connection dismissed"));
        } catch (error) {
            toast.error(
                error instanceof Error && error.message
                    ? error.message
                    : tb('dismiss_error', "The connection could not be dismissed"),
            );
        } finally {
            setBusy('');
        }
    };

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="relative flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--gnosi-primary)] hover:bg-[var(--bg-secondary)] transition-colors"
                title={tb('button_title', "Connections proposed by the Brain")}
            >
                <BrainCircuit size={15} />
                {tb('button', "Connections")}
                {items.length > 0 && (
                    <span className="min-w-[16px] h-4 px-1 rounded-full bg-[var(--gnosi-primary)] text-white text-[10px] font-bold flex items-center justify-center">
                        {items.length}
                    </span>
                )}
            </button>

            {open && (
                <div
                    className="fixed inset-0 bg-black/60 flex items-center justify-center z-[110] p-4 font-sans backdrop-blur-sm"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="brain-connections-title"
                >
                    <div
                        ref={modalRef}
                        className="bg-[var(--bg-primary)] rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col border border-[var(--border-primary)]"
                    >
                        <div className="px-5 py-3 border-b border-[var(--border-primary)] flex justify-between items-center bg-[var(--bg-secondary)] shrink-0">
                            <h2
                                id="brain-connections-title"
                                className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2"
                            >
                                <BrainCircuit size={18} className="text-[var(--gnosi-primary)]" />
                                {tb('title', "Brain connections")}
                                {items.length > 0 && (
                                    <span className="text-xs font-semibold text-[var(--text-tertiary)]">
                                        ({items.length})
                                    </span>
                                )}
                            </h2>
                            <button
                                type="button"
                                onClick={() => setOpen(false)}
                                className="gnosi-close-btn"
                                aria-label={t('common.close', "Close")}
                            >
                                <X />
                            </button>
                        </div>

                        <div className="p-5 space-y-4 overflow-y-auto">
                            <p className="text-xs text-[var(--text-tertiary)]">
                                {tb(
                                    'readonly_help',
                                    "These proposals do not modify any note. Permanent notes remain manual.",
                                )}
                            </p>
                            {loading && (
                                <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                                    <Loader2 size={14} className="animate-spin" />
                                    {tb('loading', "Loading connections…")}
                                </div>
                            )}
                            {!loading && items.length === 0 && (
                                <p className="text-sm text-[var(--text-tertiary)]">
                                    {tb('empty', "No pending connections. New ones are proposed after processing or auditing the Brain.")}
                                </p>
                            )}
                            {items.map((suggestion) => (
                                <article
                                    key={suggestion.id}
                                    className="rounded-lg border border-[var(--border-primary)] p-4 space-y-3"
                                >
                                    <div className="flex items-start gap-3">
                                        <div className="min-w-0 flex-1">
                                            <span className="inline-flex rounded-full bg-[var(--bg-secondary)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--gnosi-primary)]">
                                                {tb(`kind_${suggestion.kind || 'connection'}`, suggestion.kind || 'connection')}
                                            </span>
                                            <h3 className="mt-1 text-sm font-semibold text-[var(--text-primary)]">
                                                {suggestion.title}
                                            </h3>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => dismiss(suggestion)}
                                            disabled={busy === suggestion.id}
                                            className="flex items-center gap-1 rounded-md border border-red-500/30 px-2.5 py-1.5 text-xs font-semibold text-red-500 hover:bg-red-500/10 disabled:opacity-50"
                                        >
                                            {busy === suggestion.id
                                                ? <Loader2 size={13} className="animate-spin" />
                                                : <Trash2 size={13} />}
                                            {tb('dismiss', "Dismiss")}
                                        </button>
                                    </div>

                                    {suggestion.why && (
                                        <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
                                            {suggestion.why}
                                        </p>
                                    )}

                                    {Array.isArray(suggestion.evidence) && suggestion.evidence.length > 0 && (
                                        <div className="space-y-1 border-l-2 border-[var(--gnosi-primary)]/40 pl-3">
                                            {suggestion.evidence.map((evidence, index) => (
                                                <blockquote
                                                    key={`${suggestion.id}-evidence-${index}`}
                                                    className="text-xs italic text-[var(--text-tertiary)]"
                                                >
                                                    {evidence}
                                                </blockquote>
                                            ))}
                                        </div>
                                    )}

                                    {Array.isArray(suggestion.member_ids) && suggestion.member_ids.length > 0 && (
                                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                                            <span className="text-[var(--text-tertiary)]">
                                                {tb('notes', 'Notes')}:
                                            </span>
                                            {suggestion.member_ids.map((memberId, index) => (
                                                <WikilinkInline
                                                    key={memberId}
                                                    title={suggestion.member_titles?.[index] || memberId}
                                                    target={memberId}
                                                />
                                            ))}
                                        </div>
                                    )}
                                </article>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
