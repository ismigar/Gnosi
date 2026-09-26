import { useEffect, useRef } from 'react';
import { fetchEditorConfiguration } from '../../../shared/api/configuration';
import { notifyError } from '../../../shared/notifications/notifyError';
import { isJsonRecord } from '../AI/aiResourcesApi';
import { settingsAgents } from './settingsDocuments';
import type { SettingsController } from './useGlobalSettingsController';

/** Open the existing editors for the principal assistant or a selected profile. */
export function usePluginAISettingsNavigation(context: SettingsController) {
    const { activeTab, aiSection, draft, setActiveTab, setAiSection, setDraft, setEditingAgent, t } = context;
    const pendingAgent = useRef<string | undefined>(undefined);
    useEffect(() => {
        if (activeTab !== 'ai' || !pendingAgent.current) return;
        const agent = draft.ai.agents.find(item => item.id === pendingAgent.current);
        if (!agent) return;
        // Section navigation clears the old editor in the parent lifecycle.
        const timer = setTimeout(() => {
            setEditingAgent(agent);
            pendingAgent.current = undefined;
        }, 0);
        return () => { clearTimeout(timer); };
    }, [activeTab, aiSection, draft.ai.agents, setEditingAgent]);

    return (section: 'agents' | 'skills', agentId?: string): void => {
        pendingAgent.current = agentId;
        setAiSection(section);
        setActiveTab('ai');
        if (agentId && !draft.ai.agents.some(agent => agent.id === agentId)) {
            void fetchEditorConfiguration().then(config => {
                const agent = settingsAgents(isJsonRecord(config.ai) ? config.ai.agents : []).find(item => item.id === agentId);
                if (agent) setDraft(current => current.ai.agents.some(item => item.id === agent.id)
                    ? current : { ...current, ai: { ...current.ai, agents: [...current.ai.agents, agent] } });
            }).catch((error: unknown) => { notifyError('brain-agent-settings', error, t('settings.plugins.llm_wiki_load_error')); });
        }
    };
}
