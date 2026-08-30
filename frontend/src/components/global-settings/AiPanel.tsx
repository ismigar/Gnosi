import { Activity } from 'lucide-react';
import { AgentsPanel } from './AgentsPanel';
import { AutomationsSettingsPanel } from '../AI/AIOperationsSettings';
import { Bot } from 'lucide-react';
import { Clock3 } from 'lucide-react';
import { History } from 'lucide-react';
import { ModelBudget } from './ModelBudget';
import { ModelConsumption } from './ModelConsumption';
import { OperationsHistoryPanel } from '../AI/AIOperationsSettings';
import { Section } from './SettingsPrimitives';
import { SettingsSectionTabs } from '../SettingsSectionTabs';
import { SkillsSettingsPanel } from '../AI/AIResourcesSettings';
import { Sliders } from 'lucide-react';
import { ToolsSettingsPanel } from '../AI/AIResourcesSettings';
import { Zap } from 'lucide-react';
import type { SettingsController } from './useGlobalSettingsController';
import { automationResources, operationResources } from './aiOperationsBridge';

type Props = { context: SettingsController };

export function AiPanel({ context }: Props) {
  const { aiResources, aiSection, draft, setAiSection, setDraft, setEditingAgent, setIsModelComparisonOpen, t } = context;
  return (<>
    <SettingsSectionTabs
      ariaLabel={t('settings.ai.resources.sections_label')}
      activeId={aiSection}
      items={[
        { id: 'models', icon: Activity, label: t('settings.ai.resources.models_tab') },
        { id: 'agents', icon: Bot, label: t('settings.ai.resources.agents_tab') },
        { id: 'skills', icon: Zap, label: t('settings.ai.resources.skills_tab') },
        { id: 'tools', icon: Sliders, label: t('settings.ai.resources.tools_tab') },
        { id: 'automations', icon: Clock3, label: t('settings.ai.operations.automations_tab') },
        { id: 'operations', icon: History, label: t('settings.ai.operations.history_tab') },
      ]}
      onChange={sectionId => {
        setAiSection(sectionId);
        setEditingAgent(null);
      }}
    />

    {aiSection === 'models' && <div className="ai-comparison-launcher">
      <div>
        <strong>{t('model_comparison.launch_title')}</strong>
        <span>{t('model_comparison.launch_description')}</span>
      </div>
      <button type="button" className="btn-gnosi btn-gnosi-primary" onClick={() => { setIsModelComparisonOpen(true); }}>
        <Activity size={18} />
        {t('model_comparison.open')}
      </button>
    </div>}

    <ModelConsumption context={context} />

    {aiSection === 'models' && (
      <ModelBudget context={context} />
    )}

    {aiSection === 'models' && <div style={{ height: '30px' }} />}

    {aiSection === 'agents' && <AgentsPanel context={context} />}

    {aiSection === 'skills' && (
      <Section title={t('settings.ai.resources.skills_title')} icon={Zap}>
        <SkillsSettingsPanel
          resources={aiResources}
          agents={draft.ai.agents}
          onAgentsChanged={agents => {
            setDraft(prev => ({
              ...prev,
              ai: { ...prev.ai, agents },
            }));
          }}
        />
      </Section>
    )}

    {aiSection === 'tools' && (
      <Section title={t('settings.ai.resources.tools_title')} icon={Sliders}>
        <ToolsSettingsPanel resources={aiResources} />
      </Section>
    )}

    {aiSection === 'automations' && (
      <Section title={t('settings.ai.operations.automations_title')} icon={Clock3}>
        <AutomationsSettingsPanel resources={automationResources(aiResources)} agents={draft.ai.agents} />
      </Section>
    )}

    {aiSection === 'operations' && (
      <Section title={t('settings.ai.operations.history_title')} icon={History}>
        <OperationsHistoryPanel resources={operationResources(aiResources)} />
      </Section>
    )}
  </>);
}
