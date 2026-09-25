import { configurableGap } from './settingsStyles';
import { AIAgentForm } from './AIAgentForm';
import { Bot, Clock3 } from 'lucide-react';
import { GnosiToggle } from '../../../shared/ui/settings/SettingsPrimitives';
import { IconRenderer } from '../../../shared/ui/previews/IconRenderer';
import { InlineEditorPlacement } from '../../../shared/ui/settings/SettingsPrimitives';
import { Plus } from 'lucide-react';
import React, { useState } from 'react';
import { principalAssistant, profileDisplayName } from '../../../shared/ai/assistantProfiles';
import { Section } from '../../../shared/ui/settings/SettingsPrimitives';
import { Settings as SettingsIcon } from 'lucide-react';
import { Trash2 } from 'lucide-react';
import { X } from 'lucide-react';
import { toast } from '../../../shared/notifications/toast';
import type { SettingsController } from './useGlobalSettingsController';

type Props = { onOpenActivity?: () => void; onSelectSkill?: (id: string) => void; context: Pick<SettingsController, 'agentEditorTarget' | 'aiRegistry' | 'aiResources' | 'draft' | 'editingAgent' | 'handleDeleteAIAgent' | 'setAgentEditorTarget' | 'setDraft' | 'setEditingAgent' | 't' | 'tn'> };

export function AgentsPanel({ context, onSelectSkill, onOpenActivity }: Props) {
  const { agentEditorTarget, aiRegistry, aiResources, draft, editingAgent, handleDeleteAIAgent, setAgentEditorTarget, setDraft, setEditingAgent, t, tn } = context;
  const principal = principalAssistant(draft.ai.agents, draft.ai.active_agent_id);
  const jevProvider = draft.ai.providers.typesafe as { has_api_key?: boolean; enabled?: boolean } | undefined;
  const [showProfiles, setShowProfiles] = useState(false);
  const expanded = showProfiles || Boolean(editingAgent && editingAgent.id !== principal?.id);
  return (<Section
    title={t('settings.ai.assistant.title')}
    icon={Bot}
    extra={principal && editingAgent && <button type="button" className="btn-gnosi btn-gnosi-secondary" onClick={() => { setEditingAgent(null); }}>
      <X size={16} />{t('common.cancel')}
    </button>}
  >
    <p style={{ color: 'var(--text-secondary)', margin: '0 0 16px' }}>{t('settings.ai.assistant.help')}</p>
    {!principal && <div style={{ display: 'flex', justifyContent: 'flex-end', marginBlock: '16px' }}>
      <button type="button" className="btn-gnosi btn-gnosi-primary" style={{ backgroundColor: 'var(--gnosi-blue)' }} onClick={() => { setAgentEditorTarget(null); setEditingAgent(current => current ? null : {}); }}>
        {editingAgent ? <X size={16} /> : <Plus size={16} />}
        {editingAgent ? t('common.cancel') : t('settings.ai.assistant.setup')}
      </button>
    </div>}
    {principal && <button type="button" className="btn-gnosi btn-gnosi-secondary" style={{ marginBlock: '16px' }} aria-expanded={expanded} onClick={() => { setShowProfiles(!expanded); if (expanded && editingAgent?.id !== principal.id) setEditingAgent(null); }}>
      {t('settings.ai.assistant.advanced')}
    </button>}
    {principal && expanded && <div className="ai-resources-panel" style={{ marginBottom: '20px' }}>
      <p>{t('settings.ai.assistant.profiles_help')}</p>
      {(!editingAgent || editingAgent.id) && <div>
        <button type="button" className="btn-gnosi btn-gnosi-primary" style={{ backgroundColor: 'var(--gnosi-blue)' }} onClick={() => {
          setAgentEditorTarget(null);
          setEditingAgent({});
        }}>
          <Plus size={16} aria-hidden="true" />
          {t('settings.ai.assistant.create_profile')}
        </button>
      </div>}
    </div>}
    {editingAgent && (
      <InlineEditorPlacement
        target={editingAgent.id ? agentEditorTarget : null}
        waitForTarget={Boolean(editingAgent.id)}
      >
        <div data-settings-editor-for={editingAgent.id ? `agent:${editingAgent.id}` : 'agent:new'}>
          <AIAgentForm
            key={editingAgent.id || 'new-agent'}
            agent={editingAgent}
            onSave={async (newAgent) => {
              const isNew = !newAgent.id;
              const id = newAgent.id || `agent_${String(Date.now())}`;
              const agentToSave = { ...newAgent, id };
              const previousSkillIds = (
                draft.ai.agents.find(item => item.id === id)?.skill_ids || []
              );
              const nextSkillIds = agentToSave.skill_ids || [];
              const skillsChanged = (
                previousSkillIds.length !== nextSkillIds.length
                || previousSkillIds.some(skillId => !nextSkillIds.includes(skillId))
              );
              if (!isNew && skillsChanged) {
                try {
                  agentToSave.skill_ids = await aiResources.assignAgentSkills(
                    id,
                    nextSkillIds,
                  );
                } catch (error) {
                  console.error('Error assigning skills to AI agent:', error);
                  toast.error(t('settings.ai.resources.assignment_error'));
                  throw error;
                }
              }
              setDraft(prev => ({
                ...prev,
                ai: {
                  ...prev.ai,
                  active_agent_id: principal ? prev.ai.active_agent_id : id,
                  agents: isNew
                    ? [...prev.ai.agents, agentToSave]
                    : prev.ai.agents.map(a => a.id === id ? agentToSave : a)
                }
              }));
              setEditingAgent(null);
            }}
            aiRegistry={aiRegistry}
            skills={aiResources.skills}
            tools={aiResources.tools}
            jevConnected={jevProvider?.has_api_key === true && jevProvider.enabled !== false}
            onConnectJev={() => { setDraft(prev => ({ ...prev, ai: { ...prev.ai, providers: {
              ...prev.ai.providers,
              typesafe: { ...(prev.ai.providers.typesafe as Record<string, unknown> | undefined), has_api_key: true, enabled: true },
            } } })); }}
            onSelectSkill={onSelectSkill}
          />
        </div>
      </InlineEditorPlacement>
    )}
    <div className="settings-configurable-list ai-agent-list" style={{ ...configurableGap('20px') }}>
      {draft.ai.agents.filter(agent => expanded || agent.id === principal?.id).sort((a, b) => Number(b.id === principal?.id) - Number(a.id === principal?.id)).map(agent => {
        const displayName = profileDisplayName(agent, t);
        return (
        <React.Fragment key={agent.id}>
          <div
            className={`settings-configurable-item ai-agent-row hover-scale ${editingAgent?.id === agent.id ? 'is-editing' : ''}`}
            data-settings-item-id={`agent:${agent.id}`}
            onClick={() => { setEditingAgent(agent); }}
            title={tn('ai.configure_name', { name: displayName })}
            style={{
              width: '100%', padding: '24px', border: '1px solid var(--settings-border)',
              background: 'var(--settings-sidebar-bg)', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: '20px', transition: 'all 0.2s', cursor: 'pointer', boxSizing: 'border-box',
              opacity: agent.enabled !== false ? 1 : 0.6
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '20px', minWidth: 0 }}>
              <div onClick={event => { event.stopPropagation(); }}>
                <GnosiToggle
                  active={agent.enabled !== false}
                  display={agent.id === principal?.id && agent.enabled !== false}
                  label={tn('ai.enable_agent', { name: displayName })}
                  scale={1.1}
                  style={{ marginRight: '10px' }}
                  onChange={() => {
                    const newList = draft.ai.agents.map(item => item.id === agent.id ? { ...item, enabled: item.enabled === false } : item);
                    setDraft({ ...draft, ai: { ...draft.ai, agents: newList } });
                  }}
                />
              </div>
              <div
                aria-hidden="true"
                style={{
                  width: '46px', height: '46px', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  borderRadius: '50%',
                  background: 'var(--gnosi-blue)',
                  color: '#fff',
                  filter: 'drop-shadow(0 5px 10px rgba(0,0,0,0.1))'
                }}
              >
                <IconRenderer
                  icon={agent.icon || '🤖'}
                  size={26}
                  color="#fff"
                />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: '900', fontSize: '1.1rem', color: 'var(--text-primary)' }}>{displayName}</div>
                {agent.id === principal?.id && <strong>{t('settings.ai.assistant.principal')}</strong>}
                {agent.id !== principal?.id && <button type="button" className="btn-gnosi btn-gnosi-secondary" disabled={agent.enabled === false} onClick={event => { event.stopPropagation(); setDraft(prev => ({ ...prev, ai: { ...prev.ai, active_agent_id: agent.id } })); }}>{t('settings.ai.assistant.make_principal')}</button>}
                <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{agent.model}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginTop: '5px' }}>
                  {t('settings.ai.resources.assigned_skill_count', { count: (agent.skill_ids || []).length })}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexShrink: 0 }}>
              <button type="button" onClick={(event) => { event.stopPropagation(); setEditingAgent(agent); }} aria-label={tn('ai.configure_name', { name: displayName })} title={tn('ai.configure_name', { name: displayName })} className="icon-btn hover-bg-strong" style={{ padding: '14px', borderRadius: '16px' }}>
                <SettingsIcon size={22} />
              </button>
              <button type="button" disabled={agent.id === principal?.id || Boolean(agent.managed_by)} onClick={(event) => { event.stopPropagation(); handleDeleteAIAgent(agent); }} aria-label={tn('ai.delete_name', { name: displayName })} title={tn('ai.delete_name', { name: displayName })} className="icon-btn hover-bg-strong" style={{ padding: '14px', borderRadius: '16px', color: 'var(--status-error)' }}>
                <Trash2 size={22} />
              </button>
            </div>
          </div>
          {editingAgent?.id === agent.id && (
            <div
              ref={setAgentEditorTarget}
              data-settings-editor-anchor-for={`agent:${agent.id}`}
            />
          )}
        </React.Fragment>
      ); })}
    </div>
    {onOpenActivity && <div style={{ marginTop: '24px' }}>
      <button type="button" className="btn-gnosi btn-gnosi-secondary" onClick={onOpenActivity}>
        <Clock3 size={16} />{t('activity.open_activity')}
      </button>
    </div>}
  </Section>);
}
