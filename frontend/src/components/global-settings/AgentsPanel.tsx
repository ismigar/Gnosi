import { configurableGap } from './settingsStyles';
import { AIAgentForm } from './AIAgentForm';
import { Bot } from 'lucide-react';
import { GnosiToggle } from './SettingsPrimitives';
import { IconRenderer } from '../Vault/IconRenderer';
import { InlineEditorPlacement } from './SettingsPrimitives';
import { Plus } from 'lucide-react';
import React from 'react';
import { Section } from './SettingsPrimitives';
import { Settings as SettingsIcon } from 'lucide-react';
import { Trash2 } from 'lucide-react';
import { X } from 'lucide-react';
import { toast } from '../../lib/toast';
import type { SettingsController } from './useGlobalSettingsController';

type Props = { context: Pick<SettingsController, 'agentEditorTarget' | 'aiRegistry' | 'aiResources' | 'draft' | 'editingAgent' | 'handleDeleteAIAgent' | 'setAgentEditorTarget' | 'setDraft' | 'setEditingAgent' | 't' | 'tn'> };

export function AgentsPanel({ context }: Props) {
  const { agentEditorTarget, aiRegistry, aiResources, draft, editingAgent, handleDeleteAIAgent, setAgentEditorTarget, setDraft, setEditingAgent, t, tn } = context;
  return (<Section
    title={tn('ai.agents_section')}
    icon={Bot}
    extra={
      <button
        className="btn-gnosi btn-gnosi-primary"
        onClick={() => { setEditingAgent(current => current ? null : {}); }}
        style={{
          padding: '10px 20px', fontSize: '0.85rem', borderRadius: '14px',
          display: 'flex', alignItems: 'center', gap: '10px'
        }}
      >
        {editingAgent ? <X size={16} /> : <Plus size={16} />}
        {editingAgent ? t('common.cancel') : tn('ai.create_agent_btn')}
      </button>
    }
  >
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
          />
        </div>
      </InlineEditorPlacement>
    )}
    <div className="settings-configurable-list ai-agent-list" style={{ ...configurableGap('20px') }}>
      {draft.ai.agents.map(agent => (
        <React.Fragment key={agent.id}>
          <div
            className={`settings-configurable-item ai-agent-row hover-scale ${editingAgent?.id === agent.id ? 'is-editing' : ''}`}
            data-settings-item-id={`agent:${agent.id}`}
            onClick={() => { setEditingAgent(agent); }}
            title={tn('ai.configure_name', { name: agent.name })}
            style={{
              width: '100%', padding: '24px', border: '1px solid var(--settings-border)',
              background: 'var(--settings-sidebar-bg)', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: '20px', transition: 'all 0.2s', cursor: 'pointer', boxSizing: 'border-box',
              opacity: agent.enabled ? 1 : 0.6
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '20px', minWidth: 0 }}>
              <div onClick={event => { event.stopPropagation(); }}>
                <GnosiToggle
                  active={agent.enabled}
                  label={tn('ai.enable_agent', { name: agent.name })}
                  scale={1.1}
                  style={{ marginRight: '10px' }}
                  onChange={() => {
                    const newList = draft.ai.agents.map(item => item.id === agent.id ? { ...item, enabled: !item.enabled } : item);
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
                <div style={{ fontWeight: '900', fontSize: '1.1rem', color: 'var(--text-primary)' }}>{agent.name}</div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{agent.model}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginTop: '5px' }}>
                  {t('settings.ai.resources.assigned_skill_count', { count: (agent.skill_ids || []).length })}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexShrink: 0 }}>
              <button type="button" onClick={(event) => { event.stopPropagation(); setEditingAgent(agent); }} aria-label={tn('ai.configure_name', { name: agent.name })} title={tn('ai.configure_name', { name: agent.name })} className="icon-btn hover-bg-strong" style={{ padding: '14px', borderRadius: '16px' }}>
                <SettingsIcon size={22} />
              </button>
              <button type="button" onClick={(event) => { event.stopPropagation(); handleDeleteAIAgent(agent); }} aria-label={tn('ai.delete_name', { name: agent.name })} title={tn('ai.delete_name', { name: agent.name })} className="icon-btn hover-bg-strong" style={{ padding: '14px', borderRadius: '16px', color: 'var(--status-error)' }}>
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
      ))}
    </div>
  </Section>);
}
