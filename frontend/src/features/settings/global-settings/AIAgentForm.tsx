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
import { useTranslation } from 'react-i18next';

export function AIAgentForm({ agent, onSave, aiRegistry, skills, tools }: { agent: AgentDraft; onSave: (agent: AgentDraft) => Promise<void>; aiRegistry: SettingsModel[]; skills: NormalizedSkill[]; tools: NormalizedTool[] }) {
  const { t } = useTranslation();
  const [name, setName] = useState(agent.name || '');
  const [provider, setProvider] = useState(agent.provider || '');
  const [model, setModel] = useState(agent.model || '');
  const [icon, setIcon] = useState(agent.icon || '🤖');
  // Instructions (system prompt → agent.persona) and reference context
  // (knowledge/notes → agent.context). Distinct concerns: "who you are" vs
  // "data you must consider". Both optional; backend appends context to the
  // system message under a "## Context" heading (see factory.py).
  const [persona, setPersona] = useState(agent.persona || '');
  const [context, setContext] = useState(agent.context || '');
  // Attached sources: references (files, pages, databases, the vault), never
  // their content — the agent reads them on demand through its scoped tools
  // (directive `agent_context_sources.md`).
  const [contextRefs, setContextRefs] = useState(agent.context_refs || []);
  const [selectedSkillIds, setSelectedSkillIds] = useState(agent.skill_ids || []);
  const [savingAgent, setSavingAgent] = useState(false);

  // Group registry rows by provider for the <select> optgroups. Rows carry
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
        <h3 className="ai-agent-form-title">{t('settings.ai.new_agent_title')}</h3>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <FormGroup label={t('settings.ai.agent_name')}>
              <input type="text" className="gnosi-input" value={name} onChange={e => { setName(e.target.value); }} placeholder={t('settings.ai.agent_name_placeholder')} />
            </FormGroup>
          </div>
          <div style={{ width: '72px' }}>
            <FormGroup label={t('settings.ai.icon_label')}>
              <AgentIconSelect
                value={icon}
                onChange={setIcon}
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
        <FormGroup label={t('settings.ai.model_specific')}>
          <select className="gnosi-select" value={selectedKey}
            onChange={e => {
              const [p, m] = e.target.value.split('||');
              setProvider(p || '');
              setModel(m || '');
            }}>
            <option value="">{t('settings.ai.select_model_option')}</option>
            {[...grouped.entries()].map(([prov, modelIds]) => (
              <optgroup key={prov} label={prov}>
                {modelIds.map(mid => (
                  <option key={mid} value={`${prov}||${mid}`}>{mid}</option>
                ))}
              </optgroup>
            ))}
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

        <FormGroup label={t('settings.ai.instructions_label')}
          description={t('settings.ai.instructions_desc')}>
          <textarea className="gnosi-input" value={persona} onChange={e => { setPersona(e.target.value); }}
            placeholder={t('settings.ai.instructions_placeholder')} rows={4}
            style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit' }} />
        </FormGroup>

        <FormGroup label={t('settings.ai.context_label')}
          description={t('settings.ai.context_desc')}>
          <textarea className="gnosi-input" value={context} onChange={e => { setContext(e.target.value); }}
            placeholder={t('settings.ai.context_placeholder')} rows={4}
            style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit' }} />
        </FormGroup>

        <FormGroup label={t('settings.ai.context_sources_label')}
          description={t('settings.ai.context_sources_desc')}>
          <AgentContextSources value={contextRefs} onChange={setContextRefs} />
        </FormGroup>

        <FormGroup
          label={t('settings.ai.resources.assigned_skills')}
          description={t('settings.ai.resources.assigned_skills_help')}
        >
          <AgentSkillsField
            agent={{ ...agent, id: agent.id ?? '', provider, model }}
            skills={skills}
            tools={tools}
            registry={aiRegistry}
            selectedIds={selectedSkillIds}
            onChange={setSelectedSkillIds}
          />
        </FormGroup>
      </div>
      <div style={{ marginTop: '32px', display: 'flex', justifyContent: 'flex-end' }}>
        <button
          className="btn-gnosi-primary"
          disabled={!name || !provider || !model || savingAgent}
          onClick={() => {
            void (async () => {
              setSavingAgent(true);
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
                });
              } finally {
                setSavingAgent(false);
              }
            })();
          }}
          style={{ padding: '14px 28px', borderRadius: '18px' }}
        >
          {savingAgent && <Loader2 size={16} className="animate-spin" />}
          {agent.id ? t('settings.ai.update_agent') : t('settings.ai.create_agent_action')}
        </button>
      </div>
    </div>
  );
}
