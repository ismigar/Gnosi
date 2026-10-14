import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { WorkspaceRecord } from '../../shared/api/agent-workspace';
import { workspaceText, type useAgentWorkspace } from './useAgentWorkspace';

export function WorkspaceNative({ workspace }: { readonly workspace: ReturnType<typeof useAgentWorkspace> }) {
  const { t } = useTranslation();
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [result, setResult] = useState<WorkspaceRecord | null>(null);
  const available = Boolean(window.electronAPI?.workspaceOperation);
  const action = (operation: WorkspaceRecord) => { void workspace.perform(async () => { setResult(await workspace.native(operation)); }); };
  return <section className="agent-workspace__section">
    {!available && <p>{t('agent_workbench.desktop_required')}</p>}
    <label>{t('agent_workbench.website')}<input className="gnosi-input" type="url" value={url} onChange={event => { setUrl(event.target.value); }} /></label>
    <div className="agent-workspace__actions">
      <button type="button" className="btn-gnosi btn-gnosi-secondary" disabled={!available || !url || workspace.busy} onClick={() => { action({ action: 'browser-open', url }); }}>{t('agent_workbench.open_browser')}</button>
      <button type="button" className="btn-gnosi btn-gnosi-secondary" disabled={!available || workspace.busy} onClick={() => { action({ action: 'browser-snapshot' }); }}>{t('agent_workbench.read_browser')}</button>
      <button type="button" className="btn-gnosi btn-gnosi-secondary" disabled={!available || workspace.busy} onClick={() => { action({ action: 'browser-takeover' }); }}>{t('agent_workbench.take_control')}</button>
      <button type="button" className="btn-gnosi btn-gnosi-secondary" disabled={!available} onClick={() => { void workspace.native({ action: 'browser-stop' }).then(setResult).catch(() => undefined); }}>{t('agent_workbench.stop')}</button>
    </div>
    <label>{t('agent_workbench.input_text')}<textarea className="gnosi-input" rows={3} value={text} onChange={event => { setText(event.target.value); }} /></label>
    <div className="agent-workspace__actions">
      <button type="button" className="btn-gnosi btn-gnosi-secondary" disabled={!available || workspace.busy} onClick={() => { action({ action: 'app-open' }); }}>{t('agent_workbench.choose_app')}</button>
      <button type="button" className="btn-gnosi btn-gnosi-secondary" disabled={!available || !text || workspace.busy} onClick={() => { action({ action: 'app-type', text }); }}>{t('agent_workbench.type_in_app')}</button>
      <button type="button" className="btn-gnosi btn-gnosi-secondary" disabled={!available || !text || workspace.busy} onClick={() => { action({ action: 'messages-compose', text }); }}>{t('agent_workbench.messages_draft')}</button>
    </div>
    {result && <><p role="status">{t(`agent_workbench.native_status.${workspaceText(result, 'status')}`, t('agent_workbench.native_status.unknown'))}</p>
      {result.page && <pre className="agent-workspace__output">{workspaceText(result.page as WorkspaceRecord, 'text')}</pre>}</>}
    {workspace.nativeRequests.map(request => <p key={request.id}>{t(`agent_workbench.native_actions.${workspaceText(request.operation as WorkspaceRecord, 'action')}`)} · {t(`agent_workbench.native_status.${workspaceText(request, 'status')}`, t('agent_workbench.native_status.unknown'))}</p>)}
  </section>;
}
