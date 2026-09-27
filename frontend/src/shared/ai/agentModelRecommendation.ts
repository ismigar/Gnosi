import { TEAM_ROLES, type AgentTeam, type TeamRole } from './agentTeams';

interface Profile {
    id: string;
    managed_by?: string;
    skill_ids?: readonly string[];
}
interface Skill { id: string; metadata?: { derived_from?: { id: string } } }

const operationProfiles: Readonly<Record<string, TeamRole>> = {
    writing: 'allrounder', reader: 'expert', podcast: 'documentalist', notebook: 'documentalist',
    literature: 'documentalist', mail: 'administrative', social: 'allrounder', meeting: 'administrative',
    translation: 'allrounder', tables: 'administrative', knowledge: 'expert', capture: 'administrative', learning: 'expert',
};
const skillOperations: Readonly<Record<string, string>> = {
    'core.gnosi-reader-topic-evolution': 'reader', 'core.gnosi-daily-briefing': 'podcast',
    'core.gnosi-notebooks': 'notebook', 'core.gnosi-literature': 'literature',
    'core.gnosi-inbox-triage': 'mail', 'core.gnosi-meeting-preparation': 'meeting',
    'core.gnosi-knowledge-capture': 'capture', 'core.gnosi-social-publishing': 'social',
    'core.gnosi-translation-workflow': 'translation', 'core.gnosi-translation': 'translation',
    'core.gnosi-research-dossier': 'knowledge',
};
const pluginProfiles: Readonly<Record<string, TeamRole>> = {
    'ai-platform': 'expert', 'feeds-reader': 'expert', 'grounded-notebooks': 'documentalist',
    resources: 'documentalist', mail: 'administrative', 'social-publishing': 'allrounder',
    calendar: 'administrative', translation: 'allrounder', 'llm-wiki': 'expert',
};

/** Advisory task demand, independent of the assigned model and its measured scores. */
export function recommendedModelProfile(profile: Profile, principalId: string, team?: Partial<AgentTeam>, catalog: readonly Skill[] = []): TeamRole {
    if (profile.id === principalId) return 'director';
    const roles: TeamRole[] = [...(team?.members?.find(member => member.agent_id === profile.id)?.roles ?? [])];
    const owner = profile.managed_by?.startsWith('builtin:') ? profile.managed_by.slice(8) : '';
    const pluginRole = pluginProfiles[owner];
    if (pluginRole) roles.push(pluginRole);
    const skillIds = (profile.skill_ids ?? []).flatMap(id => [id, catalog.find(skill => skill.id === id)?.metadata?.derived_from?.id ?? '']);
    for (const id of skillIds) {
        const operation = skillOperations[id] ?? (id.startsWith('core.gnosi-operation-') ? id.slice('core.gnosi-operation-'.length) : '');
        const role = operationProfiles[operation];
        if (role) roles.push(role);
        if (id.startsWith('plugin.llm-wiki.')) roles.push('expert');
    }
    for (const route of team?.direct_routes ?? []) {
        const role = operationProfiles[route.operation];
        if (route.agent_ids.includes(profile.id) && role) roles.push(role);
    }
    return TEAM_ROLES.find(role => roles.includes(role)) ?? 'allrounder';
}
