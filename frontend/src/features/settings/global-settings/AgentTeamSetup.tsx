import { useState, type ReactNode } from 'react';
import { isSuspendedPluginProfile, profileDisplayName, profilesByDisplayName } from '../../../shared/ai/assistantProfiles';
import { modelDisplayName } from '../../../shared/ai/modelDisplayName';
import './AgentTeamSetup.css';
import { useTranslation } from 'react-i18next';
import { GnosiToggle, FormGroup } from '../../../shared/ui/settings/SettingsPrimitives';
import { normalizedTeam, TEAM_OPERATIONS, TEAM_SKILL, withTeam, type AgentTeam } from '../../../shared/ai/agentTeams';
import { AgentTeamParticipation, type TeamParticipation } from './AgentTeamParticipation';
import { AgentTeamChoices } from './AgentTeamChoices';
import { skillDisplayName } from '../AI/aiResourceI18n';
import type { NormalizedSkill } from '../AI/aiSettingsUtils';
import type { AiModelRegistryEntry } from '../../../shared/api/ai';
import type { SettingsAgent } from './types';

interface Props {
    agents: SettingsAgent[];
    principalId: string;
    registry: AiModelRegistryEntry[];
    skillCatalog?: NormalizedSkill[];
    onChange: (agents: SettingsAgent[], principalId: string) => void;
    renderAgent?: (agent: SettingsAgent, participation: ReactNode) => ReactNode;
}

export function AgentTeamSetup({ agents, principalId, registry, skillCatalog = [], onChange, renderAgent }: Props) {
    const { t, i18n } = useTranslation();
    const current = agents.find(a => a.id === principalId);
    const [team, setTeam] = useState<AgentTeam>(() => normalizedTeam(current?.team, principalId));
    const [initiators, setInitiators] = useState<string[]>(() => agents.filter(a => a.team?.enabled && a.team.director_id === (current?.team?.director_id ?? principalId)).map(a => a.id));
    const [pending, setPending] = useState(false);
    const sorted = profilesByDisplayName(agents.filter(a => !isSuspendedPluginProfile(a)), t, i18n.resolvedLanguage).sort((a, b) => Number(b.id === principalId) - Number(a.id === principalId));
    const available = sorted.filter(a => a.enabled !== false && !a.plugin_suspended);
    const agentName = (agent: SettingsAgent) => profileDisplayName(agent, t) || agent.id;
    const agentModel = (agent: SettingsAgent) => modelDisplayName(registry.find(row => row.provider === agent.provider && row.model_id === agent.model)) || agent.model;
    const skills = [...new Set(available.flatMap(a => a.skill_ids ?? []))].filter(s => s !== TEAM_SKILL);
    const members = team.members.filter(m => m.agent_id !== team.director_id);
    const routeMembers = sorted.filter(a => members.some(m => m.agent_id === a.id));
    const validMembers = members.length > 0 && members.every(m => available.some(a => a.id === m.agent_id));
    const validDirector = available.some(a => a.id === team.director_id && a.managed_by !== 'llm-wiki');
    const temporaryIncomplete = team.temporary.enabled && (!team.temporary.models.length || !team.temporary.skill_ids.length);
    const saveChanges = (value: AgentTeam, nextInitiators = initiators) => {
        const nextMembers = value.members.filter(m => m.agent_id !== value.director_id);
        const removedLastMember = members.length > 0 && nextMembers.length === 0;
        const requesters = removedLastMember ? [] : nextInitiators;
        const next = { ...value, enabled: nextMembers.length > 0, members: nextMembers,
            direct_routes: value.direct_routes.map(r => ({ ...r, agent_ids: r.agent_ids.filter(id => nextMembers.some(m => m.agent_id === id)) })).filter(r => r.agent_ids.length),
            temporary: removedLastMember ? { ...value.temporary, enabled: false } : value.temporary,
        };
        const incomplete = !available.some(a => a.id === next.director_id && a.managed_by !== 'llm-wiki')
            || nextMembers.some(m => !available.some(a => a.id === m.agent_id))
            || (!nextMembers.length && requesters.some(id => id !== next.director_id))
            || (next.temporary.enabled && (!next.temporary.models.length || !next.temporary.skill_ids.length));
        setTeam(next);
        setInitiators(requesters);
        setPending(incomplete);
        if (!incomplete) {
            onChange(withTeam(agents, next, requesters, current?.team?.director_id ?? principalId), next.director_id);
        }
    };
    const setParticipation = (id: string, participation: TeamParticipation) => {
        const member = participation === 'member' || participation === 'both';
        const requester = participation === 'requester' || participation === 'both';
        saveChanges({ ...team,
            members: member ? team.members.some(m => m.agent_id === id) ? team.members : [...team.members, { agent_id: id, roles: ['allrounder'] }] : team.members.filter(m => m.agent_id !== id),
        }, requester ? [...new Set([...initiators, id])] : initiators.filter(item => item !== id));
    };
    const disable = () => {
        const directorId = current?.team?.director_id;
        onChange(agents.map(a => a.team && a.team.director_id === directorId ? { ...a, team: { ...a.team, enabled: false } } : a), principalId);
        setTeam(value => ({ ...value, enabled: false }));
        setInitiators([]);
        setPending(false);
    };
    return <div className="agent-team-setup">
        <section className="agent-team-setup__content" aria-label={t('settings.ai.assistant.list_label')}>
                {sorted.map(agent => {
                    const participation = <AgentTeamParticipation name={agentName(agent)} director={agent.id === team.director_id}
                        available={agent.enabled !== false && !agent.plugin_suspended} member={team.members.find(m => m.agent_id === agent.id)} requester={initiators.includes(agent.id)}
                        onChange={value => { setParticipation(agent.id, value); }} onToggleRole={role => { saveChanges({ ...team, members: team.members.map(m => m.agent_id === agent.id ? { ...m, roles: m.roles.includes(role) ? m.roles.filter(r => r !== role) : [...m.roles, role] } : m) }); }} />;
                    return <div className="agent-team-setup__card" key={agent.id}>
                        {renderAgent ? renderAgent(agent, participation) : <>
                            <div className="agent-team-setup__row"><div className="agent-team-setup__identity"><strong>{agentName(agent)}</strong><span className="settings-desc">{agentModel(agent)}</span></div></div>
                            {participation}
                        </>}
                    </div>;
                })}
            <details className="agent-team-setup__advanced">
                <summary>{t('agent_team.advanced')}</summary>
                <p className="settings-desc">{t('agent_team.routes_help')}</p>
                {!routeMembers.length && <p className="settings-desc">{t('agent_team.routes_empty')}</p>}
                {routeMembers.length > 0 && TEAM_OPERATIONS.map(operation => {
                    const label = t(`agent_execution.skills.${operation}`, { defaultValue: operation });
                    const selected = team.direct_routes.find(r => r.operation === operation)?.agent_ids ?? [];
                    return <details key={operation} className="agent-team-setup__route">
                        <summary>{label}<span className="settings-desc">{selected.length ? routeMembers.filter(a => selected.includes(a.id)).map(agentName).join(', ') : t('agent_team.route_automatic')}</span></summary>
                        <AgentTeamChoices label={label} options={routeMembers.map(a => ({ id: a.id, label: agentName(a), disabled: a.enabled === false || a.plugin_suspended }))}
                            value={selected} emptyLabel={t('agent_team.routes_empty')} onChange={ids => {
                                saveChanges({ ...team, direct_routes: [...team.direct_routes.filter(r => r.operation !== operation), ...(ids.length ? [{ operation, agent_ids: ids }] : [])] });
                            }} />
                    </details>;
                })}
                <label className="agent-team-setup__row">{t('agent_team.temporary')}<GnosiToggle label={t('agent_team.temporary')} active={team.temporary.enabled} onChange={() => { saveChanges({ ...team, temporary: { ...team.temporary, enabled: !team.temporary.enabled } }); }} /></label>
                {team.temporary.enabled && <>
                    <p className="settings-desc">{t('agent_team.temporary_selection_help')}</p>
                    <FormGroup label={t('agent_team.allowed_models')}><AgentTeamChoices label={t('agent_team.allowed_models')}
                        options={registry.filter(r => r.enabled).map(r => ({ id: `${r.provider}||${r.model_id}`, label: `${modelDisplayName(r)} · ${r.provider}` }))}
                        emptyLabel={t('agent_team.models_empty')} value={team.temporary.models.map(m => `${m.provider}||${m.model}`)} onChange={ids => {
                        const models = ids.map(id => { const [provider = '', model = ''] = id.split('||'); return { provider, model }; });
                        saveChanges({ ...team, temporary: { ...team.temporary, models } });
                    }} /></FormGroup>
                    <FormGroup label={t('agent_team.allowed_skills')}><AgentTeamChoices label={t('agent_team.allowed_skills')}
                        options={skills.map(s => ({ id: s, label: skillDisplayName(t, skillCatalog.find(skill => skill.id === s) ?? { id: s }) }))} emptyLabel={t('agent_team.skills_empty')} value={team.temporary.skill_ids} onChange={skill_ids => {
                        saveChanges({ ...team, temporary: { ...team.temporary, skill_ids } });
                    }} /></FormGroup>
                </>}
                <p className="settings-desc">{t('agent_team.skill_addition')}</p>
                <p className="settings-desc">{t('agent_team.limits')}</p>
            </details>
            <p className="settings-desc">{t('agent_team.review_help')}</p>
            {!team.enabled && members.length > 0 && !pending && <p role="status" className="settings-desc">{t('agent_team.inactive_help')}</p>}
            {pending && <p role="status" className="settings-desc">{t('agent_team.pending_changes')}</p>}
            {(pending || team.enabled) && (!validDirector || !validMembers) && <p role="status" className="settings-desc">{t('agent_team.members_required')}</p>}
            {temporaryIncomplete && <p role="status" className="settings-desc">{t('agent_team.temporary_required')}</p>}
            <div className="agent-team-setup__actions">
                {current?.team?.enabled && <button type="button" className="btn-gnosi btn-gnosi-secondary" onClick={disable}>{t('agent_team.disable')}</button>}
            </div>
        </section>
    </div>;
}
