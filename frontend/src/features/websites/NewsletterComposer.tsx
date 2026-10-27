import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { NewsletterDraft, NewsletterQueue, NewsletterReview, NewsletterState, ServiceResponse, SiteConfig } from '../../shared/api/sites';
import { GnosiApiError } from '../../shared/api/errors';
import { useDraftAutosave } from '../../shared/hooks/useDraftAutosave';
import { RefreshButton } from '../../shared/ui/actions/RefreshButton';
import { WebsitePreview } from './AppearanceEditor';
import { useAutosaveRegistration, type RegisterAutosave } from './autosaveRequest';
import { Card, Empty, Field, Input, ReorderActions, Select, Textarea } from './components';
import { count, decodeCampaignPreview, record, type CampaignPreview } from './serviceModels';
import { AutosaveStatus } from './WebsiteAutosave';

export interface NewsletterActions {
  load: () => Promise<NewsletterState>;
  save: (draft: NewsletterDraft) => Promise<NewsletterDraft>;
  review: (request: NewsletterReview) => Promise<ServiceResponse>;
  queue: (request: NewsletterQueue) => Promise<ServiceResponse>;
}
type Draft = Omit<NewsletterDraft, 'revision'>;
const withoutRevision = ({ revision: _revision, ...draft }: NewsletterDraft): Draft => draft;

export function NewsletterComposer({ site, actions, onQueued, register, autosaveKey = 'newsletter' }: { site: SiteConfig; actions: NewsletterActions; onQueued: () => void; register?: RegisterAutosave; autosaveKey?: string }) {
  const { t } = useTranslation();
  const [loaded, setLoaded] = useState<NewsletterState | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState(false);
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState<CampaignPreview | null>(null);
  const revision = useRef(0);
  const persisted = useRef('');
  const generation = useRef(0);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    void actions.load().then(value => {
      if (!active) return;
      const valueDraft = withoutRevision(value.draft);
      revision.current = value.draft.revision;
      persisted.current = JSON.stringify(valueDraft);
      setLoaded(value); setDraft(valueDraft); setError(''); setLoadError(false); setPreview(null);
    }).catch(() => { if (active) setLoadError(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [actions, refresh]);
  const autosave = useDraftAutosave(draft, Boolean(draft), async value => {
    if (!value || JSON.stringify(value) === persisted.current) return;
    const saved = await actions.save({ ...value, revision: revision.current });
    revision.current = saved.revision; persisted.current = JSON.stringify(value);
  });
  useAutosaveRegistration(register, autosaveKey, autosave.dirty, autosave.flush);
  const update = (patch: Partial<Draft>) => {
    generation.current++; setPreview(null); setNotice('');
    setDraft(previous => previous ? { ...previous, ...patch } : previous);
  };
  const review = async () => {
    if (!draft || !loaded || busy) return;
    const current = ++generation.current; const isCurrent = () => alive.current && current === generation.current; setBusy(true); setError(''); setPreview(null); setNotice('');
    try {
      if (!await autosave.flush()) throw new Error('Newsletter autosave failed');
      if (!isCurrent()) return;
      const response = await actions.review({ draft: { ...draft, revision: revision.current }, fingerprint: loaded.fingerprint });
      if (!isCurrent()) return;
      const value = decodeCampaignPreview(response.data);
      if (!value) throw new Error('Invalid newsletter review');
      setPreview(value);
    } catch { if (isCurrent()) setError(t('websites.newsletterReviewFailed')); }
    finally { if (alive.current) setBusy(false); }
  };
  const queue = async () => {
    if (!preview || !draft || busy) return;
    const current = generation.current; setBusy(true); setError('');
    try {
      const response = record((await actions.queue({ preview_id: preview.id, scheduled_at: draft.scheduled_at ? new Date(draft.scheduled_at).toISOString() : null })).data);
      if (!alive.current) return;
      onQueued();
      if (current === generation.current) { setPreview(null); setNotice(t('websites.campaignQueued', { count: count(response.queued) })); }
    } catch (failure) {
      if (alive.current) {
        const changed = failure instanceof GnosiApiError && failure.status === 409;
        if (changed) setPreview(null);
        setError(t(changed ? 'websites.newsletterReviewFailed' : 'websites.operationFailed'));
      }
    }
    finally { if (alive.current) setBusy(false); }
  };
  const paths = draft?.paths ?? [];
  const contents = loaded?.contents ?? [];
  const available = contents.filter(item => item.language === draft?.language);
  const selected = paths.map(path => ({ path, item: available.find(item => item.path === path) }));
  const invalid = selected.some(item => !item.item);
  const canReview = Boolean(draft?.subject.trim() && (draft.mode === 'manual' ? draft.body_html.trim() : paths.length && !invalid && loaded?.fingerprint));
  return <><Card title={t('websites.campaignDraft')} actions={<RefreshButton loading={loading} disabled={busy || autosave.dirty} onClick={() => { generation.current++; setPreview(null); setLoading(true); setRefresh(value => value + 1); }} />}>
    <p className="websites-notice">{t('websites.testOnly')}</p>
    {loading && <p role="status">{t('websites.loading')}</p>}
    {draft && <fieldset disabled={loading} inert={loading} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}><div className="websites-grid websites-spacer">
      <Field label={t('websites.subject')}><Input value={draft.subject} maxLength={300} onChange={event => { update({ subject: event.target.value }); }} /></Field>
      <Field label={t('websites.language')}><Select value={draft.language} onChange={event => { update({ language: event.target.value }); }}>{(site.languages ?? []).map(value => <option key={value} value={value}>{value.split('-')[0]?.toUpperCase()}</option>)}</Select></Field>
      <Field label={t('websites.listId')}><Input maxLength={128} value={draft.list_id} onChange={event => { update({ list_id: event.target.value }); }} /></Field>
      <Field label={t('websites.interests')}><Input maxLength={3000} value={draft.interests} onChange={event => { update({ interests: event.target.value }); }} /></Field>
      <Field label={t('websites.newsletterMode')}><Select value={draft.mode} onChange={event => { update({ mode: event.target.value as NewsletterDraft['mode'] }); }}><option value="contents">{t('websites.newsletterFromContents')}</option><option value="manual">{t('websites.newsletterManual')}</option></Select></Field>
      {draft.mode === 'contents' && <Field label={t('websites.newsletterTemplate')}><Select value={draft.template} onChange={event => { update({ template: event.target.value as NewsletterDraft['template'] }); }}><option value="digest">{t('websites.newsletterDigest')}</option><option value="featured">{t('websites.newsletterFeatured')}</option></Select></Field>}
    </div>
    {draft.mode === 'contents' ? <>
      <Field label={t('websites.newsletterIntroduction')}><Textarea rows={4} maxLength={10000} value={draft.introduction} onChange={event => { update({ introduction: event.target.value }); }} /></Field>
      <h3>{t('websites.newsletterSelected')}</h3>
      <p className="websites-muted">{t('websites.newsletterPublishedHelp')}</p>
      {invalid && <p role="alert" className="websites-error">{t('websites.newsletterSelectionUnavailable')}</p>}
      <div className="websites-list">{selected.map(({ path, item }, index) => <div className="websites-row" key={path}><div className="websites-row-title"><strong>{item?.title ?? path}</strong><ReorderActions index={index} length={paths.length} remove={() => { update({ paths: paths.filter(value => value !== path) }); }} move={direction => { const reordered = [...paths]; const other = reordered[index + direction]; if (other === undefined) return; reordered[index] = other; reordered[index + direction] = path; update({ paths: reordered }); }} /></div><p className="websites-muted">{path}</p></div>)}</div>
      {!paths.length && <Empty>{t('websites.newsletterEmptySelection')}</Empty>}
      <Field label={t('websites.newsletterSearch')}><Input type="search" value={query} onChange={event => { setQuery(event.target.value); }} /></Field>
      <div className="websites-list">{available.filter(item => !paths.includes(item.path) && `${item.title} ${item.summary}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(item => <div className="websites-row" key={item.path}><div className="websites-row-title"><strong>{item.title}</strong><button type="button" className="websites-button" disabled={paths.length >= 20} aria-label={t('websites.newsletterAddTitle', { title: item.title })} onClick={() => { update({ paths: [...paths, item.path] }); }}>{t('common.add')}</button></div><p className="websites-muted">{item.summary}</p></div>)}</div>
      {!available.length && <Empty>{t('websites.newsletterNoPublished')}</Empty>}
    </> : <div className="websites-grid websites-spacer"><Field label={t('websites.htmlBody')}><Textarea rows={10} maxLength={200000} value={draft.body_html} onChange={event => { update({ body_html: event.target.value }); }} /></Field><Field label={t('websites.textBody')}><Textarea rows={10} maxLength={200000} value={draft.body_text} onChange={event => { update({ body_text: event.target.value }); }} /></Field></div>}
    <Field label={t('websites.scheduledAt')}><Input type="datetime-local" value={draft.scheduled_at} onChange={event => { update({ scheduled_at: event.target.value }); }} /></Field>
    <AutosaveStatus status={autosave.status} retry={autosave.flush} detail={autosave.status === 'error' ? t('websites.newsletterSaveFailed') : undefined} />
    {autosave.status === 'error' && <button type="button" className="websites-button" disabled={busy || loading} onClick={() => { generation.current++; setPreview(null); setDraft(null); setLoading(true); setRefresh(value => value + 1); }}>{t('websites.newsletterReloadDraft')}</button>}
    <div className="websites-actions websites-spacer"><button type="button" className="websites-button" disabled={loading || busy || !canReview} onClick={() => { void review(); }}>{t('websites.reviewCampaign')}</button><button type="button" className="btn btn-gnosi-primary" disabled={busy || !preview} onClick={() => { void queue(); }}>{t('websites.queueCampaign')}</button></div></fieldset>}
    {loadError && <p role="alert" className="websites-error websites-spacer">{t('websites.newsletterLoadFailed')}</p>}{error && <p role="alert" className="websites-error websites-spacer">{error}</p>}{notice && <p role="status" className="websites-notice websites-spacer">{notice}</p>}
  </Card>{preview && <><p className="websites-notice">{t('websites.senderEmail')}: {preview.fromEmail || t('websites.none')} · {t('websites.audienceCount', { count: preview.recipientCount })} · {t('websites.expiresAt', { date: preview.expiresAt })}</p><WebsitePreview html={preview.html} title={t('websites.campaignPreview')} /><Card title={t('websites.textBody')}><pre className="websites-message">{preview.text}</pre></Card></>}</>;
}
