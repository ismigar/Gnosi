import { useEffect, useRef, useState } from 'react';
import { History, RotateCcw, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useModalKeyboard } from '../../hooks/useModalKeyboard';
import { logError } from '../../lib/notifyError';
import { toast } from '../../lib/toast';
import {
    fetchVaultPageHistory,
    fetchVaultPageHistoryVersion,
    purgeVaultPageHistory,
    restoreVaultPageHistoryVersion,
    type VaultPageHistoryVersion,
} from '../../shared/api/vault-history';
import { ConfirmModal } from '../ConfirmModal';
import { PageHistoryPreview } from './page-history/PageHistoryPreview';
import { PageHistoryVersions } from './page-history/PageHistoryVersions';
import { nextOlderHistoryVersion } from './page-history/pageHistoryModel';


export interface PageHistoryProps {
    readonly onClose: () => void;
    readonly onRestore: () => unknown;
    readonly open: boolean;
    readonly pageId: string;
}


export function PageHistory(props: PageHistoryProps) {
    if (!props.open) return null;
    return <PageHistoryDialog {...props} />;
}


function PageHistoryDialog({ onClose, onRestore, pageId }: PageHistoryProps) {
    const { t } = useTranslation();
    const panelRef = useRef<HTMLDivElement | null>(null);
    const [history, setHistory] = useState<VaultPageHistoryVersion[]>([]);
    const [loading, setLoading] = useState(true);
    const [previewContent, setPreviewContent] = useState<string | null>(null);
    const [previewVersion, setPreviewVersion] = useState<VaultPageHistoryVersion | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [restoreTarget, setRestoreTarget] = useState<VaultPageHistoryVersion | null>(null);
    const [purgeOpen, setPurgeOpen] = useState(false);
    const [comparisonContent, setComparisonContent] = useState<string | null>(null);
    const [comparisonVersion, setComparisonVersion] = useState<VaultPageHistoryVersion | null>(null);

    useEffect(() => {
        const controller = new AbortController();
        void fetchVaultPageHistory(pageId, controller.signal)
            .then(setHistory)
            .catch((error: unknown) => {
                if (controller.signal.aborted) return;
                logError('page-history.list', error);
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });
        return () => { controller.abort(); };
    }, [pageId]);

    useModalKeyboard({
        closeOnEscape: !restoreTarget && !purgeOpen,
        containerRef: panelRef,
        isOpen: true,
        onClose,
        trapFocus: true,
    });

    const preview = async (version: VaultPageHistoryVersion): Promise<void> => {
        setPreviewLoading(true);
        setPreviewVersion(version);
        try {
            const content = await fetchVaultPageHistoryVersion(pageId, version.id);
            setPreviewContent(content.content);
            const comparison = comparisonVersion
                ?? nextOlderHistoryVersion(history, version.id);
            if (comparison) {
                const older = await fetchVaultPageHistoryVersion(pageId, comparison.id);
                setComparisonContent(older.content);
            } else setComparisonContent(null);
        } catch (error: unknown) {
            logError('page-history.preview', error);
        } finally {
            setPreviewLoading(false);
        }
    };
    const compare = async (version: VaultPageHistoryVersion): Promise<void> => {
        setComparisonVersion(version);
        if (!previewVersion) return;
        setPreviewLoading(true);
        try {
            const content = await fetchVaultPageHistoryVersion(pageId, version.id);
            setComparisonContent(content.content);
        } catch (error: unknown) {
            logError('page-history.compare', error);
        } finally {
            setPreviewLoading(false);
        }
    };
    const restore = async (): Promise<void> => {
        if (!restoreTarget) return;
        try {
            await restoreVaultPageHistoryVersion(pageId, restoreTarget.id);
            onRestore();
            onClose();
        } catch (error: unknown) {
            logError('page-history.restore', error);
            toast.error(t('vault.history.error_restore'));
        } finally {
            setRestoreTarget(null);
        }
    };
    const purge = async (): Promise<void> => {
        try {
            await purgeVaultPageHistory(pageId);
            setHistory([]);
            setPreviewContent(null);
            setPreviewVersion(null);
            setComparisonContent(null);
            setComparisonVersion(null);
            toast.success(t(
                'vault.history.purge_success',
                'History purged successfully',
            ));
        } catch (error: unknown) {
            logError('page-history.purge', error);
            toast.error(t('vault.history.error_purge'));
        } finally {
            setPurgeOpen(false);
        }
    };

    return <div className="fixed inset-0 z-[var(--z-modal)] flex animate-in items-center justify-center bg-black/60 p-4 backdrop-blur-sm duration-200 fade-in">
        <div className="flex h-[80vh] w-full max-w-5xl animate-in flex-col overflow-hidden rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-2xl duration-200 zoom-in-95" ref={panelRef}>
            <div className="flex items-center justify-between border-b border-[var(--border-primary)] bg-[var(--bg-secondary)] px-6 py-4">
                <div className="flex items-center gap-3">
                    <div className="rounded-lg bg-[var(--gnosi-primary)]/10 p-2 text-[var(--gnosi-primary)]">
                        <History size={20} />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-[var(--text-primary)]">
                            {t('vault.history.title')}
                        </h3>
                        <p className="text-xs text-[var(--text-tertiary)]">
                            {t('vault.history.desc')}
                        </p>
                    </div>
                </div>
                <button
                    aria-label={t('vault.history.close', 'Close history')}
                    className="gnosi-close-btn"
                    onClick={onClose}
                    type="button"
                ><X /></button>
            </div>
            <div className="flex flex-1 overflow-hidden">
                <PageHistoryVersions
                    history={history}
                    loading={loading}
                    onCompare={(version) => { void compare(version); }}
                    onPreview={(version) => { void preview(version); }}
                    onRestore={setRestoreTarget}
                    previewVersion={previewVersion}
                />
                <div className="relative flex flex-1 flex-col bg-[var(--bg-primary)]">
                    <PageHistoryPreview
                        comparisonContent={comparisonContent}
                        content={previewContent}
                        loading={previewLoading}
                        onRestore={setRestoreTarget}
                        version={previewVersion}
                    />
                </div>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-[var(--border-primary)] bg-[var(--bg-secondary)] px-6 py-4">
                <div>{history.length > 0 ? <button
                    className="btn-gnosi btn-gnosi-danger"
                    onClick={() => { setPurgeOpen(true); }}
                    type="button"
                ><Trash2 size={16} />{t('vault.history.purge_btn')}</button> : null}</div>
                <div className="flex gap-3">
                    <button
                        className="rounded-xl border border-[var(--border-primary)] px-4 py-2 text-sm font-semibold text-[var(--text-secondary)] transition-all hover:bg-[var(--bg-tertiary)]"
                        onClick={onClose}
                        type="button"
                    >{t('common.cancel')}</button>
                    {previewVersion ? <button
                        className="btn-gnosi btn-gnosi-primary"
                        onClick={() => { setRestoreTarget(previewVersion); }}
                        type="button"
                    ><RotateCcw size={16} />{t('vault.history.restore_selected_btn')}</button> : null}
                </div>
            </div>
        </div>
        <ConfirmModal
            confirmText={t('common.restore', 'Restore')}
            isDestructive={false}
            isOpen={Boolean(restoreTarget)}
            message={t('vault.history.confirm_restore', { timestamp: restoreTarget?.timestamp })}
            onClose={() => { setRestoreTarget(null); }}
            onConfirm={restore}
            title={t('vault.history.confirm_restore_title', 'Restore version')}
        />
        <ConfirmModal
            confirmText={t('common.purge', 'Purge')}
            isDestructive
            isOpen={purgeOpen}
            message={t('vault.history.confirm_purge')}
            onClose={() => { setPurgeOpen(false); }}
            onConfirm={purge}
            title={t('vault.history.confirm_purge_title', 'Purge history')}
        />
    </div>;
}


export default PageHistory;
