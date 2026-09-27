import { useTranslation } from 'react-i18next';
import { recommendedModelProfile } from '../../../shared/ai/agentModelRecommendation';
import type { AgentTeam } from '../../../shared/ai/agentTeams';
import type { NormalizedSkill } from '../AI/aiSettingsUtils';
import type { SettingsAgent } from './types';

export function AgentModelRecommendation({ agent, principalId, team, skills }: {
    agent: SettingsAgent; principalId: string; team?: AgentTeam; skills: NormalizedSkill[];
}) {
    const { t } = useTranslation();
    const profile = recommendedModelProfile(agent, principalId, team, skills);
    return <div className="agent-model-recommendation">
        <strong>{t('settings.ai.assistant.recommended_llm_profile', { profile: t(`model_comparison.profiles.${profile}`) })}</strong>
        <span className="settings-desc">{t(`settings.ai.assistant.recommendation_reasons.${profile}`)}</span>
    </div>;
}
