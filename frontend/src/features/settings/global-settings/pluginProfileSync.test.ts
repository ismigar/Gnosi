import { expect, it } from 'vitest';
import { EMPTY_TEAM, type AgentTeam } from '../../../shared/ai/agentTeams';
import { syncPluginProfiles } from './pluginProfileSync';
import type { SettingsAgent } from './types';

const mail: SettingsAgent = { id: 'mail', managed_by: 'builtin:mail', model: 'chosen', persona: 'Local instructions', skill_ids: ['custom'], enabled: true };
const team: AgentTeam = { ...EMPTY_TEAM, enabled: true, director_id: 'principal', members: [{ agent_id: 'mail', roles: ['administrative'] }, { agent_id: 'other', roles: ['expert'] }], direct_routes: [{ operation: 'mail', agent_ids: ['mail', 'other'] }] };

it('hides a plugin bot without replacing local edits and removes it from active assignments', () => {
    const current = [{ id: 'principal', team }, mail, { id: 'other' }];
    const result = syncPluginProfiles(current, [{ ...mail, plugin_suspended: true, model: 'older-model', persona: 'Older instructions' }]);
    expect(result[1]).toMatchObject({ ...mail, plugin_suspended: true });
    expect(result[0]?.team).toMatchObject({ enabled: true, members: [team.members[1]], direct_routes: [{ operation: 'mail', agent_ids: ['other'] }] });
    expect(current[0]?.team).toEqual(team);
});
it('disables collaboration if the plugin was its only receiver or its principal', () => {
    const onlyMember = { ...team, members: team.members.slice(0, 1) };
    const result = syncPluginProfiles([{ id: 'principal', team: onlyMember }, { ...mail, team: onlyMember }], [{ ...mail, plugin_suspended: true }]);
    expect(result.every(profile => profile.team?.enabled === false)).toBe(true);
    expect(result[0]?.team?.direct_routes).toEqual([]);
    const principal = { id: 'principal', managed_by: 'plugin:main', team };
    expect(syncPluginProfiles([principal, { ...mail, team }], [{ ...principal, plugin_suspended: true }])[1]?.team?.enabled).toBe(false);
});
it('restores a reactivated plugin while preserving its model and instructions', () => {
    const suspended = { ...mail, enabled: false, plugin_suspended: true, plugin_enabled_before_suspend: true };
    const result = syncPluginProfiles([suspended], [{ ...mail, plugin_suspended: false, model: 'outdated', persona: 'old' }]);
    expect(result[0]).toMatchObject({ ...mail, plugin_suspended: false });
});
it('preserves personal and newly edited activation choices and adds newly installed plugin profiles', () => {
    const personal = { id: 'personal', name: 'Local name' };
    const other = { id: 'new-plugin', managed_by: 'plugin:new', model: 'new' };
    const result = syncPluginProfiles([personal, mail], [{ ...personal, name: 'Old name' }, { ...mail, enabled: false }, other]);
    expect(result[0]).toBe(personal);
    expect(result[1]?.enabled).toBe(true);
    expect(result[2]).toBe(other);
});
it('keeps the same state when a configuration notification carries no lifecycle changes', () => {
    const current = [mail];
    expect(syncPluginProfiles(current, [mail])).toBe(current);
});

it('accepts older disabled team settings that omit optional collections', () => {
    const partial = { enabled: false } as AgentTeam;
    const current = [{ ...mail, team: partial }];
    expect(syncPluginProfiles(current, current)).toBe(current);
    expect(syncPluginProfiles(current, [{ ...mail, plugin_suspended: true }])[0]?.team).toMatchObject({ enabled: false, members: [], direct_routes: [] });
});
