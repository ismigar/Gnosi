import { DraftSaveStatus } from '../../../shared/editor/DraftSaveStatus';
import { principalAssistant, profileDisplayName } from '../../../shared/ai/assistantProfiles';
import { GnosiToggle } from '../../../shared/ui/settings/SettingsPrimitives';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AIResourceAgent, AIResourcesController } from './aiResourceSettingsTypes';
import type { NormalizedSkill } from './aiSettingsUtils';
import { isJsonRecord, jsonString } from './aiResourcesApi';
import { skillDisplayName } from './aiResourceI18n';

export function SkillUsage({ skill, source, agents, resources, onAgentsChanged, onClose, principalAgentId = '' }: {
    readonly skill: NormalizedSkill; readonly source: NormalizedSkill | null;
    readonly principalAgentId?: string;
    readonly agents: readonly AIResourceAgent[];
    readonly resources: Pick<AIResourcesController, 'automations' | 'assignAgentSkills' | 'saveAutomation'>;
    readonly onAgentsChanged: (agents: AIResourceAgent[]) => void;
    readonly onClose: () => void;
}) {
    const { t } = useTranslation();
    const principal = principalAssistant(agents, principalAgentId);
    const usesSkill = (ids: readonly string[] = []) => ids.includes(skill.id) || (!!source && ids.includes(source.id));
    const [selectedAgents, setSelectedAgents] = useState<string[]>(() => agents.filter(agent => usesSkill(agent.skill_ids)).map(agent => agent.id));
    const automations = resources.automations.filter(item => item.skill_id === skill.id || (!!source && item.skill_id === source.id));
    const [selectedAutomations, setSelectedAutomations] = useState<string[]>(() => automations.map(item => String(item.id)));
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState('');
    const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const publish = (id: string, ids: string[]) => {
        onAgentsChanged(agents.map(agent => agent.id === id ? { ...agent, skill_ids: ids } : agent));
        setSelectedAgents(values => usesSkill(ids) ? [...new Set([...values, id])] : values.filter(value => value !== id));
    };
    const persist = async (write: () => Promise<void>) => {
        setSaving(true); setMessage(''); setStatus('saving');
        try { await write(); setStatus('saved'); }
        catch (error: unknown) { setStatus('error'); setMessage(`${t('settings.ai.resources.assignment_partial_error')}: ${error instanceof Error ? error.message : String(error)}`); }
        finally { setSaving(false); }
    };
    const changeAgent = (id: string) => persist(async () => {
        const ids = await resources.assignAgentSkills(id, [], { sourceId: source?.id || '', targetId: skill.id, keepSource: false, removeTarget: selectedAgents.includes(id) });
        publish(id, ids);
    });
    const changeAutomation = (item: (typeof automations)[number]) => persist(async () => {
        const id = String(item.id); const selected = selectedAutomations.includes(id);
        if (selected && !source) return;
        const targetId = selected ? source?.id || skill.id : skill.id;
        const agentId = String(item.agent_id);
        publish(agentId, await resources.assignAgentSkills(agentId, [], { sourceId: '', targetId, keepSource: true }));
        const budgets = isJsonRecord(item.budgets) ? item.budgets : {};
        await resources.saveAutomation({ ...item, id, name: String(item.name), agent_id: agentId, skill_id: targetId,
            instruction: String(item.instruction), enabled: item.enabled === true, interval_minutes: Number(item.interval_minutes),
            max_runs_per_day: Number(budgets.max_runs_per_day ?? 4), max_ai_calls_per_run: Number(budgets.max_ai_calls_per_run ?? 4), max_runtime_seconds: Number(budgets.max_runtime_seconds ?? 180) });
        setSelectedAutomations(values => selected ? values.filter(value => value !== id) : [...values, id]);
    });
    const title = t('settings.ai.resources.assignment_title', { name: skillDisplayName(t, skill) });
    return <section className="ai-resource-editor" aria-label={title}>
        <div className="ai-resource-editor__title flex-wrap">
            <strong>{title}</strong>
            <span className="ai-resource-muted">{t('settings.ai.resources.skill_version', { version: skill.version })}</span>
            <DraftSaveStatus status={status} detail={message || undefined} />
            <button className="btn-gnosi btn-gnosi-secondary ml-auto" type="button" disabled={saving} onClick={onClose}>{t('common.close')}</button>
        </div><p>{t('settings.ai.resources.assignment_help')}</p>
        {principal && <div className="flex items-center gap-3"><GnosiToggle active={selectedAgents.includes(principal.id)} label={t('settings.ai.assistant.principal')} disabled={saving} onChange={() => { void changeAgent(principal.id); }} /><span>{t('settings.ai.assistant.principal')}: {profileDisplayName(principal, t) || principal.id}</span></div>}
        <details><summary>{t('settings.ai.assistant.advanced')}</summary>
            {agents.filter(agent => agent.id !== principal?.id).map(agent => <div className="flex items-center gap-3" key={agent.id}><GnosiToggle active={selectedAgents.includes(agent.id)} label={profileDisplayName(agent, t) || agent.id} disabled={saving} onChange={() => { void changeAgent(agent.id); }} /><span>{profileDisplayName(agent, t) || agent.id}</span></div>)}
        </details>
        {automations.map(item => <div className="flex items-center gap-3" key={String(item.id)}>
            <GnosiToggle active={selectedAutomations.includes(String(item.id))} label={jsonString(item.name)} disabled={saving || !source} onChange={() => { void changeAutomation(item); }} />
            <span>{jsonString(item.name)}</span>
        </div>)}
        {message && <p role="alert">{message}</p>}
    </section>;
}
