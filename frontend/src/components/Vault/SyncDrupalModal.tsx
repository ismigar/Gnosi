import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Globe, Loader2, ExternalLink } from 'lucide-react';
import { logError } from '../../lib/notifyError';
import { toast } from '../../lib/toast';
import {
    syncDrupalRow,
    type SyncDrupalRowResult,
    type SyncDrupalScope,
} from '../../shared/api/translation';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';


export interface SyncDrupalModalProps {
    readonly isOpen: boolean;
    readonly noteId: string;
    readonly onClose: () => unknown;
    readonly onSynced?: (result: SyncDrupalRowResult) => unknown;
    readonly recordMetadata?: Readonly<Record<string, unknown>>;
}


function metadataText(
    metadata: Readonly<Record<string, unknown>>,
    key: string,
): string {
    const value = metadata[key];
    return typeof value === 'string'
        || typeof value === 'number'
        || typeof value === 'boolean'
        ? String(value)
        : '';
}

// Confirmation modal to sync a row with Drupal. Unlike the
// translation modal, there is nothing to choose: the node and all its
// existing translations are created/updated. It's confirmed because the action publishes to production.
export function SyncDrupalModal({
    isOpen,
    onClose,
    noteId,
    recordMetadata = {},
    onSynced,
}: SyncDrupalModalProps) {
    const { t } = useTranslation();
    const [submitting, setSubmitting] = useState(false);
    const [scope, setScope] = useState<SyncDrupalScope>('all');
    const [pushMedia, setPushMedia] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    const existingUrl = metadataText(recordMetadata, 'drupal_url');
    const existingNid = metadataText(recordMetadata, 'drupal_nid');
    const alreadySynced = Boolean(recordMetadata.drupal_uuid);

    const handleSubmit = async (): Promise<void> => {
        setSubmitting(true);
        try {
            const d = await syncDrupalRow({
                item_id: noteId,
                button_action: 'sync_drupal',
                scope,
                push_media: pushMedia,
            });
            const trOk = d.translations.filter((translation) => (
                translation.status === 'ok'
            )).length;
            const base = d.created
                ? t('drupal.sync_created', "Node created in Drupal.")
                : t('drupal.sync_updated', "Node updated in Drupal.");
            const withMedia = d.media_pushed
                ? `${base} ${t('drupal.media_updated', "Image updated.")}`
                : base;
            toast.success(
                trOk
                    ? `${withMedia} ${t('drupal.sync_translations', { count: trOk, defaultValue: "{{count}} translations." })}`
                    : withMedia
            );
            onSynced?.(d);
            onClose();
        } catch (error) {
            logError('sync-drupal-row', error);
            const msg = error instanceof Error && error.message
                ? error.message
                : t('errors.unknown', "Unknown error");
            toast.error(`${t('drupal.sync_error', "Error syncing with Drupal")}: ${msg}`);
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
        trapFocus: true,
    });

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 bg-black/60 flex items-center justify-center z-[110] p-4 font-sans backdrop-blur-sm"
        >
            <div
                ref={containerRef}
                className="bg-[var(--bg-primary)] rounded-xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col border border-[var(--border-primary)]"
                role="dialog"
                aria-modal="true"
                aria-label={t('drupal.sync_title', 'Sync with Drupal')}
            >
                <div className="px-5 py-3 border-b border-[var(--border-primary)] flex justify-between items-center bg-[var(--bg-secondary)] shrink-0">
                    <h2 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
                        <Globe size={18} className="text-[var(--gnosi-primary)]" />
                        {t('drupal.sync_title', "Sync with Drupal")}
                    </h2>
                    <button type="button" onClick={onClose} className="gnosi-close-btn" aria-label={t('common.close', "Close")} disabled={submitting}>
                        <X />
                    </button>
                </div>

                <div className="p-5 space-y-3">
                    <p className="text-xs text-[var(--text-secondary)]/80">
                        {alreadySynced
                            ? t('drupal.sync_intro_update', "The node will be updated in Drupal according to the chosen scope.")
                            : t('drupal.sync_intro_create', "The node will be created in Drupal with the mapped fields.")}
                    </p>

                    <div className="space-y-1.5 rounded-lg border border-[var(--border-primary)] p-3">
                        <label className="flex items-start gap-2 cursor-pointer text-xs text-[var(--text-secondary)]">
                            <input type="radio" name="drupal-scope" className="mt-0.5" checked={scope === 'all'} onChange={() => {
                                setScope('all');
                            }} disabled={submitting} />
                            <span><span className="font-semibold text-[var(--text-primary)]">{t('drupal.scope_all', "The whole node")}</span> — {t('drupal.scope_all_hint', "the original and all translations / languages")}</span>
                        </label>
                        <label className="flex items-start gap-2 cursor-pointer text-xs text-[var(--text-secondary)]">
                            <input type="radio" name="drupal-scope" className="mt-0.5" checked={scope === 'lang_only'} onChange={() => {
                                setScope('lang_only');
                            }} disabled={submitting} />
                            <span><span className="font-semibold text-[var(--text-primary)]">{t('drupal.scope_lang', "This language only")}</span></span>
                        </label>
                    </div>
                    {alreadySynced && (
                        <label className="flex items-start gap-2 cursor-pointer text-xs text-[var(--text-secondary)] rounded-lg border border-[var(--border-primary)] p-3">
                            <input type="checkbox" className="mt-0.5" checked={pushMedia} onChange={(event) => {
                                setPushMedia(event.target.checked);
                            }} disabled={submitting} />
                            <span><span className="font-semibold text-[var(--text-primary)]">{t('drupal.push_media', "Re-upload the image")}</span> — {t('drupal.push_media_hint', "updates the image and its alt (by default, updating only touches the text)")}</span>
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
                        {t('drupal.sync_publish_hint', "The node is published to temenosismael.org.")}
                    </p>
                </div>

                <div className="px-5 py-3 border-t border-[var(--border-primary)] bg-[var(--bg-secondary)] flex justify-end gap-2">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={submitting}
                        className="px-4 py-2 border border-[var(--border-primary)] rounded-md text-sm font-bold text-[var(--text-secondary)]/80 hover:bg-[var(--bg-primary)] transition-colors disabled:opacity-50"
                    >
                        {t('common.cancel')}
                    </button>
                    <button
                        data-autofocus="true"
                        type="button"
                        onClick={() => {
                            void handleSubmit();
                        }}
                        disabled={submitting}
                        className="btn-gnosi btn-gnosi-primary px-5 flex items-center gap-2 disabled:opacity-50"
                    >
                        {submitting && <Loader2 size={14} className="animate-spin" />}
                        {alreadySynced
                            ? t('drupal.sync_submit_update', "Update")
                            : t('drupal.sync_submit_create', "Create and sync")}
                    </button>
                </div>
            </div>
        </div>
    );
}
