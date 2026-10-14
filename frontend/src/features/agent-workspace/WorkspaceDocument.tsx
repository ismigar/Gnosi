import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { workspaceRequest, type WorkspaceIdentity, type WorkspaceRecord } from '../../shared/api/agent-workspace';
import { fetchVaultPages, type VaultPageSummary } from '../../shared/api/vaults';
import { workspaceText, type useAgentWorkspace } from './useAgentWorkspace';

interface Props { readonly identity: WorkspaceIdentity; readonly workspace: ReturnType<typeof useAgentWorkspace> }

export function WorkspaceDocument({ identity, workspace }: Props) {
  const { t } = useTranslation();
  const [pageId, setPageId] = useState('');
  const [pages, setPages] = useState<VaultPageSummary[]>([]);
  const [session, setSession] = useState<WorkspaceRecord | null>(null);
  const [content, setContent] = useState('');
  const [preview, setPreview] = useState<{ result: WorkspaceRecord; content: string; sessionId: string } | null>(null);
  const previewVersion = useRef(0);
  const [result, setResult] = useState('');
  const attempt = useRef<{ content: string; id: string } | null>(null);
  return <section className="agent-workspace__section">
    <label>{t('agent_workbench.history')}<select className="gnosi-select" value={workspaceText(session, 'id')} onChange={event => {
      const id = event.target.value;
      if (id) void workspace.perform(async () => {
        const capture = await workspaceRequest<WorkspaceRecord>(`documents/${encodeURIComponent(id)}`, identity);
        previewVersion.current++; setSession(capture); setContent(workspaceText(capture, 'content')); setPageId(workspaceText(capture, 'page_id')); setPreview(null); setResult(''); attempt.current = null;
      });
    }}><option value="">{t('agent_workbench.open_document')}</option>
      {workspace.documents.map(item => <option key={item.id} value={item.id}>{workspaceText(item, 'title')}</option>)}
    </select></label>
    <button type="button" className="btn-gnosi btn-gnosi-secondary" disabled={workspace.busy} onClick={() => {
      void workspace.perform(async () => { setPages(await fetchVaultPages({ limit: 200 })); });
    }}>{t('agent_workbench.choose_page')}</button>
    <label>{t('agent_workbench.page')}<select className="gnosi-select" value={pageId} onChange={event => { setPageId(event.target.value); }}>
      <option value="">{t('agent_workbench.choose_page')}</option>
      {pages.map(page => <option key={page.id} value={page.id}>{page.title}</option>)}
    </select></label>
    <button type="button" className="btn-gnosi btn-gnosi-secondary" disabled={!pageId || workspace.busy} onClick={() => {
      void workspace.perform(async () => {
        const capture = await workspaceRequest<WorkspaceRecord>('documents', identity, { page_id: pageId });
        previewVersion.current++; setSession(capture); setContent(workspaceText(capture, 'content')); setPreview(null); setResult(''); attempt.current = null; await workspace.reload();
      });
    }}>{t('agent_workbench.open_document')}</button>
    {session && <>
      <strong>{workspaceText(session, 'title')}</strong>
      <label>{t('agent_workbench.document_content')}<textarea className="gnosi-input" rows={8} value={content} onChange={event => {
        previewVersion.current++; setContent(event.target.value); setPreview(null); setResult(''); attempt.current = null;
      }} /></label>
      <button type="button" className="btn-gnosi btn-gnosi-secondary" disabled={workspace.busy} onClick={() => {
        void workspace.perform(async () => {
          const version = ++previewVersion.current;
          const sessionId = workspaceText(session, 'id');
          const result = await workspaceRequest<WorkspaceRecord>(`documents/${sessionId}/preview`, identity, { content });
          if (version === previewVersion.current) setPreview({ result, content, sessionId });
        });
      }}>{t('agent_workbench.review_changes')}</button>
      {preview && <><pre className="agent-workspace__output">{workspaceText(preview.result, 'diff') || t('agent_workbench.no_changes')}</pre>
        {Boolean(preview.result.truncated) && <p>{t('agent_workbench.preview_truncated')}</p>}
        <button type="button" className="btn-gnosi btn-gnosi-primary" disabled={workspace.busy || preview.content !== content || preview.sessionId !== workspaceText(session, 'id')} onClick={() => {
          void workspace.perform(async () => {
            if (preview.content !== content || preview.sessionId !== workspaceText(session, 'id')) return;
            if (!attempt.current || attempt.current.content !== content) attempt.current = { content, id: crypto.randomUUID() };
            const outcome = await workspaceRequest<WorkspaceRecord>(`documents/${workspaceText(session, 'id')}/apply`, identity,
              { content: preview.content, request_id: attempt.current.id });
            setResult(workspaceText(outcome, 'status'));
          });
        }}>{t('agent_workbench.apply_changes')}</button></>}
      {result && <p role="status">{t(`agent_workbench.document_status.${result}`, t('agent_workbench.document_status.unknown'))}</p>}
    </>}
  </section>;
}
