import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import type { CitationEvidence } from './vaultMarkdownModel';


interface CitationEvidencePanelProps {
    readonly evidence: CitationEvidence | null;
    readonly loading: boolean;
    readonly onClose: () => void;
    readonly panelRef: RefObject<HTMLElement | null>;
}


export function CitationEvidencePanel({
    evidence,
    loading,
    onClose,
    panelRef,
}: CitationEvidencePanelProps) {
    const { t } = useTranslation();
    return (
        <aside
            aria-label={t('llm_wiki.evidence_title', 'Citation evidence')}
            className="fixed bottom-4 right-4 z-[130] w-[min(420px,calc(100vw-2rem))] rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] p-4 shadow-2xl"
            ref={panelRef}
            role="dialog"
        >
            <div className="mb-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                    <div className="text-xs font-bold text-[var(--text-primary)]">
                        {t('llm_wiki.evidence_title', 'Citation evidence')}
                    </div>
                    {evidence?.label ? (
                        <div className="truncate text-[11px] text-[var(--text-tertiary)]">
                            {evidence.label}
                        </div>
                    ) : null}
                </div>
                <button
                    aria-label={t('common.close', 'Close')}
                    className="gnosi-close-btn"
                    onClick={onClose}
                    type="button"
                >×</button>
            </div>
            {loading ? (
                <p className="text-xs text-[var(--text-tertiary)]">
                    {t('llm_wiki.evidence_loading', 'Loading excerpt…')}
                </p>
            ) : null}
            {evidence?.segment?.text ? (
                <mark className="block rounded-md bg-amber-200/40 p-3 text-xs leading-relaxed text-[var(--text-primary)]">
                    {evidence.segment.text}
                </mark>
            ) : null}
            {evidence?.source_url ? (
                <a
                    className="mt-3 inline-block text-xs text-[var(--gnosi-primary)] hover:underline"
                    href={evidence.source_url}
                    rel="noreferrer"
                    target="_blank"
                >{t('llm_wiki.evidence_open_original', 'Open original source')}</a>
            ) : null}
        </aside>
    );
}
