import { useState } from 'react';
import { profileDisplayName, profilesByDisplayName } from '../../../shared/ai/assistantProfiles';
import { modelDisplayName } from '../../../shared/ai/modelDisplayName';
import './AgentTeamSetup.css';
import { useTranslation } from 'react-i18next';
import { GnosiToggle, FormGroup } from '../../../shared/ui/settings/SettingsPrimitives';
import { normalizedTeam, TEAM_OPERATIONS, TEAM_ROLES, TEAM_SKILL, withTeam, type AgentTeam } from '../../../shared/ai/agentTeams';
import type { AiModelRegistryEntry } from '../../../shared/api/ai';
import type { SettingsAgent } from './types';

interface Props {
    agents: SettingsAgent[];
    principalId: string;
    registry: AiModelRegistryEntry[];
    onApply: (agents: SettingsAgent[], principalId: string) => void;
}

export function AgentTeamSetup({ agents, principalId, registry, onApply }: Props) {
    const { t, i18n } = useTranslation();
    const [open, setOpen] = useState(false);
    const [step, setStep] = useState(0);
    const current = agents.find(a => a.id === principalId);
    const [team, setTeam] = useState<AgentTeam>(() => normalizedTeam(current?.team, principalId));
    const [initiators, setInitiators] = useState<string[]>([principalId]);
    const available = profilesByDisplayName(agents.filter(a => a.enabled !== false && !a.plugin_suspended), t, i18n.resolvedLanguage);
    const agentName = (agent: SettingsAgent) => profileDisplayName(agent, t) || agent.id;
    const agentModel = (agent: SettingsAgent) => modelDisplayName(registry.find(row => row.provider === agent.provider && row.model_id === agent.model)) || agent.model;
    const skills = [...new Set(available.flatMap(a => a.skill_ids ?? []))].filter(s => s !== TEAM_SKILL);
    const toggleMember = (id: string) => { setTeam(value => ({ ...value,
        members: value.members.some(m => m.agent_id === id) ? value.members.filter(m => m.agent_id !== id) : [...value.members, { agent_id: id, roles: ['allrounder'] }],
        direct_routes: value.direct_routes.map(r => ({ ...r, agent_ids: r.agent_ids.filter(a => a !== id) })).filter(r => r.agent_ids.length),
    })); };
    const apply = () => {
        const members = team.members.filter(m => m.agent_id !== team.director_id);
        const selected = { ...team, enabled: true, members, direct_routes: team.direct_routes.map(r => ({ ...r, agent_ids: r.agent_ids.filter(id => members.some(m => m.agent_id === id)) })).filter(r => r.agent_ids.length) };
        onApply(withTeam(agents, selected, initiators, current?.team?.director_id ?? principalId), selected.director_id);
        setOpen(false);
    };
    const disable = () => {
        const directorId = current?.team?.director_id;
        onApply(agents.map(a => a.team && a.team.director_id === directorId ? { ...a, team: { ...a.team, enabled: false } } : a), principalId);
        setOpen(false);
    };
    return <div className="agent-team-setup">
        <button type="button" className="btn-gnosi btn-gnosi-secondary" aria-expanded={open} onClick={() => { if (!open) { setTeam(normalizedTeam(current?.team, principalId)); setInitiators(agents.filter(a => a.team?.enabled && a.team.director_id === (current?.team?.director_id ?? principalId)).map(a => a.id)); setStep(0); } setOpen(v => !v); }}>{t('agent_team.setup')}</button>
        {open && <section className="agent-team-setup__wizard" aria-label={t('agent_team.setup')}>
            <p className="settings-desc">{t('agent_team.help')}</p>
            <div className="agent-team-setup__progress"><span className="settings-label">{t('agent_team.step', { current: step + 1, total: 3 })}</span><div className="agent-team-setup__track" aria-hidden="true">{[0, 1, 2].map(index => <span key={index} className={index <= step ? 'is-complete' : ''} />)}</div></div>
            {step === 0 && <>
                <FormGroup label={t('agent_team.director')}><select className="gnosi-select" aria-label={t('agent_team.director')} value={team.director_id} onChange={e => { setTeam(v => ({ ...v, director_id: e.target.value })); }}>
                    <option value="">{t('agent_team.choose')}</option>
                    {available.filter(a => !a.managed_by).map(a => <option key={a.id} value={a.id}>{agentName(a)} · {agentModel(a)}</option>)}
                </select></FormGroup>
                {available.filter(a => a.id !== team.director_id).map(a => <div className="agent-team-setup__card" key={a.id}>
                    <div className="agent-team-setup__row"><div className="agent-team-setup__identity"><strong>{agentName(a)}</strong><span className="settings-desc">{agentModel(a)}</span></div>
                    <GnosiToggle active={team.members.some(m => m.agent_id === a.id)} label={t('agent_team.member', { name: agentName(a) })} onChange={() => { toggleMember(a.id); }} /></div>
                    {team.members.some(m => m.agent_id === a.id) && <div className="agent-team-setup__roles">{TEAM_ROLES.filter(r => r !== 'director').map(role => <label key={role} className="agent-team-setup__row">
                        {t(`model_comparison.profiles.${role}`)}<GnosiToggle label={`${agentName(a)}: ${t(`model_comparison.profiles.${role}`)}`} active={team.members.find(m => m.agent_id === a.id)?.roles.includes(role)} onChange={() => { setTeam(v => ({ ...v, members: v.members.map(m => m.agent_id === a.id ? { ...m, roles: m.roles.includes(role) ? m.roles.filter(r => r !== role) : [...m.roles, role] } : m) })); }} />
                    </label>)}</div>}
                </div>)}
                <h3 className="settings-label agent-team-setup__heading">{t('agent_team.entrypoints')}</h3>
                {available.filter(a => a.id !== team.director_id).map(a => <label className="agent-team-setup__row" key={a.id}><span>{agentName(a)}</span>
                    <GnosiToggle label={t('agent_team.initiator', { name: agentName(a) })} active={initiators.includes(a.id)} onChange={() => { setInitiators(v => v.includes(a.id) ? v.filter(id => id !== a.id) : [...v, a.id]); }} />
                </label>)}
            </>}
            {step === 1 && <>
                <p className="settings-desc">{t('agent_team.routes_help')}</p>
                {TEAM_OPERATIONS.map(operation => <FormGroup key={operation} label={t(`agent_execution.skills.${operation}`, { defaultValue: operation })}>
                    <select multiple className="gnosi-select" aria-label={operation} value={team.direct_routes.find(r => r.operation === operation)?.agent_ids ?? []} onChange={e => {
                        const ids = Array.from(e.target.selectedOptions, o => o.value);
                        setTeam(v => ({ ...v, direct_routes: [...v.direct_routes.filter(r => r.operation !== operation), ...(ids.length ? [{ operation, agent_ids: ids }] : [])] }));
                    }}>{profilesByDisplayName(team.members.filter(m => m.agent_id !== team.director_id).map(m => agents.find(a => a.id === m.agent_id) ?? { id: m.agent_id }), t, i18n.resolvedLanguage).map(a => <option key={a.id} value={a.id}>{agentName(a)}</option>)}</select>
                </FormGroup>)}
            </>}
            {step === 2 && <>
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
                <p className="settings-desc">{t('agent_team.review_help')}</p>
                <p className="settings-desc">{t('agent_team.skill_addition')} <strong>{TEAM_SKILL}</strong></p>
                <p className="settings-desc">{t('agent_team.limits')}</p>
            </>}
            <div className="agent-team-setup__actions">
                <button type="button" className="btn-gnosi btn-gnosi-secondary" onClick={() => { if (step) setStep(s => s - 1); else setOpen(false); }}>{t(step ? 'agent_team.back' : 'common.cancel')}</button>
                {step < 2 ? <button type="button" className="btn-gnosi btn-gnosi-primary" disabled={!team.director_id || !team.members.some(m => m.agent_id !== team.director_id)} onClick={() => { setStep(s => s + 1); }}>{t('agent_team.next')}</button>
                    : <button type="button" className="btn-gnosi btn-gnosi-primary" disabled={team.temporary.enabled && (!team.temporary.models.length || !team.temporary.skill_ids.length)} onClick={apply}>{t('agent_team.apply')}</button>}
                {current?.team?.enabled && <button type="button" className="btn-gnosi btn-gnosi-secondary" onClick={disable}>{t('agent_team.disable')}</button>}
            </div>
        </section>}
    </div>;
}
