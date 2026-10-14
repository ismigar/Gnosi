import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { checkedWorkspaceDownload, uploadWorkspaceFile, workspaceRequest, type WorkspaceIdentity, type WorkspaceRecord } from '../../shared/api/agent-workspace';
import type { useAgentWorkspace, WorkspaceItem } from './useAgentWorkspace';
import { workspaceText } from './useAgentWorkspace';

interface Props { readonly identity: WorkspaceIdentity; readonly workspace: ReturnType<typeof useAgentWorkspace> }

export function WorkspaceFiles({ identity, workspace }: Props) {
  const { t } = useTranslation();
  const [grantId, setGrantId] = useState('');
  const [path, setPath] = useState('');
  const [listing, setListing] = useState<WorkspaceRecord | null>(null);
  const selected = workspace.grants.find(item => item.id === grantId) ?? workspace.grants[0];
  const entries = Array.isArray(listing?.entries) ? listing.entries as WorkspaceItem[] : [];
  return <section className="agent-workspace__section">
    <button type="button" className="btn-gnosi btn-gnosi-secondary" disabled={workspace.busy || !window.electronAPI?.workspaceOperation}
      onClick={() => { void workspace.addFolder(); }}>{t('agent_workbench.add_folder')}</button>
    {!window.electronAPI?.workspaceOperation && <p>{t('agent_workbench.desktop_required')}</p>}
    <label>{t('agent_workbench.folder')}<select className="gnosi-select" value={selected?.id || ''} onChange={event => { setGrantId(event.target.value); setListing(null); }}>
      <option value="">{t('agent_workbench.choose_folder')}</option>
      {workspace.grants.map(item => <option key={item.id} value={item.id}>{workspaceText(item, 'name')}</option>)}
    </select></label>
    <label>{t('agent_workbench.relative_path')}<input className="gnosi-input" value={path} onChange={event => { setPath(event.target.value); }} /></label>
    <div className="agent-workspace__actions">
      <button type="button" className="btn-gnosi btn-gnosi-secondary" disabled={!selected || workspace.busy}
        onClick={() => { const id = selected?.id; if (id) void workspace.perform(async () => { setListing(await workspaceRequest('files/list', identity, { grant_id: id, path })); }); }}>{t('agent_workbench.list_files')}</button>
      <button type="button" className="btn-gnosi btn-gnosi-secondary" disabled={!selected || workspace.busy}
        onClick={() => { if (selected) void workspace.revokeFolder(selected.id); }}>{t('agent_workbench.revoke')}</button>
    </div>
    {selected && <label>{t('agent_workbench.upload_new')}<input type="file" disabled={workspace.busy} onChange={event => {
      const file = event.target.files?.[0]; event.target.value = '';
      if (file) void workspace.perform(async () => { await uploadWorkspaceFile(identity, selected.id, path ? `${path}/${file.name}` : file.name, file); setListing(await workspaceRequest('files/list', identity, { grant_id: selected.id, path })); });
    }} /></label>}
    {entries.map((item, index) => <div key={workspaceText(item, 'name') || index} className="agent-workspace__actions">
      <span>{workspaceText(item, 'name')}</span>
      <button type="button" className="btn-gnosi btn-gnosi-secondary" disabled={workspace.busy} onClick={() => {
        const nextPath = path ? `${path}/${workspaceText(item, 'name')}` : workspaceText(item, 'name');
        if (item.directory) { setPath(nextPath); setListing(null); }
        else if (selected) void workspace.perform(() => checkedWorkspaceDownload(identity, selected.id, nextPath));
      }}>{t(item.directory ? 'agent_workbench.open_folder' : 'agent_workbench.download')}</button>
    </div>)}
  </section>;
}
