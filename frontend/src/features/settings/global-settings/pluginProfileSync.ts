import { isSuspendedPluginProfile } from '../../../shared/ai/assistantProfiles';
import { normalizedTeam } from '../../../shared/ai/agentTeams';
import type { SettingsAgent } from './types';

/** Refresh only plugin-owned lifecycle fields, retaining local profile edits. */
export function syncPluginProfiles(current: SettingsAgent[], incoming: SettingsAgent[]): SettingsAgent[] {
    const byId = new Map(incoming.map(profile => [profile.id, profile]));
    const profiles = current.map(profile => {
        const saved = byId.get(profile.id);
        if (!saved?.managed_by || saved.managed_by !== profile.managed_by) return profile;
        return { ...profile, enabled: Boolean(saved.plugin_suspended) !== Boolean(profile.plugin_suspended) ? saved.enabled : profile.enabled, plugin_suspended: saved.plugin_suspended,
            plugin_enabled_before_suspend: saved.plugin_enabled_before_suspend };
    });
    profiles.push(...incoming.filter(profile => profile.managed_by && !current.some(item => item.id === profile.id)));
    const hidden = new Set(profiles.filter(isSuspendedPluginProfile).map(profile => profile.id));
    const updated = profiles.map(profile => {
        if (!profile.team) return profile;
        const team = normalizedTeam(profile.team, profile.id);
        const members = team.members.filter(member => !hidden.has(member.agent_id));
        const suspended = hidden.has(team.director_id) || (team.members.length > 0 && members.length === 0);
        if (!suspended && members.length === team.members.length) return profile;
        return { ...profile, team: { ...team, enabled: team.enabled && !suspended, members,
            direct_routes: team.direct_routes.map(route => ({ ...route, agent_ids: route.agent_ids.filter(id => members.some(member => member.agent_id === id)) })).filter(route => route.agent_ids.length),
            temporary: suspended ? { ...team.temporary, enabled: false } : team.temporary,
        } };
    });
    return JSON.stringify(updated) === JSON.stringify(current) ? current : updated;
}
