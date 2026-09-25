import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, ArrowLeft, Brain } from 'lucide-react';
import { MemorySettings } from '../../agent-learning';
import { AgentsPanel } from './AgentsPanel';
import { Bot } from 'lucide-react';
import { Clock3 } from 'lucide-react';
import { ModelBudget } from './ModelBudget';
import { ModelConsumption } from './ModelConsumption';
import { Section } from '../../../shared/ui/settings/SettingsPrimitives';
import { SettingsSectionTabs } from '../../../shared/ui/settings/SettingsSectionTabs';
import { SkillsSettingsPanel } from '../AI/AIResourcesSettings';
import { Sliders } from 'lucide-react';
import { ToolsSettingsPanel } from '../AI/AIResourcesSettings';
import { Zap } from 'lucide-react';
import type { SettingsController } from './useGlobalSettingsController';

type Props = { context: SettingsController; focusedProfileId?: string };

export function AiPanel({ context, focusedProfileId }: Props) {
  const { aiResources, aiSection, draft, setAiSection, setDraft, setIsModelComparisonOpen, handleClose, t } = context;
  const navigate = useNavigate();
  const [selectedSkill, setSelectedSkill] = useState('');
  const [returnToProfile, setReturnToProfile] = useState(false);
  const openActivity = (tab = 'schedulers') => { void handleClose().then(() => navigate(`/dashboard?tab=${tab}&kind=personal`)); };
  useEffect(() => {
    if (aiSection === 'automations' || aiSection === 'operations') {
      void handleClose().then(() => navigate(`/dashboard?tab=${aiSection === 'operations' ? 'history' : 'schedulers'}&kind=personal`, { replace: true }));
    }
  }, [aiSection, handleClose, navigate]);
  return (<>
    {!focusedProfileId && <SettingsSectionTabs
      ariaLabel={t('settings.ai.resources.sections_label')}
      activeId={aiSection}
      items={[
        { id: 'agents', icon: Bot, label: t('settings.ai.assistant.title') },
        { id: 'memory', icon: Brain, label: t('learning.memory_title') },
        { id: 'skills', icon: Zap, label: t('settings.ai.resources.skills_tab') },
        { id: 'tools', icon: Sliders, label: t('settings.ai.resources.tools_tab') },
        { id: 'models', icon: Activity, label: t('settings.ai.resources.models_tab') },
      ]}
      onChange={sectionId => {
        setReturnToProfile(false);
        setAiSection(sectionId);
      }}
    />}

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

    <div hidden={aiSection !== 'agents'}>
      <AgentsPanel focusedProfileId={focusedProfileId} context={context} onOpenActivity={() => { openActivity(); }} onSelectSkill={id => { setReturnToProfile(true); setSelectedSkill(id); setAiSection('skills'); }} />
    </div>

    {aiSection === 'skills' && returnToProfile && <button
      type="button"
      className="btn-gnosi btn-gnosi-secondary"
      onClick={() => { setReturnToProfile(false); setAiSection('agents'); }}
    ><ArrowLeft size={16} />{t('settings.ai.resources.back_to_profile')}</button>}

    {aiSection === 'skills' && (
      <Section title={t('settings.ai.resources.skills_title')} icon={Zap}>
        <SkillsSettingsPanel
          resources={aiResources}
          key={selectedSkill}
          selectedSkillId={selectedSkill}
          canEdit={['admin', 'owner'].includes(context.role)}
          agents={draft.ai.agents}
          principalAgentId={draft.ai.active_agent_id}
          onAgentsChanged={agents => {
            setDraft(prev => ({
              ...prev,
              ai: { ...prev.ai, agents },
            }));
          }}
        />
      </Section>
    )}

    {aiSection === 'memory' && <Section title={t('learning.memory_title')} icon={Brain}><MemorySettings agents={draft.ai.agents} skills={aiResources.skills} principalAgentId={draft.ai.active_agent_id} canEdit={['editor', 'admin', 'owner'].includes(context.role)} /></Section>}

    {aiSection === 'tools' && (
      <Section title={t('settings.ai.resources.tools_title')} icon={Sliders}>
        <ToolsSettingsPanel resources={aiResources} onSelectSkill={id => { setSelectedSkill(id); setAiSection('skills'); }} />
      </Section>
    )}

    {aiSection !== 'agents' && <button type="button" className="btn-gnosi btn-gnosi-secondary" onClick={() => { openActivity(); }}><Clock3 size={16} />{t('activity.open_activity')}</button>}
  </>);
}
