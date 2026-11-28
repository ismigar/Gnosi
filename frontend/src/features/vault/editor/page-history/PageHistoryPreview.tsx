import { FileText, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { VaultPageHistoryContent, VaultPageHistoryVersion } from '../../../../shared/api/vault-history';
import { pageHistoryDiffLines, pageHistoryDiffSummary } from './pageHistoryModel';


export interface PageHistoryPreviewProps {
    readonly comparisonContent: string | null;
    readonly content: VaultPageHistoryContent | null;
    readonly loading: boolean;
    readonly version: VaultPageHistoryVersion | null;
}


export function PageHistoryPreview({
    comparisonContent,
    content,
    loading,
    version,
}: PageHistoryPreviewProps) {
    const { t } = useTranslation();
    if (loading) return <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[var(--bg-primary)]/80">
        <Loader2 className="mb-4 animate-spin text-[var(--gnosi-primary)]" size={40} />
        <p className="text-sm font-medium text-[var(--text-secondary)]">
            {t('vault.history.preview_loading')}
        </p>
    </div>;
    if (!content || !version) return <div className="flex flex-1 flex-col items-center justify-center p-12 text-center">
        <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-[var(--bg-tertiary)]">
            <FileText className="text-[var(--text-tertiary)]" size={32} strokeWidth={1} />
        </div>
        <h4 className="mb-2 text-base font-bold text-[var(--text-primary)]">
            {t('vault.history.no_selection_title')}
        </h4>
        <p className="max-w-xs text-sm text-[var(--text-tertiary)]">
            {t('vault.history.no_selection_desc')}
        </p>
    </div>;
    const title = [content.metadata.title, content.metadata['Títol']]
        .find((value): value is string => typeof value === 'string' && value.trim().length > 0);
    const summary = comparisonContent === null
        ? null
        : pageHistoryDiffSummary(comparisonContent, content.content);
    const lines = comparisonContent === null
        ? null
        : pageHistoryDiffLines(comparisonContent, content.content);
    return <div className="flex h-full flex-col">
        <div className="border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]/30 px-6 py-3">
            {title && <h4 className="mb-1 break-words text-sm font-semibold text-[var(--text-primary)]">{title}</h4>}
            <div className="flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)]">
                <FileText className="shrink-0 text-[var(--text-tertiary)]" size={14} />
                <span>{t('vault.history.version_at', { timestamp: version.timestamp })}</span>
            </div>
        </div>
        {summary ? <div className="border-b border-[var(--border-primary)] bg-[var(--gnosi-primary)]/5 px-6 py-2 text-xs text-[var(--text-secondary)]">
            {t('vault.history.visual_diff', {
                added: summary.added,
                defaultValue: '{{added}} lines added · {{removed}} lines removed versus the previous version',
                removed: summary.removed,
            })}
        </div> : null}
        <div className="custom-scrollbar flex-1 overflow-y-auto bg-[var(--bg-primary)] p-8">
            <div className="mx-auto max-w-3xl">
                <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-relaxed text-[var(--text-primary)] selection:bg-[var(--gnosi-primary)]/20">
                    {lines === null ? content.content : lines.map(({ kind, line }, index) => <span
                        className={`vault-history-diff-line vault-history-diff-line--${kind}`}
                        key={`${kind}-${String(index)}`}
                    >
                        {kind === 'added' ? '+ ' : kind === 'removed' ? '− ' : '  '}{line}{'\n'}
                    </span>)}
                </pre>
            </div>
        </div>
    </div>;
}
