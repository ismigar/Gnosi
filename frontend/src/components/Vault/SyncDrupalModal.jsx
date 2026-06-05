import React, { useState } from 'react';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { X, Globe, Loader2, ExternalLink } from 'lucide-react';
import { toast } from '../../lib/toast';

// Modal de confirmació per sincronitzar una fila amb Drupal. A diferència de la
// traducció, no hi ha res a triar: es crea/actualitza el node i totes les seves
// traduccions existents. Es confirma perquè l'acció publica a producció.
export function SyncDrupalModal({ isOpen, onClose, noteId, recordMetadata = {}, onSynced }) {
    const { t } = useTranslation();
    const [submitting, setSubmitting] = useState(false);
    if (!isOpen) return null;

    const existingUrl = recordMetadata?.drupal_url || '';
    const existingNid = recordMetadata?.drupal_nid || '';
    const alreadySynced = !!recordMetadata?.drupal_uuid;

    const handleSubmit = async () => {
        setSubmitting(true);
        try {
            const res = await axios.post('/api/vault/skills/sync-drupal-row', {
                item_id: noteId,
                button_action: 'sync_drupal',
            });
            const d = res.data || {};
            const trOk = (d.translations || []).filter((x) => x.status === 'ok').length;
            const base = d.created
                ? t('drupal.sync_created', 'Node creat a Drupal.')
                : t('drupal.sync_updated', 'Node actualitzat a Drupal.');
            toast.success(
                trOk
                    ? `${base} ${t('drupal.sync_translations', { count: trOk, defaultValue: '{{count}} traduccions.' })}`
                    : base
            );
            if (onSynced) onSynced(d);
            onClose();
        } catch (err) {
            console.error('Error sincronitzant amb Drupal:', err);
            const msg = err.response?.data?.detail || err.message || 'Error desconegut';
            toast.error(`${t('drupal.sync_error', 'Error sincronitzant amb Drupal')}: ${msg}`);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[110] p-4 font-sans backdrop-blur-sm">
            <div className="bg-[var(--bg-primary)] rounded-xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col border border-[var(--border-primary)]">
                <div className="px-5 py-3 border-b border-[var(--border-primary)] flex justify-between items-center bg-[var(--bg-secondary)] shrink-0">
                    <h2 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
                        <Globe size={18} className="text-[var(--gnosi-primary)]" />
                        {t('drupal.sync_title', 'Sincronitzar amb Drupal')}
                    </h2>
                    <button onClick={onClose} className="gnosi-close-btn" aria-label="Tancar" disabled={submitting}>
                        <X />
                    </button>
                </div>

                <div className="p-5 space-y-3">
                    <p className="text-xs text-[var(--text-secondary)]/80">
                        {alreadySynced
                            ? t('drupal.sync_intro_update', "S'actualitzarà el node existent a Drupal i les seves traduccions.")
                            : t('drupal.sync_intro_create', 'Es crearà un node nou a Drupal amb els camps mapats i les traduccions existents.')}
                    </p>
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
