import React, { useRef, useState } from 'react';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { X, Globe, Loader2, ExternalLink } from 'lucide-react';
import { toast } from '../../lib/toast';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';

// Confirmation modal to sync a row with Drupal. Unlike the
// translation modal, there is nothing to choose: the node and all its
// existing translations are created/updated. It's confirmed because the action publishes to production.
export function SyncDrupalModal({ isOpen, onClose, noteId, recordMetadata = {}, onSynced }) {
    const { t } = useTranslation();
    const [submitting, setSubmitting] = useState(false);
    const [scope, setScope] = useState('all');
    const [pushMedia, setPushMedia] = useState(false);
    const containerRef = useRef(null);

    const existingUrl = recordMetadata?.drupal_url || '';
    const existingNid = recordMetadata?.drupal_nid || '';
    const alreadySynced = !!recordMetadata?.drupal_uuid;

    const handleSubmit = async () => {
        setSubmitting(true);
        try {
            const res = await axios.post('/api/vault/skills/sync-drupal-row', {
                item_id: noteId,
                button_action: 'sync_drupal',
                scope,
                push_media: pushMedia,
            }, {
                // The sync does image resizing + multiple writes to Drupal
                // (remote): it can exceed the 30s of axios's global timeout.
                timeout: 180000,
            });
            const d = res.data || {};
            const trOk = (d.translations || []).filter((x) => x.status === 'ok').length;
            const base = d.created
                ? t('drupal.sync_created', 'Node creat a Drupal.')
                : t('drupal.sync_updated', 'Node actualitzat a Drupal.');
            const withMedia = d.media_pushed
                ? `${base} ${t('drupal.media_updated', 'Imatge actualitzada.')}`
                : base;
            toast.success(
                trOk
                    ? `${withMedia} ${t('drupal.sync_translations', { count: trOk, defaultValue: '{{count}} traduccions.' })}`
                    : withMedia
            );
            if (onSynced) onSynced(d);
            onClose();
        } catch (err) {
            console.error('Error syncing with Drupal:', err);
            const msg = err.response?.data?.detail || err.message || t('errors.unknown', 'Error desconegut');
            toast.error(`${t('drupal.sync_error', 'Error sincronitzant amb Drupal')}: ${msg}`);
        } finally {
            setSubmitting(false);
        }
    };

    // Esc cancels, Enter confirms (positive action). See useModalKeyboard.
    useModalKeyboard({
        isOpen,
        onClose,
        onConfirm: handleSubmit,
        confirmDisabled: submitting,
        containerRef,
    });

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 bg-black/60 flex items-center justify-center z-[110] p-4 font-sans backdrop-blur-sm"
            onMouseDown={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}
        >
            <div
                ref={containerRef}
                onMouseDown={(e) => e.stopPropagation()}
                className="bg-[var(--bg-primary)] rounded-xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col border border-[var(--border-primary)]"
            >
                <div className="px-5 py-3 border-b border-[var(--border-primary)] flex justify-between items-center bg-[var(--bg-secondary)] shrink-0">
                    <h2 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
                        <Globe size={18} className="text-[var(--gnosi-primary)]" />
                        {t('drupal.sync_title', 'Sincronitzar amb Drupal')}
                    </h2>
                    <button onClick={onClose} className="gnosi-close-btn" aria-label={t('common.close', 'Tanca')} disabled={submitting}>
                        <X />
                    </button>
                </div>

                <div className="p-5 space-y-3">
                    <p className="text-xs text-[var(--text-secondary)]/80">
                        {alreadySynced
                            ? t('drupal.sync_intro_update', "S'actualitzarà el node a Drupal segons l'abast triat.")
                            : t('drupal.sync_intro_create', 'Es crearà el node a Drupal amb els camps mapats.')}
                    </p>

                    <div className="space-y-1.5 rounded-lg border border-[var(--border-primary)] p-3">
                        <label className="flex items-start gap-2 cursor-pointer text-xs text-[var(--text-secondary)]">
                            <input type="radio" name="drupal-scope" className="mt-0.5" checked={scope === 'all'} onChange={() => setScope('all')} disabled={submitting} />
                            <span><span className="font-semibold text-[var(--text-primary)]">{t('drupal.scope_all', 'Tot el node')}</span> — {t('drupal.scope_all_hint', "l'original i totes les traduccions / idiomes")}</span>
                        </label>
                        <label className="flex items-start gap-2 cursor-pointer text-xs text-[var(--text-secondary)]">
                            <input type="radio" name="drupal-scope" className="mt-0.5" checked={scope === 'lang_only'} onChange={() => setScope('lang_only')} disabled={submitting} />
                            <span><span className="font-semibold text-[var(--text-primary)]">{t('drupal.scope_lang', 'Només aquest idioma')}</span></span>
                        </label>
                    </div>
                    {alreadySynced && (
                        <label className="flex items-start gap-2 cursor-pointer text-xs text-[var(--text-secondary)] rounded-lg border border-[var(--border-primary)] p-3">
                            <input type="checkbox" className="mt-0.5" checked={pushMedia} onChange={(e) => setPushMedia(e.target.checked)} disabled={submitting} />
                            <span><span className="font-semibold text-[var(--text-primary)]">{t('drupal.push_media', 'Tornar a pujar la imatge')}</span> — {t('drupal.push_media_hint', "actualitza la imatge i el seu alt (per defecte, actualitzar només toca el text)")}</span>
                        </label>
                    )}
                    {alreadySynced && existingUrl && (
                        <a
                            href={existingUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-[var(--gnosi-primary)] inline-flex items-center gap-1 hover:underline break-all"
                        >
                            <ExternalLink size={12} className="shrink-0" />
                            {existingUrl}{existingNid ? ` (nid ${existingNid})` : ''}
                        </a>
                    )}
                    <p className="text-[10px] text-[var(--text-secondary)]/60">
                        {t('drupal.sync_publish_hint', 'El node es publica a temenosismael.org.')}
                    </p>
                </div>

                <div className="px-5 py-3 border-t border-[var(--border-primary)] bg-[var(--bg-secondary)] flex justify-end gap-2">
                    <button
                        onClick={onClose}
                        disabled={submitting}
                        className="px-4 py-2 border border-[var(--border-primary)] rounded-md text-sm font-bold text-[var(--text-secondary)]/80 hover:bg-[var(--bg-primary)] transition-colors disabled:opacity-50"
                    >
                        {t('common.cancel')}
                    </button>
                    <button
                        data-autofocus="true"
                        onClick={handleSubmit}
                        disabled={submitting}
                        className="btn-gnosi btn-gnosi-primary px-5 flex items-center gap-2 disabled:opacity-50"
                    >
                        {submitting && <Loader2 size={14} className="animate-spin" />}
                        {alreadySynced
                            ? t('drupal.sync_submit_update', 'Actualitzar')
                            : t('drupal.sync_submit_create', 'Crear i sincronitzar')}
                    </button>
                </div>
            </div>
        </div>
    );
}
