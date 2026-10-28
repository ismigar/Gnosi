import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, Plus } from 'lucide-react';
import { AppHeader } from '../../shared/ui/layout/AppHeader';
import { RefreshButton } from '../../shared/ui/actions/RefreshButton';
import { useRequestContext } from '../../shared/hooks/useRequestContext';
import { useModalKeyboard } from '../../shared/hooks/useModalKeyboard';
import { currentRequestContext, type RequestContext } from '../../shared/api/request-context';
import { apiErrorDetail } from '../../shared/api/errors';
import { downloadBlob } from '../../shared/platform/download';
import * as api from '../../shared/api/sites';
import { Card, Empty, Field, Input, Select, Toggle } from './components';
import { SourcesEditor } from './SourcesEditor';
import { PagesEditor } from './PagesEditor';
import { FormsEditor } from './FormsEditor';
import { NavigationEditor } from './NavigationEditor';
import { AppearanceEditor } from './AppearanceEditor';
import { PublishingPanel, type ConnectionActions } from './PublishingPanel';
import { MessagesPanel, SubscribersPanel, CampaignsPanel, PrivateSettingsEditor, type PrivateCall } from './PrivatePanels';
import { record } from './serviceModels';
import { WebsiteAutosave } from './WebsiteAutosave';
import { configurationKey } from './helpers';
import { autosaveRequest, type AutosaveEntry, type RegisterAutosave } from './autosaveRequest';
import './Websites.css';

const TABS = ['overview', 'sources', 'pages', 'navigation', 'appearance', 'forms', 'messages', 'subscribers', 'campaigns', 'publishing', 'settings'] as const;
type Tab = typeof TABS[number];
const contextKey = (context: RequestContext) => JSON.stringify([context.userId, context.userEmail, context.workspaceId, context.vaultId]);

/** A scope change remounts every editor and clears private service responses. */
export default function WebsitesPage() {
  const context = useRequestContext();
  return <Session key={contextKey(context)} context={context} />;
}

function Session({ context }: { context: RequestContext }) {
  const { t } = useTranslation();
  const [sites, setSites] = useState<api.SiteConfig[]>([]);
  const [catalogue, setCatalogue] = useState<api.CatalogueItem[]>([]);
  const [catalogueRevision, setCatalogueRevision] = useState(-1);
  const [catalogueFailure, setCatalogueFailure] = useState(-1);
  const [catalogueRequested, setCatalogueRequested] = useState(false);
  const [catalogueError, setCatalogueError] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [drafts, setDrafts] = useState<Record<string, api.SiteConfig>>({});
  const [saved, setSaved] = useState<Record<string, api.SiteConfig>>({});
  const [status, setStatus] = useState<api.SiteStatus | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [targetChoice, setTargetId] = useState('local');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [creating, setCreating] = useState(false);
  const [preview, setPreview] = useState<api.SitePreview | null>(null);
  const [themes, setThemes] = useState<api.SiteTheme[]>([]);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const alive = useRef(true);
  const pending = useRef(new Set<AbortController>());
  const writers = useRef(new Map<string, AutosaveEntry>());
  const [saveActivity, setSaveActivity] = useState<Record<string, boolean>>({});
  const registerAutosave = useCallback<RegisterAutosave>((key, value) => {
    if (value) writers.current.set(key, value); else writers.current.delete(key);
    if (!alive.current) return;
    if (value?.pending) setPreview(null);
    setSaveActivity(previous => (previous[key] ?? false) === Boolean(value?.pending) ? previous : { ...previous, [key]: Boolean(value?.pending) });
  }, []);
  const flushWriters = async (includePublic = false) => {
    const entries = [...writers.current.entries()].sort(([left], [right]) => left === 'public' ? -1 : right === 'public' ? 1 : left.localeCompare(right));
    for (const [key, value] of entries) if (value.pending && (includePublic || key !== 'public') && !await value.flush()) return false;
    return true;
  };
  const hasPendingSaves = Object.values(saveActivity).some(Boolean);
  useEffect(() => { alive.current = true; const controllers = pending.current; return () => { alive.current = false; controllers.forEach(controller => { controller.abort(); }); controllers.clear(); }; }, []);

  const request = useCallback(<T,>(operation: (signal: AbortSignal) => Promise<T>, timeout = 65_000): Promise<T> => {
    const controller = new AbortController(); pending.current.add(controller);
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const cleanup = () => { clearTimeout(timer); pending.current.delete(controller); controller.signal.removeEventListener('abort', abort); };
      const fail = () => { if (settled) return; settled = true; cleanup(); reject(new Error('Website request cancelled or expired')); };
      const abort = () => { fail(); };
      const timer = setTimeout(() => { controller.abort(); }, timeout);
      controller.signal.addEventListener('abort', abort, { once: true });
      if (!alive.current || contextKey(context) !== contextKey(currentRequestContext())) { controller.abort(); return; }
      void operation(controller.signal).then(value => {
        if (settled) return;
        if (!alive.current || contextKey(context) !== contextKey(currentRequestContext())) { controller.abort(); return; }
        settled = true; cleanup(); resolve(value);
      }).catch((failure: unknown) => { if (settled) return; settled = true; cleanup(); reject(failure instanceof Error ? failure : new Error('Website request failed')); });
    });
  }, [context]);

  useEffect(() => {
    let active = true;
    void request(signal => api.listSites(context, signal)).then(items => {
      if (!active) return;
      setSites(items); setSaved(Object.fromEntries(items.map(site => [site.id, site])));
      setDrafts(Object.fromEntries(items.map(site => [site.id, site])));
      setSelectedId(previous => items.some(site => site.id === previous) ? previous : items[0]?.id ?? '');
    }).catch((failure: unknown) => { if (active) setError(apiErrorDetail(failure, t('websites.loadFailed'))); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [context, refreshRevision, request, t]);

  const needsCatalogue = tab === 'sources' || tab === 'pages';
  useEffect(() => {
    if (!catalogueRequested) return;
    let active = true; const controller = new AbortController();
    void request(signal => {
      const abort = () => { controller.abort(); };
      signal.addEventListener('abort', abort, { once: true });
      return api.siteCatalogue(context, controller.signal).finally(() => { signal.removeEventListener('abort', abort); });
    }).then(items => {
      if (active) { setCatalogue(items); setCatalogueRevision(refreshRevision); }
    }).catch((failure: unknown) => { if (active) { setCatalogueFailure(refreshRevision); setCatalogueError(apiErrorDetail(failure, t('websites.loadFailed'))); } });
    return () => { active = false; controller.abort(); };
  }, [catalogueRequested, refreshRevision, request, context, t]);

  const site = drafts[selectedId];
  const targetId = (site?.targets ?? []).some(target => target.id === targetChoice) ? targetChoice : site?.targets?.[0]?.id ?? 'local';
  const dirty = useMemo(() => Boolean(site && configurationKey(site) !== configurationKey(saved[selectedId] ?? site)), [site, saved, selectedId]);
  const siteId = site?.id ?? '';
  const anyDirty = useMemo(() => Object.values(drafts).some(value => { const previous = saved[value.id]; return previous && configurationKey(value) !== configurationKey(previous); }), [drafts, saved]);
  useEffect(() => {
    if (!siteId) return;
    let active = true;
    void request(signal => api.getSite(siteId, context, signal)).then(value => { if (active) setStatus(value); }).catch((failure: unknown) => { if (active) setError(apiErrorDetail(failure, t('websites.loadFailed'))); });
    return () => { active = false; };
  }, [siteId, context, refreshRevision, request, t]);

  const hasActiveJobs = status?.jobs.some(job => ['queued', 'running'].includes(job.status)) ?? false;
  useEffect(() => {
    if (!siteId || !hasActiveJobs) return;
    let active = true;
    let polling = false;
    const timer = setInterval(() => {
      if (polling) return;
      polling = true;
      void request(signal => api.siteJobs(siteId, context, signal), 20_000).then(async jobs => {
        if (!active) return;
        if (jobs.some(job => ['queued', 'running'].includes(job.status))) {
          setStatus(previous => previous ? { ...previous, jobs } : previous);
        } else {
          // Keep polling alive until the final release list has arrived too.
          await request(signal => api.getSite(siteId, context, signal)).then(value => { if (active) setStatus(value); });
        }
      }).catch(() => { if (active) setError(t('websites.jobReadFailed')); }).finally(() => { polling = false; });
    }, 3000);
    return () => { active = false; clearInterval(timer); };
  }, [siteId, hasActiveJobs, request, context, t]);

  const change = (value: api.SiteConfig) => { if (loading) return; setDrafts(previous => ({ ...previous, [value.id]: value })); setPreview(null); setNotice(''); };
  const accept = (value: api.SiteConfig) => { setDrafts(previous => ({ ...previous, [value.id]: value })); setSaved(previous => ({ ...previous, [value.id]: value })); setSites(previous => previous.some(item => item.id === value.id) ? previous.map(item => item.id === value.id ? value : item) : [...previous, value]); setPreview(null); };
  const acceptAutosave = useCallback((value: api.SiteConfig, submitted: api.SiteConfig) => {
    if (!alive.current) return;
    setSaved(previous => ({ ...previous, [value.id]: value }));
    setDrafts(previous => {
      const current = previous[value.id];
      return { ...previous, [value.id]: !current || configurationKey(current) === configurationKey(submitted) ? value : { ...current, revision: value.revision } };
    });
    setSites(previous => previous.map(item => item.id === value.id ? value : item));
  }, []);
  const action = async (work: () => Promise<void>) => { if (busy) return; setBusy(true); setError(''); setNotice(''); try { await work(); } catch (failure) { if (alive.current) setError(apiErrorDetail(failure, t('websites.operationFailed'))); } finally { if (alive.current) setBusy(false); } };
  const refreshStatus = async () => { if (!siteId) return; setStatus(await request(signal => api.getSite(siteId, context, signal))); };
  const callPrivate = useCallback<PrivateCall>(async (name, body) => {
    const response = await request(signal => api.serviceAction(siteId, name, body, context, signal, targetId));
    return response.data;
  }, [siteId, targetId, request, context]);
  const newsletterActions = useMemo(() => ({
    load: () => request(signal => api.getNewsletter(siteId, targetId, context, signal)),
    save: (draft: api.NewsletterDraft) => autosaveRequest(context, signal => api.saveNewsletter(siteId, targetId, draft, context, signal)),
    review: (review: api.NewsletterReview) => request(signal => api.reviewNewsletter(siteId, targetId, review, context, signal)),
    queue: (review: api.NewsletterQueue) => request(signal => api.queueNewsletter(siteId, targetId, review, context, signal)),
  }), [siteId, targetId, context, request]);
  const loadSettings = useCallback(() => request(signal => api.getServiceSettings(siteId, context, signal, targetId)), [request, siteId, context, targetId]);
  const saveSettings = useCallback((value: api.ServiceSettings) => autosaveRequest(context, signal => api.saveServiceSettings(siteId, value, context, signal, targetId)), [siteId, context, targetId]);
  const connection = useMemo<ConnectionActions>(() => ({
    load: id => request(signal => api.getTargetConnection(siteId, id, context, signal)),
    save: (id, value) => autosaveRequest(context, signal => api.saveTargetConnection(siteId, id, value, context, signal)),
    probe: id => request(signal => api.probeTarget(siteId, id, context, signal)),
    serve: id => request(signal => api.serveTarget(siteId, id, context, signal)),
    status: id => request(signal => api.localTargetStatus(siteId, id, context, signal)),
    stop: id => request(signal => api.stopLocalTarget(siteId, id, context, signal)),
  }), [request, siteId, context]);

  const changeTab = (value: Tab) => {
    const select = () => { if (value === 'sources' || value === 'pages') setCatalogueRequested(true); setTab(value); setError(''); };
    if (![...writers.current.entries()].some(([key, writer]) => key !== 'public' && writer.pending)) { select(); return; }
    void action(async () => { if (await flushWriters()) select(); });
  };
  const changeTarget = (value: string) => { void action(async () => { if (await flushWriters()) { setTargetId(value); setPreview(null); } }); };
  const tabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = event.key === 'ArrowRight' ? (index + 1) % TABS.length : event.key === 'ArrowLeft' ? (index + TABS.length - 1) % TABS.length : event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : -1;
    if (next < 0) return; event.preventDefault(); const item = TABS[next]; if (item) { changeTab(item); document.getElementById(`websites-tab-${item}`)?.focus(); }
  };

  return <main className="websites-page"><AppHeader icon={Globe} title={t('websites.title')} subtitle={t('websites.subtitle')}><button type="button" className="websites-button" disabled={loading} onClick={() => { setCreating(true); }}><Plus size={16} />{t('websites.createSite')}</button><RefreshButton loading={loading} disabled={busy || loading || anyDirty || hasPendingSaves} onClick={() => { setLoading(true); setError(''); setRefreshRevision(value => value + 1); }} /></AppHeader><div className="websites-shell">
    <div className="websites-toolbar"><div className="websites-actions"><Field label={t('websites.website')}><Select disabled={busy || loading} value={selectedId} onChange={event => { const value = event.target.value; void action(async () => { if (!await flushWriters()) return; setSelectedId(value); setStatus(null); setPreview(null); setThemes([]); setTab('overview'); setNotice(''); setError(''); }); }}>{sites.map(value => <option key={value.id} value={value.id}>{drafts[value.id]?.name ?? value.name}</option>)}{!sites.length && <option value="">{t('websites.chooseSite')}</option>}</Select></Field>{site && <Field label={t('websites.target')}><Select disabled={busy || loading} value={targetId} onChange={event => { changeTarget(event.target.value); }}>{(site.targets ?? []).map(target => <option key={target.id} value={target.id}>{target.name} · {t(`websites.environments.${target.environment}`)}</option>)}</Select></Field>}</div>{site && <WebsiteAutosave drafts={drafts} saved={saved} context={context} onSaved={acceptAutosave} register={registerAutosave} />}</div>
    {loading && <p role="status">{t('websites.loading')}</p>}{busy && <p role="status">{t('websites.working')}</p>}{error && <div role="alert" className="websites-error">{error}</div>}{notice && <div role="status" className="websites-notice">{notice}</div>}
    {!loading && !site && <Empty>{t('websites.noSites')}</Empty>}
    {site && <><div className="websites-tabs" role="tablist" aria-label={t('websites.sections')}>{TABS.map((value, index) => <button type="button" key={value} role="tab" id={`websites-tab-${value}`} aria-controls="websites-panel" aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} onKeyDown={event => { tabKey(event, index); }} onClick={() => { changeTab(value); }}>{t(`websites.tabs.${value}`)}</button>)}</div><fieldset id="websites-panel" role="tabpanel" aria-labelledby={`websites-tab-${tab}`} disabled={busy || loading} inert={busy || loading} className="websites-panel" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      {tab === 'overview' && <Overview site={site} status={status} dirty={dirty} onReview={() => { setTab('publishing'); }} />}
      {needsCatalogue && catalogueFailure === refreshRevision && <div role="alert" className="websites-error">{catalogueError}</div>}
      {needsCatalogue && catalogueRevision !== refreshRevision && catalogueFailure !== refreshRevision && <p role="status">{t('websites.catalogueLoading')}</p>}
      {tab === 'sources' && catalogueRevision === refreshRevision && <SourcesEditor site={site} catalogue={catalogue} onChange={change} />}
      {tab === 'pages' && <PagesEditor site={site} catalogue={catalogue} onChange={change} />}
      {tab === 'navigation' && <NavigationEditor site={site} onChange={change} />}
      {tab === 'forms' && <FormsEditor site={site} onChange={change} />}
      {tab === 'appearance' && <AppearanceEditor register={registerAutosave} context={context} site={site} busy={busy} history={themes} onChange={change} onExport={() => { downloadBlob(new Blob([JSON.stringify(site.theme, null, 2)], { type: 'application/json' }), `${site.name}-theme.json`); }} onImport={file => { void action(async () => { if (file.size > 200_000) throw new Error(t('websites.importTooLarge')); const raw = record(JSON.parse(await file.text())); const tokens = record(raw.tokens); if (raw.schema_version !== 1 || typeof raw.name !== 'string' || Object.values(tokens).some(value => typeof value !== 'string')) throw new Error(t('websites.invalidTheme')); const theme: api.SiteTheme = { schema_version: 1, name: raw.name, tokens: Object.fromEntries(Object.entries(tokens).map(([key, value]) => [key, String(value)])), logo: typeof raw.logo === 'string' ? raw.logo : '', logo_alt: typeof raw.logo_alt === 'string' ? raw.logo_alt : '', favicon: typeof raw.favicon === 'string' ? raw.favicon : '', fonts: Array.isArray(raw.fonts) ? raw.fonts.map(value => { const font = record(value); if (typeof font.family !== 'string' || typeof font.src !== 'string' || (font.style !== 'normal' && font.style !== 'italic')) throw new Error(t('websites.invalidTheme')); return { family: font.family, src: font.src, weight: typeof font.weight === 'string' ? font.weight : '400', style: font.style }; }) : [], advanced_css: typeof raw.advanced_css === 'string' ? raw.advanced_css : '' }; change({ ...site, theme }); setNotice(t('websites.themeImported')); }); }} onHistory={() => { void action(async () => { setThemes(await request(signal => api.themeHistory(site.id, context, signal))); }); }} />}
      {tab === 'messages' && <MessagesPanel key={`${site.id}:${targetId}`} site={site} call={callPrivate} />}
      {tab === 'subscribers' && <SubscribersPanel key={`${site.id}:${targetId}`} site={site} call={callPrivate} />}
      {tab === 'campaigns' && <CampaignsPanel key={`${site.id}:${targetId}`} site={site} call={callPrivate} composer={newsletterActions} register={registerAutosave} autosaveKey={`newsletter:${site.id}:${targetId}`} />}
      {tab === 'settings' && <PrivateSettingsEditor key={`${site.id}:${targetId}`} site={site} load={loadSettings} save={saveSettings} register={registerAutosave} autosaveKey={`private:${site.id}:${targetId}`} />}
      {tab === 'publishing' && <PublishingPanel site={site} targetId={targetId} onTarget={changeTarget} status={status} preview={preview} dirty={dirty || hasPendingSaves} busy={busy} onChange={change} connection={connection} registerAutosave={registerAutosave} onRefresh={() => { void action(refreshStatus); }} onPreview={() => { void action(async () => { if (!await flushWriters(true)) return; setPreview(await request(signal => api.previewSite(site.id, targetId, context, signal), 180_000)); }); }} onPublish={date => { void action(async () => { if (!preview || !await flushWriters(true)) return; const job = await request(signal => api.publishSite(site.id, preview.id, date, context, signal)); setPreview(null); setStatus(previous => previous ? { ...previous, jobs: [job, ...previous.jobs] } : { site, jobs: [job], releases: [], service_available: false }); setNotice(t('websites.publicationQueued')); }); }} onCancel={job => { void action(async () => { await request(signal => api.cancelJob(site.id, job.id, context, signal)); await refreshStatus(); }); }} onRollback={release => { void action(async () => { await request(signal => api.rollbackSite(site.id, release, context, signal)); await refreshStatus(); setNotice(t('websites.restored')); }); }} />}
    </fieldset></>}
  </div>{creating && <CreateSiteDialog busy={busy} onClose={() => { if (!busy) setCreating(false); }} onCreate={(name, importPilot) => { void action(async () => { const value = await request(signal => api.createSite(name, importPilot, context, signal)); accept(value); setSelectedId(value.id); setCreating(false); setNotice(t('websites.siteCreated')); }); }} />}</main>;
}

function Overview({ site, status, dirty, onReview }: { site: api.SiteConfig; status: api.SiteStatus | null; dirty: boolean; onReview: () => void }) {
  const { t } = useTranslation();
  return <div className="websites-panel"><p className="websites-notice">{t('websites.drupalProduction')}</p><div className="websites-grid websites-grid-three">{[{ key: 'sources', count: site.sources?.filter(source => source.enabled).length ?? 0 }, { key: 'pages', count: site.pages?.filter(page => page.enabled).length ?? 0 }, { key: 'forms', count: site.forms?.filter(form => form.enabled).length ?? 0 }].map(value => <Card key={value.key} title={t(`websites.${value.key}`)}><span className="websites-stat">{value.count}</span><p className="websites-muted">{t('websites.enabledCount')}</p></Card>)}</div><Card title={site.name}><p className="websites-muted">{site.origin}</p><p className="websites-spacer">{t('websites.languages')}: {(site.languages ?? []).map(language => language.toUpperCase()).join(' · ')}</p><p className="websites-muted">{t('websites.version', { count: site.revision })} · {t(dirty ? 'websites.unsaved' : 'websites.saved')}</p><p className="websites-muted websites-spacer">{t(status?.service_available ? 'websites.serviceReady' : 'websites.serviceUnconfigured')}</p><div className="websites-actions websites-spacer"><button type="button" className="websites-button" onClick={onReview}>{t('websites.reviewChanges')}</button></div></Card></div>;
}

function CreateSiteDialog({ busy, onClose, onCreate }: { busy: boolean; onClose: () => void; onCreate: (name: string, importPilot: boolean) => void }) {
  const { t } = useTranslation(); const ref = useRef<HTMLDivElement>(null); const [name, setName] = useState(''); const [importPilot, setImportPilot] = useState(false);
  useModalKeyboard({ isOpen: true, containerRef: ref, onClose, closeOnEscape: !busy });
  return <div ref={ref} className="websites-dialog" role="dialog" aria-modal="true" aria-label={t('websites.createSite')}><form onSubmit={event => { event.preventDefault(); if (name.trim() && !busy) onCreate(name.trim(), importPilot); }}><h2>{t('websites.createSite')}</h2><Field label={t('websites.siteName')}><Input required autoFocus maxLength={200} value={name} onChange={event => { setName(event.target.value); }} disabled={busy} /></Field><Toggle label={t('websites.importPilot')} value={importPilot} onChange={setImportPilot} disabled={busy} /><p className="websites-muted">{t('websites.importPilotHelp')}</p><div className="websites-actions"><button type="button" className="websites-button" disabled={busy} onClick={onClose}>{t('websites.cancel')}</button><button type="submit" className="btn btn-gnosi-primary" disabled={busy || !name.trim()}>{t('websites.create')}</button></div></form></div>;
}
