import { modelDisplayName } from '../../../shared/ai/modelDisplayName';
import { configurableGap } from './settingsStyles';
import { AIAgentForm } from './AIAgentForm';
import { Bot, Clock3 } from 'lucide-react';
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
import type { SettingsAgent } from './types';
import type { SettingsController } from './useGlobalSettingsController';

type Props = { focusedProfileId?: string; onOpenActivity?: () => void; onSelectSkill?: (id: string) => void; context: Pick<SettingsController, 'agentEditorTarget' | 'aiRegistry' | 'aiResources' | 'draft' | 'editingAgent' | 'handleDeleteAIAgent' | 'setAgentEditorTarget' | 'setDraft' | 'setEditingAgent' | 't' | 'tn'> };

export function AgentsPanel({ context, onSelectSkill, onOpenActivity, focusedProfileId }: Props) {
  const { agentEditorTarget, aiRegistry, aiResources, draft, editingAgent, handleDeleteAIAgent, setAgentEditorTarget, setDraft, setEditingAgent, t } = context;
  const principal = principalAssistant(draft.ai.agents, draft.ai.active_agent_id);
  const [showProfiles, setShowProfiles] = useState(false);
  const expanded = showProfiles || Boolean(principal && editingAgent && !editingAgent.managed_by && editingAgent.id !== principal.id);
  const editor = editingAgent && (
    <InlineEditorPlacement
      target={editingAgent.id ? agentEditorTarget : null}
      waitForTarget={Boolean(editingAgent.id)}
    >
      <div data-settings-editor-for={editingAgent.id ? `agent:${editingAgent.id}` : 'agent:new'}>
        <AIAgentForm
          key={editingAgent.id || 'new-agent'}
          agent={editingAgent}
          purpose={!editingAgent.managed_by && (!principal || editingAgent.id === principal.id) ? 'principal' : 'profile'}
          onChange={updated => {
            setDraft(prev => ({ ...prev, ai: { ...prev.ai,
              agents: prev.ai.agents.map(item => item.id === updated.id ? { ...item, ...updated, enabled: true } : item),
            } }));
          }}
          onSave={async (newAgent) => {
            const isNew = !newAgent.id;
            const id = newAgent.id || `agent_${String(Date.now())}`;
            const agentToSave = { ...newAgent, id, enabled: true };
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
                  : prev.ai.agents.map(a => a.id === id ? agentToSave : a)
              }
            }));
            setEditingAgent(null);
          }}
          aiRegistry={aiRegistry}
          skills={aiResources.skills}
          tools={aiResources.tools}
          onSelectSkill={onSelectSkill}
        />
      </div>
    </InlineEditorPlacement>
  );
  const renderProfile = (agent: SettingsAgent) => (
    <React.Fragment key={agent.id}>
      <div
        className={`settings-configurable-item ai-agent-row hover-scale ${editingAgent?.id === agent.id ? 'is-editing' : ''}`}
        data-settings-item-id={`agent:${agent.id}`}
        onClick={() => { setEditingAgent(current => current?.id === agent.id ? null : agent); }}
        title={t('settings.ai.assistant.configure_profile', { name: profileDisplayName(agent, t) })}
        style={{
          width: '100%', padding: '24px', border: '1px solid var(--settings-border)',
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
            <strong>{t(agent.managed_by ? 'settings.ai.assistant.plugin_profile' : agent.id === principal?.id ? 'settings.ai.assistant.principal_profile' : 'settings.ai.assistant.additional_profile')}</strong>
            {agent.managed_by && <p className="settings-desc">{t('settings.ai.assistant.plugin_owner', { name: t(`settings.plugins.catalog.${agent.managed_by.replace(/^(builtin:|plugin:)/, '')}.name`, { defaultValue: agent.managed_by.replace(/^(builtin:|plugin:)/, '') }) })}</p>}
            {agent.plugin_suspended && <p role="status">{t('settings.ai.assistant.plugin_suspended')}</p>}
            {agent.id === principal?.id && agent.enabled === false && <p role="status">{t('settings.ai.assistant.restore_help')}</p>}
            <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{modelDisplayName(aiRegistry.find(row => row.provider === agent.provider && row.model_id === agent.model)) || agent.model}</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginTop: '5px' }}>
              {t('settings.ai.resources.assigned_skill_count', { count: (agent.skill_ids || []).length })}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', gap: '14px', marginLeft: 'auto' }}>
          {(agent.id !== principal?.id || agent.enabled === false) && !agent.managed_by && <button type="button" className="btn-gnosi btn-gnosi-secondary" onClick={event => {
            event.stopPropagation();
            setDraft(prev => ({ ...prev, ai: { ...prev.ai, active_agent_id: agent.id,
              agents: prev.ai.agents.map(item => item.id === agent.id ? { ...item, enabled: true } : item),
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
      {selected && renderProfile(selected)}
      {editor}
    </Section>;
  }
  return (<Section
    title={t('settings.ai.assistant.title')}
    icon={Bot}
    extra={principal && editingAgent && <button type="button" className="btn-gnosi btn-gnosi-secondary" onClick={() => { setEditingAgent(null); }}>
      <X size={16} />{t(editingAgent.id ? 'common.close' : 'common.cancel')}
    </button>}
  >
    <p style={{ color: 'var(--text-secondary)', margin: '0 0 16px' }}>{t('settings.ai.assistant.help')}</p>
    {!principal && <div style={{ display: 'flex', justifyContent: 'flex-end', marginBlock: '16px' }}>
      <button type="button" className="btn-gnosi btn-gnosi-primary" onClick={() => { setAgentEditorTarget(null); setEditingAgent(current => current ? null : {}); }}>
        {editingAgent ? <X size={16} /> : <Plus size={16} />}
        {editingAgent ? t('common.cancel') : t('settings.ai.assistant.setup')}
      </button>
    </div>}
    {(!principal || editingAgent?.id) && editor}
    {principal && <div className="settings-configurable-list ai-agent-list" style={configurableGap('20px')}>
      {renderProfile(principal)}
    </div>}
    {principal && <p className="settings-desc" style={{ marginTop: '20px' }}>{t('settings.ai.assistant.principal_help')}</p>}
    {draft.ai.agents.length > 0 && <button type="button" className="btn-gnosi btn-gnosi-secondary" style={{ marginBlock: '16px' }} aria-expanded={expanded} onClick={() => { setShowProfiles(!expanded); if (expanded && editingAgent?.id !== principal?.id) setEditingAgent(null); }}>
      {t('settings.ai.assistant.advanced')}
    </button>}
    {expanded && <div className="ai-resources-panel">
      <p>{t('settings.ai.assistant.profiles_help')}</p>
      {principal && (!editingAgent || editingAgent.id) && <div style={{ marginBottom: '20px' }}>
        <button type="button" className="btn-gnosi btn-gnosi-primary" onClick={() => {
          setAgentEditorTarget(null);
          setEditingAgent({});
        }}>
          <Plus size={16} aria-hidden="true" />
          {t('settings.ai.assistant.create_profile')}
        </button>
      </div>}
    </div>}
    {principal && !editingAgent?.id && editor}
    {expanded && <div className="settings-configurable-list ai-agent-list" style={configurableGap('20px')}>
      {draft.ai.agents.filter(agent => !agent.managed_by && agent.id !== principal?.id).map(renderProfile)}
    </div>}
    {draft.ai.agents.some(agent => agent.managed_by) && <section aria-label={t('settings.ai.assistant.plugin_profiles')}>
      <h4>{t('settings.ai.assistant.plugin_profiles')}</h4>
      <p className="settings-desc">{t('settings.ai.assistant.plugin_profiles_help')}</p>
      <div className="settings-configurable-list ai-agent-list" style={configurableGap('20px')}>
        {draft.ai.agents.filter(agent => agent.managed_by).map(renderProfile)}
      </div>
    </section>}
    {onOpenActivity && <div style={{ marginTop: '24px' }}>
      <button type="button" className="btn-gnosi btn-gnosi-secondary" onClick={onOpenActivity}>
        <Clock3 size={16} />{t('activity.open_activity')}
      </button>
    </div>}
  </Section>);
}
