import { useState } from 'react';
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
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [step, setStep] = useState(0);
    const current = agents.find(a => a.id === principalId);
    const [team, setTeam] = useState<AgentTeam>(() => normalizedTeam(current?.team, principalId));
    const [initiators, setInitiators] = useState<string[]>([principalId]);
    const available = agents.filter(a => a.enabled !== false && !a.plugin_suspended);
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
    return <div className="ai-resources-panel">
        <button type="button" className="btn-gnosi btn-gnosi-secondary" aria-expanded={open} onClick={() => { if (!open) { setTeam(normalizedTeam(current?.team, principalId)); setInitiators(agents.filter(a => a.team?.enabled && a.team.director_id === (current?.team?.director_id ?? principalId)).map(a => a.id)); setStep(0); } setOpen(v => !v); }}>{t('agent_team.setup')}</button>
        {open && <section aria-label={t('agent_team.setup')}>
            <p className="settings-desc">{t('agent_team.help')}</p>
            <p>{t('agent_team.step', { current: step + 1, total: 3 })}</p>
            {step === 0 && <>
                <FormGroup label={t('agent_team.director')}><select className="gnosi-select" aria-label={t('agent_team.director')} value={team.director_id} onChange={e => { setTeam(v => ({ ...v, director_id: e.target.value })); }}>
                    <option value="">{t('agent_team.choose')}</option>
                    {available.filter(a => !a.managed_by).map(a => <option key={a.id} value={a.id}>{a.name ?? a.id} · {a.model}</option>)}
                </select></FormGroup>
                {available.filter(a => a.id !== team.director_id).map(a => <div className="ai-resource-card" key={a.id}>
                    <span>{a.name ?? a.id} · {a.model}</span>
                    <GnosiToggle active={team.members.some(m => m.agent_id === a.id)} label={t('agent_team.member', { name: a.name ?? a.id })} onChange={() => { toggleMember(a.id); }} />
                    {team.members.some(m => m.agent_id === a.id) && <div className="flex flex-wrap gap-2">{TEAM_ROLES.filter(r => r !== 'director').map(role => <label key={role} className="flex gap-2">
                        {t(`model_comparison.profiles.${role}`)}<GnosiToggle label={`${a.name ?? a.id}: ${t(`model_comparison.profiles.${role}`)}`} active={team.members.find(m => m.agent_id === a.id)?.roles.includes(role)} onChange={() => { setTeam(v => ({ ...v, members: v.members.map(m => m.agent_id === a.id ? { ...m, roles: m.roles.includes(role) ? m.roles.filter(r => r !== role) : [...m.roles, role] } : m) })); }} />
                    </label>)}</div>}
                </div>)}
                <p>{t('agent_team.entrypoints')}</p>
                {available.filter(a => a.id !== team.director_id).map(a => <label className="flex gap-2" key={a.id}>{a.name ?? a.id}
                    <GnosiToggle label={t('agent_team.initiator', { name: a.name ?? a.id })} active={initiators.includes(a.id)} onChange={() => { setInitiators(v => v.includes(a.id) ? v.filter(id => id !== a.id) : [...v, a.id]); }} />
                </label>)}
            </>}
            {step === 1 && <>
                <p>{t('agent_team.routes_help')}</p>
                {TEAM_OPERATIONS.map(operation => <FormGroup key={operation} label={t(`agent_execution.skills.${operation}`, { defaultValue: operation })}>
                    <select multiple className="gnosi-select" aria-label={operation} value={team.direct_routes.find(r => r.operation === operation)?.agent_ids ?? []} onChange={e => {
                        const ids = Array.from(e.target.selectedOptions, o => o.value);
                        setTeam(v => ({ ...v, direct_routes: [...v.direct_routes.filter(r => r.operation !== operation), ...(ids.length ? [{ operation, agent_ids: ids }] : [])] }));
                    }}>{team.members.filter(m => m.agent_id !== team.director_id).map(m => <option key={m.agent_id} value={m.agent_id}>{agents.find(a => a.id === m.agent_id)?.name ?? m.agent_id}</option>)}</select>
                </FormGroup>)}
            </>}
            {step === 2 && <>
                <label className="flex gap-2">{t('agent_team.temporary')}<GnosiToggle label={t('agent_team.temporary')} active={team.temporary.enabled} onChange={() => { setTeam(v => ({ ...v, temporary: { ...v.temporary, enabled: !v.temporary.enabled } })); }} /></label>
                {team.temporary.enabled && <>
                    <FormGroup label={t('agent_team.allowed_models')}><select multiple className="gnosi-select" aria-label={t('agent_team.allowed_models')} value={team.temporary.models.map(m => `${m.provider}||${m.model}`)} onChange={e => {
                        const models = Array.from(e.target.selectedOptions, o => { const [provider = '', model = ''] = o.value.split('||'); return { provider, model }; });
                        setTeam(v => ({ ...v, temporary: { ...v.temporary, models } }));
                    }}>{registry.filter(r => r.enabled).map(r => <option key={`${r.provider}:${r.model_id}`} value={`${r.provider}||${r.model_id}`}>{r.alias ?? r.model_id} · {r.provider}</option>)}</select></FormGroup>
                    <FormGroup label={t('agent_team.allowed_skills')}><select multiple className="gnosi-select" aria-label={t('agent_team.allowed_skills')} value={team.temporary.skill_ids} onChange={e => {
                        const skill_ids = Array.from(e.target.selectedOptions, o => o.value);
                        setTeam(v => ({ ...v, temporary: { ...v.temporary, skill_ids } }));
                    }}>{skills.map(s => <option key={s} value={s}>{s}</option>)}</select></FormGroup>
                </>}
                <p>{t('agent_team.review_help')}</p>
                <p>{t('agent_team.skill_addition')} <strong>{TEAM_SKILL}</strong></p>
                <p>{t('agent_team.limits')}</p>
            </>}
            <div className="flex gap-2">
                <button type="button" className="btn-gnosi btn-gnosi-secondary" onClick={() => { if (step) setStep(s => s - 1); else setOpen(false); }}>{t(step ? 'agent_team.back' : 'common.cancel')}</button>
                {step < 2 ? <button type="button" className="btn-gnosi btn-gnosi-primary" disabled={!team.director_id || !team.members.some(m => m.agent_id !== team.director_id)} onClick={() => { setStep(s => s + 1); }}>{t('agent_team.next')}</button>
                    : <button type="button" className="btn-gnosi btn-gnosi-primary" disabled={team.temporary.enabled && (!team.temporary.models.length || !team.temporary.skill_ids.length)} onClick={apply}>{t('agent_team.apply')}</button>}
                {current?.team?.enabled && <button type="button" className="btn-gnosi btn-gnosi-secondary" onClick={disable}>{t('agent_team.disable')}</button>}
            </div>
        </section>}
    </div>;
}
