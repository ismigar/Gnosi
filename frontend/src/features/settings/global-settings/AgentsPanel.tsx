import { detachBotModels } from '../model-comparison/detachBotModels';
import { modelDisplayName } from '../../../shared/ai/modelDisplayName';
import { TEAM_SKILL, changeTeamPrincipal } from '../../../shared/ai/agentTeams';
import { AgentTeamSetup } from './AgentTeamSetup';
import { AgentModelRecommendation } from './AgentModelRecommendation';
import { AIAgentForm } from './AIAgentForm';
import { Bot, Clock3 } from 'lucide-react';
import { IconRenderer } from '../../../shared/ui/previews/IconRenderer';
import { InlineEditorPlacement } from '../../../shared/ui/settings/SettingsPrimitives';
import { Plus } from 'lucide-react';
import React from 'react';
import { isSuspendedPluginProfile, principalAssistant, profileDisplayName } from '../../../shared/ai/assistantProfiles';
import { Section } from '../../../shared/ui/settings/SettingsPrimitives';
import { Settings as SettingsIcon } from 'lucide-react';
import { Trash2 } from 'lucide-react';
import { X } from 'lucide-react';
import { toast } from '../../../shared/notifications/toast';
import type { AgentDraft, SettingsAgent } from './types';
import type { SettingsController } from './useGlobalSettingsController';

type Props = { focusedProfileId?: string; onOpenActivity?: () => void; onSelectSkill?: (id: string) => void; context: Pick<SettingsController, 'agentEditorTarget' | 'aiRegistry' | 'aiResources' | 'draft' | 'editingAgent' | 'handleDeleteAIAgent' | 'setAgentEditorTarget' | 'setDraft' | 'setEditingAgent' | 't' | 'tn'> };

function mergeProfile(current: SettingsAgent, updated: AgentDraft): SettingsAgent {
  return { ...current, ...updated, id: current.id, enabled: true, team: current.team,
    ...(current.team?.enabled && current.team.director_id === current.id
      ? { skill_ids: [...new Set([...(updated.skill_ids ?? current.skill_ids ?? []), TEAM_SKILL])] } : {}),
  };
}

export function AgentsPanel({ context, onSelectSkill, onOpenActivity, focusedProfileId }: Props) {
  const { agentEditorTarget, aiRegistry, aiResources, draft, editingAgent, handleDeleteAIAgent, setAgentEditorTarget, setDraft, setEditingAgent, t } = context;
  const principal = principalAssistant(draft.ai.agents, draft.ai.active_agent_id);
  const teamListKey = JSON.stringify([principal?.id, draft.ai.agents.filter(isSuspendedPluginProfile).map(agent => agent.id).sort()]);
  const editor = editingAgent && !isSuspendedPluginProfile(editingAgent) && (
    <InlineEditorPlacement
      target={editingAgent.id ? agentEditorTarget : null}
      waitForTarget={Boolean(editingAgent.id)}
    >
      <div data-settings-editor-for={editingAgent.id ? `agent:${editingAgent.id}` : 'agent:new'}>
        <AIAgentForm
          key={editingAgent.id || 'new-agent'}
          agent={editingAgent}
          bots={draft.ai.agents} principalId={principal?.id}
          onAssignOtherBot={(id, provider, model) => { setDraft(prev => ({ ...prev, ai: { ...prev.ai, agents: prev.ai.agents.map(bot => bot.id === id ? { ...bot, provider, model, reasoning_effort: null, model_strategy: { schema_version: 1, mode: 'pinned', decision_engine: 'rules', allowed_models: [] } } : bot) } })); }}
          otherCommands={draft.ai.agents.filter(item => item.id !== editingAgent.id).map(item => item.command || '')}
          purpose={!principal || editingAgent.id === principal.id ? 'principal' : 'profile'}
          onChange={updated => {
            setEditingAgent(current => current?.id === updated.id ? updated : current);
            setDraft(prev => ({ ...prev, ai: { ...prev.ai,
              agents: prev.ai.agents.map(item => item.id === updated.id ? mergeProfile(item, updated) : item),
            } }));
          }}
          onSave={async (newAgent) => {
            const isNew = !newAgent.id;
            const id = newAgent.id || `agent_${String(Date.now())}`;
            const currentAgent = draft.ai.agents.find(item => item.id === id);
            const agentToSave = currentAgent ? mergeProfile(currentAgent, newAgent) : { ...newAgent, id, enabled: true };
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
                active_agent_id: principalAssistant(prev.ai.agents, prev.ai.active_agent_id)?.id || (newAgent.managed_by ? '' : id),
                agents: isNew
                  ? [...prev.ai.agents, agentToSave]
                  : prev.ai.agents.map(a => a.id === id ? mergeProfile(a, agentToSave) : a)
              }
            }));
            setEditingAgent(null);
          }}
          onModelsDetached={routes => { setDraft(prev => ({ ...prev, ai: { ...prev.ai, agents: prev.ai.agents.map(bot => detachBotModels(bot, routes)) } })); }}
          aiRegistry={aiRegistry}
          skills={aiResources.skills}
          tools={aiResources.tools}
          onSelectSkill={onSelectSkill}
        />
      </div>
    </InlineEditorPlacement>
  );
  const renderProfile = (agent: SettingsAgent, participation?: React.ReactNode) => (
    <React.Fragment key={agent.id}>
      <div
        className={`settings-configurable-item ai-agent-row hover-scale ${editingAgent?.id === agent.id ? 'is-editing' : ''}`}
        data-settings-item-id={`agent:${agent.id}`}
        onClick={() => { setEditingAgent(current => current?.id === agent.id ? null : agent); }}
        title={t('settings.ai.assistant.configure_profile', { name: profileDisplayName(agent, t) })}
        style={{
          width: '100%', padding: '24px', border: participation ? 'none' : '1px solid var(--settings-border)',
          background: 'var(--settings-sidebar-bg)', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: '20px', flexWrap: 'wrap', transition: 'all 0.2s', cursor: 'pointer', boxSizing: 'border-box'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', minWidth: 0 }}>
          <div
            aria-hidden="true"
            style={{
              width: '46px', height: '46px', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: '50%',
              background: 'var(--gnosi-primary)',
              color: '#fff',
              filter: 'drop-shadow(0 5px 10px rgba(0,0,0,0.1))'
            }}
          >
            <IconRenderer
              icon={agent.icon === 'Bot' ? 'lucide:Bot:default' : agent.icon || 'lucide:Bot:default'}
              size={26}
              color="#fff"
            />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: '900', fontSize: '1.1rem', color: 'var(--text-primary)' }}>{profileDisplayName(agent, t)}</div>
            <strong>{t(agent.id === principal?.id ? 'settings.ai.assistant.principal_profile' : agent.managed_by ? 'settings.ai.assistant.plugin_profile' : 'settings.ai.assistant.additional_profile')}</strong>
            {agent.managed_by && <p className="settings-desc">{t('settings.ai.assistant.plugin_owner', { name: t(`settings.plugins.catalog.${agent.managed_by.replace(/^(builtin:|plugin:)/, '')}.name`, { defaultValue: agent.managed_by.replace(/^(builtin:|plugin:)/, '') }) })}</p>}
            {agent.id === principal?.id && agent.enabled === false && <p role="status">{t('settings.ai.assistant.restore_help')}</p>}
            <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{modelDisplayName(aiRegistry.find(row => row.provider === agent.provider && row.model_id === agent.model)) || agent.model}</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginTop: '5px' }}>
              {t('settings.ai.resources.assigned_skill_count', { count: (agent.skill_ids || []).length })}
            </div>
            <AgentModelRecommendation agent={agent} principalId={principal?.id ?? ''} team={principal?.team} skills={aiResources.skills} />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', gap: '14px', marginLeft: 'auto' }}>
          {(agent.id !== principal?.id || agent.enabled === false) && <button type="button" className="btn-gnosi btn-gnosi-secondary" disabled={agent.plugin_suspended || agent.managed_by === 'llm-wiki'} aria-label={t('settings.ai.assistant.make_principal_for', { name: profileDisplayName(agent, t) })} onClick={event => {
            event.stopPropagation();
            setDraft(prev => ({ ...prev, ai: { ...prev.ai, active_agent_id: agent.id,
              agents: changeTeamPrincipal(prev.ai.agents, agent.id, principalAssistant(prev.ai.agents, prev.ai.active_agent_id)?.id ?? ''),
            } }));
          }}>{t('settings.ai.assistant.make_principal')}</button>}
          <button type="button" onClick={(event) => { event.stopPropagation(); setEditingAgent(current => current?.id === agent.id ? null : agent); }} aria-expanded={editingAgent?.id === agent.id} aria-label={t('settings.ai.assistant.configure_profile', { name: profileDisplayName(agent, t) })} title={t('settings.ai.assistant.configure_profile', { name: profileDisplayName(agent, t) })} className="icon-btn hover-bg-strong" style={{ padding: '14px', borderRadius: '16px' }}>
            <SettingsIcon size={22} />
          </button>
          {agent.id !== principal?.id && !agent.managed_by && <button type="button" onClick={(event) => { event.stopPropagation(); handleDeleteAIAgent(agent); }} aria-label={t('settings.ai.assistant.delete_profile', { name: profileDisplayName(agent, t) })} title={t('settings.ai.assistant.delete_profile', { name: profileDisplayName(agent, t) })} className="icon-btn hover-bg-strong" style={{ padding: '14px', borderRadius: '16px', color: 'var(--status-error)' }}>
            <Trash2 size={22} />
          </button>}
        </div>
      </div>
      {participation}
      {editingAgent?.id === agent.id && (
        <div
          ref={setAgentEditorTarget}
          data-settings-editor-anchor-for={`agent:${agent.id}`}
        />
      )}
    </React.Fragment>
  );
  if (focusedProfileId) {
    const selected = draft.ai.agents.find(agent => agent.id === focusedProfileId);
    return <Section title={selected ? profileDisplayName(selected, t) : t('settings.ai.assistant.profile')} icon={Bot}>
      {selected && (isSuspendedPluginProfile(selected) ? <p role="status">{t('settings.ai.assistant.plugin_suspended')}</p> : renderProfile(selected))}
      {selected && !isSuspendedPluginProfile(selected) && editor}
    </Section>;
  }
  return (<Section
    title={t('settings.ai.assistant.title')}
    icon={Bot}
    extra={editingAgent && <button type="button" className="btn-gnosi btn-gnosi-secondary" onClick={() => { setEditingAgent(null); }}>
      <X size={16} />{t(editingAgent.id ? 'common.close' : 'common.cancel')}
    </button>}
  >
    <p style={{ color: 'var(--text-secondary)', margin: '0 0 16px' }}>{t('settings.ai.assistant.help')}</p>
    <p className="settings-desc">{t('settings.ai.assistant.principal_help')}</p>
    <p className="settings-desc">{t('settings.ai.assistant.recommendation_help')}</p>
    {principal && isSuspendedPluginProfile(principal) && <p role="status">{t('settings.ai.assistant.principal_plugin_suspended', { name: profileDisplayName(principal, t) })}</p>}
    {(!editingAgent || editingAgent.id) && <div style={{ display: 'flex', justifyContent: 'flex-end', marginBlock: '16px' }}>
      <button type="button" className="btn-gnosi btn-gnosi-primary" onClick={() => { setAgentEditorTarget(null); setEditingAgent({}); }}>
        <Plus size={16} />{t(draft.ai.agents.length ? 'settings.ai.assistant.create_profile' : 'settings.ai.assistant.setup')}
      </button>
    </div>}
    {editor}
    {draft.ai.agents.length > 0 && <AgentTeamSetup key={teamListKey} agents={draft.ai.agents} principalId={principal?.id ?? ''} registry={aiRegistry} skillCatalog={aiResources.skills}
      renderAgent={renderProfile} onChange={(agents, principalId) => {
        setDraft(prev => ({ ...prev, ai: { ...prev.ai, agents, active_agent_id: principalId } }));
      }} />}
    {onOpenActivity && <div style={{ marginTop: '24px' }}>
      <button type="button" className="btn-gnosi btn-gnosi-secondary" onClick={onOpenActivity}>
        <Clock3 size={16} />{t('activity.open_activity')}
      </button>
    </div>}
  </Section>);
}
