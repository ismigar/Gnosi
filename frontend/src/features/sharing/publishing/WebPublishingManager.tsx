import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { currentRequestContext, type RequestContext } from '../../../shared/api/request-context';
import { useRequestContext } from '../../../shared/hooks/useRequestContext';
import { useModalKeyboard } from '../../../shared/hooks/useModalKeyboard';
import { apiErrorDetail } from '../../../shared/api/errors';
import * as api from '../../../shared/api/web-publishing';
import { RefreshButton } from '../../../shared/ui/actions/RefreshButton';
import { GnosiToggle } from '../../../shared/ui/settings/SettingsPrimitives';

const button = 'rounded-lg border border-[var(--border-primary)] px-3 py-2 text-sm hover:bg-[var(--bg-tertiary)] disabled:opacity-50';
const field = 'w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2 text-sm';
const same = (a: RequestContext, b: RequestContext) => a.userId === b.userId && a.userEmail === b.userEmail && a.workspaceId === b.workspaceId && a.vaultId === b.vaultId;
interface Props { readonly onClose: () => void; readonly onBack: () => void }

export default function WebPublishingManager(props: Props) {
    const current = useRequestContext();
    const [context] = useState(current);
    const [invalid, setInvalid] = useState(false);
    const invalidate = useCallback(() => { setInvalid(true); }, []);
    const closed = invalid || !same(current, context);
    useEffect(() => { if (closed) props.onClose(); }, [closed, props]);
    return closed ? null : <Session {...props} context={context} invalidate={invalidate} />;
}

function Session({ context, invalidate, onClose, onBack }: Props & { context: RequestContext; invalidate: () => void }) {
    const { t } = useTranslation();
    const ref = useRef<HTMLDivElement>(null);
    const alive = useRef(true);
    const controller = useRef(new AbortController());
    const [status, setStatus] = useState<api.WebStatus | null>(null);
    const [newsletter, setNewsletter] = useState<api.NewsletterStatus | null>(null);
    const [selected, setSelected] = useState<string[]>([]);
    const [withdrawn, setWithdrawn] = useState<string[]>([]);
    const [preview, setPreview] = useState<api.WebPreview | null>(null);
    const [mailPreview, setMailPreview] = useState<api.NewsletterPreview | null>(null);
    const [subject, setSubject] = useState('');
    const [body, setBody] = useState('');
    const [language, setLanguage] = useState<'ca' | 'es' | 'en-gb'>('ca');
    const [busy, setBusy] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [reload, setReload] = useState(0);
    const check = useCallback((signal = controller.current.signal) => {
        if (!alive.current || signal.aborted) return false;
        if (!same(context, currentRequestContext())) { invalidate(); return false; }
        return true;
    }, [context, invalidate]);
    const fallback = t('webPublishing.failed');
    useEffect(() => {
        alive.current = true;
        controller.current = new AbortController();
        const signal = controller.current.signal;
        void Promise.resolve().then(async () => {
            if (!check(signal)) return;
            setLoading(true); setBusy(false); setError(''); setPreview(null); setMailPreview(null);
            const result = await api.webStatus(context, signal);
            if (!check(signal)) return;
            setStatus(result);
            if (result.configured) {
                const mail = await api.newsletterStatus(context, signal);
                if (check(signal)) setNewsletter(mail);
            }
        }).catch((cause: unknown) => { if (check(signal)) setError(apiErrorDetail(cause, fallback)); })
            .finally(() => { if (check(signal)) setLoading(false); });
        return () => { alive.current = false; controller.current.abort(); };
    }, [check, context, fallback, reload]);
    useModalKeyboard({ isOpen: true, containerRef: ref, onClose, closeOnEscape: !busy });
    const action = async (work: (signal: AbortSignal) => Promise<void>) => {
        if (busy || !check()) return;
        setBusy(true); setError(''); setNotice('');
        const signal = controller.current.signal;
        try { await work(signal); }
        catch (cause) { if (check(signal)) { setError(apiErrorDetail(cause, fallback)); setPreview(null); setMailPreview(null); } }
        finally { if (check(signal)) setBusy(false); }
    };
    const toggle = (id: string, withdraw: boolean) => {
        const update = (values: string[]) => values.includes(id) ? values.filter(value => value !== id) : [...values, id];
        if (withdraw) { setWithdrawn(update); setSelected(values => values.filter(value => value !== id)); }
        else { setSelected(update); setWithdrawn(values => values.filter(value => value !== id)); }
        setPreview(null);
    };
    return <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-3 md:p-6">
        <div className="absolute inset-0 bg-black/40" />
        <div ref={ref} role="dialog" aria-modal="true" aria-label={t('webPublishing.title')} className="relative flex max-h-[90vh] w-full max-w-5xl flex-col rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-2xl">
            <header className="flex items-center justify-between border-b border-[var(--border-primary)] px-5 py-4"><h2 className="font-bold">{t('webPublishing.title')}</h2><div className="flex gap-2"><RefreshButton loading={loading} disabled={busy} onClick={() => { setReload(value => value + 1); }} /><button className="gnosi-close-btn" disabled={busy} aria-label={t('common.close')} onClick={onClose}><X /></button></div></header>
            <div className="custom-scrollbar space-y-4 overflow-auto p-5">
                <p className="text-sm text-[var(--text-secondary)]">{t('webPublishing.staging')}</p>
                {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
                {loading && <p role="status">{t('common.loading')}</p>}
                {status && !status.configured && <p>{t('webPublishing.unconfigured')}</p>}
                {status?.configured && <>
                    {status.staging_url && <a className="text-[var(--gnosi-blue)]" target="_blank" rel="noopener noreferrer" href={status.staging_url}>{t('webPublishing.open')}</a>}
                    <p className="text-sm">{t('webPublishing.selection')}</p>
                    <section className="max-h-64 space-y-3 overflow-auto rounded-lg border border-[var(--border-primary)] p-3" aria-label={t('webPublishing.pages')}>
                        {(status.pages ?? []).map(page => <div key={page.id} className="flex flex-wrap items-center justify-between gap-3 text-sm"><span>{page.title} · {page.language} {page.reason && <span className="text-[var(--text-tertiary)]">({page.reason})</span>}</span><div className="flex flex-wrap items-center gap-3">
                            <span>{t('webPublishing.include', { title: page.title })}</span><GnosiToggle label={t('webPublishing.include', { title: page.title })} active={selected.includes(page.id)} disabled={busy || !page.eligible} onChange={() => { toggle(page.id, false); }} />
                            {page.published && <><span>{t('webPublishing.withdraw', { title: page.title })}</span><GnosiToggle label={t('webPublishing.withdraw', { title: page.title })} active={withdrawn.includes(page.id)} disabled={busy} onChange={() => { toggle(page.id, true); }} /></>}
                        </div></div>)}
                    </section>
                    <div className="flex flex-wrap gap-2"><button className={button} disabled={busy || (!selected.length && !withdrawn.length)} onClick={() => { void action(async signal => { const result = await api.webPreview(selected, withdrawn, context, signal); if (check(signal)) setPreview(result); }); }}>{t('webPublishing.review')}</button>
                        <button className={button} disabled={busy || !preview} onClick={() => { void action(async signal => { if (!preview) return; await api.webPublish(preview.preview_id, context, signal); if (check(signal)) { setPreview(null); setSelected([]); setWithdrawn([]); setNotice(t('webPublishing.published')); setReload(value => value + 1); } }); }}>{t('webPublishing.publish')}</button></div>
                    {preview && <section aria-label={t('webPublishing.review')} className="space-y-2 rounded-lg border border-[var(--border-primary)] p-3"><p>{t('webPublishing.expires', { date: preview.expires_at })}</p>{preview.changes.map((change, index) => <p key={index}>{t(`webPublishing.change_${change.kind}`)} · {change.title} · {change.language} · {change.url}</p>)}{(preview.warnings ?? []).map((warning, index) => <p key={index} role="status">{warning}</p>)}</section>}
                    <section className="space-y-2"><h3 className="font-semibold">{t('webPublishing.releases')}</h3>{(status.releases ?? []).map(release => <div className="flex flex-wrap justify-between gap-2" key={release.id}><span>{release.created_at} · {release.id}</span><button className={button} disabled={busy || release.current} onClick={() => { void action(async signal => { await api.webRollback(release.id, context, signal); if (check(signal)) { setPreview(null); setReload(value => value + 1); } }); }}>{t('webPublishing.rollback')}</button></div>)}</section>
                    <section className="space-y-3 border-t border-[var(--border-primary)] pt-4"><h3 className="font-semibold">{t('webPublishing.newsletter')}</h3><p>{t('webPublishing.testOnly')}</p>
                        {newsletter && <><p>{t('webPublishing.counts', newsletter.subscribers)}</p>{newsletter.campaigns.map(campaign => <p key={campaign.id}>{campaign.subject} · {campaign.language} · {campaign.status} · {campaign.recipient_count}</p>)}</>}
                        <label className="block text-sm">{t('webPublishing.subject')}<input className={field} maxLength={200} value={subject} disabled={busy} onChange={event => { setSubject(event.target.value); setMailPreview(null); }} /></label>
                        <label className="block text-sm">{t('webPublishing.body')}<textarea className={field} maxLength={100000} rows={5} value={body} disabled={busy} onChange={event => { setBody(event.target.value); setMailPreview(null); }} /></label>
                        <label className="block text-sm">{t('webPublishing.language')}<select className={field} value={language} disabled={busy} onChange={event => { setLanguage(event.target.value as typeof language); setMailPreview(null); }}><option value="ca">Català</option><option value="es">Español</option><option value="en-gb">English</option></select></label>
                        <div className="flex gap-2"><button className={button} disabled={busy || !subject.trim() || !body.trim()} onClick={() => { void action(async signal => { const result = await api.newsletterPreview({ subject, body_markdown: body, language }, context, signal); if (check(signal)) setMailPreview(result); }); }}>{t('webPublishing.reviewMail')}</button><button className={button} disabled={busy || !mailPreview} onClick={() => { void action(async signal => { if (!mailPreview) return; const result = await api.newsletterSend(mailPreview.preview_id, context, signal); if (check(signal)) { setMailPreview(null); setNotice(t('webPublishing.queued', { count: result.queued })); setReload(value => value + 1); } }); }}>{t('webPublishing.queue')}</button></div>
                        {mailPreview && <section aria-label={t('webPublishing.reviewMail')}><p>{mailPreview.subject} · {mailPreview.recipient_count}</p><iframe title={t('webPublishing.reviewMail')} sandbox="" referrerPolicy="no-referrer" className="h-60 w-full rounded-lg border border-[var(--border-primary)]" srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">${mailPreview.body_html}`} /></section>}
                    </section>
                </>}
                <button className={button} disabled={busy} onClick={onBack}>{t('publishing.back')}</button>
            </div>
        </div>
    </div>;
}
