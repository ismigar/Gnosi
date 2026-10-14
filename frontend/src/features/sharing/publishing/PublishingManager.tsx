import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, Globe, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useModalKeyboard } from '../../../shared/hooks/useModalKeyboard';
import { currentRequestContext, type RequestContext } from '../../../shared/api/request-context';
import { useRequestContext } from '../../../shared/hooks/useRequestContext';
import { apiErrorDetail } from '../../../shared/api/errors';
import { commitPublication, fetchPublicationPages, fetchPublications, previewPublication, revokePublication,
    type PublicationCandidate, type PublicationPreview, type PublicationSummary } from '../../../shared/api/vault-publishing';
import { writeClipboardText } from '../../../shared/platform/clipboard';
import { GnosiToggle } from '../../../shared/ui/settings/SettingsPrimitives';
import { RefreshButton } from '../../../shared/ui/actions/RefreshButton';
import { ConfirmModal } from '../../../shared/ui/dialogs/ConfirmModal';
import { PublishedMarkdown } from './PublishedMarkdown';
import { publicationUrl } from './publicEntry';

const field = 'w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2 text-sm';
const button = 'rounded-lg border border-[var(--border-primary)] px-3 py-2 text-sm hover:bg-[var(--bg-tertiary)] disabled:opacity-50';

interface PublishingProps { readonly onClose: () => void; readonly onBack: () => void }

function sameContext(left: RequestContext, right: RequestContext): boolean {
    return left.userId === right.userId && left.userEmail === right.userEmail
        && left.workspaceId === right.workspaceId && left.vaultId === right.vaultId;
}

export default function PublishingManager({ onClose, onBack }: PublishingProps) {
    const current = useRequestContext();
    const [context] = useState(current);
    const [invalidated, setInvalidated] = useState(false);
    const closed = invalidated || !sameContext(context, current);
    const invalidate = useCallback(() => { setInvalidated(true); }, []);
    useEffect(() => { if (closed) onClose(); }, [closed, onClose]);
    // Unmount private selections immediately when any scope changes, including
    // a storage/focus event from another tab or a late request completion.
    return closed ? null : <PublishingSession context={context} invalidate={invalidate} onClose={onClose} onBack={onBack} />;
}

function PublishingSession({ onClose, onBack, context, invalidate }: PublishingProps & {
    readonly context: RequestContext; readonly invalidate: () => void;
}) {
    const { t, i18n } = useTranslation();
    const ref = useRef<HTMLDivElement>(null);
    const [pages, setPages] = useState<PublicationCandidate[]>([]);
    const [sites, setSites] = useState<PublicationSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [reload, setReload] = useState(0);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [title, setTitle] = useState('');
    const [days, setDays] = useState('');
    const [selected, setSelected] = useState<string[]>([]);
    const [filter, setFilter] = useState('');
    const [editing, setEditing] = useState<PublicationSummary | null>(null);
    const [preview, setPreview] = useState<PublicationPreview | null>(null);
    const [previewPageId, setPreviewPageId] = useState('');
    const [revokeTarget, setRevokeTarget] = useState<PublicationSummary | null>(null);
    const alive = useRef(true);
    const fallback = t('publishing.failed', 'Could not complete this publication action.');
    const changedMessage = t('publishing.context_changed', 'The active account or vault changed. Close and reopen publishing.');
    const checkScope = useCallback(() => {
        if (!sameContext(currentRequestContext(), context)) {
            invalidate();
            throw new Error(changedMessage);
        }
    }, [context, invalidate, changedMessage]);

    useEffect(() => {
        alive.current = true;
        const controller = new AbortController();
        void Promise.all([fetchPublicationPages(context, controller.signal), fetchPublications(context, controller.signal)])
            .then(([notes, publications]) => {
                if (!controller.signal.aborted) { checkScope(); setPages(notes); setSites(publications); setLoading(false); }
            })
            .catch((cause: unknown) => {
                if (controller.signal.aborted) return;
                if (!sameContext(currentRequestContext(), context)) { invalidate(); return; }
                setError(apiErrorDetail(cause, fallback)); setLoading(false);
            });
        return () => { alive.current = false; controller.abort(); };
    }, [context, checkScope, fallback, invalidate, reload]);
    useModalKeyboard({ isOpen: true, containerRef: ref, trapFocus: !revokeTarget, closeOnEscape: !busy && !revokeTarget, onClose });

    const action = async (work: () => Promise<void>) => {
        if (busy) return;
        setBusy(true); setError(''); setNotice('');
        try { checkScope(); await work(); }
        catch (cause) {
            if (alive.current) {
                if (!sameContext(currentRequestContext(), context)) invalidate();
                else setError(apiErrorDetail(cause, cause instanceof Error ? cause.message : fallback));
            }
        }
        finally { if (alive.current) setBusy(false); }
    };
    const reset = () => { setEditing(null); setTitle(''); setDays(''); setSelected([]); setPreview(null); setNotice(''); };
    const review = () => action(async () => {
        const result = await previewPublication({ title, page_ids: selected,
            expires_in_days: days === '' ? null : Number(days),
            site_id: editing?.id ?? null, expected_revision: editing?.revision ?? null }, context);
        if (alive.current) { checkScope(); setPreview(result); setPreviewPageId(result.bundle.pages[0]?.id ?? ''); }
    });
    const publish = () => action(async () => {
        if (!preview) return;
        const site = await commitPublication(preview.preview_id, context);
        if (!alive.current) return;
        checkScope();
        setSites(current => [site, ...current.filter(item => item.id !== site.id)]);
        reset(); setNotice(t('publishing.published', 'Publication saved. Its public link is listed below.'));
    });
    const revoke = () => action(async () => {
        if (!revokeTarget) return;
        const site = await revokePublication(revokeTarget, context);
        if (!alive.current) return;
        checkScope();
        setSites(current => current.map(item => item.id === site.id ? site : item)); setRevokeTarget(null);
        if (editing?.id === site.id) reset();
    });
    const edit = (site: PublicationSummary) => {
        setEditing(site); setTitle(site.title); setSelected(site.page_ids); setPreview(null); setNotice('');
        setDays(site.expires_at === null ? '' : String(Math.max(1, Math.ceil((site.expires_at * 1000 - Date.now()) / 86400000))));
    };
    const valid = title.trim() && selected.length > 0 && selected.length <= 100
        && (days === '' || (Number.isInteger(Number(days)) && Number(days) >= 1 && Number(days) <= 3650));
    const visiblePages = pages.filter(page => page.title.toLocaleLowerCase().includes(filter.toLocaleLowerCase()));
    const shown = preview?.bundle.pages.find(page => page.id === previewPageId) ?? preview?.bundle.pages[0];

    return <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-3 md:p-6">
        <div className="absolute inset-0 bg-black/40" />
        <div role="dialog" aria-modal="true" aria-label={t('publishing.manage', 'Publish selected notes')} ref={ref} className="relative flex max-h-[90vh] w-full max-w-5xl flex-col rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-2xl">
            <header className="flex items-center justify-between gap-3 border-b border-[var(--border-primary)] px-5 py-4">
                <h2 className="flex items-center gap-2 text-base font-bold"><Globe size={18} />{t('publishing.manage', 'Publish selected notes')}</h2>
                <div className="flex items-center gap-2"><RefreshButton loading={loading} disabled={busy} onClick={() => { setPreview(null); setLoading(true); setReload(value => value + 1); }} />
                    <button type="button" className="gnosi-close-btn" aria-label={t('common.close', 'Close')} disabled={busy} onClick={onClose}><X /></button></div>
            </header>
            <div className="custom-scrollbar space-y-5 overflow-auto p-5">
                <p className="text-sm text-[var(--text-secondary)]">{t('publishing.explanation', 'Choose notes, review the saved content, then publish a site on this Gnosi server. Anyone with its link can read and save the published content. Source edits appear only after you publish an update.')}</p>
                <p className="text-sm text-[var(--text-tertiary)]">{t('publishing.omission_notice', 'Attachments, raw HTML, private embeds, and saved queries are omitted. Links between selected notes stay within this publication. Up to 100 notes and 2 MB per site.')}</p>
                {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
                {notice && <p role="status" className="text-sm text-[var(--gnosi-blue)]">{notice}</p>}
                {loading ? <p role="status">{t('common.loading', 'Loading...')}</p> : <>
                    <div className="flex flex-wrap items-end gap-3">
                        <label className="min-w-48 flex-1 space-y-1 text-sm"><span>{t('publishing.title', 'Site title')}</span><input className={field} value={title} maxLength={160} disabled={busy} onChange={event => { setTitle(event.target.value); setPreview(null); }} /></label>
                        <label className="w-40 space-y-1 text-sm"><span>{t('share.expires', 'Expires (days)')}</span><input className={field} type="number" min="1" max="3650" placeholder="∞" value={days} disabled={busy} onChange={event => { setDays(event.target.value); setPreview(null); }} /></label>
                        {editing && <button className={button} type="button" disabled={busy} onClick={reset}>{t('publishing.new_site', 'New publication')}</button>}
                    </div>
                    <section aria-label={t('publishing.select', 'Select notes')}>
                        <div className="mb-2 flex items-center gap-3"><input className={field} type="search" aria-label={t('publishing.filter', 'Find notes to select')} placeholder={t('publishing.filter', 'Find notes to select')} value={filter} onChange={event => { setFilter(event.target.value); }} /><span className="shrink-0 text-sm">{selected.length} / 100</span></div>
                        <div className="max-h-52 space-y-2 overflow-auto rounded-lg border border-[var(--border-primary)] p-3">{visiblePages.map(page => <div className="flex items-center justify-between gap-3 text-sm" key={page.id}>
                            <span className="break-words">{page.title}</span><GnosiToggle label={page.title} active={selected.includes(page.id)} disabled={busy || (!selected.includes(page.id) && selected.length >= 100)} onChange={() => { setSelected(current => current.includes(page.id) ? current.filter(id => id !== page.id) : [...current, page.id]); setPreview(null); }} />
                        </div>)}</div>
                        {selected.some(id => !pages.some(page => page.id === id)) && <p role="alert" className="mt-2 text-sm">{t('publishing.missing_selection', 'Some previously published notes are no longer available. Clear the selection and choose the notes for this update.')}</p>}
                        <button className={`${button} mt-2`} type="button" disabled={busy || !selected.length} onClick={() => { setSelected([]); setPreview(null); }}>{t('publishing.clear_selection', 'Clear selection')}</button>
                    </section>
                    <div className="flex flex-wrap gap-2"><button className={button} type="button" disabled={busy || !valid} onClick={() => { void review(); }}>{t('publishing.preview', 'Preview selected notes')}</button>
                        <button className="rounded-lg bg-[var(--gnosi-blue)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50" type="button" disabled={busy || !preview} onClick={() => { void publish(); }}>{editing ? t('publishing.update', 'Publish update') : t('publishing.publish', 'Publish this preview')}</button>
                        <button className={button} type="button" disabled={busy} onClick={onBack}>{t('publishing.back', 'Back to share links')}</button></div>
                    {preview && shown && <section className="rounded-xl border border-[var(--border-primary)] p-4" aria-label={t('publishing.preview_content', 'Publication preview')}>
                        <p className="mb-3 text-sm text-[var(--text-secondary)]">{t('publishing.preview_exact', 'Publishing will use this exact snapshot. This preview expires in 15 minutes.')}</p>
                        <label className="mb-4 block space-y-1 text-sm"><span>{t('publishing.pages', 'Published pages')}</span><select className={field} value={shown.id} onChange={event => { setPreviewPageId(event.target.value); }}>{preview.bundle.pages.map(page => <option key={page.id} value={page.id}>{page.title}</option>)}</select></label>
                        <div className="max-h-96 overflow-auto"><h3 className="mb-4 text-lg font-semibold">{shown.title}</h3><PublishedMarkdown markdown={shown.markdown} bundle={preview.bundle} onNavigate={id => { setPreviewPageId(id); }} /></div>
                    </section>}
                    <section className="space-y-3 border-t border-[var(--border-primary)] pt-4"><h3 className="font-semibold">{t('publishing.existing', 'Your publications in this vault')}</h3>
                        {!sites.length && <p className="text-sm text-[var(--text-tertiary)]">{t('publishing.empty', 'No publications yet')}</p>}
                        {sites.map(site => <div className="space-y-2 rounded-lg border border-[var(--border-primary)] p-3" key={site.id}><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{site.title}</span><span className="text-xs text-[var(--text-tertiary)]">{site.revoked ? t('publishing.revoked', 'Revoked') : site.expires_at ? t('publishing.expires_date', 'Expires: {{date}}', { date: new Date(site.expires_at * 1000).toLocaleString(i18n.language) }) : t('publishing.no_expiry', 'No expiry')}</span></div>
                            {!site.revoked && <><a className="block break-all text-xs text-[var(--gnosi-blue)]" href={publicationUrl(site.token)} target="_blank" rel="noopener noreferrer">{publicationUrl(site.token)}</a><div className="flex flex-wrap gap-2">
                                <button className={button} type="button" disabled={busy} onClick={() => { void action(async () => { await writeClipboardText(publicationUrl(site.token)); setNotice(t('publishing.copied', 'Public link copied')); }); }}><Copy size={14} className="mr-1 inline" />{t('share.copy', 'Copy')}</button>
                                <button className={button} type="button" disabled={busy} onClick={() => { edit(site); }}>{t('publishing.edit', 'Update selection')}</button>
                                <button className={button} type="button" disabled={busy} onClick={() => { setRevokeTarget(site); }}>{t('share.revoke', 'Revoke')}</button>
                            </div></>}
                        </div>)}
                    </section>
                </>}
            </div>
        </div>
        <ConfirmModal isOpen={!!revokeTarget} title={t('publishing.revoke_title', 'Revoke publication')} message={t('publishing.revoke_message', 'This link will stop serving the publication. Copies already saved by readers cannot be removed.')} confirmText={t('share.revoke', 'Revoke')} onClose={() => { if (!busy) setRevokeTarget(null); }} onConfirm={revoke} />
    </div>;
}
