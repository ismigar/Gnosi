import { principalAssistant } from '../../../shared/ai/assistantProfiles';
import { GnosiToggle } from '../../../shared/ui/settings/SettingsPrimitives';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AIResourceAgent, AIResourcesController } from './aiResourceSettingsTypes';
import type { NormalizedSkill } from './aiSettingsUtils';
import { isJsonRecord, jsonString } from './aiResourcesApi';

export function SkillUsage({ skill, source, agents, resources, onAgentsChanged, principalAgentId = '' }: {
    readonly skill: NormalizedSkill; readonly source: NormalizedSkill | null;
    readonly principalAgentId?: string;
    readonly agents: readonly AIResourceAgent[];
    readonly resources: Pick<AIResourcesController, 'automations' | 'assignAgentSkills' | 'saveAutomation'>;
    readonly onAgentsChanged: (agents: AIResourceAgent[]) => void;
}) {
    const { t } = useTranslation();
    const principal = principalAssistant(agents, principalAgentId);
    const [selectedAgents, setSelectedAgents] = useState<string[]>(() => principal ? [principal.id] : []);
    const [selectedAutomations, setSelectedAutomations] = useState<string[]>([]);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState('');
    const toggle = (values: string[], id: string) => values.includes(id) ? values.filter(value => value !== id) : [...values, id];
    const automations = resources.automations.filter(item => item.skill_id === source?.id);
    const apply = async () => {
        setSaving(true); setMessage('');
        const updated = new Map<string, string[]>();
        try {
            const targets = new Set([...selectedAgents, ...automations.filter(item => selectedAutomations.includes(String(item.id))).map(item => String(item.agent_id))]);
            // Add first: each automation update requires the new skill to be assigned.
            for (const id of targets) updated.set(id, await resources.assignAgentSkills(id, [], { sourceId: source?.id || '', targetId: skill.id, keepSource: true }));
            for (const item of automations.filter(value => selectedAutomations.includes(String(value.id)))) {
                const budgets = isJsonRecord(item.budgets) ? item.budgets : {};
                await resources.saveAutomation({ ...item, id: String(item.id), name: String(item.name), agent_id: String(item.agent_id), skill_id: skill.id, instruction: String(item.instruction), enabled: item.enabled === true, interval_minutes: Number(item.interval_minutes), max_runs_per_day: Number(budgets.max_runs_per_day ?? 4), max_ai_calls_per_run: Number(budgets.max_ai_calls_per_run ?? 4), max_runtime_seconds: Number(budgets.max_runtime_seconds ?? 180) });
            }
            for (const id of selectedAgents) {
                const keepSource = automations.some(item => item.agent_id === id && !selectedAutomations.includes(String(item.id)));
                updated.set(id, await resources.assignAgentSkills(id, [], { sourceId: source?.id || '', targetId: skill.id, keepSource }));
            }
            setMessage(t('settings.ai.resources.assignment_saved'));
        } catch (error: unknown) {
            setMessage(`${t('settings.ai.resources.assignment_partial_error')}: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            // Preserve successful changes even if a later target failed; never claim rollback.
            onAgentsChanged(agents.map(agent => updated.has(agent.id) ? { ...agent, skill_ids: updated.get(agent.id) } : agent));
            setSaving(false);
        }
    };
    return <div className="ai-resource-editor">
        <strong>{t('settings.ai.resources.assign_copy')}</strong><p>{t('settings.ai.resources.assignment_help')}</p>
        {principal && <div className="flex items-center gap-3"><GnosiToggle active={selectedAgents.includes(principal.id)} label={t('settings.ai.assistant.principal')} onChange={() => { setSelectedAgents(values => toggle(values, principal.id)); }} /><span>{t('settings.ai.assistant.principal')}: {principal.name || principal.id}</span></div>}
        <details><summary>{t('settings.ai.assistant.advanced')}</summary>
            {agents.filter(agent => agent.id !== principal?.id).map(agent => <div className="flex items-center gap-3" key={agent.id}><GnosiToggle active={selectedAgents.includes(agent.id)} label={agent.name || agent.id} onChange={() => { setSelectedAgents(values => toggle(values, agent.id)); }} /><span>{agent.name || agent.id}</span></div>)}
        </details>
        {automations.map(item => <label key={String(item.id)}><input type="checkbox" checked={selectedAutomations.includes(String(item.id))} onChange={() => { setSelectedAutomations(values => toggle(values, String(item.id))); }} />{jsonString(item.name)}</label>)}
        <button type="button" className="btn-gnosi btn-gnosi-primary" disabled={saving || (!selectedAgents.length && !selectedAutomations.length)} onClick={() => { void apply(); }}>{t('common.save')}</button>
        {message && <p role="status">{message}</p>}
    </div>;
}
