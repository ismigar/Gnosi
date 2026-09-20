import { useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ClipboardCheck, Loader2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { PluginLlmWikiMaintenanceResponse } from '../../../shared/api/plugins';
import { useModalKeyboard } from '../../../shared/hooks/useModalKeyboard';
import { browserDocumentBody } from '../../../shared/platform/browser-events';

interface BrainReviewDialogProps {
    readonly busy: boolean;
    readonly semantic: boolean;
    readonly error: string;
    readonly lint: PluginLlmWikiMaintenanceResponse['lint'] | null;
    readonly onClose: () => void;
    readonly onRetry: () => void;
}

export function BrainReviewDialog({ busy, semantic, error, lint, onClose, onRetry }: BrainReviewDialogProps) {
    const { t } = useTranslation();
    const titleId = useId();
    const modalRef = useRef<HTMLDivElement>(null);
    useModalKeyboard({ isOpen: true, onClose, containerRef: modalRef, trapFocus: true });

    return createPortal(<div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[110] p-4 font-sans backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div ref={modalRef} className="bg-[var(--bg-primary)] rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto border border-[var(--border-primary)]">
            <div className="px-5 py-3 border-b border-[var(--border-primary)] flex justify-between items-center gap-3 bg-[var(--bg-secondary)]">
                <h2 id={titleId} className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
                    <ClipboardCheck size={18} />{t('llm_wiki.tools.report_title')}
                </h2>
                <button type="button" className="gnosi-close-btn" onClick={onClose} aria-label={t('common.close')}><X /></button>
            </div>
            <div className="p-5 text-sm text-[var(--text-secondary)] space-y-3">
                {busy && <div role="status" className="flex items-center gap-2">
                    <Loader2 size={16} className="animate-spin" />
                    {t(semantic ? 'settings.plugins.llm_wiki_semantic_running' : 'settings.plugins.llm_wiki_lint_running')}
                </div>}
                {error && <div role="alert" className="space-y-3">
                    <p className="text-[var(--status-error)]">{error}</p>
                    <button type="button" className="btn-gnosi btn-gnosi-secondary" onClick={onRetry}>{t('common.retry')}</button>
                </div>}
                {lint && <div role="status" className="space-y-3">
                    <p className="font-semibold text-[var(--text-primary)]">{t('settings.plugins.llm_wiki_lint_summary', { count: lint.note_count })}</p>
                    <ul className="list-disc pl-5 space-y-1">
                        <li>{t('settings.plugins.llm_wiki_lint_orphans', { count: lint.counts.orphans ?? 0 })}</li>
                        <li>{t('settings.plugins.llm_wiki_lint_cites', { count: lint.counts.broken_cites ?? 0 })}</li>
                        <li>{t('settings.plugins.llm_wiki_lint_indexes', { count: lint.counts.index_drift ?? 0 })}</li>
                        <li>{t('settings.plugins.llm_wiki_lint_reprocess', { count: lint.counts.reprocess ?? 0 })}</li>
                    </ul>
                </div>}
            </div>
        </div>
    </div>, browserDocumentBody());
}
