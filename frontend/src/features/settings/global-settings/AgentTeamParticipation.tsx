import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { TEAM_ROLES, type AgentTeam, type TeamRole } from '../../../shared/ai/agentTeams';
import { GnosiToggle } from '../../../shared/ui/settings/SettingsPrimitives';

export type TeamParticipation = 'independent' | 'member' | 'requester' | 'both';
const PARTICIPATION: TeamParticipation[] = ['independent', 'member', 'requester', 'both'];

interface Props {
    name: string;
    director: boolean;
    available: boolean;
    member?: AgentTeam['members'][number];
    requester: boolean;
    onChange: (value: TeamParticipation) => void;
    onToggleRole: (role: TeamRole) => void;
}

export function AgentTeamParticipation({ name, director, available, member, requester, onChange, onToggleRole }: Props) {
    const { t } = useTranslation();
    const id = useId();
    const value: TeamParticipation = member ? requester ? 'both' : 'member' : requester ? 'requester' : 'independent';
    return <div className="agent-team-setup__participation">
        {director ? <p className="settings-desc">{t('agent_team.director_help')}</p> : <>
            <label className="settings-label" htmlFor={id}>{t('agent_team.participation')}</label>
            <select id={id} className="gnosi-select" aria-label={t('agent_team.participation_for', { name })}
                aria-describedby={`${id}-help`} value={value} disabled={!available && value === 'independent'}
                onChange={event => { onChange(event.target.value as TeamParticipation); }}>
                {PARTICIPATION.map(option => <option key={option} value={option} disabled={!available && option !== 'independent'}>{t(`agent_team.participation_options.${option}`)}</option>)}
            </select>
            <p id={`${id}-help`} className="settings-desc">{t(available ? `agent_team.participation_help.${value}` : 'agent_team.unavailable_help')}</p>
            {member && <details className="agent-team-setup__specialties">
                <summary>{t('agent_team.specialties')}</summary>
                <p className="settings-desc">{t('agent_team.specialties_help')}</p>
                <div className="agent-team-setup__roles">{TEAM_ROLES.filter(role => role !== 'director').map(role => <div key={role} className="agent-team-setup__row">
                    <span>{t(`model_comparison.profiles.${role}`)}</span>
                    <GnosiToggle label={`${name}: ${t(`model_comparison.profiles.${role}`)}`} active={member.roles.includes(role)} disabled={!available} onChange={() => { onToggleRole(role); }} />
                </div>)}</div>
            </details>}
        </>}
    </div>;
}
