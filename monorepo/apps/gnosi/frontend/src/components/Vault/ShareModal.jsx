import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { Share2, X, Link2, Copy, Trash2, Check, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from '../../lib/toast';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';
import { ConfirmModal } from '../ConfirmModal';

const PERMISSIONS = [
    { id: 'view', label: 'Lectura' },
    { id: 'comment', label: 'Comentar' },
    { id: 'edit', label: 'Edició' },
];

/**
 * Notion-style "Share" modal: creates/lists/revokes public links for a
 * page. The link points to `/s/{token}`, accessible without a session.
 */
export function ShareModal({ pageId, pageTitle, open, onClose }) {
    const { t, i18n } = useTranslation();
    const modalRef = useRef(null);
    const [shares, setShares] = useState([]);
    const [loading, setLoading] = useState(false);
    const [creating, setCreating] = useState(false);
    const [permission, setPermission] = useState('view');
    const [expiresInDays, setExpiresInDays] = useState('');
    const [copiedToken, setCopiedToken] = useState(null);
    const [revokeTarget, setRevokeTarget] = useState(null);

    const fetchShares = useCallback(async () => {
        if (!pageId) return;
        setLoading(true);
        try {
            const res = await axios.get(`/api/vault/pages/${pageId}/shares`);
            setShares(res.data?.shares || []);
        } catch (err) {
            console.error('Error carregant enllaços compartits:', err);
            toast.error(t('errors.shares_load', { defaultValue: 'No s\'han pogut carregar els enllaços' }));
        } finally {
            setLoading(false);
        }
    }, [pageId, t]);

    useEffect(() => { if (open && pageId) fetchShares(); }, [open, pageId, fetchShares]);

    useModalKeyboard({
        isOpen: open,
        onClose,
        containerRef: modalRef,
        trapFocus: true,
        closeOnEscape: !revokeTarget,
    });

    const publicUrl = (token) => `${window.location.origin}/s/${token}`;

    const createLink = async () => {
        if (creating) return;
        setCreating(true);
        try {
            const body = { permission };
            const days = parseInt(expiresInDays, 10);
            if (!Number.isNaN(days) && days > 0) body.expires_in_days = days;
            const res = await axios.post(`/api/vault/pages/${pageId}/share`, body);
            setShares(prev => [...prev, res.data]);
            // Copy the fresh link straight away — the common next action.
            try {
                await navigator.clipboard.writeText(publicUrl(res.data.token));
                setCopiedToken(res.data.token);
                setTimeout(() => setCopiedToken(null), 2000);
            } catch { /* clipboard may be blocked; link is still listed */ }
            toast.success(t('share.created', { defaultValue: 'Enllaç creat i copiat' }));
        } catch (err) {
            console.error('Error creant enllaç:', err);
            toast.error(t('errors.share_create', { defaultValue: 'Error creant l\'enllaç' }));
        } finally {
            setCreating(false);
        }
    };

    const copyLink = async (token) => {
        try {
            await navigator.clipboard.writeText(publicUrl(token));
            setCopiedToken(token);
            setTimeout(() => setCopiedToken(null), 2000);
        } catch {
            toast.error(t('errors.clipboard', { defaultValue: 'No s\'ha pogut copiar' }));
        }
    };

    const doRevoke = async () => {
        const target = revokeTarget;
        if (!target) return;
        try {
            await axios.delete(`/api/vault/share/${target.token}`);
            setShares(prev => prev.filter(s => s.token !== target.token));
        } catch (err) {
            console.error('Error revocant enllaç:', err);
            toast.error(t('errors.share_revoke', { defaultValue: 'Error revocant l\'enllaç' }));
        } finally {
            setRevokeTarget(null);
        }
    };

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4 animate-in fade-in duration-150">
            <div className="absolute inset-0 bg-black/40" onClick={onClose} />
            <div
                ref={modalRef}
                role="dialog"
                aria-modal="true"
                className="relative w-full max-w-lg bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-2xl shadow-2xl flex flex-col max-h-[80vh] animate-in zoom-in-95 duration-200"
            >
                <div className="px-5 py-4 border-b border-[var(--border-primary)] flex items-center justify-between bg-[var(--bg-secondary)] rounded-t-2xl">
                    <div className="flex items-center gap-2 min-w-0">
                        <Share2 size={18} className="text-[var(--gnosi-blue)] shrink-0" />
                        <div className="min-w-0">
                            <h3 className="text-base font-bold text-[var(--text-primary)] truncate">
                                {t('share.title', 'Comparteix')}
                            </h3>
                            {pageTitle && <p className="text-xs text-[var(--text-tertiary)] truncate">{pageTitle}</p>}
                        </div>
                    </div>
                    <button onClick={onClose} className="gnosi-close-btn" aria-label={t('common.close', 'Tanca')}>
                        <X />
                    </button>
                </div>

                {/* Create */}
                <div className="px-5 py-4 border-b border-[var(--border-primary)] space-y-3">
                    <div className="flex items-end gap-2 flex-wrap">
                        <div className="flex-1 min-w-[120px]">
                            <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] mb-1">
                                {t('share.permission', 'Permís')}
                            </label>
                            <select
                                value={permission}
                                onChange={(e) => setPermission(e.target.value)}
                                className="w-full text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-secondary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-blue)]"
                            >
                                {PERMISSIONS.map(p => (
                                    <option key={p.id} value={p.id}>{t(`share.perm_${p.id}`, p.label)}</option>
                                ))}
                            </select>
                        </div>
                        <div className="w-28">
                            <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] mb-1">
                                {t('share.expires', 'Caduca (dies)')}
                            </label>
                            <input
                                type="number"
                                min="1"
                                value={expiresInDays}
                                onChange={(e) => setExpiresInDays(e.target.value)}
                                placeholder="∞"
                                className="w-full text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-secondary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-blue)]"
                            />
                        </div>
                        <button
                            onClick={createLink}
                            disabled={creating}
                            className="px-3 py-2 rounded-lg bg-[var(--gnosi-blue)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1.5"
                        >
                            {creating ? <Loader2 size={15} className="animate-spin" /> : <Link2 size={15} />}
                            {t('share.create', 'Crear enllaç')}
                        </button>
                    </div>
                </div>

                {/* List */}
                <div className="flex-1 overflow-y-auto custom-scrollbar px-5 py-4 space-y-2">
                    {loading ? (
                        <div className="flex items-center justify-center py-8 text-[var(--text-tertiary)]">
                            <Loader2 size={18} className="animate-spin mr-2" />{t('common.loading', 'Carregant…')}
                        </div>
                    ) : shares.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-8 text-[var(--text-tertiary)]">
                            <Link2 size={26} className="mb-2 opacity-40" />
                            <p className="text-sm">{t('share.empty', 'Encara no hi ha enllaços públics')}</p>
                        </div>
                    ) : (
                        shares.map((s) => (
                            <div key={s.token} className="flex items-center gap-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)]/40 px-3 py-2">
                                <Link2 size={14} className="text-[var(--text-tertiary)] shrink-0" />
                                <div className="min-w-0 flex-1">
                                    <p className="text-xs text-[var(--text-primary)] truncate font-mono">{publicUrl(s.token)}</p>
                                    <p className="text-[10px] text-[var(--text-tertiary)]">
                                        {t(`share.perm_${s.permission}`, s.permission)}
                                        {s.expires_at ? ` · ${t('share.until', 'fins')} ${new Date(s.expires_at).toLocaleDateString(i18n.language)}` : ''}
                                    </p>
                                </div>
                                <button
                                    onClick={() => copyLink(s.token)}
                                    className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                                    title={t('share.copy', 'Copia')}
                                >
                                    {copiedToken === s.token ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                                </button>
                                <button
                                    onClick={() => setRevokeTarget(s)}
                                    className="p-1.5 rounded hover:bg-red-500/10 text-[var(--text-tertiary)] hover:text-red-600"
                                    title={t('share.revoke', 'Revoca')}
                                >
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        ))
                    )}
                </div>
            </div>

            <ConfirmModal
                isOpen={Boolean(revokeTarget)}
                title={t('share.revoke_title', 'Revocar enllaç')}
                message={t('share.revoke_msg', 'Qualsevol persona amb aquest enllaç deixarà de tenir accés. Continuar?')}
                confirmText={t('share.revoke', 'Revoca')}
                isDestructive
                onConfirm={doRevoke}
                onClose={() => setRevokeTarget(null)}
            />
        </div>
    );
}

export default ShareModal;
