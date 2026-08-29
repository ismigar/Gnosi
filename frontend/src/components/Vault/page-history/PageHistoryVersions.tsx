import type { KeyboardEvent } from 'react';
import { Clock, Loader2, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { VaultPageHistoryVersion } from '../../../shared/api/vault-history';


export interface PageHistoryVersionsProps {
    readonly history: readonly VaultPageHistoryVersion[];
    readonly loading: boolean;
    readonly onCompare: (version: VaultPageHistoryVersion) => void;
    readonly onPreview: (version: VaultPageHistoryVersion) => void;
    readonly onRestore: (version: VaultPageHistoryVersion) => void;
    readonly previewVersion: VaultPageHistoryVersion | null;
}


export function PageHistoryVersions({
    history,
    loading,
    onCompare,
    onPreview,
    onRestore,
    previewVersion,
}: PageHistoryVersionsProps) {
    const { t } = useTranslation();
    const openOnKeyboard = (
        event: KeyboardEvent<HTMLDivElement>,
        version: VaultPageHistoryVersion,
    ): void => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onPreview(version);
    };
    return <div className="flex w-1/3 flex-col border-r border-[var(--border-primary)] bg-[var(--bg-secondary)]/50">
        <div className="border-b border-[var(--border-primary)] bg-[var(--bg-primary)] p-4">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">
                {t('vault.history.available_versions')}
            </span>
        </div>
        <div className="custom-scrollbar flex-1 overflow-y-auto">
            {loading ? <div className="flex flex-col items-center justify-center p-12 text-[var(--text-tertiary)]">
                <Loader2 className="mb-4 animate-spin" size={32} />
                <p className="text-sm">{t('vault.history.loading')}</p>
            </div> : history.length === 0 ? <div className="flex flex-col items-center justify-center p-12 text-center">
                <Clock className="mb-4 text-[var(--bg-tertiary)]" size={40} strokeWidth={1} />
                <p className="text-sm text-[var(--text-tertiary)]">{t('vault.history.empty')}</p>
            </div> : <div className="divide-y divide-[var(--border-primary)]">
                {history.map((version) => {
                    const selected = previewVersion?.id === version.id;
                    return <div
                        className={`group flex w-full cursor-pointer items-center justify-between px-5 py-4 text-left outline-none transition-all focus-visible:ring-2 focus-visible:ring-[var(--gnosi-primary)]/40 ${selected ? 'border-l-4 border-l-[var(--gnosi-primary)] bg-[var(--bg-primary)]' : 'hover:bg-[var(--bg-tertiary)]'}`}
                        key={version.id}
                        onClick={() => { onPreview(version); }}
                        onKeyDown={(event) => { openOnKeyboard(event, version); }}
                        role="button"
                        tabIndex={0}
                    >
                        <div className="min-w-0">
                            <p className={`truncate text-sm font-semibold ${selected ? 'text-[var(--gnosi-primary)]' : 'text-[var(--text-primary)]'}`}>
                                {version.timestamp}
                            </p>
                            <p className="mt-0.5 text-[10px] font-medium text-[var(--text-tertiary)] transition-colors">
                                {(version.size / 1024).toFixed(1)} KB • {version.author || 'Sistema'}
                            </p>
                        </div>
                        <button
                            className="rounded-md bg-[var(--bg-primary)] p-1.5 text-[var(--gnosi-primary)] opacity-0 shadow-sm transition-all hover:bg-[var(--gnosi-primary)]/10 group-hover:opacity-100"
                            onClick={(event) => {
                                event.stopPropagation();
                                onRestore(version);
                            }}
                            title={t('vault.history.restore_tooltip')}
                            type="button"
                        >
                            <RotateCcw size={14} />
                        </button>
                        <button
                            className="p-1.5 text-xs text-[var(--text-tertiary)] hover:text-[var(--gnosi-primary)]"
                            onClick={(event) => {
                                event.stopPropagation();
                                onCompare(version);
                            }}
                            title={t('vault.history.compare_version', 'Compare with this version')}
                            type="button"
                        >⇄</button>
                    </div>;
                })}
            </div>}
        </div>
    </div>;
}
