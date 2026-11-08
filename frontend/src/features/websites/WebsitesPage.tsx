import { SavedFeedback } from '../../shared/editor/SavedFeedback';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, Plus } from 'lucide-react';
import { AppHeader } from '../../shared/ui/layout/AppHeader';
import { ConfirmModal } from '../../shared/ui/dialogs/ConfirmModal';
import { RefreshButton } from '../../shared/ui/actions/RefreshButton';
import { useRequestContext } from '../../shared/hooks/useRequestContext';
import { currentRequestContext, type RequestContext } from '../../shared/api/request-context';
import { apiErrorDetail } from '../../shared/api/errors';
import { downloadBlob } from '../../shared/platform/download';
import * as api from '../../shared/api/sites';
import { Card, Empty, Field, Select } from './components';
import { CreateSiteDialog } from './CreateSiteDialog';
import { SourcesEditor } from './SourcesEditor';
import { WebsiteAssetProvider } from './WebsiteFileField';
import { PagesEditor } from './PagesEditor';
import { FormsEditor } from './FormsEditor';
import { NavigationEditor } from './NavigationEditor';
import { AppearanceEditor } from './AppearanceEditor';
import { PublishingPanel } from './PublishingPanel';
import { HostingPanel, type ConnectionActions } from './HostingPanel';
import { MessagesPanel, SubscribersPanel, CampaignsPanel, PrivateSettingsEditor, type PrivateCall } from './PrivatePanels';
import { record } from './serviceModels';
import { WebsiteAutosave } from './WebsiteAutosave';
import { configurationKey } from './helpers';
import { autosaveRequest, type AutosaveEntry, type RegisterAutosave } from './autosaveRequest';
import './Websites.css';

const TABS = ['overview', 'sources', 'pages', 'configuration', 'navigation', 'regions', 'appearance', 'forms', 'messages', 'subscribers', 'campaigns', 'publishing', 'hosting', 'settings'] as const;
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
  const [cataloguePartial, setCataloguePartial] = useState(false);
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
  const [removing, setRemoving] = useState<api.SiteConfig | null>(null);
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

  const needsCatalogue = tab === 'sources' || tab === 'pages' || tab === 'regions';
  useEffect(() => {
    if (!catalogueRequested) return;
    let active = true; const controller = new AbortController();
    void request(signal => {
      const abort = () => { controller.abort(); };
      signal.addEventListener('abort', abort, { once: true });
      return api.siteCatalogue(context, controller.signal, ready => { if (active) setCataloguePartial(!ready); }).finally(() => { signal.removeEventListener('abort', abort); });
    }).then(items => {
      if (active) { setCatalogue(items); setCatalogueRevision(refreshRevision); }
    }).catch((failure: unknown) => { if (active) { setCatalogueFailure(refreshRevision); setCatalogueError(apiErrorDetail(failure, t('websites.loadFailed'))); } });
    return () => { active = false; controller.abort(); };
  }, [catalogueRequested, refreshRevision, request, context, t]);

  const site = drafts[selectedId];
  const targetId = (site?.targets ?? []).some(target => target.id === targetChoice) ? targetChoice : site?.targets?.[0]?.id ?? '';
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
  const selectCreated = (value: api.SiteConfig) => { accept(value); setSelectedId(value.id); setStatus(null); setThemes([]); setTab('overview'); setCreating(false); setNotice(t('websites.siteCreated')); };
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
    password: (id, password) => request(signal => api.saveTargetPassword(siteId, id, password, context, signal)),
    probe: id => request(signal => api.probeTarget(siteId, id, context, signal)),
    serve: id => request(signal => api.serveTarget(siteId, id, context, signal)),
    status: id => request(signal => api.localTargetStatus(siteId, id, context, signal)),
    stop: id => request(signal => api.stopLocalTarget(siteId, id, context, signal)),
  }), [request, siteId, context]);

  const changeTab = (value: Tab) => {
    const select = () => { if (value === 'sources' || value === 'pages' || value === 'regions') setCatalogueRequested(true); setTab(value); setError(''); };
    const privateDestination = ['settings', 'messages', 'subscribers', 'campaigns'].includes(value);
    if (![...writers.current.entries()].some(([key, writer]) => (privateDestination || key !== 'public') && writer.pending)) { select(); return; }
    void action(async () => { if (await flushWriters(privateDestination)) select(); });
  };
  const changeTarget = (value: string) => { void action(async () => { if (await flushWriters(true)) { setTargetId(value); setPreview(null); } }); };
  const removeTarget = async (id: string) => { let removed = false; await action(async () => {
    if (!site || !await flushWriters(true)) return;
    const current = await request(signal => api.getSite(site.id, context, signal));
    const value = await request(signal => api.saveSite({ ...current.site, targets: (current.site.targets ?? []).filter(target => target.id !== id) }, context, signal));
    accept(value); setTargetId(value.targets?.[0]?.id ?? ''); setNotice(t('websites.hostingRemoved')); removed = true;
  }); return removed; };
  const removeWebsite = async () => { await action(async () => {
    if (!removing || !await flushWriters(true)) return;
    await request(signal => api.removeSite(removing.id, removing.revision, context, signal));
    const remaining = sites.filter(item => item.id !== removing.id);
    setSites(remaining);
    setDrafts(previous => Object.fromEntries(Object.entries(previous).filter(([id]) => id !== removing.id)));
    setSaved(previous => Object.fromEntries(Object.entries(previous).filter(([id]) => id !== removing.id)));
    setSelectedId(remaining[0]?.id ?? ''); setTargetId(''); setStatus(null); setPreview(null); setThemes([]); setTab('overview'); setRemoving(null); setNotice(t('websites.siteRemoved'));
  }); };
  const tabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = event.key === 'ArrowRight' ? (index + 1) % TABS.length : event.key === 'ArrowLeft' ? (index + TABS.length - 1) % TABS.length : event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : -1;
    if (next < 0) return; event.preventDefault(); const item = TABS[next]; if (item) { changeTab(item); document.getElementById(`websites-tab-${item}`)?.focus(); }
  };

  return <WebsiteAssetProvider revision={site?.revision} siteId={siteId} context={context} register={registerAutosave}><main className="websites-page"><AppHeader icon={Globe} title={t('websites.title')} subtitle={t('websites.subtitle')}><button type="button" className="websites-button" disabled={loading || busy} onClick={() => { setCreating(true); }}><Plus size={16} />{t('websites.createSite')}</button><RefreshButton loading={loading} disabled={busy || loading || anyDirty || hasPendingSaves} onClick={() => { setLoading(true); setError(''); setRefreshRevision(value => value + 1); }} /></AppHeader><div className="websites-shell">
    <div className="websites-toolbar"><div className="websites-actions"><Field label={t('websites.website')}><Select disabled={busy || loading} value={selectedId} onChange={event => { const value = event.target.value; void action(async () => { if (!await flushWriters()) return; setSelectedId(value); setStatus(null); setPreview(null); setThemes([]); setTab('overview'); setNotice(''); setError(''); }); }}>{sites.map(value => <option key={value.id} value={value.id}>{drafts[value.id]?.name ?? value.name}</option>)}{!sites.length && <option value="">{t('websites.chooseSite')}</option>}</Select></Field>{site && <Field label={t('websites.target')}><Select disabled={busy || loading} value={targetId} onChange={event => { changeTarget(event.target.value); }}>{!site.targets?.length && <option value="">{t('websites.noTargets')}</option>}{(site.targets ?? []).map(target => <option key={target.id} value={target.id}>{target.name} · {t(`websites.environments.${target.environment}`)}</option>)}</Select></Field>}
    {site && <><button type="button" className="websites-button" disabled={busy || loading} onClick={() => { changeTab('hosting'); }}>{t('websites.manageHosting')}</button><button type="button" className="websites-button" disabled={busy || loading || anyDirty || hasPendingSaves} onClick={() => { setRemoving(site); }}>{t('websites.removeSite')}</button></>}
    </div>{site && <WebsiteAutosave drafts={drafts} saved={saved} context={context} onSaved={acceptAutosave} register={registerAutosave} />}</div>
    {loading && <p role="status">{t('websites.loading')}</p>}{busy && <p role="status">{t('websites.working')}</p>}{error && <div role="alert" className="websites-error">{error}</div>}{notice && <div role="status" className="websites-notice">{notice}</div>}
    {!loading && !site && <Empty>{t('websites.noSites')}</Empty>}
    {site && <><div className="websites-tabs" role="tablist" aria-label={t('websites.sections')}>{TABS.map((value, index) => <button type="button" key={value} role="tab" id={`websites-tab-${value}`} aria-controls="websites-panel" aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} onKeyDown={event => { tabKey(event, index); }} onClick={() => { changeTab(value); }}>{t(`websites.tabs.${value}`)}</button>)}</div><fieldset id="websites-panel" role="tabpanel" aria-labelledby={`websites-tab-${tab}`} disabled={busy || loading} inert={busy || loading} className="websites-panel" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      {tab === 'overview' && <Overview site={site} status={status} dirty={dirty} onReview={() => { setTab('publishing'); }} />}
      {needsCatalogue && catalogueFailure === refreshRevision && <div role="alert" className="websites-error">{catalogueError}</div>}
      {needsCatalogue && catalogueRevision !== refreshRevision && catalogueFailure !== refreshRevision && <p role="status">{t('websites.catalogueLoading')}</p>}
      {needsCatalogue && catalogueRevision === refreshRevision && cataloguePartial && <p role="status" className="websites-muted">{t('websites.cataloguePagesPending')}</p>}
      {tab === 'sources' && catalogueRevision === refreshRevision && <SourcesEditor site={site} catalogue={catalogue} onChange={change} />}
      {tab === 'pages' && <PagesEditor site={site} catalogue={catalogue} onChange={change} />}
      {tab === 'configuration' && <NavigationEditor section="configuration" site={site} onChange={change} />}
      {tab === 'navigation' && <NavigationEditor section="menus" site={site} onChange={change} />}
      {tab === 'regions' && <NavigationEditor section="regions" site={site} catalogue={catalogue} onChange={change} />}
      {tab === 'forms' && <FormsEditor site={site} onChange={change} />}
      {tab === 'appearance' && <AppearanceEditor key={site.id} register={registerAutosave} context={context} site={site} busy={busy} history={themes} onChange={change} onExport={() => { downloadBlob(new Blob([JSON.stringify(site.theme, null, 2)], { type: 'application/json' }), `${site.name}-theme.json`); }} onImport={file => { void action(async () => { if (file.size > 2_000_000) throw new Error(t('websites.importTooLarge')); const raw = record(JSON.parse(await file.text())); const tokens = record(raw.tokens); const stylesheetOverrides = record(raw.stylesheet_overrides); if (raw.stylesheet_overrides != null && (typeof raw.stylesheet_overrides !== 'object' || Array.isArray(raw.stylesheet_overrides)) || Object.entries(stylesheetOverrides).some(([key, value]) => !['base', 'template', 'layout'].includes(key) || typeof value !== 'string' || value.length > 100000)) throw new Error(t('websites.invalidTheme')); if (raw.schema_version !== 1 || typeof raw.name !== 'string' || Object.values(tokens).some(value => typeof value !== 'string')) throw new Error(t('websites.invalidTheme')); const theme: api.SiteTheme = { schema_version: 1, name: raw.name, stylesheet_overrides: stylesheetOverrides as Record<string, string>, tokens: Object.fromEntries(Object.entries(tokens).map(([key, value]) => [key, String(value)])), logo: typeof raw.logo === 'string' ? raw.logo : '', logo_alt: typeof raw.logo_alt === 'string' ? raw.logo_alt : '', favicon: typeof raw.favicon === 'string' ? raw.favicon : '', fonts: Array.isArray(raw.fonts) ? raw.fonts.map(value => { const font = record(value); if (typeof font.family !== 'string' || typeof font.src !== 'string' || (font.style !== 'normal' && font.style !== 'italic')) throw new Error(t('websites.invalidTheme')); return { family: font.family, src: font.src, weight: typeof font.weight === 'string' ? font.weight : '400', style: font.style }; }) : [], advanced_css: typeof raw.advanced_css === 'string' ? raw.advanced_css : '' }; change({ ...site, theme }); setNotice(t('websites.themeImported')); }); }} onHistory={() => { void action(async () => { setThemes(await request(signal => api.themeHistory(site.id, context, signal))); }); }} />}
      {!targetId && ['messages', 'subscribers', 'campaigns', 'settings'].includes(tab) && <Empty>{t('websites.noTargets')}</Empty>}
      {tab === 'messages' && targetId && <MessagesPanel key={`${site.id}:${targetId}`} site={site} call={callPrivate} />}
      {tab === 'subscribers' && targetId && <SubscribersPanel key={`${site.id}:${targetId}`} site={site} call={callPrivate} />}
      {tab === 'campaigns' && targetId && <CampaignsPanel key={`${site.id}:${targetId}`} site={site} production={Boolean(site.targets?.some(target => target.id === targetId && target.environment === 'production'))} call={callPrivate} composer={newsletterActions} register={registerAutosave} autosaveKey={`newsletter:${site.id}:${targetId}`} />}
      {tab === 'settings' && targetId && <PrivateSettingsEditor key={`${site.id}:${targetId}`} site={site} load={loadSettings} save={saveSettings} register={registerAutosave} autosaveKey={`private:${site.id}:${targetId}`} />}
      {tab === 'hosting' && <HostingPanel key={site.id} site={site} targetId={targetId} onTarget={changeTarget} dirty={dirty || hasPendingSaves} busy={busy} onChange={change} onRemove={removeTarget} connection={connection} registerAutosave={registerAutosave} />}
      {tab === 'publishing' && <PublishingPanel key={site.id} onRemoveTarget={removeTarget} site={site} targetId={targetId} onTarget={changeTarget} status={status} preview={preview} dirty={dirty || hasPendingSaves} busy={busy} onChange={change} connection={connection} registerAutosave={registerAutosave} onRefresh={() => { void action(refreshStatus); }} onPreview={() => { void action(async () => { if (!await flushWriters(true)) return; setPreview(await request(signal => api.previewSite(site.id, targetId, context, signal), 180_000)); }); }} onPublish={date => { void action(async () => { if (!preview || !await flushWriters(true)) return; const job = await request(signal => api.publishSite(site.id, preview.id, date, context, signal)); setPreview(null); setStatus(previous => previous ? { ...previous, jobs: [job, ...previous.jobs] } : { site, jobs: [job], releases: [], service_available: false }); setNotice(t('websites.publicationQueued')); }); }} onCancel={job => { void action(async () => { await request(signal => api.cancelJob(site.id, job.id, context, signal)); await refreshStatus(); }); }} onRollback={release => { void action(async () => { await request(signal => api.rollbackSite(site.id, release, context, signal)); await refreshStatus(); setNotice(t('websites.restored')); }); }} />}
    </fieldset></>}
  </div><ConfirmModal isOpen={Boolean(removing)} title={t('websites.removeSite')} message={t('websites.removeSiteHelp', { name: removing?.name })} confirmText={t('websites.delete')} cancelText={t('websites.cancel')} autofocusConfirm={false} confirmOnEnter={false} onClose={() => { if (!busy) setRemoving(null); }} onConfirm={removeWebsite} />{creating && <CreateSiteDialog busy={busy} onClose={() => { if (!busy) setCreating(false); }} onReview={(url, maxPages) => request(signal => api.previewWebsiteImport(url, maxPages, context, signal), 90_000)} onImport={(previewId, name, pages) => { void action(async () => { if (!await flushWriters()) return; selectCreated(await request(signal => api.createWebsiteImport(previewId, name, pages, context, signal))); }); }} onCreate={(name, importPilot) => { void action(async () => { if (!await flushWriters()) return; selectCreated(await request(signal => api.createSite(name, importPilot, context, signal))); }); }} />}</main></WebsiteAssetProvider>;
}

function Overview({ site, status, dirty, onReview }: { site: api.SiteConfig; status: api.SiteStatus | null; dirty: boolean; onReview: () => void }) {
  const { t } = useTranslation();
  return <div className="websites-panel"><p className="websites-notice">{t('websites.publishingReview')}</p><div className="websites-grid websites-grid-three">{[{ key: 'sources', count: site.sources?.filter(source => source.enabled).length ?? 0 }, { key: 'pages', count: site.pages?.filter(page => page.enabled).length ?? 0 }, { key: 'forms', count: site.forms?.filter(form => form.enabled).length ?? 0 }].map(value => <Card collapsible={false} key={value.key} title={t(`websites.${value.key}`)}><span className="websites-stat">{value.count}</span><p className="websites-muted">{t('websites.enabledCount')}</p></Card>)}</div><Card collapsible={false} title={site.name}><p className="websites-muted">{site.origin}</p><p className="websites-spacer">{t('websites.languages')}: {(site.languages ?? []).map(language => language.toUpperCase()).join(' · ')}</p><p className="websites-muted">{t('websites.version', { count: site.revision })} · {dirty ? t('websites.unsaved') : <SavedFeedback key={site.revision}>{t('websites.saved')}</SavedFeedback>}</p><p className="websites-muted websites-spacer">{t(status?.service_available ? 'websites.serviceReady' : 'websites.serviceUnconfigured')}</p><div className="websites-actions websites-spacer"><button type="button" className="websites-button" onClick={onReview}>{t('websites.reviewChanges')}</button></div></Card></div>;
}
