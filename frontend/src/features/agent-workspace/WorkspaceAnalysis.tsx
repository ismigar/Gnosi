import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { downloadWorkspaceArtifact, importAnalysisFile, workspaceRequest, type WorkspaceIdentity, type WorkspaceRecord } from '../../shared/api/agent-workspace';
import { GnosiToggle } from '../../shared/ui/settings/SettingsPrimitives';
import { workspaceText, type useAgentWorkspace } from './useAgentWorkspace';

interface Props { readonly identity: WorkspaceIdentity; readonly workspace: ReturnType<typeof useAgentWorkspace> }

export function WorkspaceAnalysis({ identity, workspace }: Props) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [result, setResult] = useState<WorkspaceRecord | null>(null);
  const [inputs, setInputs] = useState<{ identity: string; name: string }[]>([]);
  const runtime = workspace.status?.analysis as WorkspaceRecord | undefined;
  const running = useRef<string | null>(null);
  const attempt = useRef<{ code: string; id: string } | null>(null);
  return <section className="agent-workspace__section">
    <label>{t('agent_workbench.history')}<select className="gnosi-select" value={workspaceText(result, 'id')} onChange={event => {
      const id = event.target.value;
      if (id) void workspace.perform(async () => { setResult(await workspaceRequest(`analysis/${encodeURIComponent(id)}`, identity)); });
    }}><option value="">{t('agent_workbench.history')}</option>
      {workspace.analyses.map(item => <option key={item.id} value={item.id}>{item.id.slice(0, 8)} · {t(`agent_workbench.native_status.${workspaceText(item, 'status')}`, t('agent_workbench.native_status.unknown'))}</option>)}
    </select></label>
    <p>{t(runtime?.available ? 'agent_workbench.analysis_ready' : 'agent_workbench.analysis_unavailable')}</p>
    <label>{t('agent_workbench.import_input')}<input type="file" disabled={workspace.busy} onChange={event => {
      const file = event.target.files?.[0]; event.target.value = '';
      if (file) void workspace.perform(async () => {
        const imported = await importAnalysisFile(identity, file); await workspace.reload();
        if (imported.status === 'imported') { attempt.current = null; setInputs(current => [...current, { identity: workspaceText(imported, 'id'), name: file.name }]); }
      });
    }} /></label>
    <label>{t('agent_workbench.python_code')}<textarea className="gnosi-input" rows={8} value={code} onChange={event => {
      setCode(event.target.value); attempt.current = null;
    }} /></label>
    <div className="agent-workspace__actions">
      <button type="button" className="btn-gnosi btn-gnosi-primary" disabled={workspace.busy || !runtime?.available || !code.trim()} onClick={() => {
        void workspace.perform(async () => {
          if (!attempt.current || attempt.current.code !== code) attempt.current = { code, id: crypto.randomUUID() };
          running.current = attempt.current.id;
          try { setResult(await workspaceRequest('analysis', identity, { code, request_id: running.current, inputs })); await workspace.reload(); }
          finally { running.current = null; }
        });
      }}>{t('agent_workbench.run')}</button>
      <button type="button" className="btn-gnosi btn-gnosi-secondary" disabled={!workspace.busy} onClick={() => {
        const id = running.current;
        if (id) void workspaceRequest<WorkspaceRecord>(`analysis/${id}`, identity, undefined, 'DELETE').then(setResult).catch(() => undefined);
      }}>{t('agent_workbench.stop')}</button>
    </div>
    {result && <><p role="status">{t(`agent_workbench.native_status.${workspaceText(result, 'status')}`, t('agent_workbench.native_status.unknown'))}</p><pre className="agent-workspace__output">{workspaceText(result, 'output')}</pre></>}
    {workspace.analyses.flatMap(run => (Array.isArray(run.artifacts) ? run.artifacts as WorkspaceRecord[] : []).map(artifact => {
      const name = workspaceText(artifact, 'name');
      const selected = inputs.some(item => item.identity === run.id && item.name === name);
      return <div key={`${run.id}:${name}`}>
        <button type="button" className="btn-gnosi btn-gnosi-secondary" disabled={workspace.busy} onClick={() => {
          void workspace.perform(() => downloadWorkspaceArtifact(identity, run.id, name, Number(artifact.size), workspaceText(artifact, 'sha256')));
        }}>{t('agent_workbench.download')} · {name}</button>
        <GnosiToggle active={selected} disabled={workspace.busy} label={t('agent_workbench.reuse_input')} onChange={() => {
          attempt.current = null;
          setInputs(current => selected ? current.filter(item => !(item.identity === run.id && item.name === name)) : [...current, { identity: run.id, name }]);
        }} />
      </div>;
    }))}
  </section>;
}
