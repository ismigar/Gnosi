import { modelDisplayName } from '../../../shared/ai/modelDisplayName';
import { profileDisplayName } from '../../../shared/ai/assistantProfiles';
import type { AgentDraft, SettingsModel } from './types';
import type { NormalizedSkill, NormalizedTool } from '../AI/aiSettingsUtils';
import { Activity } from 'lucide-react';
import AgentContextSources from '../../agent-context/AgentContextSources';
import { AgentIconSelect } from './AgentIconSelect';
import { AgentSkillsField } from '../AI/AIResourcesSettings';
import { FormGroup } from '../../../shared/ui/settings/SettingsPrimitives';
import { Loader2 } from 'lucide-react';
import { MODEL_FAULT_REASONS } from '../AI/modelReliability';
import { findModelFault } from '../AI/modelReliability';
import { useMemo } from 'react';
import { useModelReliability } from '../AI/modelReliability';
import { useState } from 'react';
import { AgentBehaviorInspection } from '../AI/AgentBehaviorInspection';
import { useTranslation } from 'react-i18next';

export function AIAgentForm({ agent, purpose = 'profile', onSave, onChange, aiRegistry, skills, tools, onSelectSkill }: { agent: AgentDraft; purpose?: 'principal' | 'profile'; onChange?: (agent: AgentDraft) => void; onSelectSkill?: (id: string) => void; onSave: (agent: AgentDraft) => Promise<void>; aiRegistry: SettingsModel[]; skills: NormalizedSkill[]; tools: NormalizedTool[] }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    ...agent, name: agent.name || '', provider: agent.provider || '', model: agent.model || '',
    icon: agent.icon === 'Bot' ? 'lucide:Bot:default' : agent.icon || 'lucide:Bot:default', persona: agent.persona || '', context: agent.context || '',
    context_refs: agent.context_refs || [], skill_ids: agent.skill_ids || [],
  });
  const { name, provider, model, icon, persona, context, context_refs: contextRefs, skill_ids: selectedSkillIds } = form;
  const [section, setSection] = useState('instructions');
  const migration = agent.behavior_migration && typeof agent.behavior_migration === 'object' ? agent.behavior_migration as Record<string, unknown> : undefined;
  const originalInstructions = typeof migration?.original === 'string' ? migration.original : '';
  const availableInstructions = typeof migration?.available_original === 'string' ? migration.available_original : originalInstructions;
  const [nameEdited, setNameEdited] = useState(false);
  const [savingAgent, setSavingAgent] = useState(false);
  const [saveError, setSaveError] = useState(false);

  // Keep provider/model identities independent from their visible aliases. Rows carry
  // {provider, model_id, ...}; we keep first-seen order of providers.
  const grouped = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const row of aiRegistry) {
      if (row.enabled !== true || !row.provider || !row.model_id) continue;
      if (!map.has(row.provider)) map.set(row.provider, []);
      map.get(row.provider)?.push(row.model_id);
    }
    return map;
  }, [aiRegistry]);
  const update = (patch: Partial<typeof form>) => {
    const next = { ...form, ...patch };
    setForm(next);
    if (agent.id && next.name.trim() && grouped.get(next.provider)?.includes(next.model)) {
      onChange?.({ ...next, model_strategy: { schema_version: 1, mode: 'pinned', decision_engine: 'rules', allowed_models: [] } });
    }
  };
  // Composite value for the single select: "provider||model". The "||" is
  // safe — neither provider ids nor model ids contain that pattern.
  const selectedKey = (provider && model) ? `${provider}||${model}` : '';
  const registryEmpty = grouped.size === 0;

  // Evidence about the chosen model, recorded from its own past failures.
  // Only reasons the backend attributes to the MODEL land here: a rate limit
  // or an exhausted account says nothing about the model itself.
  const reliability = useModelReliability();
  const modelFault = findModelFault(reliability, provider, model);
  const faultReason = Object.entries(MODEL_FAULT_REASONS).find(([reason]) => reason === modelFault?.top_model_reason)?.[1];

  return (
    <div className={`settings-inline-editor ai-agent-form animate-in ${agent.id ? 'is-attached' : 'is-create'}`}>
      {!agent.id && (
        <h3 className="ai-agent-form-title">{t(purpose === 'principal' ? 'settings.ai.assistant.setup' : 'settings.ai.assistant.new_profile')}</h3>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <FormGroup label={t('settings.ai.assistant.profile_name')}>
              <input type="text" className="gnosi-input" value={nameEdited ? name : profileDisplayName({ ...agent, name }, t)} onChange={e => { setNameEdited(true); update({ name: e.target.value }); }} placeholder={t('settings.ai.agent_name_placeholder')} />
            </FormGroup>
          </div>
          <div style={{ width: '72px' }}>
            <FormGroup label={t('settings.ai.icon_label')}>
              <AgentIconSelect
                value={icon}
                onChange={icon => { update({ icon }); }}
                label={t('settings.ai.icon_label')}
                searchPlaceholder={t('icon_picker.search_placeholder')}
                noResultsLabel={t('icon_picker.no_icons')}
              />
            </FormGroup>
          </div>
        </div>

        {/* Single grouped select: provider is derived from the
                            chosen model (registry rows are provider+model pairs).
                            Only enabled registry models are valid agent targets;
                            an agent whose provider/model is no longer in the
                            registry shows blank and must be re-picked. */}
        <FormGroup label={t('settings.ai.assistant.profile_model')}>
          <select className="gnosi-select" value={selectedKey} aria-label={t('settings.ai.assistant.profile_model')}
            onChange={e => {
              const [p, m] = e.target.value.split('||');
              update({ provider: p || '', model: m || '' });
            }}>
            <option value="">{t('settings.ai.select_model_option')}</option>
            {[...grouped.entries()].flatMap(([prov, modelIds]) => modelIds.map(mid => (
              <option key={`${prov}||${mid}`} value={`${prov}||${mid}`}>
                {modelDisplayName(aiRegistry.find(row => row.provider === prov && row.model_id === mid)) || mid}
              </option>
            )))}
          </select>
          {registryEmpty && (
            <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginTop: 6 }}>
              {t('settings.ai.model_registry_empty')}
            </div>
          )}
          {faultReason && (
            <div style={{
              fontSize: '0.78rem', marginTop: 8, padding: '8px 10px',
              borderRadius: 10, background: 'rgba(245, 158, 11, 0.12)',
              color: '#b45309', display: 'flex', gap: 6, alignItems: 'flex-start',
            }}>
              <Activity size={14} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>
                {t('settings.ai.model_fault_warning', {
                  defaultValue: 'Aquest model {{reason}} {{count}} vegades en els últims {{days}} dies.',
                  reason: t(faultReason.key, faultReason.fallback),
                  count: modelFault?.reasons[modelFault.top_model_reason ?? ""],
                  days: modelFault?.window_days,
                })}
              </span>
            </div>
          )}
        </FormGroup>



        <nav className="flex flex-wrap gap-2" aria-label={t('agent_behavior.navigation')}>
          {['instructions', 'skills', 'context', 'operations', 'preview'].map(key => <button type="button" key={key} className={`btn-gnosi ${section === key ? 'btn-gnosi-primary' : 'btn-gnosi-secondary'}`} aria-pressed={section === key} onClick={() => { setSection(key); }}>{t(`agent_behavior.${key}`)}</button>)}
        </nav>
        {section === 'instructions' && <FormGroup label={t('settings.ai.instructions_label')}
          description={t('settings.ai.instructions_desc')}>
          <textarea className="gnosi-input" value={persona} onChange={e => { update({ persona: e.target.value }); }}
            placeholder={t('settings.ai.instructions_placeholder')} rows={4}
            style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit' }} />
          {originalInstructions && <details className="ai-resource-details"><summary>{t('agent_behavior.original')}</summary>
            <pre className="whitespace-pre-wrap">{originalInstructions}</pre>
            <button type="button" className="btn-gnosi-secondary" onClick={() => { update({ persona: originalInstructions }); }}>{t('agent_behavior.restore')}</button>
          </details>}
          {availableInstructions !== originalInstructions && <details className="ai-resource-details"><summary>{t('agent_behavior.update')}</summary>
            <pre className="whitespace-pre-wrap">{availableInstructions}</pre>
            <button type="button" className="btn-gnosi-secondary" onClick={() => { update({ persona: availableInstructions }); }}>{t('agent_behavior.use_update')}</button>
          </details>}
          {typeof migration?.legacy_persona === 'string' && migration.legacy_persona && <details className="ai-resource-details"><summary>{t('agent_behavior.legacy')}</summary><pre className="whitespace-pre-wrap">{migration.legacy_persona}</pre></details>}
        </FormGroup>}

        {section === 'context' && <>
        {typeof migration?.legacy_context === 'string' && migration.legacy_context && <details className="ai-resource-details"><summary>{t('agent_behavior.legacy')}</summary><pre className="whitespace-pre-wrap">{migration.legacy_context}</pre></details>}
        <FormGroup label={t('settings.ai.context_label')}
          description={t('settings.ai.context_desc')}>
          <textarea className="gnosi-input" value={context} onChange={e => { update({ context: e.target.value }); }}
            placeholder={t('settings.ai.context_placeholder')} rows={4}
            style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit' }} />
        </FormGroup>

        <FormGroup label={t('settings.ai.context_sources_label')}
          description={t('settings.ai.context_sources_desc')}>
          <AgentContextSources value={contextRefs} onChange={context_refs => { update({ context_refs }); }} />
        </FormGroup>

        </>}
        {section === 'skills' && <FormGroup
          label={t('settings.ai.resources.assigned_skills')}
          description={t('settings.ai.resources.assigned_skills_help')}
        >
          <AgentSkillsField
            agent={{ ...agent, id: agent.id ?? '', provider, model }}
            skills={skills}
            tools={tools}
            registry={aiRegistry}
            selectedIds={selectedSkillIds}
            onChange={skill_ids => { update({ skill_ids }); }}
            onSelectSkill={onSelectSkill}
          />
        </FormGroup>}
        {(section === 'operations' || section === 'preview') && <AgentBehaviorInspection profile={form} operationsOnly={section === 'operations'} />}
      </div>
      {!agent.id && <div style={{ marginTop: '32px', display: 'flex', justifyContent: 'flex-end' }}>
        <button
          className="btn-gnosi btn-gnosi-primary"
          disabled={!name || !grouped.get(provider)?.includes(model) || savingAgent}
          onClick={() => {
            void (async () => {
              setSavingAgent(true);
              setSaveError(false);
              try {
                await onSave({
                  ...agent,
                  name,
                  provider,
                  model,
                  icon,
                  persona,
                  context,
                  context_refs: contextRefs,
                  skill_ids: selectedSkillIds,
                  model_strategy: { schema_version: 1, mode: 'pinned', decision_engine: 'rules', allowed_models: [] },
                });
              } catch {
                setSaveError(true);
              } finally {
                setSavingAgent(false);
              }
            })();
          }}
          style={{ padding: '14px 28px', borderRadius: '18px' }}
        >
          {savingAgent && <Loader2 size={16} className="animate-spin" />}
          {t(agent.id ? 'settings.ai.assistant.save_changes' : purpose === 'principal' ? 'settings.ai.assistant.configure_action' : 'settings.ai.assistant.create_profile')}
        </button>
      </div>}
      {saveError && <p role="alert">{t('settings.ai.model_strategy.save_error')}</p>}
    </div>
  );
}
