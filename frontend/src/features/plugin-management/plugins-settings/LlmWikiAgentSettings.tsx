import { useTranslation } from 'react-i18next';
import type { PluginLlmWikiSettingsResponse } from '../../../shared/api/plugins';
import { SELECT_STYLE, type PluginConfigProps } from './pluginSettingsModel';

interface Props extends PluginConfigProps {
    readonly agentId: string;
    readonly agents: NonNullable<PluginLlmWikiSettingsResponse['agents']>;
    readonly busy: boolean;
    readonly onSelect: (agentId: string) => Promise<void>;
}

export function LlmWikiAgentSettings({ agentId, agents, busy, onSelect, onOpenAISettings }: Props) {
    const { t } = useTranslation();
    const selected = agents.find(agent => agent.id === agentId);
    return <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ color: 'var(--text-secondary)', fontSize: 12, fontWeight: 600 }}>{t('settings.plugins.llm_wiki_agent')}</span>
            <select style={SELECT_STYLE} value={agentId} disabled={busy} onChange={event => { void onSelect(event.target.value); }}>
                {!selected && <option value={agentId}>{t('settings.plugins.llm_wiki_agent_missing', { id: agentId })}</option>}
                {agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name}{agent.ready ? '' : ` · ${t('settings.plugins.llm_wiki_agent_setup')}`}</option>)}
            </select>
        </label>
        <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>{t('settings.plugins.llm_wiki_agent_help')}</span>
        {selected && !selected.ready && <span role="status" style={{ color: 'var(--status-warning)', fontSize: 12 }}>{t('settings.plugins.llm_wiki_agent_not_ready')}</span>}
        {onOpenAISettings && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button type="button" className="btn-gnosi" disabled={busy} onClick={() => { onOpenAISettings('agents', agentId); }}>{t('settings.plugins.llm_wiki_edit_agent')}</button>
            <button type="button" className="btn-gnosi" disabled={busy} onClick={() => { onOpenAISettings('skills'); }}>{t('settings.plugins.llm_wiki_edit_skills')}</button>
        </div>}
        <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>{t('settings.plugins.llm_wiki_skills_help')}</span>
    </div>;
}
