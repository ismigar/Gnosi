import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, Plus, Save } from 'lucide-react';
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
    void Promise.allSettled([request(signal => api.listSites(context, signal)), request(signal => api.siteCatalogue(context, signal))]).then(([items, available]) => {
      if (!active) return;
      setCatalogue(available.status === 'fulfilled' ? available.value : []);
      if (items.status === 'rejected') { setError(apiErrorDetail(items.reason, t('websites.loadFailed'))); return; }
      setSites(items.value); setSaved(Object.fromEntries(items.value.map(site => [site.id, site])));
      setDrafts(previous => Object.fromEntries(items.value.map(site => [site.id, previous[site.id] ?? site])));
      setSelectedId(previous => items.value.some(site => site.id === previous) ? previous : items.value[0]?.id ?? '');
      if (available.status === 'rejected') setError(apiErrorDetail(available.reason, t('websites.loadFailed')));
    }).catch((failure: unknown) => { if (active) setError(apiErrorDetail(failure, t('websites.loadFailed'))); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [context, refreshRevision, request, t]);

  const site = drafts[selectedId];
  const targetId = (site?.targets ?? []).some(target => target.id === targetChoice) ? targetChoice : site?.targets?.[0]?.id ?? 'local';
  const dirty = Boolean(site && JSON.stringify(site) !== JSON.stringify(saved[selectedId]));
  const siteId = site?.id ?? '';
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

  const change = (value: api.SiteConfig) => { setDrafts(previous => ({ ...previous, [value.id]: value })); setPreview(null); setNotice(''); };
  const accept = (value: api.SiteConfig) => { setDrafts(previous => ({ ...previous, [value.id]: value })); setSaved(previous => ({ ...previous, [value.id]: value })); setSites(previous => previous.some(item => item.id === value.id) ? previous.map(item => item.id === value.id ? value : item) : [...previous, value]); setPreview(null); };
  const action = async (work: () => Promise<void>) => { if (busy) return; setBusy(true); setError(''); setNotice(''); try { await work(); } catch (failure) { if (alive.current) setError(apiErrorDetail(failure, t('websites.operationFailed'))); } finally { if (alive.current) setBusy(false); } };
  const refreshStatus = async () => { if (!siteId) return; setStatus(await request(signal => api.getSite(siteId, context, signal))); };
  const callPrivate = useCallback<PrivateCall>(async (name, body) => {
    const response = await request(signal => api.serviceAction(siteId, name, body, context, signal, targetId));
    return response.data;
  }, [siteId, targetId, request, context]);
  const loadSettings = useCallback(() => request(signal => api.getServiceSettings(siteId, context, signal, targetId)), [request, siteId, context, targetId]);
  const saveSettings = useCallback((value: api.ServiceSettings) => request(signal => api.saveServiceSettings(siteId, value, context, signal, targetId)), [request, siteId, context, targetId]);
  const connection = useMemo<ConnectionActions>(() => ({
    load: id => request(signal => api.getTargetConnection(siteId, id, context, signal)),
    save: (id, value) => request(signal => api.saveTargetConnection(siteId, id, value, context, signal)),
    probe: id => request(signal => api.probeTarget(siteId, id, context, signal)),
    serve: id => request(signal => api.serveTarget(siteId, id, context, signal)),
    status: id => request(signal => api.localTargetStatus(siteId, id, context, signal)),
    stop: id => request(signal => api.stopLocalTarget(siteId, id, context, signal)),
  }), [request, siteId, context]);

  const changeTab = (value: Tab) => { setTab(value); setError(''); };
  const tabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = event.key === 'ArrowRight' ? (index + 1) % TABS.length : event.key === 'ArrowLeft' ? (index + TABS.length - 1) % TABS.length : event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : -1;
    if (next < 0) return; event.preventDefault(); const item = TABS[next]; if (item) { changeTab(item); document.getElementById(`websites-tab-${item}`)?.focus(); }
  };

  return <main className="websites-page"><AppHeader icon={Globe} title={t('websites.title')} subtitle={t('websites.subtitle')}><button type="button" className="websites-button" onClick={() => { setCreating(true); }}><Plus size={16} />{t('websites.createSite')}</button><RefreshButton loading={loading} disabled={busy} onClick={() => { setLoading(true); setError(''); setRefreshRevision(value => value + 1); }} /></AppHeader><div className="websites-shell">
    <div className="websites-toolbar"><div className="websites-actions"><Field label={t('websites.website')}><Select disabled={busy} value={selectedId} onChange={event => { setSelectedId(event.target.value); setStatus(null); setPreview(null); setThemes([]); setTab('overview'); setNotice(''); setError(''); }}>{sites.map(value => <option key={value.id} value={value.id}>{drafts[value.id]?.name ?? value.name}</option>)}{!sites.length && <option value="">{t('websites.chooseSite')}</option>}</Select></Field>{site && <Field label={t('websites.target')}><Select value={targetId} onChange={event => { setTargetId(event.target.value); setPreview(null); }}>{(site.targets ?? []).map(target => <option key={target.id} value={target.id}>{target.name} · {t(`websites.environments.${target.environment}`)}</option>)}</Select></Field>}</div>{site && <div className="websites-actions">{dirty && <span className="websites-muted">{t('websites.unsaved')}</span>}<button type="button" className="btn btn-gnosi-primary" disabled={!dirty || busy} onClick={() => { void action(async () => { accept(await request(signal => api.saveSite(site, context, signal))); setNotice(t('websites.saved')); }); }}><Save size={16} />{t('websites.save')}</button></div>}</div>
    {loading && <p role="status">{t('websites.loading')}</p>}{busy && <p role="status">{t('websites.working')}</p>}{error && <div role="alert" className="websites-error">{error}</div>}{notice && <div role="status" className="websites-notice">{notice}</div>}
    {!loading && !site && <Empty>{t('websites.noSites')}</Empty>}
    {site && <><div className="websites-tabs" role="tablist" aria-label={t('websites.sections')}>{TABS.map((value, index) => <button type="button" key={value} role="tab" id={`websites-tab-${value}`} aria-controls="websites-panel" aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} onKeyDown={event => { tabKey(event, index); }} onClick={() => { changeTab(value); }}>{t(`websites.tabs.${value}`)}</button>)}</div><fieldset id="websites-panel" role="tabpanel" aria-labelledby={`websites-tab-${tab}`} disabled={busy} inert={busy} className="websites-panel" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      {tab === 'overview' && <Overview site={site} status={status} dirty={dirty} onReview={() => { setTab('publishing'); }} />}
      {tab === 'sources' && <SourcesEditor site={site} catalogue={catalogue} onChange={change} />}
      {tab === 'pages' && <PagesEditor site={site} catalogue={catalogue} onChange={change} />}
      {tab === 'navigation' && <NavigationEditor site={site} onChange={change} />}
      {tab === 'forms' && <FormsEditor site={site} onChange={change} />}
      {tab === 'appearance' && <AppearanceEditor site={site} busy={busy} history={themes} onChange={change} onExport={() => { downloadBlob(new Blob([JSON.stringify(site.theme, null, 2)], { type: 'application/json' }), `${site.name}-theme.json`); }} onImport={file => { void action(async () => { if (file.size > 200_000) throw new Error(t('websites.importTooLarge')); const raw = record(JSON.parse(await file.text())); const tokens = record(raw.tokens); if (raw.schema_version !== 1 || typeof raw.name !== 'string' || Object.values(tokens).some(value => typeof value !== 'string')) throw new Error(t('websites.invalidTheme')); const theme: api.SiteTheme = { schema_version: 1, name: raw.name, tokens: Object.fromEntries(Object.entries(tokens).map(([key, value]) => [key, String(value)])), logo: typeof raw.logo === 'string' ? raw.logo : '', logo_alt: typeof raw.logo_alt === 'string' ? raw.logo_alt : '', favicon: typeof raw.favicon === 'string' ? raw.favicon : '', fonts: Array.isArray(raw.fonts) ? raw.fonts.map(value => { const font = record(value); if (typeof font.family !== 'string' || typeof font.src !== 'string' || (font.style !== 'normal' && font.style !== 'italic')) throw new Error(t('websites.invalidTheme')); return { family: font.family, src: font.src, weight: typeof font.weight === 'string' ? font.weight : '400', style: font.style }; }) : [], advanced_css: typeof raw.advanced_css === 'string' ? raw.advanced_css : '' }; change({ ...site, theme }); setNotice(t('websites.themeImported')); }); }} onHistory={() => { void action(async () => { setThemes(await request(signal => api.themeHistory(site.id, context, signal))); }); }} />}
      {tab === 'messages' && <MessagesPanel key={`${site.id}:${targetId}`} site={site} call={callPrivate} />}
      {tab === 'subscribers' && <SubscribersPanel key={`${site.id}:${targetId}`} site={site} call={callPrivate} />}
      {tab === 'campaigns' && <CampaignsPanel key={`${site.id}:${targetId}`} site={site} call={callPrivate} />}
      {tab === 'settings' && <PrivateSettingsEditor key={`${site.id}:${targetId}`} site={site} load={loadSettings} save={saveSettings} />}
      {tab === 'publishing' && <PublishingPanel site={site} targetId={targetId} onTarget={value => { setTargetId(value); setPreview(null); }} status={status} preview={preview} dirty={dirty} busy={busy} onChange={change} connection={connection} onRefresh={() => { void action(refreshStatus); }} onPreview={() => { void action(async () => { setPreview(await request(signal => api.previewSite(site.id, targetId, context, signal), 180_000)); }); }} onPublish={date => { void action(async () => { if (!preview) return; const job = await request(signal => api.publishSite(site.id, preview.id, date, context, signal)); setPreview(null); setStatus(previous => previous ? { ...previous, jobs: [job, ...previous.jobs] } : { site, jobs: [job], releases: [], service_available: false }); setNotice(t('websites.publicationQueued')); }); }} onCancel={job => { void action(async () => { await request(signal => api.cancelJob(site.id, job.id, context, signal)); await refreshStatus(); }); }} onRollback={release => { void action(async () => { await request(signal => api.rollbackSite(site.id, release, context, signal)); await refreshStatus(); setNotice(t('websites.restored')); }); }} />}
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
