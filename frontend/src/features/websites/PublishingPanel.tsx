import { useDraftAutosave } from '../../shared/hooks/useDraftAutosave';
import { AutosaveStatus } from './WebsiteAutosave';
import { useAutosaveRegistration, type RegisterAutosave } from './autosaveRequest';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SiteConfig, SiteTarget, SitePreview, SiteStatus, SiteJob, TargetConnection } from '../../shared/api/sites';
import { Card, Empty, Field, Input, Select, Toggle } from './components';
import { newId } from './helpers';
import { WebsitePreview } from './AppearanceEditor';
import { RefreshButton } from '../../shared/ui/actions/RefreshButton';

export interface ConnectionActions {
  load: (targetId: string) => Promise<TargetConnection>;
  save: (targetId: string, input: TargetConnection) => Promise<TargetConnection>;
  probe: (targetId: string) => Promise<{ reachable: boolean; detail: string }>;
  serve: (targetId: string) => Promise<{ url: string; running: boolean }>;
  status: (targetId: string) => Promise<{ url: string; running: boolean }>;
  stop: (targetId: string) => Promise<{ url: string; running: boolean }>;
}

export function PublishingPanel({ site, targetId, onTarget, status, preview, dirty, busy, onChange, onPreview, onPublish, onCancel, onRollback, onRefresh, connection, registerAutosave }: { site: SiteConfig; targetId: string; onTarget: (id: string) => void; status: SiteStatus | null; preview: SitePreview | null; dirty: boolean; busy: boolean; onChange: (site: SiteConfig) => void; onPreview: () => void; onPublish: (date: string | null) => void; onCancel: (job: SiteJob) => void; onRollback: (releaseId: string) => void; onRefresh: () => void; connection: ConnectionActions; registerAutosave?: RegisterAutosave }) {
  const { t } = useTranslation();
  const [scheduledAt, setScheduledAt] = useState('');
  const target = (site.targets ?? []).find(item => item.id === targetId);
  const jobs = status?.jobs ?? [];
  return <div className="websites-panel"><Card title={t('websites.publish')} actions={<RefreshButton loading={busy} onClick={onRefresh} />}><p className="websites-notice">{t('websites.drupalProduction')}</p><div className="websites-grid websites-spacer"><Field label={t('websites.target')}><Select value={targetId} onChange={event => { onTarget(event.target.value); }}>{(site.targets ?? []).map(value => <option key={value.id} value={value.id}>{value.name} · {t(`websites.environments.${value.environment}`)}</option>)}</Select></Field><Field label={t('websites.scheduledAt')}><Input type="datetime-local" value={scheduledAt} onChange={event => { setScheduledAt(event.target.value); }} /></Field></div>
    {dirty && <p className="websites-notice websites-spacer">{t('websites.saveBeforeReview')}</p>}
    <div className="websites-actions websites-spacer"><button type="button" className="websites-button" disabled={busy || dirty || !target?.enabled || target.environment === 'production'} onClick={onPreview}>{t('websites.reviewChanges')}</button><button type="button" className="btn btn-gnosi-primary" disabled={busy || dirty || !preview || preview.target_id !== targetId || target?.environment === 'production'} onClick={() => { onPublish(scheduledAt ? new Date(scheduledAt).toISOString() : null); }}>{t('websites.publishReviewed')}</button></div>
    {preview && <div className="websites-spacer"><p className="websites-muted">{t('websites.expiresAt', { date: preview.expires_at })}</p>{(preview.warnings ?? []).map(warning => <p className="websites-notice" key={warning}>{warning}</p>)}<div className="websites-list websites-spacer">{preview.changes.map((change, index) => <div className="websites-row" key={index}><span className="websites-badge">{t(`websites.changeKinds.${change.kind}`)}</span> <strong>{change.title}</strong><p className="websites-muted">{change.path}</p></div>)}</div></div>}
  </Card>
    {preview && <WebsitePreview url={preview.preview_url} title={t('websites.websitePreview')} />}
    <Card title={t('websites.jobs')}><div className="websites-list">{jobs.map(job => <div className="websites-row" key={job.id}><div className="websites-row-title"><strong>{t(`websites.phases.${job.phase}`, job.phase)}</strong><span className="websites-badge">{t(`websites.states.${job.status}`, job.status)}</span></div><p className="websites-muted">{job.updated_at}{job.scheduled_at && ` · ${job.scheduled_at}`}</p>{job.error && <p role="alert" className="websites-error websites-spacer">{t(`websites.jobErrors.${job.error}`, job.error)}</p>}{['queued', 'running'].includes(job.status) && <button type="button" className="websites-button websites-spacer" disabled={busy} onClick={() => { onCancel(job); }}>{t('websites.cancelJob')}</button>}</div>)}</div>{!jobs.length && <Empty>{t('websites.noJobs')}</Empty>}</Card>
    <Card title={t('websites.releases')}><p className="websites-muted">{t('websites.rollbackHelp')}</p><div className="websites-list websites-spacer">{(status?.releases ?? []).map(release => <div className="websites-row" key={release.id}><div className="websites-row-title"><strong>{release.created_at}</strong>{release.current ? <span className="websites-badge">{t('websites.currentRelease')}</span> : <button type="button" className="websites-button" disabled={busy} onClick={() => { onRollback(release.id); }}>{t('websites.rollback')}</button>}</div><a href={release.url} target="_blank" rel="noopener noreferrer" className="websites-muted">{release.url}</a></div>)}</div>{!status?.releases.length && <Empty>{t('websites.noReleases')}</Empty>}</Card>
    <TargetsEditor site={site} onChange={onChange} activeTargetId={targetId} onTarget={onTarget} />
    {target && (target.adapter === 'legacy-pangea' ? <ManagedConnectionCard key={target.id} target={target} probe={connection.probe} dirty={dirty} /> : <TargetConnectionEditor key={target.id} target={target} actions={connection} dirty={dirty} register={registerAutosave} siteId={site.id} />)}
  </div>;
}

function TargetsEditor({ site, activeTargetId, onTarget, onChange }: { site: SiteConfig; activeTargetId: string; onTarget: (id: string) => void; onChange: (site: SiteConfig) => void }) {
  const { t } = useTranslation();
  const targets = site.targets ?? [];
  const update = (id: string, patch: Partial<SiteTarget>) => { onChange({ ...site, targets: targets.map(item => item.id === id ? { ...item, ...patch } : item) }); };
  return <Card title={t('websites.targets')} actions={<button type="button" className="websites-button" onClick={() => { const id = newId('target'); onChange({ ...site, targets: [...targets, { id, name: t('websites.newTarget'), environment: 'staging', adapter: 'ssh', base_url: 'https://example.invalid', enabled: false }] }); onTarget(id); }}>{t('websites.addTarget')}</button>}><div className="websites-list">{targets.map(target => <div className="websites-row" key={target.id}><div className="websites-row-title"><strong>{target.name}</strong><button type="button" className="websites-button" aria-pressed={activeTargetId === target.id} onClick={() => { onTarget(target.id); }}>{t('websites.configureConnection')}</button></div><div className="websites-grid"><Field label={t('websites.name')}><Input value={target.name} onChange={event => { update(target.id, { name: event.target.value }); }} /></Field><Field label={t('websites.baseUrl')}><Input type="url" value={target.base_url} onChange={event => { update(target.id, { base_url: event.target.value }); }} /></Field><Field label={t('websites.environment')}><Select value={target.environment} onChange={event => { update(target.id, { environment: event.target.value as SiteTarget['environment'] }); }}>{['local', 'staging', 'production'].map(value => <option key={value} value={value}>{t(`websites.environments.${value}`)}</option>)}</Select></Field><Field label={t('websites.adapter')}><Select value={target.adapter} onChange={event => { update(target.id, { adapter: event.target.value as SiteTarget['adapter'] }); }}>{['local', 'ssh', ...(site.legacy_pilot ? ['legacy-pangea'] : [])].map(value => <option key={value} value={value}>{t(`websites.adapters.${value}`)}</option>)}</Select></Field></div><Toggle label={t('websites.targetEnabled')} disabled={target.environment === 'production'} value={target.enabled} onChange={enabled => { update(target.id, { enabled }); }} />{target.environment === 'production' && <p className="websites-muted">{t('websites.productionLocked')}</p>}</div>)}</div></Card>;
}

function ManagedConnectionCard({ target, probe, dirty }: { target: SiteTarget; probe: ConnectionActions['probe']; dirty: boolean }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const verify = async () => {
    setBusy(true); setError(''); setNotice('');
    try { const result = await probe(target.id); setNotice(t(result.reachable ? 'websites.connectionReady' : 'websites.connectionFailed')); }
    catch { setError(t('websites.connectionFailed')); }
    finally { setBusy(false); }
  };
  return <Card title={`${t('websites.connection')} · ${target.name}`}><p className="websites-muted">{t('websites.managedBridgeHelp')}</p>{dirty && <p className="websites-notice websites-spacer">{t('websites.saveBeforeConnection')}</p>}{error && <p role="alert" className="websites-error websites-spacer">{error}</p>}{notice && <p role="status" className="websites-notice websites-spacer">{notice}</p>}<button type="button" className="websites-button websites-spacer" disabled={busy || dirty} onClick={() => { void verify(); }}>{t('websites.testConnection')}</button></Card>;
}

function TargetConnectionEditor({ target, actions, dirty, register, siteId }: { target: SiteTarget; actions: ConnectionActions; dirty: boolean; register?: RegisterAutosave; siteId: string }) {
  const { t } = useTranslation();
  const [value, setValue] = useState<TargetConnection | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const persisted = useRef(''); const loaded = useRef(false);
  const [persistedKey, setPersistedKey] = useState('');
  const [server, setServer] = useState<{ url: string; running: boolean } | null>(null);
  const load = useCallback(() => { setBusy(true); setError(''); void Promise.all([actions.load(target.id), target.adapter === 'local' ? actions.status(target.id) : Promise.resolve(null)]).then(([settings, result]) => { persisted.current = JSON.stringify(settings); setPersistedKey(persisted.current); setValue(settings); setServer(result); }).catch(() => { setError(t('websites.adminRequired')); }).finally(() => { setBusy(false); }); }, [actions, target.id, target.adapter, t]);
  useEffect(() => { let active = true; void Promise.resolve().then(() => { if (active && !dirty && !loaded.current) { loaded.current = true; load(); } }); return () => { active = false; }; }, [load, dirty]);
  const autosave = useDraftAutosave(value, Boolean(value), async snapshot => {
    if (!snapshot || JSON.stringify(snapshot) === persisted.current) return;
    await actions.save(target.id, snapshot); persisted.current = JSON.stringify(snapshot); setPersistedKey(persisted.current); setNotice(t('websites.saved'));
  });
  const pendingChanges = Boolean(value && JSON.stringify(value) !== persistedKey);
  useAutosaveRegistration(register, `connection:${siteId}:${target.id}`, pendingChanges, autosave.flush);
  const update = (patch: Partial<TargetConnection>) => { if (busy) return; setValue(previous => previous ? { ...previous, ...patch } : previous); setNotice(''); };
  const act = async (operation: () => Promise<void>) => { setBusy(true); setError(''); try { await operation(); } catch { setError(t('websites.connectionFailed')); } finally { setBusy(false); } };
  return <Card title={`${t('websites.connection')} · ${target.name}`} actions={<RefreshButton loading={busy} disabled={dirty || pendingChanges} onClick={load} />}>
    {dirty && <p className="websites-notice">{t('websites.saveBeforeConnection')}</p>}{error && <p className="websites-error" role="alert">{error}</p>}{notice && <p className="websites-notice" role="status">{notice}</p>}
    {target.adapter === 'local' && server && <div className="websites-actions websites-spacer"><span className="websites-badge" role="status">{t(server.running ? 'websites.serverRunning' : 'websites.serverStopped')}</span>{server.running && /^https?:\/\//u.test(server.url) && <a href={server.url} target="_blank" rel="noopener noreferrer" className="websites-button">{t('websites.openLocal')}</a>}</div>}
    {value && <fieldset disabled={busy} inert={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}><div className="websites-grid">{target.adapter === 'local' ? <Field label={t('websites.localPort')}><Input type="number" min={1024} max={65535} value={value.local_port} onChange={event => { update({ local_port: event.target.valueAsNumber || 4321 }); }} /></Field> : <><Field label={t('websites.host')}><Input value={value.host} onChange={event => { update({ host: event.target.value }); }} /></Field><Field label={t('websites.username')}><Input value={value.username} onChange={event => { update({ username: event.target.value }); }} /></Field><Field label={t('websites.port')}><Input type="number" min={1} max={65535} value={value.port} onChange={event => { update({ port: event.target.valueAsNumber || 22 }); }} /></Field><Field label={t('websites.remoteRoot')}><Input value={value.remote_root} onChange={event => { update({ remote_root: event.target.value }); }} /></Field><Field label={t('websites.documentRoot')} help={t('websites.documentRootHelp')}><Input value={value.document_root} onChange={event => { update({ document_root: event.target.value }); }} /></Field><Field label={t('websites.remotePrivateRoot')} help={t('websites.remotePrivateRootHelp')}><Input value={value.remote_private_root} onChange={event => { update({ remote_private_root: event.target.value }); }} /></Field></>}</div><div className="websites-actions websites-spacer"><AutosaveStatus status={pendingChanges || autosave.status === 'saved' ? autosave.status : 'idle'} retry={autosave.flush} detail={t('websites.connectionFailed')} /><button type="button" className="websites-button" disabled={busy || dirty || pendingChanges} onClick={() => { void act(async () => { const result = await actions.probe(target.id); setNotice(t(result.reachable ? 'websites.connectionReady' : 'websites.connectionFailed')); }); }}>{t('websites.testConnection')}</button>{target.adapter === 'local' && <><button type="button" className="websites-button" disabled={busy || dirty || pendingChanges || server?.running === true} onClick={() => { void act(async () => { const result = await actions.serve(target.id); setServer(result); setNotice(result.running ? `${t('websites.localRunning')} ${result.url}` : t('websites.connectionFailed')); }); }}>{t('websites.startLocal')}</button><button type="button" className="websites-button" disabled={busy || dirty || pendingChanges || !server?.running} onClick={() => { void act(async () => { const result = await actions.stop(target.id); setServer(result); setNotice(t('websites.serverStopped')); }); }}>{t('websites.stopLocal')}</button></>}</div></fieldset>}
  </Card>;
}
