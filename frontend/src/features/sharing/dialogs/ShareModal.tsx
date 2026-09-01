import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Link2, Loader2, Share2, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useModalKeyboard } from '../../../shared/hooks/useModalKeyboard';
import { toast } from '../../../shared/notifications/toast';
import {
    createShareLink,
    fetchShareLinks,
    revokeShareLink,
    type ShareLink,
} from '../../../shared/api/sharing';
import { writeClipboardText } from '../../../shared/platform/clipboard';
import { ConfirmModal } from '../../../shared/ui/dialogs/ConfirmModal';
import {
    SHARE_PERMISSIONS,
    shareExpirationDays,
    sharePublicUrl,
} from './share-modal/shareModalModel';


export interface ShareModalProps {
    readonly onClose: () => void;
    readonly open: boolean;
    readonly pageId?: string | null;
    readonly pageTitle?: string | null;
}


export function ShareModal(props: ShareModalProps) {
    if (!props.open) return null;
    return <ShareModalContent {...props} key={props.pageId || ''} />;
}


function ShareModalContent({ onClose, pageId, pageTitle }: ShareModalProps) {
    const { i18n, t } = useTranslation();
    const modalRef = useRef<HTMLDivElement | null>(null);
    const copiedTimerRef = useRef<number | null>(null);
    const [shares, setShares] = useState<readonly ShareLink[]>([]);
    const [loading, setLoading] = useState(Boolean(pageId));
    const [creating, setCreating] = useState(false);
    const [permission, setPermission] = useState('view');
    const [expiresInDays, setExpiresInDays] = useState('');
    const [copiedToken, setCopiedToken] = useState<string | null>(null);
    const [revokeTarget, setRevokeTarget] = useState<ShareLink | null>(null);
    const sharesLoadError = t('errors.shares_load', {
        defaultValue: 'Could not load the links',
    });

    useEffect(() => {
        if (!pageId) return undefined;
        const controller = new AbortController();
        void fetchShareLinks(pageId, controller.signal)
            .then((data) => { setShares(data.shares); })
            .catch(() => {
                if (controller.signal.aborted) return;
                toast.error(sharesLoadError);
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });
        return () => { controller.abort(); };
    }, [pageId, sharesLoadError]);

    useEffect(() => () => {
        if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
    }, []);

    useModalKeyboard({
        closeOnEscape: !revokeTarget,
        containerRef: modalRef,
        isOpen: true,
        onClose,
        trapFocus: true,
    });

    const markCopied = (token: string): void => {
        setCopiedToken(token);
        if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = window.setTimeout(() => { setCopiedToken(null); }, 2000);
    };
    const publicUrl = (token: string): string => sharePublicUrl(window.location.origin, token);
    const copyLink = async (token: string): Promise<void> => {
        try {
            await writeClipboardText(publicUrl(token));
            markCopied(token);
        } catch {
            toast.error(t('errors.clipboard', { defaultValue: 'Could not copy' }));
        }
    };
    const createLink = async (): Promise<void> => {
        if (creating || !pageId) return;
        setCreating(true);
        try {
            const expires = shareExpirationDays(expiresInDays);
            const share = await createShareLink(pageId, {
                permission,
                ...(expires === undefined ? {} : { expires_in_days: expires }),
            });
            setShares((current) => [...current, share]);
            try {
                await writeClipboardText(publicUrl(share.token));
                markCopied(share.token);
            } catch {
                // The new link remains available when clipboard permission is denied.
            }
            toast.success(t('share.created', { defaultValue: 'Link created and copied' }));
        } catch {
            toast.error(t('errors.share_create', { defaultValue: 'Error creating the link' }));
        } finally {
            setCreating(false);
        }
    };
    const revoke = async (): Promise<void> => {
        const target = revokeTarget;
        if (!target) return;
        try {
            await revokeShareLink(target.token);
            setShares((current) => current.filter((share) => share.token !== target.token));
        } catch {
            toast.error(t('errors.share_revoke', { defaultValue: 'Error revoking the link' }));
        } finally {
            setRevokeTarget(null);
        }
    };

    return <div className="fixed inset-0 z-[var(--z-modal)] flex animate-in items-center justify-center p-4 duration-150 fade-in">
        <div className="absolute inset-0 bg-black/40" />
        <div
            aria-modal="true"
            className="relative flex max-h-[80vh] w-full max-w-lg animate-in flex-col rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-2xl duration-200 zoom-in-95"
            ref={modalRef}
            role="dialog"
        >
            <div className="flex items-center justify-between rounded-t-2xl border-b border-[var(--border-primary)] bg-[var(--bg-secondary)] px-5 py-4">
                <div className="flex min-w-0 items-center gap-2">
                    <Share2 className="shrink-0 text-[var(--gnosi-blue)]" size={18} />
                    <div className="min-w-0">
                        <h3 className="truncate text-base font-bold text-[var(--text-primary)]">{t('share.title', 'Share')}</h3>
                        {pageTitle ? <p className="truncate text-xs text-[var(--text-tertiary)]">{pageTitle}</p> : null}
                    </div>
                </div>
                <button aria-label={t('common.close', 'Close')} className="gnosi-close-btn" onClick={onClose} type="button"><X /></button>
            </div>

            <div className="space-y-3 border-b border-[var(--border-primary)] px-5 py-4">
                <div className="flex flex-wrap items-end gap-2">
                    <div className="min-w-[120px] flex-1">
                        <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">{t('share.permission', 'Permission')}</label>
                        <select
                            className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-blue)]"
                            onChange={(event) => { setPermission(event.target.value); }}
                            value={permission}
                        >
                            {SHARE_PERMISSIONS.map((item) => <option key={item.id} value={item.id}>{t(`share.perm_${item.id}`, item.label)}</option>)}
                        </select>
                    </div>
                    <div className="w-28">
                        <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">{t('share.expires', 'Expires (days)')}</label>
                        <input
                            className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-blue)]"
                            min="1"
                            onChange={(event) => { setExpiresInDays(event.target.value); }}
                            placeholder="∞"
                            type="number"
                            value={expiresInDays}
                        />
                    </div>
                    <button
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--gnosi-blue)] px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                        disabled={creating || !pageId}
                        onClick={() => { void createLink(); }}
                        type="button"
                    >
                        {creating ? <Loader2 className="animate-spin" size={15} /> : <Link2 size={15} />}
                        {t('share.create', 'Create link')}
                    </button>
                </div>
            </div>

            <div className="custom-scrollbar flex-1 space-y-2 overflow-y-auto px-5 py-4">
                {loading ? <div className="flex items-center justify-center py-8 text-[var(--text-tertiary)]"><Loader2 className="mr-2 animate-spin" size={18} />{t('common.loading', 'Loading...')}</div> : null}
                {!loading && shares.length === 0 ? <div className="flex flex-col items-center justify-center py-8 text-[var(--text-tertiary)]"><Link2 className="mb-2 opacity-40" size={26} /><p className="text-sm">{t('share.empty', 'No public links yet')}</p></div> : null}
                {!loading ? shares.map((share) => <div className="flex items-center gap-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)]/40 px-3 py-2" key={share.token}>
                    <Link2 className="shrink-0 text-[var(--text-tertiary)]" size={14} />
                    <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-xs text-[var(--text-primary)]">{publicUrl(share.token)}</p>
                        <p className="text-[10px] text-[var(--text-tertiary)]">
                            {t(`share.perm_${share.permission}`, share.permission)}
                            {share.expires_at ? ` · ${t('share.until', 'until')} ${new Date(share.expires_at).toLocaleDateString(i18n.language)}` : ''}
                        </p>
                    </div>
                    <button className="rounded p-1.5 text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]" onClick={() => { void copyLink(share.token); }} title={t('share.copy', 'Copy')} type="button">
                        {copiedToken === share.token ? <Check className="text-emerald-600" size={14} /> : <Copy size={14} />}
                    </button>
                    <button className="rounded p-1.5 text-[var(--text-tertiary)] hover:bg-red-500/10 hover:text-red-600" onClick={() => { setRevokeTarget(share); }} title={t('share.revoke', 'Revoke')} type="button"><Trash2 size={14} /></button>
                </div>) : null}
            </div>
        </div>

        <ConfirmModal
            confirmText={t('share.revoke', 'Revoke')}
            isDestructive
            isOpen={Boolean(revokeTarget)}
            message={t('share.revoke_msg', 'Anyone with this link will lose access. Continue?')}
            onClose={() => { setRevokeTarget(null); }}
            onConfirm={revoke}
            title={t('share.revoke_title', 'Revoke link')}
        />
    </div>;
}


export default ShareModal;
