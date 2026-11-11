import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { useModalKeyboard } from '../../shared/hooks/useModalKeyboard';
import { useRequestContext } from '../../shared/hooks/useRequestContext';
import { currentRequestContext, type RequestContext } from '../../shared/api/request-context';
import { apiErrorDetail } from '../../shared/api/errors';
import * as api from '../../shared/api/sites';
import { ModalPortal } from '../../shared/ui/ModalPortal';
import './Websites.css';

const scopeKey = (context: RequestContext) => JSON.stringify([context.userId, context.userEmail, context.workspaceId, context.vaultId]);

export function RecordWebsitePublicationDialog(props: { pageId: string; title?: string; action?: api.RecordWebsiteAction; onClose: () => void }) {
  const context = useRequestContext();
  return <Session {...props} key={`${scopeKey(context)}:${props.pageId}`} context={context} />;
}

function Session({ pageId, title, action: initialAction = 'publish', onClose, context }: { pageId: string; title?: string; action?: api.RecordWebsiteAction; onClose: () => void; context: RequestContext }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  const [destinations, setDestinations] = useState<api.RecordWebsiteDestination[]>([]);
  const [selected, setSelected] = useState('');
  const [action, setAction] = useState(initialAction);
  const [preview, setPreview] = useState<api.SitePreview | null>(null);
  const [job, setJob] = useState<api.SiteJob | null>(null);
  const [busy, setBusy] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const active = () => alive.current && scopeKey(context) === scopeKey(currentRequestContext());
  const destination = destinations.find(value => `${value.site_id}:${value.target_id}` === selected);
  useModalKeyboard({ containerRef: ref, isOpen: true, onClose, trapFocus: true, closeOnEscape: !confirming });
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    void api.recordWebsiteDestinations({ page_id: pageId }, context, controller.signal).then(values => {
      if (!controller.signal.aborted) { setDestinations(values); const first = values[0]; setSelected(values.length === 1 && first ? `${first.site_id}:${first.target_id}` : ''); }
    }).catch((failure: unknown) => { if (!controller.signal.aborted) setError(apiErrorDetail(failure, t('recordWebsite.failed'))); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => { alive.current = false; controller.abort(); };
  }, [context, pageId, t]);

  useEffect(() => {
    if (!job || !['queued', 'running'].includes(job.status)) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void api.siteJobs(job.site_id, context, controller.signal).then(jobs => {
        if (!controller.signal.aborted) setJob(jobs.find(value => value.id === job.id) ?? job);
      }).catch((failure: unknown) => { if (!controller.signal.aborted) setError(apiErrorDetail(failure, t('recordWebsite.failed'))); });
    }, 2000);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [job, context, t]);

  useEffect(() => {
    if (job?.status !== 'completed') return;
    const controller = new AbortController();
    void api.recordWebsiteDestinations({ page_id: pageId }, context, controller.signal).then(values => {
      if (!controller.signal.aborted) setDestinations(values);
    }).catch((failure: unknown) => { if (!controller.signal.aborted) setError(apiErrorDetail(failure, t('recordWebsite.failed'))); });
    return () => { controller.abort(); };
  }, [job?.status, pageId, context, t]);

  const review = async () => {
    if (!destination || busy || !active()) return;
    setBusy(true); setPreview(null); setError('');
    try {
      const result = await api.reviewRecordWebsite(destination.site_id, pageId, destination.target_id, action, context);
      if (active()) setPreview(result);
    } catch (failure) { if (active()) setError(apiErrorDetail(failure, t('recordWebsite.failed'))); }
    finally { if (active()) setBusy(false); }
  };
  const confirm = async () => {
    if (!destination || !preview || busy || !active()) return;
    setBusy(true); setConfirming(true); setError('');
    try {
      const result = await api.publishSite(destination.site_id, preview.id, null, context);
      if (active()) { setJob(result); setPreview(null); }
    } catch (failure) {
      if (active()) { setPreview(null); setError(apiErrorDetail(failure, t('recordWebsite.failed'))); }
    } finally { if (active()) { setBusy(false); setConfirming(false); } }
  };
  const published = Boolean(destination?.published_page_ids?.includes(pageId));
  return <ModalPortal><div className="fixed inset-0 flex items-center justify-center bg-black/40 p-4">
    <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="record-website-title" className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-2xl">
      <div className="flex items-center justify-between border-b border-[var(--border-primary)] p-4"><h3 id="record-website-title" className="font-bold">{t('recordWebsite.title')}</h3><button type="button" className="gnosi-close-btn" disabled={confirming} onClick={onClose} aria-label={t('common.close')}><X /></button></div>
      <div className="space-y-4 overflow-auto p-4 websites-panel">
        {title && <p className="font-semibold">{title}</p>}
        {error && <p role="alert" className="websites-error">{error}</p>}
        {busy && <p role="status">{t('common.loading')}</p>}
        {!busy && destinations.length === 0 && <p>{t('recordWebsite.noDestinations')}</p>}
        {destinations.length > 0 && <><label className="block">{t('recordWebsite.destination')}<select className="websites-input w-full" disabled={busy || Boolean(job)} value={selected} onChange={event => { setSelected(event.target.value); setPreview(null); }}><option value="">{t('recordWebsite.choose')}</option>{destinations.map(value => <option key={`${value.site_id}:${value.target_id}`} value={`${value.site_id}:${value.target_id}`}>{value.site_name} · {value.target_name} · {t(`websites.environments.${value.environment}`)}</option>)}</select></label>
          {destination && <><p className="break-all">{destination.url}</p><p>{t(published ? 'recordWebsite.published' : 'recordWebsite.unpublished')}</p></>}
          <label className="block">{t('recordWebsite.change')}<select className="websites-input w-full" disabled={busy || Boolean(job)} value={action} onChange={event => { setAction(event.target.value as api.RecordWebsiteAction); setPreview(null); }}><option value="publish">{t('recordWebsite.publish')}</option><option value="withdraw">{t('recordWebsite.withdraw')}</option></select></label>
          {!job && <button type="button" className="btn btn-gnosi-primary" disabled={busy || !destination || (action === 'withdraw' && !published)} onClick={() => { void review(); }}>{t('websites.reviewChanges')}</button>}
        </>}
        {preview && <><p className="websites-notice">{t('recordWebsite.wholeSite')}</p><p>{t('websites.expiresAt', { date: preview.expires_at })}</p><ul className="space-y-2">{preview.changes.map((change, index) => <li key={index}><strong>{t(`websites.changeKinds.${change.kind}`)}</strong> · {change.title}<p className="break-all websites-muted">{change.path}</p></li>)}</ul><button type="button" className="btn btn-gnosi-primary" disabled={busy} onClick={() => { void confirm(); }}>{t('recordWebsite.confirm')}</button></>}
        {job && <div role="status"><p>{t(`websites.states.${job.status}`)}</p>{job.error && <p className="websites-error">{t(`websites.jobErrors.${job.error}`, job.error)}</p>}<p>{t('recordWebsite.completion')}</p></div>}
      </div>
      <div className="border-t border-[var(--border-primary)] p-4"><button type="button" className="btn btn-gnosi-secondary" disabled={confirming} onClick={onClose}>{t(job ? 'common.close' : 'common.cancel')}</button></div>
    </div>
  </div></ModalPortal>;
}
