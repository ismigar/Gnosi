import { useState, type ReactNode } from 'react';
import { profileDisplayName, profilesByDisplayName } from '../../../shared/ai/assistantProfiles';
import { modelDisplayName } from '../../../shared/ai/modelDisplayName';
import './AgentTeamSetup.css';
import { useTranslation } from 'react-i18next';
import { GnosiToggle, FormGroup } from '../../../shared/ui/settings/SettingsPrimitives';
import { normalizedTeam, TEAM_OPERATIONS, TEAM_SKILL, withTeam, type AgentTeam } from '../../../shared/ai/agentTeams';
import { AgentTeamParticipation, type TeamParticipation } from './AgentTeamParticipation';
import type { AiModelRegistryEntry } from '../../../shared/api/ai';
import type { SettingsAgent } from './types';

interface Props {
    agents: SettingsAgent[];
    principalId: string;
    registry: AiModelRegistryEntry[];
    onApply: (agents: SettingsAgent[], principalId: string) => void;
    onOpenChange?: (open: boolean) => void;
    renderAgent?: (agent: SettingsAgent, participation: ReactNode) => ReactNode;
}

export function AgentTeamSetup({ agents, principalId, registry, onApply, onOpenChange, renderAgent }: Props) {
    const { t, i18n } = useTranslation();
    const [open, setOpen] = useState(false);
    const current = agents.find(a => a.id === principalId);
    const [team, setTeam] = useState<AgentTeam>(() => normalizedTeam(current?.team, principalId));
    const [initiators, setInitiators] = useState<string[]>([principalId]);
    const sorted = profilesByDisplayName(agents, t, i18n.resolvedLanguage);
    const available = sorted.filter(a => a.enabled !== false && !a.plugin_suspended);
    const agentName = (agent: SettingsAgent) => profileDisplayName(agent, t) || agent.id;
    const agentModel = (agent: SettingsAgent) => modelDisplayName(registry.find(row => row.provider === agent.provider && row.model_id === agent.model)) || agent.model;
    const skills = [...new Set(available.flatMap(a => a.skill_ids ?? []))].filter(s => s !== TEAM_SKILL);
    const changeOpen = (value: boolean) => { setOpen(value); onOpenChange?.(value); };
    const setParticipation = (id: string, participation: TeamParticipation) => {
        const member = participation === 'member' || participation === 'both';
        const requester = participation === 'requester' || participation === 'both';
        setTeam(value => ({ ...value,
            members: member ? value.members.some(m => m.agent_id === id) ? value.members : [...value.members, { agent_id: id, roles: ['allrounder'] }] : value.members.filter(m => m.agent_id !== id),
            direct_routes: member ? value.direct_routes : value.direct_routes.map(r => ({ ...r, agent_ids: r.agent_ids.filter(a => a !== id) })).filter(r => r.agent_ids.length),
        }));
        setInitiators(value => requester ? [...new Set([...value, id])] : value.filter(item => item !== id));
    };
    const members = team.members.filter(m => m.agent_id !== team.director_id);
    const validMembers = members.length > 0 && members.every(m => available.some(a => a.id === m.agent_id));
    const validDirector = available.some(a => a.id === team.director_id && !a.managed_by);
    const temporaryIncomplete = team.temporary.enabled && (!team.temporary.models.length || !team.temporary.skill_ids.length);
    const canApply = validDirector && validMembers && !temporaryIncomplete;
    const apply = () => {
        const selected = { ...team, enabled: true, members, direct_routes: team.direct_routes.map(r => ({ ...r, agent_ids: r.agent_ids.filter(id => members.some(m => m.agent_id === id)) })).filter(r => r.agent_ids.length) };
        onApply(withTeam(agents, selected, initiators, current?.team?.director_id ?? principalId), selected.director_id);
        changeOpen(false);
    };
    const disable = () => {
        const directorId = current?.team?.director_id;
        onApply(agents.map(a => a.team && a.team.director_id === directorId ? { ...a, team: { ...a.team, enabled: false } } : a), principalId);
        changeOpen(false);
    };
    return <div className="agent-team-setup">
        <button type="button" className="btn-gnosi btn-gnosi-secondary" aria-expanded={open} onClick={() => { if (!open) { setTeam(normalizedTeam(current?.team, principalId)); setInitiators(agents.filter(a => a.team?.enabled && a.team.director_id === (current?.team?.director_id ?? principalId)).map(a => a.id)); } changeOpen(!open); }}>{t('agent_team.setup')}</button>
        {open && <section className="agent-team-setup__wizard" aria-label={t('agent_team.setup')}>
            <p className="settings-desc">{t('agent_team.help')}</p>
                <FormGroup label={t('agent_team.director')}><select className="gnosi-select" aria-label={t('agent_team.director')} value={team.director_id} onChange={e => { setTeam(v => ({ ...v, director_id: e.target.value })); }}>
                    <option value="">{t('agent_team.choose')}</option>
                    {available.filter(a => !a.managed_by).map(a => <option key={a.id} value={a.id}>{agentName(a)} · {agentModel(a)}</option>)}
                </select></FormGroup>
                {sorted.map(agent => {
                    const participation = <AgentTeamParticipation name={agentName(agent)} director={agent.id === team.director_id}
                        available={agent.enabled !== false && !agent.plugin_suspended} member={team.members.find(m => m.agent_id === agent.id)} requester={initiators.includes(agent.id)}
                        onChange={value => { setParticipation(agent.id, value); }} onToggleRole={role => { setTeam(value => ({ ...value, members: value.members.map(m => m.agent_id === agent.id ? { ...m, roles: m.roles.includes(role) ? m.roles.filter(r => r !== role) : [...m.roles, role] } : m) })); }} />;
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
                {TEAM_OPERATIONS.map(operation => <FormGroup key={operation} label={t(`agent_execution.skills.${operation}`, { defaultValue: operation })}>
                    <select multiple className="gnosi-select" aria-label={operation} value={team.direct_routes.find(r => r.operation === operation)?.agent_ids ?? []} onChange={e => {
                        const ids = Array.from(e.target.selectedOptions, o => o.value);
                        setTeam(v => ({ ...v, direct_routes: [...v.direct_routes.filter(r => r.operation !== operation), ...(ids.length ? [{ operation, agent_ids: ids }] : [])] }));
                    }}>{profilesByDisplayName(team.members.filter(m => m.agent_id !== team.director_id).map(m => agents.find(a => a.id === m.agent_id) ?? { id: m.agent_id }), t, i18n.resolvedLanguage).map(a => <option key={a.id} value={a.id}>{agentName(a)}</option>)}</select>
                </FormGroup>)}
                <label className="agent-team-setup__row">{t('agent_team.temporary')}<GnosiToggle label={t('agent_team.temporary')} active={team.temporary.enabled} onChange={() => { setTeam(v => ({ ...v, temporary: { ...v.temporary, enabled: !v.temporary.enabled } })); }} /></label>
                {team.temporary.enabled && <>
                    <FormGroup label={t('agent_team.allowed_models')}><select multiple className="gnosi-select" aria-label={t('agent_team.allowed_models')} value={team.temporary.models.map(m => `${m.provider}||${m.model}`)} onChange={e => {
                        const models = Array.from(e.target.selectedOptions, o => { const [provider = '', model = ''] = o.value.split('||'); return { provider, model }; });
                        setTeam(v => ({ ...v, temporary: { ...v.temporary, models } }));
                    }}>{registry.filter(r => r.enabled).map(r => <option key={`${r.provider}:${r.model_id}`} value={`${r.provider}||${r.model_id}`}>{modelDisplayName(r)} · {r.provider}</option>)}</select></FormGroup>
                    <FormGroup label={t('agent_team.allowed_skills')}><select multiple className="gnosi-select" aria-label={t('agent_team.allowed_skills')} value={team.temporary.skill_ids} onChange={e => {
                        const skill_ids = Array.from(e.target.selectedOptions, o => o.value);
                        setTeam(v => ({ ...v, temporary: { ...v.temporary, skill_ids } }));
                    }}>{skills.map(s => <option key={s} value={s}>{s}</option>)}</select></FormGroup>
                </>}
                <p className="settings-desc">{t('agent_team.skill_addition')}</p>
                <p className="settings-desc">{t('agent_team.limits')}</p>
            </details>
            <p className="settings-desc">{t('agent_team.review_help')}</p>
            {(!validDirector || !validMembers) && <p role="status" className="settings-desc">{t('agent_team.members_required')}</p>}
            {temporaryIncomplete && <p role="status" className="settings-desc">{t('agent_team.temporary_required')}</p>}
            <div className="agent-team-setup__actions">
                <button type="button" className="btn-gnosi btn-gnosi-secondary" onClick={() => { changeOpen(false); }}>{t('common.cancel')}</button>
                <button type="button" className="btn-gnosi btn-gnosi-primary" disabled={!canApply} onClick={apply}>{t('agent_team.apply')}</button>
                {current?.team?.enabled && <button type="button" className="btn-gnosi btn-gnosi-secondary" onClick={disable}>{t('agent_team.disable')}</button>}
            </div>
        </section>}
    </div>;
}
