import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshButton } from '../../shared/ui/actions/RefreshButton';
import { useAgentWorkspace } from './useAgentWorkspace';
import { useVoiceConversation } from './useVoiceConversation';
import { WorkspaceFiles } from './WorkspaceFiles';
import { WorkspaceDocument } from './WorkspaceDocument';
import { WorkspaceAnalysis } from './WorkspaceAnalysis';
import { WorkspaceNative } from './WorkspaceNative';
import { SpeechSettings } from '../../shared/speech/SpeechSettings';
import './workspace.css';

interface Props {
  readonly agentId: string; readonly sessionId: string; readonly scopeKey: string;
  readonly readOnly: boolean; readonly onPrompt: (text: string) => void;
  readonly onVoicePrompt: (text: string) => void; readonly latestAssistantReply: string;
  readonly isAgentBusy: boolean;
  readonly latestAssistantReplyId?: string;
}

export function AgentWorkspacePanel(props: Props) {
  if (props.readOnly || !props.agentId || !props.sessionId) return null;
  return <WorkspaceContent key={`${props.scopeKey}:${props.agentId}:${props.sessionId}`} {...props} />;
}

function WorkspaceContent({ agentId, sessionId, onVoicePrompt, latestAssistantReply, latestAssistantReplyId, isAgentBusy }: Props) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('files');
  const identity = useMemo(() => ({ agent_id: agentId, session_id: sessionId }), [agentId, sessionId]);
  const workspace = useAgentWorkspace(identity, open);
  const voice = useVoiceConversation(identity, i18n.language, isAgentBusy, latestAssistantReply, onVoicePrompt, latestAssistantReplyId);
  const stopVoice = voice.stop;
  useEffect(() => { if (!open || tab !== 'voice') stopVoice(); }, [open, tab, stopVoice]);
  return <details className="agent-workspace" open={open} onToggle={event => { setOpen(event.currentTarget.open); }}>
    <summary>{t('agent_workbench.title')}{voice.active ? ` · ${t(voice.output.activity === 'preparing' ? 'speech.preparing' : voice.output.activity === 'speaking' ? 'speech.speaking' : isAgentBusy ? 'agent_workbench.voice_waiting' : 'agent_workbench.voice_active')}` : ''}</summary>
    <div className="agent-workspace__body">
      <div className="agent-workspace__actions">
        <label>{t('agent_workbench.section')}<select className="gnosi-select" value={tab} onChange={event => { setTab(event.target.value); }}>
          {['files', 'document', 'analysis', 'native', 'voice'].map(value => <option key={value} value={value}>{t(`agent_workbench.tabs.${value}`)}</option>)}
        </select></label>
        <RefreshButton disabled={workspace.busy} onClick={() => { void workspace.perform(() => workspace.reload()); }} />
      </div>
      {workspace.error && <p role="alert">{workspace.error}</p>}
      <div hidden={tab !== 'files'}><WorkspaceFiles identity={identity} workspace={workspace} /></div>
      <div hidden={tab !== 'document'}><WorkspaceDocument identity={identity} workspace={workspace} /></div>
      <div hidden={tab !== 'analysis'}><WorkspaceAnalysis identity={identity} workspace={workspace} /></div>
      <div hidden={tab !== 'native'}><WorkspaceNative workspace={workspace} /></div>
      {tab === 'voice' && <section className="agent-workspace__section">
        <p>{t(voice.supported ? 'agent_workbench.voice_help' : 'agent_workbench.voice_unavailable')}</p>
        <button type="button" className="btn-gnosi btn-gnosi-secondary" disabled={!voice.supported} onClick={voice.toggle}>
          {t(voice.active ? 'agent_workbench.stop_voice' : 'agent_workbench.start_voice')}
        </button>
        {voice.failed && <p role="alert">{t('agent_workbench.voice_failed')}</p>}
        {(voice.active || voice.output.state !== 'idle') && <p role="status">{t(voice.output.activity === 'preparing' ? 'speech.preparing' : voice.output.activity === 'speaking' ? 'speech.speaking' : isAgentBusy ? 'agent_workbench.voice_waiting' : 'agent_workbench.voice_active')}</p>}
        {voice.output.error && <p role="alert">{t('speech.failed')}</p>}
        <SpeechSettings previewDisabled={voice.active} />
      </section>}
    </div>
  </details>;
}
