import { useEffect, useRef } from 'react';
import { fetchEditorConfiguration } from '../../../shared/api/configuration';
import { useConfigChanged } from '../../../shared/platform/configEvents';
import { getActiveVaultId } from '../../../shared/api/vault-context';
import { notifyError } from '../../../shared/notifications/notifyError';
import { isSuspendedPluginProfile } from '../../../shared/ai/assistantProfiles';
import { isJsonRecord } from '../AI/aiResourcesApi';
import { settingsAgents } from './settingsDocuments';
import { syncPluginProfiles } from './pluginProfileSync';
import type { SettingsState } from './stateTypes';

/** Lifecycle changes must not reload the whole form over unsaved user edits. */
export function useSettingsPluginProfiles({ isOpen, setDraft, setEditingAgent, t }: Pick<SettingsState, 'isOpen' | 'setDraft' | 'setEditingAgent' | 't'>) {
    const generation = useRef(0);
    useEffect(() => () => { generation.current += 1; }, [isOpen]);
    useConfigChanged(() => {
        if (!isOpen) return;
        const request = ++generation.current;
        const vaultId = getActiveVaultId();
        const current = () => request === generation.current && vaultId === getActiveVaultId();
        void fetchEditorConfiguration().then(config => {
            if (!current()) return;
            const agents = settingsAgents(isJsonRecord(config.ai) ? config.ai.agents : []);
            setDraft(previous => {
                const synced = syncPluginProfiles(previous.ai.agents, agents);
                return synced === previous.ai.agents ? previous : { ...previous, ai: { ...previous.ai, agents: synced } };
            });
            setEditingAgent(previous => previous?.id && agents.some(agent => agent.id === previous.id && isSuspendedPluginProfile(agent)) ? null : previous);
        }).catch((error: unknown) => {
            if (current()) notifyError('plugin-profile-refresh', error, t('settings.ai.assistant.plugin_refresh_error'));
        });
    });
}
