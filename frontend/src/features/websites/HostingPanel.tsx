import { SavedFeedback } from '../../shared/editor/SavedFeedback';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SiteConfig, SiteTarget, TargetConnection } from '../../shared/api/sites';
import { ConfirmModal } from '../../shared/ui/dialogs/ConfirmModal';
import { RefreshButton } from '../../shared/ui/actions/RefreshButton';
import { useDraftAutosave } from '../../shared/hooks/useDraftAutosave';
import { AutosaveStatus } from './WebsiteAutosave';
import { useAutosaveRegistration, type RegisterAutosave } from './autosaveRequest';
import { Card, Empty, Field, Input, Select, Toggle, Disclosure } from './components';
import { newId } from './helpers';
import { ConnectionAuthentication } from './ConnectionAuthentication';

export interface ConnectionActions {
  load: (targetId: string) => Promise<TargetConnection>;
  save: (targetId: string, input: TargetConnection) => Promise<TargetConnection>;
  password: (targetId: string, password: string | null) => Promise<TargetConnection>;
  probe: (targetId: string) => Promise<{ reachable: boolean; detail: string }>;
  serve: (targetId: string) => Promise<{ url: string; running: boolean }>;
  status: (targetId: string) => Promise<{ url: string; running: boolean }>;
  stop: (targetId: string) => Promise<{ url: string; running: boolean }>;
}

export function HostingPanel({ site, targetId, onTarget, dirty, busy, onChange, onRemove, connection, registerAutosave }: { site: SiteConfig; targetId: string; onTarget: (id: string) => void; dirty: boolean; busy: boolean; onChange: (site: SiteConfig) => void; onRemove: (id: string) => Promise<boolean>; connection: ConnectionActions; registerAutosave?: RegisterAutosave }) {
  const { t } = useTranslation();
  const [removing, setRemoving] = useState<SiteTarget | null>(null);
  const target = (site.targets ?? []).find(item => item.id === targetId);
  return <div className="websites-panel">
    <TargetsEditor site={site} onChange={onChange} activeTargetId={targetId} onTarget={onTarget} onRemove={setRemoving} disabled={busy || dirty} />
    {target && (target.adapter === 'legacy-pangea' ? <ManagedConnectionCard key={target.id} target={target} probe={connection.probe} dirty={dirty} /> : <TargetConnectionEditor key={target.id} target={target} actions={connection} dirty={dirty} register={registerAutosave} siteId={site.id} />)}
    <ConfirmModal isOpen={Boolean(removing)} title={t('websites.removeHosting')} message={t('websites.removeHostingHelp', { name: removing?.name })} confirmText={t('websites.delete')} cancelText={t('websites.cancel')} autofocusConfirm={false} confirmOnEnter={false} onClose={() => { if (!busy) setRemoving(null); }} onConfirm={async () => { if (removing && !busy && !dirty) { if (await onRemove(removing.id)) setRemoving(null); } }} />
  </div>;
}

function TargetsEditor({ site, activeTargetId, onTarget, onChange, onRemove, disabled }: { site: SiteConfig; activeTargetId: string; onTarget: (id: string) => void; onChange: (site: SiteConfig) => void; onRemove: (target: SiteTarget) => void; disabled: boolean }) {
  const { t } = useTranslation();
  const targets = site.targets ?? [];
  const update = (id: string, patch: Partial<SiteTarget>) => { onChange({ ...site, targets: targets.map(item => item.id === id ? { ...item, ...patch } : item) }); };
  return <Card title={t('websites.targets')} actions={<button type="button" className="websites-button" onClick={() => { const id = newId('target'); onChange({ ...site, targets: [...targets, { id, name: t('websites.newTarget'), environment: 'local', adapter: 'local', base_url: 'http://127.0.0.1:4321', enabled: true }] }); onTarget(id); }}>{t('websites.addTarget')}</button>}><p className="websites-muted">{t('websites.hostingHelp')}</p>{!targets.length && <Empty>{t('websites.noTargets')}</Empty>}<div className="websites-list websites-spacer">{targets.map(target => <Disclosure className="websites-row" key={target.id} title={(target.name)}><div className="websites-row-title"><button type="button" className="websites-button" aria-pressed={activeTargetId === target.id} onClick={() => { onTarget(target.id); }}>{t('websites.configureConnection')}</button><button type="button" className="websites-button" disabled={disabled} onClick={() => { onRemove(target); }}>{t('websites.removeHosting')}</button></div><div className="websites-grid"><Field label={t('websites.name')}><Input value={target.name} onChange={event => { update(target.id, { name: event.target.value }); }} /></Field><Field label={t('websites.baseUrl')}><Input type="url" value={target.base_url} onChange={event => { update(target.id, { base_url: event.target.value }); }} /></Field><Field label={t('websites.environment')}><Select value={target.environment} onChange={event => { update(target.id, { environment: event.target.value as SiteTarget['environment'], adapter: event.target.value === 'local' ? 'local' : target.adapter === 'local' ? 'ssh' : target.adapter }); }}>{['local', 'staging', 'production'].map(value => <option key={value} value={value}>{t(`websites.environments.${value}`)}</option>)}</Select></Field><Field label={t('websites.adapter')}><Select value={target.adapter} onChange={event => { update(target.id, { adapter: event.target.value as SiteTarget['adapter'], environment: event.target.value === 'local' ? 'local' : target.environment === 'local' ? 'staging' : target.environment }); }}>{['local', 'ssh', ...(site.legacy_pilot ? ['legacy-pangea'] : [])].map(value => <option key={value} value={value}>{t(`websites.adapters.${value}`)}</option>)}</Select></Field></div><Toggle label={t('websites.targetEnabled')} disabled={target.environment === 'production'} value={target.enabled} onChange={enabled => { update(target.id, { enabled }); }} />{target.environment === 'production' && <p className="websites-muted">{t('websites.productionLocked')}</p>}</Disclosure>)}</div></Card>;
}

function ManagedConnectionCard({ target, probe, dirty }: { target: SiteTarget; probe: ConnectionActions['probe']; dirty: boolean }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const verify = async () => {
    setBusy(true); setError(''); setNotice('');
    try { const result = await probe(target.id); setNotice(t(result.detail.startsWith('sftp_ready_') ? 'websites.sftpReadyWithoutRuntime' : result.reachable ? 'websites.connectionReady' : 'websites.connectionFailed')); }
    catch { setError(t('websites.connectionFailed')); }
    finally { setBusy(false); }
  };
  return <Card title={`${t('websites.connection')} · ${target.name}`}><p className="websites-muted">{t('websites.managedBridgeHelp')}</p>{dirty && <p className="websites-notice websites-spacer">{t('websites.saveBeforeConnection')}</p>}{error && <p role="alert" className="websites-error websites-spacer">{error}</p>}{notice && <p role="status" className="websites-notice websites-spacer">{notice === t('websites.saved') ? <SavedFeedback>{notice}</SavedFeedback> : notice}</p>}<button type="button" className="websites-button websites-spacer" disabled={busy || dirty} onClick={() => { void verify(); }}>{t('websites.testConnection')}</button></Card>;
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
    const saved = await actions.save(target.id, snapshot); persisted.current = JSON.stringify(saved); setPersistedKey(persisted.current); setValue(current => JSON.stringify(current) === JSON.stringify(snapshot) ? saved : current); setNotice(t('websites.saved'));
  });
  const pendingChanges = Boolean(value && JSON.stringify(value) !== persistedKey);
  useAutosaveRegistration(register, `connection:${siteId}:${target.id}`, pendingChanges, autosave.flush);
  const update = (patch: Partial<TargetConnection>) => { if (busy) return; setValue(previous => previous ? { ...previous, ...patch } : previous); setNotice(''); };
  const act = async (operation: () => Promise<void>) => { setBusy(true); setError(''); try { await operation(); } catch { setError(t('websites.connectionFailed')); } finally { setBusy(false); } };
  return <Card title={`${t('websites.connection')} · ${target.name}`} actions={<RefreshButton loading={busy} disabled={dirty || pendingChanges} onClick={load} />}>
    {dirty && <p className="websites-notice">{t('websites.saveBeforeConnection')}</p>}{error && <p className="websites-error" role="alert">{error}</p>}{notice && <p className="websites-notice" role="status">{notice === t('websites.saved') ? <SavedFeedback>{notice}</SavedFeedback> : notice}</p>}
    {target.adapter === 'local' && server && <div className="websites-actions websites-spacer"><span className="websites-badge" role="status">{t(server.running ? 'websites.serverRunning' : 'websites.serverStopped')}</span>{server.running && /^https?:\/\//u.test(server.url) && <a href={server.url} target="_blank" rel="noopener noreferrer" className="websites-button">{t('websites.openLocal')}</a>}</div>}
    {value && <fieldset disabled={busy} inert={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}><div className="websites-grid">{target.adapter === 'local' ? <Field label={t('websites.localPort')}><Input type="number" min={1024} max={65535} value={value.local_port} onChange={event => { update({ local_port: event.target.valueAsNumber || 4321 }); }} /></Field> : <><Field label={t('websites.host')}><Input value={value.host} onChange={event => { update({ host: event.target.value }); }} /></Field><Field label={t('websites.username')}><Input value={value.username} onChange={event => { update({ username: event.target.value }); }} /></Field><Field label={t('websites.port')}><Input type="number" min={1} max={65535} value={value.port} onChange={event => { update({ port: event.target.valueAsNumber || 22 }); }} /></Field><Field label={t('websites.remoteRoot')}><Input value={value.remote_root} onChange={event => { update({ remote_root: event.target.value }); }} /></Field><Field label={t('websites.documentRoot')} help={t('websites.documentRootHelp')}><Input value={value.document_root} onChange={event => { update({ document_root: event.target.value }); }} /></Field><Field label={t('websites.remotePrivateRoot')} help={t('websites.remotePrivateRootHelp')}><Input value={value.remote_private_root} onChange={event => { update({ remote_private_root: event.target.value }); }} /></Field></>}</div>{target.adapter !== 'local' && <ConnectionAuthentication key={JSON.stringify([value.host, value.username, value.port, value.authentication])} value={value} disabled={busy} canSave={!dirty && !pendingChanges} update={update} savePassword={async secret => { let success = false; await act(async () => { const saved = await actions.password(target.id, secret); persisted.current = JSON.stringify(saved); setPersistedKey(persisted.current); setValue(saved); setNotice(t('websites.saved')); success = true; }); return success; }} />}<div className="websites-actions websites-spacer"><AutosaveStatus status={pendingChanges || autosave.status === 'saved' ? autosave.status : 'idle'} retry={autosave.flush} detail={t('websites.connectionFailed')} /><button type="button" className="websites-button" disabled={busy || dirty || pendingChanges} onClick={() => { void act(async () => { const result = await actions.probe(target.id); setNotice(t(result.detail.startsWith('sftp_ready_') ? 'websites.sftpReadyWithoutRuntime' : result.reachable ? 'websites.connectionReady' : 'websites.connectionFailed')); }); }}>{t('websites.testConnection')}</button>{target.adapter === 'local' && <><button type="button" className="websites-button" disabled={busy || dirty || pendingChanges || server?.running === true} onClick={() => { void act(async () => { const result = await actions.serve(target.id); setServer(result); setNotice(result.running ? `${t('websites.localRunning')} ${result.url}` : t('websites.connectionFailed')); }); }}>{t('websites.startLocal')}</button><button type="button" className="websites-button" disabled={busy || dirty || pendingChanges || !server?.running} onClick={() => { void act(async () => { const result = await actions.stop(target.id); setServer(result); setNotice(t('websites.serverStopped')); }); }}>{t('websites.stopLocal')}</button></>}</div></fieldset>}
  </Card>;
}
