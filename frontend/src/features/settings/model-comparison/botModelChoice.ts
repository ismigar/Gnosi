import type { SettingsAgent } from '../global-settings/types';
import { recommendedModelProfile } from '../../../shared/ai/agentModelRecommendation';
import type { TaskId } from './taskRecommendations';

/** Selecting a fixed model preserves the bot's instructions, skills and team. */
export function withBotModel(bot: SettingsAgent, provider: string, model: string): SettingsAgent {
    return { ...bot, provider, model,
        reasoning_effort: bot.provider === provider && bot.model === model ? bot.reasoning_effort : null,
        model_strategy: { schema_version: 1, mode: 'pinned', decision_engine: 'rules', allowed_models: [] },
    };
}

export function botTask(bot: SettingsAgent | undefined, principalId: string): TaskId {
    if (!bot) return 'analyse';
    if (bot.managed_by === 'builtin:llm-wiki') return 'book';
    const role = recommendedModelProfile(bot, principalId);
    return role === 'director' ? 'workflow' : role === 'administrative' ? 'extract'
        : role === 'worker' ? 'classify' : role === 'documentalist' ? 'retrieve' : 'analyse';
}
